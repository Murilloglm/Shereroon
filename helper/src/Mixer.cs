using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;

namespace ShareRoomAudio
{
    internal enum SourceState
    {
        /// <summary>Desligada: nada desse aplicativo é capturado.</summary>
        Off,
        Capturing,
        /// <summary>Ligada, mas o áudio dela já vem por outra fonte ligada (o app pai ou "Sistema").</summary>
        Covered,
        /// <summary>O Windows recusou a captura.</summary>
        Error,
        /// <summary>O aplicativo fechou.</summary>
        Ended,
    }

    /// <summary>Uma fonte do mixer: um aplicativo (árvore de processos) ou "Sistema" (tudo menos o navegador da sala).</summary>
    internal sealed class Source
    {
        public string Id;
        public int Slot;
        public uint Pid;
        public bool IsSystem;
        public string Exe = "";
        public bool Enabled;
        public float Volume = 1f;
        /// <summary>Entregue separada e sem ganho, para o site aplicar filtros (supressão de ruído) antes de misturar.</summary>
        public bool Solo;
        public SourceState State = SourceState.Off;
        public string Error;
        /// <summary>Qual fonte ligada já cobre esta (quando State == Covered).</summary>
        public string CoveredBy;

        internal ProcessLoopback Capture;
        internal RingBuffer Ring;
        internal bool Primed;
        internal int EmptyTicks;
        internal float Gain;
        internal float Peak;
        internal long BufferedFramesSum;
        internal long BufferedSamples;
        internal long Underruns;
    }

    internal sealed class MixerLevels
    {
        public float Master;
        public Dictionary<int, float> Sources = new Dictionary<int, float>();
        /// <summary>Atraso médio de cada fonte dentro do mixer, em milissegundos (medido, não estimado).</summary>
        public Dictionary<int, double> BufferMs = new Dictionary<int, double>();
    }

    /// <summary>
    /// Mistura as fontes ligadas, cada uma com seu volume, em blocos de 10 ms. O volume é aplicado só na
    /// cópia capturada: o que o usuário escuta no PC não muda. Ligar, desligar e ajustar volume acontecem
    /// com a mixagem rodando, com rampa de 10 ms para não estalar.
    /// </summary>
    internal sealed class Mixer : IDisposable
    {
        /// <summary>Quadros que cada fonte mantém em fila antes de ser lida: 20 ms absorvem a irregularidade das threads.</summary>
        private const int TargetFrames = Format.BlockFrames * 2;
        private const int MaxSolo = 6;

        private readonly object gate = new object();
        private readonly object reconcileGate = new object();
        private readonly List<Source> sources = new List<Source>();
        private Thread thread;
        private volatile bool stopping;
        private int nextSlot = 1;
        private uint sequence;
        private float limiterGain = 1f;
        private float masterPeak;
        private uint browserPid;

        /// <summary>Chamado a cada bloco com a mensagem binária pronta (mix + fontes "solo"). Só quando Streaming.</summary>
        public Action<byte[]> OnAudio;
        /// <summary>Chamado a cada 50 ms com os níveis de pico.</summary>
        public Action<MixerLevels> OnLevels;
        /// <summary>Chamado quando o estado de alguma fonte muda sozinho (o app fechou, por exemplo).</summary>
        public Action OnSourcesChanged;
        public volatile bool Streaming;

        /// <summary>Processo raiz do navegador que está com a sala aberta. Nunca é capturado (evita eco).</summary>
        public uint BrowserPid
        {
            get { return browserPid; }
            set { browserPid = value; }
        }

        public void Start()
        {
            Native.timeBeginPeriod(1);
            thread = new Thread(Run);
            thread.IsBackground = true;
            thread.Name = "mixer";
            thread.Priority = ThreadPriority.Highest;
            thread.SetApartmentState(ApartmentState.MTA);
            thread.Start();
        }

        public void Dispose()
        {
            stopping = true;
            if (thread != null)
            {
                thread.Join(1000);
            }
            DisableAll();
            Native.timeEndPeriod(1);
        }

        public List<Source> Snapshot()
        {
            lock (gate)
            {
                return new List<Source>(sources);
            }
        }

        public Source Find(string id)
        {
            lock (gate)
            {
                foreach (Source source in sources)
                {
                    if (source.Id == id)
                    {
                        return source;
                    }
                }
            }
            return null;
        }

        /// <summary>Cria ou atualiza uma fonte. Campos nulos ficam como estão. Depois chame Reconcile.</summary>
        public Source Configure(string id, uint pid, string exe, bool isSystem, bool? enabled, float? volume, bool? solo)
        {
            lock (gate)
            {
                Source source = null;
                foreach (Source candidate in sources)
                {
                    if (candidate.Id == id)
                    {
                        source = candidate;
                        break;
                    }
                }
                if (source == null)
                {
                    source = new Source();
                    source.Id = id;
                    source.Slot = nextSlot++;
                    source.Pid = pid;
                    source.Exe = exe ?? "";
                    source.IsSystem = isSystem;
                    sources.Add(source);
                }
                if (enabled.HasValue)
                {
                    source.Enabled = enabled.Value;
                    if (enabled.Value && (source.State == SourceState.Error || source.State == SourceState.Ended))
                    {
                        source.State = SourceState.Off;
                        source.Error = null;
                    }
                }
                if (volume.HasValue)
                {
                    source.Volume = Math.Max(0f, Math.Min(1f, volume.Value));
                }
                if (solo.HasValue)
                {
                    source.Solo = solo.Value;
                }
                return source;
            }
        }

        public void DisableAll()
        {
            // Mesmo cadeado do Reconcile: uma reconciliação em andamento não pode religar o que acabou de ser desligado.
            lock (reconcileGate)
            {
                List<Source> all;
                lock (gate)
                {
                    all = new List<Source>(sources);
                    sources.Clear();
                }
                foreach (Source source in all)
                {
                    source.Enabled = false;
                    StopCapture(source);
                }
            }
        }

        /// <summary>
        /// Decide o que de fato capturar. Nunca captura a mesma coisa duas vezes: se "Sistema" está ligado ele
        /// cobre todos os apps; se um app pai está ligado, ele cobre os filhos (o Windows captura a árvore inteira).
        /// </summary>
        public void Reconcile(ProcessSnapshot snapshot)
        {
            lock (reconcileGate)
            {
                ReconcileLocked(snapshot);
            }
        }

        private void ReconcileLocked(ProcessSnapshot snapshot)
        {
            List<Source> all = Snapshot();
            Source system = null;
            foreach (Source source in all)
            {
                if (source.IsSystem && source.Enabled)
                {
                    system = source;
                }
            }

            foreach (Source source in all)
            {
                if (!source.Enabled)
                {
                    if (source.Capture != null)
                    {
                        // Dá tempo de o mixer baixar o ganho a zero (um bloco de 10 ms) antes de cortar: sem estalo.
                        Thread.Sleep(25);
                    }
                    StopCapture(source);
                    if (source.State != SourceState.Error && source.State != SourceState.Ended)
                    {
                        source.State = SourceState.Off;
                    }
                    source.CoveredBy = null;
                    continue;
                }
                if (source.State == SourceState.Error || source.State == SourceState.Ended)
                {
                    continue;
                }
                if (!source.IsSystem && !snapshot.Exists(source.Pid))
                {
                    // O aplicativo fechou. O Windows não avisa: a captura seguiria entregando silêncio para sempre.
                    StopCapture(source);
                    source.State = SourceState.Ended;
                    source.Enabled = false;
                    source.CoveredBy = null;
                    continue;
                }

                string coveredBy = null;
                if (!source.IsSystem)
                {
                    if (system != null)
                    {
                        coveredBy = system.Id;
                    }
                    else
                    {
                        foreach (Source other in all)
                        {
                            if (other != source && other.Enabled && !other.IsSystem && other.Pid != source.Pid
                                && other.State != SourceState.Error && other.State != SourceState.Ended
                                && snapshot.IsInTree(source.Pid, other.Pid))
                            {
                                coveredBy = other.Id;
                                break;
                            }
                        }
                    }
                }

                if (coveredBy != null)
                {
                    StopCapture(source);
                    source.State = SourceState.Covered;
                    source.CoveredBy = coveredBy;
                    continue;
                }

                source.CoveredBy = null;
                if (source.Capture == null)
                {
                    StartCapture(source);
                }
            }
        }

        private void StartCapture(Source source)
        {
            // "Sistema" = tudo MENOS a árvore do navegador da sala. Sem navegador conhecido, exclui a nós mesmos
            // (que não tocamos nada), o que equivale a capturar tudo.
            uint target = source.IsSystem
                ? (browserPid != 0 ? browserPid : (uint)Process.GetCurrentProcess().Id)
                : source.Pid;
            RingBuffer ring = new RingBuffer(Format.SampleRate);
            ProcessLoopback capture = new ProcessLoopback(target, source.IsSystem, ring);
            try
            {
                capture.Start();
            }
            catch (Exception error)
            {
                capture.Dispose();
                source.State = SourceState.Error;
                source.Error = error.Message;
                return;
            }
            lock (gate)
            {
                source.Ring = ring;
                source.Primed = false;
                source.EmptyTicks = 0;
                source.Gain = 0f;
                source.BufferedFramesSum = 0;
                source.BufferedSamples = 0;
                source.Capture = capture;
                source.State = SourceState.Capturing;
                source.Error = null;
            }
        }

        private void StopCapture(Source source)
        {
            ProcessLoopback capture;
            lock (gate)
            {
                capture = source.Capture;
                source.Capture = null;
                source.Ring = null;
                source.Peak = 0f;
            }
            if (capture != null)
            {
                capture.Dispose();
            }
        }

        private void Run()
        {
            float[] mix = new float[Format.BlockSamples];
            float[] raw = new float[(Format.BlockFrames + 2) * Format.Channels];
            float[] block = new float[Format.BlockSamples];
            float[][] solo = new float[MaxSolo][];
            int[] soloSlots = new int[MaxSolo];
            for (int i = 0; i < MaxSolo; i++)
            {
                solo[i] = new float[Format.BlockSamples];
            }

            Stopwatch clock = Stopwatch.StartNew();
            long done = 0;
            int levelCountdown = 0;
            while (!stopping)
            {
                long due = (long)(clock.Elapsed.TotalMilliseconds / 10.0);
                if (done >= due)
                {
                    Thread.Sleep(1);
                    continue;
                }
                if (due - done > 20)
                {
                    // A thread ficou parada (sistema travado, suspensão): não tenta recuperar o tempo perdido.
                    done = due - 1;
                }
                done++;

                Array.Clear(mix, 0, mix.Length);
                int soloCount = 0;
                bool changed = false;
                List<Source> current = Snapshot();
                foreach (Source source in current)
                {
                    ProcessLoopback capture = source.Capture;
                    RingBuffer ring = source.Ring;
                    if (capture == null || ring == null)
                    {
                        continue;
                    }
                    if (!capture.Running)
                    {
                        // A captura morreu sozinha: o aplicativo fechou.
                        StopCapture(source);
                        source.State = SourceState.Ended;
                        source.Enabled = false;
                        source.Error = capture.Failure != null ? capture.Failure.Message : null;
                        changed = true;
                        continue;
                    }
                    if (!ReadBlock(source, ring, raw, block))
                    {
                        source.Peak = 0f;
                        continue;
                    }

                    float target = source.Enabled ? (source.Solo ? 1f : source.Volume) : 0f;
                    float gain = source.Gain;
                    float step = (target - gain) / Format.BlockFrames;
                    if (source.Solo && soloCount < MaxSolo)
                    {
                        // Solo: segue sem o volume do usuário (só a rampa de liga/desliga); o site filtra e mistura.
                        float[] destination = solo[soloCount];
                        for (int frame = 0; frame < Format.BlockFrames; frame++)
                        {
                            gain += step;
                            destination[frame * 2] = block[frame * 2] * gain;
                            destination[frame * 2 + 1] = block[frame * 2 + 1] * gain;
                        }
                        soloSlots[soloCount++] = source.Slot;
                        source.Peak = Dsp.Peak(destination, Format.BlockSamples) * source.Volume;
                    }
                    else
                    {
                        float peak = 0f;
                        for (int frame = 0; frame < Format.BlockFrames; frame++)
                        {
                            gain += step;
                            float left = block[frame * 2] * gain;
                            float right = block[frame * 2 + 1] * gain;
                            mix[frame * 2] += left;
                            mix[frame * 2 + 1] += right;
                            float magnitude = Math.Max(left < 0 ? -left : left, right < 0 ? -right : right);
                            if (magnitude > peak)
                            {
                                peak = magnitude;
                            }
                        }
                        source.Peak = peak;
                    }
                    source.Gain = target;
                }

                Limit(mix);
                masterPeak = Math.Max(masterPeak, Dsp.Peak(mix, mix.Length));

                Action<byte[]> audio = OnAudio;
                if (Streaming && audio != null)
                {
                    audio(Pack(mix, solo, soloSlots, soloCount));
                }

                if (++levelCountdown >= 5)
                {
                    levelCountdown = 0;
                    Action<MixerLevels> levels = OnLevels;
                    if (levels != null)
                    {
                        MixerLevels report = new MixerLevels();
                        report.Master = masterPeak;
                        foreach (Source source in current)
                        {
                            if (source.Capture != null)
                            {
                                report.Sources[source.Slot] = source.Peak;
                                if (source.BufferedSamples > 0)
                                {
                                    report.BufferMs[source.Slot] =
                                        (double)source.BufferedFramesSum / source.BufferedSamples * 1000.0 / Format.SampleRate;
                                }
                                source.BufferedFramesSum = 0;
                                source.BufferedSamples = 0;
                            }
                        }
                        levels(report);
                    }
                    masterPeak = 0f;
                }

                if (changed)
                {
                    Action notify = OnSourcesChanged;
                    if (notify != null)
                    {
                        notify();
                    }
                }
            }
        }

        /// <summary>
        /// Lê um bloco de 10 ms da fila da fonte. A captura e o mixer usam relógios diferentes, então a fila
        /// tende a crescer ou a esvaziar devagar; corrige lendo um quadro a mais ou a menos e reamostrando.
        /// </summary>
        private static bool ReadBlock(Source source, RingBuffer ring, float[] raw, float[] block)
        {
            int available = ring.AvailableFrames;
            if (!source.Primed)
            {
                if (available < TargetFrames)
                {
                    return false;
                }
                source.Primed = true;
            }
            if (available > TargetFrames + Format.BlockFrames * 6)
            {
                // Atraso acumulado demais (a thread parou por um instante): descarta para voltar a tempo real.
                ring.Drop(available - TargetFrames);
                available = TargetFrames;
            }

            source.BufferedFramesSum += available;
            source.BufferedSamples++;

            if (available == 0)
            {
                // O aplicativo parou de entregar áudio. Depois de 30 ms vazia, a fila volta a encher antes de tocar.
                if (++source.EmptyTicks >= 3)
                {
                    source.Primed = false;
                }
                Array.Clear(block, 0, Format.BlockSamples);
                return true;
            }
            source.EmptyTicks = 0;

            int want = Format.BlockFrames;
            if (available > TargetFrames + Format.BlockFrames / 2)
            {
                want = Format.BlockFrames + 1;
            }
            else if (available < TargetFrames - Format.BlockFrames / 2)
            {
                want = Format.BlockFrames - 1;
            }
            if (available < want)
            {
                source.Underruns++;
                Array.Clear(raw, 0, raw.Length);
                ring.Read(raw, available);
                Array.Copy(raw, block, Format.BlockSamples);
                return true;
            }
            ring.Read(raw, want);
            Dsp.Resample(raw, want, block, Format.BlockFrames);
            return true;
        }

        /// <summary>Limitador: vários apps somados podem passar de 0 dB; reduz o ganho em vez de distorcer.</summary>
        private void Limit(float[] mix)
        {
            const float ceiling = 0.97f;
            float peak = Dsp.Peak(mix, mix.Length);
            float wanted = peak * limiterGain > ceiling ? ceiling / peak : Math.Min(1f, limiterGain * 1.06f);
            if (wanted == 1f && limiterGain == 1f)
            {
                return;
            }
            float gain = limiterGain;
            float step = (wanted - gain) / Format.BlockFrames;
            for (int frame = 0; frame < Format.BlockFrames; frame++)
            {
                gain += step;
                float left = mix[frame * 2] * gain;
                float right = mix[frame * 2 + 1] * gain;
                mix[frame * 2] = left > 1f ? 1f : (left < -1f ? -1f : left);
                mix[frame * 2 + 1] = right > 1f ? 1f : (right < -1f ? -1f : right);
            }
            limiterGain = wanted;
        }

        /// <summary>
        /// Mensagem binária de um bloco: [seq u32][quadros u16][nº de faixas u8][0]
        /// e, por faixa, [slot u32 (0 = mix)][amostras float32 estéreo intercaladas]. Tudo little-endian.
        /// </summary>
        private byte[] Pack(float[] mix, float[][] solo, int[] soloSlots, int soloCount)
        {
            int streamBytes = 4 + Format.BlockSamples * 4;
            byte[] message = new byte[8 + streamBytes * (1 + soloCount)];
            uint seq = sequence++;
            message[0] = (byte)seq;
            message[1] = (byte)(seq >> 8);
            message[2] = (byte)(seq >> 16);
            message[3] = (byte)(seq >> 24);
            message[4] = (byte)(Format.BlockFrames & 0xFF);
            message[5] = (byte)(Format.BlockFrames >> 8);
            message[6] = (byte)(1 + soloCount);
            int offset = 8;
            offset += 4; // slot 0 = mix
            Buffer.BlockCopy(mix, 0, message, offset, Format.BlockSamples * 4);
            offset += Format.BlockSamples * 4;
            for (int i = 0; i < soloCount; i++)
            {
                int slot = soloSlots[i];
                message[offset] = (byte)slot;
                message[offset + 1] = (byte)(slot >> 8);
                message[offset + 2] = (byte)(slot >> 16);
                message[offset + 3] = (byte)(slot >> 24);
                offset += 4;
                Buffer.BlockCopy(solo[i], 0, message, offset, Format.BlockSamples * 4);
                offset += Format.BlockSamples * 4;
            }
            return message;
        }
    }
}

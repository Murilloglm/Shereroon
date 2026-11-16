using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Threading;

namespace ShareRoomAudio
{
    /// <summary>
    /// Autoteste do isolamento por aplicativo, com áudio de verdade passando pelo Windows. Dois processos tocam
    /// tons diferentes e muito baixos (um faz o papel do jogo, o outro o do chat de voz); o teste liga e desliga
    /// as fontes com a mixagem rodando e mede, na saída do mixer, quais tons estão presentes.
    /// </summary>
    internal static class SelfTest
    {
        private const double GameHz = 440;
        private const double VoiceHz = 1000;
        private const double Amplitude = 0.004;

        /// <summary>Guarda o que o mixer produz, separando o mix das fontes "solo".</summary>
        private sealed class Collector
        {
            private readonly object gate = new object();
            private readonly List<float> mix = new List<float>();
            private readonly Dictionary<int, List<float>> solo = new Dictionary<int, List<float>>();
            public int Messages;
            public int Gaps;
            private uint lastSequence;
            private bool hasSequence;

            public void Add(byte[] message)
            {
                lock (gate)
                {
                    uint sequence = BitConverter.ToUInt32(message, 0);
                    if (hasSequence && sequence != lastSequence + 1)
                    {
                        Gaps++;
                    }
                    lastSequence = sequence;
                    hasSequence = true;
                    Messages++;
                    int streams = message[6];
                    int offset = 8;
                    for (int s = 0; s < streams; s++)
                    {
                        int slot = BitConverter.ToInt32(message, offset);
                        offset += 4;
                        List<float> target;
                        if (slot == 0)
                        {
                            target = mix;
                        }
                        else if (!solo.TryGetValue(slot, out target))
                        {
                            target = new List<float>();
                            solo[slot] = target;
                        }
                        for (int i = 0; i < Format.BlockSamples; i++)
                        {
                            target.Add(BitConverter.ToSingle(message, offset + i * 4));
                        }
                        offset += Format.BlockSamples * 4;
                    }
                }
            }

            public void Clear()
            {
                lock (gate)
                {
                    mix.Clear();
                    solo.Clear();
                    Messages = 0;
                }
            }

            public float[] Mix()
            {
                lock (gate)
                {
                    return mix.ToArray();
                }
            }

            public float[] Solo(int slot)
            {
                lock (gate)
                {
                    List<float> data;
                    return solo.TryGetValue(slot, out data) ? data.ToArray() : new float[0];
                }
            }
        }

        private static int failures;

        private static void Check(string what, bool ok, string detail)
        {
            if (!ok)
            {
                failures++;
            }
            Console.Out.WriteLine((ok ? "  OK      " : "  FALHOU  ") + what + "  [" + detail + "]");
            Console.Out.Flush();
        }

        private static string Ratio(double amplitude)
        {
            return (amplitude / Amplitude * 100).ToString("F1", CultureInfo.InvariantCulture) + "%";
        }

        /// <summary>Deixa a mixagem assentar, grava um trecho e mede os dois tons (em relação ao volume original).</summary>
        private static void Measure(Collector collector, out double game, out double voice)
        {
            Thread.Sleep(350);
            collector.Clear();
            Thread.Sleep(1200);
            float[] samples = collector.Mix();
            int frames = samples.Length / Format.Channels;
            game = Dsp.ToneAmplitude(samples, frames, GameHz);
            voice = Dsp.ToneAmplitude(samples, frames, VoiceHz);
        }

        private static Process StartTone(string exe, double hz)
        {
            ProcessStartInfo info = new ProcessStartInfo(exe,
                "--tone " + hz.ToString(CultureInfo.InvariantCulture) + " --seconds 60 --amplitude " + Amplitude.ToString(CultureInfo.InvariantCulture));
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            return Process.Start(info);
        }

        public static int Run()
        {
            Console.Out.WriteLine("ShareRoom Áudio " + Program.Version + " — autoteste de captura por aplicativo");
            Console.Out.WriteLine("Windows build " + Native.WindowsBuild() + ". Dois tons muito baixos vão tocar por cerca de 20 segundos.");
            string exe = Process.GetCurrentProcess().MainModule.FileName;
            Process game = StartTone(exe, GameHz);
            Process voice = StartTone(exe, VoiceHz);
            Mixer mixer = new Mixer();
            Collector collector = new Collector();
            MixerLevels lastLevels = null;
            try
            {
                Thread.Sleep(1500);
                if (game.HasExited || voice.HasExited)
                {
                    Console.Out.WriteLine("  FALHOU  os tons de teste não tocaram: este PC está sem saída de áudio ativa.");
                    return 2;
                }
                mixer.OnAudio = collector.Add;
                mixer.OnLevels = delegate(MixerLevels levels) { lastLevels = levels; };
                mixer.Streaming = true;
                mixer.Start();
                string gameId = "p" + game.Id;
                string voiceId = "p" + voice.Id;
                double g, v;

                Console.Out.WriteLine("1. Só o jogo ligado (o chat de voz permanece desligado)");
                Source gameSource = mixer.Configure(gameId, (uint)game.Id, "jogo", false, true, 1f, false);
                mixer.Reconcile(ProcessSnapshot.Take());
                Check("o Windows aceitou capturar o processo do jogo", gameSource.State == SourceState.Capturing, gameSource.Error ?? gameSource.State.ToString());
                Measure(collector, out g, out v);
                Check("o som do jogo é transmitido", g > Amplitude * 0.8 && g < Amplitude * 1.2, "jogo " + Ratio(g));
                Check("o chat de voz NÃO vaza", v < Amplitude * 0.02, "voz " + Ratio(v));

                Console.Out.WriteLine("2. Liga o chat de voz com a transmissão rodando");
                long before = collector.Messages;
                mixer.Configure(voiceId, (uint)voice.Id, "voz", false, true, 1f, false);
                mixer.Reconcile(ProcessSnapshot.Take());
                Measure(collector, out g, out v);
                Check("jogo e voz são transmitidos juntos", g > Amplitude * 0.8 && v > Amplitude * 0.8, "jogo " + Ratio(g) + ", voz " + Ratio(v));
                Check("a mixagem não parou ao adicionar a fonte", collector.Gaps == 0 && collector.Messages > 0, "falhas de sequência: " + collector.Gaps);

                Console.Out.WriteLine("3. Desliga o jogo: sobra só o chat de voz");
                mixer.Configure(gameId, 0, null, false, false, null, null);
                mixer.Reconcile(ProcessSnapshot.Take());
                Measure(collector, out g, out v);
                Check("o jogo saiu da transmissão", g < Amplitude * 0.02, "jogo " + Ratio(g));
                Check("o chat de voz continua", v > Amplitude * 0.8, "voz " + Ratio(v));
                Check("a captura do jogo foi realmente encerrada", gameSource.Capture == null && gameSource.State == SourceState.Off, gameSource.State.ToString());

                Console.Out.WriteLine("4. Volume de transmissão independente");
                mixer.Configure(voiceId, 0, null, false, null, 0.5f, null);
                Measure(collector, out g, out v);
                Check("voz a 50% sai com metade da amplitude", v > Amplitude * 0.45 && v < Amplitude * 0.55, "voz " + Ratio(v));
                mixer.Configure(voiceId, 0, null, false, null, 0f, null);
                Measure(collector, out g, out v);
                Check("voz a 0% fica muda", v < Amplitude * 0.01, "voz " + Ratio(v));
                mixer.Configure(voiceId, 0, null, false, null, 1f, null);

                Console.Out.WriteLine("5. Fonte separada para filtros (solo): sai do mix e segue numa faixa própria");
                Source voiceSource = mixer.Configure(voiceId, 0, null, false, null, null, true);
                Measure(collector, out g, out v);
                float[] soloSamples = collector.Solo(voiceSource.Slot);
                double soloVoice = Dsp.ToneAmplitude(soloSamples, soloSamples.Length / Format.Channels, VoiceHz);
                Check("a voz saiu do mix principal", v < Amplitude * 0.02, "voz no mix " + Ratio(v));
                Check("a voz chega inteira na faixa separada", soloVoice > Amplitude * 0.8, "voz na faixa " + Ratio(soloVoice));
                mixer.Configure(voiceId, 0, null, false, null, null, false);

                Console.Out.WriteLine("6. App pai e app filho ligados juntos: nada de áudio duplicado");
                uint self = (uint)Process.GetCurrentProcess().Id;
                Source parent = mixer.Configure("p" + self, self, "pai", false, true, 1f, false);
                mixer.Reconcile(ProcessSnapshot.Take());
                Measure(collector, out g, out v);
                Check("o filho é marcado como coberto pelo pai", voiceSource.State == SourceState.Covered && voiceSource.CoveredBy == parent.Id, voiceSource.State.ToString());
                Check("cada tom aparece uma vez só (sem dobrar)", v > Amplitude * 0.8 && v < Amplitude * 1.2 && g > Amplitude * 0.8 && g < Amplitude * 1.2,
                    "jogo " + Ratio(g) + ", voz " + Ratio(v));
                mixer.DisableAll();

                Console.Out.WriteLine("7. Fonte \"Sistema\": tudo, menos o navegador da sala (aqui, o processo do jogo faz o papel do navegador)");
                mixer.BrowserPid = (uint)game.Id;
                Source system = mixer.Configure("system", 0, "", true, true, 1f, false);
                mixer.Reconcile(ProcessSnapshot.Take());
                Measure(collector, out g, out v);
                Check("o Windows aceitou a captura em modo excluir", system.State == SourceState.Capturing, system.Error ?? system.State.ToString());
                Check("o resto do sistema é capturado", v > Amplitude * 0.7, "voz " + Ratio(v));
                // Tolerância maior: outros sons do PC podem ter energia perto de 440 Hz.
                Check("o \"navegador\" fica de fora (sem eco)", g < Amplitude * 0.25, "jogo " + Ratio(g));
                mixer.DisableAll();
                mixer.BrowserPid = 0;

                Console.Out.WriteLine("8. Relógio e atraso do mixer");
                collector.Clear();
                Thread.Sleep(2000);
                int messages = collector.Messages;
                Check("um bloco de 10 ms a cada 10 ms (≈200 em 2 s)", messages >= 196 && messages <= 204, messages + " blocos");
                Measure(collector, out g, out v);
                Check("com tudo desligado, sai silêncio", g < Amplitude * 0.01 && v < Amplitude * 0.01 && mixer.Snapshot().Count == 0, "jogo " + Ratio(g) + ", voz " + Ratio(v));
                mixer.Configure(voiceId, (uint)voice.Id, "voz", false, true, 1f, false);
                mixer.Reconcile(ProcessSnapshot.Take());
                Thread.Sleep(1500);
                double bufferMs = -1;
                if (lastLevels != null)
                {
                    foreach (KeyValuePair<int, double> entry in lastLevels.BufferMs)
                    {
                        bufferMs = entry.Value;
                    }
                }
                Check("atraso medido dentro do mixer abaixo de 45 ms", bufferMs >= 0 && bufferMs < 45,
                    bufferMs.ToString("F1", CultureInfo.InvariantCulture) + " ms em fila + 10 ms do bloco");

                Console.Out.WriteLine("9. O aplicativo fecha no meio da transmissão");
                Source closing = mixer.Find(voiceId);
                voice.Kill();
                voice.WaitForExit(3000);
                Thread.Sleep(300);
                mixer.Reconcile(ProcessSnapshot.Take());
                collector.Clear();
                Thread.Sleep(500);
                Check("a mixagem segue rodando depois que o app fechou", collector.Messages >= 45, collector.Messages + " blocos em 0,5 s");
                Check("a fonte é marcada como encerrada e a captura é solta", closing.State == SourceState.Ended && closing.Capture == null && !closing.Enabled, closing.State.ToString());
            }
            finally
            {
                mixer.Dispose();
                try
                {
                    if (!game.HasExited)
                    {
                        game.Kill();
                    }
                    if (!voice.HasExited)
                    {
                        voice.Kill();
                    }
                }
                catch (Exception)
                {
                }
            }

            Console.Out.WriteLine(failures == 0 ? "RESULTADO: tudo certo." : "RESULTADO: " + failures + " verificação(ões) falharam.");
            Console.Out.Flush();
            return failures == 0 ? 0 : 1;
        }
    }
}

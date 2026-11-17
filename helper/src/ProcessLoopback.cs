using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Diagnostics;

namespace ShareRoomAudio
{
    /// <summary>Recebe o retorno assíncrono da ativação do dispositivo virtual de loopback.</summary>
    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    internal sealed class ActivationHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        private readonly ManualResetEvent done = new ManualResetEvent(false);
        private IActivateAudioInterfaceAsyncOperation operation;

        public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation completed)
        {
            operation = completed;
            done.Set();
            return 0;
        }

        public IAudioClient Wait(int timeoutMs)
        {
            if (!done.WaitOne(timeoutMs))
            {
                throw new TimeoutException("O Windows não respondeu ao pedido de captura de áudio.");
            }
            int result;
            object instance;
            Native.Check(operation.GetActivateResult(out result, out instance), "GetActivateResult");
            Native.Check(result, "Ativar o loopback do processo");
            return (IAudioClient)instance;
        }
    }

    /// <summary>
    /// Captura o áudio que UM processo (e seus filhos) está tocando, via WASAPI Process Loopback
    /// (Windows 10 2004+ / Windows 11). No modo "excluir", captura tudo MENOS a árvore do processo.
    /// É uma cópia: o que o usuário escuta no PC não é alterado.
    /// </summary>
    internal sealed class ProcessLoopback : IDisposable
    {
        private readonly uint processId;
        private readonly bool exclude;
        private readonly RingBuffer sink;
        private Thread thread;
        private volatile bool stopping;
        private IntPtr stopEvent = IntPtr.Zero;
        private readonly ManualResetEvent started = new ManualResetEvent(false);
        private Exception failure;
        private long framesCaptured;
        private readonly object latencyGate = new object();
        private double latencySumMs;
        private int latencyCount;

        public ProcessLoopback(uint processId, bool exclude, RingBuffer sink)
        {
            this.processId = processId;
            this.exclude = exclude;
            this.sink = sink;
        }

        /// <summary>Total de quadros recebidos do Windows desde o início.</summary>
        /// <summary>
        /// Atraso médio, em ms, entre o instante em que o Windows registrou o primeiro quadro de cada pacote
        /// (relógio QPC, informado pelo próprio WASAPI) e o momento em que este programa o recebeu, desde a
        /// última leitura. -1 quando o Windows não informou o horário.
        /// </summary>
        public double TakeLatencyMs()
        {
            lock (latencyGate)
            {
                double result = latencyCount > 0 ? latencySumMs / latencyCount : -1;
                latencySumMs = 0;
                latencyCount = 0;
                return result;
            }
        }

        private void RecordLatency(ulong qpcPosition)
        {
            if (qpcPosition == 0)
            {
                return;
            }
            // qpcPosition vem em unidades de 100 ns do mesmo relógio que o Stopwatch usa.
            double now100ns = (double)Stopwatch.GetTimestamp() * 10000000.0 / Stopwatch.Frequency;
            double ms = (now100ns - qpcPosition) / 10000.0;
            if (ms < 0 || ms > 2000)
            {
                return;
            }
            lock (latencyGate)
            {
                latencySumMs += ms;
                latencyCount++;
            }
        }

        public long FramesCaptured
        {
            get { return Interlocked.Read(ref framesCaptured); }
        }

        /// <summary>Erro que encerrou a captura depois de iniciada (por exemplo, o processo fechou).</summary>
        public Exception Failure
        {
            get { return failure; }
        }

        public bool Running
        {
            get { return thread != null && thread.IsAlive; }
        }

        /// <summary>Inicia a captura. Lança exceção se o Windows recusar.</summary>
        public void Start()
        {
            stopEvent = Native.CreateEvent(IntPtr.Zero, true, false, null);
            thread = new Thread(Run);
            thread.IsBackground = true;
            thread.Name = "captura-" + processId;
            thread.Priority = ThreadPriority.AboveNormal;
            thread.SetApartmentState(ApartmentState.MTA);
            thread.Start();
            if (!started.WaitOne(8000))
            {
                throw new TimeoutException("A captura do processo " + processId + " não iniciou a tempo.");
            }
            if (failure != null)
            {
                throw failure;
            }
        }

        public void Dispose()
        {
            stopping = true;
            if (stopEvent != IntPtr.Zero)
            {
                Native.SetEvent(stopEvent);
            }
            if (thread != null && thread.IsAlive && thread != Thread.CurrentThread)
            {
                thread.Join(2000);
            }
            if (stopEvent != IntPtr.Zero)
            {
                Native.CloseHandle(stopEvent);
                stopEvent = IntPtr.Zero;
            }
        }

        private static IAudioClient Activate(uint processId, bool exclude)
        {
            // AUDIOCLIENT_ACTIVATION_PARAMS: { ActivationType = PROCESS_LOOPBACK(1), TargetProcessId, ProcessLoopbackMode }
            IntPtr blob = Marshal.AllocHGlobal(12);
            // PROPVARIANT (64 bits): vt aos 0, BLOB.cbSize aos 8, BLOB.pBlobData aos 16.
            IntPtr variant = Marshal.AllocHGlobal(24);
            try
            {
                Marshal.WriteInt32(blob, 0, 1);
                Marshal.WriteInt32(blob, 4, unchecked((int)processId));
                Marshal.WriteInt32(blob, 8, exclude
                    ? Native.PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
                    : Native.PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE);
                for (int offset = 0; offset < 24; offset += 4)
                {
                    Marshal.WriteInt32(variant, offset, 0);
                }
                Marshal.WriteInt16(variant, 0, 65); // VT_BLOB
                Marshal.WriteInt32(variant, 8, 12);
                Marshal.WriteIntPtr(variant, 16, blob);

                ActivationHandler handler = new ActivationHandler();
                IActivateAudioInterfaceAsyncOperation operation;
                Guid iid = Native.IID_IAudioClient;
                Native.Check(
                    Native.ActivateAudioInterfaceAsync(Native.VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, ref iid, variant, handler, out operation),
                    "ActivateAudioInterfaceAsync");
                return handler.Wait(5000);
            }
            finally
            {
                Marshal.FreeHGlobal(variant);
                Marshal.FreeHGlobal(blob);
            }
        }

        private static IntPtr BuildFormat(bool floatSamples)
        {
            // WAVEFORMATEX simples (18 bytes): 48 kHz, estéreo.
            int bits = floatSamples ? 32 : 16;
            int blockAlign = Format.Channels * bits / 8;
            IntPtr format = Marshal.AllocHGlobal(18);
            Marshal.WriteInt16(format, 0, (short)(floatSamples ? 3 : 1)); // IEEE_FLOAT ou PCM
            Marshal.WriteInt16(format, 2, Format.Channels);
            Marshal.WriteInt32(format, 4, Format.SampleRate);
            Marshal.WriteInt32(format, 8, Format.SampleRate * blockAlign);
            Marshal.WriteInt16(format, 12, (short)blockAlign);
            Marshal.WriteInt16(format, 14, (short)bits);
            Marshal.WriteInt16(format, 16, 0);
            return format;
        }

        private void Run()
        {
            IAudioClient client = null;
            IAudioCaptureClient capture = null;
            IntPtr dataEvent = IntPtr.Zero;
            IntPtr format = IntPtr.Zero;
            bool floatSamples = true;
            try
            {
                client = Activate(processId, exclude);
                uint flags = Native.AUDCLNT_STREAMFLAGS_LOOPBACK | Native.AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                    | Native.AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | Native.AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;

                // Pede direto o formato do mixer (float 48 kHz estéreo); se recusado, cai para PCM de 16 bits.
                format = BuildFormat(true);
                int result = client.Initialize(0, flags, 200000, 0, format, IntPtr.Zero);
                if (result < 0)
                {
                    Marshal.FreeHGlobal(format);
                    Marshal.ReleaseComObject(client);
                    client = Activate(processId, exclude);
                    floatSamples = false;
                    format = BuildFormat(false);
                    Native.Check(client.Initialize(0, flags, 200000, 0, format, IntPtr.Zero), "IAudioClient.Initialize");
                }

                dataEvent = Native.CreateEvent(IntPtr.Zero, false, false, null);
                Native.Check(client.SetEventHandle(dataEvent), "SetEventHandle");
                object service;
                Guid iid = Native.IID_IAudioCaptureClient;
                Native.Check(client.GetService(ref iid, out service), "GetService(IAudioCaptureClient)");
                capture = (IAudioCaptureClient)service;
                Native.Check(client.Start(), "IAudioClient.Start");
            }
            catch (Exception error)
            {
                failure = error;
                started.Set();
                Release(capture, client, dataEvent, format);
                return;
            }

            started.Set();
            float[] block = new float[Format.BlockSamples * 8];
            short[] pcm = floatSamples ? null : new short[Format.BlockSamples * 8];
            try
            {
                while (!stopping)
                {
                    Native.WaitForSingleObject(dataEvent, 100);
                    if (stopping)
                    {
                        break;
                    }
                    uint packet;
                    Native.Check(capture.GetNextPacketSize(out packet), "GetNextPacketSize");
                    while (packet > 0 && !stopping)
                    {
                        IntPtr data;
                        uint frames;
                        uint bufferFlags;
                        ulong devicePosition;
                        ulong qpcPosition;
                        Native.Check(capture.GetBuffer(out data, out frames, out bufferFlags, out devicePosition, out qpcPosition), "GetBuffer");
                        RecordLatency(qpcPosition);
                        int samples = (int)frames * Format.Channels;
                        if (samples > block.Length)
                        {
                            block = new float[samples];
                            if (pcm != null)
                            {
                                pcm = new short[samples];
                            }
                        }
                        if ((bufferFlags & Native.AUDCLNT_BUFFERFLAGS_SILENT) != 0)
                        {
                            Array.Clear(block, 0, samples);
                        }
                        else if (floatSamples)
                        {
                            Marshal.Copy(data, block, 0, samples);
                        }
                        else
                        {
                            Marshal.Copy(data, pcm, 0, samples);
                            for (int i = 0; i < samples; i++)
                            {
                                block[i] = pcm[i] / 32768f;
                            }
                        }
                        Native.Check(capture.ReleaseBuffer(frames), "ReleaseBuffer");
                        sink.Write(block, samples);
                        Interlocked.Add(ref framesCaptured, frames);
                        Native.Check(capture.GetNextPacketSize(out packet), "GetNextPacketSize");
                    }
                }
            }
            catch (Exception error)
            {
                // Tipicamente o processo capturado encerrou ou o dispositivo de áudio mudou.
                failure = error;
            }
            finally
            {
                try
                {
                    client.Stop();
                }
                catch (Exception)
                {
                }
                Release(capture, client, dataEvent, format);
            }
        }

        private static void Release(IAudioCaptureClient capture, IAudioClient client, IntPtr dataEvent, IntPtr format)
        {
            if (capture != null)
            {
                Marshal.ReleaseComObject(capture);
            }
            if (client != null)
            {
                Marshal.ReleaseComObject(client);
            }
            if (dataEvent != IntPtr.Zero)
            {
                Native.CloseHandle(dataEvent);
            }
            if (format != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(format);
            }
        }
    }
}

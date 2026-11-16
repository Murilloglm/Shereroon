using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace ShareRoomAudio
{
    /// <summary>
    /// Toca um tom senoidal (ou um ruído de ventilador) na saída padrão. Existe só para os testes: cada
    /// instância é um "aplicativo" de verdade, com seu próprio processo e sua própria sessão de áudio no Windows.
    /// </summary>
    internal static class TonePlayer
    {
        public static int Run(double frequency, double seconds, double amplitude, bool noise)
        {
            IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            int found = enumerator.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out device);
            if (found < 0)
            {
                Console.Error.WriteLine("Nenhuma saída de áudio ativa (0x" + found.ToString("X8") + ").");
                return 2;
            }

            object instance;
            Guid iid = Native.IID_IAudioClient;
            Native.Check(device.Activate(ref iid, Native.CLSCTX_ALL, IntPtr.Zero, out instance), "IMMDevice.Activate");
            IAudioClient client = (IAudioClient)instance;

            IntPtr mix;
            Native.Check(client.GetMixFormat(out mix), "GetMixFormat");
            int tag = Marshal.ReadInt16(mix, 0) & 0xFFFF;
            int channels = Marshal.ReadInt16(mix, 2);
            int rate = Marshal.ReadInt32(mix, 4);
            int bits = Marshal.ReadInt16(mix, 14);
            // WAVE_FORMAT_EXTENSIBLE guarda o subformato num GUID aos 24 bytes; o primeiro campo é 3 para ponto flutuante.
            bool isFloat = tag == 3 || (tag == 0xFFFE && Marshal.ReadInt32(mix, 24) == 3);
            if (!isFloat && bits != 16)
            {
                Console.Error.WriteLine("Formato de saída não suportado pelo tom de teste (" + bits + " bits).");
                return 2;
            }

            Native.Check(client.Initialize(0, 0, 1000000, 0, mix, IntPtr.Zero), "IAudioClient.Initialize");
            Native.CoTaskMemFree(mix);
            uint bufferFrames;
            Native.Check(client.GetBufferSize(out bufferFrames), "GetBufferSize");
            object service;
            Guid renderIid = Native.IID_IAudioRenderClient;
            Native.Check(client.GetService(ref renderIid, out service), "GetService(IAudioRenderClient)");
            IAudioRenderClient render = (IAudioRenderClient)service;
            Native.Check(client.Start(), "IAudioClient.Start");

            Console.Out.WriteLine((noise ? "ruído" : "tom " + frequency + " Hz") + " pid " + Process.GetCurrentProcess().Id);
            Console.Out.Flush();

            float[] floats = new float[bufferFrames * channels];
            short[] shorts = isFloat ? null : new short[bufferFrames * channels];
            double phase = 0;
            double step = 2.0 * Math.PI * frequency / rate;
            // Ruído de ventilador: ruído branco passado por um passa-baixas de ~1 kHz, com o mesmo valor eficaz de um tom.
            uint seed = 22222;
            double low = 0;
            double smoothing = 1.0 - Math.Exp(-2.0 * Math.PI * 1000.0 / rate);
            double noiseGain = amplitude * 0.7071 / (0.5774 * Math.Sqrt(smoothing / (2.0 - smoothing)));
            Stopwatch clock = Stopwatch.StartNew();
            while (clock.Elapsed.TotalSeconds < seconds)
            {
                uint padding;
                Native.Check(client.GetCurrentPadding(out padding), "GetCurrentPadding");
                uint available = bufferFrames - padding;
                if (available > 0)
                {
                    IntPtr data;
                    Native.Check(render.GetBuffer(available, out data), "IAudioRenderClient.GetBuffer");
                    for (int frame = 0; frame < available; frame++)
                    {
                        float sample;
                        if (noise)
                        {
                            seed = unchecked(seed * 1664525u + 1013904223u);
                            low += smoothing * (((seed >> 8) / 8388608.0 - 1.0) - low);
                            sample = (float)(low * noiseGain);
                        }
                        else
                        {
                            sample = (float)(Math.Sin(phase) * amplitude);
                        }
                        phase += step;
                        if (phase > 2.0 * Math.PI)
                        {
                            phase -= 2.0 * Math.PI;
                        }
                        for (int channel = 0; channel < channels; channel++)
                        {
                            if (isFloat)
                            {
                                floats[frame * channels + channel] = sample;
                            }
                            else
                            {
                                shorts[frame * channels + channel] = (short)(sample * 32767);
                            }
                        }
                    }
                    if (isFloat)
                    {
                        Marshal.Copy(floats, 0, data, (int)available * channels);
                    }
                    else
                    {
                        Marshal.Copy(shorts, 0, data, (int)available * channels);
                    }
                    Native.Check(render.ReleaseBuffer(available, 0), "IAudioRenderClient.ReleaseBuffer");
                }
                Thread.Sleep(5);
            }
            client.Stop();
            return 0;
        }
    }
}

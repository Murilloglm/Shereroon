using System;

namespace ShareRoomAudio
{
    /// <summary>Formato único de todo o caminho de áudio: 48 kHz, estéreo, ponto flutuante de 32 bits.</summary>
    internal static class Format
    {
        public const int SampleRate = 48000;
        public const int Channels = 2;
        /// <summary>Quadros por bloco: 10 ms.</summary>
        public const int BlockFrames = 480;
        public const int BlockSamples = BlockFrames * Channels;
    }

    /// <summary>
    /// Fila circular de amostras estéreo intercaladas. Um lado escreve (thread de captura), o outro lê
    /// (thread do mixer); o cadeado é barato porque cada lado passa por aqui cerca de 100 vezes por segundo.
    /// </summary>
    internal sealed class RingBuffer
    {
        private readonly float[] data;
        private readonly object gate = new object();
        private int readIndex;
        private int count;

        public RingBuffer(int capacityFrames)
        {
            data = new float[capacityFrames * Format.Channels];
        }

        /// <summary>Quadros disponíveis para leitura.</summary>
        public int AvailableFrames
        {
            get { lock (gate) { return count / Format.Channels; } }
        }

        /// <summary>Escreve amostras intercaladas. Se a fila encher, descarta as mais antigas.</summary>
        public void Write(float[] source, int sampleCount)
        {
            lock (gate)
            {
                if (sampleCount > data.Length)
                {
                    sampleCount = data.Length;
                }
                int overflow = count + sampleCount - data.Length;
                if (overflow > 0)
                {
                    readIndex = (readIndex + overflow) % data.Length;
                    count -= overflow;
                }
                int writeIndex = (readIndex + count) % data.Length;
                int first = Math.Min(sampleCount, data.Length - writeIndex);
                Array.Copy(source, 0, data, writeIndex, first);
                if (first < sampleCount)
                {
                    Array.Copy(source, first, data, 0, sampleCount - first);
                }
                count += sampleCount;
            }
        }

        /// <summary>Lê até `frames` quadros. Devolve quantos leu de fato.</summary>
        public int Read(float[] target, int frames)
        {
            lock (gate)
            {
                int samples = Math.Min(frames * Format.Channels, count);
                samples -= samples % Format.Channels;
                int first = Math.Min(samples, data.Length - readIndex);
                Array.Copy(data, readIndex, target, 0, first);
                if (first < samples)
                {
                    Array.Copy(data, 0, target, first, samples - first);
                }
                readIndex = (readIndex + samples) % data.Length;
                count -= samples;
                return samples / Format.Channels;
            }
        }

        /// <summary>Descarta os quadros mais antigos.</summary>
        public void Drop(int frames)
        {
            lock (gate)
            {
                int samples = Math.Min(frames * Format.Channels, count);
                readIndex = (readIndex + samples) % data.Length;
                count -= samples;
            }
        }

        public void Clear()
        {
            lock (gate)
            {
                readIndex = 0;
                count = 0;
            }
        }
    }

    internal static class Dsp
    {
        /// <summary>
        /// Reamostra `inputFrames` quadros para exatamente `outputFrames` por interpolação linear.
        /// Usado para corrigir um quadro a mais ou a menos por bloco (deriva entre relógios), o que é inaudível.
        /// </summary>
        public static void Resample(float[] input, int inputFrames, float[] output, int outputFrames)
        {
            if (inputFrames == outputFrames)
            {
                Array.Copy(input, output, outputFrames * Format.Channels);
                return;
            }
            double step = (double)(inputFrames - 1) / (outputFrames - 1);
            for (int frame = 0; frame < outputFrames; frame++)
            {
                double position = frame * step;
                int index = (int)position;
                if (index >= inputFrames - 1)
                {
                    index = inputFrames - 2;
                }
                float weight = (float)(position - index);
                for (int channel = 0; channel < Format.Channels; channel++)
                {
                    float a = input[index * Format.Channels + channel];
                    float b = input[(index + 1) * Format.Channels + channel];
                    output[frame * Format.Channels + channel] = a + (b - a) * weight;
                }
            }
        }

        /// <summary>Maior valor absoluto no bloco.</summary>
        public static float Peak(float[] samples, int count)
        {
            float peak = 0f;
            for (int i = 0; i < count; i++)
            {
                float magnitude = samples[i] < 0 ? -samples[i] : samples[i];
                if (magnitude > peak)
                {
                    peak = magnitude;
                }
            }
            return peak;
        }

        /// <summary>
        /// Amplitude de uma frequência específica no sinal (algoritmo de Goertzel), usando o canal esquerdo.
        /// Serve aos testes: diz se o tom de um aplicativo está ou não presente na mixagem.
        /// </summary>
        public static double ToneAmplitude(float[] interleaved, int frames, double frequency)
        {
            double omega = 2.0 * Math.PI * frequency / Format.SampleRate;
            double coefficient = 2.0 * Math.Cos(omega);
            double s1 = 0, s2 = 0;
            for (int frame = 0; frame < frames; frame++)
            {
                double s0 = interleaved[frame * Format.Channels] + coefficient * s1 - s2;
                s2 = s1;
                s1 = s0;
            }
            double power = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
            if (power < 0)
            {
                power = 0;
            }
            return 2.0 * Math.Sqrt(power) / frames;
        }
    }
}

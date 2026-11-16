using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace ShareRoomAudio
{
    /// <summary>
    /// Uma conexão WebSocket (RFC 6455) do lado do servidor, só o necessário: mensagens de texto e binárias
    /// sem fragmentação, ping/pong e fechamento. O servidor escuta apenas em 127.0.0.1.
    /// </summary>
    internal sealed class WebSocketConnection
    {
        private const int MaxMessageBytes = 64 * 1024;
        private readonly Socket socket;
        private readonly NetworkStream stream;
        private readonly object sendGate = new object();
        private volatile bool closed;

        public string Origin;
        public string Host;
        public string Path;
        public int RemotePort;

        public WebSocketConnection(Socket socket)
        {
            this.socket = socket;
            socket.NoDelay = true;
            socket.SendTimeout = 500;
            stream = new NetworkStream(socket, false);
            RemotePort = ((IPEndPoint)socket.RemoteEndPoint).Port;
        }

        public bool Closed
        {
            get { return closed; }
        }

        /// <summary>Lê o pedido HTTP e responde com a troca para WebSocket. Devolve false se não for um pedido válido.</summary>
        public bool Handshake()
        {
            socket.ReceiveTimeout = 5000;
            byte[] buffer = new byte[8192];
            int length = 0;
            int end = -1;
            while (end < 0 && length < buffer.Length)
            {
                int read;
                try
                {
                    read = stream.Read(buffer, length, buffer.Length - length);
                }
                catch (IOException)
                {
                    return false;
                }
                if (read <= 0)
                {
                    return false;
                }
                length += read;
                for (int i = 3; i < length; i++)
                {
                    if (buffer[i - 3] == 13 && buffer[i - 2] == 10 && buffer[i - 1] == 13 && buffer[i] == 10)
                    {
                        end = i + 1;
                        break;
                    }
                }
            }
            if (end < 0)
            {
                return false;
            }

            string[] lines = Encoding.ASCII.GetString(buffer, 0, end).Split(new string[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
            string[] request = lines.Length > 0 ? lines[0].Split(' ') : new string[0];
            if (request.Length < 3 || request[0] != "GET")
            {
                Reject("405 Method Not Allowed");
                return false;
            }
            Path = request[1];
            Dictionary<string, string> headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 1; i < lines.Length; i++)
            {
                int colon = lines[i].IndexOf(':');
                if (colon > 0)
                {
                    headers[lines[i].Substring(0, colon).Trim()] = lines[i].Substring(colon + 1).Trim();
                }
            }

            string upgrade;
            string key;
            if (!headers.TryGetValue("Upgrade", out upgrade) || !string.Equals(upgrade, "websocket", StringComparison.OrdinalIgnoreCase)
                || !headers.TryGetValue("Sec-WebSocket-Key", out key))
            {
                // Alguém abriu o endereço no navegador: explica o que é, em vez de ficar mudo.
                Reject("426 Upgrade Required", "ShareRoom Audio: este endereco atende apenas o site do ShareRoom, por WebSocket.");
                return false;
            }
            headers.TryGetValue("Origin", out Origin);
            headers.TryGetValue("Host", out Host);

            string accept;
            using (SHA1 sha = SHA1.Create())
            {
                accept = Convert.ToBase64String(sha.ComputeHash(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            }
            byte[] response = Encoding.ASCII.GetBytes(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
            stream.Write(response, 0, response.Length);
            socket.ReceiveTimeout = 0;
            return true;
        }

        private void Reject(string status, string body = "")
        {
            try
            {
                byte[] payload = Encoding.ASCII.GetBytes(
                    "HTTP/1.1 " + status + "\r\nContent-Type: text/plain\r\nContent-Length: " + body.Length + "\r\nConnection: close\r\n\r\n" + body);
                stream.Write(payload, 0, payload.Length);
            }
            catch (Exception)
            {
            }
            Abort();
        }

        private bool ReadExact(byte[] buffer, int count)
        {
            int offset = 0;
            while (offset < count)
            {
                int read;
                try
                {
                    read = stream.Read(buffer, offset, count - offset);
                }
                catch (Exception)
                {
                    return false;
                }
                if (read <= 0)
                {
                    return false;
                }
                offset += read;
            }
            return true;
        }

        /// <summary>Bloqueia até chegar uma mensagem de texto. Devolve null quando a conexão termina.</summary>
        public string ReceiveText()
        {
            byte[] header = new byte[8];
            while (!closed)
            {
                if (!ReadExact(header, 2))
                {
                    break;
                }
                int opcode = header[0] & 0x0F;
                bool final = (header[0] & 0x80) != 0;
                bool masked = (header[1] & 0x80) != 0;
                long length = header[1] & 0x7F;
                if (length == 126)
                {
                    if (!ReadExact(header, 2))
                    {
                        break;
                    }
                    length = (header[0] << 8) | header[1];
                }
                else if (length == 127)
                {
                    if (!ReadExact(header, 8))
                    {
                        break;
                    }
                    length = 0;
                    for (int i = 0; i < 8; i++)
                    {
                        length = (length << 8) | header[i];
                    }
                }
                // Navegadores sempre mascaram e não fragmentam mensagens pequenas; o resto é recusado.
                if (!masked || !final || length > MaxMessageBytes)
                {
                    Close(1009, "mensagem invalida");
                    break;
                }
                byte[] mask = new byte[4];
                byte[] payload = new byte[length];
                if (!ReadExact(mask, 4) || !ReadExact(payload, (int)length))
                {
                    break;
                }
                for (int i = 0; i < payload.Length; i++)
                {
                    payload[i] ^= mask[i & 3];
                }

                if (opcode == 1)
                {
                    return Encoding.UTF8.GetString(payload);
                }
                if (opcode == 8)
                {
                    Close(1000, "");
                    break;
                }
                if (opcode == 9)
                {
                    Send(10, payload);
                }
            }
            Abort();
            return null;
        }

        public bool SendText(string text)
        {
            return Send(1, Encoding.UTF8.GetBytes(text));
        }

        public bool SendBinary(byte[] payload)
        {
            return Send(2, payload);
        }

        private bool Send(int opcode, byte[] payload)
        {
            if (closed)
            {
                return false;
            }
            byte[] frame;
            int offset;
            if (payload.Length < 126)
            {
                frame = new byte[2 + payload.Length];
                frame[1] = (byte)payload.Length;
                offset = 2;
            }
            else if (payload.Length <= 0xFFFF)
            {
                frame = new byte[4 + payload.Length];
                frame[1] = 126;
                frame[2] = (byte)(payload.Length >> 8);
                frame[3] = (byte)payload.Length;
                offset = 4;
            }
            else
            {
                frame = new byte[10 + payload.Length];
                frame[1] = 127;
                long length = payload.Length;
                for (int i = 0; i < 8; i++)
                {
                    frame[9 - i] = (byte)(length >> (8 * i));
                }
                offset = 10;
            }
            frame[0] = (byte)(0x80 | opcode);
            Buffer.BlockCopy(payload, 0, frame, offset, payload.Length);
            lock (sendGate)
            {
                try
                {
                    stream.Write(frame, 0, frame.Length);
                    return true;
                }
                catch (Exception)
                {
                    // O site travou ou fechou: sem fila infinita de áudio atrasado.
                    Abort();
                    return false;
                }
            }
        }

        public void Close(int code, string reason)
        {
            if (closed)
            {
                return;
            }
            byte[] text = Encoding.UTF8.GetBytes(reason ?? "");
            byte[] payload = new byte[2 + text.Length];
            payload[0] = (byte)(code >> 8);
            payload[1] = (byte)code;
            Buffer.BlockCopy(text, 0, payload, 2, text.Length);
            Send(8, payload);
            Abort();
        }

        public void Abort()
        {
            closed = true;
            try
            {
                socket.Close();
            }
            catch (Exception)
            {
            }
        }

        /// <summary>
        /// Descobre qual processo está do outro lado desta conexão local, pela tabela TCP do Windows.
        /// Serve para identificar o navegador que está com a sala aberta e nunca capturá-lo.
        /// </summary>
        public static uint OwnerOfLocalPort(int clientPort, int serverPort)
        {
            int size = 0;
            Native.GetExtendedTcpTable(IntPtr.Zero, ref size, false, Native.AF_INET, Native.TCP_TABLE_OWNER_PID_CONNECTIONS, 0);
            IntPtr table = Marshal.AllocHGlobal(size + 4096);
            try
            {
                size += 4096;
                if (Native.GetExtendedTcpTable(table, ref size, false, Native.AF_INET, Native.TCP_TABLE_OWNER_PID_CONNECTIONS, 0) != 0)
                {
                    return 0;
                }
                int rows = Marshal.ReadInt32(table, 0);
                for (int i = 0; i < rows; i++)
                {
                    // MIB_TCPROW_OWNER_PID: estado, end. local, porta local, end. remoto, porta remota, pid (4 bytes cada).
                    int row = 4 + i * 24;
                    int localPort = ((Marshal.ReadByte(table, row + 8) << 8) | Marshal.ReadByte(table, row + 9));
                    int remotePort = ((Marshal.ReadByte(table, row + 16) << 8) | Marshal.ReadByte(table, row + 17));
                    if (localPort == clientPort && remotePort == serverPort)
                    {
                        return unchecked((uint)Marshal.ReadInt32(table, row + 20));
                    }
                }
            }
            finally
            {
                Marshal.FreeHGlobal(table);
            }
            return 0;
        }
    }
}

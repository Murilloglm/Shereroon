using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace ShareRoomAudio
{
    /// <summary>
    /// Atende o site do ShareRoom por WebSocket em 127.0.0.1. Regras de segurança:
    ///  - só escuta na própria máquina (nunca na rede);
    ///  - só conversa com sites que o usuário autorizou numa janela do próprio auxiliar;
    ///  - só captura os aplicativos que o site pedir, e para tudo quando o site desconecta;
    ///  - nunca captura o navegador que está com a sala aberta (seria eco).
    /// </summary>
    internal sealed class Server : IDisposable
    {
        private readonly int port;
        private readonly Config config;
        private readonly Mixer mixer;
        private readonly bool quiet;
        private readonly bool prompt;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly object sessionGate = new object();
        private TcpListener listener;
        private Thread acceptThread;
        private Thread scanThread;
        private volatile bool stopping;
        private WebSocketConnection active;
        private string lastAppsJson = "";
        private string lastSourcesJson = "";
        private List<AppInfo> lastApps = new List<AppInfo>();
        private readonly AutoResetEvent scanNow = new AutoResetEvent(false);

        /// <summary>Site conectado no momento (para a bandeja mostrar), ou null.</summary>
        public string ConnectedOrigin;

        public Server(int port, Config config, Mixer mixer, bool quiet, bool prompt)
        {
            this.prompt = prompt;
            this.port = port;
            this.config = config;
            this.mixer = mixer;
            this.quiet = quiet;
            mixer.OnAudio = delegate(byte[] message)
            {
                WebSocketConnection connection = active;
                if (connection != null)
                {
                    connection.SendBinary(message);
                }
            };
            mixer.OnLevels = SendLevels;
            mixer.OnSourcesChanged = delegate { scanNow.Set(); };
        }

        public void Start()
        {
            // Loopback apenas: outras máquinas da rede não alcançam esta porta.
            listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start(4);
            acceptThread = new Thread(AcceptLoop);
            acceptThread.IsBackground = true;
            acceptThread.Name = "aceitar";
            acceptThread.Start();
            scanThread = new Thread(ScanLoop);
            scanThread.IsBackground = true;
            scanThread.Name = "catalogo";
            scanThread.SetApartmentState(ApartmentState.MTA);
            scanThread.Start();
        }

        public void Dispose()
        {
            stopping = true;
            scanNow.Set();
            try
            {
                listener.Stop();
            }
            catch (Exception)
            {
            }
            WebSocketConnection connection = active;
            if (connection != null)
            {
                connection.Close(1001, "auxiliar encerrado");
            }
        }

        private void Log(string message)
        {
            if (!quiet)
            {
                Console.Out.WriteLine(DateTime.Now.ToString("HH:mm:ss") + " " + message);
                Console.Out.Flush();
            }
        }

        private void AcceptLoop()
        {
            while (!stopping)
            {
                Socket socket;
                try
                {
                    socket = listener.AcceptSocket();
                }
                catch (Exception)
                {
                    break;
                }
                Thread thread = new Thread(delegate() { Serve(socket); });
                thread.IsBackground = true;
                thread.Name = "sessao";
                thread.SetApartmentState(ApartmentState.MTA);
                thread.Start();
            }
        }

        private void Serve(Socket socket)
        {
            WebSocketConnection connection = new WebSocketConnection(socket);
            try
            {
                if (!connection.Handshake())
                {
                    return;
                }
                string origin = Config.NormalizeOrigin(connection.Origin);
                if (origin == null || !IsLoopbackHost(connection.Host))
                {
                    // Sem origem de navegador, ou chegou por um nome que não é desta máquina (DNS rebinding).
                    connection.Close(4400, "origem invalida");
                    return;
                }
                if (!Authorize(connection, origin))
                {
                    Send(connection, Message("denied"));
                    connection.Close(4403, "site nao autorizado");
                    Log("recusado: " + origin);
                    return;
                }

                ProcessSnapshot snapshot = ProcessSnapshot.Take();
                uint peer = WebSocketConnection.OwnerOfLocalPort(connection.RemotePort, port);
                uint browser = peer != 0 ? snapshot.RootOf(peer) : 0;

                lock (sessionGate)
                {
                    // Uma sala por vez: a aba nova assume, a anterior é avisada.
                    WebSocketConnection previous = active;
                    if (previous != null)
                    {
                        previous.Close(4001, "outra aba assumiu o mixer");
                    }
                    mixer.Streaming = false;
                    mixer.DisableAll();
                    mixer.BrowserPid = browser;
                    active = connection;
                    ConnectedOrigin = origin;
                    lastAppsJson = "";
                    lastSourcesJson = "";
                }
                Log("conectado: " + origin + " (navegador pid " + browser + ")");

                Dictionary<string, object> welcome = Message("welcome");
                welcome["v"] = 1;
                welcome["version"] = Program.Version;
                welcome["sampleRate"] = Format.SampleRate;
                welcome["channels"] = Format.Channels;
                welcome["frames"] = Format.BlockFrames;
                welcome["build"] = Native.WindowsBuild();
                Dictionary<string, object> browserInfo = new Dictionary<string, object>();
                browserInfo["pid"] = browser;
                browserInfo["exe"] = snapshot.ExeOf(browser);
                welcome["browser"] = browserInfo;
                Send(connection, welcome);
                scanNow.Set();

                string text;
                while ((text = connection.ReceiveText()) != null)
                {
                    Dictionary<string, object> request = null;
                    try
                    {
                        request = json.Deserialize<Dictionary<string, object>>(text);
                        Handle(connection, request);
                    }
                    catch (Exception error)
                    {
                        // Devolve o erro junto com a fonte a que ele se refere, para o site desmarcá-la.
                        Dictionary<string, object> failure = Message("error");
                        failure["message"] = error.Message;
                        failure["id"] = request != null && request.ContainsKey("id") ? request["id"] as string : null;
                        Send(connection, failure);
                    }
                }
            }
            catch (Exception error)
            {
                Log("erro na sessão: " + error.Message);
            }
            finally
            {
                connection.Abort();
                bool wasActive = false;
                lock (sessionGate)
                {
                    if (active == connection)
                    {
                        wasActive = true;
                        active = null;
                        ConnectedOrigin = null;
                        // O site saiu: nenhuma captura continua rodando sem ele.
                        mixer.Streaming = false;
                        mixer.DisableAll();
                        mixer.BrowserPid = 0;
                    }
                }
                if (wasActive)
                {
                    Log("desconectado");
                }
            }
        }

        private static bool IsLoopbackHost(string host)
        {
            if (string.IsNullOrEmpty(host))
            {
                return false;
            }
            int colon = host.LastIndexOf(':');
            string name = colon > 0 && host.IndexOf(']') < colon ? host.Substring(0, colon) : host;
            return name == "127.0.0.1" || string.Equals(name, "localhost", StringComparison.OrdinalIgnoreCase) || name == "[::1]";
        }

        private bool Authorize(WebSocketConnection connection, string origin)
        {
            if (config.IsAllowed(origin))
            {
                return true;
            }
            if (!prompt)
            {
                return false;
            }
            Send(connection, Message("pending"));
            // A pergunta aparece numa janela do Windows, fora do alcance de qualquer página.
            int answer = Native.MessageBoxW(
                IntPtr.Zero,
                "O site abaixo quer usar o ShareRoom Áudio:\n\n    " + origin + "\n\n"
                + "Se você permitir, esse site poderá capturar o som dos aplicativos que VOCÊ marcar no mixer dele "
                + "e transmitir para a sala. Nada é capturado antes de você escolher os aplicativos.\n\n"
                + "Permitir este site?",
                "ShareRoom Áudio — autorizar site",
                Native.MB_YESNO | Native.MB_ICONQUESTION | Native.MB_DEFBUTTON2 | Native.MB_SETFOREGROUND | Native.MB_TOPMOST);
            if (answer != Native.IDYES)
            {
                return false;
            }
            config.Allow(origin);
            return true;
        }

        private static Dictionary<string, object> Message(string type)
        {
            Dictionary<string, object> message = new Dictionary<string, object>();
            message["t"] = type;
            return message;
        }

        private void Send(WebSocketConnection connection, Dictionary<string, object> message)
        {
            connection.SendText(json.Serialize(message));
        }

        private static bool? Bool(Dictionary<string, object> message, string key)
        {
            object value;
            if (message.TryGetValue(key, out value) && value is bool)
            {
                return (bool)value;
            }
            return null;
        }

        private static float? Float(Dictionary<string, object> message, string key)
        {
            object value;
            if (message.TryGetValue(key, out value) && value != null && !(value is bool) && !(value is string))
            {
                return Convert.ToSingle(value, CultureInfo.InvariantCulture);
            }
            return null;
        }

        private void Handle(WebSocketConnection connection, Dictionary<string, object> message)
        {
            object typeValue;
            if (message == null || !message.TryGetValue("t", out typeValue))
            {
                return;
            }
            string type = typeValue as string;

            if (type == "apps")
            {
                lastAppsJson = "";
                scanNow.Set();
            }
            else if (type == "stream")
            {
                mixer.Streaming = Bool(message, "on") == true;
            }
            else if (type == "reset")
            {
                mixer.DisableAll();
                lastSourcesJson = "";
                scanNow.Set();
            }
            else if (type == "icon")
            {
                string exe = message.ContainsKey("exe") ? message["exe"] as string : null;
                Dictionary<string, object> reply = Message("icon");
                reply["exe"] = exe;
                reply["png"] = null;
                foreach (AppInfo app in lastApps)
                {
                    if (string.Equals(app.Exe, exe, StringComparison.OrdinalIgnoreCase))
                    {
                        reply["png"] = AppCatalog.IconPng(app.Path);
                        break;
                    }
                }
                Send(connection, reply);
            }
            else if (type == "source")
            {
                ConfigureSource(message);
                scanNow.Set();
            }
        }

        private void ConfigureSource(Dictionary<string, object> message)
        {
            string id = message.ContainsKey("id") ? message["id"] as string : null;
            if (string.IsNullOrEmpty(id))
            {
                throw new InvalidOperationException("Fonte sem identificador.");
            }
            bool? enabled = Bool(message, "enabled");
            float? volume = Float(message, "volume");
            bool? solo = Bool(message, "solo");

            if (id == "system")
            {
                mixer.Configure(id, 0, "", true, enabled, volume, solo);
            }
            else
            {
                // Só aceita aplicativos que estão no catálogo que o site acabou de receber.
                AppInfo found = null;
                foreach (AppInfo app in lastApps)
                {
                    if ("p" + app.Pid == id)
                    {
                        found = app;
                        break;
                    }
                }
                Source existing = mixer.Find(id);
                if (found == null && existing == null)
                {
                    throw new InvalidOperationException("Esse aplicativo não está mais aberto.");
                }
                uint pid = found != null ? found.Pid : existing.Pid;
                if (enabled == true && mixer.BrowserPid != 0 && pid == mixer.BrowserPid)
                {
                    throw new InvalidOperationException(
                        "Este é o navegador que está com a sala aberta. Capturá-lo devolveria para a sala o som que vem dela (eco).");
                }
                mixer.Configure(id, pid, found != null ? found.Exe : existing.Exe, false, enabled, volume, solo);
            }
            mixer.Reconcile(ProcessSnapshot.Take());
        }

        /// <summary>Mantém o site a par dos aplicativos abertos e do estado das fontes. Só envia quando algo muda.</summary>
        private void ScanLoop()
        {
            while (!stopping)
            {
                scanNow.WaitOne(1500);
                WebSocketConnection connection = active;
                if (stopping || connection == null || connection.Closed)
                {
                    continue;
                }
                try
                {
                    ProcessSnapshot snapshot = ProcessSnapshot.Take();
                    List<AppInfo> apps = AppCatalog.Scan(snapshot);
                    lastApps = apps;

                    // Um app marcado que fechou e abriu de novo tem outro processo; quem religa é o site, pelo nome.
                    mixer.Reconcile(snapshot);

                    ArrayList appList = new ArrayList();
                    foreach (AppInfo app in apps)
                    {
                        Dictionary<string, object> item = new Dictionary<string, object>();
                        item["id"] = "p" + app.Pid;
                        item["pid"] = app.Pid;
                        item["exe"] = app.Exe;
                        item["name"] = app.Name;
                        item["hasSession"] = app.HasSession;
                        item["playing"] = app.Playing;
                        item["browserHost"] = mixer.BrowserPid != 0 && app.Pid == mixer.BrowserPid;
                        appList.Add(item);
                    }
                    Dictionary<string, object> appsMessage = Message("apps");
                    appsMessage["apps"] = appList;
                    string appsJson = json.Serialize(appsMessage);
                    if (appsJson != lastAppsJson)
                    {
                        lastAppsJson = appsJson;
                        connection.SendText(appsJson);
                    }

                    ArrayList sourceList = new ArrayList();
                    foreach (Source source in mixer.Snapshot())
                    {
                        Dictionary<string, object> item = new Dictionary<string, object>();
                        item["id"] = source.Id;
                        item["slot"] = source.Slot;
                        item["exe"] = source.Exe;
                        item["enabled"] = source.Enabled;
                        item["volume"] = source.Volume;
                        item["solo"] = source.Solo;
                        item["state"] = StateName(source.State);
                        item["coveredBy"] = source.CoveredBy;
                        item["error"] = source.Error;
                        sourceList.Add(item);
                    }
                    Dictionary<string, object> sourcesMessage = Message("sources");
                    sourcesMessage["sources"] = sourceList;
                    string sourcesJson = json.Serialize(sourcesMessage);
                    if (sourcesJson != lastSourcesJson)
                    {
                        lastSourcesJson = sourcesJson;
                        connection.SendText(sourcesJson);
                    }
                }
                catch (Exception error)
                {
                    Log("erro ao listar aplicativos: " + error.Message);
                }
            }
        }

        private static string StateName(SourceState state)
        {
            switch (state)
            {
                case SourceState.Capturing: return "capturing";
                case SourceState.Covered: return "covered";
                case SourceState.Error: return "error";
                case SourceState.Ended: return "ended";
                default: return "off";
            }
        }

        private void SendLevels(MixerLevels levels)
        {
            WebSocketConnection connection = active;
            if (connection == null)
            {
                return;
            }
            // Montado à mão: são 20 mensagens por segundo, não vale passar pelo serializador genérico.
            StringBuilder text = new StringBuilder(160);
            text.Append("{\"t\":\"levels\",\"m\":").Append(levels.Master.ToString("0.####", CultureInfo.InvariantCulture)).Append(",\"s\":{");
            bool first = true;
            foreach (KeyValuePair<int, float> entry in levels.Sources)
            {
                if (!first)
                {
                    text.Append(',');
                }
                first = false;
                text.Append('"').Append(entry.Key).Append("\":").Append(entry.Value.ToString("0.####", CultureInfo.InvariantCulture));
            }
            text.Append("},\"b\":{");
            first = true;
            foreach (KeyValuePair<int, double> entry in levels.BufferMs)
            {
                if (!first)
                {
                    text.Append(',');
                }
                first = false;
                text.Append('"').Append(entry.Key).Append("\":").Append(entry.Value.ToString("0.#", CultureInfo.InvariantCulture));
            }
            text.Append("},\"c\":{");
            first = true;
            foreach (KeyValuePair<int, double> entry in levels.CaptureMs)
            {
                if (!first)
                {
                    text.Append(',');
                }
                first = false;
                text.Append('"').Append(entry.Key).Append("\":").Append(entry.Value.ToString("0.#", CultureInfo.InvariantCulture));
            }
            text.Append("}}");
            connection.SendText(text.ToString());
        }
    }
}

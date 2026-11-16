using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

namespace ShareRoomAudio
{
    /// <summary>
    /// Sites que o usuário autorizou a usar o auxiliar. Fica em %APPDATA%\ShareRoom\audio.json.
    /// Um site só entra aqui quando a pessoa responde "Sim" na janela do próprio auxiliar.
    /// </summary>
    internal sealed class Config
    {
        private readonly object gate = new object();
        private readonly HashSet<string> origins = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> sessionOrigins = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly string path;

        public Config()
        {
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ShareRoom");
            path = Path.Combine(folder, "audio.json");
            try
            {
                if (File.Exists(path))
                {
                    Dictionary<string, object> data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                    object list;
                    if (data != null && data.TryGetValue("origins", out list) && list is System.Collections.IEnumerable)
                    {
                        foreach (object item in (System.Collections.IEnumerable)list)
                        {
                            string origin = NormalizeOrigin(item as string);
                            if (origin != null)
                            {
                                origins.Add(origin);
                            }
                        }
                    }
                }
            }
            catch (Exception)
            {
                // Arquivo corrompido: começa sem nenhum site autorizado.
            }
        }

        /// <summary>Autoriza só enquanto o programa estiver aberto (opção --allow-origin, usada nos testes).</summary>
        public void AllowForSession(string origin)
        {
            string normalized = NormalizeOrigin(origin);
            if (normalized != null)
            {
                lock (gate)
                {
                    sessionOrigins.Add(normalized);
                }
            }
        }

        public bool IsAllowed(string origin)
        {
            lock (gate)
            {
                return origins.Contains(origin) || sessionOrigins.Contains(origin);
            }
        }

        public int Count
        {
            get { lock (gate) { return origins.Count; } }
        }

        public void Allow(string origin)
        {
            lock (gate)
            {
                origins.Add(origin);
                Save();
            }
        }

        public void ForgetAll()
        {
            lock (gate)
            {
                origins.Clear();
                Save();
            }
        }

        private void Save()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                Dictionary<string, object> data = new Dictionary<string, object>();
                data["origins"] = new List<string>(origins);
                File.WriteAllText(path, new JavaScriptSerializer().Serialize(data));
            }
            catch (Exception)
            {
                // Sem permissão de escrita: a autorização vale só até fechar.
            }
        }

        /// <summary>Devolve "esquema://host[:porta]" em minúsculas, ou null se não for uma origem http(s) válida.</summary>
        public static string NormalizeOrigin(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length > 300)
            {
                return null;
            }
            Uri uri;
            if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out uri))
            {
                return null;
            }
            // "app" é o esquema da interface dentro do aplicativo de Windows (app://shareroom).
            if (uri.Scheme != "http" && uri.Scheme != "https" && uri.Scheme != "app")
            {
                return null;
            }
            string origin = uri.Scheme + "://" + uri.Host.ToLowerInvariant();
            if (!uri.IsDefaultPort)
            {
                origin += ":" + uri.Port;
            }
            return origin;
        }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace ShareRoomAudio
{
    /// <summary>Fotografia da árvore de processos: quem é pai de quem e o nome do executável de cada um.</summary>
    internal sealed class ProcessSnapshot
    {
        private readonly Dictionary<uint, uint> parents = new Dictionary<uint, uint>();
        private readonly Dictionary<uint, string> names = new Dictionary<uint, string>();

        public static ProcessSnapshot Take()
        {
            ProcessSnapshot snapshot = new ProcessSnapshot();
            IntPtr handle = Native.CreateToolhelp32Snapshot(2 /* TH32CS_SNAPPROCESS */, 0);
            if (handle == IntPtr.Zero || handle == new IntPtr(-1))
            {
                return snapshot;
            }
            try
            {
                PROCESSENTRY32 entry = new PROCESSENTRY32();
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (Native.Process32FirstW(handle, ref entry))
                {
                    do
                    {
                        snapshot.parents[entry.th32ProcessID] = entry.th32ParentProcessID;
                        snapshot.names[entry.th32ProcessID] = entry.szExeFile ?? "";
                    }
                    while (Native.Process32NextW(handle, ref entry));
                }
            }
            finally
            {
                Native.CloseHandle(handle);
            }
            return snapshot;
        }

        public bool Exists(uint pid)
        {
            return names.ContainsKey(pid);
        }

        public string ExeOf(uint pid)
        {
            string name;
            return names.TryGetValue(pid, out name) ? name : "";
        }

        /// <summary>
        /// Processo "raiz" de um aplicativo: sobe pelos pais enquanto o executável for o mesmo.
        /// O Chrome e o Discord, por exemplo, tocam áudio num processo filho; a raiz é a janela principal.
        /// </summary>
        public uint RootOf(uint pid)
        {
            string exe = ExeOf(pid);
            uint current = pid;
            for (int hops = 0; hops < 32; hops++)
            {
                uint parent;
                if (!parents.TryGetValue(current, out parent) || parent == 0 || parent == current)
                {
                    break;
                }
                if (!string.Equals(ExeOf(parent), exe, StringComparison.OrdinalIgnoreCase))
                {
                    break;
                }
                current = parent;
            }
            return current;
        }

        /// <summary>`pid` está na árvore de `ancestor` (ou é o próprio)?</summary>
        public bool IsInTree(uint pid, uint ancestor)
        {
            uint current = pid;
            for (int hops = 0; hops < 64; hops++)
            {
                if (current == ancestor)
                {
                    return true;
                }
                uint parent;
                if (!parents.TryGetValue(current, out parent) || parent == 0 || parent == current)
                {
                    return false;
                }
                current = parent;
            }
            return false;
        }
    }

    internal sealed class AppInfo
    {
        public uint Pid;
        public string Exe = "";
        public string Name = "";
        public string Path = "";
        /// <summary>O aplicativo já abriu uma sessão de áudio no Windows.</summary>
        public bool HasSession;
        /// <summary>A sessão está ativa (tocando) neste momento.</summary>
        public bool Playing;
        public bool HasWindow;
    }

    /// <summary>Lista os aplicativos abertos que podem produzir áudio.</summary>
    internal static class AppCatalog
    {
        private static readonly Dictionary<string, string> nameCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private static readonly Dictionary<string, string> iconCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private static readonly object cacheGate = new object();

        // Peças do próprio Windows que têm janela mas não são "aplicativos" para o mixer.
        private static readonly HashSet<string> shellProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "explorer.exe", "shellexperiencehost.exe", "searchhost.exe", "startmenuexperiencehost.exe",
            "textinputhost.exe", "applicationframehost.exe", "systemsettings.exe", "lockapp.exe", "dwm.exe",
            "taskmgr.exe", "audiodg.exe", "svchost.exe", "sihost.exe", "ctfmon.exe", "widgets.exe",
            "widgetservice.exe", "phoneexperiencehost.exe", "gamebar.exe", "gamebarftserver.exe",
        };

        public static List<AppInfo> Scan(ProcessSnapshot snapshot)
        {
            Dictionary<uint, AppInfo> apps = new Dictionary<uint, AppInfo>();
            uint self = (uint)Process.GetCurrentProcess().Id;

            foreach (KeyValuePair<uint, bool> session in SessionProcesses())
            {
                if (session.Key == 0 || session.Key == self || !snapshot.Exists(session.Key))
                {
                    continue;
                }
                uint root = snapshot.RootOf(session.Key);
                if (root == self)
                {
                    continue;
                }
                AppInfo app = GetOrAdd(apps, root, snapshot);
                app.HasSession = true;
                app.Playing = app.Playing || session.Value;
            }

            foreach (uint pid in WindowProcesses())
            {
                if (pid == self || !snapshot.Exists(pid))
                {
                    continue;
                }
                uint root = snapshot.RootOf(pid);
                if (root == self)
                {
                    continue;
                }
                if (!apps.ContainsKey(root) && shellProcesses.Contains(snapshot.ExeOf(root)))
                {
                    continue;
                }
                GetOrAdd(apps, root, snapshot).HasWindow = true;
            }

            List<AppInfo> list = new List<AppInfo>(apps.Values);
            list.RemoveAll(delegate(AppInfo app) { return app.HasSession && IsWindowsPlumbing(app.Exe); });
            list.Sort(delegate(AppInfo a, AppInfo b)
            {
                if (a.HasSession != b.HasSession)
                {
                    return a.HasSession ? -1 : 1;
                }
                return string.Compare(a.Name, b.Name, StringComparison.CurrentCultureIgnoreCase);
            });
            return list;
        }

        private static bool IsWindowsPlumbing(string exe)
        {
            return string.Equals(exe, "audiodg.exe", StringComparison.OrdinalIgnoreCase)
                || string.Equals(exe, "svchost.exe", StringComparison.OrdinalIgnoreCase);
        }

        private static AppInfo GetOrAdd(Dictionary<uint, AppInfo> apps, uint root, ProcessSnapshot snapshot)
        {
            AppInfo app;
            if (!apps.TryGetValue(root, out app))
            {
                app = new AppInfo();
                app.Pid = root;
                app.Exe = snapshot.ExeOf(root);
                app.Path = PathOf(root);
                app.Name = FriendlyName(app.Path, app.Exe);
                apps[root] = app;
            }
            return app;
        }

        /// <summary>Processos com sessão de áudio em alguma saída ativa. O valor diz se a sessão está tocando agora.</summary>
        private static Dictionary<uint, bool> SessionProcesses()
        {
            Dictionary<uint, bool> result = new Dictionary<uint, bool>();
            IMMDeviceEnumerator enumerator = null;
            IMMDeviceCollection devices = null;
            try
            {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                if (enumerator.EnumAudioEndpoints(EDataFlow.Render, Native.DEVICE_STATE_ACTIVE, out devices) < 0)
                {
                    return result;
                }
                uint deviceCount;
                devices.GetCount(out deviceCount);
                for (uint d = 0; d < deviceCount; d++)
                {
                    IMMDevice device;
                    if (devices.Item(d, out device) < 0)
                    {
                        continue;
                    }
                    object instance;
                    Guid iid = Native.IID_IAudioSessionManager2;
                    if (device.Activate(ref iid, Native.CLSCTX_ALL, IntPtr.Zero, out instance) >= 0)
                    {
                        IAudioSessionManager2 manager = (IAudioSessionManager2)instance;
                        IAudioSessionEnumerator sessions;
                        if (manager.GetSessionEnumerator(out sessions) >= 0)
                        {
                            int count;
                            sessions.GetCount(out count);
                            for (int s = 0; s < count; s++)
                            {
                                IAudioSessionControl2 control;
                                if (sessions.GetSession(s, out control) < 0)
                                {
                                    continue;
                                }
                                uint pid;
                                int state;
                                // IsSystemSoundsSession devolve S_OK (0) para a sessão "Sons do sistema".
                                if (control.GetProcessId(out pid) >= 0 && control.GetState(out state) >= 0
                                    && control.IsSystemSoundsSession() != 0 && state != 2 /* expirada */)
                                {
                                    bool playing = state == 1;
                                    bool known;
                                    result[pid] = (result.TryGetValue(pid, out known) && known) || playing;
                                }
                                Marshal.ReleaseComObject(control);
                            }
                            Marshal.ReleaseComObject(sessions);
                        }
                        Marshal.ReleaseComObject(manager);
                    }
                    Marshal.ReleaseComObject(device);
                }
            }
            catch (Exception)
            {
                // Sem dispositivo de áudio, ou o serviço de áudio reiniciando: devolve o que conseguiu.
            }
            finally
            {
                if (devices != null)
                {
                    Marshal.ReleaseComObject(devices);
                }
                if (enumerator != null)
                {
                    Marshal.ReleaseComObject(enumerator);
                }
            }
            return result;
        }

        /// <summary>Processos donos de janelas principais visíveis.</summary>
        private static List<uint> WindowProcesses()
        {
            List<uint> pids = new List<uint>();
            Native.EnumWindows(delegate(IntPtr window, IntPtr unused)
            {
                if (!Native.IsWindowVisible(window) || Native.GetWindowTextLengthW(window) == 0)
                {
                    return true;
                }
                if (Native.GetWindow(window, 4 /* GW_OWNER */) != IntPtr.Zero)
                {
                    return true;
                }
                long style = Native.GetWindowLongPtr(window, -20 /* GWL_EXSTYLE */).ToInt64();
                if ((style & 0x80 /* WS_EX_TOOLWINDOW */) != 0)
                {
                    return true;
                }
                uint pid;
                Native.GetWindowThreadProcessId(window, out pid);
                if (pid != 0 && !pids.Contains(pid))
                {
                    pids.Add(pid);
                }
                return true;
            }, IntPtr.Zero);
            return pids;
        }

        public static string PathOf(uint pid)
        {
            IntPtr process = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero)
            {
                return "";
            }
            try
            {
                StringBuilder buffer = new StringBuilder(1024);
                uint size = (uint)buffer.Capacity;
                return Native.QueryFullProcessImageNameW(process, 0, buffer, ref size) ? buffer.ToString() : "";
            }
            finally
            {
                Native.CloseHandle(process);
            }
        }

        /// <summary>Nome legível: a descrição do executável ("Discord", "VALORANT"), ou o nome do arquivo.</summary>
        private static string FriendlyName(string path, string exe)
        {
            string fallback = exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? exe.Substring(0, exe.Length - 4) : exe;
            if (path.Length == 0)
            {
                return fallback;
            }
            lock (cacheGate)
            {
                string cached;
                if (nameCache.TryGetValue(path, out cached))
                {
                    return cached;
                }
            }
            string name = fallback;
            try
            {
                FileVersionInfo info = FileVersionInfo.GetVersionInfo(path);
                string description = (info.FileDescription ?? "").Trim();
                string product = (info.ProductName ?? "").Trim();
                if (description.Length > 0 && description.Length <= 60)
                {
                    name = description;
                }
                else if (product.Length > 0 && product.Length <= 60)
                {
                    name = product;
                }
            }
            catch (Exception)
            {
            }
            lock (cacheGate)
            {
                nameCache[path] = name;
            }
            return name;
        }

        /// <summary>Ícone do executável como PNG 32×32 em base64, ou null.</summary>
        public static string IconPng(string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
            {
                return null;
            }
            lock (cacheGate)
            {
                string cached;
                if (iconCache.TryGetValue(path, out cached))
                {
                    return cached;
                }
            }
            string result = null;
            try
            {
                using (Icon icon = Icon.ExtractAssociatedIcon(path))
                using (Bitmap source = icon.ToBitmap())
                using (Bitmap scaled = new Bitmap(32, 32, PixelFormat.Format32bppArgb))
                {
                    using (Graphics graphics = Graphics.FromImage(scaled))
                    {
                        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        graphics.DrawImage(source, 0, 0, 32, 32);
                    }
                    using (MemoryStream stream = new MemoryStream())
                    {
                        scaled.Save(stream, ImageFormat.Png);
                        result = Convert.ToBase64String(stream.ToArray());
                    }
                }
            }
            catch (Exception)
            {
            }
            lock (cacheGate)
            {
                iconCache[path] = result;
            }
            return result;
        }
    }
}

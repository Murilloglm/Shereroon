using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace ShareRoomAudio
{
    internal static class Program
    {
        public const string Version = "0.1.0";
        public const int DefaultPort = 47821;

        internal static string Option(string[] args, string name, string fallback)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == name && i + 1 < args.Length)
                {
                    return args[i + 1];
                }
                if (args[i].StartsWith(name + "=", StringComparison.Ordinal))
                {
                    return args[i].Substring(name.Length + 1);
                }
            }
            return fallback;
        }

        private static List<string> Options(string[] args, string name)
        {
            List<string> values = new List<string>();
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == name && i + 1 < args.Length)
                {
                    values.Add(args[i + 1]);
                }
                else if (args[i].StartsWith(name + "=", StringComparison.Ordinal))
                {
                    values.Add(args[i].Substring(name.Length + 1));
                }
            }
            return values;
        }

        internal static bool Flag(string[] args, string name)
        {
            return Array.IndexOf(args, name) >= 0;
        }

        internal static double Number(string text)
        {
            return double.Parse(text, CultureInfo.InvariantCulture);
        }

        [MTAThread]
        private static int Main(string[] args)
        {
            bool console = Flag(args, "--console") || Flag(args, "--selftest") || Flag(args, "--help")
                || Option(args, "--tone", null) != null || Option(args, "--probe", null) != null;
            if (console)
            {
                // Programa de janela não tem console próprio: usa o de quem o chamou, se houver.
                Native.AttachConsole(-1);
            }

            try
            {
                if (Flag(args, "--help"))
                {
                    Console.Out.WriteLine(
                        "ShareRoom Áudio " + Version + "\n"
                        + "  (sem opções)            roda na bandeja do sistema e atende o site do ShareRoom\n"
                        + "  --port N                porta local (padrão " + DefaultPort + ")\n"
                        + "  --console               sem bandeja; registra a atividade no console\n"
                        + "  --allow-origin URL      autoriza um site só nesta execução (para testes)\n"
                        + "  --no-prompt             recusa sites desconhecidos sem perguntar\n"
                        + "  --selftest              testa a captura e o isolamento por aplicativo neste PC\n"
                        + "  --tone HZ [--seconds S] toca um tom de teste (com --noise, um ruído de ventilador)\n");
                    return 0;
                }

                string tone = Option(args, "--tone", null);
                if (tone != null)
                {
                    return TonePlayer.Run(
                        Number(tone),
                        Number(Option(args, "--seconds", "10")),
                        Number(Option(args, "--amplitude", "0.004")),
                        Flag(args, "--noise"));
                }
                if (Flag(args, "--selftest"))
                {
                    return SelfTest.Run();
                }

                return Serve(args, Flag(args, "--console"));
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Erro: " + error.Message);
                if (!console)
                {
                    Native.MessageBoxW(IntPtr.Zero, error.Message, "ShareRoom Áudio", Native.MB_ICONWARNING);
                }
                return 1;
            }
        }

        private static int Serve(string[] args, bool console)
        {
            int port = int.Parse(Option(args, "--port", DefaultPort.ToString(CultureInfo.InvariantCulture)), CultureInfo.InvariantCulture);
            if (Native.WindowsBuild() < 19041)
            {
                throw new InvalidOperationException(
                    "A captura de áudio por aplicativo exige Windows 10 versão 2004 ou mais novo (recomendado: Windows 11).");
            }

            bool first;
            Mutex instance = new Mutex(true, "Local\\ShareRoomAudio-" + port, out first);
            if (!first)
            {
                if (console)
                {
                    Console.Error.WriteLine("O ShareRoom Áudio já está em execução nesta porta.");
                }
                else
                {
                    Native.MessageBoxW(IntPtr.Zero, "O ShareRoom Áudio já está em execução (veja o ícone na bandeja do sistema).",
                        "ShareRoom Áudio", Native.MB_ICONINFORMATION | Native.MB_SETFOREGROUND);
                }
                return 3;
            }

            Config config = new Config();
            foreach (string origin in Options(args, "--allow-origin"))
            {
                config.AllowForSession(origin);
            }

            using (Mixer mixer = new Mixer())
            using (Server server = new Server(port, config, mixer, !console, !Flag(args, "--no-prompt")))
            {
                mixer.Start();
                try
                {
                    server.Start();
                }
                catch (SocketException)
                {
                    throw new InvalidOperationException("A porta local " + port + " está ocupada por outro programa.");
                }

                if (console)
                {
                    Console.Out.WriteLine("ShareRoom Áudio " + Version + " em ws://127.0.0.1:" + port + " (Ctrl+C para sair)");
                    Console.Out.Flush();
                    // Encerra quando quem iniciou fechar a entrada padrão (os testes fazem isso) ou o processo for finalizado.
                    try
                    {
                        while (Console.In.ReadLine() != null)
                        {
                        }
                    }
                    catch (Exception)
                    {
                    }
                    if (Flag(args, "--stay"))
                    {
                        Thread.Sleep(Timeout.Infinite);
                    }
                }
                else
                {
                    RunTray(server, config, port);
                }
            }
            GC.KeepAlive(instance);
            return 0;
        }

        private static Icon MakeIcon()
        {
            using (Bitmap bitmap = new Bitmap(32, 32))
            {
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    graphics.Clear(Color.Transparent);
                    using (Pen pen = new Pen(Color.FromArgb(168, 119, 255), 3.4f))
                    {
                        graphics.DrawRectangle(pen, 4, 6, 24, 15);
                        graphics.DrawLine(pen, 11, 27, 21, 27);
                    }
                    using (Brush brush = new SolidBrush(Color.FromArgb(69, 226, 131)))
                    {
                        graphics.FillRectangle(brush, 10, 14, 2, 4);
                        graphics.FillRectangle(brush, 15, 11, 2, 7);
                        graphics.FillRectangle(brush, 20, 13, 2, 5);
                    }
                }
                IntPtr handle = bitmap.GetHicon();
                Icon icon = (Icon)Icon.FromHandle(handle).Clone();
                Native.DestroyIcon(handle);
                return icon;
            }
        }

        /// <summary>Ícone na bandeja: mostra qual site está conectado e permite sair ou esquecer as autorizações.</summary>
        private static void RunTray(Server server, Config config, int port)
        {
            Thread ui = new Thread(delegate()
            {
                Application.EnableVisualStyles();
                NotifyIcon tray = new NotifyIcon();
                tray.Icon = MakeIcon();
                tray.Text = "ShareRoom Áudio";
                tray.Visible = true;

                ContextMenuStrip menu = new ContextMenuStrip();
                ToolStripMenuItem status = new ToolStripMenuItem("Nenhum site conectado");
                status.Enabled = false;
                ToolStripMenuItem forget = new ToolStripMenuItem("Esquecer sites autorizados");
                forget.Click += delegate
                {
                    config.ForgetAll();
                    tray.ShowBalloonTip(3000, "ShareRoom Áudio", "Pronto. O próximo site que tentar usar o mixer vai pedir autorização de novo.", ToolTipIcon.Info);
                };
                ToolStripMenuItem quit = new ToolStripMenuItem("Sair");
                quit.Click += delegate { Application.ExitThread(); };
                menu.Items.Add(status);
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add(forget);
                menu.Items.Add(quit);
                tray.ContextMenuStrip = menu;

                System.Windows.Forms.Timer refresh = new System.Windows.Forms.Timer();
                refresh.Interval = 1000;
                refresh.Tick += delegate
                {
                    string origin = server.ConnectedOrigin;
                    string text = origin == null ? "Nenhum site conectado" : "Conectado: " + origin;
                    status.Text = text;
                    forget.Text = "Esquecer sites autorizados (" + config.Count + ")";
                    string tip = "ShareRoom Áudio — " + text;
                    tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
                };
                refresh.Start();

                tray.ShowBalloonTip(4000, "ShareRoom Áudio está rodando",
                    "Abra o Mixer de Áudio no site do ShareRoom para escolher os aplicativos. Para sair, clique com o botão direito neste ícone.",
                    ToolTipIcon.Info);
                Application.Run();
                tray.Visible = false;
                tray.Dispose();
            });
            ui.SetApartmentState(ApartmentState.STA);
            ui.Name = "bandeja";
            ui.Start();
            ui.Join();
        }
    }
}

using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

class Host
{
    static int Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string pythonPath = Path.Combine(dir, "python.path");
        string script = Path.Combine(dir, "download_host.py");
        if (!File.Exists(pythonPath) || !File.Exists(script))
        {
            WriteMessage("{\"type\":\"error\",\"message\":\"本机下载组件不完整，请重新运行 install-host.ps1。\"}");
            return 1;
        }
        string python = File.ReadAllText(pythonPath).Trim();
        if (python.Length == 0 || !File.Exists(python))
        {
            WriteMessage("{\"type\":\"error\",\"message\":\"没有找到 Python，请重新运行 install-host.ps1。\"}");
            return 1;
        }

        var psi = new ProcessStartInfo();
        psi.FileName = python;
        psi.Arguments = "-u \"" + script + "\"";
        psi.WorkingDirectory = dir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;

        Process process;
        try
        {
            process = Process.Start(psi);
        }
        catch
        {
            WriteMessage("{\"type\":\"error\",\"message\":\"无法启动 yt-dlp。\"}");
            return 1;
        }
        if (process == null)
        {
            WriteMessage("{\"type\":\"error\",\"message\":\"无法启动 yt-dlp。\"}");
            return 1;
        }

        Thread pumpIn = new Thread(delegate ()
        {
            Pump(Console.OpenStandardInput(), process.StandardInput.BaseStream, true);
        });
        Thread pumpOut = new Thread(delegate ()
        {
            Pump(process.StandardOutput.BaseStream, Console.OpenStandardOutput(), false);
        });
        Thread drainErr = new Thread(delegate ()
        {
            try { process.StandardError.BaseStream.CopyTo(Stream.Null); } catch { }
        });
        pumpIn.IsBackground = true;
        drainErr.IsBackground = true;
        pumpOut.IsBackground = true;
        pumpIn.Start();
        pumpOut.Start();
        drainErr.Start();
        process.WaitForExit();
        pumpOut.Join(8000);
        return process.ExitCode;
    }

    static void Pump(Stream source, Stream destination, bool closeDestination)
    {
        byte[] buffer = new byte[65536];
        try
        {
            int read;
            while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
            {
                destination.Write(buffer, 0, read);
                destination.Flush();
            }
        }
        catch { }
        if (closeDestination)
        {
            try { destination.Close(); } catch { }
        }
    }

    static void WriteMessage(string json)
    {
        byte[] data = Encoding.UTF8.GetBytes(json);
        byte[] length = BitConverter.GetBytes(data.Length);
        Stream stdout = Console.OpenStandardOutput();
        stdout.Write(length, 0, 4);
        stdout.Write(data, 0, data.Length);
        stdout.Flush();
    }
}

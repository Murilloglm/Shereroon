# Compila o ShareRoom Áudio com o compilador de C# que já vem no Windows (.NET Framework 4.8).
# Não precisa instalar Visual Studio nem SDK. Uso:  npm run build:helper
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    throw "Não encontrei o compilador em $csc. O ShareRoom Áudio precisa do .NET Framework 4.8 (já incluso no Windows 10 e 11)."
}

New-Item -ItemType Directory -Force -Path 'bin' | Out-Null
$out = 'bin\ShareRoomAudio.exe'

& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /warn:4 `
    "/out:$out" `
    /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll `
    /recurse:src\*.cs

if ($LASTEXITCODE -ne 0) { throw "A compilação falhou (código $LASTEXITCODE)." }
$file = Get-Item $out
Write-Output ("Compilado: {0} ({1:N0} bytes)" -f $file.FullName, $file.Length)

# Encerra o RDR Local com seguranca (icone da bandeja + painel + servicos). Usado por instalador/desinstalador.
$ErrorActionPreference = 'SilentlyContinue'
$inst = Split-Path -Parent $PSScriptRoot
$node = Join-Path $inst 'runtime\node.exe'
# 1) tira o vigia da bandeja do ar (senao ele religaria o painel)
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*RDR Local*tray.ps1*' -or $_.CommandLine -like '*launcher*tray.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
# 2) pede ao painel para desligar os servicos
try { Invoke-WebRequest -Uri 'http://127.0.0.1:7070/api/quit' -Method Post -Headers @{ 'X-RDR' = '1' } -UseBasicParsing -TimeoutSec 5 | Out-Null } catch {}
for ($i = 0; $i -lt 30; $i++) {
  $up = $false
  try { $c = New-Object Net.Sockets.TcpClient; $r = $c.BeginConnect('127.0.0.1', 7070, $null, $null); $up = $r.AsyncWaitHandle.WaitOne(300); $c.Close() } catch {}
  if (-not $up) { break }
  Start-Sleep -Milliseconds 700
}
# 3) ultimo recurso: encerra o node deste programa
Get-Process node | Where-Object { $_.Path -eq $node } | Stop-Process -Force
exit 0

# RDR Local - icone da bandeja + vigia do painel. Roda sem janela (via launcher.vbs).
param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$inst = Split-Path -Parent $PSScriptRoot
$app  = Join-Path $inst 'app'
$node = Join-Path $inst 'runtime\node.exe'
$ico  = Join-Path $PSScriptRoot 'rdr-local.ico'
$data = Join-Path $env:ProgramData 'RDRLocal'
$logs = Join-Path $data 'logs'
$port = 7070
$url  = "http://127.0.0.1:$port"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$trayLog = Join-Path $logs 'tray.log'
function Log($m) { try { Add-Content -Path $trayLog -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {} }

# Instancia unica: se ja existe, apenas abre o painel.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\RDRLocalTray', [ref]$created)
if (-not $created) { if (-not $NoOpen) { Start-Process $url }; exit 0 }

function Test-Panel {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $r = $c.BeginConnect('127.0.0.1', $port, $null, $null)
    $ok = $r.AsyncWaitHandle.WaitOne(500)
    if ($ok) { $c.EndConnect($r) }
    $c.Close(); return $ok
  } catch { return $false }
}

$script:quitting = $false
$script:fails = @()

function Start-Server {
  if (Test-Panel) { return }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $out = Join-Path $logs 'panel.log'
  $psi.Arguments = '/c ""' + $node + '" "server.js" --no-open >> "' + $out + '" 2>&1"'
  $psi.WorkingDirectory = $app
  $psi.CreateNoWindow = $true
  $psi.UseShellExecute = $false
  $psi.EnvironmentVariables['RDR_HOME'] = $data
  $psi.EnvironmentVariables['RDR_LAUNCHER'] = (Join-Path $PSScriptRoot 'launcher.vbs')
  [void][System.Diagnostics.Process]::Start($psi)
  Log 'painel iniciado'
}

function Stop-Server {
  try { Invoke-WebRequest -Uri "$url/api/quit" -Method Post -Headers @{ 'X-RDR' = '1' } -UseBasicParsing -TimeoutSec 5 | Out-Null } catch {}
  for ($i = 0; $i -lt 40; $i++) { if (-not (Test-Panel)) { break }; Start-Sleep -Milliseconds 700 }
  Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $node } | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Wait-Panel([int]$sec) { for ($i = 0; $i -lt ($sec * 2); $i++) { if (Test-Panel) { return $true }; Start-Sleep -Milliseconds 500 }; return $false }

[System.Windows.Forms.Application]::EnableVisualStyles()
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = New-Object System.Drawing.Icon($ico)
$icon.Text = 'RDR Local Server'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen    = $menu.Items.Add('Abrir painel')
$miData    = $menu.Items.Add('Abrir pasta de dados')
$miRestart = $menu.Items.Add('Reiniciar o painel')
[void]$menu.Items.Add('-')
$miQuit    = $menu.Items.Add('Sair do RDR Local')
$icon.ContextMenuStrip = $menu
$icon.Visible = $true

$miOpen.add_Click({ Start-Process $url })
$icon.add_DoubleClick({ Start-Process $url })
$miData.add_Click({ Start-Process explorer.exe $data })
$miRestart.add_Click({
  $script:quitting = $true
  Stop-Server; Start-Server
  $script:quitting = $false
  $icon.ShowBalloonTip(2000, 'RDR Local', 'Painel reiniciado.', 'Info')
})
$miQuit.add_Click({
  $r = [System.Windows.Forms.MessageBox]::Show("Sair desliga o painel e todos os servicos (sites, bancos, e-mail).`nDeseja sair?", 'RDR Local', 'YesNo', 'Question')
  if ($r -ne 'Yes') { return }
  $script:quitting = $true
  $icon.Text = 'RDR Local - encerrando...'
  Stop-Server
  $icon.Visible = $false; $icon.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

# Vigia: se o painel cair, religa (e avisa). Evita laco infinito se falhar varias vezes seguidas.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 6000
$timer.add_Tick({
  if ($script:quitting) { return }
  if (Test-Panel) { return }
  $now = Get-Date
  $script:fails = @($script:fails | Where-Object { ($now - $_).TotalSeconds -lt 120 }) + $now
  if ($script:fails.Count -gt 4) {
    $icon.ShowBalloonTip(6000, 'RDR Local', 'O painel nao esta subindo. Veja logs\panel.log na pasta de dados.', 'Error')
    $timer.Stop(); Log 'vigia desistiu apos varias falhas'; return
  }
  Log 'painel fora do ar, religando'
  Start-Server
  $icon.ShowBalloonTip(2500, 'RDR Local', 'O painel tinha parado e foi religado.', 'Warning')
})

try {
  Start-Server
  if (Wait-Panel 25) { if (-not $NoOpen) { Start-Process $url } }
  else { $icon.ShowBalloonTip(6000, 'RDR Local', 'O painel nao respondeu. Veja logs\panel.log na pasta de dados.', 'Error') }
  $timer.Start()
  [System.Windows.Forms.Application]::Run()
} catch { Log ("erro: " + $_.Exception.Message) }
finally { try { $icon.Visible = $false; $icon.Dispose() } catch {}; try { $mutex.ReleaseMutex() } catch {} }

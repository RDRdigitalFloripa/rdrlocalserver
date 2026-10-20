# Cria/remove as tarefas agendadas do RDR Local. Executado pelo instalador (administrador).
param([ValidateSet('install','remove','autostart-on','autostart-off')][string]$Mode)
$ErrorActionPreference = 'Stop'
$launch = Join-Path $PSScriptRoot 'launcher.vbs'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

function Remove-Task($n) { Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue }

switch ($Mode) {
  'install' {
    # Tarefa sob demanda: os atalhos a chamam, e o RDR Local abre elevado sem pedir UAC toda vez.
    $a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $launch + '"')
    Register-ScheduledTask -TaskName 'RDR Local Start' -Action $a -Principal $principal -Settings $settings -Force | Out-Null
  }
  'autostart-on' {
    $a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $launch + '" silent')
    $t = New-ScheduledTaskTrigger -AtLogOn -User $user; $t.Delay = 'PT20S'
    Register-ScheduledTask -TaskName 'RDR Local' -Action $a -Trigger $t -Principal $principal -Settings $settings -Force | Out-Null
  }
  'autostart-off' { Remove-Task 'RDR Local' }
  'clean-hosts' {
    $p = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
    $txt = [IO.File]::ReadAllText($p)
    $new = [regex]::Replace($txt, '(?ms)\r?\n?# >>> RDR Local.*?# <<< RDR Local\r?\n?', "`r`n")
    if ($new -ne $txt) { [IO.File]::WriteAllText($p, $new) }
  }
  'remove' { Remove-Task 'RDR Local'; Remove-Task 'RDR Local Start' }
}

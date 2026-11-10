// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Iniciar o RDR Local junto com o Windows (Agendador de Tarefas, com privilégios elevados e sem janela). */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const { P, IS_WIN, run } = core;

const TASK = 'RDR Local';
const VBS = path.join(P.root, 'start-silent.vbs');

/** Script que abre o servidor sem janela e sem abrir o navegador. */
function vbsText() {
  const node = process.execPath; const out = path.join(P.logs, 'panel.log');
  const cmd = `cmd /c cd /d "${P.app}" && "${node}" server.js --no-open >> "${out}" 2>&1`;
  return `' Gerado pelo RDR Local: inicia o painel sem janela.\r\nCreateObject("WScript.Shell").Run "${cmd.replace(/"/g, '""')}", 0, False\r\n`;
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
/** PowerShell em vez de schtasks /Create: o schtasks cria tarefas que não iniciam na bateria e são encerradas após 72 horas. */
function createScript() {
  return [
    process.env.RDR_LAUNCHER
      ? `$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ${psq('"' + process.env.RDR_LAUNCHER + '" silent')}`
      : `$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ${psq('"' + VBS + '"')}`,
    `$u = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name`,
    `$t = New-ScheduledTaskTrigger -AtLogOn -User $u; $t.Delay = 'PT20S'`,
    `$p = New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Highest`,
    `$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)`,
    `Register-ScheduledTask -TaskName ${psq(TASK)} -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null`,
  ].join('; ');
}

function needWin() { if (!IS_WIN) throw new Error('Iniciar com o Windows só funciona no Windows.'); }

async function status() {
  if (!IS_WIN) return { supported: false, enabled: false };
  const r = await run('schtasks', ['/Query', '/TN', TASK]);
  return { supported: true, enabled: r.ok };
}
async function enable() {
  needWin();
  if (!require('./sites').isAdmin()) throw new Error('Abra o RDR Local como Administrador para ativar (pelo atalho do RDR Local ou pelo start.bat).');
  fs.writeFileSync(VBS, vbsText());
  const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', createScript()]);
  if (!r.ok) throw new Error('Não consegui criar a tarefa: ' + r.out.slice(-300));
  core.log('Início com o Windows ativado.');
}
async function disable() {
  needWin();
  const r = await run('schtasks', ['/Delete', '/TN', TASK, '/F']);
  if (!r.ok && !/não foi possível localizar|cannot find|does not exist|não existe/i.test(r.out)) throw new Error('Não consegui remover a tarefa: ' + r.out.slice(-300));
  try { fs.rmSync(VBS, { force: true }); } catch (_) { /* ok */ }
  core.log('Início com o Windows desativado.');
}

module.exports = { status, enable, disable, vbsText, createScript };

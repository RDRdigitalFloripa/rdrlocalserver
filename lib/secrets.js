// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Segredos (token do Telegram, URL de webhook…) ficam em config/secrets.json, FORA do config.json:
 * não entram na exportação de configuração, não aparecem na API e o arquivo é restrito ao usuário atual.
 * (Credenciais de nuvem ficam no rclone.conf, também restrito.)
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawnSync } = require('child_process');
const { P, IS_WIN } = require('./core');

const FILE = path.join(P.root, 'config', 'secrets.json');

/** Restringe o arquivo ao usuário atual (Windows: icacls; Linux/macOS: chmod 600). Melhor esforço. */
function harden(file) {
  if (!IS_WIN) { try { fs.chmodSync(file, 0o600); } catch (_) { /* ok */ } return; }
  const user = process.env.USERNAME; if (!user) return;
  execFile('icacls', [file, '/inheritance:r', '/grant:r', `${user}:(F)`], { windowsHide: true }, () => {});
}
function read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return {}; } }
function write(obj) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2), { mode: 0o600 });
  harden(FILE);
}
const get = (k) => read()[k] || '';
function set(k, v) { const o = read(); if (v) o[k] = v; else delete o[k]; write(o); }


/**
 * Valores sensíveis (token do GitHub): no Windows são cifrados com DPAPI (só o seu usuário do Windows decifra, nesta máquina);
 * em Linux/macOS (modo desenvolvimento) ficam só ofuscados em base64 num arquivo 0600.
 * O texto vai pela entrada padrão do PowerShell, nunca pela linha de comando.
 */
const ps = (script, input) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true });
function protect(text) {
  if (!IS_WIN) return 'plain:' + Buffer.from(String(text)).toString('base64');
  const r = ps('[Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString', String(text));
  if (r.status !== 0 || !r.stdout.trim()) throw new Error('Não consegui proteger o segredo com o Windows (DPAPI).');
  return 'dpapi:' + r.stdout.trim();
}
function unprotect(v) {
  const s = String(v || '');
  if (s.startsWith('plain:')) return Buffer.from(s.slice(6), 'base64').toString('utf8');
  if (!s.startsWith('dpapi:') || !IS_WIN) return '';
  const r = ps('$s = [Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))', s.slice(6));
  return r.status === 0 ? r.stdout.replace(/\r?\n$/, '') : '';
}
const memo = new Map();
function getProtected(k) { if (memo.has(k)) return memo.get(k); const v = unprotect(get(k)); if (v) memo.set(k, v); return v; }
function setProtected(k, v) { memo.delete(k); if (!v) { set(k, ''); return; } set(k, protect(v)); memo.set(k, v); }

module.exports = { read, get, set, harden, getProtected, setProtected, FILE };

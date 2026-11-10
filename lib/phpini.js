// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Editor do php.ini por versão: ajustes comuns, extensões e texto completo — com validação e backup. */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const comps = require('./components');
const { cfg, save, log, run, exists } = core;

const VER_RE = /^\d+\.\d+$/;
const SIZE = /^\d+[KMG]?$/i;
const SETTINGS = {
  memory_limit: { label: 'Limite de memória', hint: 'ex.: 512M ou -1 (sem limite)', ok: (v) => v === '-1' || SIZE.test(v) },
  upload_max_filesize: { label: 'Tamanho máx. de upload', hint: 'ex.: 64M', ok: (v) => SIZE.test(v) },
  post_max_size: { label: 'Tamanho máx. do POST', hint: 'maior ou igual ao upload, ex.: 128M', ok: (v) => SIZE.test(v) },
  max_execution_time: { label: 'Tempo máx. de execução (s)', hint: '0 = sem limite', ok: (v) => /^\d{1,4}$/.test(v) },
  max_input_vars: { label: 'Máx. de variáveis de entrada', hint: 'ex.: 3000 (formulários grandes)', ok: (v) => /^\d{1,6}$/.test(v) },
  display_errors: { label: 'Exibir erros na tela', options: ['On', 'Off'], ok: (v) => ['On', 'Off'].includes(v) },
  'date.timezone': { label: 'Fuso horário', hint: 'ex.: America/Sao_Paulo', ok: (v) => /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/.test(v) },
  'opcache.enable': { label: 'OPcache (cache de código)', options: ['1', '0'], ok: (v) => ['0', '1'].includes(v) },
};
const ZEND = new Set(['opcache', 'xdebug']);

function dirOf(v) {
  if (!VER_RE.test(String(v || '')) || !comps.phpInstalled().includes(v)) throw new Error('Versão do PHP não instalada.');
  return comps.bins.phpDir(v);
}
const iniFile = (v) => path.join(dirOf(v), 'php.ini');
function readIni(v) {
  const f = iniFile(v);
  if (!exists(f)) { comps.ensurePhpIni(v); }
  if (!exists(f)) throw new Error('php.ini ainda não existe para o PHP ' + v);
  return fs.readFileSync(f, 'utf8');
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nl = (t) => (t.includes('\r\n') ? '\r\n' : '\n');

function listDlls(v) {
  try { return fs.readdirSync(path.join(dirOf(v), 'ext')).map((f) => f.match(/^php_(.+)\.dll$/i)).filter(Boolean).map((m) => m[1].toLowerCase()).sort(); } catch (_) { return []; }
}
function extEnabled(ini, name) {
  const re = ZEND.has(name) ? new RegExp(`^\\s*zend_extension\\s*=\\s*"?(php_)?${esc(name)}(\\.dll)?"?\\s*(;.*)?$`, 'mi')
    : new RegExp(`^\\s*extension\\s*=\\s*"?(php_)?${esc(name)}(\\.dll)?"?\\s*(;.*)?$`, 'mi');
  return re.test(ini);
}
function getSetting(ini, key) {
  const re = new RegExp(`^[ \\t]*${esc(key)}[ \\t]*=[ \\t]*(.*?)[ \\t]*(?:;.*)?$`, 'gmi');
  let m; let last = '';
  while ((m = re.exec(ini))) last = m[1].replace(/^"(.*)"$/, '$1');
  return last;
}

function info(v) {
  const ini = readIni(v);
  const dlls = listDlls(v);
  const names = [...new Set([...dlls, ...(extEnabled(ini, 'opcache') ? ['opcache'] : [])])];
  return {
    v, file: iniFile(v), hasBackup: exists(iniFile(v) + '.bak'),
    extensions: names.map((n) => ({ name: n, enabled: extEnabled(ini, n), zend: ZEND.has(n) })),
    settings: Object.entries(SETTINGS).map(([key, d]) => ({ key, label: d.label, hint: d.hint || '', options: d.options || null, value: getSetting(ini, key) })),
    raw: ini,
  };
}

/** Aplica o novo texto; se o PHP reclamar (aviso/erro de sintaxe/DLL), volta ao anterior e explica. */
async function commit(v, text, label) {
  const f = iniFile(v); const old = exists(f) ? fs.readFileSync(f, 'utf8') : '';
  if (text === old) return;
  const probe = async () => (await run(comps.bins.phpCli(v), ['-c', dirOf(v), '-r', 'echo "RDR_OK";'])).out.replace(/RDR_OK/g, '');
  const warns = (o) => o.split(/\r?\n/).map((l) => l.trim()).filter((l) => /(Warning|Fatal|Parse error)/i.test(l));
  const before = new Set(warns(await probe()));
  if (old) fs.writeFileSync(f + '.bak', old);
  fs.writeFileSync(f, text);
  const out = await probe();
  const fresh = warns(out).filter((l) => !before.has(l));
  if (fresh.length) {
    fs.writeFileSync(f, old);
    throw new Error('O PHP recusou essa alteração (o php.ini foi mantido como estava):\n' + fresh.join('\n').slice(0, 400));
  }
  log(`php.ini do PHP ${v}: ${label}.`);
  await require('./services').restartPhp(v);
}

async function setExtension(v, name, on) {
  name = String(name || '').toLowerCase();
  if (!/^[a-z0-9_]{2,40}$/.test(name)) throw new Error('Nome de extensão inválido.');
  if (!listDlls(v).includes(name)) throw new Error(`A extensão ${name} não está disponível nesta versão do PHP.`);
  let ini = readIni(v); const eol = nl(ini);
  const zend = ZEND.has(name); const kw = zend ? 'zend_extension' : 'extension';
  const any = new RegExp(`^(\\s*);?\\s*${kw}\\s*=\\s*"?(php_)?${esc(name)}(\\.dll)?"?\\s*(;.*)?$`, 'mi');
  const value = zend ? name : name;
  if (on) {
    if (any.test(ini)) ini = ini.replace(any, `${kw}=${value}`);
    else ini = ini.replace(/\s*$/, `${eol}${kw}=${value}${eol}`);
  } else {
    ini = ini.replace(new RegExp(`^(\\s*)${kw}\\s*=\\s*"?(php_)?${esc(name)}(\\.dll)?"?\\s*(;.*)?$`, 'gmi'), (m) => ';' + m.trimStart());
  }
  const off = new Set(cfg.phpOff && cfg.phpOff[v] || []);
  if (on) off.delete(name); else off.add(name);
  cfg.phpOff = { ...(cfg.phpOff || {}), [v]: [...off] };
  await commit(v, ini, `extensão ${name} ${on ? 'ligada' : 'desligada'}`);
  save();
}

async function setSettings(v, values) {
  let ini = readIni(v); const eol = nl(ini); const changed = [];
  for (const [key, raw] of Object.entries(values || {})) {
    const d = SETTINGS[key]; if (!d) throw new Error('Ajuste desconhecido: ' + key);
    const val = String(raw).trim(); if (val === '') continue;
    if (!d.ok(val)) throw new Error(`Valor inválido para ${key}: "${val}"`);
    if (getSetting(ini, key) === val) continue;
    const act = new RegExp(`^([ \\t]*${esc(key)}[ \\t]*=).*$`, 'mi');
    const com = new RegExp(`^[ \\t]*;[ \\t]*${esc(key)}[ \\t]*=.*$`, 'mi');
    const line = `${key} = ${val}`;
    if (act.test(ini)) ini = ini.replace(act, line);
    else if (com.test(ini)) ini = ini.replace(com, line);
    else ini = ini.replace(/\s*$/, `${eol}${line}${eol}`);
    changed.push(key);
  }
  if (!changed.length) return;
  await commit(v, ini, 'ajustes ' + changed.join(', '));
}

async function setRaw(v, text) {
  text = String(text);
  if (text.length > 400000 || text.includes('\0')) throw new Error('Conteúdo inválido.');
  await commit(v, text, 'editado manualmente');
}
async function restoreBackup(v) {
  const b = iniFile(v) + '.bak'; if (!exists(b)) throw new Error('Não há backup do php.ini.');
  await commit(v, fs.readFileSync(b, 'utf8'), 'restaurado do backup');
}

module.exports = { info, setExtension, setSettings, setRaw, restoreBackup, SETTINGS };

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * .env do projeto: compara com o .env.example (o que falta, o que sobra, o que está vazio), cria o .env a partir do
 * exemplo, adiciona as chaves que faltam e edita uma chave por vez. Valores sensíveis (senha, chave, token) NUNCA
 * voltam pela API: só se sabe se estão preenchidos. Antes de qualquer alteração o .env atual vai para .env.backup
 * (o Laravel já ignora esse nome no Git).
 */
const fs = require('fs');
const path = require('path');
const { exists } = require('./core');

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_RE = /(PASS(WORD)?|SECRET|TOKEN|PRIVATE|CREDENTIAL|API_?KEY|APP_KEY|_KEY$|^KEY$|DSN|SALT)/i;
const EXAMPLES = ['.env.example', '.env.sample', '.env.dist'];
const isSecret = (k) => SECRET_RE.test(k);

/** Linhas CHAVE=valor (ignora comentários). raw = o que está depois do "=", como foi escrito. */
function parse(text) {
  const out = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line); if (!m) return;
    const raw = m[2].trim(); let v = raw; const q = v[0];
    if (q === '"' || q === "'") { const end = v.lastIndexOf(q); v = end > 0 ? v.slice(1, end) : v.slice(1); } else v = v.replace(/\s+#.*$/, '').trim();
    out.push({ key: m[1], value: v, raw, line: i + 1 });
  });
  return out;
}
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return ''; } };
const files = (site) => ({ env: path.join(site.path, '.env'), example: EXAMPLES.map((n) => path.join(site.path, n)).find(exists) || '' });
const lastWins = (list) => { const m = new Map(); list.forEach((e) => m.set(e.key, e)); return m; }; // phpdotenv e dotenv: repetida, vale uma só; mostramos a última

/** Comparação completa para a tela (sem valores sensíveis). */
function compare(site) {
  const f = files(site); const hasEnv = exists(f.env); const hasExample = !!f.example;
  const env = lastWins(parse(read(f.env))); const ex = lastWins(hasExample ? parse(read(f.example)) : []);
  const entries = [...env.values()].map((e) => ({ key: e.key, secret: isSecret(e.key), set: e.value !== '', value: isSecret(e.key) ? '' : e.value, inExample: ex.has(e.key) }));
  const missing = [...ex.values()].filter((e) => !env.has(e.key)).map((e) => ({ key: e.key, secret: isSecret(e.key), example: isSecret(e.key) ? '' : e.value }));
  const extra = hasExample ? entries.filter((e) => !e.inExample).map((e) => e.key) : [];
  const empty = entries.filter((e) => !e.set && ((ex.get(e.key) && ex.get(e.key).value !== '') || e.key === 'APP_KEY')).map((e) => e.key);
  return { hasEnv, hasExample, exampleName: f.example ? path.basename(f.example) : '', entries, missing, extra, empty };
}
const summary = (site) => { const c = compare(site); return { hasEnv: c.hasEnv, hasExample: c.hasExample, missing: c.missing.length, extra: c.extra.length, empty: c.empty.length }; };

function fmtValue(v) {
  v = String(v);
  if (/[\r\n\0]/.test(v)) throw new Error('O valor não pode ter quebra de linha.');
  if (v.length > 2000) throw new Error('Valor muito longo (máximo 2000 caracteres).');
  if (v === '') return '';
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(v)) return v;
  if (!v.includes('$')) return '"' + v.replace(/[\\"]/g, '\\$&') + '"'; // aspas duplas, escapando \ e "
  if (!v.includes("'")) return "'" + v + "'";                            // com $ e sem ': aspas simples (sem expansão de variáveis)
  throw new Error("Valor com aspas simples (') e cifrão ($) juntos não é suportado.");
}

function backup(f) { if (exists(f)) fs.copyFileSync(f, f + '.backup'); }
const nlOf = (t) => (t.includes('\r\n') ? '\r\n' : '\n');
const stamp = () => new Date().toLocaleDateString('pt-BR');

/** Grava CHAVE=valor: troca a primeira linha da chave ou acrescenta no fim. */
function set(site, key, value) {
  if (!KEY_RE.test(String(key))) throw new Error('Nome de variável inválido (letras, números e _; não pode começar com número).');
  const f = files(site).env; if (!exists(f)) throw new Error('Este projeto não tem .env. Crie-o a partir do .env.example primeiro.');
  const text = read(f); const nl = nlOf(text); const val = fmtValue(value);
  const re = new RegExp(`^(\\s*(?:export\\s+)?)${key}\\s*=.*$`, 'm');
  backup(f);
  fs.writeFileSync(f, re.test(text) ? text.replace(re, (m, pre) => `${pre}${key}=${val}`) : text.replace(/\s*$/, '') + nl + `${key}=${val}` + nl);
}

/** Acrescenta ao .env as chaves que só existem no exemplo (todas, ou as informadas), copiando o valor do exemplo como está. */
function addMissing(site, keys) {
  const f = files(site); if (!exists(f.env)) throw new Error('Este projeto não tem .env.'); if (!f.example) throw new Error('Este projeto não tem .env.example.');
  const env = lastWins(parse(read(f.env))); const ex = lastWins(parse(read(f.example)));
  const want = (Array.isArray(keys) && keys.length ? keys : [...ex.keys()]).filter((k) => KEY_RE.test(k) && ex.has(k) && !env.has(k));
  if (!want.length) return [];
  const text = read(f.env); const nl = nlOf(text);
  backup(f.env);
  fs.writeFileSync(f.env, text.replace(/\s*$/, '') + nl + nl + `# Adicionadas pelo RDR Local em ${stamp()}` + nl + want.map((k) => `${k}=${ex.get(k).raw}`).join(nl) + nl);
  return want;
}

/** Cria o .env a partir do exemplo (só se ainda não existir). */
function init(site) {
  const f = files(site); if (exists(f.env)) throw new Error('O .env já existe.'); if (!f.example) throw new Error('Não achei .env.example (nem .env.sample ou .env.dist).');
  fs.copyFileSync(f.example, f.env);
}

module.exports = { compare, summary, set, addMissing, init, parse, isSecret, KEY_RE };

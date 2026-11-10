// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * rdr.json: a configuração do projeto dentro do repositório (domínio, PHP, banco, serviços, variáveis).
 * Quem clona o projeto aplica o arquivo e o RDR Local monta site, banco e serviços iguais aos dos colegas.
 *
 * Segurança: só campos declarativos, todos validados (os mesmos validadores do cadastro de sites). Nada é executado
 * sem confirmação: o comando de um app (app.cmd) só roda se o usuário confirmar (confirmCmd). Variáveis de ambiente
 * NÃO são exportadas, para não vazar segredo no Git; podem ser escritas à mão em "env".
 */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const comps = require('./components');
const sites = require('./sites');
const { cfg, exists, isDir } = core;

const FILE = 'rdr.json';
const KEYS = ['rdr', 'name', 'domain', 'aliases', 'type', 'php', 'docroot', 'cors', 'env', 'database', 'services', 'app'];
const SERVICES = ['mariadb', 'postgres', 'redis', 'mailpit', 'meilisearch'];
const ENGINES = ['mariadb', 'postgres'];
const RUNTIMES = ['node', 'python', 'go', 'java', 'custom'];
const SVC_LABEL = { mariadb: 'MariaDB', postgres: 'PostgreSQL', redis: 'Redis', mailpit: 'Mailpit', meilisearch: 'Meilisearch' };
const services = () => require('./services');
const db = () => require('./db');
const projects = () => require('./projects');
const apps = () => require('./apps');

function read(dir) {
  const file = path.join(dir, FILE);
  if (!exists(file)) throw new Error(`Não achei o ${FILE} em ${dir}.`);
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.length > 50000) throw new Error(`${FILE} grande demais (máximo 50 KB).`);
  let j;
  try { j = JSON.parse(raw.replace(/^﻿/, '')); } catch (e) { throw new Error(`${FILE} não é um JSON válido: ${e.message}`); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(`${FILE} deve ser um objeto JSON.`);
  return j;
}

/** Valida o arquivo e monta tudo o que seria feito. Nunca lança: os problemas vão em errors. */
function build(dir) {
  const errors = []; const warnings = [];
  const err = (m) => errors.push(m); const warn = (m) => warnings.push(m);
  const out = { dir, errors, warnings, input: null, cleaned: null, current: null, database: null, svc: [], type: 'php' };
  let j;
  try { j = read(dir); } catch (e) { err(e.message); return out; }
  if (j.rdr !== 1) err('O campo "rdr" deve ser 1 (versão do formato).');
  for (const k of Object.keys(j)) if (!KEYS.includes(k)) warn(`Campo desconhecido ignorado: "${k}".`);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const type = j.type === undefined ? 'php' : j.type;
  if (!['php', 'app'].includes(type)) err('"type" deve ser "php" ou "app".');
  out.type = type === 'app' ? 'app' : 'php';

  const input = { type: out.type, name: str(j.name, 60) || path.basename(dir), path: dir, cors: !!j.cors };
  if (str(j.domain, 120)) input.domain = str(j.domain, 120);
  if (j.aliases !== undefined) { if (Array.isArray(j.aliases)) input.aliases = j.aliases.map(String).join(','); else err('"aliases" deve ser uma lista.'); }
  if (j.env !== undefined) { if (j.env && typeof j.env === 'object' && !Array.isArray(j.env)) input.env = j.env; else err('"env" deve ser um objeto CHAVE: valor.'); }

  if (out.type === 'php') {
    if (j.php !== undefined) {
      const v = str(String(j.php), 8);
      if (v && !comps.phpInstalled().includes(v)) { warn(`PHP ${v} não está instalado: vai usar o padrão (${comps.phpDefault() || 'nenhum'}). Instale em Componentes e PHP.`); input.php = 'default'; } else input.php = v || 'default';
    }
    if (j.docroot !== undefined) input.docroot = str(String(j.docroot), 120) || 'auto';
  } else {
    const a = j.app;
    if (!a || typeof a !== 'object' || Array.isArray(a)) err('"type": "app" exige o bloco "app" com "cmd".');
    else {
      const runtime = a.runtime === undefined ? 'custom' : String(a.runtime);
      if (!RUNTIMES.includes(runtime)) err(`app.runtime deve ser ${RUNTIMES.join(', ')}.`);
      Object.assign(input, { runtime, rtVersion: String(a.rtVersion || 'default'), cmd: str(a.cmd, 500), autoStart: a.autoStart !== false });
      if (!input.cmd) err('app.cmd é obrigatório (comando que inicia o app).');
      if (a.appPort !== undefined) input.appPort = Number(a.appPort);
    }
  }

  if (j.database !== undefined) {
    const d = j.database;
    if (!d || typeof d !== 'object' || !ENGINES.includes(d.engine)) err(`"database.engine" deve ser ${ENGINES.join(' ou ')}.`);
    else { try { db().assertName(d.name); out.database = { engine: d.engine, name: String(d.name) }; } catch (e) { err('database.name: ' + e.message); } }
  }
  if (j.services !== undefined) {
    if (!Array.isArray(j.services)) err('"services" deve ser uma lista.');
    else for (const s of j.services) { if (SERVICES.includes(s)) { if (!out.svc.includes(s)) out.svc.push(s); } else err(`Serviço desconhecido em "services": "${s}" (use ${SERVICES.join(', ')}).`); }
  }
  if (out.database && !out.svc.includes(out.database.engine)) out.svc.unshift(out.database.engine);

  if (!errors.length) {
    out.current = cfg.sites.find((s) => s.path === dir) || null;
    try { out.cleaned = sites.clean({ ...input }, out.current || undefined); } catch (e) { err(e.message); }
  }
  out.input = input;
  return out;
}

/** O que seria feito (para mostrar antes de aplicar). */
function plan(dir) {
  const b = build(path.resolve(String(dir || '')));
  const steps = [];
  if (!b.errors.length) {
    const c = b.cleaned;
    steps.push(b.current ? `Atualizar o site existente: ${c.domain}` : `Criar o site ${c.domain}`);
    if (c.type === 'php') steps.push(`PHP ${c.php === 'default' ? 'padrão' : c.php}, pasta pública: ${c.docroot === 'auto' ? 'automática' : c.docroot}`);
    if (c.aliases && c.aliases.length) steps.push(`Aliases: ${c.aliases.join(', ')}`);
    if (c.env && Object.keys(c.env).length) steps.push(`Variáveis de ambiente do site: ${Object.keys(c.env).join(', ')}`);
    if (b.svc.length) {
      const ok = b.svc.filter((s) => services().SV[s] && services().SV[s].installed()); const no = b.svc.filter((s) => !ok.includes(s));
      if (ok.length) steps.push(`Ligar os serviços: ${ok.map((s) => SVC_LABEL[s]).join(', ')}`);
      if (no.length) b.warnings.push(`Não instalado (aba Componentes), será ignorado: ${no.map((s) => SVC_LABEL[s]).join(', ')}.`);
    }
    if (b.database) steps.push(`Criar o banco "${b.database.name}" no ${SVC_LABEL[b.database.engine]} (se ainda não existir)`);
    if (exists(path.join(dir, '.env')) && (b.database || b.svc.length || c.type === 'php')) steps.push('Ajustar o .env do projeto (APP_URL, banco, e-mail e Redis conforme o arquivo)');
    if (c.type === 'app') steps.push(`O app roda este comando na sua máquina: ${c.cmd}`);
  }
  return {
    file: path.join(b.dir, FILE), dir: b.dir, name: b.input ? b.input.name : '', domain: b.cleaned ? b.cleaned.domain : '', type: b.type,
    exists: !!b.current, siteId: b.current ? b.current.id : '', steps, warnings: b.warnings, errors: b.errors,
    needsConfirm: b.cleaned && b.cleaned.type === 'app' ? b.cleaned.cmd : '',
  };
}

/** Aplica: liga serviços, cria o banco, ajusta o .env e cria/atualiza o site. Repetir não duplica nada. */
async function apply(dir, opts = {}, jl = () => {}) {
  const b = build(path.resolve(String(dir || '')));
  if (b.errors.length) throw new Error(b.errors.join(' '));
  const c = b.cleaned;
  if (c.type === 'app' && !opts.confirmCmd) throw new Error(`Este projeto roda o comando "${c.cmd}" na sua máquina. Confirme para aplicar.`);
  b.warnings.forEach((w) => jl('⚠ ' + w));
  const sv = services();

  for (const s of b.svc) {
    if (!sv.SV[s] || !sv.SV[s].installed()) { jl(`${SVC_LABEL[s]} não está instalado: ignorado.`); continue; }
    if (sv.isRunning(s)) { jl(`${SVC_LABEL[s]} já está ligado.`); continue; }
    jl(`Ligando ${SVC_LABEL[s]}...`);
    try { await sv.start(s); } catch (e) { jl(`⚠ Não consegui ligar o ${SVC_LABEL[s]}: ${e.message.split('\n')[0]}`); }
  }

  if (b.database) {
    const { engine, name } = b.database;
    if (!sv.isRunning(engine)) jl(`⚠ ${SVC_LABEL[engine]} não está ligado: o banco "${name}" não foi criado.`);
    else {
      try {
        const have = (await db().list(engine)).some((d) => d.name === name);
        if (have) jl(`Banco "${name}" já existe.`); else { await db().create(engine, name); jl(`Banco "${name}" criado no ${SVC_LABEL[engine]}.`); }
      } catch (e) { jl(`⚠ Banco "${name}" não criado: ${e.message.split('\n')[0]}`); }
    }
  }

  const site = b.current ? await sites.update(b.current.id, { ...b.input }) : await sites.add({ ...b.input });
  jl(`${b.current ? 'Site atualizado' : 'Site criado'}: ${sites.baseUrl(site.domain)}`);

  const envFile = path.join(dir, '.env');
  if (exists(envFile)) {
    const vars = {};
    if (c.type === 'php') vars.APP_URL = sites.baseUrl(site.domain);
    if (b.database) {
      const pg = b.database.engine === 'postgres';
      Object.assign(vars, { DB_CONNECTION: pg ? 'pgsql' : 'mariadb', DB_HOST: '127.0.0.1', DB_PORT: String(pg ? cfg.ports.postgres : cfg.ports.mariadb), DB_DATABASE: b.database.name, DB_USERNAME: pg ? 'postgres' : 'root', DB_PASSWORD: '' });
    }
    if (b.svc.includes('mailpit')) Object.assign(vars, { MAIL_MAILER: 'smtp', MAIL_HOST: '127.0.0.1', MAIL_PORT: String(cfg.ports.mailpitSmtp) });
    if (b.svc.includes('redis')) Object.assign(vars, { REDIS_HOST: '127.0.0.1', REDIS_PORT: String(cfg.ports.redis) });
    if (Object.keys(vars).length) { projects().patchEnv(envFile, vars); jl(`.env ajustado: ${Object.keys(vars).join(', ')}.`); }
  }

  if (c.type === 'app' && c.autoStart !== false && sv.isRunning('web')) {
    jl('Iniciando o app...');
    await apps().start(site.id).catch((e) => jl('⚠ Não consegui iniciar o app: ' + e.message.split('\n')[0]));
  }
  jl('Pronto.');
  return { site, warnings: b.warnings };
}

/** Lê um .env simples (CHAVE=valor) para adivinhar banco, Redis e Mailpit ao exportar. */
function dotenv(file) {
  const o = {};
  try { for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l); if (m && !l.trim().startsWith('#')) o[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2'); } } catch (_) { /* sem .env */ }
  return o;
}

/** Gera o rdr.json a partir de um site já configurado (sem variáveis de ambiente, para não vazar segredo no Git). */
function exportSite(id, { overwrite = false } = {}) {
  const s = cfg.sites.find((x) => x.id === id); if (!s) throw new Error('Site não encontrado.');
  if (!s.path || !['php', 'app'].includes(s.type || 'php')) throw new Error('Só sites com pasta (PHP ou app) geram rdr.json.');
  if (!isDir(s.path)) throw new Error('A pasta do projeto não existe: ' + s.path);
  const file = path.join(s.path, FILE);
  if (exists(file) && !overwrite) throw new Error(`O ${FILE} já existe nesta pasta.`);
  const spec = { rdr: 1, name: s.name, domain: s.domain };
  if ((s.aliases || []).length) spec.aliases = s.aliases;
  spec.type = s.type === 'app' ? 'app' : 'php';
  if (spec.type === 'php') {
    if (s.php && !['default', 'none'].includes(s.php)) spec.php = s.php;
    if (s.docroot && s.docroot !== 'auto') spec.docroot = s.docroot;
  } else {
    spec.app = { runtime: s.runtime || 'custom', ...(s.rtVersion && s.rtVersion !== 'default' ? { rtVersion: s.rtVersion } : {}), cmd: s.cmd, ...(s.autoStart === false ? { autoStart: false } : {}) };
  }
  if (s.cors) spec.cors = true;
  const e = dotenv(path.join(s.path, '.env')); const svc = [];
  const conn = String(e.DB_CONNECTION || '').toLowerCase();
  const engine = ['mysql', 'mariadb'].includes(conn) ? 'mariadb' : ['pgsql', 'postgres'].includes(conn) ? 'postgres' : '';
  if (engine && e.DB_DATABASE) { try { db().assertName(e.DB_DATABASE); spec.database = { engine, name: e.DB_DATABASE }; svc.push(engine); } catch (_) { /* nome fora do padrão: não exporta */ } }
  if ([e.CACHE_STORE, e.CACHE_DRIVER, e.QUEUE_CONNECTION, e.SESSION_DRIVER].some((v) => String(v || '').toLowerCase() === 'redis')) svc.push('redis');
  if (e.MAIL_HOST === '127.0.0.1' && Number(e.MAIL_PORT) === Number(cfg.ports.mailpitSmtp)) svc.push('mailpit');
  if (svc.length) spec.services = svc;
  fs.writeFileSync(file, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  return { file, spec };
}

module.exports = { FILE, plan, apply, exportSite };

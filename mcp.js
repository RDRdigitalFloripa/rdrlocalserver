#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Servidor MCP (stdio) do RDR Local — deixa Claude, Cursor, Codex etc. consultarem e controlarem o ambiente local.
 * Fala com o painel em http://127.0.0.1:7070 (o RDR Local precisa estar aberto). Sem dependências.
 *
 * Segurança: nada destrutivo é exposto (sem excluir banco/site, sem migrate:fresh).
 * O terminal (rdr_terminal) só existe se a variável RDR_MCP_ALLOW_SHELL=1 estiver definida no cliente MCP.
 */
const http = require('http');
const PORT = Number(process.env.RDR_PORT || 7070);
const ALLOW_SHELL = process.env.RDR_MCP_ALLOW_SHELL === '1';
const SERVICES = ['web', 'mariadb', 'postgres', 'redis', 'mailpit', 'meilisearch', 'dns'];

function call(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: url, method, headers: { 'X-RDR': '1', 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let t = ''; res.on('data', (d) => { t += d; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(t); } catch (_) { /* ok */ } if (res.statusCode >= 400) reject(new Error(j.error || `HTTP ${res.statusCode}`)); else resolve(j); });
    });
    req.on('error', () => reject(new Error(`O RDR Local não está rodando (porta ${PORT}). Peça ao usuário para abrir o start.bat.`)));
    if (data) req.write(data);
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function findSite(q) {
  const s = await call('GET', '/api/state');
  const k = String(q || '').toLowerCase();
  const x = s.sites.find((v) => v.id === q || v.domain === k || v.name.toLowerCase() === k);
  if (!x) throw new Error(`Site não encontrado: ${q}. Sites: ${s.sites.map((v) => v.domain).join(', ')}`);
  return x;
}
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });

const TOOLS = [
  { name: 'rdr_status', description: 'Estado dos serviços do RDR Local (web, MariaDB, PostgreSQL, Redis, Mailpit, Meilisearch) com portas e se estão ligados.', readOnly: true, schema: { type: 'object', properties: {} },
    run: async () => { const s = await call('GET', '/api/state'); return text({ serviços: s.services.map((v) => ({ id: v.id, instalado: v.installed, ligado: v.running, portas: v.ports })), terminação: s.settings.tld, phpPadrão: s.php.default, conexões: s.connection }); } },
  { name: 'rdr_sites', description: 'Lista os sites cadastrados (domínio, tipo, pasta, PHP, aliases, URL).', readOnly: true, schema: { type: 'object', properties: {} },
    run: async () => { const s = await call('GET', '/api/state'); return text(s.sites.map((x) => ({ nome: x.name, url: x.url, tipo: x.kind, pasta: x.path || undefined, destino: x.target || undefined, php: x.phpResolved || undefined, aliases: x.aliases, ativo: x.enabled !== false }))); } },
  { name: 'rdr_doctor', description: 'Roda o Diagnóstico (hosts, certificado, extensões do PHP, portas, bancos, .env dos projetos) e devolve problemas e avisos.', readOnly: true, schema: { type: 'object', properties: {} },
    run: async () => { const r = await call('GET', '/api/doctor'); return text({ resumo: r.summary, itens: r.checks.filter((c) => c.status !== 'ok').map((c) => ({ status: c.status, grupo: c.group, item: c.label, detalhe: c.detail })) }); } },
  { name: 'rdr_logs', description: 'Últimas linhas de um log. name: web, mariadb, postgres, redis, mailpit, meilisearch, php-8.4, site:<domínio>, laravel:<id do site>.', readOnly: true,
    schema: { type: 'object', properties: { name: { type: 'string' }, linhas: { type: 'integer', minimum: 1, maximum: 500, default: 80 } }, required: ['name'] },
    run: async (a) => { const r = await call('GET', `/api/log?name=${encodeURIComponent(a.name)}`); return text(String(r.text || '').split(/\r?\n/).slice(-(a.linhas || 80)).join('\n') || '(vazio)'); } },
  { name: 'rdr_databases', description: 'Lista os bancos de dados (nome e tamanho em MB) de um motor ligado.', readOnly: true,
    schema: { type: 'object', properties: { engine: { type: 'string', enum: ['mariadb', 'postgres'] } }, required: ['engine'] },
    run: async (a) => text((await call('GET', `/api/db/list?engine=${encodeURIComponent(a.engine)}`)).databases) },
  { name: 'rdr_jobs', description: 'Tarefas recentes (instalações, backups, artisan) com status e as últimas linhas do log.', readOnly: true, schema: { type: 'object', properties: {} },
    run: async () => text((await call('GET', '/api/state')).jobs) },
  { name: 'rdr_service', description: 'Liga, desliga ou reinicia um serviço (ou "all").', readOnly: false,
    schema: { type: 'object', properties: { service: { type: 'string', enum: [...SERVICES, 'all'] }, action: { type: 'string', enum: ['start', 'stop', 'restart'] } }, required: ['service', 'action'] },
    run: async (a) => { await call('POST', '/api/svc', { id: a.service, action: a.action }); return text(`${a.service}: ${a.action} ok`); } },
  { name: 'rdr_create_database', description: 'Cria um banco (letras, números e _).', readOnly: false,
    schema: { type: 'object', properties: { engine: { type: 'string', enum: ['mariadb', 'postgres'] }, name: { type: 'string' } }, required: ['engine', 'name'] },
    run: async (a) => { await call('POST', '/api/db/create', a); return text(`Banco ${a.name} criado em ${a.engine}.`); } },
  { name: 'rdr_backup_now', description: 'Faz backup de todos os bancos (não-sistema) dos motores ligados.', readOnly: false, schema: { type: 'object', properties: {} },
    run: async () => { await call('POST', '/api/backup/run-all', {}); return text('Backup iniciado. Use rdr_jobs para acompanhar.'); } },
  { name: 'rdr_artisan', description: 'Roda um comando seguro no projeto Laravel/PHP do site: migrate, clear (optimize:clear), storage-link ou composer-install. Resultado em rdr_jobs.', readOnly: false,
    schema: { type: 'object', properties: { site: { type: 'string', description: 'domínio, nome ou id' }, command: { type: 'string', enum: ['migrate', 'clear', 'storage-link', 'composer-install'] } }, required: ['site', 'command'] },
    run: async (a) => { const s = await findSite(a.site); await call('POST', '/api/sites/artisan', { id: s.id, cmd: a.command }); return text(`${a.command} iniciado em ${s.domain}. Use rdr_jobs para ver o resultado.`); } },
];
if (ALLOW_SHELL) {
  TOOLS.push({ name: 'rdr_terminal', description: 'Executa UM comando no terminal da pasta do projeto (PHP/Composer do site no PATH) e devolve a saída. Cuidado: executa código arbitrário na máquina do usuário.', readOnly: false,
    schema: { type: 'object', properties: { site: { type: 'string' }, command: { type: 'string' }, timeout_s: { type: 'integer', minimum: 1, maximum: 120, default: 60 } }, required: ['site', 'command'] },
    run: async (a) => {
      const s = await findSite(a.site); const r = await call('POST', '/api/term/run', { id: s.id, cmd: a.command });
      const end = Date.now() + (a.timeout_s || 60) * 1000; let from = 0; let outTxt = ''; let st;
      for (;;) {
        st = await call('GET', `/api/term/out?run=${r.run}&from=${from}`); outTxt += st.chunks.join(''); from = st.next;
        if (st.done || Date.now() > end) break; await sleep(300);
      }
      if (!st.done) { await call('POST', '/api/term/kill', { run: r.run }).catch(() => {}); outTxt += '\n[tempo esgotado: comando interrompido]'; }
      return text(`cwd: ${st.cwd}\ncódigo de saída: ${st.code}\n\n${outTxt.slice(-20000)}`);
    } });
}

// ---------- protocolo MCP (JSON-RPC por linhas no stdin/stdout) ----------
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => { if (id !== undefined) send({ jsonrpc: '2.0', id, result }); };
  const fail = (code, message) => { if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code, message } }); };
  switch (method) {
    case 'initialize': return reply({ protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'rdr-local', version: '1.0.0' },
      instructions: 'Controla o ambiente local RDR Local (Caddy/PHP/bancos/sites .test). Nada destrutivo é exposto. Use rdr_doctor antes de investigar problemas.' });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema, annotations: { readOnlyHint: !!t.readOnly, destructiveHint: false, openWorldHint: false } })) });
    case 'tools/call': {
      const t = TOOLS.find((x) => x.name === (params && params.name));
      if (!t) return fail(-32602, 'Ferramenta desconhecida: ' + (params && params.name));
      try { return reply(await t.run((params && params.arguments) || {})); } catch (e) { return reply({ isError: true, content: [{ type: 'text', text: e.message }] }); }
    }
    default: if (id !== undefined) fail(-32601, 'Método não suportado: ' + method);
  }
}
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch (_) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }); continue; }
    handle(msg).catch((e) => process.stderr.write('erro: ' + e.message + '\n'));
  }
});
process.stdin.on('end', () => process.exit(0));

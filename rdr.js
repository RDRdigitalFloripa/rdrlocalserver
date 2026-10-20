#!/usr/bin/env node
'use strict';
/** CLI do RDR Local: conversa com o painel em execução (http://127.0.0.1:7070). Uso: rdr ajuda */
const http = require('http');
const PORT = Number(process.env.RDR_PORT || 7070);
const NAMES = { web: 'Servidor Web', mariadb: 'MariaDB', postgres: 'PostgreSQL', redis: 'Redis', mailpit: 'Mailpit', meilisearch: 'Meilisearch', dns: 'DNS local' };

function call(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: url, method, headers: { 'X-RDR': '1', 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let t = ''; res.on('data', (d) => { t += d; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(t); } catch (_) { /* ok */ } if (res.statusCode >= 400) reject(new Error(j.error || `HTTP ${res.statusCode}`)); else resolve(j); });
    });
    req.on('error', () => reject(new Error(`O RDR Local não está rodando (porta ${PORT}). Abra o start.bat primeiro.`)));
    if (data) req.write(data);
    req.end();
  });
}
const pad = (s, n) => String(s).padEnd(n);
const HELP = `RDR Local — linha de comando

  rdr status                  mostra serviços e portas
  rdr start [serviço|all]     liga (padrão: all)
  rdr stop [serviço|all]      desliga (padrão: all)
  rdr restart <serviço>       reinicia
  rdr sites                   lista os sites e endereços
  rdr open <domínio>          abre o site no navegador
  rdr doctor                  roda o Diagnóstico
  rdr backup                  backup de todos os bancos agora

Serviços: ${Object.keys(NAMES).join(', ')}`;

async function main() {
  const [cmd = 'ajuda', arg] = process.argv.slice(2);
  switch (cmd) {
    case 'status': {
      const s = await call('GET', '/api/state');
      for (const v of s.services) console.log(`${v.running ? '●' : '○'} ${pad(v.id, 12)} ${pad(v.running ? 'ligado' : v.installed ? 'parado' : 'não instalado', 14)} ${v.ports.join(' / ')}`);
      break;
    }
    case 'start': case 'stop': case 'restart': {
      const id = arg || (cmd === 'restart' ? '' : 'all');
      if (!id) throw new Error('Informe o serviço: rdr restart <serviço>');
      if (id !== 'all' && !NAMES[id]) throw new Error('Serviço desconhecido: ' + id);
      await call('POST', '/api/svc', { id, action: cmd });
      console.log(`${id}: ${cmd} ok`);
      break;
    }
    case 'sites': {
      const s = await call('GET', '/api/state');
      for (const x of s.sites) console.log(`${x.enabled === false ? '–' : '•'} ${pad(x.url, 34)} ${pad(x.kind, 16)} ${x.path || x.target || ''}`);
      break;
    }
    case 'open': {
      if (!arg) throw new Error('Informe o domínio: rdr open meu-site.test');
      const s = await call('GET', '/api/state'); const x = s.sites.find((v) => v.domain === arg || v.name.toLowerCase() === arg.toLowerCase());
      if (!x) throw new Error('Site não encontrado: ' + arg);
      const { spawn } = require('child_process');
      if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', x.url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref(); else console.log(x.url);
      break;
    }
    case 'doctor': {
      const r = await call('GET', '/api/doctor');
      for (const c of r.checks) console.log(`${c.status === 'ok' ? '✔' : c.status === 'warn' ? '!' : '✘'} ${c.label}: ${c.detail}`);
      console.log(`\n${r.summary.bad} problema(s), ${r.summary.warn} aviso(s), ${r.summary.ok} ok`);
      process.exitCode = r.summary.bad ? 1 : 0;
      break;
    }
    case 'backup': await call('POST', '/api/backup/run-all', {}); console.log('Backup iniciado (acompanhe no painel).'); break;
    case 'ajuda': case 'help': case '--help': case '-h': console.log(HELP); break;
    default: console.error('Comando desconhecido: ' + cmd + '\n'); console.log(HELP); process.exitCode = 2;
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });

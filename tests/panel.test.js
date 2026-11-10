// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Painel: estado, versão, configurações, atualização do próprio app (release simulada), segurança da API e métricas (CPU, memória, disco, rede). */
const fs = require('fs');
const path = require('path');
const http = require('http');
const h = require('./lib/harness');

const VERSION = require('../package.json').version;
const REL = { version: '99.0.0', notes: 'release simulada pelo teste', url: 'https://github.com/RDRdigitalFloripa/rdrlocalserver/releases/tag/v99.0.0', exe: 'https://example.com/RDR-Local-Setup-99.0.0.exe', sha: 'https://example.com/RDR-Local-Setup-99.0.0.sha256', ready: true };
/** Requisição crua, para controlar o cabeçalho Host e o caminho exato. */
const raw = (port, opts) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, ...opts }, (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); });
  req.on('error', (e) => resolve({ status: 0, text: e.message })); req.end();
});

h.run(async () => {
  h.isolateHome();
  const srv = await h.startServer({ env: { RDR_FAKE_APP_RELEASE: JSON.stringify(REL) } });
  const call = srv.call; const www = h.tmp('www');

  h.title('estado e versão');
  let r = await call('GET', '/api/state');
  h.ok(r.status === 200 && r.j.version === VERSION, 'versão do /api/state é a do package.json', `${r.j.version} x ${VERSION}`);
  h.ok(r.j.settings.projectDocs === true, 'padrão: arquivos para agentes de IA ligados');
  h.ok(r.j.updates && r.j.updates.pending === 0, 'selo de atualizações sem consulta: 0');
  const index = await raw(srv.port, { path: '/', headers: { Host: `127.0.0.1:${srv.port}` } });
  h.ok(index.status === 200 && index.text.includes(`RDR LOCAL SERVER v${VERSION}`), 'a tela mostra a mesma versão no rodapé');

  h.title('atualização do próprio app');
  r = await call('GET', '/api/updates?fresh=1');
  h.ok(r.status === 200 && r.j.app && r.j.app.latest === '99.0.0' && r.j.app.updatable === true && r.j.app.current === VERSION, 'GET /api/updates devolve o app 99.0.0 como atualizável', JSON.stringify(r.j.app));
  r = await call('GET', '/api/state');
  h.ok(r.j.updates.pending >= 1 && r.j.updates.app === true, 'o selo conta a atualização do app', JSON.stringify(r.j.updates));
  await call('POST', '/api/updates/app', {});
  const uj = await srv.waitJob('Atualizar o RDR Local');
  h.ok(uj && uj.status === 'error' && /Endereço de download inesperado/.test(uj.log.join('\n')), 'recusa baixar de fora de github.com/…/releases/download', uj && uj.log.join(' | '));

  h.title('configurações e arquivos para agentes de IA');
  await call('POST', '/api/settings', { projectDocs: false, autoCheckUpdates: false });
  r = await call('GET', '/api/state'); h.ok(r.j.settings.projectDocs === false && r.j.settings.autoCheckUpdates === false, 'POST /api/settings desliga as duas opções');
  r = await call('GET', '/api/config/export'); h.ok(r.j.projectDocs === false, 'a exportação inclui projectDocs');
  await call('POST', '/api/project', { type: 'empty', name: 'Sem Docs', dir: www }); await srv.waitJob('Novo projeto empty: Sem Docs');
  h.ok(fs.existsSync(path.join(www, 'sem-docs', 'index.php')) && !fs.existsSync(path.join(www, 'sem-docs', 'CLAUDE.md')), 'projectDocs desligado: o projeto nasce sem CLAUDE.md');
  await call('POST', '/api/settings', { projectDocs: true });
  await call('POST', '/api/project', { type: 'empty', name: 'Com Docs', dir: www });
  const pj = await srv.waitJob('Novo projeto empty: Com Docs'); const d = path.join(www, 'com-docs');
  h.ok(fs.existsSync(path.join(d, 'CLAUDE.md')) && fs.existsSync(path.join(d, 'AGENTS.md')), 'projectDocs ligado: CLAUDE.md e AGENTS.md criados por /api/project');
  const docs = fs.existsSync(path.join(d, 'docs')) ? fs.readdirSync(path.join(d, 'docs')).sort() : [];
  h.ok(docs.length === 4 && /^01-\d\d-\d\d-\d{4}-visao-geral\.md$/.test(docs[0]), 'docs/ criada com a visão geral e o plano', docs.join(','));
  h.ok(pj && pj.status === 'done' && /Arquivos para agentes de IA e documentação: CLAUDE\.md, AGENTS\.md, docs\/01-/.test(pj.log.join('\n')), 'o log da tarefa lista os arquivos criados', pj && pj.log.join(' | '));
  r = await call('POST', '/api/apps/new', { name: 'App Teste', dir: www, template: '', runtime: 'custom', cmd: 'node -e "1"', installDeps: false });
  const app = path.join(www, 'app-teste');
  await h.waitFor(() => fs.existsSync(path.join(app, 'docs')));
  h.ok(r.status === 200 && fs.existsSync(path.join(app, 'CLAUDE.md')) && fs.existsSync(path.join(app, 'AGENTS.md')) && fs.existsSync(path.join(app, 'docs')), 'POST /api/apps/new (projeto novo): CLAUDE.md, AGENTS.md e docs/ criados');
  h.ok(/node -e "1"/.test(fs.existsSync(path.join(app, 'CLAUDE.md')) ? h.read(path.join(app, 'CLAUDE.md')) : ''), 'o CLAUDE.md do app traz o comando de execução');
  const ex = h.mkdir(www, 'existente');
  r = await call('POST', '/api/apps/new', { name: 'Existente', dir: ex, template: 'existing', runtime: 'custom', cmd: 'node -e "1"', installDeps: false });
  await h.sleep(2000);
  h.ok(r.status === 200 && fs.readdirSync(ex).length === 0, 'pasta existente (modelo "existing"): nada é adicionado');

  h.title('segurança da API');
  r = await raw(srv.port, { path: '/api/state', headers: { Host: 'evil.example.com' } });
  h.ok(r.status === 403, 'Host desconhecido (DNS rebinding): 403', String(r.status));
  r = await raw(srv.port, { path: '/api/settings', method: 'POST', headers: { Host: `127.0.0.1:${srv.port}`, 'Content-Type': 'application/json' } });
  h.ok(r.status === 403, 'POST sem o cabeçalho X-RDR (CSRF): 403', String(r.status));
  r = await raw(srv.port, { path: '/api/nao-existe', headers: { Host: `127.0.0.1:${srv.port}` } });
  h.ok(r.status === 404, 'rota inexistente: 404', String(r.status));
  for (const p of ['/../server.js', '/%2e%2e/server.js', '/..%5cserver.js', '/public/../../server.js']) {
    r = await raw(srv.port, { path: p, headers: { Host: `127.0.0.1:${srv.port}` } });
    h.ok(r.status !== 200 && !r.text.includes("'use strict'"), `não serve arquivo fora de public/ (${p} -> ${r.status})`);
  }

  h.title('métricas: CPU, memória, disco e rede');
  r = await call('GET', '/api/host-status');
  h.ok(r.status === 200 && typeof r.j.cpu === 'number' && r.j.mem.total > 0 && r.j.disk.total > 0, 'CPU, memória e disco');
  h.ok(r.j.net && typeof r.j.net.ok === 'boolean' && Array.isArray(r.j.net.rxHistory) && Array.isArray(r.j.net.txHistory), 'rede: campos presentes', JSON.stringify(r.j.net).slice(0, 200));
  await h.sleep(5000); r = await call('GET', '/api/host-status'); const net = r.j.net;
  if (net.ok) {
    h.ok(net.rxHistory.length >= 2 && net.rxHistory.length === net.txHistory.length, 'rede: o histórico cresce enquanto o painel pergunta', String(net.rxHistory.length));
    h.ok(net.rx >= 0 && net.tx >= 0 && net.totalRx > 0 && net.totalTx > 0 && [...net.rxHistory, ...net.txHistory].every((v) => v >= 0 && v < 1e11), 'rede: taxas e totais plausíveis (sem picos negativos ou absurdos)', JSON.stringify({ rx: net.rx, tx: net.tx }));
  } else h.skip('rede: contadores indisponíveis neste sistema (a tela mostra "Indisponível neste sistema")');
  const { delta } = require('../lib/sysinfo');
  h.ok(delta(1500, 1000) === 500, 'rede: diferença normal entre leituras');
  h.ok(delta(100, 4294967196) === 200, 'rede: contador de 32 bits que deu a volta');
  h.ok(delta(5, 9000000000) === 0, 'rede: reinício do contador (adaptador reconectado) não vira pico');
  h.ok(delta(3000000000, 10) === 0, 'rede: salto impossível numa amostra é descartado');
});

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Ferramentas do projeto: atalhos (link do repositório sem segredo, abrir editor/terminal sem quebrar caminhos). */
const fs = require('fs');
const path = require('path');
const h = require('./lib/harness');

h.run(async () => {
  h.isolateHome();
  const dt = require('../lib/devtools');
  const base = h.tmp('dev'); const mk = (n) => h.mkdir(base, n);

  h.title('link do repositório');
  const g = (name, url) => { const d = mk(name); fs.mkdirSync(path.join(d, '.git')); fs.writeFileSync(path.join(d, '.git', 'config'), '[core]\n\tbare = false\n[remote "origin"]\n\turl = ' + url + '\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'); return dt.remoteUrl(d); };
  h.ok(g('g1', 'https://usuario:ghp_TOKENSECRETO@github.com/RDRdigitalFloripa/rdrlocalserver.git') === 'https://github.com/RDRdigitalFloripa/rdrlocalserver', 'GitHub: URL https com token vira link limpo (o token não vaza)');
  h.ok(g('g2', 'git@github.com:org/repo.git') === 'https://github.com/org/repo', 'GitHub: formato git@host:dono/repo');
  h.ok(g('g3', 'ssh://git@gitlab.com:2222/org/sub/repo.git') === 'https://gitlab.com/org/sub/repo', 'GitLab com ssh:// e porta');
  h.ok(g('g4', 'https://evil.com/a b') === '' && g('g5', 'file:///c/x') === '' && g('g6', 'https://x.com/a&calc') === '', 'URLs estranhas (espaço, file://, &) são recusadas');
  h.ok(dt.remoteUrl(mk('g7')) === '', 'sem .git: sem link');

  h.title('abrir programas');
  let threw = false; try { dt.launch(process.execPath, ['a"b'], { hidden: true }); } catch (_) { threw = true; }
  h.ok(threw, 'launch recusa argumento com aspas');
  if (h.IS_WIN) {
    const out = path.join(base, 'argv.json'); process.env.OUT = out;
    const arg = 'C:\\pasta com espaço\\a&b (1)\\';
    dt.launch(process.execPath, ['-e', "require('fs').writeFileSync(process.env.OUT, JSON.stringify(process.argv.slice(1)))", arg], { hidden: true });
    await h.waitFor(() => fs.existsSync(out), 10000);
    const got = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
    h.ok(got && got.length === 1 && got[0] === arg, 'launch entrega a pasta intacta (espaço, & , parênteses e barra final)', JSON.stringify(got));
  } else h.skip('launch com caminho difícil (usa o PowerShell do Windows)');

  h.title('API');
  const srv = await h.startServer(); const call = srv.call;
  const A = mk('site'); const sA = await h.addSite(srv, 'Dev1', A, 'dev1-rdr.test');
  let r = await call('GET', '/api/dev/info?id=' + sA.id);
  h.ok(r.status === 200 && Array.isArray(r.j.editors) && typeof r.j.claude === 'boolean' && typeof r.j.github === 'string', 'GET /api/dev/info responde com editores, Claude Code e GitHub', JSON.stringify(r.j).slice(0, 200));
  r = await call('POST', '/api/dev/open', { id: sA.id, what: 'foo' }); h.ok(r.status === 400, 'open com ação desconhecida -> 400');
  r = await call('POST', '/api/dev/open', { id: sA.id, what: 'editor', editor: 'nao-existe' }); h.ok(r.status === 400 && /Editor não encontrado/.test(r.j.error), 'open com editor inexistente -> 400');
});

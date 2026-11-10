// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** rdr.json: plano, aplicação, validações, exportação e o comando "rdr up" (servidor isolado). */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./lib/harness');

const norm = (s) => String(s).replace(/\\/g, '/');

h.run(async () => {
  const base = h.tmp('rdrfile');
  const mk = (n) => { const d = h.mkdir(base, n, 'public'); fs.writeFileSync(path.join(d, 'index.html'), 'x'); return path.dirname(d); };
  const w = (d, o) => fs.writeFileSync(path.join(d, 'rdr.json'), typeof o === 'string' ? o : JSON.stringify(o, null, 2));
  const srv = await h.startServer(); const call = srv.call;

  h.title('1) projeto completo');
  const loja = mk('loja');
  fs.writeFileSync(path.join(loja, '.env'), 'APP_NAME=Loja\nAPP_URL=http://localhost\nDB_CONNECTION=sqlite\nMAIL_HOST=smtp.exemplo.com\n');
  w(loja, { rdr: 1, name: 'Loja RDR', domain: 'loja-rdr.test', aliases: ['www.loja-rdr.test'], php: '8.4', docroot: 'public', cors: true, env: { APP_ENV: 'local' }, database: { engine: 'mariadb', name: 'loja_rdr' }, services: ['redis', 'mailpit'], frobnicate: 1 });
  let r = await call('POST', '/api/rdrfile/plan', { path: loja }); const p = r.j;
  h.ok(r.status === 200 && p.errors.length === 0, 'plano do arquivo completo sem erros', JSON.stringify(p.errors));
  h.ok(p.domain === 'loja-rdr.test' && p.exists === false && p.steps[0].startsWith('Criar o site loja-rdr.test'), 'plano: criar o site loja-rdr.test', p.steps && p.steps[0]);
  h.ok(p.steps.some((s) => s.startsWith('Criar o banco "loja_rdr" no MariaDB')), 'plano: criar banco');
  h.ok(p.steps.some((s) => s.includes('Ajustar o .env')), 'plano: ajustar .env (o arquivo existe)');
  h.ok(p.steps.some((s) => s.startsWith('Aliases: www.loja-rdr.test')) && p.steps.some((s) => s.startsWith('Variáveis de ambiente do site: APP_ENV')), 'plano: aliases e variáveis');
  h.ok(p.warnings.some((x) => x.includes('PHP 8.4 não está instalado')), 'aviso: PHP 8.4 não instalado, usa o padrão');
  h.ok(p.warnings.some((x) => x.includes('frobnicate')), 'aviso: campo desconhecido ignorado');
  h.ok(p.warnings.some((x) => /Não instalado .*MariaDB.*Redis.*Mailpit/.test(x)), 'aviso: serviços não instalados', JSON.stringify(p.warnings));
  h.ok(p.needsConfirm === '', 'site PHP não pede confirmação de comando');

  r = await call('POST', '/api/rdrfile/apply', { path: loja }); h.ok(r.status === 200, 'apply aceito');
  let job = await srv.waitJob('Aplicar rdr.json: Loja RDR'); h.ok(job && job.status === 'done', 'tarefa concluída', job && job.log.join(' | '));
  let st = await srv.state(); const site = st.sites.find((s) => s.domain === 'loja-rdr.test');
  h.ok(!!site && site.cors === true && (site.aliases || []).includes('www.loja-rdr.test') && site.env && site.env.APP_ENV === 'local', 'site criado com alias, CORS e env');
  h.ok(site && norm(site.path) === norm(loja) && site.docroot === 'public', 'site aponta para a pasta do projeto, docroot public');
  const env1 = fs.readFileSync(path.join(loja, '.env'), 'utf8');
  h.ok(/APP_URL=https:\/\/loja-rdr\.test/.test(env1) && /DB_DATABASE=loja_rdr/.test(env1) && /DB_PORT=3307/.test(env1) && /DB_CONNECTION=mariadb/.test(env1) && /MAIL_HOST=127\.0\.0\.1/.test(env1) && /MAIL_PORT=1026/.test(env1) && /REDIS_PORT=6380/.test(env1), '.env ajustado (APP_URL, DB_*, MAIL_*, REDIS_*)', env1);
  h.ok(/APP_NAME=Loja/.test(env1), '.env preserva o que não é do arquivo');
  h.ok(site && site.caps && site.caps.rdr === true, 'state.sites[].caps.rdr = true');

  h.title('2) repetir não duplica');
  r = await call('POST', '/api/rdrfile/plan', { id: site.id });
  h.ok(r.j.exists === true && r.j.steps[0].startsWith('Atualizar o site existente'), 'plano após aplicar: "Atualizar o site existente" (por id do site)');
  await call('POST', '/api/rdrfile/apply', { id: site.id }); await srv.waitJob('Aplicar rdr.json: Loja RDR');
  st = await srv.state(); const n = st.sites.filter((s) => norm(s.path) === norm(loja)).length;
  h.ok(n === 1, 'repetir não duplica o site', String(n));

  h.title('3) arquivos inválidos');
  const bad = mk('ruim');
  w(bad, { rdr: 2, type: 'blog', domain: 'ruim.com', services: ['mysql', 'redis'], database: { engine: 'mariadb', name: 'a;drop' }, env: ['x'] });
  r = await call('POST', '/api/rdrfile/plan', { path: bad }); const errs = r.j.errors.join(' | ');
  h.ok(r.j.errors.length >= 4, 'inválido: vários erros', errs);
  h.ok(/"rdr" deve ser 1/.test(errs) && /"type"/.test(errs) && /Serviço desconhecido.*mysql/.test(errs) && /database\.name/.test(errs) && /"env"/.test(errs), 'inválido: mensagens claras para formato, type, serviço, nome de banco e env', errs);
  r = await call('POST', '/api/rdrfile/apply', { path: bad }); h.ok(r.status === 400, 'apply de arquivo inválido é recusado', 'HTTP ' + r.status);
  const dom = mk('dominio'); w(dom, { rdr: 1, domain: 'meu site.com' });
  r = await call('POST', '/api/rdrfile/plan', { path: dom }); h.ok(r.j.errors.length === 1 && /Domínio inválido/.test(r.j.errors[0]), 'domínio inválido usa a mesma validação dos sites', r.j.errors.join('|'));
  const dup = mk('dup'); w(dup, { rdr: 1, domain: 'loja-rdr.test' });
  r = await call('POST', '/api/rdrfile/plan', { path: dup }); h.ok(r.j.errors.some((e) => /já usado por outro site/.test(e)), 'domínio já usado por outro site é detectado');
  const bj = mk('json'); w(bj, '{ rdr: 1,, }');
  r = await call('POST', '/api/rdrfile/plan', { path: bj }); h.ok(/não é um JSON válido/.test(r.j.errors[0]), 'JSON quebrado: mensagem clara');
  r = await call('POST', '/api/rdrfile/plan', { path: mk('sem') }); h.ok(/Não achei o rdr\.json/.test(r.j.errors[0]), 'pasta sem rdr.json');
  r = await call('POST', '/api/rdrfile/plan', { path: path.join(base, 'nao-existe') }); h.ok(r.status === 400, 'pasta inexistente -> HTTP 400');

  h.title('4) app: o comando exige confirmação');
  const app = mk('meuapp'); w(app, { rdr: 1, name: 'Meu App', type: 'app', domain: 'meu-app-rdr.test', app: { runtime: 'custom', cmd: 'node -e "setInterval(()=>{},1000)"', autoStart: false } });
  r = await call('POST', '/api/rdrfile/plan', { path: app });
  h.ok(r.j.errors.length === 0 && r.j.needsConfirm.startsWith('node -e'), 'app: o plano devolve o comando que exige confirmação');
  h.ok(r.j.steps.some((s) => s.startsWith('O app roda este comando na sua máquina')), 'app: um passo avisa que roda comando');
  r = await call('POST', '/api/rdrfile/apply', { path: app }); h.ok(r.status === 400 && /Confirme/.test(r.j.error || ''), 'app: apply SEM confirmar é recusado');
  st = await srv.state(); h.ok(!st.sites.some((s) => s.domain === 'meu-app-rdr.test'), 'app: nada foi criado sem confirmação');
  r = await call('POST', '/api/rdrfile/apply', { path: app, confirmCmd: true }); h.ok(r.status === 200, 'app: apply com confirmCmd aceito');
  job = await srv.waitJob('Aplicar rdr.json: Meu App'); h.ok(job && job.status === 'done', 'app: tarefa concluída', job && job.log.join(' | '));
  st = await srv.state(); const a = st.sites.find((s) => s.domain === 'meu-app-rdr.test');
  h.ok(a && a.type === 'app' && a.runtime === 'custom' && a.autoStart === false, 'app: site do tipo app criado');
  const noapp = mk('semapp'); w(noapp, { rdr: 1, type: 'app' }); r = await call('POST', '/api/rdrfile/plan', { path: noapp }); h.ok(/exige o bloco "app"/.test(r.j.errors[0] || ''), 'app sem bloco "app": erro claro');

  h.title('5) exportar');
  const ex = mk('exporta'); fs.writeFileSync(path.join(ex, '.env'), 'DB_CONNECTION=pgsql\nDB_DATABASE=exporta_db\nCACHE_STORE=redis\nMAIL_HOST=127.0.0.1\nMAIL_PORT=1026\nSECRET_KEY=nao-pode-vazar\n');
  await call('POST', '/api/sites', { name: 'Exporta', path: ex, domain: 'exporta.test', aliases: 'x.exporta.test', php: 'default', docroot: 'public', cors: true, env: 'SEGREDO=abc123' });
  st = await srv.state(); const es = st.sites.find((s) => s.domain === 'exporta.test'); h.ok(!!es, 'site de teste para exportar criado');
  r = await call('POST', '/api/rdrfile/export', { id: es.id }); h.ok(r.status === 200 && fs.existsSync(path.join(ex, 'rdr.json')), 'export grava rdr.json na pasta do projeto');
  const spec = JSON.parse(fs.readFileSync(path.join(ex, 'rdr.json'), 'utf8'));
  h.ok(spec.rdr === 1 && spec.domain === 'exporta.test' && spec.cors === true && spec.docroot === 'public' && spec.aliases[0] === 'x.exporta.test', 'export: domínio, alias, CORS e docroot', JSON.stringify(spec));
  h.ok(spec.database && spec.database.engine === 'postgres' && spec.database.name === 'exporta_db' && spec.services.includes('redis') && spec.services.includes('mailpit') && spec.services.includes('postgres'), 'export: banco e serviços deduzidos do .env', JSON.stringify(spec));
  h.ok(!('env' in spec) && !JSON.stringify(spec).includes('abc123') && !JSON.stringify(spec).includes('nao-pode-vazar'), 'export: NÃO inclui variáveis de ambiente nem segredos do .env');
  r = await call('POST', '/api/rdrfile/export', { id: es.id }); h.ok(r.status === 400 && /já existe/.test(r.j.error || ''), 'export não sobrescreve sem pedir');
  r = await call('POST', '/api/rdrfile/export', { id: es.id, overwrite: true }); h.ok(r.status === 200, 'export com overwrite funciona');
  const rt = await call('POST', '/api/rdrfile/plan', { id: es.id }); h.ok(rt.j.errors.length === 0, 'o arquivo exportado passa na própria validação (ida e volta)', rt.j.errors.join('|'));

  h.title('6) CLI: rdr up');
  const cli = (args) => spawnSync(process.execPath, [path.join(h.ROOT, 'rdr.js'), 'up', ...args], { env: { ...process.env, RDR_PORT: String(srv.port), RDR_HOME: srv.home }, encoding: 'utf8', timeout: 60000 });
  const cdir = mk('cli'); w(cdir, { rdr: 1, name: 'Por CLI', domain: 'cli-rdr.test' });
  let c = cli([cdir]);
  h.ok(c.status === 0 && /Criar o site cli-rdr\.test/.test(c.stdout) && /Site criado: https:\/\/cli-rdr\.test/.test(c.stdout), 'rdr up <pasta> cria o site e mostra o log', `exit ${c.status} ${c.stderr} ${c.stdout}`);
  const cdir2 = mk('cliapp'); w(cdir2, { rdr: 1, name: 'App CLI', type: 'app', domain: 'app-cli-rdr.test', app: { cmd: 'node -v', autoStart: false } });
  c = cli([cdir2]); h.ok(c.status === 1 && /--yes/.test(c.stderr), 'rdr up com app sem --yes: recusa e pede --yes', `exit ${c.status} ${c.stderr}`);
  c = cli([cdir2, '--yes']); h.ok(c.status === 0 && /Site criado/.test(c.stdout), 'rdr up --yes confirma o comando do app', `exit ${c.status} ${c.stderr} ${c.stdout}`);
  c = cli([bad]); h.ok(c.status === 1 && /✘/.test(c.stderr), 'rdr up com arquivo inválido: mostra os erros e sai com 1', `exit ${c.status} ${c.stderr}`);
});

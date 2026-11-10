// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Ferramentas do projeto: comparar e editar o .env (sem vazar valores sensíveis pela API). */
const fs = require('fs');
const path = require('path');
const h = require('./lib/harness');

h.run(async () => {
  const base = h.tmp('env'); const mk = (n) => h.mkdir(base, n);
  const srv = await h.startServer(); const call = srv.call;
  const rd = (d, f = '.env') => fs.readFileSync(path.join(d, f), 'utf8');

  const E = mk('envp');
  fs.writeFileSync(path.join(E, '.env'), 'APP_NAME=Loja\nAPP_KEY=\nDB_PASSWORD=segredo123\nMAIL_HOST=smtp.exemplo.com\nEXTRA_ONLY=1\n# COMENTADA=x\n');
  fs.writeFileSync(path.join(E, '.env.example'), 'APP_NAME=Laravel\nAPP_KEY=\nDB_PASSWORD=\nMAIL_HOST=127.0.0.1\nNEW_FLAG=abc def\nSTRIPE_SECRET=sk_exemplo_123\n# COMENTADA=1\n');
  const sE = await h.addSite(srv, 'EnvP', E, 'envp-rdr.test');

  h.title('comparar com o .env.example');
  let r = await call('GET', '/api/env?id=' + sE.id); const c = r.j;
  h.ok(c.hasEnv && c.hasExample && c.exampleName === '.env.example', 'acha .env e .env.example');
  h.ok(JSON.stringify(c.missing.map((x) => x.key)) === JSON.stringify(['NEW_FLAG', 'STRIPE_SECRET']) && c.missing[0].example === 'abc def', 'faltantes: NEW_FLAG e STRIPE_SECRET (comentadas não contam)', JSON.stringify(c.missing));
  h.ok(JSON.stringify(c.extra) === JSON.stringify(['EXTRA_ONLY']), 'só no .env: EXTRA_ONLY', JSON.stringify(c.extra));
  h.ok(c.empty.includes('APP_KEY'), 'APP_KEY vazia vai para "para preencher"', JSON.stringify(c.empty));
  h.ok(!r.raw.includes('segredo123') && !r.raw.includes('sk_exemplo_123'), 'a resposta da API NUNCA contém valores sensíveis (senha, chave), nem do .env nem do exemplo');
  const dbp = c.entries.find((x) => x.key === 'DB_PASSWORD'); h.ok(dbp.secret === true && dbp.set === true && dbp.value === '', 'DB_PASSWORD: sensível, preenchida, sem valor na resposta');
  h.ok(c.entries.find((x) => x.key === 'MAIL_HOST').value === 'smtp.exemplo.com', 'valor não sensível aparece');

  h.title('editar uma variável');
  const before = rd(E);
  r = await call('POST', '/api/env/set', { id: sE.id, key: 'MAIL_HOST', value: 'smtp.novo.com' }); h.ok(r.status === 200, 'set MAIL_HOST');
  let after = rd(E);
  h.ok(after.includes('MAIL_HOST=smtp.novo.com') && !after.includes('smtp.exemplo.com') && after.includes('DB_PASSWORD=segredo123') && after.includes('# COMENTADA=x'), 'troca só a linha da chave; o resto fica igual');
  h.ok(fs.existsSync(path.join(E, '.env.backup')) && rd(E, '.env.backup') === before, '.env.backup guarda o .env anterior');
  await call('POST', '/api/env/set', { id: sE.id, key: 'COMENTADA', value: 'novo' }); after = rd(E);
  h.ok(/^COMENTADA=novo$/m.test(after) && after.includes('# COMENTADA=x'), 'chave que só existe comentada é acrescentada (não troca o comentário)');
  await call('POST', '/api/env/set', { id: sE.id, key: 'FOO', value: 'a b' }); h.ok(/^FOO="a b"$/m.test(rd(E)), 'valor com espaço vai entre aspas');
  await call('POST', '/api/env/set', { id: sE.id, key: 'PW', value: 'pa$$' }); h.ok(/^PW='pa\$\$'$/m.test(rd(E)), 'valor com $ vai entre aspas simples (sem expansão)');
  for (const [k, v, why] of [['PW2', "it's $x", 'aspas simples e $ juntos'], ['PW3', 'a\nb', 'quebra de linha'], ['1BAD', 'x', 'nome começando com número'], ['A B', 'x', 'nome com espaço'], ['A=B', 'x', 'nome com ='], ['', 'x', 'nome vazio']]) {
    r = await call('POST', '/api/env/set', { id: sE.id, key: k, value: v }); h.ok(r.status === 400, `set recusa: ${why} (HTTP ${r.status})`);
  }

  h.title('adicionar faltantes e criar o .env');
  r = await call('POST', '/api/env/add-missing', { id: sE.id }); h.ok(r.status === 200 && JSON.stringify(r.j.added) === JSON.stringify(['NEW_FLAG', 'STRIPE_SECRET']), 'add-missing acrescenta as faltantes', JSON.stringify(r.j));
  after = rd(E); h.ok(/^NEW_FLAG=abc def$/m.test(after) && /Adicionadas pelo RDR Local em/.test(after), 'faltantes copiadas do exemplo como estão, sob um comentário datado');
  r = await call('POST', '/api/env/add-missing', { id: sE.id }); h.ok(r.j.added.length === 0, 'repetir add-missing não duplica nada');
  const crlf = mk('envcrlf'); fs.writeFileSync(path.join(crlf, '.env'), 'A=1\r\nB=2\r\n'); const sCr = await h.addSite(srv, 'EnvCrlf', crlf, 'envcrlf-rdr.test');
  await call('POST', '/api/env/set', { id: sCr.id, key: 'C', value: '3' }); await call('POST', '/api/env/set', { id: sCr.id, key: 'A', value: '9' });
  h.ok(rd(crlf) === 'A=9\r\nB=2\r\nC=3\r\n', 'fim de linha CRLF preservado', JSON.stringify(rd(crlf)));
  const I = mk('envinit'); fs.writeFileSync(path.join(I, '.env.example'), 'X=1\n'); const sI = await h.addSite(srv, 'EnvInit', I, 'envinit-rdr.test');
  r = await call('GET', '/api/env?id=' + sI.id); h.ok(r.j.hasEnv === false && r.j.hasExample === true, 'sem .env: avisa e oferece criar');
  r = await call('POST', '/api/env/set', { id: sI.id, key: 'X', value: '2' }); h.ok(r.status === 400, 'set sem .env -> 400');
  r = await call('POST', '/api/env/init', { id: sI.id }); h.ok(r.status === 200 && rd(I) === 'X=1\n', 'init cria o .env a partir do exemplo');
  r = await call('POST', '/api/env/init', { id: sI.id }); h.ok(r.status === 400, 'init não sobrescreve um .env existente');
});

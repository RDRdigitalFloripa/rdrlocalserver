// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Ferramentas do projeto: listar e rodar scripts do composer.json/package.json e a auditoria de segurança.
 * Sem PHP/Composer à mão (RDR_TEST_PHP, RDR_TEST_COMPOSER ou bin/ do repositório) os testes do Composer são pulados;
 * as auditorias que consultam a internet só rodam com --full.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./lib/harness');
const tools = require('./lib/tools');

const logOf = (j) => (j ? j.log.join('\n') : '');
const sh = (cmd, cwd) => spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: 180000 });

h.run(async () => {
  const npm = tools.hasNpm(); const php = tools.findPhp();
  if (!npm) h.skip('npm não encontrado: testes de scripts e auditoria do npm pulados');
  if (!php) h.skip('PHP/Composer não encontrados (RDR_TEST_PHP, RDR_TEST_COMPOSER): testes do Composer pulados');
  const base = h.tmp('scripts'); const mk = (n) => h.mkdir(base, n);
  const wj = (d, f, o) => fs.writeFileSync(path.join(d, f), JSON.stringify(o, null, 2));
  const srv = await h.startServer({ env: { RDR_SCRIPT_TIMEOUT_MS: '12000' }, setup: (home) => { if (php) tools.installPhp(home, php); } });
  const call = srv.call;

  h.title('1) listar scripts');
  const A = mk('dev1');
  wj(A, 'composer.json', { name: 'rdr/teste', scripts: { test: ["php -r \"echo 'composer-ok';\""], lint: 'echo lint', dev: ['Composer\\Config::disableProcessTimeout', 'php artisan serve'], 'post-autoload-dump': ['echo evento'], 'post-update-cmd': 'echo evento2' } });
  wj(A, 'package.json', { name: 'teste', scripts: { build: 'vite build', dev: 'vite', hello: 'node -e "console.log(\'hello-from-script\')"', prehello: 'echo pre', fail: 'node -e "process.exit(3)"', slow: 'node -e "/*RDR_SLOW_MARK*/setTimeout(function(){},60000)"', 'test:unit': 'echo unit', postinstall: 'echo x', 'x;calc': 'echo no' } });
  const sA = await h.addSite(srv, 'Dev1', A, 'dev1-rdr.test'); h.ok(!!sA, 'site de teste criado');
  let r = await call('GET', '/api/dev/info?id=' + sA.id); const info = r.j;
  h.ok(JSON.stringify(info.scripts.composer.map((x) => x.name)) === JSON.stringify(['test', 'lint', 'dev']), 'composer: scripts listados sem os eventos (post-autoload-dump etc.)', JSON.stringify(info.scripts.composer));
  h.ok(JSON.stringify(info.scripts.npm.map((x) => x.name)) === JSON.stringify(['build', 'dev', 'hello', 'fail', 'slow', 'test:unit']), 'npm: sem prehello (roda junto), postinstall (ciclo de vida) e o nome inválido "x;calc"', JSON.stringify(info.scripts.npm.map((x) => x.name)));
  h.ok(info.scripts.composer.find((x) => x.name === 'dev').long === true && info.scripts.npm.find((x) => x.name === 'dev').long === true && info.scripts.npm.find((x) => x.name === 'build').long === false, 'scripts que não terminam (dev) marcados; "vite build" não');
  h.ok(info.scripts.hasComposer && info.scripts.hasNpm && !info.scripts.hasComposerLock && !info.scripts.hasNpmLock, 'indicadores de arquivos e locks');

  h.title('2) recusas (valem sem npm nem PHP)');
  for (const [body, why] of [[{ kind: 'npm', name: 'dev' }, 'script que não termina (dev)'], [{ kind: 'npm', name: 'nao-existe' }, 'script inexistente'], [{ kind: 'npm', name: 'hello && calc' }, 'nome com injeção'], [{ kind: 'npm', name: 'x;calc' }, 'nome inválido presente no arquivo'], [{ kind: 'shell', name: 'hello' }, 'tipo inválido'], [{ kind: 'composer', name: 'post-autoload-dump' }, 'evento do composer']]) {
    r = await call('POST', '/api/scripts/run', { id: sA.id, ...body }); h.ok(r.status === 400, `recusa: ${why}`, `HTTP ${r.status}: ${r.j.error}`);
  }
  r = await call('POST', '/api/scripts/run', { id: 'xxxx', kind: 'npm', name: 'hello' }); h.ok(r.status === 400, 'site inexistente -> 400');

  h.title('3) executar scripts');
  if (npm) {
    r = await call('POST', '/api/scripts/run', { id: sA.id, kind: 'npm', name: 'hello' }); h.ok(r.status === 200, 'run npm hello aceito');
    let j = await srv.waitJob('Script npm hello'); h.ok(j && j.status === 'done' && /hello-from-script/.test(logOf(j)) && /> npm run hello/.test(logOf(j)), 'npm hello: concluído e a saída chegou no log', logOf(j));
    await call('POST', '/api/scripts/run', { id: sA.id, kind: 'npm', name: 'fail' }); j = await srv.waitJob('Script npm fail');
    h.ok(j && j.status === 'error' && /código 3/.test(logOf(j)), 'npm fail: termina em erro com o código de saída', logOf(j));
    await call('POST', '/api/scripts/run', { id: sA.id, kind: 'npm', name: 'slow' });
    j = await srv.waitJob('Script npm slow', undefined, 40000); h.ok(j && j.status === 'error' && /tempo esgotado/.test(logOf(j)), 'script lento é interrompido pelo limite de tempo (12 s no teste)', logOf(j));
    if (h.IS_WIN) {
      await h.sleep(1500);
      const ps = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match ('RDR_SLOW'+'_MARK') } | Measure-Object).Count"], { encoding: 'utf8' });
      h.ok(ps.stdout.trim() === '0', 'o processo do script lento foi encerrado de verdade', 'restantes: ' + ps.stdout.trim());
    }
  }
  if (php) {
    r = await call('POST', '/api/scripts/run', { id: sA.id, kind: 'composer', name: 'test' }); h.ok(r.status === 200, 'run composer test aceito');
    const j = await srv.waitJob('Script composer test', undefined, 90000); h.ok(j && j.status === 'done' && /composer-ok/.test(logOf(j)), 'composer test: roda com o PHP do site (composer run-script)', logOf(j));
  }

  h.title('4) auditoria de segurança');
  await call('POST', '/api/scripts/audit', { id: sA.id }); let j = await srv.waitJob('Auditoria de segurança — Dev1');
  h.ok(j && j.status === 'done' && /Sem composer\.lock/.test(logOf(j)) && /Sem package-lock\.json/.test(logOf(j)) && /Nada foi auditado/.test(logOf(j)), 'sem locks: avisa o que fazer e conclui sem erro', logOf(j));
  if (php) {
    const F = mk('composerquebrado'); wj(F, 'composer.json', { name: 'rdr/quebrado' }); fs.writeFileSync(path.join(F, 'composer.lock'), 'isto nao e um json');
    const sF = await h.addSite(srv, 'ComposerQuebrado', F, 'composerquebrado-rdr.test'); await call('POST', '/api/scripts/audit', { id: sF.id }); j = await srv.waitJob('Auditoria de segurança — ComposerQuebrado', undefined, 90000);
    h.ok(j && j.status === 'error' && /Auditoria incompleta/.test(logOf(j)) && !/sem achados/.test(logOf(j)), 'auditoria que não conseguiu rodar termina em ERRO ("incompleta"), nunca verde', logOf(j));
  }
  if (!h.FULL) h.skip('auditorias com a internet (npm audit e composer audit): rode com --full');
  else {
    if (npm) {
      const B = mk('npmvuln'); wj(B, 'package.json', { name: 'vuln', version: '1.0.0', dependencies: { lodash: '4.17.15' } });
      sh('npm install lodash@4.17.15 --package-lock-only --ignore-scripts --no-audit --no-fund', B);
      if (fs.existsSync(path.join(B, 'package-lock.json'))) {
        const sB = await h.addSite(srv, 'NpmVuln', B, 'npmvuln-rdr.test'); await call('POST', '/api/scripts/audit', { id: sB.id }); j = await srv.waitJob('Auditoria de segurança — NpmVuln', undefined, 120000);
        h.ok(j && j.status === 'error' && /Auditoria concluída com \d+ achado/.test(logOf(j)) && /lodash/.test(logOf(j)) && /vulnerabilidade/.test(logOf(j)), 'npm audit acha a vulnerabilidade do lodash e termina em erro para chamar a atenção', logOf(j));
      } else h.skip('npm audit com achado: não consegui gerar o package-lock.json (sem internet?)');
      const D = mk('npmclean'); wj(D, 'package.json', { name: 'clean', version: '1.0.0', dependencies: { ms: '2.1.3' } });
      sh('npm install ms@2.1.3 --package-lock-only --ignore-scripts --no-audit --no-fund', D);
      if (fs.existsSync(path.join(D, 'package-lock.json'))) {
        const sD = await h.addSite(srv, 'NpmClean', D, 'npmclean-rdr.test'); await call('POST', '/api/scripts/audit', { id: sD.id }); j = await srv.waitJob('Auditoria de segurança — NpmClean', undefined, 120000);
        h.ok(j && j.status === 'done' && /Nenhuma vulnerabilidade conhecida nas dependências de produção/.test(logOf(j)), 'npm audit sem achados conclui verde', logOf(j));
      }
    }
    if (php) {
      const C = mk('composervuln'); wj(C, 'composer.json', { name: 'rdr/vuln', require: { 'symfony/http-foundation': '5.4.0' }, config: { 'allow-plugins': false, audit: { 'block-insecure': false } } });
      const n = spawnSync(path.join(srv.home, 'bin', path.basename(php.php), 'php.exe'), [path.join(srv.home, 'bin', 'composer', 'composer.phar'), 'update', '--no-install', '--no-scripts', '--no-interaction', '--no-ansi'], { cwd: C, encoding: 'utf8', timeout: 170000, env: { ...process.env, COMPOSER_HOME: path.join(srv.home, 'data', 'composer') } });
      if (fs.existsSync(path.join(C, 'composer.lock'))) {
        const sC = await h.addSite(srv, 'ComposerVuln', C, 'composervuln-rdr.test'); await call('POST', '/api/scripts/audit', { id: sC.id }); j = await srv.waitJob('Auditoria de segurança — ComposerVuln', undefined, 150000);
        h.ok(j && j.status === 'error' && /vulnerabilidade\(s\) em \d+ pacote/.test(logOf(j)) && /symfony\/http-foundation/.test(logOf(j)), 'composer audit acha a vulnerabilidade e termina em erro', logOf(j));
      } else h.skip('composer audit com achado: não consegui gerar o composer.lock: ' + String((n.stderr || '') + (n.stdout || '')).slice(0, 120));
    }
  }
});

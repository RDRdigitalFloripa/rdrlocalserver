// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Tailwind CSS no "Novo site": componente (compilador independente, SHA-256 conferido), opções por tipo de projeto,
 * arquivos da pasta PHP, Node.js para o Vite, processo "Tailwind" e texto para agentes de IA.
 * Nada baixa da internet: o npm e o compilador são simulados (o npm por um npm.cmd de mentira dentro de um Node.js de mentira).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./lib/harness');
const tools = require('./lib/tools');

const H1 = 'a'.repeat(64); const H2 = 'b'.repeat(64); const H3 = 'c'.repeat(64);
const EXE = 'tailwindcss-windows-x64.exe';

/** Node.js "gerenciado" de mentira (22.14.0) com um npm.cmd que só ecoa os argumentos e sai com o código pedido. */
function fakeNode(bin, npmExit = 0) {
  const d = h.mkdir(bin, 'node', '22');
  h.write(path.join(d, 'node.exe'), 'x'); h.write(path.join(d, '.version'), '22.14.0');
  h.write(path.join(d, 'npm.cmd'), `@echo off\r\necho fake-npm %*\r\nexit /b ${npmExit}\r\n`);
}

h.run(async () => {
  const home = h.isolateHome();
  const comps = require('../lib/components');
  const projects = require('../lib/projects');
  const sites = require('../lib/sites');
  const procs = require('../lib/procs');
  const aif = require('../lib/aifiles');
  const base = h.tmp('tw');

  h.title('o componente existe no catálogo');
  const lst = comps.listComponents().find((c) => c.id === 'tailwindcss');
  h.ok(!!lst && !lst.installed && /Tailwind CSS/.test(lst.name) && /sem Node/.test(lst.name), 'aparece em Componentes, não instalado, dizendo que dispensa o Node.js', JSON.stringify(lst));
  h.ok(/tailwindcss[\\/]tailwindcss(\.exe)?$/.test(comps.bins.tailwind()), 'o executável fica em bin/tailwindcss', comps.bins.tailwind());

  h.title('escolher a release (só a série 4.x, com o .exe do Windows)');
  const asset = (name, digest) => ({ name, browser_download_url: 'https://github.com/x/' + name, digest });
  const rels = [
    { tag_name: 'v5.0.0', assets: [asset(EXE, 'sha256:' + H3)] }, // série nova: ignorada até revisarmos o scaffold
    { tag_name: 'v4.20.0-beta.1', prerelease: true, assets: [asset(EXE, 'sha256:' + H3)] },
    { tag_name: 'v4.19.0', draft: true, assets: [asset(EXE, 'sha256:' + H3)] },
    { tag_name: 'v4.12.0', assets: [asset('tailwindcss-linux-x64', 'sha256:' + H3)] }, // sem o .exe do Windows
    { tag_name: 'v4.2.0', assets: [asset(EXE, 'sha256:' + H1)] },
    { tag_name: 'v4.10.1', assets: [asset(EXE, 'sha256:' + H2), asset('sha256sums.txt', '')] },
  ];
  const pick = comps.tailwindPick(rels);
  h.ok(pick && pick.tag === 'v4.10.1', 'pega a 4.x mais nova (comparando como número: 4.10 > 4.2) e ignora 5.x, beta, rascunho e release sem .exe', pick && pick.tag);
  h.ok(pick && pick.sha256 === H2 && pick.url.endsWith('/' + EXE) && /sha256sums\.txt$/.test(pick.sumsUrl), 'traz o endereço do .exe, o SHA-256 do GitHub e o endereço do sha256sums.txt', JSON.stringify(pick));
  h.ok(comps.tailwindPick([{ tag_name: 'v5.1.0', assets: [asset(EXE, 'sha256:' + H1)] }]) === null && comps.tailwindPick(null) === null && comps.tailwindPick([]) === null, 'nenhuma 4.x utilizável (ou lista inválida): devolve null');

  h.title('SHA-256 esperado do compilador');
  const sums = `${H3}  ./tailwindcss-linux-x64\n${H2}  ./${EXE}\n`;
  h.ok(comps.tailwindHash({ sha256: H2 }, '') === H2, 'só o digest do GitHub: serve');
  h.ok(comps.tailwindHash({ sha256: '' }, sums) === H2, 'só o sha256sums.txt: serve (formato "hash  ./arquivo")');
  h.ok(comps.tailwindHash({ sha256: H2 }, sums) === H2, 'os dois e iguais: serve');
  h.ok(comps.tailwindHash({ sha256: '' }, `${H2} *${EXE}\n`) === H2, 'também aceita a variante "hash *arquivo"');
  const thr = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
  h.ok(/difere/.test(thr(() => comps.tailwindHash({ sha256: H1 }, sums))), 'os dois e diferentes: recusa (algo foi trocado)');
  h.ok(/Não achei o SHA-256/.test(thr(() => comps.tailwindHash({ sha256: '' }, ''))), 'sem nenhum SHA-256: recusa, em vez de instalar sem conferir');
  h.ok(/Não achei o SHA-256/.test(thr(() => comps.tailwindHash({ sha256: '' }, `${H3}  ./tailwindcss-linux-x64\n`))), 'sha256sums.txt sem a linha do Windows: recusa');

  h.title('opções por tipo de projeto');
  const tc = projects.tailwindChoice;
  h.ok(tc('laravel', '', '') === 'none' && tc('empty', '', undefined) === 'none' && tc('wordpress', '', '') === 'none', 'sem o campo (API, scripts): nada muda');
  h.ok(tc('laravel', '', 'install') === 'install' && tc('laravel', '', 'none') === 'none', 'Laravel: instalar ou não');
  h.ok(tc('empty', '', 'cli') === 'cli' && tc('empty', '', 'vite') === 'vite' && tc('empty', '', 'none') === 'none', 'pasta PHP: nenhum, CLI independente ou Vite');
  h.ok(tc('laravel', 'kit-livewire', 'install') === 'none' && tc('laravel', 'breeze-blade', 'install') === 'none', 'Laravel com starter kit: o kit já traz o Tailwind (não instala duas vezes)');
  h.ok(/inválida/.test(thr(() => tc('laravel', '', 'cli'))) && /inválida/.test(thr(() => tc('empty', '', 'install'))) && /inválida/.test(thr(() => tc('empty', '', 'xyz'))), 'valor que o tipo não aceita: erro');
  h.ok(/só para Laravel/.test(thr(() => tc('wordpress', '', 'cli'))), 'WordPress não tem Tailwind pelo painel');
  h.ok(JSON.stringify(projects.TAILWIND) === JSON.stringify({ laravel: ['install', 'none'], empty: ['none', 'cli', 'vite'] }), 'tabela de opções do servidor');
  const appjs = h.read(path.join(h.ROOT, 'public', 'app.js')); const html = h.read(path.join(h.ROOT, 'public', 'index.html'));
  const twBlock = (appjs.match(/const TW_OPTS = \{[\s\S]*?\n\};/) || [''])[0];
  const uiVals = (k) => [...(new RegExp(`${k}: \\[([\\s\\S]*?)\\n  \\],?`).exec(twBlock) || ['', ''])[1].matchAll(/\['(\w+)',/g)].map((m) => m[1]);
  h.ok(JSON.stringify(uiVals('laravel')) === JSON.stringify(projects.TAILWIND.laravel) && JSON.stringify(uiVals('empty')) === JSON.stringify(projects.TAILWIND.empty), 'a lista do modal (app.js) tem exatamente as opções que o servidor aceita', JSON.stringify([uiVals('laravel'), uiVals('empty')]));
  h.ok(/id="lbTailwind"/.test(html) && /name="tailwind"/.test(html) && /tailwind: \$\('#lbTailwind'\)/.test(appjs), 'o modal tem o campo e o envio manda o valor (vazio quando o campo está escondido)');

  h.title('Node.js que serve para o Vite 7');
  const ns = projects.nodeServes;
  h.ok(ns('22.12.0') && ns('22.14.1') && ns('20.19.0') && ns('24.0.0') && ns('23.1.0'), '20.19+, 22.12+ e mais novos: servem');
  h.ok(!ns('22.11.0') && !ns('20.18.9') && !ns('18.20.4') && !ns('21.7.3') && !ns('16.0.0'), 'mais antigos (e a 21, sem suporte): não servem');

  h.title('arquivos da pasta PHP com Tailwind');
  const NOME = "Loja do Zé's \\ <b>&\"";
  const cli = projects.tailwindFiles('cli', NOME, 'loja');
  h.ok(Object.keys(cli).sort().join(',') === 'public/index.php,src/input.css', 'CLI independente: só src/input.css e public/index.php (nada de package.json)', Object.keys(cli).join(','));
  h.ok(cli['src/input.css'] === '@import "tailwindcss";\n', 'o CSS de entrada usa a sintaxe do v4');
  h.ok(cli['public/index.php'].includes('href="/dist/output.css"') && !/<script/.test(cli['public/index.php']), 'a página liga o CSS compilado (public/dist/output.css), sem script');
  h.ok(cli['public/index.php'].includes("$nome = 'Loja do Zé\\'s \\\\ <b>&\"';") && !cli['public/index.php'].includes('<h1 class="text-4xl font-bold tracking-tight">Loja'), 'o nome vai para o PHP como texto (aspas e barra escapadas) e é escrito com htmlspecialchars');
  const vt = projects.tailwindFiles('vite', 'Loja', 'loja');
  h.ok(Object.keys(vt).sort().join(',') === '.gitignore,package.json,public/index.php,src/input.css,src/main.js,vite.config.js', 'Vite: package.json, vite.config.js, src/main.js e .gitignore, além dos dois da CLI', Object.keys(vt).join(','));
  const pkg = JSON.parse(vt['package.json']);
  h.ok(pkg.name === 'loja' && pkg.private === true && pkg.type === 'module' && pkg.scripts.build === 'vite build' && pkg.scripts.dev === 'vite build --watch', 'package.json: nome, módulo e scripts (dev recompila ao salvar, pois o PHP não usa o servidor do Vite)', vt['package.json']);
  h.ok(/^\^4\./.test(pkg.devDependencies.tailwindcss) && /^\^4\./.test(pkg.devDependencies['@tailwindcss/vite']) && /^\^7\./.test(pkg.devDependencies.vite), 'dependências: Tailwind 4 e Vite 7 (o Node.js 20.19+ que o painel garante)');
  h.ok(vt['vite.config.js'].includes("outDir: 'public/dist'") && vt['vite.config.js'].includes('tailwindcss()') && vt['vite.config.js'].includes("assets/[name][extname]"), 'vite.config.js: plugin do Tailwind e saída com nomes fixos em public/dist');
  h.ok(vt['vite.config.js'].includes('publicDir: false'), 'vite.config.js: publicDir desligado (a saída fica dentro de public/, o Vite avisaria e copiaria o próprio site)');
  h.ok(vt['public/index.php'].includes('/dist/assets/main.css') && vt['public/index.php'].includes('/dist/assets/main.js') && vt['src/main.js'] === "import './input.css';\n" && /node_modules/.test(vt['.gitignore']), 'a página e o main.js apontam para os arquivos fixos; node_modules fica fora do Git');
  // sintaxe do PHP de verdade, se houver PHP para os testes
  const t = tools.findPhp();
  if (!t) h.skip('sem PHP para os testes (RDR_TEST_PHP): conferência de sintaxe do index.php pulada');
  else {
    const phpExe = path.join(t.php, 'php.exe');
    const fileCli = h.write(path.join(base, 'idx-cli.php'), cli['public/index.php']);
    const fileVite = h.write(path.join(base, 'idx-vite.php'), projects.tailwindFiles('vite', NOME, 'loja')['public/index.php']);
    for (const [k, file] of [['cli', fileCli], ['vite', fileVite]]) {
      const r = spawnSync(phpExe, ['-l', file], { encoding: 'utf8' });
      h.ok(r.status === 0, `index.php (${k}) passa no php -l`, r.stdout + r.stderr);
      const o = spawnSync(phpExe, [file], { encoding: 'utf8' });
      h.ok(o.status === 0 && o.stdout.includes('Loja do Zé&#039;s \\ &lt;b&gt;&amp;&quot;') && !o.stdout.includes('<b>&"'), `index.php (${k}) escreve o nome (aspas, barra, < e &) escapado para HTML`, o.stdout.slice(0, 400));
    }
  }

  h.title('texto para agentes de IA (CLAUDE.md)');
  const mkdoc = (n, extra) => { const d = h.mkdir(base, 'doc-' + n); aif.scaffold({ dir: d, name: 'P ' + n, domain: n + '.local', php: '8.4', ...extra }); return fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8'); };
  const dLar = mkdoc('lar', { kind: 'laravel', tailwind: 'laravel' });
  h.ok(/Tailwind CSS 4 com Vite \(`resources\/css\/app\.css`\)/.test(dLar) && /não crie `tailwind\.config\.js`/.test(dLar) && /@import "tailwindcss"/.test(dLar), 'Laravel + Tailwind: Vite, app.css e o aviso de que o v4 não usa tailwind.config.js nem @tailwind base');
  const dCli = mkdoc('cli', { kind: 'php', tailwind: 'cli' });
  h.ok(/Raiz pública do site: `public\/`/.test(dCli) && /public\/dist\/output\.css/.test(dCli) && /--watch=always/.test(dCli) && /Processos > Tailwind/.test(dCli) && /sem Node\.js/.test(dCli), 'pasta PHP + CLI: raiz public/, entrada e saída, como recompilar');
  const dVite = mkdoc('vite', { kind: 'php', tailwind: 'vite' });
  h.ok(/src\/main\.js/.test(dVite) && /public\/dist\/assets/.test(dVite) && /npm run dev/.test(dVite), 'pasta PHP + Vite: entrada, saída e npm run dev');
  const dPlain = mkdoc('plain', { kind: 'php' }); const dLarNo = mkdoc('larno', { kind: 'laravel' }); const dWp = mkdoc('wp', { kind: 'wordpress', tailwind: 'cli' });
  h.ok(!/Tailwind/.test(dPlain) && !/Tailwind/.test(dLarNo) && !/Tailwind/.test(dWp), 'sem Tailwind (ou WordPress): o documento não fala dele');

  h.title('terminal e processo "Tailwind"');
  const proj = h.mkdir(base, 'site-cli');
  h.write(path.join(proj, 'src', 'input.css'), '@import "tailwindcss";\n');
  const site = { id: 'twsite', name: 'Site CLI', path: proj, domain: 'site-cli.local', php: 'none' };
  const pathOf = () => (sites.terminalEnv(site).PATH || '').split(path.delimiter);
  h.ok(!pathOf().includes(comps.dir('tailwindcss')), 'sem o componente: a pasta dele não entra no PATH do terminal');
  h.ok(!procs.capabilities(site).tailwind, 'sem o componente: o processo Tailwind fica indisponível');
  h.write(comps.bins.tailwind(), 'x'); // "instalado"
  h.ok(pathOf().includes(comps.dir('tailwindcss')), 'com o componente: o comando tailwindcss funciona no terminal do site');
  h.ok(procs.capabilities(site).tailwind === true, 'com o componente e src/input.css: o processo Tailwind está disponível');
  h.write(path.join(proj, 'package.json'), '{}');
  h.ok(procs.capabilities(site).tailwind === false, 'com package.json (projeto com Vite): quem recompila é o npm, o processo Tailwind sai de cena');
  fs.rmSync(path.join(proj, 'package.json'));
  fs.rmSync(path.join(proj, 'src'), { recursive: true });
  h.ok(procs.capabilities(site).tailwind === false, 'sem src/input.css (ex.: Laravel): indisponível');
  h.ok(procs.KINDS.tailwind && /Tailwind/.test(procs.KINDS.tailwind.label) && typeof procs.readSpecial('proc:twsite:tailwind') === 'string' && procs.readSpecial('proc:twsite:xyz') === null, 'o log do processo Tailwind entra na leitura de logs especiais (e um processo desconhecido, não)');
  fs.rmSync(comps.dir('tailwindcss'), { recursive: true, force: true });

  h.title('Laravel: npm install e build (npm simulado)');
  if (!h.IS_WIN) h.skip('o npm de mentira é um .cmd (Windows)');
  else {
    fakeNode(path.join(home, 'bin'));
    const lar = h.mkdir(base, 'lar-ok'); h.json(path.join(lar, 'package.json'), { devDependencies: { tailwindcss: '^4.0.0', vite: '^7.0.0' } });
    let log = []; const jl = (m) => log.push(m);
    let r = await projects.laravelTailwind(lar, sites.terminalEnv({ php: 'none', path: lar }), jl);
    let txt = log.join('\n');
    h.ok(r === 'laravel' && /fake-npm install/.test(txt) && /fake-npm run build/.test(txt) && /Tailwind CSS pronto/.test(txt), 'com Tailwind no package.json: roda npm install e npm run build e devolve "laravel"', txt);
    h.ok(!/baixando o Node/i.test(txt), 'com um Node.js 22.14 já instalado: não baixa outro');
    const larOld = h.mkdir(base, 'lar-old'); h.json(path.join(larOld, 'package.json'), { devDependencies: { vite: '^5.0.0' } });
    log = []; r = await projects.laravelTailwind(larOld, sites.terminalEnv({ php: 'none', path: larOld }), jl); txt = log.join('\n');
    h.ok(r === '' && /fake-npm run build/.test(txt) && /não traz o Tailwind no esqueleto/.test(txt), 'Laravel antigo (sem Tailwind no esqueleto): compila o que há, avisa e não afirma que tem Tailwind', txt);
    fakeNode(path.join(home, 'bin'), 1);
    log = []; r = await projects.laravelTailwind(lar, sites.terminalEnv({ php: 'none', path: lar }), jl); txt = log.join('\n');
    h.ok(r === '' && /O Tailwind CSS não ficou pronto/.test(txt) && /npm run build/.test(txt), 'npm falhou: não lança erro (o site continua sendo criado), avisa e diz o que rodar depois', txt);
    fs.rmSync(path.join(home, 'bin', 'node'), { recursive: true, force: true });
  }

  h.title('criar pasta PHP com Tailwind pela API (compilador e npm simulados)');
  if (!h.IS_WIN) h.skip('simulação de npm.cmd/.exe é do Windows');
  else {
    const srv = await h.startServer({
      setup: (hm) => {
        const bin = path.join(hm, 'bin');
        fakeNode(bin);
        h.write(path.join(bin, 'tailwindcss', 'tailwindcss.exe'), 'isto não é um executável'); // "instalado", mas não roda: testa a tolerância a falhas
      },
    });
    const call = srv.call; const www = h.mkdir(base, 'www');
    let r = await call('POST', '/api/project', { type: 'empty', name: 'Zero', dir: www, tailwind: 'xyz' });
    h.ok(r.status === 400 && /inválida/.test(r.j.error || ''), 'valor inválido: 400 antes de criar qualquer coisa', JSON.stringify(r.j));
    r = await call('POST', '/api/project', { type: 'wordpress', name: 'Blog', dir: www, tailwind: 'cli' });
    h.ok(r.status === 400 && /só para Laravel/.test(r.j.error || '') && !fs.existsSync(path.join(www, 'blog')), 'WordPress com Tailwind: 400 e nada criado');
    r = await call('POST', '/api/project', { type: 'laravel', name: 'Lar', dir: www, tailwind: 'cli' });
    h.ok(r.status === 400, 'Laravel com a opção da pasta PHP: 400');

    r = await call('POST', '/api/project', { type: 'empty', name: 'Estilo Cli', dir: www, tailwind: 'cli' });
    h.ok(r.status === 200, 'pasta PHP + CLI aceita', JSON.stringify(r.j));
    let j = await srv.waitJob('Novo projeto empty: Estilo Cli'); const P1 = path.join(www, 'estilo-cli');
    h.ok(j && j.status === 'done', 'a tarefa termina "done" mesmo com o compilador falhando (o site tem de nascer)', j && j.log.join(' | '));
    const l1 = (j && j.log.join('\n')) || '';
    h.ok(/src\/input\.css e public\/index\.php/.test(l1) && /O CSS do Tailwind ainda não foi compilado/.test(l1) && /Processos > Tailwind/.test(l1), 'o log avisa que o CSS não foi compilado e diz como seguir', l1);
    h.ok(fs.existsSync(path.join(P1, 'src', 'input.css')) && fs.existsSync(path.join(P1, 'public', 'index.php')) && !fs.existsSync(path.join(P1, 'index.php')) && !fs.existsSync(path.join(P1, 'package.json')), 'arquivos: src/input.css e public/index.php (sem index.php solto na raiz e sem package.json)');
    const s1 = ((await srv.state()).sites || []).find((s) => s.path && s.path.replace(/\\/g, '/').endsWith('/www/estilo-cli'));
    h.ok(s1 && s1.docrootResolved && s1.docrootResolved.replace(/\\/g, '/').endsWith('/estilo-cli/public'), 'o site abre a pasta public/ (src/ não fica exposta)', s1 && s1.docrootResolved);
    h.ok(s1 && s1.procCaps && s1.procCaps.tailwind === true, 'o painel já oferece o processo Tailwind para o site', s1 && JSON.stringify(s1.procCaps));
    const doc1 = fs.readFileSync(path.join(P1, 'CLAUDE.md'), 'utf8');
    h.ok(/public\/dist\/output\.css/.test(doc1) && /não crie `tailwind\.config\.js`/.test(doc1), 'CLAUDE.md do projeto explica o Tailwind 4 e o fluxo');

    r = await call('POST', '/api/project', { type: 'empty', name: 'Estilo Vite', dir: www, tailwind: 'vite' });
    h.ok(r.status === 200, 'pasta PHP + Vite aceita', JSON.stringify(r.j));
    j = await srv.waitJob('Novo projeto empty: Estilo Vite'); const P2 = path.join(www, 'estilo-vite'); const l2 = (j && j.log.join('\n')) || '';
    h.ok(j && j.status === 'done' && /fake-npm install/.test(l2) && /fake-npm run build/.test(l2) && /Tailwind CSS pronto/.test(l2), 'roda npm install e npm run build (npm simulado) e termina', l2);
    h.ok(fs.existsSync(path.join(P2, 'package.json')) && fs.existsSync(path.join(P2, 'vite.config.js')) && fs.existsSync(path.join(P2, 'public', 'index.php')), 'arquivos do Vite criados');
    const s2 = ((await srv.state()).sites || []).find((s) => s.path && s.path.replace(/\\/g, '/').endsWith('/www/estilo-vite'));
    h.ok(s2 && s2.procCaps && s2.procCaps.vite === true && s2.procCaps.tailwind === false, 'com Vite: o processo Vite fica disponível e o Tailwind avulso, não', s2 && JSON.stringify(s2.procCaps));

    r = await call('POST', '/api/project', { type: 'empty', name: 'Sem Estilo', dir: www });
    j = await srv.waitJob('Novo projeto empty: Sem Estilo');
    h.ok(j && j.status === 'done' && fs.existsSync(path.join(www, 'sem-estilo', 'index.php')) && !fs.existsSync(path.join(www, 'sem-estilo', 'src')), 'sem Tailwind: continua o index.php de teste na raiz, como sempre');
  }
});

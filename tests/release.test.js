// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Publicação: a versão tem de bater em package.json, no rodapé da tela e no CHANGELOG; as notas saem do CHANGELOG; o workflow só usa ações fixadas por SHA. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./lib/harness');
const tools = require('./lib/tools');

const ROOT = h.ROOT;
const VERSION = require('../package.json').version;

/** Um bash que enxerga os caminhos do repositório (no Windows, o do Git; o bash.exe do WSL não serve). */
function findBash() {
  const cands = [process.env.RDR_TEST_BASH, 'C:\\Program Files\\Git\\bin\\bash.exe', 'bash'].filter(Boolean);
  for (const b of cands) {
    if (b.includes('\\') && !tools.exists(b)) continue;
    const r = spawnSync(b, ['installer/release-notes.sh', VERSION], { cwd: ROOT, encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return b;
  }
  return null;
}

h.run(async () => {
  h.title('versão em todos os lugares');
  h.ok(/^\d+\.\d+\.\d+$/.test(VERSION), 'package.json tem uma versão X.Y.Z', VERSION);
  const index = h.read(path.join(ROOT, 'public', 'index.html'));
  h.ok(index.includes(`RDR LOCAL SERVER v${VERSION}`), 'o rodapé da barra lateral (index.html) mostra a mesma versão', VERSION);
  const changelog = h.read(path.join(ROOT, 'CHANGELOG.md')).replace(/\r\n/g, '\n');
  h.ok(new RegExp(`^## ${VERSION.replace(/\./g, '\\.')}$`, 'm').test(changelog), 'o CHANGELOG tem a seção da versão', VERSION);
  const first = /^## (\d+\.\d+\.\d+)$/m.exec(changelog);
  h.ok(first && first[1] === VERSION, 'a seção da versão atual é a primeira do CHANGELOG', first && first[1]);
  const lock = path.join(ROOT, 'package-lock.json');
  if (fs.existsSync(lock)) h.ok(require(lock).version === VERSION, 'package-lock.json na mesma versão');

  h.title('notas da release (installer/release-notes.sh)');
  const bash = findBash();
  if (!bash) h.skip('bash não encontrado (defina RDR_TEST_BASH): teste do release-notes.sh pulado');
  else {
    const run = (v) => spawnSync(bash, ['installer/release-notes.sh', v], { cwd: ROOT, encoding: 'utf8' });
    let r = run(VERSION);
    h.ok(r.status === 0 && r.stdout.trim().length > 50, 'imprime as notas da versão atual', r.stderr);
    h.ok(!/^## /m.test(r.stdout) && !/^\s/.test(r.stdout.slice(0, 1)), 'sem o título "## versão" e sem linhas em branco no começo');
    const prev = (changelog.match(/^## (\d+\.\d+\.\d+)$/gm) || [])[1];
    h.ok(!prev || !r.stdout.includes(prev + '\n'), 'não vaza o texto da versão seguinte (anterior)', prev);
    r = run('99.99.99'); h.ok(r.status === 1 && /não tem a seção/.test(r.stderr), 'versão sem seção: sai com erro e explica', `exit ${r.status} ${r.stderr}`);
    r = spawnSync(bash, ['installer/release-notes.sh'], { cwd: ROOT, encoding: 'utf8' }); h.ok(r.status !== 0, 'sem argumento: recusa');
  }

  h.title('workflows do GitHub Actions');
  const wfDir = path.join(ROOT, '.github', 'workflows');
  const files = fs.existsSync(wfDir) ? fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)) : [];
  h.ok(files.includes('release.yml'), 'release.yml existe');
  for (const f of files) {
    const uses = [...h.read(path.join(wfDir, f)).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    const loose = uses.filter((u) => !u.startsWith('./') && !/@[0-9a-f]{40}$/.test(u));
    h.ok(loose.length === 0, `${f}: toda ação é fixada pelo SHA do commit (proteção contra troca de tag)`, loose.join(', '));
  }
  const rel = h.read(path.join(wfDir, 'release.yml'));
  h.ok(/permissions:\s*\n\s+contents: read/.test(rel), 'release.yml: permissão padrão é só leitura (a escrita fica só no job que publica)');
});

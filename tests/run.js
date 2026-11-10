// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Executor dos testes: roda cada tests/*.test.js em um processo próprio e soma o resultado.
 *   node tests/run.js              suíte rápida (sem internet e sem ferramentas extras)
 *   node tests/run.js --full       inclui os testes que usam a internet ou baixam ferramentas
 *   node tests/run.js --only a,b   só os arquivos cujo nome contém a ou b (ex.: --only plan,smtp)
 *   node tests/run.js -v           mostra todas as linhas (por padrão, só as falhas)
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const full = args.includes('--full'); const verbose = args.includes('-v') || args.includes('--verbose');
const oi = args.indexOf('--only'); const only = oi >= 0 ? String(args[oi + 1] || '').split(',').filter(Boolean) : [];
const files = fs.readdirSync(__dirname).filter((f) => /\.test\.js$/.test(f)).sort().filter((f) => !only.length || only.some((o) => f.includes(o)));
if (!files.length) { console.error('Nenhum teste encontrado.'); process.exit(2); }

let ok = 0; let fail = 0; let skip = 0; const broken = [];
console.log(`RDR Local: ${files.length} arquivo(s) de teste${full ? ' (modo --full)' : ''}\n`);
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, RDR_TEST_FULL: full ? '1' : '' } });
  const out = `${r.stdout || ''}${r.stderr || ''}`; const lines = out.split(/\r?\n/);
  const m = /RESULTADO ok=(\d+) falha=(\d+) pulou=(\d+)/.exec(out);
  const o = m ? Number(m[1]) : 0; const x = m ? Number(m[2]) : 1; const s = m ? Number(m[3]) : 0;
  ok += o; fail += x; skip += s;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${x || !m || r.status ? 'X' : 'v'} ${f.padEnd(24)} ${String(o).padStart(3)} ok, ${x} falha, ${s} puladas  (${secs}s)`);
  if (verbose) console.log(lines.map((l) => '    ' + l).join('\n'));
  else if (x || !m || r.status) {
    broken.push(f);
    const bad = lines.filter((l, i) => /^(FALHA|---)/.test(l) || /^\s+->/.test(l) || (!m && i > lines.length - 25));
    console.log(bad.map((l) => '    ' + l).join('\n'));
    if (r.error) console.log('    (erro ao executar: ' + r.error.message + ')');
  }
}
console.log(`\nTotal: ${ok} ok, ${fail} falha, ${skip} puladas.${broken.length ? ' Com problema: ' + broken.join(', ') : ''}`);
process.exit(fail || broken.length ? 1 : 0);

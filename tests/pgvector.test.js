// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * pgvector: instalação como componente do PostgreSQL (SHA-256 fixado no código, só os arquivos esperados, mesma versão principal),
 * ativação por banco pela API e aviso ao restaurar um backup que usa a extensão.
 * A compilação em si é do workflow pgvector.yml (testada lá, com um PostgreSQL de verdade: CREATE EXTENSION, consulta e índice HNSW);
 * aqui o pacote é simulado, para conferir as regras do RDR Local sem baixar nada.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const h = require('./lib/harness');

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tarExe = () => (h.IS_WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar');

h.run(async () => {
  h.isolateHome();
  const comps = require('../lib/components');
  const backup = require('../lib/backup');
  const base = h.tmp('pgv');
  const V = comps.PGVECTOR.version; const REV = comps.PGVECTOR.rev;

  /** Monta um zip de mentira com os arquivos dados ({ 'lib/vector.dll': 'conteúdo' }). */
  const mkZip = (name, files) => {
    const stage = path.join(base, name + '-stage'); fs.rmSync(stage, { recursive: true, force: true });
    for (const [rel, txt] of Object.entries(files)) { const f = path.join(stage, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); }
    const zip = path.join(base, name + '.zip');
    const r = spawnSync(tarExe(), ['-a', '-c', '-f', zip, '-C', stage, ...fs.readdirSync(stage)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('não consegui criar o zip de teste: ' + (r.stderr || r.stdout));
    return zip;
  };
  const GOOD = { 'lib/vector.dll': 'DLL-FALSA', 'share/extension/vector.control': 'default_version = ' + V, [`share/extension/vector--${V}.sql`]: 'sql ' + V, [`share/extension/vector--0.8.6--${V}.sql`]: 'sql up', 'share/extension/pgvector-LICENSE.txt': 'PostgreSQL License' };

  /** PostgreSQL de mentira no bin/ isolado: só o que o RDR Local confere (postgres.exe, lib, share/extension e a versão). */
  const pgdir = comps.dir('postgres');
  const resetPg = (ver = '17.6') => {
    fs.rmSync(pgdir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(comps.bins.pg('postgres')), { recursive: true }); fs.writeFileSync(comps.bins.pg('postgres'), 'x');
    fs.mkdirSync(path.join(pgdir, 'lib'), { recursive: true }); fs.mkdirSync(path.join(pgdir, 'share', 'extension'), { recursive: true });
    fs.writeFileSync(path.join(pgdir, '.version'), ver);
  };
  const dll = path.join(pgdir, 'lib', 'vector.dll'); const ext = path.join(pgdir, 'share', 'extension');
  const err = (p) => p.then(() => '', (e) => e.message);

  h.title('onde o pacote é baixado');
  const url = comps.pgvectorUrl(17);
  h.ok(url === `https://github.com/RDRdigitalFloripa/rdrlocalserver/releases/download/pgvector-v${V}-${REV}/pgvector-${V}-pg17-win-x64.zip`, 'URL: release própria do pgvector no repositório do RDR Local, com versão e revisão', url);
  h.ok(!/\/latest\//.test(url), 'não usa "releases/latest" (que é a release do app, consultada pelo painel)');
  h.ok(/^\d+\.\d+\.\d+$/.test(V) && /^r\d+$/.test(REV), 'versão e revisão do pgvector bem formadas', `${V} ${REV}`);

  h.title('instalar o componente (pacote simulado)');
  if (!h.IS_WIN) h.skip('pacote do pgvector é para Windows (zip criado com o bsdtar do sistema)');
  else {
    resetPg();
    h.ok(!comps.isInstalled.pgvector() && comps.version('pgvector') === '', 'antes: pgvector não instalado e sem versão');
    const good = mkZip('good', GOOD);
    comps.PGVECTOR.sha256[17] = '';
    let m = await err(comps.pgvectorApply(good, 17));
    h.ok(/Não há pgvector pronto para o PostgreSQL 17/.test(m), 'SHA-256 ainda não gravado no código: recusa em vez de confiar no arquivo', m);

    comps.PGVECTOR.sha256[17] = '0'.repeat(64);
    m = await err(comps.pgvectorApply(good, 17));
    h.ok(/SHA-256 do pgvector não confere/.test(m) && !fs.existsSync(dll), 'SHA-256 diferente do fixado: descartado e nada é copiado', m);

    comps.PGVECTOR.sha256[17] = sha(good);
    await comps.pgvectorApply(good, 17);
    h.ok(fs.existsSync(dll) && fs.readFileSync(dll, 'utf8') === 'DLL-FALSA', 'vector.dll vai para a pasta lib do PostgreSQL');
    h.ok(['vector.control', `vector--${V}.sql`, `vector--0.8.6--${V}.sql`, 'pgvector-LICENSE.txt'].every((n) => fs.existsSync(path.join(ext, n))), 'control, scripts SQL (instalação e atualização) e a licença vão para share/extension');
    h.ok(comps.isInstalled.pgvector() && comps.version('pgvector') === `${V}-${REV}`, 'depois: instalado, com a versão gravada', comps.version('pgvector'));
    h.ok(!fs.existsSync(path.join(comps.dir('postgres'), '..', 'pgvector-tmp')), 'a pasta temporária de extração é apagada');
    h.ok(comps.listComponents().some((c) => c.id === 'pgvector' && c.installed && c.version === `${V}-${REV}`), 'aparece em Componentes como instalado');
    await comps.pgvectorApply(good, 17); h.ok(comps.isInstalled.pgvector(), 'instalar de novo por cima funciona (atualização)');

    h.title('só o esperado é copiado');
    resetPg();
    const evil = mkZip('evil', { ...GOOD, 'lib/evil.dll': 'x', 'bin/evil.exe': 'x', 'share/extension/outra.control': 'x', 'share/extension/outro.sql': 'x' });
    comps.PGVECTOR.sha256[17] = sha(evil);
    await comps.pgvectorApply(evil, 17);
    h.ok(fs.existsSync(dll) && !fs.existsSync(path.join(pgdir, 'lib', 'evil.dll')) && !fs.existsSync(path.join(pgdir, 'bin', 'evil.exe')) && !fs.existsSync(path.join(ext, 'outra.control')) && !fs.existsSync(path.join(ext, 'outro.sql')), 'arquivos fora da lista (evil.dll, bin\\evil.exe, outra.control, outro.sql) não são copiados, mesmo dentro de um zip com o hash certo');

    h.title('pacote incompleto');
    resetPg();
    const { [`share/extension/vector--${V}.sql`]: _drop, ...semSql } = GOOD;
    const bad = mkZip('bad', semSql); comps.PGVECTOR.sha256[17] = sha(bad);
    m = await err(comps.pgvectorApply(bad, 17));
    h.ok(/veio incompleto/.test(m) && !fs.existsSync(dll) && !fs.existsSync(path.join(ext, 'vector.control')), 'sem o script da versão: erro claro e NADA é copiado (nem a DLL)', m);

    h.title('pré-requisitos (sem baixar nada)');
    resetPg('15.3');
    m = await err(comps.install('pgvector', () => {}));
    h.ok(/Não há pgvector pronto para o PostgreSQL 15/.test(m), 'versão principal sem pacote (PostgreSQL 15): recusa antes de baixar', m);
    fs.rmSync(pgdir, { recursive: true, force: true });
    m = await err(comps.install('pgvector', () => {}));
    h.ok(/Instale o PostgreSQL antes/.test(m), 'sem PostgreSQL instalado: manda instalar o PostgreSQL primeiro', m);
  }

  h.title('backup que usa o pgvector');
  const dumpCom = path.join(base, 'com.sql'); const dumpSem = path.join(base, 'sem.sql'); const dumpTarde = path.join(base, 'tarde.sql');
  fs.writeFileSync(dumpCom, '--\n-- PostgreSQL database dump\n--\n\nCREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;\n\nCREATE TABLE t (id int);\n');
  fs.writeFileSync(dumpSem, '--\n-- PostgreSQL database dump\n--\n\nCREATE TABLE t (id int);\n');
  fs.writeFileSync(dumpTarde, '-- ' + 'x'.repeat(300000) + '\nCREATE EXTENSION IF NOT EXISTS vector;\n');
  h.ok(backup.usesVector(dumpCom) === true, 'reconhece o CREATE EXTENSION vector no começo do dump');
  h.ok(backup.usesVector(dumpSem) === false && backup.usesVector(path.join(base, 'nao-existe.sql')) === false, 'dump sem a extensão (ou arquivo ausente): não acusa');
  h.ok(backup.usesVector(dumpTarde) === false, 'só olha o começo do arquivo (não lê um dump de vários GB inteiro)');

  h.title('API: ativar por banco');
  const srv = await h.startServer(); const call = srv.call;
  let r = await call('POST', '/api/db/vector', { engine: 'mariadb', name: 'meubanco' });
  h.ok(r.status === 400 && /extensão do PostgreSQL/.test(r.j.error), 'MariaDB: recusa (pgvector é do PostgreSQL)', JSON.stringify(r.j));
  r = await call('POST', '/api/db/vector', { engine: 'postgres', name: 'meubanco' });
  h.ok(r.status === 400 && /não está em execução/.test(r.j.error), 'PostgreSQL parado: erro claro', JSON.stringify(r.j));
  r = await call('GET', '/api/state');
  h.ok((r.j.components || []).some((c) => c.id === 'pgvector' && c.installed === false), 'o estado lista o componente pgvector (não instalado)');
});

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Meilisearch: banco criado por versão anterior é migrado (com cópia de segurança) em vez de o serviço "não iniciar". */
const fs = require('fs');
const path = require('path');
const h = require('./lib/harness');

h.run(async () => {
  h.isolateHome();
  const services = require('../lib/services');
  const comps = require('../lib/components');
  const { P } = require('../lib/core');
  const SV = services.SV.meilisearch;

  h.title('quando migrar (compara versão menor, e como número)');
  const m = services.meiliMigration;
  h.ok(m('1.55.0', '1.56.2') === 'upgrade', '1.55.0 -> 1.56.2: migrar (o caso real)');
  h.ok(m('1.56.0', '1.56.9') === 'none', 'só o patch mudou (1.56.0 -> 1.56.9): nada a fazer');
  h.ok(m('1.56.2', '1.55.0') === 'downgrade', 'banco mais novo que o programa: não migra');
  h.ok(m('1.9.0', '1.10.0') === 'upgrade' && m('1.10.0', '1.9.0') === 'downgrade', 'compara número, não texto (1.9 < 1.10)');
  h.ok(m('2.0.0', '1.99.0') === 'downgrade' && m('1.99.0', '2.0.0') === 'upgrade', 'versão maior muda a decisão');
  h.ok(m('', '1.56.2') === 'none' && m('1.55.0', '') === 'none' && m('lixo', '1.56.2') === 'none', 'sem versão legível: não mexe');

  const root = path.join(P.data, 'meilisearch'); const db = path.join(root, 'data.ms');
  const setBin = (v) => { fs.mkdirSync(comps.dir('meilisearch'), { recursive: true }); fs.writeFileSync(path.join(comps.dir('meilisearch'), '.version'), v); };
  const setDb = (v) => { fs.mkdirSync(path.join(db, 'indexes'), { recursive: true }); fs.writeFileSync(path.join(db, 'VERSION'), v); fs.writeFileSync(path.join(db, 'indexes', 'dado.bin'), 'conteudo do indice'); };
  const backups = () => (fs.existsSync(root) ? fs.readdirSync(root).filter((n) => /^backup-/.test(n)).sort() : []);

  h.title('banco antigo: cópia de segurança e --upgrade-db');
  setBin('1.56.2'); setDb('1.55.0');
  SV.prepare();
  h.ok(SV.args().includes('--upgrade-db'), 'a partida leva --upgrade-db', SV.args().join(' '));
  const b1 = backups(); h.ok(b1.length === 1 && /^backup-1\.55\.0-\d{8}-\d{6}$/.test(b1[0]), 'cópia criada: backup-<versão antiga>-<data>', b1.join(','));
  const bk = path.join(root, b1[0] || 'x', 'data.ms');
  h.ok(fs.existsSync(path.join(bk, 'VERSION')) && fs.readFileSync(path.join(bk, 'VERSION'), 'utf8') === '1.55.0' && fs.readFileSync(path.join(bk, 'indexes', 'dado.bin'), 'utf8') === 'conteudo do indice', 'a cópia tem o banco inteiro, na versão antiga');
  h.ok(fs.readFileSync(path.join(db, 'VERSION'), 'utf8') === '1.55.0', 'o banco original não foi tocado antes da migração (quem migra é o Meilisearch)');
  await h.sleep(1100); SV.prepare(); await h.sleep(1100); SV.prepare(); // partidas que falham e repetem não enchem o disco
  h.ok(backups().length === 2, 'guarda só as 2 cópias mais novas', backups().join(','));

  h.title('banco já na versão do programa');
  setDb('1.56.2'); const before = backups().join(',');
  SV.prepare(); h.ok(!SV.args().includes('--upgrade-db'), 'sem --upgrade-db quando a versão bate');
  h.ok(backups().join(',') === before, 'e sem cópia nova');

  h.title('banco mais novo que o programa');
  setDb('1.57.0'); let msg = '';
  try { SV.prepare(); } catch (e) { msg = e.message; }
  h.ok(/mais nova que a instalada/.test(msg) && /Nada foi alterado/.test(msg), 'recusa com explicação (o Meilisearch não volta de versão)', msg);
  h.ok(!SV.args().includes('--upgrade-db') && backups().join(',') === before, 'sem flag e sem cópia');

  h.title('sem banco ainda (primeira vez)');
  fs.rmSync(db, { recursive: true, force: true }); SV.prepare();
  h.ok(!SV.args().includes('--upgrade-db') && fs.existsSync(root), 'só cria a pasta de dados, sem migrar');
});

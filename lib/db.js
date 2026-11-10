// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Gerenciamento básico de bancos (MariaDB e PostgreSQL) pelos clientes de linha de comando. */
const core = require('./core');
const comps = require('./components');
const services = require('./services');
const { cfg, run } = core;

const NAME_RE = /^[A-Za-z0-9_]{1,64}$/;
const SYSTEM = {
  mariadb: ['information_schema', 'mysql', 'performance_schema', 'sys'],
  postgres: ['postgres'],
};

function assertName(n) { if (!NAME_RE.test(String(n || ''))) throw new Error('Nome inválido: use letras, números e _ (até 64).'); }
function assertUp(engine) {
  if (!SYSTEM[engine]) throw new Error('Motor desconhecido');
  if (!services.isRunning(engine)) throw new Error(`${engine === 'mariadb' ? 'MariaDB' : 'PostgreSQL'} não está em execução.`);
}

const my = (sql) => run(comps.bins.mariadbCli(), ['-h127.0.0.1', `-P${cfg.ports.mariadb}`, '-uroot', '--protocol=tcp', '-N', '-B', '-e', sql]);
const pg = (sql, db = 'postgres') => run(comps.bins.pg('psql'), ['-h', '127.0.0.1', '-p', String(cfg.ports.postgres), '-U', 'postgres', '-d', db, '-At', '-c', sql]);

async function list(engine) {
  assertUp(engine);
  if (engine === 'mariadb') {
    const r = await my(`SELECT s.schema_name, ROUND(COALESCE(SUM(t.data_length+t.index_length),0)/1048576,2)
      FROM information_schema.schemata s LEFT JOIN information_schema.tables t ON t.table_schema=s.schema_name GROUP BY s.schema_name ORDER BY 1`);
    if (!r.ok) throw new Error(r.out);
    return r.out.split('\n').filter(Boolean).map((l) => { const [name, mb] = l.split('\t'); return { name, mb: Number(mb), system: SYSTEM.mariadb.includes(name) }; });
  }
  const r = await pg("SELECT datname, ROUND(pg_database_size(datname)/1048576.0,2) FROM pg_database WHERE NOT datistemplate ORDER BY 1");
  if (!r.ok) throw new Error(r.out);
  return r.out.split('\n').filter(Boolean).map((l) => { const [name, mb] = l.split('|'); return { name, mb: Number(mb), system: SYSTEM.postgres.includes(name) }; });
}

async function create(engine, name) {
  assertUp(engine); assertName(name);
  const r = engine === 'mariadb'
    ? await my(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    : await pg(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
  if (!r.ok) throw new Error(r.out);
}

async function dropRaw(engine, name) {
  assertUp(engine); assertName(name);
  if (SYSTEM[engine].includes(name)) throw new Error('Banco do sistema: não pode ser removido.');
  const r = engine === 'mariadb' ? await my(`DROP DATABASE \`${name}\``) : await pg(`DROP DATABASE "${name}"`);
  if (!r.ok) throw new Error(r.out);
}

/** Exclui o banco depois de salvar um backup automático. Retorna o caminho do backup (ou '' se não deu). */
async function drop(engine, name) {
  assertUp(engine); assertName(name);
  if (SYSTEM[engine].includes(name)) throw new Error('Banco do sistema: não pode ser removido.');
  let saved = '';
  try { saved = await require('./backup').dump(engine, name); } catch (e) { core.log(`Aviso: backup antes de excluir ${name} falhou (${e.message.slice(0, 120)}).`); }
  await dropRaw(engine, name);
  return saved;
}

function connectionInfo() {
  return {
    mariadb: { host: '127.0.0.1', port: cfg.ports.mariadb, user: 'root', password: '' },
    postgres: { host: '127.0.0.1', port: cfg.ports.postgres, user: 'postgres', password: '' },
    redis: { host: '127.0.0.1', port: cfg.ports.redis },
    mail: { host: '127.0.0.1', port: cfg.ports.mailpitSmtp },
    meili: { host: `http://127.0.0.1:${cfg.ports.meilisearch}` },
  };
}

module.exports = { list, create, drop, dropRaw, connectionInfo, assertName };

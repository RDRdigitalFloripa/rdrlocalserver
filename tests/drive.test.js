// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Backup na nuvem: Google Drive em um clique.
 * Sempre: validações que recusam antes de instalar ou abrir o navegador. Só com --full (Windows, internet): baixa o rclone e testa um destino
 * do Drive já existente (token falso) com criptografia. O teste NUNCA abre a autorização do Google: o caminho "novo destino" é manual.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./lib/harness');

const log = (j) => (j ? j.log.join('\n') : '');

h.run(async () => {
  const srv = await h.startServer(); const call = srv.call;
  const cloud = async () => (await call('GET', '/api/cloud')).j;

  h.title('1) validações (nada pode ser instalado nem aberto)');
  let c = await cloud(); h.ok(c.installed === false && c.kinds.drive === 'Google Drive', 'ponto de partida: rclone não instalado');
  for (const [body, why] of [[{ name: '1abc' }, 'nome começando com número'], [{ name: 'x-crypt' }, 'nome terminado em -crypt'], [{ name: 'a b' }, 'nome com espaço'], [{ passphrase: 'curta' }, 'senha de criptografia curta'], [{ path: '../fora' }, 'pasta com ..'], [{ path: 'a:b' }, 'pasta com ":"'], [{ path: '-x' }, 'pasta começando com -']]) {
    const r = await call('POST', '/api/cloud/drive', body); h.ok(r.status === 400, `recusa na hora: ${why}`, `HTTP ${r.status} ${r.j.error}`);
  }
  c = await cloud(); h.ok(c.installed === false && !(await srv.lastJob('Conectar Google Drive')), 'nenhuma tarefa foi criada e o rclone continua sem instalar');
  const r0 = await call('POST', '/api/cloud/cancel', {}); h.ok(r0.status === 200 && r0.j.cancelled === false, 'cancelar sem nada pendente: cancelled=false (sem erro)');

  if (!h.FULL) { h.skip('Google Drive com destino existente e criptografia (baixa o rclone): rode com --full'); return; }
  if (!h.IS_WIN) { h.skip('Google Drive com destino existente: o rclone usado pelo RDR Local é o do Windows'); return; }

  h.title('2) destino do Drive já existente (autorização reaproveitada) + criptografia');
  await call('POST', '/api/install', { id: 'rclone' });
  const inst = await srv.waitJob('Instalar rclone', undefined, 180000);
  h.ok(inst && inst.status === 'done', 'rclone instalado pelo painel (SHA-256 conferido)', log(inst).slice(-300));
  c = await cloud(); h.ok(c.installed === true && /^\d+\.\d+/.test(c.version || ''), 'o painel enxerga o rclone', c.version);
  const rclone = path.join(srv.home, 'bin', 'rclone', 'rclone.exe'); const conf = path.join(srv.home, 'config', 'cloud', 'rclone.conf');
  const mkRemote = (name, ...args) => spawnSync(rclone, ['--config', conf, 'config', 'create', name, ...args], { encoding: 'utf8' });
  const mk = mkRemote('fake-drive', 'drive', 'scope', 'drive.file', 'token', '{"access_token":"fake","token_type":"Bearer","refresh_token":"fake","expiry":"2020-01-01T00:00:00Z"}', '--non-interactive');
  c = await cloud(); h.ok(c.remotes.some((x) => x.name === 'fake-drive' && x.type === 'drive'), 'destino "fake-drive" (tipo drive, token falso) criado para o teste', mk.stderr);
  const PASS = 'uma-senha-bem-longa-123';
  let r = await call('POST', '/api/cloud/drive', { name: 'fake-drive', path: 'Cofre', passphrase: PASS }); h.ok(r.status === 200, 'aceito com destino existente + senha de criptografia');
  let j = await srv.waitJob('Conectar Google Drive', undefined, 90000);
  h.ok(/já existe: reaproveitando a autorização/.test(log(j)) && !/53682\/auth/.test(log(j)), 'reaproveita a autorização: NÃO abre o navegador', log(j));
  h.ok(/Destino em uso: Google Drive, pasta "Cofre"; envio automático ligado/.test(log(j)) && /Criptografia ligada/.test(log(j)) && /Testando a conexão/.test(log(j)), 'define o destino, liga o envio automático, liga a criptografia e vai testar');
  h.ok(j.status === 'error', 'o teste final falha (token falso) e a tarefa mostra erro em vez de "pronto"', `status ${j.status}: ${log(j).slice(-300)}`);
  c = await cloud(); h.ok(c.settings.remote === 'fake-drive' && c.settings.path === 'Cofre' && c.settings.enabled === true && c.settings.encrypt === true, 'configuração salva: destino, pasta, envio automático e criptografia ligados', JSON.stringify(c.settings));
  const cf = fs.readFileSync(conf, 'utf8'); h.ok(!cf.includes(PASS) && /\[fake-drive-crypt\]/.test(cf) && /type = crypt/.test(cf), 'rclone.conf tem a seção crypt e NÃO tem a senha em texto');
  h.ok(!(await call('GET', '/api/cloud')).raw.includes(PASS) && !fs.readFileSync(path.join(srv.home, 'config', 'config.json'), 'utf8').includes(PASS), 'a senha não aparece na API nem no config.json');

  h.title('3) conflitos');
  r = await call('POST', '/api/cloud/drive', { name: 'outro-drive' }); h.ok(r.status === 400 && /criptografia já está ligada/.test(r.j.error), 'criptografia ligada em outro destino: recusa trocar na hora');
  r = await call('POST', '/api/cloud/drive', { name: 'fake-drive', path: 'Outra-Pasta' }); h.ok(r.status === 400 && /criptografia já está ligada/.test(r.j.error), 'criptografia ligada: recusa trocar só a pasta');
  r = await call('POST', '/api/cloud/drive', { name: 'fake-drive', path: 'Cofre', enable: false }); h.ok(r.status === 200, 'mesmo destino e pasta: aceito (reconfigurar)');
  j = await srv.waitJob('Conectar Google Drive', undefined, 90000);
  h.ok(!/Ligando a criptografia/.test(log(j)) && /envio automático desligado/.test(log(j)), 'reconfigurar não liga a criptografia de novo e respeita "envio automático desligado"', log(j));
  await call('POST', '/api/cloud/encryption', { disable: true });
  mkRemote('meu-local', 'local');
  await call('POST', '/api/cloud/drive', { name: 'meu-local' }); j = await srv.waitJob('Conectar Google Drive', undefined, 60000);
  h.ok(j.status === 'error' && /não é Google Drive/.test(log(j)), 'nome de um destino que não é Google Drive: recusa sem mexer nele', log(j));
  c = await cloud(); h.ok(c.remotes.some((x) => x.name === 'meu-local' && x.type === 'local'), 'o destino "meu-local" continua intacto');
});

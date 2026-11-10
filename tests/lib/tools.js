// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Ferramentas opcionais que alguns testes usam (e que o teste pula se não existirem): openssl, PHP, Composer, npm. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('./harness');

const exists = (p) => { try { fs.accessSync(p); return true; } catch (_) { return false; } };

/** Gera um certificado autoassinado (localhost, 127.0.0.1) com o openssl, se houver. Devolve { key, cert } ou null. */
function makeCert() {
  const cands = [process.env.RDR_TEST_OPENSSL, 'openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'].filter(Boolean);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdr-test-pki-'));
  try {
    for (const exe of cands) {
      const r = spawnSync(exe, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' } });
      if (r.status === 0 && exists(path.join(dir, 'c.pem'))) return { key: fs.readFileSync(path.join(dir, 'k.pem'), 'utf8'), cert: fs.readFileSync(path.join(dir, 'c.pem'), 'utf8') };
    }
    return null;
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ok */ } }
}

/** PHP e Composer para os testes que precisam deles: RDR_TEST_PHP (pasta php-8.x) e RDR_TEST_COMPOSER, ou bin/ do próprio repositório. */
function findPhp() {
  let php = process.env.RDR_TEST_PHP || '';
  if (!php && exists(path.join(ROOT, 'bin'))) { const d = fs.readdirSync(path.join(ROOT, 'bin')).filter((n) => /^php-\d+\.\d+$/.test(n)).sort().pop(); if (d) php = path.join(ROOT, 'bin', d); }
  const composer = process.env.RDR_TEST_COMPOSER || path.join(ROOT, 'bin', 'composer');
  const cacert = [process.env.RDR_TEST_CACERT, path.join(ROOT, 'bin', 'cacert.pem')].filter(Boolean).find(exists) || '';
  if (!php || !exists(path.join(php, 'php.exe')) || !exists(path.join(composer, 'composer.phar'))) return null;
  return { php, composer, cacert };
}

/** Copia PHP e Composer para o bin/ de um RDR_HOME de teste (e aponta o php.ini para um cacert que existe). */
function installPhp(home, t) {
  const bin = path.join(home, 'bin'); fs.mkdirSync(bin, { recursive: true });
  const ver = path.basename(t.php); fs.cpSync(t.php, path.join(bin, ver), { recursive: true }); fs.cpSync(t.composer, path.join(bin, 'composer'), { recursive: true });
  const ini = path.join(bin, ver, 'php.ini');
  if (exists(ini)) {
    let txt = fs.readFileSync(ini, 'utf8');
    txt = txt.replace(/^(curl\.cainfo|openssl\.cafile)\s*=.*$/gm, t.cacert ? `$1 = "${t.cacert.replace(/\\/g, '/')}"` : '; $1 removido pelo teste');
    fs.writeFileSync(ini, txt);
  }
}

const hasNpm = () => { const r = spawnSync('npm', ['--version'], { shell: true, encoding: 'utf8' }); return r.status === 0; };

module.exports = { makeCert, findPhp, installPhp, hasNpm, exists };

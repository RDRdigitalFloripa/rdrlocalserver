// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * SMTP real para testar envio de verdade: perfil editável (servidor, porta, segurança, usuário, senha, remetente),
 * teste de conexão, e-mail de teste e "usar no projeto" (grava MAIL_* no .env de um site, ou volta ao Mailpit).
 * A senha NUNCA fica em config.json nem volta pela API: vai para config/secrets.json protegida pelo Windows (DPAPI).
 */
const core = require('./core');
const secrets = require('./secrets');
const smtp = require('./smtp');
const envfile = require('./envfile');
const { cfg } = core;

const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const SECURE = ['starttls', 'ssl', 'none'];
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const sent = []; // horários dos envios de teste (limite por hora)

const mailpitPreset = () => ({ id: 'mailpit', label: 'Mailpit (local do RDR Local)', host: '127.0.0.1', port: cfg.ports.mailpitSmtp, secure: 'none', note: 'Fica retido no Mailpit: nada sai para a internet.' });

/** O que a tela mostra (nunca a senha: só se existe uma salva). */
function view() {
  const s = cfg.smtp;
  return { host: s.host, port: s.port, secure: s.secure, user: s.user, from: s.from, fromName: s.fromName, insecureTls: !!s.insecureTls, lastTo: s.lastTo, hasPassword: !!secrets.get('smtpPassword'), presets: [mailpitPreset(), ...smtp.PRESETS] };
}

/** Valida os campos do formulário (sem gravar nada). */
function parse(b) {
  const o = {
    host: clean(b.host, 253), port: Number(b.port), secure: String(b.secure || 'starttls'), user: clean(b.user, 200),
    from: clean(b.from, 200), fromName: clean(b.fromName, 100).replace(/["<>\\]/g, ''), insecureTls: !!b.insecureTls,
  };
  if (o.host && !HOST_RE.test(o.host)) throw new Error('Servidor inválido: use só letras, números, ponto e hífen (sem http:// nem espaços).');
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error('Porta inválida (1 a 65535).');
  if (!SECURE.includes(o.secure)) throw new Error('Segurança inválida.');
  if (o.from && !smtp.EMAIL_RE.test(o.from)) throw new Error('E-mail do remetente inválido.');
  return o;
}

function checkPassword(p) { if (/[\r\n\0]/.test(p)) throw new Error('A senha não pode ter quebra de linha.'); if (p.length > 500) throw new Error('Senha muito longa.'); }

/** Grava o perfil. Senha em branco mantém a que já está salva; clearPassword apaga. */
function save(b) {
  const s = parse(b);
  const pw = typeof b.password === 'string' ? b.password : '';
  if (pw) checkPassword(pw);
  Object.assign(cfg.smtp, s);
  if (b.clearPassword) secrets.setProtected('smtpPassword', '');
  else if (pw) secrets.setProtected('smtpPassword', pw);
  core.save();
  core.log(`SMTP salvo: ${s.host || '(vazio)'}:${s.port} (${s.secure}).`);
}

/** Testa com os valores do formulário (sem gravar). mode: connect | send. */
async function run(b) {
  const mode = b.mode === 'send' ? 'send' : 'connect';
  const s = parse(b.settings || b);
  if (!s.host) throw new Error('Informe o servidor SMTP.');
  const typed = typeof b.password === 'string' ? b.password : '';
  if (typed) checkPassword(typed);
  const pass = typed || (s.user ? secrets.getProtected('smtpPassword') : '');
  if (s.user && !pass) throw new Error('Informe a senha (ou salve uma antes).');
  let to = '';
  if (mode === 'send') {
    to = clean(b.to, 200);
    if (!smtp.EMAIL_RE.test(to)) throw new Error('Informe um e-mail de destino válido (um só).');
    if (!s.from) throw new Error('Informe o e-mail do remetente (From).');
    const now = Date.now(); while (sent.length && now - sent[0] > 3600000) sent.shift();
    if (sent.length >= 10) throw new Error('Limite de 10 e-mails de teste por hora atingido.');
    if (sent.length && now - sent[sent.length - 1] < 3000) throw new Error('Aguarde alguns segundos entre um teste e outro.');
    sent.push(now); cfg.smtp.lastTo = to; core.save();
  }
  const r = await smtp.test(s, pass, mode, to);
  core.log(`SMTP ${mode === 'send' ? 'e-mail de teste' : 'teste de conexão'} em ${s.host}:${s.port}: ${r.ok ? 'ok' : 'falhou (' + r.error + ')'}`);
  return r;
}

/** Grava MAIL_* no .env de um site: com o SMTP real salvo ou de volta com o Mailpit local. Devolve as chaves gravadas. */
function apply(site, mode) {
  let pairs;
  if (mode === 'mailpit') {
    pairs = { MAIL_MAILER: 'smtp', MAIL_HOST: '127.0.0.1', MAIL_PORT: String(cfg.ports.mailpitSmtp), MAIL_USERNAME: 'null', MAIL_PASSWORD: 'null', MAIL_ENCRYPTION: 'null' };
  } else if (mode === 'real') {
    const s = cfg.smtp; if (!s.host) throw new Error('Salve o servidor SMTP antes de usá-lo no projeto.');
    const pass = s.user ? secrets.getProtected('smtpPassword') : '';
    if (s.user && !pass) throw new Error('Salve a senha do SMTP antes de usá-lo no projeto.');
    pairs = { MAIL_MAILER: 'smtp', MAIL_HOST: s.host, MAIL_PORT: String(s.port), MAIL_USERNAME: s.user || 'null', MAIL_PASSWORD: s.user ? pass : 'null', MAIL_ENCRYPTION: s.secure === 'starttls' ? 'tls' : s.secure === 'ssl' ? 'ssl' : 'null' };
    if (s.from) pairs.MAIL_FROM_ADDRESS = s.from;
    if (s.fromName) pairs.MAIL_FROM_NAME = s.fromName;
  } else throw new Error('Modo inválido (use real ou mailpit).');
  envfile.setMany(site, pairs);
  core.log(`.env de ${site.name}: e-mail ${mode === 'real' ? 'com o SMTP real' : 'de volta para o Mailpit'}.`);
  return Object.keys(pairs);
}

module.exports = { view, save, run, apply, parse };

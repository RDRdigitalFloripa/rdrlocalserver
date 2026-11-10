// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  open: '<path d="M7 17 17 7M8 7h9v9"/>', play: '<path d="M6 4v16l14-8z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', term: '<path d="m5 7 5 5-5 5M12 18h7"/>', folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  redo: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', pkg: '<path d="M12 3 4 7v10l8 4 8-4V7zM4 7l8 4 8-4M12 11v10"/>',
  log: '<path d="M5 5h14M5 10h14M5 15h9"/>', proc: '<path d="M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01"/>', del: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24">${ICON[n]}</svg>`;

// ---------- modal padrão + toasts ----------
const ui = (() => {
  const dlg = $('#uiDlg'); let chain = Promise.resolve();
  const ICONS = { info: 'i', bad: '!', warn: '!', ok: '✓', ask: '?' };
  function open(o) {
    return new Promise((resolve) => {
      let result = null; const input = $('#uiInput'); const ok = $('#uiOk'); const cancel = $('#uiCancel');
      const tone = o.tone || (o.danger ? 'bad' : o.type === 'alert' ? 'info' : 'ask');
      $('#uiIco').className = 'ui-ico ' + (tone === 'ask' ? '' : tone); $('#uiIco').textContent = ICONS[tone] || 'i';
      $('#uiTitle').textContent = o.title || (o.type === 'alert' ? 'Aviso' : 'Confirmar');
      const msg = $('#uiMsg'); if (o.html) msg.innerHTML = o.html; else msg.textContent = o.message || '';
      const pre = $('#uiPre'); pre.hidden = !o.pre; pre.textContent = o.pre || '';
      const needsInput = o.type === 'prompt' || !!o.requireText;
      $('#uiField').hidden = !needsInput; input.value = o.value || '';
      $('#uiLabel').textContent = o.label || (o.requireText ? `Digite ${o.requireText} para confirmar` : '');
      input.placeholder = o.placeholder || (o.requireText || '');
      ok.textContent = o.okText || (o.type === 'alert' ? 'OK' : o.danger ? 'Confirmar' : 'OK');
      ok.className = o.danger ? 'danger' : '';
      cancel.hidden = o.type === 'alert'; cancel.textContent = o.cancelText || 'Cancelar';
      const valid = () => { const v = input.value.trim(); if (o.requireText) return v === o.requireText; if (o.type === 'prompt') return v !== '' || o.allowEmpty; return true; };
      const sync = () => { ok.disabled = !valid(); };
      input.oninput = sync; sync();
      $('#uiForm').onsubmit = (e) => { e.preventDefault(); if (!valid()) return; result = o.type === 'prompt' ? input.value.trim() : true; dlg.close(); };
      cancel.onclick = () => { result = null; dlg.close(); };
      dlg.onclose = () => resolve(result);
      dlg.showModal();
      if (needsInput) { input.focus(); input.select(); } else ok.focus();
    });
  }
  const queue = (o) => { const p = chain.then(() => open(o)); chain = p.catch(() => {}); return p; };
  return {
    alert: (o) => queue({ type: 'alert', ...o }).then(() => undefined),
    confirm: (o) => queue({ type: 'confirm', ...o }).then((v) => !!v),
    prompt: (o) => queue({ type: 'prompt', ...o }),
    toast(message, tone = 'ok') {
      const el = document.createElement('div'); el.className = 'toast ' + tone; el.textContent = message; $('#toasts').appendChild(el);
      setTimeout(() => el.remove(), tone === 'bad' ? 7000 : 4000);
    },
  };
})();

let S = null; let M = null; let page = 'painel'; let editing = null; let jobShown = null; let jobDismissed = new Set();

async function api(method, url, body, quiet) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-RDR': '1' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (!quiet) ui.alert({ title: 'Não foi possível concluir', message: j.error || 'Erro', tone: 'bad' }); throw new Error(j.error || 'Erro'); }
  return j;
}
const act = (fn) => async (e) => { const b = e && e.currentTarget; if (b) b.disabled = true; try { await fn(e); } catch (_) { /* alert já exibido */ } if (b) b.disabled = false; await refresh(); };

// ---------- navegação ----------
function go() {
  page = location.hash.slice(1) || 'painel';
  if (!document.getElementById('p-' + page)) page = 'painel';
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.id === 'p-' + page));
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.p === page));
  if (page === 'config') fillSettings();
  if (page === 'componentes' && S && S.updates && S.updates.pending) checkUpdates(false);
  if (page === 'bancos') { loadDbs(); loadBackups(); }
  if (page === 'diagnostico' && !window._dg) runDoctor();
  if (page === 'terminal') { T.sig = ''; syncTerminalSites(); setTimeout(() => $('#tmIn').focus(), 50); }
  if (page === 'logs') loadLog();
  if (page === 'ajuda') loadHelp();
  if (page === 'nuvem') loadCloud(true);
  if (page === 'github') loadGh(true);
  if (page === 'publicar') loadPb();
  if (S) renderAll();
  if (page === 'painel') { renderMetrics(); if (typeof loadGitStatus === 'function') loadGitStatus(); }
}
window.addEventListener('hashchange', go);

// ---------- render ----------
function renderAll() {
  renderBanners(); renderCards(); renderSites(); renderEnv(); renderJobs(); renderSide();
  if (page === 'componentes') renderComponents();
  if (page === 'ssl') renderSsl();
  if (page === 'email') renderMail();
  if (page === 'bancos') renderConn();
  if (page === 'terminal') syncTerminalSites();
}

function renderSide() {
  $('#sideFoot').textContent = S.platform === 'win32' ? 'Windows' : `Modo desenvolvimento (${S.platform})`;
  const sv = document.querySelector('.side-ver'); if (sv && S.version) sv.textContent = `RDR LOCAL SERVER v${S.version}`;
  document.querySelectorAll('[data-version]').forEach((e) => { e.textContent = S.version || ''; });
  const nu = $('#navUpd'); const pend = (S.updates && S.updates.pending) || 0;
  if (nu) { nu.hidden = !pend; nu.textContent = pend || ''; nu.title = pend ? `${pend} atualização(ões) disponível(is)${S.updates.app ? ' (inclui o RDR Local)' : ''}` : ''; }
  if (pend && page === 'componentes' && !UPD.auto) { UPD.auto = true; checkUpdates(false); } // página aberta direto: mostra o que está pendente
}

function renderBanners() {
  const b = [];
  const caddy = S.components.find((c) => c.id === 'caddy');
  if (!caddy.installed || !S.php.installed.length) {
    b.push(`<div class="banner info"><span><b>Primeiro uso:</b> instale Caddy, PHP, Composer, MariaDB, Redis e Mailpit com um clique.</span><button data-a="installAll">Instalar tudo</button></div>`);
  }
  if (S.hostsError) b.push(`<div class="banner bad"><span>${esc(S.hostsError)}</span><button class="sec sm" data-a="copyHosts">Copiar linhas do hosts</button></div>`);
  if (caddy.installed && !S.ca.trusted) b.push(`<div class="banner warn"><span>O navegador ainda não confia no HTTPS local. Inicie o Servidor Web e clique em “Confiar na CA” (como Administrador) para ter o cadeado verde.</span><button data-a="trust">Confiar na CA</button></div>`);
  $('#banners').innerHTML = b.join('');
}

function renderCards() {
  const nSites = S.sites.length; const nOn = S.sites.filter((s) => s.enabled !== false).length;
  $('#cards').innerHTML = S.services.map((s) => {
    const meta = [s.version && `v${s.version}`, s.ports.length && `porta ${s.ports.join(' / ')}`, s.id === 'web' && `${nOn}/${nSites} sites`].filter(Boolean).join('<br>');
    if (!s.installed) return `<div class="svc off"><b>${esc(s.label)}</b><button class="sec inst" data-a="install" data-id="${s.id === 'web' ? 'caddy' : s.id}" style="color:#fff;border-color:rgba(255,255,255,.4)">Instalar</button><div class="meta">não instalado</div></div>`;
    const cls = s.busy ? 'busy' : s.running ? 'stop' : '';
    return `<div class="svc"><b>${esc(s.label)}</b><div class="ctl"><button class="pb ${cls}" data-a="svc" data-id="${s.id}" data-run="${s.running ? 1 : 0}" ${s.busy ? 'disabled' : ''} title="${s.running ? 'Parar' : 'Iniciar'}">
      <svg viewBox="0 0 24 24">${s.running ? '<rect x="6" y="6" width="12" height="12" rx="2"/>' : '<path d="M7 4v16l13-8z"/>'}</svg></button></div>
      <div class="meta">${s.running ? 'Em execução' : 'Parado'}${meta ? '<br>' + meta : ''}</div></div>`;
  }).join('');
}

var GITST = {};
function gitChip(s) {
  const v = GITST[s.id]; if (!v || v.error) return '';
  const n = v.changed + v.untracked;
  const gone = v.remoteGone ? '<span class="chip bad" title="O repositório não existe mais no GitHub (removido, renomeado ou sem acesso). A pasta local continua intacta.">removido no GitHub?</span>' : '';
  return gone + `<span class="badge" title="Branch ${esc(v.branch)}${n ? ' · ' + n + ' alteração(ões) sem commit' : ''}${v.behind ? ' · ' + v.behind + ' commit(s) para baixar' : ''}">⎇ ${esc(v.branch)}${n ? ' ●' : ''}${v.behind ? ' ↓' + v.behind : ''}</span>`;
}
async function loadGitStatus() { try { GITST = await api('GET', '/api/git/status', null, true); if (page === 'painel' && S) renderSites(); } catch (_) { /* sem git */ } }
setInterval(() => { if (page === 'painel') loadGitStatus(); }, 30000); setTimeout(loadGitStatus, 1500);
function renderSites() {
  const el = $('#sitesTable');
  if (!S.sites.length) { el.innerHTML = '<div class="empty">Nenhum site ainda. Use “Adicionar site”, “Escanear pasta” ou “Novo projeto”.</div>'; return; }
  el.innerHTML = `<table><thead><tr><th>Site</th><th>Domínio</th><th>Status</th><th></th></tr></thead><tbody>` + S.sites.map((s) => {
    const off = s.enabled === false;
    const isApp = s.type === 'app'; const ap = s.app || {};
    const st = off ? '<span class="chip">Desativado</span>'
      : isApp ? (ap.running ? (s.running ? '<span class="chip on">App executando</span>' : '<span class="chip warn" title="O app está ligado, mas o Servidor Web está parado">App ligado</span>') : ap.gaveUp ? '<span class="chip bad" title="Caiu várias vezes seguidas e não foi religado. Veja o log do app.">App caiu</span>' : '<span class="chip warn">App parado</span>')
      : s.running ? '<span class="chip on">Executando</span>' : '<span class="chip warn">Servidor parado</span>';
    const link = s.running ? `<a href="${esc(s.url)}" target="_blank">${esc(s.domain)}</a>` : esc(s.domain);
    const al = (s.aliases || []).length ? `<small>+ ${esc(s.aliases.join(', '))}</small>` : '';
    const net = s.type === 'proxy' || s.type === 'redirect';
    const php = net ? '' : isApp ? (s.runtime === 'custom' ? 'comando próprio' : `${({ node: 'Node', python: 'Python', go: 'Go', java: 'Java' })[s.runtime] || s.runtime} ${ap.runtimeVersion || '—'}`) : s.phpResolved ? `PHP ${s.phpResolved}` : 'sem PHP';
    return `<tr class="${off ? 'dis' : ''}">
      <td><b>${esc(s.name)}</b><small${isApp ? ` title="${esc(s.cmd)}"` : ''}>${net ? (s.type === 'proxy' ? '→ ' : '↪ ') + esc(s.target) + (s.cors ? ' · CORS' : '') : esc(s.path) + (isApp ? ` · porta ${s.appPort}` : '') + (s.exists ? '' : ' — pasta não encontrada')}</small></td>
      <td>${link}${al}<div style="margin-top:3px"><span class="badge">${esc(s.kind)}</span>${gitChip(s)}${php ? `<span class="badge">${esc(php)}</span>` : ''}</div></td>
      <td>${st}</td>
      <td><div class="acts">
        <button class="ib" title="Abrir no navegador" data-a="open" data-id="${s.id}">${ic('open')}</button>
        <button class="ib ${off ? 'go' : 'pause'}" title="${off ? 'Ativar o site' : 'Desativar o site'}" data-a="toggle" data-id="${s.id}">${ic(off ? 'play' : 'pause')}</button>
        ${isApp && !off ? `<button class="ib ${ap.running ? 'pause' : 'go'}" title="${ap.running ? 'Parar o app' : 'Iniciar o app'}" data-a="appctl" data-run="${ap.running ? 1 : 0}" data-id="${s.id}">${ic(ap.running ? 'pause' : 'play')}</button>
        <button class="ib" title="Reiniciar o app" data-a="apprestart" data-id="${s.id}">${ic('redo')}</button>` : ''}
        <button class="ib" title="Editar" data-a="edit" data-id="${s.id}">${ic('edit')}</button>
        ${isApp ? `<button class="ib" title="Instalar dependências (npm install / pip)" data-a="appdeps" data-id="${s.id}">${ic('pkg')}</button>
        <button class="ib" title="Log do app" data-a="applog" data-id="${s.id}">${ic('proc')}</button>` : ''}
        ${net ? '' : `<button class="ib" title="Terminal do site (mini terminal)" data-a="term" data-id="${s.id}">${ic('term')}</button>
        <button class="ib" title="Abrir pasta" data-a="folder" data-id="${s.id}">${ic('folder')}</button>`}
        <button class="ib ${Object.values(s.procs || {}).some(Boolean) ? 'go' : ''}" title="Processos (fila, agendador, Vite)" data-a="procs" data-id="${s.id}">${ic('proc')}</button>
        <button class="ib" title="Log de acesso" data-a="slog" data-id="${s.id}">${ic('log')}</button>
        <button class="ib del" title="Remover (não apaga a pasta)" data-a="del" data-id="${s.id}">${ic('del')}</button>
      </div></td></tr>`;
  }).join('') + '</tbody></table>';
}

function renderEnv() {
  const p = S.settings.ports;
  $('#envInfo').innerHTML = `Terminação: <b>.${esc(S.settings.tld)}</b><br>Web: ${p.http}/${p.https}<br>MariaDB: ${p.mariadb} · PostgreSQL: ${p.postgres}<br>Redis: ${p.redis} · SMTP: ${p.mailpitSmtp}<br>PHP padrão: ${esc(S.php.default || '—')}`;
}

function gauge(v) {
  const a = Math.PI * (1 - v / 100); const x = 60 + 50 * Math.cos(a); const y = 62 - 50 * Math.sin(a);
  const col = v < 50 ? '#29c36a' : v < 80 ? '#f0b429' : '#e5484d';
  return `<div class="gauge"><svg viewBox="0 0 120 70" width="170"><path d="M10 62A50 50 0 0 1 110 62" fill="none" stroke="var(--line)" stroke-width="10" stroke-linecap="round"/>
    <path d="M10 62A50 50 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round"/></svg><b>${v.toFixed(1)}%</b></div>`;
}
const gb = (n) => (n / 1073741824).toFixed(1) + ' GB';
function renderMetrics() {
  if (!M) return;
  const pts = M.cpuHistory.map((v, i) => `${(i / Math.max(1, M.cpuHistory.length - 1)) * 100},${40 - (v / 100) * 38}`).join(' ');
  $('#mCpu').innerHTML = gauge(M.cpu) + `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none"><polyline fill="none" stroke="var(--ac)" stroke-width="1.5" points="${pts}"/></svg>`;
  const mp = (M.mem.used / M.mem.total) * 100;
  $('#mMem').innerHTML = `<div class="bar"><i style="width:${mp.toFixed(0)}%"></i></div><span class="muted small">${gb(M.mem.used)} de ${gb(M.mem.total)} (${mp.toFixed(0)}%)</span>`;
  if (M.disk.total) {
    const used = M.disk.total - M.disk.free; const dp = (used / M.disk.total) * 100;
    $('#mDisk').innerHTML = `<div class="bar"><i style="width:${dp.toFixed(0)}%"></i></div><span class="muted small">${gb(used)} usados de ${gb(M.disk.total)}</span>`;
  }
}

function renderJobs() {
  const running = S.jobs.find((j) => j.status === 'running');
  const j = running || (jobShown && S.jobs.find((x) => x.id === jobShown)) || [...S.jobs].reverse().find((x) => !jobDismissed.has(x.id));
  const el = $('#jobs');
  if (!j || jobDismissed.has(j.id) && !running) { el.hidden = true; return; }
  jobShown = j.id; el.hidden = false;
  $('#jobTitle').textContent = j.title;
  const st = $('#jobStatus'); st.textContent = j.status === 'running' ? 'em andamento' : j.status === 'done' ? 'concluído' : 'erro';
  st.className = 'chip ' + (j.status === 'running' ? 'warn' : j.status === 'done' ? 'on' : 'off');
  const pre = $('#jobLog'); const stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
  pre.textContent = j.log.join('\n'); if (stick) pre.scrollTop = pre.scrollHeight;
}

function renderRuntimes() {
  const el = $('#rtList'); if (!el || !S.runtimes) return;
  const rows = Object.entries(S.runtimes).flatMap(([rt, r]) => r.installed.map((x) => `<tr><td><b>${esc(r.label)} ${esc(x.v)}</b> <span class="muted small">${esc(x.full)}</span></td><td>${r.default === x.v ? '<span class="chip on">padrão</span> ' : ''}${x.uses ? `<span class="chip">${x.uses} app(s)</span>` : ''}</td>
    <td style="text-align:right">${r.default === x.v ? '' : `<button class="sec sm" data-a="rtDefault" data-rt="${rt}" data-v="${esc(x.v)}">Tornar padrão</button> `}<button class="sec sm" data-a="rtRemove" data-rt="${rt}" data-v="${esc(x.v)}" data-label="${esc(r.label)}">Remover</button></td></tr>`));
  const missing = Object.entries(S.runtimes).filter(([, r]) => !r.installed.length).map(([rt, r]) => `<tr><td><b>${esc(r.label)}</b></td><td><span class="chip">não instalado</span></td><td style="text-align:right"><button class="sm" data-a="rtLatest" data-rt="${rt}">Instalar versão LTS</button></td></tr>`);
  el.innerHTML = `<table><tbody>${rows.join('')}${missing.join('')}</tbody></table>`;
}
function renderComponents() {
  renderRuntimes();
  $('#compList').innerHTML = `<table><tbody>` + S.components.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${c.installed ? `<span class="chip on">instalado${c.version ? ' · ' + esc(c.version) : ''}</span>` : '<span class="chip">não instalado</span>'}</td>
    <td style="text-align:right">${c.installed ? '' : `<button class="sm" data-a="install" data-id="${c.id}">Instalar</button>`}</td></tr>`).join('') + '</tbody></table>';
  $('#phpList').innerHTML = S.php.versions.length ? `<table><tbody>` + S.php.versions.map((p) => `<tr><td><b>PHP ${esc(p.v)}</b> <span class="muted small">${esc(p.full)}</span></td><td>${S.php.default === p.v ? '<span class="chip on">padrão</span>' : ''}</td>
    <td style="text-align:right"><button class="sec sm" data-a="phpCfg" data-id="${p.v}">Configurar</button> ${S.php.default === p.v ? '' : `<button class="sec sm" data-a="phpDefault" data-id="${p.v}">Tornar padrão</button>`}</td></tr>`).join('') + '</tbody></table>' : '<div class="muted">Nenhuma versão instalada.</div>';
}

function renderSsl() {
  const c = $('#caState'); c.textContent = S.ca.trusted ? 'CA confiável no Windows' : S.ca.generated ? 'CA gerada, ainda não confiável' : 'CA ainda não gerada (inicie o Servidor Web com ao menos um site)';
  c.className = 'chip ' + (S.ca.trusted ? 'on' : 'warn');
  $('#caPath').textContent = S.ca.generated ? `Certificado raiz: ${S.ca.path}` : '';
  $('#sslList').innerHTML = S.sites.length ? `<table><tbody>` + S.sites.map((s) => `<tr><td>${esc(s.domain)}</td><td class="muted small">${s.enabled === false ? 'desativado' : 'certificado emitido automaticamente ao acessar'}</td></tr>`).join('') + '</tbody></table>' : '<div class="muted">Sem sites.</div>';
}

function renderMail() {
  const mp = S.services.find((s) => s.id === 'mailpit');
  $('#mailLink').href = S.mailUrl; $('#mailLink').textContent = `Abrir ${S.mailDomain}`;
  $('#mailState').textContent = !mp.installed ? 'Mailpit não instalado (aba Componentes)' : mp.running ? 'Mailpit em execução' : 'Mailpit parado — inicie no Painel';
  $('#mailConf').textContent = `MAIL_MAILER=smtp\nMAIL_HOST=127.0.0.1\nMAIL_PORT=${S.connection.mail.port}\nMAIL_USERNAME=null\nMAIL_PASSWORD=null\nMAIL_ENCRYPTION=null`;
}

function renderConn() {
  const c = S.connection;
  $('#dbConn').textContent = `# MariaDB / MySQL\nDB_CONNECTION=mariadb\nDB_HOST=${c.mariadb.host}\nDB_PORT=${c.mariadb.port}\nDB_USERNAME=${c.mariadb.user}\nDB_PASSWORD=\n\n# PostgreSQL\nDB_CONNECTION=pgsql\nDB_HOST=${c.postgres.host}\nDB_PORT=${c.postgres.port}\nDB_USERNAME=${c.postgres.user}\nDB_PASSWORD=\n\n# Redis\nREDIS_HOST=${c.redis.host}\nREDIS_PORT=${c.redis.port}` + ((S.components.find((x) => x.id === 'meilisearch') || {}).installed ? `\n\n# Meilisearch (Laravel Scout)\nSCOUT_DRIVER=meilisearch\nMEILISEARCH_HOST=${c.meili.host}\nMEILISEARCH_KEY=` : '');
}

// ---------- páginas com dados sob demanda ----------
async function loadDbs() {
  const engine = $('#dbEngine').value; const el = $('#dbList');
  try {
    const { databases } = await api('GET', `/api/db/list?engine=${engine}`, null, true);
    el.innerHTML = `<table><thead><tr><th>Banco</th><th>Tamanho</th><th></th></tr></thead><tbody>` + databases.map((d) => `<tr><td>${esc(d.name)} ${d.system ? '<span class="badge">sistema</span>' : ''}</td><td>${d.mb} MB</td>
      <td style="text-align:right;white-space:nowrap">${S && engine === 'mariadb' && S.pma.installed ? `<a class="btn sm" target="_blank" href="${esc(S.pma.db.replace('__DB__', encodeURIComponent(d.name)))}">phpMyAdmin</a> ` : ''}${S && S.adminer.installed ? `<a class="btn sm sec" target="_blank" href="${esc(S.adminer[engine === 'postgres' ? 'postgres' : 'mariadb'] + '&db=' + encodeURIComponent(d.name))}">Adminer</a> ` : ''}
        <button class="sec sm" data-a="dbBackup" data-name="${esc(d.name)}">Backup</button> ${d.system ? '' : `<button class="bad sm" data-a="dbDrop" data-name="${esc(d.name)}">Excluir</button>`}</td></tr>`).join('') + '</tbody></table>';
    updateAdminer();
  } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function logLabel(n) {
  if (n.startsWith('site:')) return 'acesso — ' + n.slice(5);
  const find = (id) => (S.sites.find((s) => s.id === id) || {}).name || id;
  let m = n.match(/^laravel:(.+)$/); if (m) return `laravel.log — ${find(m[1])}`;
  m = n.match(/^app:(.+)$/); if (m) return `app — ${find(m[1])}`;
  m = n.match(/^proc:(.+):(\w+)$/); if (m) return `${m[2]} — ${find(m[1])}`;
  return n;
}
function updateAdminer() {
  const b = $('#btnAdminer'); const pm = $('#btnPma'); if (!S) return;
  const engine = $('#dbEngine').value;
  pm.style.display = engine === 'mariadb' && S.pma.installed ? '' : 'none'; pm.href = S.pma.base;
  const hint = [];
  if (engine === 'mariadb' && S.pma.installed) hint.push(`phpMyAdmin em ${S.pma.domain}: entra direto, sem senha.`);
  if (S.adminer.installed) { b.href = S.adminer[engine === 'postgres' ? 'postgres' : 'mariadb']; b.style.display = ''; hint.push(`Adminer em ${S.adminer.domain}: servidor e usuário já vêm preenchidos; deixe a senha vazia e clique em Entrar${engine === 'postgres' ? ' (é a opção para PostgreSQL)' : ''}.`); }
  else { b.style.display = 'none'; }
  if (engine === 'postgres' && !S.adminer.installed) hint.push('Para PostgreSQL, instale o <b>Adminer</b> em Componentes e PHP (o phpMyAdmin só atende MySQL/MariaDB).');
  if (engine === 'mariadb' && !S.pma.installed && !S.adminer.installed) hint.push('Instale o <b>phpMyAdmin</b> ou o <b>Adminer</b> em Componentes e PHP para navegar e editar tabelas.');
  hint.push('O Servidor Web precisa estar iniciado.');
  $('#adminerHint').innerHTML = hint.join(' ');
}
async function loadBackups() {
  try {
    const { backups, schedule: sc } = await api('GET', '/api/db/backups', null, true);
    if (!document.activeElement || !document.activeElement.closest('#bkSched')) {
      $('#bsOn').checked = !!sc.enabled; $('#bsFreq').value = sc.freq; $('#bsTime').value = sc.time; $('#bsKeep').value = sc.keep;
    }
    $('#bsMsg').textContent = sc.lastMsg ? 'Último automático — ' + sc.lastMsg : 'Os backups automáticos só rodam com o RDR Local aberto e o banco ligado; se perder o horário, roda assim que abrir. Os manuais nunca são apagados.';
    $('#bkList').innerHTML = backups.length ? `<table><thead><tr><th>Banco</th><th>Motor</th><th>Quando</th><th>Tamanho</th><th></th></tr></thead><tbody>` + backups.map((b) => `<tr><td><b>${esc(b.db)}</b><small>${esc(b.file)}</small></td><td>${b.engine === 'postgres' ? 'PostgreSQL' : 'MariaDB'}${b.auto ? ' <span class="chip">auto</span>' : ''}</td><td>${new Date(b.at).toLocaleString('pt-BR')}</td><td>${b.mb < 0.01 ? '< 0,01' : b.mb} MB</td>
      <td style="text-align:right;white-space:nowrap"><button class="sec sm" data-a="bkRestore" data-engine="${b.engine}" data-file="${esc(b.file)}" data-db="${esc(b.db)}">Restaurar</button> <button class="bad sm" data-a="bkDel" data-engine="${b.engine}" data-file="${esc(b.file)}">Apagar</button></td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Nenhum backup ainda. Use “Backup” ao lado de um banco (ao excluir um banco o backup é feito automaticamente).</div>';
    $('#bkHint').textContent = 'Os arquivos .sql ficam na pasta data\\backups do RDR Local.';
  } catch (_) { /* ok */ }
}
async function runDoctor() {
  const box = $('#dgBox'); box.innerHTML = '<div class="card empty">Verificando…</div>';
  try {
    const r = await api('GET', '/api/doctor', null, true); window._dg = r;
    const groups = {}; r.checks.forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c); });
    $('#dgSum').textContent = `${r.summary.bad} problema(s) · ${r.summary.warn} aviso(s) · ${r.summary.ok} ok`;
    box.innerHTML = Object.keys(groups).map((g) => `<div class="card"><h2>${esc(g)}</h2>` + groups[g].map((c) => `<div class="dg-i"><span class="dot ${c.status === 'ok' ? '' : c.status}"></span><div class="tx"><b>${esc(c.label)}</b><small>${esc(c.detail)}</small></div>${c.fix ? `<button class="sm" data-a="fix" data-fix="${esc(c.fix.action)}">${esc(c.fix.label)}</button>` : ''}</div>`).join('') + '</div>').join('');
  } catch (e) { box.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}
const PROC_LABEL = { queue: ['Fila de jobs', 'php artisan queue:work'], schedule: ['Agendador', 'php artisan schedule:work'], vite: ['Vite (hot reload)', 'npm run dev'], tunnel: ['Túnel público', 'cloudflared — link https://….trycloudflare.com'] };
function renderProcs() {
  const s = S.sites.find((x) => x.id === window._procSite); if (!s) return;
  $('#procTitle').textContent = `Processos — ${s.name}`;
  $('#procBody').innerHTML = Object.keys(PROC_LABEL).map((k) => {
    const can = s.procCaps && s.procCaps[k]; const on = s.procs && s.procs[k];
    const na = k === 'tunnel' ? ' — instale o Cloudflared na aba Componentes' : ' — indisponível neste projeto';
    const tl = k === 'tunnel' && on ? (s.tunnelUrl ? `<a href="${esc(s.tunnelUrl)}" target="_blank" rel="noopener">${esc(s.tunnelUrl)}</a> <button class="sec sm" data-a="copyUrl" data-url="${esc(s.tunnelUrl)}">Copiar</button>` : 'abrindo o túnel… aguarde alguns segundos') : '';
    return `<div class="proc-r"><div style="flex:1"><b>${PROC_LABEL[k][0]}</b><small class="muted" style="display:block">${PROC_LABEL[k][1]}${can ? '' : na}</small>${tl ? `<small style="display:block;word-break:break-all">${tl}</small>` : ''}</div>
      <span class="chip ${on ? 'on' : ''}">${on ? 'rodando' : 'parado'}</span>
      <button class="sec sm" data-a="procLog" data-kind="${k}" ${can ? '' : 'disabled'}>Log</button>
      <button class="sm" data-a="procToggle" data-kind="${k}" data-on="${on ? 1 : 0}" ${can ? '' : 'disabled'}>${on ? 'Parar' : 'Iniciar'}</button></div>`;
  }).join('') + (s.kind === 'Laravel' ? `<div class="proc-r" style="flex-wrap:wrap"><div style="flex:1;min-width:100%"><b>Comandos rápidos</b><small class="muted" style="display:block">Rodam com o PHP do site e mostram o resultado na janela de tarefas</small></div>
      <button class="sm" data-a="artisan" data-cmd="migrate">Migrate</button>
      <button class="sec sm" data-a="artisan" data-cmd="clear">Limpar caches</button>
      <button class="sec sm" data-a="artisan" data-cmd="storage-link">Storage link</button>
      <button class="sec sm" data-a="artisan" data-cmd="composer-install">Composer install</button>
      <button class="bad sm" data-a="artisan" data-cmd="migrate-fresh">Migrate:fresh --seed</button></div>` : '') + (s.kind === 'Laravel' ? `<div class="proc-r"><div style="flex:1"><b>laravel.log</b><small class="muted" style="display:block">Último arquivo em storage/logs</small></div><button class="sec sm" data-a="laravelLog">Ver</button></div>` : '');
}
async function loadLog() {
  const sel = $('#logSel');
  if (!sel.options.length && S) {
    const names = ['web', 'mariadb', 'postgres', 'redis', 'mailpit', ...(S.services.some((s) => s.id === 'meilisearch') ? ['meilisearch'] : []), ...S.php.installed.map((v) => `php-${v}`), ...S.sites.map((s) => `site:${s.domain}`), ...S.sites.filter((s) => s.kind === 'Laravel').map((s) => `laravel:${s.id}`), ...S.sites.filter((s) => s.type === 'app').map((s) => `app:${s.id}`), ...S.sites.flatMap((s) => Object.keys(s.procs || {}).filter((k) => s.procCaps && s.procCaps[k]).map((k) => `proc:${s.id}:${k}`))];
    sel.innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(logLabel(n))}</option>`).join('');
    if (window._logPick) sel.value = window._logPick;
  }
  if (!sel.value) return;
  try { const { text } = await api('GET', `/api/log?name=${encodeURIComponent(sel.value)}`, null, true); const box = $('#logBox'); box.textContent = text || '(vazio)'; box.scrollTop = box.scrollHeight; } catch (_) { /* ok */ }
}
async function loadBoot() {
  try {
    const r = await api('GET', '/api/autostart', null, true); const cb = $('#cfBoot');
    cb.checked = r.enabled; cb.disabled = !r.supported;
    if (!r.supported) $('#cfBootHint').textContent = 'Disponível só no Windows.';
  } catch (_) { /* ok */ }
}
$('#cfBoot').onchange = async (e) => {
  const cb = e.target; cb.disabled = true;
  try { const r = await api('POST', '/api/autostart', { enabled: cb.checked }); cb.checked = r.enabled; ui.toast(r.enabled ? 'O RDR Local vai abrir com o Windows' : 'Início com o Windows desativado'); }
  catch (_) { cb.checked = !cb.checked; }
  cb.disabled = false;
};
function fillSettings() {
  if (!S) return;
  const s = S.settings;
  $('#cfTld').innerHTML = s.tlds.map((t) => `<option ${t === s.tld ? 'selected' : ''}>${t}</option>`).join('');
  $('#cfPanelUrl').innerHTML = s.panelUrl ? 'Endereço amigável do painel: <a href="' + esc(s.panelUrl) + '">' + esc(s.panelUrl) + '</a> (precisa do servidor Web ligado e do DNS local ou hosts). O endereço <code>127.0.0.1:7070</code> continua funcionando sempre.' : '';
  $('#cfRoot').value = s.projectsRoot || ''; $('#cfDns').checked = !!s.dnsMode; $('#cfAutoSvc').checked = !!s.autoStartServices; $('#cfDocs').checked = s.projectDocs !== false; $('#cfAutoUpd').checked = s.autoCheckUpdates !== false; loadBoot();
  $('#cfPhp').innerHTML = '<option value="">(primeiro instalado)</option>' + S.php.installed.map((v) => `<option ${v === S.php.default ? 'selected' : ''}>${v}</option>`).join('');
  const labels = { http: 'HTTP', https: 'HTTPS', mariadb: 'MariaDB', postgres: 'PostgreSQL', redis: 'Redis', mailpitSmtp: 'Mailpit SMTP', meilisearch: 'Meilisearch', mailpitUi: 'Mailpit painel' };
  $('#cfPorts').innerHTML = Object.keys(labels).map((k) => `<label>${labels[k]}<input type="number" data-port="${k}" value="${s.ports[k]}"></label>`).join('');
}

// ---------- diálogos ----------
function phpOptions(sel, withDefault = true) {
  const opts = [withDefault ? '<option value="default">Padrão do ambiente</option>' : '', '<option value="none">Sem PHP (estático)</option>'].join('') + S.php.installed.map((v) => `<option value="${v}">PHP ${v}</option>`).join('');
  sel.innerHTML = opts;
}
const HINTS = {
  laravel: 'Cria o projeto completo com Composer (sempre a versão estável mais recente que o seu PHP suporta), cria o banco, ajusta o .env (URL, banco, e-mail, Redis) e roda as migrations. Com starter kit também roda npm install/build (precisa de Node.js).',
  wordpress: 'Baixa o WordPress em português, cria o banco e cadastra o site. Na instalação use usuário root e senha vazia.',
  empty: 'Cria a pasta com um index.php de teste e cadastra o site.',
  existing: 'Cadastra uma pasta que você já tem. Nada é copiado ou alterado.',
  proxy: 'Põe HTTPS em um app que já roda em outra porta (Node, Vite, Docker, Python…). Suporta WebSocket. Use a porta (3000) ou host:porta; para Docker no Windows, host.docker.internal:3000.',
  redirect: 'Qualquer acesso a este domínio é redirecionado para o endereço informado (o caminho é mantido).',
};
function applyMode() {
  const f = $('#siteForm'); const mode = editing ? (editing.type && editing.type !== 'php' ? editing.type : 'existing') : f.mode.value; const net = mode === 'proxy' || mode === 'redirect'; const isNew = !net && mode !== 'existing';
  $('#lbPath').textContent = isNew ? 'Pasta raiz dos projetos' : 'Pasta do projeto';
  f.path.placeholder = isNew ? (S.settings.projectsRoot || 'E:\\www') : 'E:\\www\\meu-projeto';
  f.path.required = !isNew && true;
  document.querySelectorAll('#siteForm [data-for]').forEach((el) => { el.style.display = (el.dataset.for === 'new') === isNew ? '' : 'none'; });
  f.dbEngine.parentElement.style.display = isNew && mode !== 'empty' ? '' : 'none';
  $('#lbKit').style.display = mode === 'laravel' ? '' : 'none';
  $('#lbMode').style.display = editing ? 'none' : '';
  $('#lbEnv').style.display = !net && !isNew ? '' : 'none';
  f.path.parentElement.style.display = net ? 'none' : ''; f.path.required = !net && !isNew;
  f.php.parentElement.style.display = net ? 'none' : ''; f.docroot.parentElement.style.display = net ? 'none' : (isNew ? 'none' : '');
  if (net) { f.dbEngine.parentElement.style.display = 'none'; $('#lbKit').style.display = 'none'; f.aliases.parentElement.style.display = ''; }
  $('#lbTarget').style.display = net ? '' : 'none'; f.target.required = net; $('#lbCors').style.display = mode === 'proxy' ? '' : (isNew || net ? 'none' : '');
  f.target.placeholder = mode === 'redirect' ? 'https://exemplo.com.br' : '3000  ou  http://127.0.0.1:3000';
  $('#modeHint').textContent = editing ? '' : HINTS[mode];
  $('#siteSubmit').textContent = editing ? 'Salvar' : isNew ? 'Criar' : 'Adicionar';
}
function openSiteDlg(site) {
  editing = site || null;
  const f = $('#siteForm'); phpOptions(f.php);
  $('#siteDlgTitle').textContent = site ? `Editar ${site.name}` : 'Novo site';
  f.mode.value = 'laravel';
  f.name.value = site ? site.name : ''; f.path.value = site ? site.path : (S.settings.projectsRoot || '');
  f.domain.value = site ? site.domain : '';
  f.aliases.value = site ? (site.aliases || []).join(', ') : ''; f.php.value = site ? site.php : 'default';
  f.docroot.value = site && site.docroot !== 'auto' ? site.docroot : '';
  f.dbEngine.value = 'mariadb'; f.target.value = site && site.target ? site.target : ''; f.env.value = site && site.env ? Object.entries(site.env).map(([k, v]) => `${k}=${v}`).join('\n') : ''; f.cors.checked = !!(site && site.cors);
  if (site && site.type && site.type !== 'php') f.path.value = '';
  applyMode();
  $('#siteDlg').showModal();
}

// ---------- ações ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-a]'); if (!t) return;
  try {
  const { a, id } = t.dataset; const site = S.sites.find((s) => s.id === id);
  switch (a) {
    case 'svc': await api('POST', '/api/svc', { id, action: t.dataset.run === '1' ? 'stop' : 'start' }); break;
    case 'install': await api('POST', '/api/install', { id }); break;
    case 'installAll': await api('POST', '/api/install-all', { postgres: false }); break;
    case 'copyHosts': {
      const { text } = await api('GET', '/api/hosts-text');
      let copied = false; try { await navigator.clipboard.writeText(text); copied = true; } catch (_) { /* mostra para copiar à mão */ }
      await ui.alert({ title: copied ? 'Linhas copiadas' : 'Copie as linhas abaixo', tone: copied ? 'ok' : 'info',
        message: 'Abra o Bloco de Notas como Administrador, abra C:\\Windows\\System32\\drivers\\etc\\hosts, cole no final do arquivo e salve.', pre: text });
      break;
    }
    case 'trust': await api('POST', '/api/trust'); break;
    case 'mcpCopy': {
      const m = await api('GET', '/api/mcp-config'); const txt = m[t.dataset.k];
      try { await navigator.clipboard.writeText(txt); ui.toast('Copiado'); } catch (_) { await ui.alert({ title: 'Copie o texto abaixo', tone: 'info', pre: txt }); }
      break;
    }
    case 'updApply': {
      if (!(await ui.confirm({ title: `Atualizar ${t.dataset.name}`, okText: 'Atualizar', html: `Vai trocar <b>${esc(t.dataset.name)}</b> de ${esc(t.dataset.cur)} para <b>${esc(t.dataset.new)}</b>. O que usa esse componente é parado e religado automaticamente.${t.dataset.id.startsWith('php-') ? ' Seus ajustes do php.ini são mantidos.' : ''} Continuar?` }))) break;
      await api('POST', '/api/updates/apply', { id: t.dataset.id }); jobDismissed.clear(); setTimeout(() => { UPD.done = true; checkUpdates(true); }, 15000); break;
    }
    case 'appUpdate': {
      if (!(await ui.confirm({ title: 'Atualizar o RDR Local', okText: 'Baixar e abrir o instalador', html: `Vai baixar a versão <b>${esc(t.dataset.new)}</b>, conferir o SHA-256 e abrir o instalador. Ele <b>encerra o RDR Local</b> (sites e serviços ficam fora do ar até você abrir de novo) e mantém seus dados. Continuar?` }))) break;
      await api('POST', '/api/updates/app'); jobDismissed.clear(); ui.toast('Baixando… acompanhe no log da tarefa.'); break;
    }
    case 'phpCfg': await phpOpen(id); break;
    case 'phpTab': phpTab(t.dataset.tab); break;
    case 'open': if (site) window.open(site.url, '_blank'); break;
    case 'toggle': await api('POST', '/api/sites/toggle', { id }); break;
    case 'edit': if (site && site.type === 'app') openAppDlg(site); else openSiteDlg(site); break;
    case 'appctl': await api('POST', '/api/apps/ctl', { id, action: t.dataset.run === '1' ? 'stop' : 'start' }); break;
    case 'apprestart': await api('POST', '/api/apps/ctl', { id, action: 'restart' }); ui.toast('App reiniciado'); break;
    case 'appdeps': await api('POST', '/api/apps/deps', { id }); jobDismissed.clear(); break;
    case 'applog': window._logPick = `app:${id}`; $('#logSel').innerHTML = ''; location.hash = '#logs'; break;
    case 'rtLatest': await api('POST', '/api/runtimes/install-latest', { rt: t.dataset.rt }); jobDismissed.clear(); ui.toast('Baixando… acompanhe no log da tarefa.'); break;
    case 'rtDefault': await api('POST', '/api/runtimes/default', { rt: t.dataset.rt, version: t.dataset.v }); break;
    case 'rtRemove':
      if (await ui.confirm({ title: 'Remover versão', danger: true, okText: 'Remover', html: `Remover <b>${esc(t.dataset.label)} ${esc(t.dataset.v)}</b> do RDR Local? Os projetos não são tocados; dá para instalar de novo depois.` })) await api('POST', '/api/runtimes/remove', { rt: t.dataset.rt, version: t.dataset.v });
      break;
    case 'term': window._tmPick = id; location.hash = '#terminal'; break;
    case 'gGroup': T.group = t.dataset.g; renderGuide(); break;
    case 'gRun': case 'gFill': case 'gCopy': await guideAction(a, t); break;
    case 'folder': await api('POST', '/api/sites/folder', { id }); break;
    case 'slog': window._logPick = `site:${site.domain}`; $('#logSel').innerHTML = ''; location.hash = '#logs'; break;
    case 'del': {
      const ok = await ui.confirm({ title: 'Remover site', danger: true, okText: 'Remover site',
        html: `Remover <b>${esc(site.name)}</b> (<code>${esc(site.domain)}</code>) do RDR Local?<br><br>A pasta do projeto, os arquivos e o banco <b>não são apagados</b>: o site só deixa de ser servido e sai da lista.<br><span class="muted small">${esc(site.path || site.target)}</span>` });
      if (ok) { await api('POST', '/api/sites/remove', { id }); ui.toast(`Site ${site.name} removido.`); }
      break;
    }
    case 'phpDefault': await api('POST', '/api/settings', { phpDefault: id }); break;
    case 'procs': window._procSite = id; renderProcs(); $('#procDlg').showModal(); break;
    case 'copyUrl': try { await navigator.clipboard.writeText(t.dataset.url); ui.toast('Link copiado'); } catch (_) { ui.toast(t.dataset.url); } break;
    case 'procToggle':
      if (t.dataset.kind === 'tunnel' && t.dataset.on !== '1' && !(await ui.confirm({ title: 'Abrir túnel público', okText: 'Abrir túnel', html: 'Qualquer pessoa com o link acessa este site, direto da sua máquina, enquanto o túnel estiver ligado. <b>Não deixe dados reais nem senhas fracas.</b> O link muda a cada vez. Continuar?' }))) break;
      await api('POST', '/api/sites/proc', { id: window._procSite, kind: t.dataset.kind, action: t.dataset.on === '1' ? 'stop' : 'start' }); await refresh(); renderProcs(); break;
    case 'artisan': {
      if (t.dataset.cmd === 'migrate-fresh' && !(await ui.confirm({ title: 'Recriar todas as tabelas?', danger: true, okText: 'Apagar e recriar', html: '<code>migrate:fresh</code> <b>apaga todas as tabelas e dados</b> do banco deste projeto e recria do zero (com seed). Continuar?' }))) break;
      await api('POST', '/api/sites/artisan', { id: window._procSite, cmd: t.dataset.cmd }); jobDismissed.clear(); $('#procDlg').close(); break;
    }
    case 'procLog': window._logPick = `proc:${window._procSite}:${t.dataset.kind}`; $('#logSel').innerHTML = ''; $('#procDlg').close(); location.hash = '#logs'; break;
    case 'laravelLog': window._logPick = `laravel:${window._procSite}`; $('#logSel').innerHTML = ''; $('#procDlg').close(); location.hash = '#logs'; break;
    case 'fix': { const r = await api('POST', '/api/doctor/fix', { action: t.dataset.fix }); ui.toast(r.message); window._dg = null; runDoctor(); break; }
    case 'dbBackup': await api('POST', '/api/db/backup', { engine: $('#dbEngine').value, name: t.dataset.name }); jobDismissed.clear(); setTimeout(loadBackups, 4000); break;
    case 'bkDel':
      if (await ui.confirm({ title: 'Apagar backup', danger: true, okText: 'Apagar', html: `Apagar o arquivo <code>${esc(t.dataset.file)}</code>? Não dá para desfazer.` })) { await api('POST', '/api/db/backup-delete', { engine: t.dataset.engine, file: t.dataset.file }); loadBackups(); ui.toast('Backup apagado.'); }
      break;
    case 'bkRestore': { const f = $('#restoreForm'); window._rsEngine = t.dataset.engine; f.source.value = t.dataset.file; f.target.value = t.dataset.db; f.confirm.value = ''; $('#restoreDlg').showModal(); break; }
    case 'dbDrop': {
      const name = t.dataset.name;
      if (await ui.confirm({ title: 'Excluir banco de dados', danger: true, okText: 'Excluir banco', requireText: name, html: `Excluir o banco <b>${esc(name)}</b> apaga todas as tabelas e dados. Um backup automático é salvo antes.` })) {
        const r = await api('POST', '/api/db/drop', { engine: $('#dbEngine').value, name, confirm: name }); loadDbs(); loadBackups();
        if (r.backup) await ui.alert({ title: 'Banco excluído', tone: 'ok', message: 'Backup automático salvo em:', pre: r.backup });
        else await ui.alert({ title: 'Banco excluído', tone: 'warn', message: 'Não foi possível gerar o backup antes de excluir.' });
      }
      break;
    }
    default:
  }
  } catch (_) { /* alert já exibido */ }
  refresh();
});

$('#btnStartAll').onclick = act(() => api('POST', '/api/svc', { id: 'all', action: 'start' }));
$('#btnStopAll').onclick = act(() => api('POST', '/api/svc', { id: 'all', action: 'stop' }));
$('#btnAddSite').onclick = () => openSiteDlg(null);
$('#btnScan').onclick = act(async () => {
  const root = await ui.prompt({ title: 'Escanear pasta', message: 'Cada subpasta da pasta raiz vira um site.', label: 'Pasta raiz dos projetos', value: S.settings.projectsRoot || '', placeholder: 'E:\\www', okText: 'Escanear' });
  if (root) { const r = await api('POST', '/api/scan', { root }); ui.toast(`${r.added} site(s) criado(s).`, r.added ? 'ok' : 'warn'); }
});
$('#siteCancel').onclick = () => $('#siteDlg').close();
$('#siteForm').mode.onchange = applyMode;
$('#siteForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  try {
    if (editing) {
      await api('POST', '/api/sites/update', { id: editing.id, name: f.name.value, path: f.path.value, domain: f.domain.value, aliases: f.aliases.value, php: f.php.value, docroot: f.docroot.value, target: f.target.value, cors: f.cors.checked, env: f.env.value });
    } else if (['existing', 'proxy', 'redirect'].includes(f.mode.value)) {
      await api('POST', '/api/sites', { type: f.mode.value === 'existing' ? 'php' : f.mode.value, target: f.target.value, cors: f.cors.checked, env: f.env.value, name: f.name.value, path: f.path.value, domain: f.domain.value, aliases: f.aliases.value, php: f.php.value, docroot: f.docroot.value });
    } else {
      await api('POST', '/api/project', { type: f.mode.value, name: f.name.value, dir: f.path.value, domain: f.domain.value, php: f.php.value, dbEngine: f.dbEngine.value, kit: f.kit.value });
      jobDismissed.clear();
    }
    $('#siteDlg').close(); refresh();
  } catch (_) { /* alert */ }
};
$('#tmForm').onsubmit = (e) => { e.preventDefault(); tmExec($('#tmIn').value); };
$('#tmIn').onkeydown = (e) => {
  if (e.key === 'ArrowUp' && T.hist.length) { e.preventDefault(); T.hi = Math.min(T.hi + 1, T.hist.length - 1); e.target.value = T.hist[T.hi]; }
  else if (e.key === 'ArrowDown') { e.preventDefault(); T.hi = Math.max(T.hi - 1, -1); e.target.value = T.hi < 0 ? '' : T.hist[T.hi]; }
};
$('#tmStop').onclick = () => { if (T.run) api('POST', '/api/term/kill', { run: T.run }, true).catch(() => {}); };
$('#tmClear').onclick = () => { if (T.site) { T.text[T.site] = ''; tmRender(); } };
$('#tmSite').onchange = (e) => tmPick(e.target.value);
$('#tmExternal').onclick = async () => { const id = $('#tmSite').value; if (!id) return; try { await api('POST', '/api/sites/terminal', { id }); } catch (_) { /* aviso exibido */ } };
$('#jobClose').onclick = () => { if (jobShown) jobDismissed.add(jobShown); $('#jobs').hidden = true; };
$('#btnInstallAll').onclick = act(() => api('POST', '/api/install-all', { postgres: $('#chkPg').checked }));
$('#btnTrust').onclick = act(() => api('POST', '/api/trust'));
$('#btnPhpLoad').onclick = act(async () => {
  const list = await api('GET', '/api/php/available');
  $('#phpAvail').innerHTML = list.map((x) => `<option value="${x.branch}">PHP ${x.version}</option>`).join('');
});
$('#btnPhpInstall').onclick = act(async () => {
  const v = $('#phpAvail').value;
  if (!v) { ui.toast('Clique em “Ver versões disponíveis” primeiro.', 'warn'); return; }
  await api('POST', '/api/install', { id: 'php', version: v });
});
$('#procClose').onclick = () => $('#procDlg').close();
$('#restoreCancel').onclick = () => $('#restoreDlg').close();
$('#btnRestoreFile').onclick = () => { const f = $('#restoreForm'); window._rsEngine = $('#dbEngine').value; f.source.value = ''; f.target.value = ''; f.confirm.value = ''; $('#restoreDlg').showModal(); };
$('#restoreForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  try { await api('POST', '/api/db/restore', { engine: window._rsEngine || $('#dbEngine').value, source: f.source.value.trim(), target: f.target.value.trim(), confirm: f.confirm.value.trim() }); $('#restoreDlg').close(); jobDismissed.clear(); setTimeout(() => { loadDbs(); loadBackups(); }, 5000); } catch (_) { /* alert */ }
};
$('#btnDoctor').onclick = () => { window._dg = null; runDoctor(); };
$('#dbEngine').onchange = () => { loadDbs(); updateAdminer(); }; $('#btnDbRefresh').onclick = loadDbs;
$('#btnDbCreate').onclick = act(async () => { await api('POST', '/api/db/create', { engine: $('#dbEngine').value, name: $('#dbName').value.trim() }); $('#dbName').value = ''; loadDbs(); });
$('#logSel').onchange = loadLog;
$('#bsSave').onclick = act(async () => { await api('POST', '/api/backup/schedule', { enabled: $('#bsOn').checked, freq: $('#bsFreq').value, time: $('#bsTime').value, keep: $('#bsKeep').value }); ui.toast('Agendamento salvo'); loadBackups(); });
$('#bsNow').onclick = act(async () => { await api('POST', '/api/backup/run-all', {}); jobDismissed.clear(); setTimeout(loadBackups, 6000); });
$('#btnCfgExp').onclick = act(async () => {
  const d = await api('GET', '/api/config/export');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
  a.download = `rdr-local-config-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#btnCfgImp').onclick = () => $('#cfgFile').click();
$('#cfgFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let data; try { data = JSON.parse(await f.text()); } catch (_) { return ui.alert({ title: 'Arquivo inválido', message: 'Esse arquivo não é um JSON válido.', tone: 'bad' }); }
  if (!(await ui.confirm({ title: 'Importar configuração', okText: 'Importar', html: `Vai aplicar portas e preferências do arquivo e criar <b>${(data.sites || []).length}</b> site(s) que ainda não existem. Os caminhos precisam existir neste PC. Continuar?` }))) return;
  try {
    const r = await api('POST', '/api/config/import', { data }); await refresh(); fillSettings();
    ui.alert({ title: 'Importação concluída', tone: r.skipped.length ? 'warn' : 'ok', message: `${r.added} site(s) importado(s).`, pre: r.skipped.length ? 'Ignorados:\n' + r.skipped.join('\n') : undefined });
  } catch (_) { /* alert já exibido */ }
};
// ---------- atualizações ----------
const UPD = { done: false };
async function checkUpdates(fresh) {
  const box = $('#updList'); box.innerHTML = 'Verificando…';
  try {
    const r = await api('GET', '/api/updates' + (fresh ? '?fresh=1' : ''), null, true);
    const a = r.app;
    const appRow = a ? `<tr><td><b>RDR Local Server</b></td><td>${esc(a.current)}</td><td>${a.updatable ? `<span class="chip warn">${esc(a.latest)} disponível</span>` : '<span class="chip on">em dia</span>'}</td>
      <td style="text-align:right">${a.updatable ? (a.ready ? `<button class="sm" data-a="appUpdate" data-new="${esc(a.latest)}">Baixar e instalar</button>` : `<a href="${esc(a.url)}" target="_blank" rel="noopener">Ver release</a>`) : ''}</td></tr>` : '';
    const rows = appRow + r.items.map((i) => `<tr><td><b>${esc(i.name)}</b></td><td>${esc(i.current || '—')}</td><td>${i.updatable ? `<span class="chip warn">${esc(i.latest)} disponível</span>` : '<span class="chip on">em dia</span>'}</td>
      <td style="text-align:right">${i.updatable ? `<button class="sm" data-a="updApply" data-id="${esc(i.id)}" data-name="${esc(i.name)}" data-cur="${esc(i.current)}" data-new="${esc(i.latest)}">Atualizar</button>` : ''}</td></tr>`).join('');
    box.innerHTML = (rows ? `<table><tbody>${rows}</tbody></table>` : '<div class="muted">Nada para verificar.</div>') + (r.errors.length ? `<p class="muted small">Não consegui consultar: ${esc(r.errors.join('; '))}</p>` : '')
      + (a && !a.latest ? '<p class="muted small">RDR Local: nenhuma versão publicada no GitHub (Releases), ou o repositório é privado.</p>' : '')
      + `<p class="muted small">Verificado às ${new Date(r.checkedAt).toLocaleTimeString('pt-BR')}.</p>`;
  } catch (e) { box.innerHTML = `<span class="muted">${esc(e.message)}</span>`; }
}
$('#btnUpdCheck').onclick = () => checkUpdates(true);

// ---------- editor do php.ini ----------
const PHPD = { v: '', info: null };
function phpTab(tab) { ['Set', 'Ext', 'Raw'].forEach((x) => { $('#phpTab' + x).hidden = x !== tab; }); }
function phpRender() {
  const i = PHPD.info; $('#phpTitle').textContent = `PHP ${i.v} — configuração`;
  $('#phpSetForm').innerHTML = i.settings.map((s) => `<label>${esc(s.label)}${s.options
    ? `<select data-k="${esc(s.key)}">${['', ...s.options].map((o) => `<option value="${esc(o)}" ${o === s.value ? 'selected' : ''}>${o || '(padrão do PHP)'}</option>`).join('')}</select>`
    : `<input data-k="${esc(s.key)}" value="${esc(s.value)}" placeholder="${esc(s.hint)}">`}</label>`).join('');
  phpExts(); $('#phpRaw').value = i.raw; $('#phpRestore').disabled = !i.hasBackup;
}
function phpExts() {
  const q = $('#phpExtFilter').value.trim().toLowerCase();
  $('#phpExtList').innerHTML = PHPD.info.extensions.filter((e) => !q || e.name.includes(q)).map((e) => `<label class="${e.enabled ? 'on' : ''}"><input type="checkbox" data-ext="${esc(e.name)}" ${e.enabled ? 'checked' : ''}> ${esc(e.name)}${e.zend ? ' <span class="muted small">(zend)</span>' : ''}</label>`).join('') || '<div class="muted">Nenhuma extensão encontrada.</div>';
}
async function phpLoad() { PHPD.info = await api('GET', '/api/php/ini?v=' + encodeURIComponent(PHPD.v), null); phpRender(); }
async function phpOpen(v) { PHPD.v = v; await phpLoad(); phpTab('Set'); $('#phpDlg').showModal(); }
$('#phpClose').onclick = () => $('#phpDlg').close();
$('#phpExtFilter').oninput = phpExts;
$('#phpExtList').onchange = async (e) => {
  const cb = e.target.closest('[data-ext]'); if (!cb) return; cb.disabled = true;
  try { await api('POST', '/api/php/ext', { v: PHPD.v, name: cb.dataset.ext, on: cb.checked }); ui.toast(`${cb.dataset.ext} ${cb.checked ? 'ligada' : 'desligada'}`); } catch (_) { /* alerta exibido */ }
  await phpLoad();
};
$('#phpSetSave').onclick = act(async () => {
  const values = {}; document.querySelectorAll('#phpSetForm [data-k]').forEach((el) => { values[el.dataset.k] = el.value; });
  await api('POST', '/api/php/settings', { v: PHPD.v, values }); ui.toast('Ajustes salvos'); await phpLoad();
});
$('#phpRawSave').onclick = act(async () => { await api('POST', '/api/php/ini-raw', { v: PHPD.v, text: $('#phpRaw').value }); ui.toast('php.ini salvo'); await phpLoad(); });
$('#phpRestore').onclick = act(async () => {
  if (!(await ui.confirm({ title: 'Restaurar backup', okText: 'Restaurar', html: 'Volta o php.ini para a versão anterior à última alteração. Continuar?' }))) return;
  await api('POST', '/api/php/ini-restore', { v: PHPD.v }); ui.toast('Backup restaurado'); await phpLoad();
});
$('#btnSaveCfg').onclick = act(async () => {
  const ports = {}; document.querySelectorAll('[data-port]').forEach((i) => { ports[i.dataset.port] = i.value; });
  await api('POST', '/api/settings', { autoStartServices: $('#cfAutoSvc').checked, projectDocs: $('#cfDocs').checked, autoCheckUpdates: $('#cfAutoUpd').checked, dnsMode: $('#cfDns').checked, tld: $('#cfTld').value, projectsRoot: $('#cfRoot').value, phpDefault: $('#cfPhp').value, ports });
  ui.toast('Salvo. Reinicie os serviços para aplicar mudanças de porta.');
});

// ---------- mini terminal + guia de comandos ----------
const GUIDE = [
  // g: grupo, need: capacidade exigida do projeto, run: executa direto, fill: coloca no campo para editar, danger: pede confirmação
  { g: 'Básico', t: 'Versão do PHP deste site', d: 'Confirma qual PHP o terminal e o site estão usando.', c: 'php -v', run: 1 },
  { g: 'Básico', t: 'Extensões do PHP carregadas', d: 'Procure por pdo_mysql, pdo_pgsql, mbstring, zip, gd…', c: 'php -m', run: 1 },
  { g: 'Básico', t: 'Versão do Composer', d: 'Confirma que o Composer está disponível.', c: 'composer --version', run: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Resumo do projeto', d: 'Versão do Laravel, PHP, ambiente, drivers de banco/cache/sessão.', c: 'php artisan about', run: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Criar / atualizar as tabelas', d: 'Roda as migrations pendentes. Faça isso logo após criar o banco (corrige “relation sessions does not exist”).', c: 'php artisan migrate --force', run: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Ver status das migrations', d: 'Mostra quais migrations já rodaram.', c: 'php artisan migrate:status', run: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Recriar tudo do zero (apaga dados)', d: 'migrate:fresh apaga todas as tabelas e roda de novo com seeders.', c: 'php artisan migrate:fresh --seed --force', run: 1, danger: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Gerar a chave da aplicação', d: 'Cria APP_KEY no .env (só se estiver vazia).', c: 'php artisan key:generate', run: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Link do storage', d: 'Cria public/storage para servir uploads.', c: 'php artisan storage:link', run: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Limpar caches', d: 'Config, rotas, views e cache. Use depois de mexer no .env.', c: 'php artisan optimize:clear', run: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Listar rotas', d: 'Todas as rotas do projeto.', c: 'php artisan route:list', run: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Resumo do banco', d: 'Conexão, tabelas e tamanhos (Laravel 11+).', c: 'php artisan db:show', run: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Rodar os testes', d: 'Executa a suíte de testes do projeto.', c: 'php artisan test', run: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Criar model + migration + factory + controller', d: 'Troque NomeDoModel antes de executar.', c: 'php artisan make:model NomeDoModel -mfc', fill: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Criar controller resource', d: 'Troque o nome antes de executar.', c: 'php artisan make:controller NomeController --resource', fill: 1 },
  { g: 'Laravel', need: 'artisan', t: 'Criar migration', d: 'Ex.: create_produtos_table ou add_status_to_pedidos_table.', c: 'php artisan make:migration create_tabela_table', fill: 1 },
  { g: 'Composer', need: 'composer', t: 'Instalar dependências', d: 'Baixa a pasta vendor a partir do composer.lock.', c: 'composer install', run: 1 },
  { g: 'Composer', need: 'composer', t: 'Atualizar dependências', d: 'Atualiza pacotes dentro das versões permitidas no composer.json.', c: 'composer update', run: 1 },
  { g: 'Composer', need: 'composer', t: 'Regerar o autoload', d: 'Resolve “Class not found” depois de mover/criar classes.', c: 'composer dump-autoload', run: 1 },
  { g: 'Composer', need: 'composer', t: 'Adicionar um pacote', d: 'Troque vendor/pacote pelo pacote desejado.', c: 'composer require vendor/pacote', fill: 1 },
  { g: 'Node', need: 'npm', t: 'Instalar dependências do front-end', d: 'Baixa node_modules (precisa do Node.js instalado).', c: 'npm install', run: 1 },
  { g: 'Node', need: 'npm', t: 'Compilar para produção', d: 'Gera os assets finais (Vite/Mix).', c: 'npm run build', run: 1 },
  { g: 'Node', need: 'npm', t: 'Servidor de desenvolvimento (Vite)', d: 'Fica rodando com hot reload; clique em Parar para encerrar. Também dá para usar Processos no Painel.', c: 'npm run dev', run: 1 },
  { g: 'Git', t: 'Iniciar repositório', d: 'Cria o repositório Git nesta pasta.', c: 'git init', run: 1, need: '!git' },
  { g: 'Git', need: 'git', t: 'Status das alterações', d: 'Arquivos modificados e não versionados.', c: 'git status', run: 1 },
  { g: 'Git', need: 'git', t: 'Últimos commits', d: 'Os 10 commits mais recentes.', c: 'git log --oneline -10', run: 1 },
  { g: 'Git', need: 'git', t: 'Baixar atualizações', d: 'git pull no branch atual.', c: 'git pull', run: 1 },
];
const T = { site: null, run: null, from: 0, timer: null, text: {}, hist: [], hi: -1, group: 'Todos', sig: '' };
const tmShort = (cwd) => { const p = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean); return (p.length > 2 ? '…/' : '') + p.slice(-2).join('/'); };
function tmSetPrompt(cwd) { const el = $('#tmPrompt'); el.textContent = tmShort(cwd) + ' >'; el.title = cwd; }
const tmSite = () => (S ? S.sites.find((s) => s.id === T.site) : null);
function tmNormalize(t) { return t.replace(/\r\n/g, '\n').split('\n').map((l) => l.split('\r').pop()).join('\n'); }
function tmRender() {
  const out = $('#tmOut'); const raw = T.text[T.site] || '';
  const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 30;
  out.innerHTML = tmNormalize(raw).split('\n').map((l) => {
    if (l.startsWith('\u0001')) return `<span class="tm-cmd">${esc(l.slice(1))}</span>`;
    if (l.startsWith('\u0002')) return `<span class="tm-dim">${esc(l.slice(1))}</span>`;
    if (l.startsWith('\u0003')) return `<span class="tm-err">${esc(l.slice(1))}</span>`;
    return esc(l);
  }).join('\n') || '<span class="tm-dim">Selecione um site e digite um comando. Ele roda na pasta do projeto, com o PHP e o Composer do site já no PATH.</span>';
  if (stick) out.scrollTop = out.scrollHeight;
}
const tmAppend = (id, t) => { T.text[id] = (T.text[id] || '') + t; if (id === T.site) tmRender(); };
function syncTerminalSites() {
  if (!S) return;
  const tsites = S.sites.filter((s) => s.path); const sig = tsites.map((s) => s.id + s.name).join('|');
  if (sig !== T.sig) {
    T.sig = sig; const sel = $('#tmSite');
    sel.innerHTML = tsites.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} — ${esc(s.domain)}</option>`).join('') || '<option value="">(nenhum site)</option>';
    const want = window._tmPick || T.site || (S.sites[0] && S.sites[0].id); window._tmPick = null;
    if (want && S.sites.some((s) => s.id === want)) sel.value = want;
    tmPick(sel.value);
  } else if (window._tmPick && S.sites.some((s) => s.id === window._tmPick)) { $('#tmSite').value = window._tmPick; tmPick(window._tmPick); window._tmPick = null; }
}
async function tmPick(id) {
  if (T.run && T.site !== id) { /* mantém a execução em curso; a saída continua indo para o site de origem */ }
  T.site = id || null; tmRender(); renderGuide();
  $('#tmPrompt').textContent = '>'; $('#tmPrompt').title = ''; if (!id) return;
  try { const i = await api('GET', `/api/term/info?id=${encodeURIComponent(id)}`, null, true); if (T.site === id) tmSetPrompt(i.cwd); } catch (_) { /* ok */ }
}
function tmBusy(b) { $('#tmRun').hidden = b; $('#tmStop').hidden = !b; $('#tmIn').disabled = b; if (!b) $('#tmIn').focus(); }
async function tmExec(cmd) {
  cmd = String(cmd || '').trim(); const id = T.site; if (!cmd) return;
  if (!id) { ui.toast('Cadastre ou selecione um site primeiro.', 'warn'); return; }
  if (/^(clear|cls)$/i.test(cmd)) { T.text[id] = ''; tmRender(); return; }
  if (T.run) { ui.toast('Já há um comando em execução. Aguarde ou clique em Parar.', 'warn'); return; }
  T.hist = [cmd, ...T.hist.filter((h) => h !== cmd)].slice(0, 50); T.hi = -1;
  tmAppend(id, `\u0001${$('#tmPrompt').textContent} ${cmd}\n`);
  try {
    const r = await api('POST', '/api/term/run', { id, cmd }, true);
    T.run = r.run; T.from = 0; tmBusy(true); $('#tmIn').value = '';
    tmPoll(id, r.run);
  } catch (e) { tmAppend(id, `\u0003${e.message}\n`); }
}
function tmPoll(id, run) {
  clearInterval(T.timer);
  const tick = async () => {
    try {
      const o = await api('GET', `/api/term/out?run=${run}&from=${T.from}`, null, true);
      T.from = o.next; if (o.chunks.length) tmAppend(id, o.chunks.join(''));
      if (o.done) {
        clearInterval(T.timer); T.run = null; tmBusy(false);
        tmAppend(id, `\u0002[terminou com código ${o.code}]\n\n`);
        if ($('#tmSite').value === id) tmSetPrompt(o.cwd);
      }
    } catch (_) { clearInterval(T.timer); T.run = null; tmBusy(false); }
  };
  T.timer = setInterval(tick, 350); tick();
}
function renderGuide() {
  const s = tmSite(); const box = $('#tmGuide'); const groups = ['Todos', ...new Set(GUIDE.map((x) => x.g))];
  $('#tmGroups').innerHTML = groups.map((g) => `<button class="chip btn-chip ${g === T.group ? 'on' : ''}" data-a="gGroup" data-g="${esc(g)}">${esc(g)}</button>`).join('');
  if (!s) { box.innerHTML = '<div class="empty">Cadastre um site para ver os comandos.</div>'; $('#tmGuideNote').textContent = ''; return; }
  const ok = (x) => !x.need || (x.need[0] === '!' ? !s.caps[x.need.slice(1)] : s.caps[x.need]);
  const items = GUIDE.map((x, i) => ({ ...x, i })).filter((x) => (T.group === 'Todos' || x.g === T.group) && ok(x));
  $('#tmGuideNote').textContent = `Comandos para ${s.name} (${s.kind}). Executar roda no mini terminal acima; Editar coloca no campo para você ajustar.`;
  box.innerHTML = items.map((x) => `<div class="gd"><div class="tx"><b>${esc(x.t)} <span class="badge">${esc(x.g)}</span></b><small>${esc(x.d)}</small><code>${esc(x.c)}</code></div>
    <div class="bt">${x.fill ? `<button class="sm" data-a="gFill" data-i="${x.i}">Editar e executar</button>` : `<button class="sm ${x.danger ? 'danger' : ''}" data-a="gRun" data-i="${x.i}">Executar</button><button class="sec sm" data-a="gFill" data-i="${x.i}">Editar</button>`}
      <button class="sec sm" data-a="gCopy" data-i="${x.i}">Copiar</button></div></div>`).join('') || '<div class="empty">Nenhum comando disponível neste grupo para este projeto.</div>';
}
async function guideAction(a, t) {
  const x = GUIDE[Number(t.dataset.i)]; if (!x) return;
  if (a === 'gCopy') { try { await navigator.clipboard.writeText(x.c); ui.toast('Comando copiado.'); } catch (_) { ui.alert({ title: 'Copie o comando', message: '', pre: x.c }); } return; }
  if (a === 'gFill') { const i = $('#tmIn'); i.value = x.c; i.focus(); if (x.fill) { const m = x.c.match(/(NomeDoModel|NomeController|create_tabela_table|vendor\/pacote)/); if (m) i.setSelectionRange(m.index, m.index + m[0].length); } return; }
  if (x.danger && !(await ui.confirm({ title: 'Executar comando destrutivo?', danger: true, okText: 'Executar mesmo assim', html: `<code>${esc(x.c)}</code><br><br>${esc(x.d)}` }))) return;
  tmExec(x.c);
}

// ---------- polling ----------
async function refresh() { try { S = await api('GET', '/api/state', null, true); renderAll(); if ($('#procDlg').open) renderProcs(); } catch (_) { /* servidor reiniciando */ } }
async function pollMetrics() { try { M = await api('GET', '/api/host-status', null, true); if (page === 'painel') renderMetrics(); } catch (err) { if (!M && page === 'painel') ['#mCpu', '#mMem', '#mDisk'].forEach((k) => { const e = $(k); if (e && !e.innerHTML) e.innerHTML = `<span class="muted small">Sem leitura (${esc(String(err && err.message || err).slice(0, 80))}). Recarregue com Ctrl+F5; se persistir, desative bloqueadores de anúncio/privacidade para 127.0.0.1.</span>`; }); } }
go(); refresh(); pollMetrics();
setInterval(refresh, 2000); setInterval(pollMetrics, 2000);
setInterval(() => { if (page === 'logs') loadLog(); }, 3000);


// ---------- Ajuda (Markdown simples e seguro: tudo é escapado antes) ----------
const mdInline = (t) => esc(t)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
function mdRender(src) {
  const L = src.replace(/\r/g, '').split('\n'); let o = ''; let i = 0;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  while (i < L.length) {
    const l = L[i];
    if (/^```/.test(l)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; o += `<pre><code>${esc(b.join('\n'))}</code></pre>`; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)/.exec(l))) { o += `<h${m[1].length + 1}>${mdInline(m[2])}</h${m[1].length + 1}>`; i++; continue; }
    if (/^---+\s*$/.test(l)) { o += '<hr>'; i++; continue; }
    if (/^>/.test(l)) { const b = []; while (i < L.length && /^>/.test(L[i])) b.push(L[i++].replace(/^>\s?/, '')); o += `<blockquote>${mdInline(b.join(' '))}</blockquote>`; continue; }
    if (/^\|/.test(l) && /^\|?[\s:|-]+\|/.test(L[i + 1] || '')) {
      const head = cells(l); i += 2; const rows = [];
      while (i < L.length && /^\|/.test(L[i])) rows.push(cells(L[i++]));
      o += `<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; continue;
    }
    if (/^(\s*)([-*]|\d+\.)\s+/.test(l)) {
      const ord = /^\s*\d+\./.test(l); const b = [];
      while (i < L.length && /^\s*([-*]|\d+\.)\s+/.test(L[i])) b.push(L[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      o += `<${ord ? 'ol' : 'ul'}>${b.map((x) => `<li>${mdInline(x)}</li>`).join('')}</${ord ? 'ol' : 'ul'}>`; continue;
    }
    if (!l.trim()) { i++; continue; }
    const b = []; while (i < L.length && L[i].trim() && !/^(```|#{1,4}\s|>|\||---+\s*$|\s*([-*]|\d+\.)\s+)/.test(L[i])) b.push(L[i++]);
    if (!b.length) { b.push(L[i++]); }
    o += `<p>${mdInline(b.join(' '))}</p>`;
  }
  return o;
}
var helpDocs = null; var helpCur = "";
async function loadHelp(name) {
  try {
    if (!helpDocs) helpDocs = (await api('GET', '/api/docs', null, true)).docs;
    helpCur = name || helpCur || (helpDocs[0] && helpDocs[0].name);
    $('#helpNav').innerHTML = helpDocs.map((d) => `<button class="${d.name === helpCur ? 'on' : ''}" data-doc="${esc(d.name)}">${esc(d.title)}</button>`).join('');
    $('#helpNav').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => loadHelp(b.dataset.doc)));
    if (!helpCur) { $('#helpBody').innerHTML = '<p class="muted">Nenhum documento encontrado na pasta docs.</p>'; return; }
    const r = await api('GET', '/api/docs/read?name=' + encodeURIComponent(helpCur), null, true);
    $('#helpBody').innerHTML = mdRender(r.text); $('#helpBody').scrollTop = 0; $('main').scrollTop = 0;
  } catch (e) { helpDocs = null; $('#helpBody').innerHTML = '<p><b>Não foi possível carregar a documentação.</b></p><p class="muted">Se você acabou de atualizar o RDR Local, feche-o (janela do start.bat) e abra de novo: o servidor antigo ainda está em execução e não conhece a Ajuda. Confira também se a pasta <code>docs</code> está ao lado do <code>server.js</code>.</p>'; }
}


// ---------- Linguagens (Node.js e Python) ----------
$('#rtKind').onchange = () => { $('#rtAvail').innerHTML = ''; };
$('#btnRtLoad').onclick = async () => {
  const b = $('#btnRtLoad'); b.disabled = true; b.textContent = 'Buscando…';
  try {
    const { list } = await api('GET', `/api/runtimes/available?rt=${$('#rtKind').value}`);
    $('#rtAvail').innerHTML = list.map((x) => `<option value="${esc(x.v)}">${esc($('#rtKind').selectedOptions[0].textContent)} ${esc(x.v)} — ${esc(x.full)}${x.lts ? ' (LTS ' + esc(x.name) + ')' : ''}</option>`).join('');
  } catch (_) { /* alerta já exibido */ }
  b.disabled = false; b.textContent = 'Ver versões disponíveis';
};
$('#btnRtInstall').onclick = act(async () => {
  const rt = $('#rtKind').value; const version = $('#rtAvail').value;
  if (!version) { ui.toast('Clique em “Ver versões disponíveis” e escolha uma.', 'warn'); return; }
  await api('POST', '/api/runtimes/install', { rt, version }); jobDismissed.clear();
});

// ---------- Novo app / editar app ----------
let APPT = null; let appEditing = null;
function rtOptions(sel, rt, cur) {
  const r = S.runtimes && S.runtimes[rt];
  sel.innerHTML = `<option value="default">Padrão${r && r.default ? ' (' + esc(r.default) + ')' : ' — nenhum instalado'}</option>` + (r ? r.installed.map((x) => `<option value="${esc(x.v)}">${esc(r.label)} ${esc(x.v)}</option>`).join('') : '');
  sel.value = cur && [...sel.options].some((o) => o.value === cur) ? cur : 'default';
}
function applyAppMode() {
  const f = $('#appForm'); const tpl = f.template.value; const t = (APPT || []).find((x) => x.id === tpl);
  const existing = appEditing || tpl === 'existing';
  $('#lbAppTpl').style.display = appEditing ? 'none' : '';
  $('#lbAppDir').textContent = existing ? 'Pasta do projeto' : 'Pasta onde criar (o app ganha uma subpasta)';
  f.dir.placeholder = existing ? 'E:\\www\\meu-app' : (S.settings.projectsRoot || 'E:\\www');
  if (!appEditing && t) {
    f.runtime.value = t.runtime; if (!f.cmd.dataset.touched || !f.cmd.value) f.cmd.value = t.cmd;
  }
  const rt = f.runtime.value; $('#lbAppVer').style.display = rt === 'custom' ? 'none' : ''; if (rt !== 'custom') rtOptions(f.rtVersion, rt, appEditing && appEditing.runtime === rt ? appEditing.rtVersion : '');
  const scaffold = !appEditing && t && t.scaffold;
  $('#lbAppDeps').style.display = appEditing || rt === 'custom' ? 'none' : '';
  const missing = rt !== 'custom' && S.runtimes && !S.runtimes[rt].default;
  $('#appHint').innerHTML = appEditing ? '' : [t && t.hint ? esc(t.hint) : '', scaffold ? 'Cria os arquivos do modelo, instala as dependências (npm install, venv + pip ou go mod download) e já liga o app com HTTPS.' : '', missing ? `<b>${esc(S.runtimes[rt].label)} ainda não está instalado:</b> será baixado sozinho (versão LTS mais nova) ao criar o app, ou instale antes em Componentes e PHP &gt; Linguagens.` : ''].filter(Boolean).join('<br>');
  $('#appSubmit').textContent = appEditing ? 'Salvar' : 'Criar app';
}
async function openAppDlg(site) {
  appEditing = site || null;
  const f = $('#appForm');
  if (!APPT) { try { APPT = (await api('GET', '/api/apps/templates', null, true)).templates; } catch (_) { APPT = []; } }
  f.template.innerHTML = APPT.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('') + '<option value="existing">Usar uma pasta que já tem um app</option>';
  $('#appDlgTitle').textContent = site ? `Editar ${site.name}` : 'Novo app';
  f.cmd.dataset.touched = site ? '1' : '';
  f.name.value = site ? site.name : ''; f.dir.value = site ? site.path : (S.settings.projectsRoot || '');
  f.domain.value = site ? site.domain : ''; f.aliases.value = (site && (site.aliases || []).join(', ')) || '';
  f.runtime.value = site ? site.runtime : 'node'; f.cmd.value = site ? site.cmd : '';
  f.appPort.value = site ? site.appPort : ''; f.env.value = site && site.env ? Object.entries(site.env).map(([k, v]) => `${k}=${v}`).join('\n') : '';
  f.autoStart.checked = site ? site.autoStart !== false : true; f.cors.checked = !!(site && site.cors); f.installDeps.checked = true;
  if (!site) f.template.value = APPT[0] ? APPT[0].id : 'existing';
  applyAppMode(); $('#appDlg').showModal();
}
$('#btnAddApp').onclick = () => openAppDlg(null);
$('#appCancel').onclick = () => $('#appDlg').close();
$('#appForm').template.onchange = () => { $('#appForm').cmd.dataset.touched = ''; applyAppMode(); };
$('#appForm').runtime.onchange = applyAppMode;
$('#appForm').cmd.oninput = (e) => { e.target.dataset.touched = '1'; };
$('#appForm').dir.onchange = async (e) => {
  const f = $('#appForm'); if (appEditing || f.template.value !== 'existing' || !e.target.value) return;
  try {
    const { detected } = await api('GET', `/api/apps/detect?path=${encodeURIComponent(e.target.value)}`, null, true);
    if (detected) { f.runtime.value = detected.runtime; f.cmd.value = detected.cmd; f.cmd.dataset.touched = ''; if (!f.name.value) f.name.value = e.target.value.split(/[\\/]/).filter(Boolean).pop() || ''; applyAppMode(); ui.toast(`Detectado: ${detected.note}`); }
  } catch (_) { /* ok */ }
};
$('#appForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  const body = { name: f.name.value, domain: f.domain.value, aliases: f.aliases.value, runtime: f.runtime.value, rtVersion: f.rtVersion.value || 'default', cmd: f.cmd.value, appPort: f.appPort.value ? Number(f.appPort.value) : undefined, env: f.env.value, autoStart: f.autoStart.checked, cors: f.cors.checked };
  try {
    if (appEditing) await api('POST', '/api/sites/update', { id: appEditing.id, type: 'app', path: f.dir.value, ...body });
    else { await api('POST', '/api/apps/new', { template: f.template.value, dir: f.dir.value, installDeps: f.installDeps.checked, ...body }); jobDismissed.clear(); }
    $('#appDlg').close(); refresh();
  } catch (_) { /* alerta já exibido */ }
};


// ---------- Backup na nuvem ----------
var CL = null;
async function loadCloud(fill) {
  try { CL = await api('GET', '/api/cloud', null, true); } catch (_) { return; }
  const c = CL.settings;
  const st = $('#clState'); st.textContent = CL.installed ? `instalado${CL.version ? ' · ' + CL.version : ''}` : 'não instalado'; st.className = 'chip ' + (CL.installed ? 'on' : 'warn');
  $('#clInstall').style.display = CL.installed ? 'none' : '';
  $('#clConf').textContent = CL.confPath || '';
  $('#clRemotes').innerHTML = !CL.installed ? '<div class="empty">Instale o rclone para adicionar destinos.</div>' : CL.remotes.length
    ? '<table><tbody>' + CL.remotes.map((r) => `<tr><td><b>${esc(r.name)}</b> <span class="muted small">${esc(r.label)}</span></td><td>${c.remote === r.name ? '<span class="chip on">em uso</span>' : ''}</td><td style="text-align:right"><button class="bad sm" data-a="clRemove" data-name="${esc(r.name)}">Remover</button></td></tr>`).join('') + '</tbody></table>'
    : '<div class="empty">Nenhum destino ainda. Clique em “Adicionar destino”.</div>';
  $('#clAdd').disabled = !CL.installed;
  if (fill) {
    $('#clRemote').innerHTML = '<option value="">— escolha —</option>' + CL.remotes.map((r) => `<option value="${esc(r.name)}">${esc(r.name)} (${esc(r.label)})</option>`).join('');
    $('#clRemote').value = c.remote; $('#clPath').value = c.path; $('#clProjects').value = c.projects; $('#clRetain').value = c.retainDays || '';
    $('#clConfig').checked = !!c.includeConfig; $('#clOn').checked = !!c.enabled;
    $('#ntChat').value = CL.notify.telegramChatId || ''; $('#ntFail').checked = !!CL.notify.onFail; $('#ntOk').checked = !!CL.notify.onOk;
    clPathHint();
  }
  const es = $('#clEncState'); es.textContent = c.encrypt ? 'criptografia ligada' : 'sem criptografia'; es.className = 'chip ' + (c.encrypt ? 'on' : 'warn');
  $('#clEncOff').style.display = c.encrypt ? '' : 'none'; $('#clEncOn').textContent = c.encrypt ? 'Trocar senha' : 'Ligar criptografia';
  ['clTest', 'clNow', 'clVerify'].forEach((id) => { $('#' + id).disabled = !CL.installed || !c.remote; });
  $('#clStatus').innerHTML = c.lastMsg ? `Último envio — ${esc(c.lastMsg)}` : 'Nenhum envio ainda.';
  $('#clVerifyMsg').textContent = c.lastVerify ? 'Último teste de restauração — ' + c.lastVerify : 'Nunca testou a restauração: um backup que nunca foi restaurado não é backup. Rode “Testar restauração”.';
  $('#ntState').textContent = `Telegram: ${CL.notify.telegram && CL.notify.telegramChatId ? 'configurado' : 'não configurado'} · Webhook: ${CL.notify.webhook ? 'configurado' : 'não configurado'}`;
}
function clPathHint() {
  const r = CL && CL.remotes.find((x) => x.name === $('#clRemote').value);
  $('#clPathLb').textContent = r && r.type === 'local' ? 'Pasta (caminho completo)' : 'Pasta no destino';
  $('#clPath').placeholder = r && r.type === 'local' ? 'D:\\Backups\\RDR-Local' : 'RDR-Local-Backup';
}
$('#clRemote').onchange = clPathHint;
setInterval(() => { if (page === 'nuvem' && !$('#clDlg').open) loadCloud(false); }, 5000);
$('#clInstall').onclick = act(async () => { await api('POST', '/api/install', { id: 'rclone' }); jobDismissed.clear(); setTimeout(() => loadCloud(true), 8000); });
function clKindFields() {
  const k = $('#clKind').value;
  document.querySelectorAll('#clForm [data-k]').forEach((e) => { e.style.display = e.dataset.k === k ? '' : 'none'; });
}
$('#clAdd').onclick = () => {
  const f = $('#clForm'); f.reset();
  $('#clKind').innerHTML = Object.entries(CL.kinds).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('');
  clKindFields(); $('#clDlg').showModal();
};
$('#clKind').onchange = clKindFields;
$('#clCancel').onclick = () => $('#clDlg').close();
$('#clForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  const body = { kind: f.kind.value, name: f.name.value.trim(), clientId: f.clientId.value.trim(), clientSecret: f.clientSecret.value, provider: f.provider.value, endpoint: f.endpoint.value.trim(), region: f.region.value.trim(), accessKeyId: f.accessKeyId.value.trim(), secretAccessKey: f.secretAccessKey.value };
  try { await api('POST', '/api/cloud/connect', body); $('#clDlg').close(); jobDismissed.clear(); setTimeout(() => loadCloud(true), 6000); ui.toast('Siga as instruções no log da tarefa (abaixo).'); } catch (_) { /* alerta */ }
};
$('#clSave').onclick = act(async () => {
  await api('POST', '/api/cloud/settings', { remote: $('#clRemote').value, path: $('#clPath').value, projects: $('#clProjects').value, retainDays: $('#clRetain').value || 0, includeConfig: $('#clConfig').checked, enabled: $('#clOn').checked });
  ui.toast('Configuração salva'); loadCloud(true);
});
$('#clEncOn').onclick = act(async () => {
  const pw = $('#clPass').value; if (!pw) { ui.toast('Digite a senha de criptografia.', 'warn'); return; }
  if (!(await ui.confirm({ title: 'Ligar criptografia', okText: 'Ligar', html: 'Os próximos envios vão para uma subpasta <code>encrypted</code>, cifrados. Arquivos já enviados antes continuam como estão (em texto claro) até você apagá-los no destino.<br><br><b>Anote a senha:</b> sem ela o backup é irrecuperável.' }))) return;
  await api('POST', '/api/cloud/encryption', { passphrase: pw }); $('#clPass').value = ''; ui.toast('Criptografia ligada'); loadCloud(true);
});
$('#clEncOff').onclick = act(async () => {
  if (!(await ui.confirm({ title: 'Desligar criptografia', danger: true, okText: 'Desligar', html: 'Os próximos envios passam a sair <b>sem criptografia</b>. O que já está cifrado no destino só abre com a senha antiga.' }))) return;
  await api('POST', '/api/cloud/encryption', { disable: true }); loadCloud(true);
});
const clJob = (path, msg) => act(async () => { await api('POST', path, {}); jobDismissed.clear(); setTimeout(() => loadCloud(false), 7000); if (msg) ui.toast(msg); });
$('#clTest').onclick = clJob('/api/cloud/test');
$('#clNow').onclick = clJob('/api/cloud/upload');
$('#clVerify').onclick = clJob('/api/cloud/verify');
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-a="clRemove"]'); if (!t) return;
  if (await ui.confirm({ title: 'Remover destino', danger: true, okText: 'Remover', html: `Remover <b>${esc(t.dataset.name)}</b> da configuração? Os arquivos que já estão na nuvem <b>não</b> são apagados.` })) {
    try { await api('POST', '/api/cloud/remove', { name: t.dataset.name }); loadCloud(true); } catch (_) { /* alerta */ }
  }
});
$('#ntSave').onclick = act(async () => {
  await api('POST', '/api/notify/settings', { telegramToken: $('#ntToken').value.trim(), telegramChatId: $('#ntChat').value.trim(), webhookUrl: $('#ntHook').value.trim(), onFail: $('#ntFail').checked, onOk: $('#ntOk').checked });
  $('#ntToken').value = ''; $('#ntHook').value = ''; ui.toast('Avisos salvos'); loadCloud(true);
});
$('#ntTest').onclick = act(async () => { await api('POST', '/api/notify/test', {}); ui.toast('Teste enviado'); });
$('#ntClearTg').onclick = act(async () => { await api('POST', '/api/notify/settings', { clearTelegram: true }); loadCloud(true); });
$('#ntClearHook').onclick = act(async () => { await api('POST', '/api/notify/settings', { clearWebhook: true }); loadCloud(true); });


// ---------- GitHub ----------
var GH = null; var ghPoll = null;
async function loadGh(fill) {
  try { GH = await api('GET', '/api/github', null, true); } catch (_) { return; }
  const gs = $('#ghGitState'); gs.textContent = GH.gitInstalled ? `Git ${GH.gitVersion}${GH.managedGit ? ' (do RDR Local)' : ''}` : 'não instalado'; gs.className = 'chip ' + (GH.gitInstalled ? 'on' : 'warn');
  $('#ghGitInstall').style.display = GH.gitInstalled ? 'none' : '';
  const cs = $('#ghConnState'); cs.textContent = GH.connected ? 'conectado' : 'desconectado'; cs.className = 'chip ' + (GH.connected ? 'on' : 'warn');
  $('#ghDisc').hidden = GH.connected; $('#ghConn').hidden = !GH.connected; $('#ghUser').textContent = GH.user || '';
  if (fill) { $('#ghClient').value = GH.clientId || ''; $('#ghPriv').checked = !!GH.privateRepos; }
  if (GH.connected) loadGhRepos(); else $('#ghRepos').innerHTML = '<div class="empty">Conecte sua conta para listar.</div>';
  loadGhSites();
}
async function loadGhRepos() {
  const q = $('#ghSearch').value.trim();
  try {
    const r = await api('GET', '/api/github/repos?q=' + encodeURIComponent(q), null, true);
    $('#ghRepos').innerHTML = r.repos.length ? '<table><tbody>' + r.repos.map((x) => `<tr><td><b>${esc(x.full)}</b> ${x.private ? '<span class="chip">privado</span>' : ''}${x.archived ? ' <span class="chip">arquivado</span>' : ''}<small>${esc(x.description)}</small></td><td style="text-align:right"><button class="sm" data-clone="${esc(x.full)}" ${GH.gitInstalled ? '' : 'disabled title="Instale o Git primeiro"'}>Clonar</button></td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Nenhum repositório encontrado.</div>';
  } catch (e) { $('#ghRepos').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function loadGhSites() {
  let st = {}; try { st = await api('GET', '/api/git/status', null, true); } catch (_) { /* sem git */ }
  const list = (S ? S.sites : []).filter((s) => st[s.id]);
  $('#ghSites').innerHTML = list.length ? '<table><tbody>' + list.map((s) => {
    const v = st[s.id];
    const info = v.error ? `<span class="chip bad">${esc(v.error)}</span>` : (v.remoteGone ? '<span class="chip bad" title="Removido, renomeado ou sem acesso. A pasta local continua intacta.">removido no GitHub?</span> ' : '') + `<span class="badge">${esc(v.branch)}</span>` + (v.changed + v.untracked ? ` <span class="chip warn">${v.changed + v.untracked} alteração(ões)</span>` : ' <span class="chip on">limpo</span>') + (v.behind ? ` <span class="chip warn">${v.behind} para baixar</span>` : '') + (v.ahead ? ` <span class="chip">${v.ahead} para enviar</span>` : '');
    return `<tr><td><b>${esc(s.name)}</b><small>${esc(s.path)}</small></td><td>${info}</td><td style="text-align:right">${v.remoteGone ? `<button class="sec sm" data-gd="${s.id}" title="Remove só o site; a pasta não é apagada">Remover site</button> ` : ''}<button class="sec sm" data-gf="${s.id}">Buscar</button> <button class="sm" data-gp="${s.id}">Atualizar</button></td></tr>`;
  }).join('') + '</tbody></table>' : '<div class="empty">Nenhum site com pasta .git ainda.</div>';
}
let ghT = null; $('#ghSearch').oninput = () => { clearTimeout(ghT); ghT = setTimeout(() => GH && GH.connected && loadGhRepos(), 300); };
$('#ghRefresh').onclick = () => loadGhSites();
$('#ghGitInstall').onclick = act(async () => { await api('POST', '/api/install', { id: 'git' }); jobDismissed.clear(); setTimeout(() => loadGh(false), 8000); });
$('#ghLogin').onclick = act(async () => {
  await api('POST', '/api/github/config', { clientId: $('#ghClient').value, privateRepos: $('#ghPriv').checked });
  const d = await api('POST', '/api/github/device-start');
  const box = $('#ghCode'); box.hidden = false;
  box.innerHTML = `1. Abra <a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.url)}</a><br>2. Digite o código: <b style="font-size:1.4em;letter-spacing:.1em">${esc(d.userCode)}</b><br><span class="small">Aguardando a sua autorização…</span>`;
  clearInterval(ghPoll);
  ghPoll = setInterval(async () => {
    try {
      const r = await api('POST', '/api/github/device-poll', null, true);
      if (r.status === 'pending') return;
      clearInterval(ghPoll); box.hidden = true;
      if (r.status === 'ok') { ui.toast('GitHub conectado'); loadGh(false); }
      else ui.alert({ title: 'Login não concluído', message: r.status === 'denied' ? 'Você negou o acesso.' : 'O código expirou. Tente de novo.', tone: 'warn' });
    } catch (e) { clearInterval(ghPoll); box.hidden = true; ui.alert({ title: 'Erro no login', message: e.message, tone: 'bad' }); }
  }, 5500);
});
$('#ghTokenSave').onclick = act(async () => { await api('POST', '/api/github/token', { token: $('#ghToken').value }); $('#ghToken').value = ''; ui.toast('GitHub conectado'); await loadGh(false); });
$('#ghOut').onclick = act(async () => {
  if (!(await ui.confirm({ title: 'Desconectar GitHub', okText: 'Desconectar', html: 'Apaga o token guardado neste PC. Os repositórios já clonados continuam nas suas pastas.' }))) return;
  await api('POST', '/api/github/disconnect'); await loadGh(false);
});
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-clone],[data-gf],[data-gp],[data-gd]'); if (!t) return;
  if (t.dataset.gd) {
    const site = S.sites.find((x) => x.id === t.dataset.gd); if (!site) return;
    if (await ui.confirm({ title: 'Remover site', danger: true, okText: 'Remover', html: `Remover <b>${esc(site.name)}</b> do RDR Local? A pasta <code>${esc(site.path)}</code> <b>não</b> é apagada.` })) { await api('POST', '/api/sites/remove', { id: site.id }); ui.toast('Site removido.'); await refresh(); loadGhSites(); }
    return;
  }
  if (t.dataset.clone) {
    const f = $('#ghForm'); f.full.value = t.dataset.clone; f.name.value = t.dataset.clone.split('/')[1]; f.domain.value = ''; f.dir.value = ''; f.createDb.checked = false; $('#ghDlg').showModal(); return;
  }
  t.disabled = true;
  try { await api('POST', t.dataset.gf ? '/api/git/fetch' : '/api/git/pull', { id: t.dataset.gf || t.dataset.gp }); jobDismissed.clear(); setTimeout(loadGhSites, 4000); } catch (_) { /* alerta */ }
  t.disabled = false; refresh();
});
$('#ghCancel').onclick = () => $('#ghDlg').close();
$('#ghForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  const body = { full: f.full.value, name: f.name.value.trim(), domain: f.domain.value.trim(), dir: f.dir.value.trim(), createDb: f.createDb.checked };
  try { await api('POST', '/api/github/clone', body); $('#ghDlg').close(); jobDismissed.clear(); ui.toast('Clonando… acompanhe no log da tarefa.'); refresh(); } catch (_) { /* alerta */ }
};


// ---------- Importar de outro ambiente ----------
var IMP = { src: null, list: [] };
function impSource() { const v = $('#impPath').value.trim(); if (v) return { kind: 'custom', path: v }; const s = IMP.sources && IMP.sources[$('#impSrc').value]; return s ? { kind: s.kind, path: s.path } : null; }
$('#btnImport').onclick = act(async () => {
  const r = await api('GET', '/api/import/sources'); IMP.sources = r.sources; IMP.list = []; $('#impList').innerHTML = ''; $('#impWarn').textContent = ''; $('#impRun').disabled = true; $('#impPath').value = '';
  $('#impSrc').innerHTML = r.sources.length ? r.sources.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('') : '<option value="">Nada detectado: informe o caminho ao lado</option>';
  $('#impDlg').showModal();
});
$('#impCancel').onclick = () => $('#impDlg').close();
const IMP_ST = { new: ['novo', 'on'], 'path-in-use': ['já existe (pasta)', ''], 'domain-in-use': ['domínio já usado', ''], 'missing-folder': ['pasta não encontrada', 'bad'] };
$('#impScan').onclick = async (e) => {
  const src = impSource(); if (!src) { ui.alert({ title: 'Escolha a origem', message: 'Selecione uma origem detectada ou informe um caminho.', tone: 'warn' }); return; }
  const btn = e.currentTarget; btn.disabled = true;
  try {
    IMP.src = src; IMP.list = (await api('POST', '/api/import/scan', src)).list;
    $('#impList').innerHTML = IMP.list.length ? '<table><tbody>' + IMP.list.map((c, i) => {
      const st = IMP_ST[c.status] || [c.status, '']; const ok = c.status === 'new';
      return `<tr><td style="width:28px"><input type="checkbox" data-i="${i}" ${ok ? 'checked' : 'disabled'}></td><td><b>${esc(c.domain)}</b>${c.aliases.length ? ' <small>+ ' + esc(c.aliases.join(', ')) + '</small>' : ''}<small>${c.type === 'proxy' ? '→ ' + esc(c.target) : esc(c.path)}${c.framework ? ' · ' + esc(c.framework) : ''}${c.phpHint ? ' · PHP ' + esc(c.phpHint) : ''}</small>${c.warnings.map((w) => `<small>⚠ ${esc(w)}</small>`).join('')}</td><td><span class="chip ${st[1]}">${esc(st[0])}</span></td></tr>`;
    }).join('') + '</tbody></table>' : '<div class="empty">Nenhum site encontrado nessa origem.</div>';
    $('#impWarn').innerHTML = IMP.list.some((c) => c.status === 'new') ? '⚠ Se o ServBay/Laragon/XAMPP ainda estiver rodando, ele ocupa as portas 80/443: <b>pare o servidor web dele</b> antes de iniciar o RDR Local (veja Diagnóstico). Os projetos continuam nas pastas de origem.' : '';
    impSync();
  } catch (_) { /* alerta */ }
  btn.disabled = false;
};
function impSync() { $('#impRun').disabled = !document.querySelector('#impList input:checked'); }
$('#impList').addEventListener('change', impSync);
$('#impRun').onclick = act(async () => {
  const keys = [...document.querySelectorAll('#impList input:checked')].map((x) => IMP.list[+x.dataset.i].key);
  const r = await api('POST', '/api/import/run', { ...IMP.src, keys });
  $('#impDlg').close();
  await ui.alert({ title: `${r.added.length} site(s) importado(s)`, tone: r.added.length ? 'ok' : 'warn', message: (r.added.length ? 'Criados: ' + r.added.map((x) => x.domain).join(', ') + '. ' : '') + (r.skipped.length ? 'Ignorados: ' + r.skipped.map((x) => `${x.name} (${x.reason})`).join('; ') + '. ' : '') + 'Se o projeto é Laravel, confira o APP_URL no .env (o Diagnóstico avisa).' });
});


// ---------- Importar bancos de outro servidor ----------
var DBI = { dbs: [] };
$('#btnDbImport').onclick = act(async () => {
  $('#dbiList').innerHTML = ''; $('#dbiRun').disabled = true; $('#dbiPass').value = ''; $('#dbiHint').textContent = '';
  try { const r = await api('GET', '/api/dbimport/ports', null, true); $('#dbiPort').value = r.ports[0] || ''; $('#dbiHint').textContent = r.ports.length ? 'Portas com algo escutando: ' + r.ports.join(', ') : 'Nenhum servidor de banco detectado fora do RDR Local: ligue o da origem.'; } catch (_) { /* segue sem sugestão */ }
  $('#dbiDlg').showModal();
});
$('#dbiCancel').onclick = () => $('#dbiDlg').close();
function dbiConn() { return { port: Number($('#dbiPort').value), user: $('#dbiUser').value.trim(), password: $('#dbiPass').value }; }
$('#dbiConnect').onclick = async (e) => {
  const btn = e.currentTarget; btn.disabled = true;
  try {
    const r = await api('POST', '/api/dbimport/probe', dbiConn()); DBI.dbs = r.databases.filter((d) => !d.system);
    $('#dbiHint').textContent = `${r.flavor === 'mysql' ? 'MySQL' : 'MariaDB'} ${r.version}` + (r.flavor === 'mysql' ? ' · collations do MySQL 8 serão ajustadas' : '') + (r.localUp ? '' : ' · MariaDB do RDR Local parado: inicie-o antes de importar');
    $('#dbiList').innerHTML = DBI.dbs.length ? '<table><tbody>' + DBI.dbs.map((d, i) => `<tr><td><input type="checkbox" data-i="${i}" ${d.validName ? '' : 'disabled'}></td><td><b>${esc(d.name)}</b><small>${d.tables} tabela(s) · ${d.mb} MB${d.validName ? '' : ' · nome fora do padrão (use letras, números e _)'}</small></td><td><input type="text" data-t="${i}" value="${esc(d.name)}" ${d.validName ? '' : 'disabled'} title="Nome do banco aqui"></td><td>${d.existsHere ? `<label class="row" style="gap:4px"><input type="checkbox" data-o="${i}"><span class="small">substituir (já existe)</span></label>` : '<span class="chip on">novo</span>'}</td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Nenhum banco de usuário encontrado.</div>';
    dbiSync();
  } catch (_) { /* alerta */ }
  btn.disabled = false;
};
function dbiSync() { $('#dbiRun').disabled = !document.querySelector('#dbiList input[data-i]:checked'); }
$('#dbiList').addEventListener('change', dbiSync);
$('#dbiRun').onclick = act(async () => {
  const items = [...document.querySelectorAll('#dbiList input[data-i]:checked')].map((x) => { const i = +x.dataset.i; const t = document.querySelector(`#dbiList input[data-t="${i}"]`).value.trim(); const o = document.querySelector(`#dbiList input[data-o="${i}"]`); return { name: DBI.dbs[i].name, target: t, overwrite: !!(o && o.checked) }; });
  const over = items.filter((x) => x.overwrite);
  if (over.length && !(await ui.confirm({ title: 'Substituir bancos', danger: true, okText: 'Substituir', html: `Os bancos <b>${over.map((x) => esc(x.target)).join(', ')}</b> daqui serão substituídos pelos da origem. É feita uma cópia de segurança antes (Bancos → Backups).` }))) return;
  await api('POST', '/api/dbimport/run', { ...dbiConn(), items });
  $('#dbiPass').value = ''; $('#dbiDlg').close(); jobDismissed.clear(); ui.toast('Importando… acompanhe no log da tarefa.');
});


// ---------- Publicar (servidores SSH, chaves e receitas) ----------
var PB = null; var pbEditing = null; var pbCur = null;
async function loadPb() {
  try { PB = await api('GET', '/api/deploy', null, true); } catch (_) { return; }
  loadFp();
  $('#pbSsh').innerHTML = PB.ssh ? '' : '⚠ O <b>Cliente OpenSSH</b> não está instalado: Configurações do Windows → Aplicativos → Recursos opcionais → Adicionar → “Cliente OpenSSH”.';
  const keyName = (id) => (PB.keys.find((k) => k.id === id) || {}).label || '—';
  $('#pbServers').innerHTML = PB.servers.length ? PB.servers.map((s) => `<div class="pb-srv"><div class="row" style="justify-content:space-between;gap:8px"><b>${esc(s.name)}</b>${s.trusted ? '<span class="chip on" title="Identidade confirmada">confirmado</span>' : '<span class="chip warn">confirmar identidade</span>'}</div><small class="muted">${esc(s.user)}@${esc(s.host)}${s.port !== 22 ? ':' + s.port : ''} · chave ${esc(keyName(s.keyId))}${s.group ? ' · ' + esc(s.group) : ''}</small><div class="acts">${s.trusted ? `<button class="sm" data-pt="${s.id}">Testar</button>` : `<button class="sm" data-pp="${s.id}">Confirmar identidade</button>`}<button class="sec sm" data-pe="${s.id}">Editar</button><button class="sec sm" data-pd="${s.id}">Remover</button></div></div>`).join('') : '<div class="empty">Nenhum servidor. Gere uma chave e cadastre o primeiro.</div>';
  const srvName = (id) => (PB.servers.find((s) => s.id === id) || {}).name || '—';
  $('#pbRecipes').innerHTML = PB.recipes.length ? '<table><tbody>' + PB.recipes.map((r) => `<tr><td><b>${esc(r.name)}</b><small>→ ${esc(srvName(r.serverId))} · ${r.steps.length} passo(s)${r.last ? ' · último: ' + (r.last.ok ? '✔' : '✖') + ' ' + esc(r.last.msg) : ''}</small></td><td style="text-align:right;white-space:nowrap"><button class="sm" data-rp="${r.id}">Publicar</button> ${(r.rollback || []).length ? `<button class="sec sm" data-rr="${r.id}" title="Volta o serviço à versão anterior">Reverter</button> ` : ''}<button class="sec sm" data-re="${r.id}">Editar</button> <button class="sec sm" data-rd="${r.id}">Remover</button></td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Nenhuma receita ainda.</div>';
  $('#pbKeys').innerHTML = PB.keys.length ? '<table><tbody>' + PB.keys.map((k) => `<tr><td><b>${esc(k.label)}</b><small>${esc(k.fingerprint)}${k.usedBy.length ? ' · usada por ' + esc(k.usedBy.join(', ')) : ''}</small></td><td style="text-align:right;white-space:nowrap"><button class="sec sm" data-kc="${k.id}">Copiar pública</button> <button class="sec sm" data-kd="${k.id}">Remover</button></td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Nenhuma chave. Clique em “Gerar chave”.</div>';
}
function pbKeyOptions(sel) { $('#pbSrvForm').keyId.innerHTML = PB.keys.map((k) => `<option value="${k.id}">${esc(k.label)}</option>`).join(''); if (sel) $('#pbSrvForm').keyId.value = sel; }
$('#pbAddSrv').onclick = () => {
  if (!PB || !PB.keys.length) { ui.alert({ title: 'Crie uma chave primeiro', message: 'Clique em “Gerar chave” (ou “Importar”) na seção Chaves SSH e depois cadastre o servidor.', tone: 'warn' }); return; }
  pbEditing = null; $('#pbSrvTitle').textContent = 'Novo servidor'; const f = $('#pbSrvForm'); f.reset(); f.port.value = 22; f.user.value = 'root'; pbKeyOptions(); $('#pbSrvDlg').showModal();
};
$('#pbSrvCancel').onclick = () => $('#pbSrvDlg').close();
$('#pbSrvForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  try { const r = await api('POST', '/api/deploy/server/save', { id: pbEditing, name: f.name.value, group: f.group.value, host: f.host.value, port: f.port.value, user: f.user.value, keyId: f.keyId.value }); $('#pbSrvDlg').close(); await loadPb(); if (!r.trusted) pbConfirmHost(r.id); } catch (_) { /* alerta */ }
};
async function pbConfirmHost(id) {
  try {
    const p = await api('POST', '/api/deploy/server/probe', { id });
    const same = p.current && p.current === p.fingerprint;
    if (same) { ui.toast('A identidade já estava confirmada e continua igual.'); return; }
    const ok = await ui.confirm({ title: p.current ? 'A identidade do servidor MUDOU' : 'Confirmar identidade do servidor', danger: !!p.current, okText: 'É esta, confirmar', html: `${p.current ? '<b>Atenção:</b> era <code>' + esc(p.current) + '</code>. Só aceite se você reinstalou o servidor.<br><br>' : ''}Impressão digital (${esc(p.type)}):<br><code style="word-break:break-all">${esc(p.fingerprint)}</code><br><br>Confira no servidor com <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>. Se não bater, <b>não confirme</b>.` });
    if (ok) { await api('POST', '/api/deploy/server/trust', { id, fingerprint: p.fingerprint }); ui.toast('Identidade confirmada.'); loadPb(); }
  } catch (_) { /* alerta */ }
}
async function pbTest(id) {
  const r = await api('POST', '/api/deploy/server/test', { id });
  if (r.ok) ui.toast('Conectou: ' + r.info); else await ui.alert({ title: 'Não conectou', tone: 'bad', message: r.error, pre: r.pub || undefined });
}
$('#pbGenKey').onclick = () => { $('#pbKeyTitle').textContent = 'Gerar chave SSH'; const f = $('#pbKeyForm'); f.reset(); f.priv.value = ''; $('#pbKeyPrivLb').style.display = 'none'; f.dataset.mode = 'gen'; $('#pbKeyNote').textContent = 'Cria uma chave ed25519 sem senha. Depois copie a chave pública para o authorized_keys do servidor.'; $('#pbKeyOk').textContent = 'Gerar'; $('#pbKeyDlg').showModal(); };
$('#pbImpKey').onclick = () => { $('#pbKeyTitle').textContent = 'Importar chave SSH'; const f = $('#pbKeyForm'); f.reset(); $('#pbKeyPrivLb').style.display = ''; f.dataset.mode = 'imp'; $('#pbKeyNote').textContent = 'Chaves com senha (passphrase) ainda não são suportadas.'; $('#pbKeyOk').textContent = 'Importar'; $('#pbKeyDlg').showModal(); };
$('#pbKeyCancel').onclick = () => { $('#pbKeyForm').priv.value = ''; $('#pbKeyDlg').close(); };
$('#pbKeyForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  try {
    const r = f.dataset.mode === 'gen' ? await api('POST', '/api/deploy/key/generate', { label: f.label.value }) : await api('POST', '/api/deploy/key/import', { label: f.label.value, privateKey: f.priv.value });
    f.priv.value = ''; $('#pbKeyDlg').close(); await loadPb();
    await ui.alert({ title: 'Chave guardada', tone: 'ok', message: 'Coloque esta chave pública no arquivo ~/.ssh/authorized_keys do usuário do servidor:', pre: r.pub });
  } catch (_) { /* alerta */ }
};
function pbRcMode() { const m = $('#pbRcForm').mode.value; document.querySelectorAll('#pbRcForm [data-m]').forEach((el) => { el.style.display = el.dataset.m === m ? '' : 'none'; }); }
$('#pbRcForm').mode.onchange = pbRcMode;
function pbRcOpen(r) {
  const f = $('#pbRcForm'); f.reset(); pbEditing = r ? r.id : null; $('#pbRcTitle').textContent = r ? 'Editar receita' : 'Nova receita';
  f.serverId.innerHTML = PB.servers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  f.siteId.innerHTML = '<option value="">— nenhum —</option>' + (S ? S.sites : []).filter((x) => x.path).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  if (r) { f.name.value = r.name; f.serverId.value = r.serverId; f.siteId.value = r.siteId || ''; f.branch.value = r.branch; f.mode.value = 'custom'; f.cmds.value = r.steps.map((x) => x.cmd).join('\n'); f.rollback.value = (r.rollback || []).map((x) => x.cmd).join('\n'); f.checkBuild.checked = !!r.checkBuild; } else f.mode.value = 'swarm';
  pbRcMode(); $('#pbRcDlg').showModal();
}
$('#pbAddRc').onclick = () => { if (!PB || !PB.servers.length) { ui.alert({ title: 'Cadastre um servidor', message: 'Crie um servidor antes de criar receitas.', tone: 'warn' }); return; } pbRcOpen(null); };
$('#pbRcCancel').onclick = () => $('#pbRcDlg').close();
$('#pbRcForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target; const body = { id: pbEditing, name: f.name.value, serverId: f.serverId.value, siteId: f.siteId.value, branch: f.branch.value, checkBuild: f.checkBuild.checked };
  const lines = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean).map((cmd) => ({ cmd }));
  if (f.mode.value === 'swarm') body.swarm = { image: f.image.value.trim(), services: f.services.value, extra: lines(f.extra.value) }; else { body.steps = lines(f.cmds.value); body.rollback = lines(f.rollback.value); }
  try { await api('POST', '/api/deploy/recipe/save', body); $('#pbRcDlg').close(); loadPb(); } catch (_) { /* alerta */ }
};
async function pbPublish(id) {
  try {
    pbCur = id; const r = PB.recipes.find((x) => x.id === id); const p = await api('POST', '/api/deploy/recipe/precheck', { id });
    $('#pbPubTitle').textContent = 'Publicar: ' + r.name;
    $('#pbPubChecks').innerHTML = p.checks.map((c) => `<div class="pb-chk"><span class="chip ${c.level === 'ok' ? 'on' : c.level === 'warn' ? 'warn' : 'bad'}">${c.level === 'ok' ? 'ok' : c.level === 'warn' ? 'atenção' : 'bloqueia'}</span><span>${esc(c.text)}${c.url ? ` <a href="${esc(c.url)}" target="_blank" rel="noopener">ver</a>` : ''}</span></div>`).join('');
    $('#pbPubSteps').textContent = p.steps.map((x, i) => `${i + 1}. ${x.cmd}`).join('\n');
    const run = $('#pbPubRun'); run.textContent = p.canPublish ? 'Publicar' : 'Publicar mesmo assim'; run.className = p.canPublish ? '' : 'danger'; run.dataset.force = p.canPublish ? '' : '1';
    $('#pbPubDlg').showModal();
  } catch (_) { /* alerta */ }
}
$('#pbPubCancel').onclick = () => $('#pbPubDlg').close();
$('#pbPubRun').onclick = async (e) => {
  const force = !!e.currentTarget.dataset.force;
  if (force && !(await ui.confirm({ title: 'Publicar mesmo assim?', danger: true, okText: 'Publicar mesmo assim', html: 'Há verificações que bloqueiam. A produção pode receber uma imagem antiga ou incompleta.' }))) return;
  try { await api('POST', '/api/deploy/recipe/publish', { id: pbCur, force }); $('#pbPubDlg').close(); jobDismissed.clear(); ui.toast('Publicando… acompanhe no log da tarefa.'); refresh(); setTimeout(loadPb, 6000); } catch (_) { /* alerta */ }
};
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-pt],[data-pp],[data-pe],[data-pd],[data-rp],[data-rr],[data-re],[data-rd],[data-kc],[data-kd]'); if (!t || !PB) return;
  const d = t.dataset;
  try {
    if (d.pt) { t.disabled = true; await pbTest(d.pt); t.disabled = false; }
    else if (d.pp) await pbConfirmHost(d.pp);
    else if (d.pe) { const s = PB.servers.find((x) => x.id === d.pe); pbEditing = s.id; $('#pbSrvTitle').textContent = 'Editar servidor'; const f = $('#pbSrvForm'); f.name.value = s.name; f.group.value = s.group; f.host.value = s.host; f.port.value = s.port; f.user.value = s.user; pbKeyOptions(s.keyId); $('#pbSrvDlg').showModal(); }
    else if (d.pd) { if (await ui.confirm({ title: 'Remover servidor', danger: true, okText: 'Remover', html: 'Remove só o cadastro daqui. Nada muda no servidor.' })) { await api('POST', '/api/deploy/server/remove', { id: d.pd }); loadPb(); } }
    else if (d.rp) await pbPublish(d.rp);
    else if (d.rr) { const r = PB.recipes.find((x) => x.id === d.rr); if (await ui.confirm({ title: 'Reverter: ' + r.name, danger: true, okText: 'Reverter agora', html: 'Vai rodar no servidor:<br><code style="white-space:pre-wrap;word-break:break-all">' + esc(r.rollback.map((x) => x.cmd).join('\n')) + '</code><br><br>No Swarm isso volta cada serviço à especificação <b>anterior</b> (um nível só). Passos extras da receita, como migrações de banco, <b>não</b> são desfeitos.' })) { await api('POST', '/api/deploy/recipe/rollback', { id: d.rr }); jobDismissed.clear(); ui.toast('Revertendo… acompanhe no log da tarefa.'); refresh(); setTimeout(loadPb, 6000); } }
    else if (d.re) pbRcOpen(PB.recipes.find((x) => x.id === d.re));
    else if (d.rd) { if (await ui.confirm({ title: 'Remover receita', danger: true, okText: 'Remover', html: 'Remove só a receita.' })) { await api('POST', '/api/deploy/recipe/remove', { id: d.rd }); loadPb(); } }
    else if (d.kc) { const k = PB.keys.find((x) => x.id === d.kc); try { await navigator.clipboard.writeText(k.pub); ui.toast('Chave pública copiada'); } catch (_) { await ui.alert({ title: 'Chave pública', tone: 'info', pre: k.pub }); } }
    else if (d.kd) { if (await ui.confirm({ title: 'Remover chave', danger: true, okText: 'Remover', html: 'A chave privada é apagada daqui. Se ela ainda estiver no servidor, remova-a de lá também.' })) { await api('POST', '/api/deploy/key/remove', { id: d.kd }); loadPb(); } }
  } catch (_) { /* alerta já exibido */ }
});


// ---------- Sites antigos: FTP / FTPS / SFTP ----------
var FP = null; var fpEditing = null; var fpCur = null; var fpPlan = null;
async function loadFp() {
  try { FP = await api('GET', '/api/ftp', null, true); } catch (_) { return; }
  $('#fpCurl').textContent = FP.curl ? '' : 'curl.exe não encontrado (vem no Windows 10 1803+ e 11): FTP/FTPS não funcionam sem ele.';
  const siteName = (id) => ((S && S.sites || []).find((x) => x.id === id) || {}).name || '—';
  $('#fpTargets').innerHTML = FP.targets.length ? '<table><tbody>' + FP.targets.map((t) => `<tr><td><b>${esc(t.name)}</b> <span class="chip ${t.protocol === 'ftp' ? 'warn' : 'on'}">${t.protocol.toUpperCase()}</span><small>${esc(t.user)}@${esc(t.host)}${t.remoteDir ? ' ' + esc(t.remoteDir) : ''} ← ${esc(siteName(t.siteId))}${t.last ? ' · último: ' + (t.last.ok ? '✔' : '✖') + ' ' + esc(t.last.msg) : ''}${t.trusted ? '' : ' · confirme o servidor SSH'}</small></td><td style="text-align:right;white-space:nowrap"><button class="sm" data-fpp="${t.id}">Publicar</button> <button class="sec sm" data-fpt="${t.id}">Testar</button> <button class="sec sm" data-fpe="${t.id}">Editar</button> <button class="sec sm" data-fpd="${t.id}">Remover</button></td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Nenhum destino.</div>';
}
function fpProto() {
  const f = $('#fpForm'); const p = f.protocol.value;
  document.querySelectorAll('#fpForm [data-f]').forEach((el) => { const k = el.dataset.f; el.style.display = (k === 'net' && p !== 'sftp') || (k === 'ssh' && p === 'sftp') || (k === 'tls' && p === 'ftps') ? '' : 'none'; });
  if (p !== 'sftp' && !fpEditing) f.port.value = 21;
}
$('#fpForm').protocol.onchange = fpProto;
function fpOpen(t) {
  const f = $('#fpForm'); f.reset(); fpEditing = t ? t.id : null; $('#fpTitle').textContent = t ? 'Editar destino' : 'Novo destino';
  f.serverId.innerHTML = (PB ? PB.servers : []).map((s) => `<option value="${s.id}">${esc(s.name)} (${esc(s.user)}@${esc(s.host)})</option>`).join('');
  f.siteId.innerHTML = (S ? S.sites : []).filter((x) => x.path).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  if (t) { f.name.value = t.name; f.protocol.value = t.protocol; f.host.value = t.protocol === 'sftp' ? '' : t.host; f.port.value = t.port; f.user.value = t.protocol === 'sftp' ? '' : t.user; f.serverId.value = t.serverId; f.siteId.value = t.siteId; f.localSub.value = t.localSub; f.remoteDir.value = t.remoteDir; f.excludes.value = (t.excludes || []).join('\n'); f.insecureTls.checked = !!t.insecureTls; } else f.protocol.value = 'ftps';
  fpProto(); $('#fpDlg').showModal();
}
$('#fpAdd').onclick = () => fpOpen(null);
$('#fpCancel').onclick = () => $('#fpDlg').close();
$('#fpForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  try { await api('POST', '/api/ftp/save', { id: fpEditing, name: f.name.value, protocol: f.protocol.value, host: f.host.value, port: f.port.value, user: f.user.value, password: f.password.value, serverId: f.serverId.value, siteId: f.siteId.value, localSub: f.localSub.value, remoteDir: f.remoteDir.value, excludes: f.excludes.value, insecureTls: f.insecureTls.checked }); f.password.value = ''; $('#fpDlg').close(); loadFp(); } catch (_) { /* alerta */ }
};
async function fpPublish(id) {
  try {
    fpCur = id; fpPlan = await api('POST', '/api/ftp/plan', { id }); const p = fpPlan; const t = FP.targets.find((x) => x.id === id);
    const list = (title, arr) => arr.length ? `<b>${title} (${arr.length})</b><div class="fp-list">${esc(arr.slice(0, 200).join('\n'))}${arr.length > 200 ? '\n… e mais ' + (arr.length - 200) : ''}</div>` : '';
    $('#fpPlanTitle').textContent = 'Publicar: ' + t.name;
    $('#fpPlanBody').innerHTML = p.warns.map((w) => `<div class="pb-chk"><span class="chip warn">atenção</span><span>${esc(w)}</span></div>`).join('') +
      `<p class="muted small">Origem: <code>${esc(p.root)}</code> · ${p.total} arquivo(s), ${p.same} sem mudança · ${(p.bytes / 1048576).toFixed(2)} MB a enviar</p>` +
      list('Novos', p.add) + list('Alterados', p.chg) + list('Removidos aqui (continuam no servidor, a menos que você marque abaixo)', p.del) +
      (p.skipped.length ? `<p class="muted small">Ignorados por segurança: ${esc(p.skipped.map((x) => x.path).join(', '))}</p>` : '') +
      (!p.add.length && !p.chg.length && !p.del.length ? '<p>Nada para enviar: tudo igual ao último envio.</p>' : '');
    $('#fpDelLb').style.display = p.del.length ? '' : 'none'; $('#fpDel').checked = false;
    $('#fpBase').style.display = p.firstRun ? '' : 'none';
    const run = $('#fpPlanRun'); run.disabled = !p.add.length && !p.chg.length && !p.del.length; $('#fpPlanDlg').showModal();
  } catch (_) { /* alerta */ }
}
$('#fpPlanCancel').onclick = () => $('#fpPlanDlg').close();
$('#fpBase').onclick = async () => {
  if (!(await ui.confirm({ title: 'Registrar ponto de partida', okText: 'Já está igual', html: 'Isso <b>não envia nada</b>: só anota que o servidor já tem estes arquivos. Use apenas se a pasta do servidor é idêntica à local; depois, só o que mudar será enviado.' }))) return;
  try { const r = await api('POST', '/api/ftp/baseline', { id: fpCur }); $('#fpPlanDlg').close(); ui.toast(r.files + ' arquivos registrados.'); loadFp(); } catch (_) { /* alerta */ }
};
$('#fpPlanRun').onclick = async () => {
  const p = fpPlan; const del = $('#fpDel').checked && p.del.length > 0;
  if (p.firstRun && !(await ui.confirm({ title: 'Primeira publicação', danger: true, okText: 'Enviar tudo', html: `Vai enviar <b>${p.add.length}</b> arquivo(s) e <b>sobrescrever</b> os de mesmo nome que já existem no servidor.` }))) return;
  if (del && !(await ui.confirm({ title: 'Apagar no servidor?', danger: true, okText: 'Apagar e publicar', html: `<b>${p.del.length}</b> arquivo(s) serão apagados do servidor, sem lixeira.` }))) return;
  try { await api('POST', '/api/ftp/publish', { id: fpCur, confirmFirst: p.firstRun, deleteRemoved: del }); $('#fpPlanDlg').close(); jobDismissed.clear(); ui.toast('Publicando… acompanhe no log da tarefa.'); refresh(); setTimeout(loadFp, 6000); } catch (_) { /* alerta */ }
};
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-fpp],[data-fpt],[data-fpe],[data-fpd]'); if (!t || !FP) return; const d = t.dataset;
  try {
    if (d.fpp) await fpPublish(d.fpp);
    else if (d.fpt) { t.disabled = true; const r = await api('POST', '/api/ftp/test', { id: d.fpt }); t.disabled = false; if (r.ok) ui.toast(r.info); else await ui.alert({ title: 'Não conectou', tone: 'bad', message: r.error }); }
    else if (d.fpe) fpOpen(FP.targets.find((x) => x.id === d.fpe));
    else if (d.fpd) { if (await ui.confirm({ title: 'Remover destino', danger: true, okText: 'Remover', html: 'Remove só o cadastro (e a senha guardada). Nada muda no servidor.' })) { await api('POST', '/api/ftp/remove', { id: d.fpd }); loadFp(); } }
  } catch (_) { /* alerta já exibido */ }
});

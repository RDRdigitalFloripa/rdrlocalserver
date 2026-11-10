// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Caddyfile gerado para os sites: conteúdo (bloqueia docs/CLAUDE.md/AGENTS.md/rdr.json) e, se houver Caddy, validação de verdade. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./lib/harness');
const tools = require('./lib/tools');

h.run(async () => {
  h.isolateHome();
  const core = require('../lib/core');
  const sites = require('../lib/sites');
  const base = h.tmp('caddy');
  const pub = h.mkdir(base, 'site', 'public'); fs.writeFileSync(path.join(pub, 'index.html'), 'x');
  const site = (o) => ({ id: 'abc', enabled: true, name: 'T', path: path.join(base, 'site'), domain: 't.test', aliases: [], php: 'none', docroot: 'auto', type: 'php', cors: false, env: {}, ...o });

  h.title('conteúdo');
  core.cfg.sites.push(site({}));
  const txt = sites.buildCaddyfile();
  const m = /https:\/\/t\.test \{[\s\S]*?\n\}\n/.exec(txt);
  h.ok(!!m, 'o bloco do site t.test existe');
  const blk = m ? m[0] : '';
  h.ok(/@aidocs \{\s*path \/docs\/\* \/CLAUDE\.md \/AGENTS\.md \/rdr\.json\s*file\s*\}/.test(blk) && /respond @aidocs 404/.test(blk), 'bloqueia /docs/*, /CLAUDE.md, /AGENTS.md e /rdr.json (só quando o arquivo existe na pasta pública)', blk.slice(0, 400));
  h.ok(/root \* /.test(blk) && blk.includes(pub.replace(/\\/g, '/')) , 'a raiz do site é a pasta public/', blk.slice(0, 300));

  h.title('validação com o Caddy');
  const caddy = [process.env.RDR_TEST_CADDY, path.join(h.ROOT, 'bin', 'caddy', 'caddy.exe'), path.join(h.ROOT, 'bin', 'caddy', 'caddy')].filter(Boolean).find(tools.exists);
  if (!caddy) { h.skip('caddy não encontrado (defina RDR_TEST_CADDY): validação do Caddyfile pulada'); return; }
  const file = path.join(base, 'Caddyfile'); fs.writeFileSync(file, txt);
  const xdg = h.mkdir(base, 'xdg');
  const r = spawnSync(caddy, ['validate', '--config', file, '--adapter', 'caddyfile'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, XDG_DATA_HOME: xdg, XDG_CONFIG_HOME: xdg, APPDATA: xdg, LOCALAPPDATA: xdg } });
  h.ok(r.status === 0, 'o Caddy aceita o Caddyfile gerado (caddy validate)', `${r.stdout}${r.stderr}`.slice(-500));
});

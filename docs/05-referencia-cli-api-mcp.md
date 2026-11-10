# Referência: CLI, API e MCP

## CLI `rdr`

Fala com o painel em execução (`RDR_PORT`, padrão 7070).

| Comando | Ação |
|---|---|
| `rdr status` | Serviços e portas |
| `rdr start [serviço\|all]` | Liga (padrão: all) |
| `rdr stop [serviço\|all]` | Desliga |
| `rdr restart <serviço>` | Reinicia |
| `rdr sites` | Lista sites e endereços |
| `rdr open <domínio>` | Abre no navegador |
| `rdr doctor` | Roda o Diagnóstico |
| `rdr backup` | Backup de todos os bancos |
| `rdr up [pasta] [--yes]` | Aplica o `rdr.json` da pasta (padrão: a atual): cria/atualiza o site, o banco e liga os serviços. `--yes` confirma o comando de um app. Veja *rdr.json* |

Serviços: `web`, `mariadb`, `postgres`, `redis`, `mailpit`, `meilisearch`, `dns`.

## API HTTP (uso interno do painel)

Base: `http://127.0.0.1:7070`. Requisições `POST` exigem o cabeçalho `X-RDR: 1`. O `Host` deve ser `127.0.0.1:7070`, `localhost:7070` ou `rdr-local-server.<terminação>`. Erros voltam como `{ "error": "mensagem" }` (HTTP 400).

> A API não é pública nem versionada: pode mudar entre versões. Para automação, prefira CLI ou MCP.

| Grupo | Rotas |
|---|---|
| Estado | `GET /api/state`, `/api/host-status` (CPU/memória/disco; `/api/metrics` é o nome antigo), `/api/log`, `/api/hosts-text` |
| Serviços | `POST /api/svc`, `/api/install`, `/api/install-all`, `/api/trust`, `/api/settings` (inclui `projectDocs` e `autoCheckUpdates`) |
| Apps | `POST /api/apps/new` (cria arquivos do modelo + deps + site), `/api/apps/ctl` (`start`\|`stop`\|`restart`), `/api/apps/deps`; `GET /api/apps/detect?path=`, `/api/apps/templates` |
| Linguagens | `GET /api/runtimes/available?rt=node\|python\|go\|java`; `POST /api/runtimes/install`, `/api/runtimes/default`, `/api/runtimes/remove` |
| Sites | `POST /api/sites`, `/api/sites/update`, `/api/sites/remove`, `/api/sites/toggle`, `/api/sites/artisan`, `/api/sites/proc`, `/api/sites/terminal`, `/api/sites/folder`, `/api/scan`, `/api/project` |
| rdr.json | `POST /api/rdrfile/plan` (`id` do site ou `path`; devolve `steps`, `warnings`, `errors`, `needsConfirm`); `POST /api/rdrfile/apply` (`id` ou `path`, `confirmCmd`); `POST /api/rdrfile/export` (`id`, `overwrite`) |
| Ferramentas do projeto | `GET /api/dev/info?id=` (editores, `github`, `claude`, scripts, resumo do `.env`); `POST /api/dev/open` (`id`, `what`: `editor`\|`claude`, `editor`); `POST /api/scripts/run` (`id`, `kind`: `composer`\|`npm`, `name`), `/api/scripts/audit` (`id`); `GET /api/env?id=` (compara com o exemplo, sem valores sensíveis); `POST /api/env/set` (`id`, `key`, `value`), `/api/env/add-missing` (`id`, `keys` opcional), `/api/env/init` (`id`) |
| Plano do projeto | `GET /api/plan?id=` (fases, tarefas, progresso, diário), `/api/plan/overview` (um item por projeto com plano), `/api/plan/file?id=&kind=spec\|tasks\|diary`; `POST /api/plan/init` (`id`), `/api/plan/task` (`id`, `line`, `expect` = texto da tarefa, `state`: `" "`\|`~`\|`x`\|`-`), `/api/plan/add-task` (`id`, `phase`, `text`), `/api/plan/diary` (`id`, `text`) |
| E-mail (SMTP real) | `GET /api/mail` (perfil, sugestões de provedor e se há senha salva; **nunca** a senha); `POST /api/mail/save` (`host`, `port`, `secure`: `starttls`\|`ssl`\|`none`, `user`, `from`, `fromName`, `insecureTls`, `password` opcional, `clearPassword`); `POST /api/mail/test` (`mode`: `connect`\|`send`, `settings`, `password` opcional, `to`; devolve `ok`, `steps`, `error`, `hint`); `POST /api/mail/apply` (`id`, `mode`: `real`\|`mailpit`) |
| Terminal | `GET /api/term/info`, `/api/term/out`; `POST /api/term/run`, `/api/term/kill` |
| Bancos | `GET /api/db/list`, `/api/db/backups`; `POST /api/db/create`, `/api/db/drop`, `/api/db/backup`, `/api/db/restore`, `/api/db/backup-delete` |
| Nuvem e avisos | `GET /api/cloud` (nunca devolve credenciais); `POST /api/cloud/connect`, `/api/cloud/drive` (`name`, `path`, `passphrase`, `clientId`, `clientSecret`, `enable`; Google Drive em um clique, valida na hora e roda como tarefa), `/api/cloud/cancel` (encerra uma autorização pendente), `/api/cloud/remove`, `/api/cloud/settings`, `/api/cloud/encryption`, `/api/cloud/test`, `/api/cloud/upload`, `/api/cloud/verify`, `/api/notify/settings`, `/api/notify/test` |
| GitHub e Git | `GET /api/github` (nunca devolve o token); `POST /api/github/config`, `/device-start`, `/device-poll`, `/token`, `/disconnect`, `/clone`; `GET /api/github/repos?q=`; `GET /api/git/status`; `POST /api/git/fetch`, `/api/git/pull` |
| Importação | `GET /api/import/sources`; `POST /api/import/scan` (`kind`, `path`); `POST /api/import/run` (`kind`, `path`, `keys`) |
| Importar bancos | `GET /api/dbimport/ports`; `POST /api/dbimport/probe` (`port`, `user`, `password`); `POST /api/dbimport/run` (`port`, `user`, `password`, `items[{name,target,overwrite}]`). A senha nunca é gravada nem registrada em log |
| Publicar (SSH) | `GET /api/deploy` (nunca devolve chaves privadas); `POST /api/deploy/key/generate`, `/key/import`, `/key/remove`; `/server/save`, `/server/remove`, `/server/probe`, `/server/trust` (impressão digital), `/server/test`; `/recipe/save`, `/recipe/remove`, `/recipe/precheck`, `/recipe/publish` (`id`, `force`), `/recipe/rollback` (`id`) |
| Publicar (FTP/SFTP) | `GET /api/ftp` (nunca devolve senhas); `POST /api/ftp/save`, `/remove`, `/test`, `/plan` (prévia), `/baseline`, `/publish` (`id`, `confirmFirst`, `deleteRemoved`) |
| Backup agendado | `POST /api/backup/schedule`, `/api/backup/run-all` |
| PHP | `GET /api/php/available`, `/api/php/ini`; `POST /api/php/ext`, `/api/php/settings`, `/api/php/ini-raw`, `/api/php/ini-restore` |
| Diagnóstico | `GET /api/doctor`; `POST /api/doctor/fix` |
| Atualizações | `GET /api/updates` (cache de 10 min; `?fresh=1` força; devolve `items`, `errors`, `app` e `checkedAt`); `POST /api/updates/apply` (`id`); `POST /api/updates/app` (baixa o instalador da última release, confere o SHA-256 e o abre). `GET /api/state` traz `updates.pending` (selo do menu) |
| Inicialização | `GET/POST /api/autostart` |
| Encerramento | `POST /api/quit` (desliga serviços e fecha o painel; usado pela bandeja e pelo instalador) |
| Configuração | `GET /api/config/export`; `POST /api/config/import`; `GET /api/mcp-config` |
| Ajuda | `GET /api/docs` (lista), `GET /api/docs/read?name=<arquivo>.md` |

## Servidor MCP (agentes de IA)

Protocolo MCP via stdio (JSON-RPC por linhas). Arquivo: `mcp.js`.

**Conectar:** em *Configurações → Conectar agentes de IA* copie o comando do Claude Code:

```
claude mcp add rdr-local -- node "E:\Servrdr2\rdr-local\mcp.js"
```

ou o JSON para Claude Desktop/Cursor. Há também o JSON "com terminal liberado" (define `RDR_MCP_ALLOW_SHELL=1`).

| Ferramenta | Tipo | O que faz |
|---|---|---|
| `rdr_status` | leitura | Estado dos serviços e portas |
| `rdr_sites` | leitura | Sites cadastrados |
| `rdr_doctor` | leitura | Diagnóstico |
| `rdr_logs` | leitura | Últimas linhas de um log (`web`, `mariadb`, `postgres`, `redis`, `mailpit`, `meilisearch`, `php-<versão>`, `site:<domínio>`) |
| `rdr_databases` | leitura | Bancos e tamanhos |
| `rdr_jobs` | leitura | Tarefas recentes |
| `rdr_service` | ação | Liga/desliga/reinicia serviço |
| `rdr_create_database` | ação | Cria banco |
| `rdr_backup_now` | ação | Backup de todos os bancos |
| `rdr_artisan` | ação | Comandos seguros no projeto: migrate, clear, storage-link, composer install |
| `rdr_terminal` | ação | Um comando no terminal do projeto — **só** com `RDR_MCP_ALLOW_SHELL=1` |

Nenhuma ferramenta apaga bancos, sites ou arquivos.

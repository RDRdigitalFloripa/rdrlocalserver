# SDD — Software Design Document

**Produto:** RDR Local Server v1.11.0

## 1. Visão geral da arquitetura

```
Navegador ──► Painel (Node, 127.0.0.1:7070) ──► lib/* ──► processos filhos
   │                    │                                   ├─ Caddy (80/443, admin 127.0.0.1:20190)
   │                    │                                   ├─ php-cgi (workers por versão, portas 9100+)
   │                    │                                   ├─ MariaDB / PostgreSQL / Redis
   │                    │                                   ├─ Mailpit / Meilisearch / cloudflared
   │                    │                                   └─ DNS UDP (opcional)
   └── https://site.test ──► Caddy ──► php_fastcgi | reverse_proxy | redir
```

Um único processo Node (`server.js`, sem dependências npm) serve a interface estática de `public/`, expõe uma API JSON e supervisiona os serviços. O Caddy gera o certificado de cada site com `tls internal` (CA local).

## 2. Módulos (`lib/`)

| Módulo | Responsabilidade |
|---|---|
| `core.js` | Configuração (`config.json`), caminhos, log do painel, sistema de *jobs* com log consultável |
| `services.js` | Definição e ciclo de vida dos serviços (start/stop/status), workers PHP por versão |
| `sites.js` | Modelo de site, geração do Caddyfile (php, proxy, redirect, CORS, env), hosts, aliases |
| `components.js` | Download/instalação de componentes, shims, `php.ini` base, consulta de versões |
| `projects.js` | Criação de Laravel/WordPress/pasta PHP, `.env`, banco e migrate |
| `db.js` | Listagem/criação/exclusão de bancos, backup/restauração, conexão |
| `cloud.js` | Backup na nuvem via rclone: destinos, criptografia (crypt), envio (`copy`), retenção protegida, teste de restauração; `quickDrive()` (Google Drive em um clique: instala o rclone, autoriza, define o destino, criptografa e testa) e `cancel()` (encerra o rclone em andamento) |
| `notify.js` / `secrets.js` | Avisos (Telegram/webhook) e armazenamento de segredos em `config/secrets.json` (restrito ao usuário) |
| `backup.js` | Agendador (tick de 60 s), retenção, execução de backup de todos os bancos |
| `runtimes.js` | Node.js/Python/Go/Java gerenciados: versões disponíveis (nodejs.org, python-build-standalone), instalar, padrão, remover, PATH por projeto |
| `apps.js` | Supervisor de apps: spawn com `PORT`, religamento com limite, log, detecção, `npm install`/venv+pip, modelos |
| `procs.js` | Processos por site: queue, schedule, vite, túnel |
| `term.js` | Terminal: execução de um comando por vez, saída por *polling* |
| `doctor.js` | Verificações e correções do Diagnóstico |
| `phpini.js` | Editor de php.ini com validação (probe do PHP) e backup |
| `dns.js` | Responder DNS UDP e regra NRPT do Windows |
| `autostart.js` | Tarefa agendada do Windows (`Register-ScheduledTask`) |
| `github.js` | Device Flow/token (DPAPI), repositórios, clonar, estado do Git (`--porcelain=v2`), `pull --ff-only`, repositório removido, último build do Actions |
| `importer.js` / `dbimport.js` | Leitura de vhosts nginx/Apache (ServBay/Laragon/XAMPP) e importação de bancos de outro MySQL/MariaDB com ajuste de collations |
| `deploy.js` | Servidores SSH, chaves cifradas, known_hosts próprio, receitas (modelo Swarm), pré-verificação e publicação |
| `ftp.js` | Publicação FTP/FTPS (curl.exe) e SFTP (sftp.exe): manifesto SHA-1, prévia, exclusões, `.env` nunca enviado |
| `updates.js` | Verificação (componentes, linguagens, Composer, phpMyAdmin e o próprio app), cache de 10 min, verificação automática a cada 6 h (`startAuto`), resumo sem rede para o selo (`summary`) e aplicação |
| `appupdate.js` | Atualização do próprio RDR Local: última release do GitHub, download, SHA-256 e abertura do instalador |
| `aifiles.js` | `CLAUDE.md`, `AGENTS.md` e `docs/` em projetos novos (nunca sobrescreve; desligável) |
| `rdrfile.js` | `rdr.json` do projeto: valida (`plan`), aplica (`apply`: serviços, banco, `.env`, site) e gera a partir de um site (`exportSite`) |
| `scripts.js` | Scripts do `composer.json`/`package.json` (lista, valida e roda com timeout) e auditoria (`composer audit --locked`, `npm audit --omit=dev`) |
| `envfile.js` | `.env` × `.env.example`: comparar, criar, adicionar faltantes e editar uma chave; nunca devolve valor sensível; `.env.backup` antes de gravar |
| `plan.js` | Plano do projeto: lê `…-tarefas.md` e `…-diario.md` de `docs/`, calcula progresso e fase atual, troca o estado de uma tarefa, adiciona tarefa/fase e anotação do diário com edições mínimas |
| `smtp.js` | Cliente SMTP mínimo (net/tls): DNS, conexão, SSL/TLS ou STARTTLS, AUTH PLAIN/LOGIN, envio de UM e-mail de teste; etapas com tempo e `explain()` (erro → mensagem e dica em português) |
| `mail.js` | Perfil SMTP (`cfg.smtp` + senha em `secrets.json`), validação, limite de testes, teste com os valores do formulário e "usar no projeto" (`MAIL_*` no `.env` via `envfile.setMany`) |
| `devtools.js` | Editores instalados, link do `origin` (do `.git/config`), terminal com `claude` e `launch()` (abre programa com argumentos sem passar a pasta por shell) |
| `sysinfo.js` | Métricas de CPU, memória e disco |

Fora de `lib/`: `rdr.js` (CLI), `mcp.js` (servidor MCP stdio), `start.bat` (modo desenvolvimento) e `start-silent.vbs` (gerado em execução).

## 2.1 Instalação e execução em segundo plano

```
Atalho ──► wscript open.vbs ──► schtasks /Run "RDR Local Start" (elevado, sem UAC)
                                   └─► launcher.vbs ──► powershell tray.ps1 (oculto)
                                         ├─ ícone da bandeja (NotifyIcon) + menu
                                         ├─ vigia (timer 6 s): religa o painel se cair
                                         └─ cmd /c node.exe server.js --no-open  (RDR_HOME=C:\ProgramData\RDRLocal)
```

- Instalador NSIS (`installer/rdr-local.nsi`, gerado por `installer/build.sh`): programa em `Program Files\RDR Local\{app,runtime,launcher}`, Node.js LTS embutido, dados em `ProgramData\RDRLocal` (sobrevivem a atualizações).
- `server.js` separa **código** (`P.app`) de **dados** (`P.root` = `RDR_HOME`).
- Tarefas agendadas: `RDR Local Start` (sob demanda, usada pelos atalhos) e `RDR Local` (no logon, opcional; liga/desliga em Configurações → Inicialização).
- Release: a tag `vX.Y.Z` aciona `.github/workflows/release.yml` (Ubuntu + `nsis` + `python3-pil`): confere tag × `package.json` × rodapé do painel × seção do `CHANGELOG.md`, checa a sintaxe, roda `installer/build.sh`, valida o `.exe` (cabeçalho MZ, tamanho, SHA-256) e publica a release com `RDR-Local-Setup-<versão>.exe` e `.sha256`. As actions de terceiros são oficiais e fixadas por commit. A execução manual só gera o instalador (artefato de 7 dias). Passo a passo em `RELEASING.md`.
- Encerramento limpo: `POST /api/quit` aciona o `shutdown()` (para processos do site e serviços); `stop.ps1` o usa na atualização e na desinstalação.
- Instância única da bandeja por mutex `Global\RDRLocalTray`; um segundo lançamento só abre o painel.

## 3. Modelo de dados

Persistência em `config/config.json` (texto puro). Campos principais:

```json
{
  "v": 2, "tld": "test", "projectsRoot": "E:\\www", "phpDefault": "8.4",
  "ports": { "http": 80, "https": 443, "mariadb": 3307, "postgres": 5433,
             "redis": 6380, "mailpitSmtp": 1026, "mailpitUi": 8026, "meilisearch": 7710 },
  "autoStartServices": false, "dnsMode": false, "projectDocs": true, "autoCheckUpdates": true,
  "github": { "clientId": "", "privateRepos": false },
  "servers": [], "sshKeys": [], "recipes": [], "ftpTargets": [],
  "backup": { "enabled": false, "freq": "daily", "time": "03:00", "keep": 7, "last": 0, "lastMsg": "" },
  "sites": [ { "domain": "app.test", "type": "php", "path": "...", "php": "8.4",
               "aliases": [], "env": {}, "cors": false, "target": "" } ]
}
```

`type` ∈ `php` | `proxy` | `redirect` | `app`. Sites de rede (`proxy`/`redirect`) não têm `path` nem PHP. Um `app` tem `path`, `runtime` (`node`|`python`|`go`|`java`|`custom`), `rtVersion`, `cmd` (aceita `{PORT}`), `appPort` (9300-9999), `autoStart`, `env` e `cors`; o Caddy gera `reverse_proxy 127.0.0.1:<appPort>`.

## 4. Fluxos principais

**Subir o Servidor Web:** gera o Caddyfile a partir dos sites → atualiza o hosts → garante a CA → inicia workers PHP (um grupo por versão em uso) → inicia o Caddy.

**Criar projeto Laravel:** *job* com bloqueio → `composer create-project` → ajusta `.env` → cria banco (inicia o motor se preciso) → `artisan migrate` → registra o site → recarrega o Caddy.

**Editar php.ini:** guarda baseline de avisos do PHP → grava candidato → roda sonda `php -c <dir> -r 'echo "RDR_OK";'` → aceita só se não surgirem avisos novos → mantém `.bak` → reinicia workers.

**Backup agendado:** `setInterval` de 60 s verifica `isDue` → executa para cada banco → nomeia com sufixo `-auto` → poda só os `-auto` além de `keep` → grava `last`/`lastMsg`. Ao abrir o painel, recupera horário perdido.

**Túnel:** inicia `cloudflared` como processo do site; a URL é extraída do log por regex `https://*.trycloudflare.com`.

**Subir um app:** com o Servidor Web ativo, `apps.startAll()` percorre os sites `app` ativos → checa runtime e porta livre → `spawn` (shell, grupo de processos próprio) com PATH do runtime/`.venv` + `PORT`/`HOST` + `env` do site → log em `logs/app-<id>.log`. Se sair sem pedido de parada, religa em 1,5 s; mais de 4 saídas em 60 s → `gaveUp`.

**Runtimes:** `runtimes.install` baixa o zip do Node (ou o tar.gz do Python), extrai com `tar` para `bin/<linguagem>/<major[.minor]>/` e grava `.version`. A versão padrão fica em `cfg.runtimeDefault`. A atualização (patch) para os apps, reinstala e religa.

**Backup na nuvem:** `runAll()` (backup agendado) → `cloud.sync()` → `rclone copy` dos dumps (`db/`), da configuração sem segredos (`config/`) e, se ligado, de `.env` + `storage/app` dos projetos (`projects/<domínio>/`), por filtros explícitos. Com criptografia, o destino efetivo é o remote `crypt` sobre `<pasta>/encrypted`; o sal vem da própria senha (scrypt), então a mesma senha reabre os backups em outro PC. A retenção remota só apaga se houver backup recente (`lsjson --max-age`). O resultado vai para `cfg.cloud.last*` e, em falha, para `notify.event`.

**Publicar (receita):** `precheck` (identidade do servidor, commits não enviados, build do Actions) → prévia dos comandos → `publish`: cada passo roda por `ssh` (chave temporária 0600, `StrictHostKeyChecking=yes`, known_hosts próprio), para no primeiro erro, grava `last` e avisa por Telegram/webhook. **Reverter** roda `rollback` da receita (no Swarm, `docker service rollback` por serviço) pelo mesmo caminho.

**Publicar (FTP/SFTP):** varredura local (exclusões + `.env` nunca) → hash SHA-1 → comparação com o manifesto em `data/ftp/<id>.json` → prévia (novos/alterados/removidos) → envio em lotes de 40 → manifesto gravado a cada lote → exclusão remota só com confirmação. A senha FTP vai ao curl por stdin (`-K -`).

**Painel por nome:** o Caddy publica `rdr-local-server.<tld>` com `reverse_proxy` para o painel (somente `remote_ip` local).

**Projeto novo:** ao final da criação (Laravel, WordPress, pasta PHP: `projects.js`; app em pasta nova ou de modelo: `POST /api/apps/new`), `aifiles.scaffold()` grava `CLAUDE.md` e `AGENTS.md` (mesmo texto) e, se a `docs/` estiver vazia, `docs/01-DD-MM-AAAA-visao-geral.md`, mais os três arquivos do plano (`planFiles()`: especificação, tarefas e diário, com o próximo número livre). Roda **depois** de `composer create-project`, do modelo e do `unzip` do Spring (que recria a pasta), nunca sobrescreve e não derruba a criação se falhar (só registra no log). Não roda em clonagem do GitHub, importação nem "pasta que já tem um app", para não sujar a árvore do Git (o `pull --ff-only` recusa árvore suja). Nos sites PHP o Caddy responde 404 a `/docs/*`, `/CLAUDE.md` e `/AGENTS.md` só quando o arquivo existe na pasta pública (`file` matcher), para não quebrar rotas como `/docs` do Laravel.

**Aplicar rdr.json:** `rdrfile.plan()` lê e valida o arquivo (limite de 50 KB, campos conhecidos, `sites.clean()` para domínio, aliases, PHP, env e porta) e devolve os passos, avisos e erros sem tocar em nada. `apply()` (tarefa `rdrfile`) liga os serviços instalados, cria o banco se `db.list()` não o tiver, cria ou atualiza o site daquela pasta (`cfg.sites` por `path`, então repetir não duplica), ajusta o `.env` existente com `projects.patchEnv` e, em `type: "app"`, inicia o app. O `app.cmd` só roda com `confirmCmd` (UI: confirmação; CLI `rdr up`: `--yes`). `exportSite()` deduz banco, Redis e Mailpit do `.env` mas não grava `env` nem valores do `.env`. O Caddy não serve `/rdr.json` quando existe na pasta pública.

**Ferramentas do projeto:** `GET /api/dev/info` devolve editores, link do repositório, `claude`, scripts e o resumo do `.env`. `scripts.resolve()` só aceita nome que **existe** no arquivo e passa em `NAME_RE` (`^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$`), exclui eventos do Composer e ciclos de vida do npm e recusa scripts que não terminam (heurística `LONG_RE`); `POST /api/scripts/run` responde 400 na hora e roda como tarefa `scripts:<site>` (uma por site), com limite de 10 min (`killTree`). A auditoria roda `composer audit --locked --format=json` e `npm audit --json --omit=dev`, interpreta o JSON e devolve `{found, state}`: achados e verificação falha terminam a tarefa em erro; só `skipped` (sem lock) conclui verde, dizendo que nada foi auditado. `envfile.js` mascara chaves que casam `SECRET_RE` (nunca saem na API), troca só a primeira linha da chave (comentários não contam), copia o valor do exemplo cru ao adicionar faltantes e preserva LF/CRLF. `devtools.launch()` entrega o executável e os argumentos ao PowerShell por variáveis de ambiente (uma pasta com `&` ou espaço não vira comando) e dobra a barra invertida final; não usa `detached`, com o qual o PowerShell sai sem abrir o programa.

**Plano do projeto:** a fonte da verdade são arquivos de `docs/` achados por `aifiles.planFound()` (final do nome: `-especificacao.md`, `-tarefas.md`, `-diario.md`, com ou sem número e data). `plan.parseTasks()` lê fases (`##`) e tarefas (`- [ ]`, `[~]`, `[x]`/`[X]`, `[-]`, aninhadas), ignorando blocos de código; `parseDiary()` lê seções `## DD/MM/AAAA` (outro título encerra o dia). `setState()` troca **um caractere** e só se a linha ainda for a tarefa que o painel viu (`line` + texto esperado): se o agente editou o arquivo no meio do caminho, recusa. `addTask()` insere depois da última tarefa da fase (fase nova entra antes de *Descobertas*) e `addDiary()` acrescenta sob a seção de hoje; ambos preservam LF/CRLF. `plan.init()` cria o que falta (próximo número livre, data de hoje) e `aifiles.addFlow()` acrescenta a seção *Fluxo de trabalho* (marcada por `<!-- rdr:fluxo -->`, uma vez só) ao `CLAUDE.md`/`AGENTS.md`. Projetos novos recebem tudo em `aifiles.scaffold()`. O Painel consulta `GET /api/plan/overview` a cada 10 s.

**SMTP real:** `smtp.test()` abre a conexão (`net` ou `tls` para SSL/TLS), lê as respostas multilinha, faz `EHLO`, `STARTTLS` (o socket é promovido com `tls.connect({ socket })`, com `host`/`servername` para conferir o certificado, a menos que `insecureTls`), `AUTH PLAIN` ou `AUTH LOGIN` e, no modo envio, `MAIL FROM`, `RCPT TO` e `DATA`. A mensagem é `text/plain` UTF-8 em base64 (corpo nunca "fecha" o DATA), com assunto e nome codificados (RFC 2047) e o nome do remetente saneado contra injeção de cabeçalho. Recusa usuário/senha sem criptografia fora de `localhost`. A senha só existe em memória durante o teste e nunca entra nas etapas. `mail.run()` valida o formulário sem gravar, usa a senha digitada ou a salva e aplica o limite de 10 envios/hora e o intervalo mínimo de 3 s. Segredos usam `secrets.setProtected` (DPAPI); `core.js` remove o `PSModulePath` herdado para o PowerShell 5.1 carregar o módulo de segurança mesmo quando o painel é aberto de um PowerShell 7.

**Atualizar o RDR Local:** `updates.check()` consulta `releases/latest` do repositório (`appupdate.REPO`); 404 = sem release/privado = "em dia". `POST /api/updates/app` (tarefa) baixa `RDR-Local-Setup-<versão>.exe` e o `.sha256` da mesma release, aceita só URLs `https://github.com/<repo>/releases/download/…`, compara o SHA-256 e abre o instalador com `cmd /c start` (UAC se preciso). Não instala em silêncio; o instalador encerra o programa antigo (`stop.ps1`) e mantém os dados. O instalador ainda não tem assinatura digital: o SmartScreen pode avisar. Exige repositório público (a consulta não usa token).

## 5. API HTTP

Todas as rotas sob `/api/`, JSON. Resumo em *Referência: CLI, API e MCP*.

## 6. Segurança

1. Escuta apenas em 127.0.0.1.
2. `Host` aceito: `127.0.0.1:porta`, `localhost:porta` e exatamente `rdr-local-server.<tld>` (com a porta HTTPS se não for 443); outro → 403 (anti DNS-rebinding).
3. POST sem `X-RDR: 1` → 403 (anti-CSRF; um site malicioso não consegue enviar o cabeçalho customizado sem preflight).
4. Corpo limitado a 100 KB; nomes de banco restritos a letras/números/`_`.
5. Arquivos estáticos protegidos contra *path traversal*; a Ajuda lê apenas arquivos `.md` da pasta `docs/`.
6. Caddy bloqueia `/.env`, `/.git`, `/storage/logs` e, se existirem na pasta pública, `/docs/*`, `/CLAUDE.md`, `/AGENTS.md`; Adminer/phpMyAdmin só para 127.0.0.1.
7. MCP sem ferramentas destrutivas; terminal só com `RDR_MCP_ALLOW_SHELL=1`.
8. Publicar: só executa comandos de receitas; chaves SSH e senhas FTP cifradas com DPAPI; impressão digital do servidor confirmada pelo usuário; `.env` nunca enviado por FTP; exclusão remota só com confirmação.
9. Limitações conhecidas: sem autenticação no painel (confia na máquina), segredos de env em texto puro, bancos sem senha (apenas localhost).

## 7. Decisões de projeto

| Decisão | Motivo |
|---|---|
| Node sem dependências | Instalação trivial e superfície de supply-chain mínima |
| Caddy com `tls internal` | HTTPS automático por site sem OpenSSL manual |
| Workers php-cgi por versão | Várias versões de PHP simultâneas no Windows |
| Portas alternativas de bancos | Conviver com ServBay/XAMPP |
| MinIO fora | Edição comunitária só tem código-fonte |
| Sem atualização automática de bancos | Proteger dados do usuário |
| SSH/SFTP pelo cliente OpenSSH do Windows | Reaproveita known_hosts estrito e chaves; sem dependências npm |
| Sem terminal livre em Publicar | Reduz o dano se o painel for abusado: só roda o que está cadastrado |
| Agendador interno (não tarefa do SO) | Simplicidade; roda quando o painel está aberto |

## 8. Testes e validação

Validado em Linux (sandbox): Caddyfile com binário real do Caddy, php.ini com PHP real, DNS, túnel (cloudflared simulado), backups, CLI, MCP, exportar/importar e fluxo de atualizações (stubs), interface via Playwright.
Publicar foi validado em Linux com sshd real, mock da API do Actions e servidor FTP/SFTP reais.
**Validar no Windows a cada versão:** NRPT/DNS, tarefa agendada, downloads reais, variáveis de ambiente no `php-cgi`, DPAPI, `icacls`, OpenSSH, `curl.exe`, FTPS com TLS real.

## 9. Extensão

Para adicionar um serviço: definir em `services.js` (comando, porta, log), incluir na instalação em `components.js`, na `DEFAULTS.ports` (`core.js`) e na interface. Para adicionar documentação: criar um `.md` em `docs/` (o prefixo numérico define a ordem).

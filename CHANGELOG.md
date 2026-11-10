# Changelog

## 1.14.0
- **Tailwind CSS já na criação do site:** o diálogo *Novo site* ganhou o campo **Tailwind CSS**.
  - **Laravel:** "Instalar e compilar agora" (padrão) roda `npm install` e `npm run build`; o esqueleto do Laravel 12+ já traz o Tailwind 4 e o Vite. Se faltar o Node.js 20.19+ (ou 22.12+), o painel baixa o LTS mais novo sozinho. Com starter kit o campo some (o kit já traz o Tailwind). Se o npm falhar, o site nasce do mesmo jeito e o log diz o que rodar depois; um Laravel mais antigo (PHP anterior ao 8.2), cujo esqueleto não traz o Tailwind, recebe um aviso claro.
  - **Pasta PHP vazia:** *Nenhum* (padrão), **compilador independente** (sem Node.js) ou **Vite** (usa Node.js). A pasta nasce com `src/input.css` (`@import "tailwindcss";`) e um `public/index.php` de exemplo já estilizado, e o CSS já sai compilado. O site abre a pasta `public/`, então `src/`, `package.json` e `node_modules` não ficam expostos.
- **Novo componente "Tailwind CSS" (opcional, ~110 MB):** o compilador independente oficial da Tailwind Labs, série 4.x, baixado do GitHub. Só é instalado se o SHA-256 bater com o publicado (o `digest` do GitHub e o `sha256sums.txt` da release, que precisam concordar) e se o `.exe` executar. O comando `tailwindcss` passa a funcionar no Terminal do site.
- **Processo "Tailwind" em Processos:** recompila o CSS ao salvar (`--watch=always`) nos projetos criados com o compilador independente.
- **Node.js garantido também para os starter kits:** criar um Laravel com kit (Livewire, React, Vue ou Breeze) agora baixa o Node.js LTS sozinho se faltar, em vez de falhar no `npm install`.
- **CLAUDE.md e AGENTS.md dos projetos com Tailwind** dizem como compilar e avisam que o Tailwind 4 não usa `tailwind.config.js` nem `@tailwind base`.
- **API:** `POST /api/project` aceita `tailwind` (`install` ou `none` no Laravel; `none`, `cli` ou `vite` na pasta PHP). Sem o campo, nada muda; valor inválido é recusado antes de criar qualquer coisa.

## 1.13.0
- **pgvector (busca vetorial no PostgreSQL):** novo componente opcional em *Componentes e PHP*, para guardar e buscar embeddings de IA no próprio PostgreSQL (`CREATE EXTENSION vector`, distâncias L2/cosseno/produto interno e índices HNSW e IVFFlat). O autor do pgvector não publica binários para Windows, então o RDR Local os compila: o workflow `pgvector.yml` baixa o código da tag **fixada pelo commit**, compila com o Visual C++ contra o mesmo zip do PostgreSQL da EDB que o painel instala (16 e 17), **testa de verdade** (sobe o PostgreSQL, cria a extensão, consulta e cria um índice) e publica numa release própria, sem ser a "latest" do app. O **SHA-256 de cada zip fica gravado no código** e é conferido antes de usar; só são copiados `vector.dll`, `vector.control`, os scripts `vector--*.sql` e a licença (nada mais, mesmo que o zip traga). Exige o PostgreSQL instalado, da mesma versão principal; reinstalar o PostgreSQL reinstala o pgvector junto; não precisa reiniciar o serviço.
- **Ativar pgvector por banco:** na lista de bancos do PostgreSQL, bancos com a extensão mostram a marca `pgvector <versão>` e os demais ganham o botão **Ativar pgvector**. Também há a rota `POST /api/db/vector`.
- **Restaurar backup que usa o pgvector:** se o arquivo `.sql` tem `CREATE EXTENSION vector` e a extensão não está instalada, a restauração é recusada **antes** de apagar ou alterar qualquer banco, com a explicação do que instalar.
- Correção no texto da versão 1.12.0 abaixo: o caminho da cópia de segurança do Meilisearch aparecia sem as barras (`data\meilisearch\backup-<versão>-<data>`).

## 1.12.0
- **Modo escuro com escolha:** três botões no pé do menu lateral (☀ Claro, ◐ Automático, ☾ Escuro). **Automático** segue o tema do Windows e muda na hora quando ele muda; a escolha fica lembrada neste navegador e a tela já abre no tema certo, sem piscar em claro. O tema escuro ficou mais confortável para horas de trabalho: texto um pouco abaixo do branco puro, fundo azul-grafite (contraste de 6,4 a 14,3:1) e as barras de rolagem, campos e diálogos nativos também escurecem.
- **Meilisearch não iniciava depois de atualizar** ("Your database version (1.55.0) is incompatible with your current engine version (1.56.2)"): o Meilisearch não abre o banco de uma versão menor anterior. Agora, ao iniciar, o RDR Local compara a versão do banco (`data.ms/VERSION`) com a do programa; se o banco é mais antigo, faz uma **cópia de segurança** em `data\meilisearch\backup-<versão>-<data>` (mantém as 2 mais novas) e inicia com `--upgrade-db`. Se o banco for mais novo que o programa, recusa com a explicação em vez de falhar no log. Basta iniciar o serviço de novo.
- **Botão Pasta (abrir a pasta do site) parecia não fazer nada:** o Explorer abria a janela, mas atrás do navegador (o painel não é o programa em primeiro plano), só piscando na barra de tarefas. Agora a janela vem para a frente, inclusive quando a pasta já estava aberta e se estava minimizada; nomes com espaço, `&` e parênteses funcionam, e uma pasta que não existe mais mostra o erro em vez de abrir os Documentos.

## 1.11.0
- **Ferramentas do projeto** (novo ícone de ajustes na linha de cada site com pasta):
  - **Scripts:** lista os scripts do `composer.json` e do `package.json` e roda cada um com um clique, com o PHP e o Node do site, e a saída no log da tarefa. Só roda scripts que existem no arquivo; eventos do Composer e ciclos de vida do npm não viram botão; scripts que não terminam (`dev`, `watch`, `serve`) são marcados e não rodam aqui; limite de 10 minutos.
  - **Auditoria de segurança:** `composer audit --locked` e `npm audit --omit=dev`. Achados terminam a tarefa em erro; auditoria que não conseguiu rodar termina como "incompleta", nunca como "sem achados".
  - **.env:** compara com o `.env.example` (faltando, só no .env, para preencher), adiciona as faltantes, edita uma variável e cria o `.env` a partir do exemplo. Valores sensíveis nunca voltam pela API. Guarda `.env.backup` antes de cada alteração e preserva LF/CRLF.
  - **Atalhos:** abrir no VS Code, Cursor ou PhpStorm, link do repositório no GitHub (sem usuário/token da URL) e terminal com o Claude Code na pasta do projeto.
  - Guia em `docs/15-ferramentas-do-projeto.md`.
- **Plano do projeto (desenvolvimento guiado por especificação):** especificação, tarefas e diário em arquivos de `docs/` (padrão `NN-DD-MM-AAAA-nome.md`, versionados no Git), editados pelo painel **e** pelos agentes de IA. Projetos novos já nascem com os três arquivos; nos existentes, a aba **Plano** (Ferramentas do projeto) tem **Ativar plano**, que cria só o que falta. O **Painel** ganha o cartão *Plano dos projetos* (progresso, fase atual, tarefas em andamento e última anotação do diário). O `CLAUDE.md` e o `AGENTS.md` ganham a seção *Fluxo de trabalho* (ler a especificação, uma tarefa por vez, `[~]`/`[x]` só com verificação, Descobertas, diário). O painel faz edições mínimas e recusa mudar uma tarefa se o arquivo foi alterado no meio do caminho. Guia em `docs/16-plano-do-projeto.md`.
- **Google Drive em um clique** (Backup na nuvem): um cartão no topo da página instala o rclone se faltar (SHA-256 conferido), abre o navegador para autorizar, define o Drive como destino com envio automático, liga a criptografia (se você der uma senha) e testa a escrita. Tudo é validado antes de instalar ou abrir o navegador; destino já existente reaproveita a autorização; aparece o link de reserva da autorização e o botão **Cancelar a autorização** (antes, uma autorização esquecida travava a tela por 5 minutos). Cancelar, expirar ou recusar não deixa um destino pela metade no `rclone.conf`. O teste final que falha termina a tarefa em erro. Guia atualizado em `docs/09-backup-na-nuvem.md`.
- **E-mail: SMTP real editável** (página E-mail): servidor, porta, segurança (STARTTLS, SSL/TLS ou nenhuma), usuário, senha, remetente, com sugestões de provedor (Gmail, Microsoft 365, SendGrid, Brevo, Mailgun, Amazon SES, Zoho, Hostinger). **Testar conexão** (sem enviar) e **Enviar e-mail de teste** mostram cada etapa com o tempo (DNS, TCP, TLS, STARTTLS, login, remetente, destinatário) e, se falhar, explicam em português o motivo e o que conferir. Cliente SMTP próprio, sem dependências. A senha fica em `config/secrets.json` protegida pelo Windows (nunca no `config.json`, na exportação nem na tela); não envia usuário/senha sem criptografia para servidor remoto; limite de 10 testes por hora. "Usar nos projetos" grava `MAIL_*` no `.env` de um site (ou volta ao Mailpit) com um único `.env.backup`. Guia em `docs/17-email-e-smtp.md`.
- **Gráfico de rede no Painel:** novo cartão *Rede* ao lado de Processamento, Memória e Disco, com download (↓) e upload (↑) em tempo real, histórico de 2 minutos e totais desde que a rede subiu. Lê os contadores do sistema (`netstat -e` no Windows, `/proc/net/dev` no Linux) só enquanto o painel está aberto, trata a volta do contador de 32 bits e a reconexão do adaptador sem inventar picos e mostra "Indisponível neste sistema" se não houver leitura. `GET /api/host-status` devolve o campo `net`.
- **Suíte de testes automáticos e CI:** `tests/` (só Node.js) com 12 arquivos e cerca de 300 verificações, todas isoladas dos seus dados (`npm test`; `npm run test:full` inclui internet). O fluxo `.github/workflows/ci.yml` roda a suíte no Windows a cada push e pull request. Guia em `TESTING.md`.
- Correção: o teste de conexão SMTP dizia "aceitou a conexão e o login" quando a segurança era "Nenhuma", o usuário estava preenchido e o servidor só libera o login depois do STARTTLS (caso do Gmail na porta 587): nenhum login acontecia. Agora o teste falha explicando que é preciso escolher STARTTLS, e a mensagem final só fala em login quando houve login.
- Correção: instalar componentes falhava com "tar: Cannot connect to C: resolve failed" quando o `tar` do `PATH` era o GNU tar do Git for Windows. O RDR Local passa a usar o `tar.exe` do próprio Windows.
- Correção: quando o painel era aberto a partir de um PowerShell 7, a proteção dos segredos (token do GitHub, senha do SMTP) falhava com "não consegui proteger o segredo com o Windows", pois o `PSModulePath` herdado impedia o PowerShell 5.1 de carregar o módulo de segurança. O painel agora tira essa variável ao iniciar (só no Windows), o que também vale para a tarefa agendada, o DNS local e o Diagnóstico.

## 1.10.0
- Projetos novos (Laravel, WordPress, pasta PHP e apps criados a partir de modelo ou em pasta nova) já nascem com `CLAUDE.md`, `AGENTS.md` e a pasta `docs/`. Os dois arquivos trazem a regra "Sempre forneça as respostas em português do Brasil", a orientação do padrão de nome dos documentos (`NN-DD-MM-AAAA-nome.md`, ex.: `01-10-10-2026-arquivo.md`) e os dados do ambiente local (endereço, banco, e-mail de teste). A `docs/` recebe `01-DD-MM-AAAA-visao-geral.md`. Nunca sobrescreve arquivo existente; não mexe em clonados, importados nem em "pasta que já tem um app". Desligável em Configurações.
- O Caddy não serve `/docs/*`, `/CLAUDE.md` e `/AGENTS.md` quando esses arquivos existem na pasta pública (WordPress, pasta PHP, túnel público). Rotas de aplicação com esses caminhos (ex.: `/docs` do Laravel) continuam funcionando.
- Atualização do próprio RDR Local pelo painel (Componentes e PHP → Verificar atualizações): consulta a última release do GitHub, baixa o instalador, confere o SHA-256 publicado junto (`.sha256`) e abre o assistente. Recusa qualquer endereço fora de `github.com/…/releases/download`. Precisa de release com `RDR-Local-Setup-<versão>.exe` e `.sha256` em repositório público.
- Verificação automática de atualizações 30 s depois de abrir e a cada 6 horas (desligável em Configurações), com selo numérico em "Componentes e PHP". Não instala nada sozinha.
- A lista de atualizações passou a incluir Composer e phpMyAdmin.
- `rdr.json`: a configuração do projeto dentro do repositório (domínio, aliases, PHP, pasta pública, CORS, banco, serviços, variáveis e, para apps, o comando). Ícone novo na linha do site: **gera** o arquivo a partir do site (sem variáveis de ambiente nem segredos do `.env`) ou **aplica** o que já existe, com prévia. Novo comando `rdr up [pasta] [--yes]` para quem acabou de clonar. Aplicar de novo não duplica nada; o comando de um app exige confirmação; o Caddy não serve o arquivo. Guia em `docs/14-rdr-json.md`.
- Publicação de releases automatizada: a tag `vX.Y.Z` gera o instalador e o `.sha256` no GitHub Actions e publica a release (`.github/workflows/release.yml`, `RELEASING.md`). O `.sha256` agora leva só o nome do arquivo, então `sha256sum -c` funciona na pasta do download.

## 1.9.2
- Componentes e PHP → Linguagens: cada linguagem não instalada (Node, Python, Go, JDK) ganha uma linha com o botão "Instalar versão LTS" (antes o JDK só aparecia depois de "Ver versões disponíveis").
- Lista de versões do JDK agora mostra o erro real quando não consegue falar com api.adoptium.net, em vez de ficar vazia.

## 1.9.1
- Criar app (Java, Node, Python, Go): se a linguagem não estiver instalada, o RDR Local baixa a versão LTS mais nova sozinho dentro da tarefa de criação (antes só avisava para instalar em outra tela). Projeto Spring Boot passa a usar o JDK instalado como alvo (17, 21 ou 25).

## 1.9.0
- Publicar: botão **Reverter** (Swarm: `docker service rollback` por serviço; comandos de reversão próprios nas outras receitas), sempre com confirmação.
- Correção: receita Swarm sem passos extras dava erro ao salvar.

## 1.8.3
- Documentação atualizada (README, manual, instalação, PRD, SDD, API, solução de problemas, segurança, GitHub e Publicar).

## 1.8.2
- Instalador: a imagem lateral mostra a versão que está sendo instalada (antes aparecia sempre "v1.0"); gerada no build a partir de `installer/side-base.bmp` (precisa de Python + Pillow no build).

## 1.8.1
- Endereço amigável do painel: `https://rdr-local-server.<terminação>` (ex.: rdr-local-server.local), via servidor Web. `127.0.0.1:7070` continua funcionando. Aceita só esse nome exato no cabeçalho Host e só de 127.0.0.1.

## 1.8.0
- Publicar sites antigos por **FTP, FTPS ou SFTP**: envia só o que mudou, com prévia, `.env` sempre bloqueado, ponto de partida ("já está igual") e exclusão no servidor só com confirmação.

## 1.7.0
- Nova página **Publicar**: servidores SSH (cartões), chaves, impressão digital confirmada e receitas (modelo Docker Swarm com imagem do GHCR ou comandos próprios).
- Pré-verificação: status do build no GitHub Actions, commits não enviados e árvore suja; log do passo a passo.

## 1.6.0
- Importar bancos de outro servidor MySQL/MariaDB local (Bancos de dados → Importar de outro servidor), com conferência de tabelas e linhas.

## 1.5.1
- Janela de importação: layout ajustado (sem rolagem lateral, caminhos longos quebram linha).

## 1.5.0
- Importar de outro ambiente (ServBay, Laragon, XAMPP ou pasta/arquivo nginx/Apache): leitura, prévia e criação dos sites apontando para as mesmas pastas.

## 1.4.1
- GitHub: aviso "removido no GitHub?" nos sites cujo repositório não existe mais (ou sem acesso), com botão para remover só o site (a pasta não é apagada).

## 1.4.0
- GitHub: login por Device Flow ou token fine-grained (cifrado com DPAPI), lista de repositórios, clonar para um site, estado do Git na lista de sites, buscar/atualizar com `--ff-only`.
- Componente opcional Git (MinGit).

## 1.3.0
- Backup na nuvem com rclone (Drive, Dropbox, S3, pasta), criptografia opcional, retenção protegida, teste de restauração e avisos por Telegram/webhook.

## 1.2.1
- Indicadores do painel via `/api/host-status`; diagnóstico de portas 80/443 ocupadas (ex.: ServBay).

## 1.2.0
- Runtimes Go e Java; templates TypeScript, Vite, Next.js, Go e Spring.

## 1.0.0
- Primeira versão com instalador.

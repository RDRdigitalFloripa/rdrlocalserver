# Changelog

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

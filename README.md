# RDR Local Server

Ambiente local de hospedagem para Windows com HTTPS automático: sites PHP/Laravel, apps Node, Python, Go e Java, bancos, e-mail de teste, backups (inclusive na nuvem) e integração com GitHub, importação de outros ambientes e publicação em servidores, tudo em um painel em `http://127.0.0.1:7070` (ou `https://rdr-local-server.local`, com o servidor Web ligado). Zero dependências npm: o próprio Node.js vai embutido no instalador.

> Status: v1.10. Projeto da **RDR Digital**. Uso em desenvolvimento local; veja [SECURITY.md](SECURITY.md).

## O que faz

- **Sites**: PHP (Caddy + php-cgi), proxy reverso, redirecionamentos e apps supervisionados (Node, Python, Go, Java), cada um com domínio `.local`/`.test` e certificado HTTPS de uma CA local.
- **Serviços**: MariaDB, PostgreSQL, Redis, Mailpit, Adminer/phpMyAdmin, Meilisearch, Cloudflared.
- **Projetos**: templates (Laravel, Express/TS, Vite, Next.js, Go, Spring), terminal por site, filas/agendador. Todo projeto novo já vem com `CLAUDE.md`, `AGENTS.md` (respostas em português do Brasil) e a pasta `docs/` (documentos `NN-DD-MM-AAAA-nome.md`).
- **rdr.json**: o ambiente do projeto (domínio, PHP, banco, serviços) dentro do repositório; `git clone` + `rdr up` e o ambiente da equipe está pronto.
- **E-mail**: Mailpit para desenvolver e **SMTP real editável** para validar o envio de verdade (teste de conexão, e-mail de teste com as etapas e diagnóstico em português).
- **Plano do projeto**: especificação, tarefas e diário em `docs/`, editados por você e por agentes de IA, com o andamento no Painel (desenvolvimento guiado por especificação).
- **Ferramentas do projeto**: scripts do Composer/npm com um clique, auditoria de segurança, `.env` × `.env.example` e atalhos (editor, GitHub, Claude Code).
- **Atualizações**: componentes, linguagens, Composer, phpMyAdmin e o próprio RDR Local (instalador conferido por SHA-256), com verificação automática e selo no menu.
- **Backup**: bancos agendados, envio para Google Drive (em um clique)/Dropbox/S3/pasta com rclone, criptografia opcional e teste de restauração.
- **GitHub**: login por Device Flow ou token fine-grained, clonar para um site, estado do Git e atualização segura (`pull --ff-only`).
- **Importar**: sites e bancos de ServBay, Laragon, XAMPP ou de outro MySQL/MariaDB local, com prévia e conferência.
- **Publicar**: servidores SSH (chave + impressão digital), receitas para Docker Swarm com imagens do GHCR, verificação do build no GitHub Actions e publicação de sites antigos por FTP/FTPS/SFTP com prévia e `.env` nunca enviado.
- **Diagnóstico**: portas em conflito (ex.: ServBay), extensões do PHP, hosts, certificado.
- **Painel da máquina**: processamento, memória, disco e **rede** (download/upload em tempo real).

## Instalação

1. Baixe `RDR-Local-Setup-<versão>.exe` na página de *Releases* e confira o `.sha256`.
2. Execute como Administrador. Programa em `C:\Program Files\RDR Local`, dados em `C:\ProgramData\RDRLocal`.
3. Abra o painel, clique em **Instalar tudo** e depois em **Iniciar tudo**.

Guia completo: [docs/02-guia-de-instalacao.md](docs/02-guia-de-instalacao.md).

## Documentação

[docs/](docs/): manual, instalação, PRD, SDD, API/CLI/MCP, solução de problemas, segurança, linguagens, backup na nuvem, GitHub, importação e publicação.

## Desenvolvimento

```bash
node server.js                 # painel em http://127.0.0.1:7070 (modo desenvolvimento)
bash installer/build.sh        # gera o instalador (precisa de nsis, npm e python3 com Pillow); saída em installer/dist/
```

Variáveis úteis: `RDR_PORT`, `RDR_HOME`, `RDR_HOSTS`. Detalhes em [docs/02-guia-de-instalacao.md](docs/02-guia-de-instalacao.md).

Releases: a tag `vX.Y.Z` dispara o GitHub Actions, que gera o instalador e o `.sha256` e publica a release (é ela que o painel consulta para avisar de atualização). Passo a passo em [RELEASING.md](RELEASING.md).

## Segurança

O painel **não tem autenticação** e escuta só em `127.0.0.1`. Não o exponha na rede nem por túnel. Reporte vulnerabilidades como descrito em [SECURITY.md](SECURITY.md).

## Autoria e licença

Criado e mantido pela **RDR Digital** ([github.com/RDRdigitalFloripa](https://github.com/RDRdigitalFloripa)). O código é aberto sob a [Apache-2.0](LICENSE): você pode baixar, usar (inclusive em trabalho comercial), modificar e redistribuir, **desde que mantenha a atribuição**: entregue uma cópia do `LICENSE`, preserve os avisos de copyright e o arquivo [NOTICE](NOTICE) e indique o que alterou.

Ao publicar um fork ou trabalho derivado, pedimos que cite a origem, por exemplo: *"Baseado no RDR Local Server, da RDR Digital: https://github.com/RDRdigitalFloripa/rdrlocalserver"*.

O nome e o logotipo "RDR" **não** estão incluídos na licença ([TRADEMARK.md](TRADEMARK.md)). Os componentes de terceiros baixados em tempo de execução mantêm suas próprias licenças ([NOTICE](NOTICE)); a licença do Node.js embutido no instalador está em [licenses/Node.js-LICENSE.txt](licenses/Node.js-LICENSE.txt). Resumo em linguagem simples: [docs/13-sobre-e-licenca.md](docs/13-sobre-e-licenca.md).

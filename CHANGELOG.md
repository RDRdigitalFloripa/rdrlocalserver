# Changelog

## 1.10.0
- Projetos novos (Laravel, WordPress, pasta PHP e apps criados a partir de modelo ou em pasta nova) já nascem com `CLAUDE.md`, `AGENTS.md` e a pasta `docs/`. Os dois arquivos trazem a regra "Sempre forneça as respostas em português do Brasil", a orientação do padrão de nome dos documentos (`NN-DD-MM-AAAA-nome.md`, ex.: `01-10-10-2026-arquivo.md`) e os dados do ambiente local (endereço, banco, e-mail de teste). A `docs/` recebe `01-DD-MM-AAAA-visao-geral.md`. Nunca sobrescreve arquivo existente; não mexe em clonados, importados nem em "pasta que já tem um app". Desligável em Configurações.
- O Caddy não serve `/docs/*`, `/CLAUDE.md` e `/AGENTS.md` quando esses arquivos existem na pasta pública (WordPress, pasta PHP, túnel público). Rotas de aplicação com esses caminhos (ex.: `/docs` do Laravel) continuam funcionando.
- Atualização do próprio RDR Local pelo painel (Componentes e PHP → Verificar atualizações): consulta a última release do GitHub, baixa o instalador, confere o SHA-256 publicado junto (`.sha256`) e abre o assistente. Recusa qualquer endereço fora de `github.com/…/releases/download`. Precisa de release com `RDR-Local-Setup-<versão>.exe` e `.sha256` em repositório público.
- Verificação automática de atualizações 30 s depois de abrir e a cada 6 horas (desligável em Configurações), com selo numérico em "Componentes e PHP". Não instala nada sozinha.
- A lista de atualizações passou a incluir Composer e phpMyAdmin.
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

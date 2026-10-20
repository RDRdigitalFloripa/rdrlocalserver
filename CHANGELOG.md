# Changelog

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

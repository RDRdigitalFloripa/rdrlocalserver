# Backup na nuvem

Backup que fica no mesmo disco do computador não protege contra disco queimado, roubo ou ransomware. A página **Backup na nuvem** envia automaticamente os backups para fora do PC: Google Drive, Dropbox, S3/Cloudflare R2/Backblaze B2/Wasabi, ou uma pasta de outro disco/NAS (inclusive a pasta que o OneDrive ou o Google Drive Desktop já sincroniza).

O envio usa o **rclone**, uma ferramenta open source muito usada para isso. O RDR Local baixa o rclone sozinho e confere o SHA-256 do arquivo contra a lista oficial da mesma versão.

## 1. O que é enviado

| Item | Quando | Observação |
|---|---|---|
| Dumps dos bancos (`.sql`) | sempre | Os mesmos arquivos de *Bancos de dados → Backups* |
| Configuração do RDR Local | opcional (ligado por padrão) | Sites, portas e preferências. **Sem** variáveis de ambiente: só os nomes delas |
| `.env` e `storage/app` dos projetos | opcional | Só o que o Git não guarda. Arquivos acima de 500 MB são pulados |

O código dos projetos **não** é enviado: ele já está (ou deveria estar) no Git. O `bin/` com os componentes baixados também não, pois dá para baixar de novo.

## 2. Atalho: Google Drive em um clique

No topo da página **Backup na nuvem**, o cartão **Google Drive em um clique** faz tudo de uma vez:

1. Informe a **pasta no Drive** (padrão `RDR-Local-Backup`) e, se quiser, uma **senha de criptografia** (recomendado, 12 caracteres ou mais).
2. Clique em **Conectar Google Drive** e confirme.
3. O RDR Local **instala o rclone** se faltar (com o SHA-256 conferido) e **abre o navegador** para você autorizar o acesso. Se ele não abrir, aparece um botão **abra o link de autorização** no próprio cartão. Você tem 5 minutos; o botão **Cancelar a autorização** encerra a espera na hora, sem deixar nada pela metade.
4. Autorizado, ele usa o Drive como **destino**, deixa o **envio automático** ligado depois de cada backup agendado, liga a **criptografia** (se você deu a senha) e **testa a escrita** no Drive.

Depois é só clicar em **Enviar agora** e, uma vez, em **Testar restauração**.

- Tudo é validado **antes** de instalar ou abrir o navegador (nome do destino, pasta, tamanho da senha, conflito com a criptografia já ligada).
- Se o destino com esse nome já existe e é Google Drive, ele **reaproveita a autorização** (não abre o navegador de novo): serve para trocar a pasta, ligar a criptografia ou o envio automático.
- Se já existe um destino com esse nome que **não** é Google Drive, ele recusa sem mexer nele.
- **Avançado** (no mesmo cartão): nome do destino e **Client ID/Secret próprios**. Recomendado: sem eles o Google limita a velocidade e, com o app OAuth em modo "Teste", a autorização expira em 7 dias (como criar: seção 4, Google Drive).
- Se o teste final falhar (ex.: autorização expirada), a tarefa termina em **erro** com o motivo; a configuração do destino fica salva.

Os passos manuais abaixo continuam valendo para os outros destinos (Dropbox, S3, pasta) e para quem prefere configurar etapa por etapa.

## 3. Configurar manualmente, passo a passo

1. **Instale o rclone** (botão na página).
2. **Adicione um destino** (nome livre, por exemplo `meu-drive`). Cada tipo pede o que precisa, veja a seção 4.
3. Em **O que e como enviar**, escolha o destino, a pasta, se envia `.env`/`storage` dos projetos e marque *Enviar automaticamente depois de cada backup agendado*. Salve.
4. **Ligue a criptografia** (recomendado, seção 5).
5. Clique em **Testar conexão** e depois **Enviar agora**.
6. Clique em **Testar restauração** (seção 6). Faça isso pelo menos uma vez.

O envio automático acontece logo depois do backup agendado (*Bancos de dados → Backups*). Configure lá o horário.

## 4. Destinos

### Google Drive

- O acesso usa o escopo `drive.file`: o RDR Local só enxerga os arquivos que ele mesmo criou, **nunca** o seu Drive inteiro.
- Ao conectar, o navegador abre para você autorizar. Se não abrir, copie o endereço `http://127.0.0.1:53682/...` que aparece no log da tarefa. Você tem 5 minutos.
- **Recomendado: use o seu próprio Client ID.** Sem ele o rclone usa uma credencial compartilhada, sujeita a limites de velocidade. Como criar:
  1. Acesse o Google Cloud Console, crie um projeto e ative a **Google Drive API**.
  2. Em *Tela de permissão OAuth*, escolha *Externo* e preencha o básico.
  3. Em *Credenciais*, crie um **ID do cliente OAuth** do tipo **App para computador**. Copie o ID e o segredo para os campos do RDR Local.
  4. Em *Tela de permissão OAuth*, **publique o app** (status "Em produção"). Enquanto estiver em "Teste", a autorização expira em 7 dias e o envio para de funcionar.

### Dropbox

O navegador abre para você autorizar. Não precisa de mais nada.

### S3, Cloudflare R2, Backblaze B2, Wasabi

Informe provedor, endpoint, Access Key e Secret Key. Exemplos de endpoint: R2 `https://<id-da-conta>.r2.cloudflarestorage.com`; Backblaze B2 `https://s3.<região>.backblazeb2.com`. **Crie uma chave só com acesso ao bucket de backup** (menor privilégio): se ela vazar, o estrago fica limitado a esse bucket.

### Pasta ou disco

Use um disco externo, um NAS ou a pasta já sincronizada por outro programa. Na etapa 3, informe o caminho completo (por exemplo `D:\Backups\RDR-Local`).

### Outros serviços (OneDrive, SFTP, Azure…)

O rclone suporta dezenas. Para os que não estão no formulário, abra um terminal na pasta de dados (`C:\ProgramData\RDRLocal`) e rode `bin\rclone\rclone.exe --config config\cloud\rclone.conf config` para criá-los. Eles aparecerão na lista de destinos.

## 5. Criptografia

Com a criptografia ligada, **nomes e conteúdo dos arquivos são cifrados antes de sair do PC**. Quem acessar a conta do Drive vê apenas arquivos ilegíveis. Dump de banco contém dados de clientes, então use sempre que o destino não for um disco só seu.

- A senha precisa ter pelo menos 12 caracteres.
- **Se perder a senha, o backup é irrecuperável.** Guarde em um gerenciador de senhas.
- A senha não é salva em texto: só uma forma ofuscada no `rclone.conf`. Em outro PC, a **mesma senha** reabre os backups, sem precisar de nenhum outro arquivo.
- Os envios cifrados vão para a subpasta `encrypted` do destino. O que foi enviado antes de ligar a criptografia continua em texto claro até você apagá-lo no destino.
- Para trocar de destino ou de pasta, desligue a criptografia, troque e ligue de novo.

## 6. Testar restauração

Um backup que nunca foi restaurado não é um backup. O botão **Testar restauração**:

1. Procura o `.sql` mais recente no destino e baixa.
2. Confere se ele termina como um dump completo (não truncado).
3. Se o banco correspondente estiver ligado, **restaura num banco temporário** (`rdr_restore_test`) e o apaga em seguida. Se estiver desligado, faz só a verificação de integridade.

O resultado fica registrado na página. Repita de vez em quando e depois de mudar de destino ou de senha.

## 7. Retenção na nuvem

Por padrão **nada é apagado** no destino. Se informar "Apagar do destino arquivos com mais de N dias" (mínimo 7), o RDR Local só apaga se existir pelo menos um backup mais recente que N dias no destino. Assim, se o envio parar por algum motivo, os backups antigos não somem por conta própria.

## 8. Avisos de falha (Telegram e webhook)

Receba uma mensagem quando um backup ou envio falhar (e, se quiser, quando der certo).

- **Telegram:** crie um bot com o @BotFather, copie o token, mande uma mensagem ao bot e informe o seu Chat ID (por exemplo via @userinfobot).
- **Webhook:** qualquer URL que aceite um POST em JSON (`{title, text, content}`): ntfy, Discord, Slack, n8n.
- Token e URL ficam em `config\secrets.json`, com acesso restrito ao seu usuário, **fora** do `config.json` e da exportação.
- Use **Enviar teste** para conferir.

## 9. Restaurar em outro PC (ou depois de um desastre)

1. Instale o RDR Local e o rclone.
2. Adicione o **mesmo destino** (para Google Drive e Dropbox, autorize de novo; o app só enxerga arquivos que ele criou, então use a mesma conta e o mesmo Client ID).
3. Informe a **mesma pasta** e, se usava criptografia, ligue-a com a **mesma senha**.
4. Baixe o arquivo `.sql` desejado com o rclone, por exemplo: `bin\rclone\rclone.exe --config config\cloud\rclone.conf copy meu-drive-crypt: D:\restaurar --include "*.sql"`.
5. Em *Bancos de dados → Restaurar de um arquivo .sql*, aponte para o arquivo baixado.

## 10. Segurança: o que saber

- O `rclone.conf` contém as credenciais do destino. O RDR Local restringe o acesso a ele ao seu usuário e nunca o inclui na exportação nem na API. **Não o copie para repositórios Git nem para chats.**
- Quem usar o seu usuário do Windows consegue ler o `rclone.conf`. Em PC compartilhado, use criptografia e uma chave de nuvem com o menor privilégio possível.
- Remover um destino no painel **não apaga** o que já está na nuvem, e não revoga o acesso na conta. Para revogar, remova o app em *Segurança → Acesso de terceiros* da conta do Google/Dropbox ou apague a chave do bucket.
- O envio não faz *sync* destrutivo: usa *copy*, que nunca apaga o destino por conta de um arquivo local ter sumido.

## 11. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "O rclone não está instalado" | Falta o componente | Botão *Instalar rclone* |
| O navegador não abre ao conectar | Navegador padrão bloqueado | Copie o endereço `127.0.0.1:53682` do log |
| Para de enviar depois de 7 dias (Drive) | App OAuth em "Teste" | Publique o app no Google Cloud (seção 4) |
| `403 rateLimitExceeded` | Credencial compartilhada do rclone | Use o seu próprio Client ID |
| "SHA-256 não confere" | Download corrompido ou interceptado | Tente de novo; se persistir, troque de rede |
| Restauração testada só verificou integridade | Banco desligado | Ligue o MariaDB/PostgreSQL e repita |

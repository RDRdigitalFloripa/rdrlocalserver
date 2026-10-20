# Importar sites de outro ambiente (v1.5)

Painel → **Importar de outro ambiente**. O RDR Local lê a configuração do servidor web de origem, mostra uma prévia e, depois da sua confirmação, cria os sites **apontando para as mesmas pastas**. É somente leitura: nada é copiado, movido ou alterado na origem.

## O que é detectado

| Origem | Onde procura (em todas as unidades) |
|---|---|
| ServBay | `ServBay\etc\nginx\vhosts\*.conf` |
| Laragon | `laragon\etc\nginx\sites-enabled`, `laragon\etc\apache2\sites-enabled` e a pasta `laragon\www` (domínio `pasta.test`) |
| XAMPP | `xampp\apache\conf\extra\httpd-vhosts.conf` e a pasta `xampp\htdocs` |
| Outra | qualquer pasta com arquivos `.conf` ou um arquivo `.conf` (nginx ou Apache), informado no campo de caminho |

## O que o importador faz

- Usa `server_name`/`ServerName` como domínio e `root`/`DocumentRoot` como pasta. Se a raiz termina em `public`, `web` etc., usa a pasta do projeto (o RDR Local acha a pasta pública sozinho).
- **Junta** blocos que apontam para a mesma pasta: o primeiro domínio vira o principal e os outros viram aliases (ex.: `aion.local` + `aionmvp.local`).
- Ignora hosts internos (`servbay.host`, `mail.servbay.host`, `localhost`) e proxies para fora da máquina. Proxies para `127.0.0.1`/`localhost` viram sites do tipo Proxy.
- Se a origem usava PHP 8.x, usa a mesma versão quando instalada aqui; senão, o PHP padrão.
- Marca o que **não** será importado: pasta inexistente, pasta já cadastrada, domínio já usado.

## Depois de importar

1. **Pare o servidor web da origem** (Nginx do ServBay, Apache do XAMPP/Laragon): ele ocupa as portas 80/443 e responde no lugar do RDR Local. O item *Portas 80/443* do Diagnóstico mostra quem está usando.
2. Instale PHP/Caddy em *Componentes e PHP* se ainda não fez e clique em **Iniciar tudo**.
3. Em projetos Laravel, confira o `APP_URL` do `.env` (o Diagnóstico avisa se não bate com o domínio) e `DB_HOST`/`DB_PORT`: a porta do MariaDB aqui é a do RDR Local (padrão 3307).
4. O certificado HTTPS passa a ser o da CA do RDR Local; aceite-o uma vez (aba *Certificado SSL*).

## O que NÃO é importado

- **Bancos de dados**, no importador de sites. Eles têm importador próprio (abaixo).
- Certificados, variáveis de ambiente de servidor, filas e agendadores. Reconfigure-os no site, se usar.
- Configurações específicas do nginx/Apache (rewrites, headers). O RDR Local usa o Caddy com as regras padrão de PHP/Laravel.

## Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| Nada detectado | Instalação em pasta fora do padrão | Informe o caminho do `.conf` ou da pasta de vhosts |
| "Pasta não encontrada" | Unidade desconectada ou projeto movido | Corrija o caminho e importe de novo |
| O site abre a página do ServBay | Servidor web antigo ainda ligado | Pare-o (passo 1) |

## Importar bancos de dados (v1.6)

Bancos de dados → **Importar de outro servidor**. Funciona com MySQL/MariaDB **ligado neste PC** (ServBay, Laragon, XAMPP). PostgreSQL não está incluído.

1. Ligue o servidor de banco da origem e o MariaDB do RDR Local (*Iniciar tudo*).
2. Informe a **porta** da origem (o painel sugere as portas com algo escutando), o usuário e a senha, e clique em *Conectar e listar*. A senha só é usada nesta conexão: não é gravada nem aparece em log.
3. Marque os bancos. Para cada um dá para mudar o nome de destino. Se o nome já existe aqui, marque *substituir*: o banco atual ganha uma cópia de segurança antes.
4. *Importar selecionados* e acompanhe o log. Para cada banco o RDR Local: faz o dump na origem (só leitura), restaura aqui e **confere o número de tabelas e as linhas de cada tabela**. Se a conferência falhar, o banco é marcado com erro.

Detalhes:
- Só aceita origem em `127.0.0.1`/`localhost` e porta diferente da do RDR Local (3307).
- Origem **MySQL 8**: collations como `utf8mb4_0900_ai_ci`, que o MariaDB não conhece, são trocadas por equivalentes (`utf8mb4_unicode_ci`) durante a cópia.
- Views, procedures, triggers e events vão junto. Usuários e permissões do servidor de origem **não**.
- O `.sql` fica em *Bancos → Backups*, como cópia de segurança.
- Depois, ajuste o `.env` dos projetos: `DB_HOST=127.0.0.1`, `DB_PORT=3307`, `DB_USERNAME=root` e senha vazia (padrão do RDR Local).

| Sintoma | Causa | Solução |
|---|---|---|
| "Não consegui conectar à origem" | Porta, usuário ou senha errados, ou servidor desligado | Confira no painel do ServBay/Laragon/XAMPP |
| "conferência falhou" | Dados mudaram durante a cópia, ou erro na restauração | Pare o uso do banco de origem e importe de novo |
| "já existe um banco" | Destino ocupado | Mude o nome de destino ou marque *substituir* |
| "nome fora do padrão" | Nome com hífen ou caractere especial | Renomeie na origem (letras, números e `_`) |

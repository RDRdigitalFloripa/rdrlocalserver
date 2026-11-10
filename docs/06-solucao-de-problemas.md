# Solução de problemas

Comece sempre pelo menu **Diagnóstico**: ele confere extensões do PHP, portas, hosts, CA, bancos e `.env`, com botão de correção.

## Sites e HTTPS

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Cadeado não fica verde | CA local não confiável no navegador | Certificado SSL → *Confiar na CA local* (como Administrador) e reabra o navegador |
| Domínio não abre | Servidor Web parado ou hosts sem a linha | Iniciar o Servidor Web; Diagnóstico → corrigir hosts. `.localhost` funciona sem hosts |
| "Sem permissão para editar o hosts" | Painel aberto sem Administrador | Abra pelo `start.bat`. Se persistir, copie as linhas mostradas para o hosts |
| Porta 80/443 em uso | ServBay/XAMPP/IIS | Pare o outro servidor ou troque as portas em Configurações |
| Curinga `*.app.test` não resolve | DNS local desligado | Configurações → DNS local |
| Proxy reverso dá 502 | Nada ouvindo na porta de destino | Suba o app; no Docker do Windows use `host.docker.internal:porta` |

## Apps (Node.js, Python, Go, Java)

| Sintoma | O que fazer |
|---|---|
| 502 no domínio do app | O app precisa escutar em `127.0.0.1` na porta `PORT`. Veja o log do app e o Diagnóstico |
| "Node.js/Python não está instalado" | Componentes e PHP → Linguagens → instalar |
| "A porta N já está em uso" | Feche o programa que usa a porta ou edite o app para outra |
| "App caiu" | Caiu 5 vezes em 1 minuto: corrija o erro (log) e inicie de novo |
| Go/Java "comando não encontrado" | Instale com `winget` (veja o *Guia de linguagens*) e reabra o RDR Local |

## PHP e Laravel

| Sintoma | O que fazer |
|---|---|
| `could not find driver` | Reinicie o RDR Local (corrige o php.ini) e confira `php -m \| findstr /i pgsql` |
| `relation sessions does not exist` / banco sem tabelas | Processos do site → *Migrate* (ou `php artisan migrate --force` no terminal) |
| Mudei variável de ambiente e nada mudou | Reinicie o Servidor Web |
| Editei o php.ini à mão e deu erro | Componentes e PHP → Configurar → restaurar `php.ini.bak` |
| Extensão voltou a ligar/desligar sozinha | Use a aba Extensões do editor; as desligadas por você são respeitadas |

## Bancos

| Sintoma | O que fazer |
|---|---|
| PostgreSQL não inicia como Administrador | O painel já usa token restrito (`pg_ctl`); veja `logs/postgres.log` |
| MariaDB não conecta no `.env` | Porta padrão aqui é **3307**, PostgreSQL **5433**, Redis **6380** |
| Restauração apagou dados | Antes de restaurar/excluir é salvo um backup em `data\backups\<motor>\` |
| Backup agendado não rodou | O painel precisa estar aberto e o banco ligado; ele recupera ao abrir |

## Painel, inicialização e túnel

| Sintoma | O que fazer |
|---|---|
| `start.bat` com o painel já aberto | Ele só abre o painel existente (porta 7070 em uso) |
| Iniciar com o Windows não ativa | Abra o RDR Local como Administrador uma vez e marque a opção |
| Túnel sem link | Instale o Cloudflared em Componentes; veja o log do processo |
| Painel responde 403 | Acesse por `127.0.0.1:7070` ou `localhost:7070` (outros nomes são bloqueados de propósito) |
| Download de componente falha | Verifique internet/antivírus/proxy e tente de novo; o log da tarefa mostra a URL |

## Coletar informações para suporte

1. Diagnóstico → copie o resultado.
2. Aba Logs → serviço com problema.
3. Informe versão do Windows, versão do PHP do site e o que mudou antes do erro.

## Abri um domínio e apareceu o site de outro servidor (ex.: aion.local)

**Caso típico: ServBay.** O `nginx` do ServBay (`C:\ServBay\packages\nginx\nginx.exe`) ocupa as portas 80/443 e responde pelo site padrão dele (por exemplo `aion.local`). Soluções: (a) no ServBay, pare o *Nginx* (ou o ServBay inteiro) enquanto usa o RDR Local; ou (b) em *Configurações* do RDR Local mude as portas web para 8080/8443 e acesse `https://seu-site.local:8443`. Use um só servidor por vez nas portas 80/443.

Dois programas disputam as portas 80/443. Vale para ServBay, XAMPP, IIS/Apache ou outra cópia do RDR Local (por exemplo a pasta do `start.bat` e a instalada).

1. Em *Diagnóstico*, veja o item **Quem atende as portas 80/443/53**: ele mostra o programa e o caminho.
2. No PowerShell (Administrador), confira você mesmo:
   ```powershell
   Get-NetTCPConnection -LocalPort 80,443,53 -State Listen | ForEach-Object { $p = Get-Process -Id $_.OwningProcess; "{0} -> {1} {2}" -f $_.LocalPort, $p.ProcessName, $p.Path }
   ```
3. Feche o outro servidor (ou desligue o início automático dele) e use *Reiniciar o painel* na bandeja. Mantenha **uma** cópia do RDR Local ligada por vez: cada uma tem sua própria lista de sites.
4. Limpe o cache do navegador para o domínio (Ctrl+Shift+Del) ou teste em janela anônima.

## O backup na nuvem não envia

Veja a tabela de problemas comuns no guia *Backup na nuvem*. Para ver o que aconteceu, clique em **Enviar agora** e leia o log da tarefa (canto inferior direito). O último resultado também aparece na página, e, com os avisos ligados, chega por Telegram/webhook.

## Meilisearch não inicia: "database version is incompatible with your current engine version"

O banco do Meilisearch só abre na versão em que foi criado (a cada versão menor, ex.: 1.55 → 1.56, ele precisa migrar). Isso acontecia depois de atualizar o Meilisearch em **Componentes e PHP**. A partir da 1.12 o RDR Local resolve sozinho ao iniciar: guarda uma cópia em `datameilisearchackup-<versão>-<data>` e migra com `--upgrade-db`. Se você ainda está numa versão anterior, atualize o RDR Local e inicie o Meilisearch de novo. Se o banco for **mais novo** que o programa instalado, atualize o Meilisearch (não existe volta de versão). Para voltar à cópia: pare o serviço, renomeie `data.ms` e coloque a pasta `data.ms` de dentro do `backup-…` no lugar.

## O botão Pasta não abre a pasta do site

Se a janela do Explorer não aparecer, veja na barra de tarefas se há um ícone piscando (versões até a 1.11 abriam a janela atrás do navegador). Na 1.12 ela vem para a frente. Se a pasta foi movida ou apagada, o painel avisa "A pasta não existe mais": edite o site e aponte para o novo local.

## Os medidores de CPU/Memória/Disco aparecem vazios

Causa mais comum: **extensão de bloqueio** (uBlock, AdGuard, Privacy Badger…) barrando a chamada de métricas. A partir da 1.2.1 ela se chama `/api/host-status` e a mensagem mostra o motivo. Se ainda falhar, desative a extensão para `127.0.0.1` ou teste em janela anônima. Também ajuda **Ctrl+F5** (interface antiga em cache). A partir da 1.2 os medidores são desenhados ao abrir o Painel; se ainda ficarem vazios, veja o log do painel em `C:\ProgramData\RDRLocal\logs\panel.log`.

## O endereço rdr-local-server.local não abre
Precisa do **servidor Web ligado** e do nome resolvendo (hosts ou DNS local). Use `http://127.0.0.1:7070` enquanto isso. Se aparecer aviso de certificado, faça *Certificado SSL → Confiar na CA local* e reabra o navegador.

## Publicar: "Permission denied" no teste do servidor
A chave pública ainda não está no servidor. Em *Publicar → Chaves SSH* use "Copiar pública" e coloque a linha em `~/.ssh/authorized_keys` do usuário do servidor (permissões: pasta `.ssh` 700, arquivo 600).

## Publicar: "impressão digital mudou" ou conexão recusada
Só aceite a nova impressão digital se você reinstalou o servidor. Confira com `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` no servidor.

## Publicar: "O Cliente OpenSSH não está instalado"
Configurações do Windows → Aplicativos → Recursos opcionais → Adicionar → *Cliente OpenSSH*.

## Publicar: o build aparece como "bloqueia"
O RDR espera o build do GitHub Actions terminar com sucesso. Se a consulta falhar, o token do GitHub precisa da permissão **Actions: Read**. "Publicar mesmo assim" existe, mas exige confirmação.

## FTP: "Usuário ou senha recusados" / certificado FTPS
Confira usuário e senha e o protocolo/porta (FTPS costuma ser 21 explícito; 990 implícito). Se o provedor usa certificado de outro nome, a opção "Aceitar certificado que não confere" resolve, ao custo de segurança.

## FTP: enviou tudo de novo ou quero registrar o que já está no servidor
O RDR guarda o que enviou em `data\ftp\<destino>.json`. Se a pasta do servidor já está igual à local, use **"Já está igual no servidor"** na primeira prévia para não reenviar nada.

## O Importar não achou meus sites
Aponte a pasta ou o arquivo de configuração (nginx/Apache) manualmente. Veja o guia *Importar sites* para as pastas e formatos aceitos.

## Reverter não aparece / reverteu para a versão errada
O botão só existe em receitas com comandos de reversão (Swarm: automático; comandos próprios: preencha o campo). `docker service rollback` volta **uma** especificação; se você publicou duas vezes, volta para a penúltima. Para uma versão específica, edite a receita com a tag da imagem desejada e publique.

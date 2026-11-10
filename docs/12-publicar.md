# Publicar (SSH, Docker Swarm, GitHub Actions e FTP/SFTP)

A página **Publicar** leva o que está no GitHub para o seu servidor, sem terminal livre: o RDR Local só executa os comandos das **receitas** que você cadastra.

## Conceitos
- **Chaves SSH**: gere (ed25519) ou importe. A privada fica cifrada com DPAPI; você copia só a pública para `~/.ssh/authorized_keys` do servidor. Chaves com senha ainda não são suportadas. Senha de login nunca é usada.
- **Servidores**: nome, host, porta, usuário e chave. Ao cadastrar, o RDR mostra a **impressão digital** do servidor. Confira com `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` antes de confirmar. Se ela mudar depois, a conexão é bloqueada e um alerta aparece.
- **Receitas**: lista de comandos executados em ordem, parando no primeiro erro.

## Receita Swarm
Informe a imagem (ex.: `ghcr.io/rdrdigitalfloripa/app:latest`) e os serviços. Para cada serviço o RDR gera:

```
docker service update --with-registry-auth --image <IMAGEM> <SERVICO>
```

Você pode acrescentar passos extras (ex.: `docker service ps <SERVICO>`).

## Reverter
Receitas Swarm ganham o botão **Reverter**: roda `docker service rollback <serviço>` em cada serviço e volta à especificação **anterior** (só um nível; depois de reverter, outra reversão volta para a versão que você acabou de sair). Passos extras da receita (migrações, `artisan`) **não** são desfeitos. Em receitas de comandos próprios, preencha "Comandos de reversão" para habilitar o botão. Sempre pede confirmação e mostra os comandos.

## Verificação antes de publicar
Ligue a receita a um site (clonado do GitHub). A pré-verificação confere:
- servidor com identidade confirmada (bloqueia);
- commits locais ainda não enviados (bloqueia);
- build do GitHub Actions em andamento ou com falha (bloqueia). Exige token com **Actions: Read**;
- árvore suja ou commit diferente do remoto (aviso).

Se algo bloqueia, só dá para continuar com "Publicar mesmo assim", após confirmação.

## O que NÃO faz
- Não abre terminal livre nem roda comandos fora das receitas.
- Não envia nem sobrescreve `.env` de produção; não apaga nada no servidor.
- Não apaga pastas vazias no servidor e não sincroniza no sentido servidor → local.

## Requisitos e limites
- Cliente OpenSSH do Windows (Configurações → Aplicativos → Recursos opcionais).
- O usuário SSH precisa ter permissão para rodar `docker`. Prefira um usuário no grupo `docker` em vez de root.
- Partes específicas do Windows (OpenSSH, DPAPI, icacls) foram testadas apenas em Linux.

## Sites antigos: FTP, FTPS e SFTP (v1.8)
Seção "Sites antigos" da mesma página. Cada **destino** liga um site (pasta local, com subpasta opcional como `public`) a uma pasta do servidor.

- **FTPS** (FTP com TLS) é o recomendado. **FTP simples** funciona, mas senha e arquivos trafegam abertos (o painel avisa). Usa o `curl.exe` do Windows; a senha fica cifrada (DPAPI) e não vai na linha de comando.
- **SFTP** usa um servidor SSH já cadastrado (chave + identidade confirmada) via `sftp.exe`. Não usa senha.
- **Pasta no servidor**: sem `/` no começo é relativa à pasta inicial do login (ex.: `public_html`); com `/` é absoluta.
- **O que sobe**: só o que mudou desde a última publicação (o RDR guarda um manifesto local com SHA-1 de cada arquivo). Fora sempre: `.env` e `.env.*` (menos `.example`), `.git/`, `node_modules/`, `.idea/`, `.vscode/`. Você pode acrescentar padrões (`storage/`, `*.log`).
- **Primeira vez**: o RDR não sabe o que existe no servidor. Ou envia tudo (sobrescreve arquivos de mesmo nome, com confirmação) ou você usa **"Já está igual no servidor"** para só registrar o ponto de partida sem enviar nada.
- **Prévia** com novos, alterados e removidos. Arquivos removidos aqui **continuam no servidor** a menos que você marque "Apagar no servidor" e confirme.
- Se algum arquivo falhar, o que subiu fica registrado; rode de novo para o resto.
- Nomes de arquivo com aspas, barra invertida ou caracteres de controle são ignorados (aparecem na prévia).

## Referência rápida
- API: grupos *Publicar (SSH)* e *Publicar (FTP/SFTP)* em *Referência: CLI, API e MCP*.
- Problemas comuns: *Solução de problemas* (seções Publicar e FTP).
- Segurança: *Segurança, limites e versão*.
- Portainer: se o serviço nasceu de uma stack do Portainer, `docker service update --image` não altera o arquivo da stack; com tag fixa, um *Update the stack* volta à imagem antiga. O `--with-registry-auth` usa o `docker login` do usuário SSH.

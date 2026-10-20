# Guia de instalação e operação

## Instalação com o instalador (recomendado)

1. Execute `RDR-Local-Setup-1.8.2.exe` (aceite o pedido de Administrador). O Node.js já vai embutido: não precisa instalar nada antes.
2. Na tela de componentes, deixe marcado **Iniciar com o Windows** se quiser o RDR Local sempre ligado em segundo plano.
3. Ao final, marque *Abrir o RDR Local agora*. O painel abre em http://127.0.0.1:7070 e aparece um **ícone perto do relógio**.

**Como roda:** em segundo plano, sem janela de CMD. Fechar o navegador não derruba nada. O ícone da bandeja tem *Abrir painel*, *Abrir pasta de dados*, *Reiniciar o painel* e *Sair do RDR Local* (Sair desliga o painel e todos os serviços). Se o painel parar sozinho, o ícone o religa e avisa.

**Onde fica cada coisa**

| O quê | Pasta |
|---|---|
| Programa | `C:\Program Files\RDR Local\` (`app`, `runtime`, `launcher`) |
| Dados (bancos, componentes, config, backups, logs) | `C:\ProgramData\RDRLocal\` |
| Log do painel e da bandeja | `C:\ProgramData\RDRLocal\logs\panel.log` e `tray.log` |

Os dados ficam fora da pasta do programa: atualizar ou reinstalar **não apaga** bancos nem sites. O atalho do Menu Iniciar abre o RDR Local como Administrador sem pedir confirmação toda vez (usa uma tarefa agendada chamada *RDR Local Start*).

**Atualizar:** rode o instalador da versão nova por cima; ele encerra o RDR Local, troca o programa e mantém os dados.

**Desinstalar:** Configurações do Windows → Aplicativos → *RDR Local Server*. O desinstalador remove o bloco do arquivo hosts e pergunta se deve apagar também os dados (o padrão é **manter**). O certificado da CA local continua no Windows; remova-o em *certmgr.msc* se quiser.

**Vindo do `start.bat` (pasta antiga)?** Em *Configurações → Exportar configuração* na instalação antiga, e *Importar* na nova. Para os bancos, faça backup na aba Bancos e restaure na nova (os componentes são baixados de novo com *Instalar tudo*).

**Instalação silenciosa (equipes):** `RDR-Local-Setup-1.8.2.exe /S`. Para outra pasta: `/D=C:\Ferramentas\RDR Local` (sempre o último parâmetro, sem aspas).

**Gerar o instalador (desenvolvedores):** em Linux/macOS/WSL com `nsis` e `npm`, rode `bash installer/build.sh`. O resultado fica em `installer/dist/`, junto com o `.sha256`.

## Instalação manual (modo desenvolvimento, sem instalador)

### Requisitos

- Windows 10/11 (64 bits), conta com permissão de Administrador.
- Internet na primeira instalação (os componentes são baixados).
- Node.js 18+ (o `start.bat` instala via `winget` se faltar).
- Portas livres: 80, 443 (web), 7070 (painel), 3307, 5433, 6380, 1026, 8026, 7710. Para o DNS local, 53/UDP.

### Passos

1. Extraia a pasta (ex.: `E:\Servrdr2\rdr-local`). Evite pastas com permissão restrita.
2. Duplo clique em `start.bat` → aceite o pedido de Administrador.
3. Se o Node.js for instalado agora, **feche a janela e abra o `start.bat` de novo**.
4. Abra http://127.0.0.1:7070 e clique em **Instalar tudo**, depois **Iniciar tudo**.

## Estrutura de pastas (no modo manual ficam ao lado do `server.js`; instalado, em `C:\ProgramData\RDRLocal`)

| Pasta | Conteúdo |
|---|---|
| `bin/` | Componentes baixados (Caddy, PHP, bancos…) e `bin\shims` |
| `data/` | Dados dos bancos, CA local, backups (`data\backups`) |
| `config/` | `config.json` (texto puro) e `Caddyfile` gerado |
| `logs/` | Logs dos serviços |
| `docs/` | Esta documentação (Markdown) |
| `public/` | Interface do painel |
| `lib/` | Módulos do servidor |

Fazer backup de `config/` e `data/backups/` preserva sites e bancos exportados.

## Variáveis de ambiente do RDR Local

| Variável | Efeito |
|---|---|
| `RDR_PORT` | Porta do painel (padrão 7070) |
| `RDR_HOME` | Pasta base de bin/data/config/logs (o instalador define `C:\ProgramData\RDRLocal`) |
| `RDR_HOSTS` | Caminho alternativo do arquivo hosts (testes) |
| `RDR_MCP_ALLOW_SHELL=1` | Libera a ferramenta `rdr_terminal` no MCP |

## Convivendo com ServBay/XAMPP

Web usa 80/443. Se outro servidor ocupa essas portas, pare-o ou troque as portas em **Configurações**. Bancos e Mailpit já usam portas alternativas.

## Como atualizar o RDR Local

A atualização do próprio RDR Local é feita **rodando o instalador da versão nova por cima da instalada**, na mesma unidade (por exemplo, `C:`). Seus sites, bancos, certificados e configurações ficam em `C:\ProgramData\RDRLocal` e **não são tocados**.

**Passo a passo**

1. Descubra a versão instalada: rodapé da barra lateral (`RDR LOCAL SERVER v…`). Ela vem do próprio programa e muda sozinha a cada atualização.
2. Baixe a versão nova (`RDR-Local-Setup-<versão>.exe`). Confira o hash, se houver o arquivo `.sha256` junto: no PowerShell, `Get-FileHash .\RDR-Local-Setup-<versão>.exe -Algorithm SHA256`.
3. **Opcional, mas recomendado:** em *Configurações → Exportar configuração* e na aba *Bancos → Backup* faça uma cópia de segurança.
4. Execute o instalador como Administrador. No instalador, deixe a pasta de destino como está (`C:\Program Files\RDR Local`).
5. O instalador encerra o painel e os serviços sozinho, troca os arquivos do programa e mantém os dados.
6. Ao final, marque *Abrir o RDR Local agora*. Aperte **Ctrl+F5** no navegador (para não usar a interface antiga do cache) e confira que o rodapé mostra a versão nova.

**Em equipes (silencioso):** `RDR-Local-Setup-<versão>.exe /S`.

**Se o rodapé continuar mostrando a versão antiga**

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Interface antiga | Cache do navegador | Ctrl+F5 |
| Painel antigo mesmo após instalar | O processo antigo não foi encerrado | Ícone da bandeja → *Sair do RDR Local*, depois abra de novo pelo Menu Iniciar |
| Instalou em outra pasta | Duas cópias no PC | Veja *Aplicativos instalados* do Windows; mantenha só uma e use a mesma pasta nas próximas atualizações |

**Reverter:** rode de novo o instalador da versão anterior; os dados são compatíveis para trás dentro da mesma versão maior (`1.x`).

**O que NÃO é atualizado pelo instalador:** PHP, Node.js, Python, bancos e demais componentes baixados. Esses se atualizam em *Componentes e PHP* (aba de atualizações), pois ficam em `C:\ProgramData\RDRLocal\bin`.

**Modo desenvolvimento (`start.bat`):** substitua `server.js`, `lib/`, `public/` e `docs/`, mantendo `bin/`, `data/` e `config/`, e reinicie o painel.

## Desinstalar

1. Desligue os serviços e, em Configurações, desmarque *Abrir com o Windows*.
2. Se usou o DNS local, desligue-o (remove a regra NRPT).
3. Apague a pasta. Exporte a configuração e os backups antes, se quiser guardá-los.

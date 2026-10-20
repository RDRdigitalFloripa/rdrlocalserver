# Política de segurança

## Modelo de ameaça

O RDR Local é uma ferramenta de **desenvolvimento local**. O painel escuta apenas em `127.0.0.1:7070`, **não tem login** e roda com privilégios de Administrador no Windows (precisa editar o arquivo hosts e instalar a CA local). Qualquer processo ou site aberto no seu PC pode tentar falar com ele; por isso as rotas de escrita exigem o cabeçalho `X-RDR` e checagem de origem.

Não faça: expor a porta 7070 na rede, publicá-la por túnel, ou usar o RDR Local como servidor de produção.

## Segredos

- Credenciais de nuvem ficam em `config\cloud\rclone.conf`; avisos e token do GitHub em `config\secrets.json` (token cifrado com DPAPI), com acesso restrito ao usuário.
- Nada disso entra na exportação de configuração nem nos backups enviados.
- A CA local é válida só neste PC; remova-a em `certmgr.msc` ao desinstalar.

## Como reportar

Envie um e-mail para **contato@rdrdigital.com.br** com o assunto "Segurança RDR Local", descrevendo o problema, a versão e como reproduzir. Não abra issue pública com detalhes de exploração. Respondemos em até 7 dias.

## Versões suportadas

Apenas a versão mais recente recebe correções.

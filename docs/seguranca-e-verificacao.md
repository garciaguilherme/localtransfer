# Seguranca da Copia, Verificacao SHA-256 e Auditoria

Idioma / Language: **Portugues** | [English](safety-and-verification.en.md)  
Voltar para o [README principal](../README.pt.md) ou ver [Funcionamento e ordem de lotes](funcionamento-e-ordem.md).

---

## 1. O que e o codigo SHA-256 e por que usa-lo

Quando voce copia um arquivo de um lugar para outro, olhar apenas se o nome e o tamanho em bytes sao iguais nao garante que o conteudo inteiro foi gravado sem falhas. Se ocorrer um erro de disco ou de rede durante a gravacao, um arquivo pode ficar com o tamanho certo, mas com partes corrompidas por dentro.

O **SHA-256** (Secure Hash Algorithm de 256 bits) funciona como uma **impressao digital matematica** do arquivo:
- O programa le todos os bytes do arquivo do inicio ao fim e aplica uma formula matematica que gera um codigo unico de 64 letras e numeros (por exemplo: `8f0690c3d88ab8f6...`).
- Se uma unica letra, pixel ou bit do arquivo mudar, o codigo SHA-256 gerado sera completamente diferente.
- Dois arquivos so terao o mesmo codigo SHA-256 se o conteudo deles for identico do primeiro ao ultimo byte.

### Como o programa usa o SHA-256 na copia:
1. Ao ler o arquivo original no OneDrive, o programa calcula o SHA-256 de origem.
2. Depois de gravar a copia no Google Drive, o programa abre o arquivo que acabou de ser gravado no Google Drive, le todos os bytes novamente e calcula o SHA-256 de destino.
3. O programa compara os dois codigos. A transferencia daquele arquivo so e considerada concluida se o tamanho e o codigo SHA-256 de origem e de destino forem iguais.

---

## 2. O que e a copia com arquivo temporario (`.sync_part`)

Se a energia acabar ou a internet cair no meio de uma copia comum, o arquivo de destino fica pela metade. Em uma proxima tentativa, fica dificil saber se aquele arquivo esta completo ou cortado.

Para evitar esse problema, o programa usa uma **copia atomica**:
1. Enquanto o arquivo esta sendo copiado, ele recebe um nome temporario curto no formato `.sync_tmp_<codigo>.sync_part`.
2. O programa ignora qualquer arquivo terminado em `.sync_part` ao verificar o que ja foi transferido.
3. Somente depois que todos os bytes sao gravados no disco (`fsync`) e que o codigo SHA-256 e confirmado, o arquivo temporario e renomeado para o nome definitivo.
4. Se a transferencia for interrompida a qualquer momento, o arquivo `.sync_part` incompleto e apagado automaticamente, sem deixar arquivos corrompidos na pasta do Google Drive.

---

## 3. Protecao contra perda ou sobrescrita de arquivos

- **A pasta do OneDrive nunca e alterada ou apagada:** O programa abre os arquivos do OneDrive apenas em modo de leitura. Nenhum comando de exclusao e executado na pasta de origem.
- **Backup em caso de tamanhos diferentes:** Se um arquivo ja existir na pasta do Google Drive, mas tiver um tamanho diferente do arquivo do OneDrive, o programa nao grava por cima. Ele move primeiro o arquivo antigo do Google Drive para uma pasta separada chamada `_Backup_Versoes_Conflito` (com a data e a hora) e depois grava a versao nova verificada.
- **Suporte a nomes longos e caracteres japoneses ou especiais:** O disco virtual do Google Drive (`G:`) possui um limite de 255 bytes (UTF-8) por nome de arquivo. Como caracteres em japones, chines ou coreano ocupam 3 bytes cada, nomes longos podiam ser recusados pelo Google Drive. O programa ajusta automaticamente apenas os nomes que ultrapassam esse limite, preservando a extensao do arquivo.

---

## 4. Novas tentativas automaticas e limite de espaco em disco

- **Tres tentativas por arquivo:** Ao baixar arquivos da nuvem do OneDrive, a rede pode oscilar. Se uma copia falhar, o programa apaga o arquivo temporario, aguarda alguns segundos (2s, 5s e 10s) e tenta copiar novamente ate tres vezes antes de registrar erro.
- **Pausa preventiva por espaco em disco:** Tanto o OneDrive quanto o Google Drive usam o disco do computador como area de passagem para baixar e enviar arquivos. Antes de copiar cada arquivo, o programa verifica se ha pelo menos **5 GB livres** nos discos de origem e destino. Se o espaco livre cair abaixo de 5 GB, a copia para de forma segura para voce aguardar o envio do Google Drive terminar.

---

## 5. Como consultar o registro de auditoria

Todas as transferencias feitas pelo programa ficam gravadas no arquivo:

`logs/auditoria_transferencias.csv`

Voce tambem pode baixar esse arquivo clicando no botao **Baixar Log de Auditoria (SHA-256)** no topo da pagina do assistente. Ele pode ser aberto no Excel, LibreOffice ou Bloco de Notas e contem as seguintes colunas para cada arquivo:

- **Data_Hora:** Momento exato em que o arquivo terminou de ser copiado.
- **Status_Auditoria:** Indica `VERIFICADO_SHA256_OK` quando a copia passou no teste de integridade.
- **Caminho_Relativo:** Pasta e nome do arquivo copiado.
- **Tamanho_Bytes:** Tamanho exato do arquivo.
- **SHA256_Origem:** Impressao digital lida do arquivo no OneDrive.
- **SHA256_Destino:** Impressao digital conferida no arquivo gravado no Google Drive.
- **Tentativas:** Quantas tentativas foram necessarias (normalmente `1`).
- **Observacao:** Detalhe da confirmacao ou mensagem de erro caso o arquivo nao tenha podido ser lido.

# Funcionamento da Analise, Ordem de Lotes e Liberacao de Espaco

Idioma / Language: **Portugues** | [English](how-it-works-and-batching.en.md)  
Voltar para o [README principal](../README.pt.md).

---

## 1. Por que copiar pelo Windows Explorer trava ou demora

Quando voce usa o recurso de economia de espaco do OneDrive, muitos arquivos nao estao gravados por inteiro no seu computador. No computador fica apenas um atalho com o nome e o tamanho do arquivo, enquanto o conteudo real fica nos servidores da Microsoft.

Se voce seleciona uma pasta grande no Windows Explorer e manda copiar para o Google Drive:
1. O Windows tenta abrir todos os arquivos de uma vez.
2. O OneDrive e obrigado a baixar cada arquivo pela internet antes de entregar os dados para a copia.
3. Enquanto isso, o aplicativo do Google Drive tenta enviar esses arquivos para a nuvem do Google ao mesmo tempo.
4. O disco local fica cheio de arquivos temporarios e a transferencia falha no meio do caminho.

---

## 2. Como o programa analisa as pastas sem baixar arquivos

Todo sistema de arquivos do Windows guarda um indice com informacoes basicas sobre cada arquivo: nome, tamanho em bytes, data de modificacao e etiquetas de estado (chamadas de atributos). Esses dados sao chamados de **metadados**.

O programa le apenas esse indice da pasta, sem abrir o conteudo dos arquivos. Por nao abrir os arquivos, o OneDrive nao inicia downloads durante a analise.

Alem disso, o programa le um atributo do Windows que informa se o arquivo:
- **Ja esta no disco local:** Os dados ja estao gravados no seu computador e podem ser copiados na hora, sem depender da internet.
- **Esta apenas na nuvem:** O arquivo precisara ser baixado pelo OneDrive no momento em que for copiado.

---

## 3. Por que a leitura do Google Drive demora mais que a do OneDrive

- **OneDrive (`C:\Users\...\OneDrive`):** E uma pasta comum gravada direto no disco principal do computador (formato NTFS). O Windows ja tem a lista de todos os arquivos pronta no disco, entao a leitura leva poucos segundos.
- **Google Drive (`G:\Meu Drive`):** Funciona como um disco virtual criado pelo programa do Google Drive. Quando o assistente pede a lista de arquivos de uma subpasta em `G:`, o programa do Google Drive precisa consultar um banco de dados interno ou perguntar aos servidores do Google pela internet quais arquivos existem ali. Por isso, pastas com milhares de subpastas levam alguns minutos na primeira leitura.

Para evitar que voce espere essa leitura toda vez, o programa salva o resultado no arquivo `ultimo_relatorio_cache.json`. Quando um lote termina de ser copiado, esse arquivo e atualizado na hora.

---

## 4. Como a ordem de transferencia e definida

O programa separa apenas os arquivos que ainda nao existem no Google Drive (ou que estao com tamanho diferente) e os organiza em quatro fases:

1. **Fase 1 (Ja no disco local):** Arquivos que ja estao salvos no computador. Sao copiados primeiro porque nao exigem download do OneDrive. Sao divididos em lotes de ate 500 arquivos ou 1 GB.
2. **Fase 2 (Nuvem - ate 10 MB):** Arquivos pequenos que estao na nuvem, agrupados da subpasta mais leve para a mais pesada.
3. **Fase 3 (Nuvem - de 10 MB a 100 MB):** Arquivos medios que estao na nuvem.
4. **Fase 4 (Nuvem - acima de 100 MB):** Arquivos grandes deixados por ultimo para nao bloquear a fila dos demais.

Os arquivos da nuvem sao divididos em lotes de ate 250 arquivos ou 500 MB. Durante a copia, o programa recria no Google Drive a mesma estrutura de pastas e subpastas que existe no OneDrive.

---

## 5. Como funciona a liberacao de espaco no OneDrive

Quando um arquivo e baixado pelo OneDrive, ele passa a ocupar espaco no disco `C:`. O Windows possui um comando nativo (`attrib +U -P`) que avisa ao OneDrive que aquele arquivo pode voltar a ficar "Apenas online".

- **O que esse comando faz:** Remove a copia local do disco `C:` para liberar espaco no computador, mantendo o arquivo salvo na nuvem do OneDrive.
- **Quando usar:** Apenas se o seu disco `C:` tiver pouco espaco livre. Se a sua conta do OneDrive estiver com armazenamento cheio ou prestes a ser desativada, nao use a liberacao de espaco, mantendo os arquivos salvos tanto no computador quanto no Google Drive.

---

Proximo topico: [Seguranca da copia, codigo SHA-256 e auditoria](seguranca-e-verificacao.md).

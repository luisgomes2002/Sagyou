# Renomear arquivos salvos no Sagyou

Status: approved by Luis on 2026-10-28
Branch: feature/ajustes-rapidos

## Por quê

Comprovantes e documentos importados ficam com o nome que tinham no computador ("IMG_20261003_1422.jpg", "download (3).pdf"). Hoje, para corrigir o nome, Luis precisa baixar, renomear, excluir e importar de novo, perdendo o vínculo do comprovante com a transação. Task "Alterar nome de documentos".

## Objetivo

Renomear qualquer arquivo da tela **Arquivos** (documentos, imagens e comprovantes) sem sair do Sagyou e sem perder os vínculos.

## Fora do escopo

- Imagens anexadas a tasks (`TaskImage`), que não aparecem na tela Arquivos.
- Renomear pelo painel da transação ou pelo MCP.
- Trocar a extensão.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Só o nome muda, a extensão não.** Os bytes ficam em `files/<id><ext>` e são abertos pela extensão, então trocá-la quebraria a abertura. O campo de edição mostra a extensão fixa ao lado.
- **Nome repetido é recusado**, ignorando maiúsculas, entre os arquivos do mesmo escopo (o projeto, ou Geral). É a mesma regra da importação, que pergunta antes de criar duplicado.
- **Caracteres proibidos em nome de arquivo no Windows** (`\ / : * ? " < > |` e de controle) são recusados, porque "Baixar cópia" usa o nome. Nome que termina com ponto ou espaço também é recusado.
- Limite de 200 caracteres no nome sem a extensão.

## Comportamento

- Na linha do arquivo, ao passar o mouse, aparece a ação **Renomear**, ao lado de Abrir, Navegador, Baixar e Excluir.
- Ela troca o nome por um campo já preenchido com o nome sem extensão e todo selecionado. A extensão aparece fixa à direita.
- **Enter** ou **Salvar** grava. **Esc** ou **Cancelar** desfaz.
- Nome igual ao atual fecha o campo sem gravar.
- Os espaços nas pontas são removidos.
- Um erro aparece abaixo do campo, em texto, e o campo continua aberto:
  - vazio: `Digite um nome.`
  - longo demais: `O nome pode ter até 200 caracteres.`
  - caractere proibido: `O nome não pode ter \ / : * ? " < > |.`
  - termina com ponto ou espaço: `O nome não pode terminar com ponto ou espaço.`
  - repetido: `Já existe um arquivo com esse nome aqui.`
- O nome novo aparece em todo lugar que já mostra `file.name`: lista, comprovantes, painel da transação e busca global (Ctrl+K). "Baixar cópia" passa a sugerir o nome novo.

## Dados

Sem mudança de formato. Muda só o valor do campo `name` do arquivo, que já é persistido e já está no backup. O índice da busca global se atualiza na gravação, como em qualquer edição. Os vínculos usam o `id`, que não muda.

## Telas

Tela Arquivos: ação nova na linha e o estado de edição. Segue o visual das ações existentes: texto `#999999`, hover `#a080f0` sobre `#222227`, erro em texto `#e04040`, sem preenchimento com opacidade.

## Perguntas em aberto

(nenhuma)

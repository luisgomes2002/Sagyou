# Arquivos: duplicados e arrastar e soltar

Status: approved by Luis on 2026-10-27
Branch: feature/arquivos-importacao

Junta três tasks da sprint Arquivos: "perguntar antes de importar um arquivo que já existe no projeto", "mostrar arquivos salvos que estão repetidos" e "arrastar e soltar vários arquivos para importar".

## Por quê

Importar em Arquivos hoje cria duplicatas sem aviso, não há como ver as cópias que já entraram e só dá para importar pelo seletor. As três coisas mexem no mesmo fluxo de importação, então saem juntas.

## Objetivos

- Perguntar antes de salvar um arquivo cujo nome já existe no escopo da tela.
- Marcar na lista os arquivos repetidos que já estão salvos e permitir filtrar por eles.
- Importar arrastando um ou vários arquivos do gerenciador de arquivos para a tela de Arquivos.

## Fora do escopo

- Comparar conteúdo (hash) dos arquivos.
- Renomear arquivos já salvos (task "Alterar nome de documentos").
- Importar pastas recursivamente; arrastar para outras telas (comprovantes, tarefas).

## Decisões (de Luis, nas tasks)

- Duplicado na importação = mesmo `name` (com extensão), ignorando maiúsculas/minúsculas, no escopo visível: projeto ativo (`projectId === activeProjectId`) ou, sem projeto, os arquivos gerais (`!projectId`).
- Diálogo no app, um por duplicado, com "Aplicar aos próximos (N)" quando houver 2+.
- "Salvar cópia" grava como `relatorio (2).pdf`, `(3)`… (primeiro número livre, contando as cópias da mesma importação). "Pular" não copia nada para `userData/files`.
- O renderer nunca manda caminhos de disco para o main copiar; no arrastar, o caminho é resolvido no preload com `webUtils.getPathForFile`.
- Comprovantes (`TransactionRecordPanel`) usam o mesmo fluxo de duplicados, com escopo dos arquivos gerais.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Importação em dois passos com token**, no lugar de "copiar não duplicados + guardar pendentes" da task: `files:pick` (seletor) e `files:stage-paths` (arrastar) só registram os caminhos no main e devolvem `{ token, name, size }`; o renderer decide os duplicados e chama `files:import([{ token, name }])` só com o que deve ser salvo. Um único caminho de cópia para seletor, arrastar e comprovantes, e o renderer escolhe o nome exibido sem nunca tocar no caminho. Tokens valem 10 min e são de uso único; o que não é importado é descartado (`files:discard`).
- O `name` vindo do renderer é só metadado exibido: o arquivo em disco continua `<uuid><ext>`, com a extensão tirada do caminho original no main. Nome inválido (vazio, > 255 caracteres, com `/` ou `\`) volta para o nome original.
- `files:upload` é removido (os dois chamadores passam para o fluxo novo).
- **"Repetidos" na lista** = mesmo nome (ignorando maiúsculas) **e** mesmo tamanho no escopo visível. O tamanho evita marcar arquivos diferentes que só compartilham o nome; cópias salvas de propósito pelo diálogo ficam com nome `(2)` e não são marcadas.

## Comportamento

### Importar com duplicados (botão, arrastar e comprovantes)

- Arquivos sem duplicado entram direto, sem perguntar.
- Para cada duplicado, `ConfirmDialog` adaptado:
  - Título: `Arquivo já existe`
  - Mensagem: `“<nome>” já está neste projeto. Quer salvar outra cópia?` (sem projeto: `“<nome>” já está nos arquivos gerais. Quer salvar outra cópia?`)
  - Botões: `Pular` (secundário) / `Salvar cópia` (primário, não vermelho)
  - Com 2+ duplicados: checkbox `Aplicar aos próximos (N)`, N = quantos faltam depois deste.
- Dois arquivos com o mesmo nome dentro da mesma seleção, que não existem no escopo: o primeiro entra com o nome original e o segundo é tratado como duplicado.

### Repetidos na lista

- Cada arquivo repetido mostra uma etiqueta `Repetido` (texto em `#d9a640`, sem fundo colorido) ao lado do nome.
- Na barra, quando houver repetidos: botão `Repetidos (N)`, N = arquivos marcados. Ativo, a lista mostra só os repetidos agrupados por nome; clicar de novo volta à lista normal. Sem repetidos o botão some e o filtro é desligado.
- Excluir continua pelo botão de cada linha, com a confirmação atual.

### Arrastar e soltar

- Arrastando arquivos sobre a área da lista: overlay com borda tracejada e o texto `Solte para importar N arquivo(s)` (N = `dataTransfer.items.length`; se o sistema não informar, `Solte para importar os arquivos`).
- Arrastar só texto ou links (sem `Files` em `dataTransfer.types`) não mostra o overlay.
- Soltar importa no mesmo escopo do botão, passando pelo fluxo de duplicados.
- Pastas, links quebrados e caminhos que não são arquivos são pulados. Se algo foi pulado, aviso na barra: `Pastas não são importadas; arraste os arquivos.` (some depois de 5 s). Se tudo foi pulado, nada é importado.
- No máximo 200 arquivos por vez; o excedente é pulado e o aviso diz `Só 200 arquivos por vez; o restante foi ignorado.`
- Soltar fora da lista não faz nada (o `will-navigate` já bloqueia navegar para `file://`).

## Dados

Sem mudança de dados. `StoredFile` continua igual; os arquivos continuam em `userData/files/<uuid><ext>` e no backup como hoje. Os tokens de importação ficam só na memória do processo main.

## Telas

Só `FilesView` (overlay, etiqueta, botão de filtro, aviso) e o diálogo de duplicado. Cores sólidas e neutras, seguindo `UI_DESIGN.md`; sem fundos com opacidade baixa e sem brilho.

## Perguntas em aberto

Nenhuma.

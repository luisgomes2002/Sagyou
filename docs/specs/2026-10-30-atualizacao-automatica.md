# Atualização automática a partir dos Releases do GitHub

Status: draft
Branch: feature/sync-cloudflare (documentação no PR #30; implementação após plano aprovado)

## Por quê

Hoje o Sagyou só é atualizado quando a pessoa abre a página de Releases, baixa um instalador e o executa. O app já tem um workflow de release por tag, mas não consulta versões novas. O `publish` do electron-builder ainda aponta para uma URL de exemplo e o workflow não anexa os manifestos exigidos pelo atualizador.

## Objetivos

- Toda abertura do app instalado verifica se existe um Release estável mais recente no repositório público `luisgomes2002/Sagyou`.
- Se existir, baixa o pacote correspondente ao sistema e informa quando estiver pronto para instalar.
- A instalação preserva o banco SQLite, anexos, configurações e backups no `userData` e não interrompe uma sessão de agente ou um salvamento em andamento.
- Falha de rede ou do GitHub nunca impede a abertura ou o uso offline do app.
- Quando a sincronização Cloudflare estiver configurada, ela só começa depois da verificação de atualização. Uma versão nova deve ser instalada antes de baixar mudanças da nuvem.

## Fora do escopo

- Atualizar builds de desenvolvimento (`npm run dev`/preview), instalação Snap ou builds extraídos sem instalador.
- Criar Releases automaticamente: a pessoa continua criando a tag e autorizando o release conforme `docs/workflow.md`.
- Atualizar para prerelease ou versão igual/inferior à instalada.
- Enviar dados do usuário ao GitHub; só o mecanismo de consulta e download do pacote pode usar rede.

## Decisões de Luis

- Verificar em **toda abertura** do app.
- Quando houver Release novo, **baixar e atualizar o app**.
- A fonte das versões é o GitHub Releases do Sagyou.
- A ordem ao abrir é: consultar atualização → se houver, atualizar o app → depois baixar dados sincronizados da nuvem. Sem atualização, a sincronização pode começar logo após a consulta.
- Se o GitHub não responder, a sincronização pode começar depois de um prazo curto, sem bloquear os dados locais.

## Decisões do construtor (podem ser alteradas na aprovação)

- Usar `electron-updater` com o provedor GitHub, os manifestos `latest*.yml` e os hashes produzidos pelo `electron-builder`; não implementar download/execução própria de instaladores nem guardar token GitHub no app.
- Baixar automaticamente em segundo plano. Quando o pacote estiver pronto, oferecer **"Reiniciar e instalar"** e **"Depois"**. "Depois" mantém o trabalho aberto; no Windows NSIS e no Linux AppImage a instalação acontece no próximo fechamento normal ou na próxima abertura, sem exigir outro clique. Não fechar a janela de surpresa.
- O instalador Windows NSIS e o Linux AppImage podem instalar no reinício. A instalação `.deb` precisa de confirmação e autenticação do sistema; o app não deve tentar contornar o gerenciador de pacotes. O macOS só fará atualização interna após configurar assinatura Apple; enquanto não houver assinatura, a tela oferece o link do Release para instalação manual.
- O app só aceita Release publicado e estável, com versão maior que a instalada e artefato/manifesto compatível com a plataforma e a arquitetura. Um Release incompleto não substitui a instalação atual.
- O prazo curto para a consulta ao GitHub é de **10 segundos**. Uma resposta de erro ou o prazo esgotado libera o sync, registra a falha sem dados do usuário e permite tentar verificar de novo. Uma resposta válida que informa uma versão nova mantém o sync em espera até a instalação.

## Comportamento

1. Depois de abrir a janela, o processo main inicia uma consulta em segundo plano. A janela aparece sem esperar a rede. Uma segunda abertura do mesmo processo não inicia outra consulta simultânea. O motor de sync aguarda o resultado antes do primeiro pull ou push.
2. Sem versão nova, não aparece aviso e o motor de sync começa normalmente. Sem rede, GitHub indisponível ou manifesto inválido: o app continua funcionando e mostra um aviso discreto em Configurações, com opção de tentar de novo. Após no máximo 10 segundos de espera pela consulta, o sync começa normalmente. Se a consulta terminar com erro antes disso, ele pode começar imediatamente.
3. Com versão nova, o app mostra versão e andamento do download. Ao concluir, mostra **"Atualização pronta"**, **"Reiniciar e instalar"** e **"Depois"**. O download pode continuar enquanto a pessoa usa o app.
4. Se a consulta encontrar uma versão nova, o motor de sync não baixa nem envia dados até a instalação dessa versão terminar e o app novo abrir. O download pode continuar enquanto a pessoa usa os dados locais. Download falho ou instalação adiada mantém o sync em espera, com estado visível.
5. "Reiniciar e instalar" primeiro conclui os salvamentos pendentes e encerra os agentes da mesma forma que o fechamento normal do app; se isso falhar, não instala naquele momento e mantém a versão atual. No `.deb`, a confirmação inclui o pedido de autenticação do sistema.
6. Se a pessoa escolher "Depois", o app não fecha. No Windows NSIS e no Linux AppImage, o pacote é aplicado no próximo fechamento normal ou na próxima abertura; no `.deb`, a próxima abertura volta a pedir instalação com autenticação. A versão atual continua utilizável até a instalação terminar, mas a sincronização fica em espera.
7. O verificador não roda no modo dev, nem na tela de desbloqueio expõe dados locais ao GitHub. Nenhuma chamada do atualizador contém conteúdo de projeto, token de sync, senha, banco ou anexo.
8. A distribuição de cada versão inclui os instaladores e os manifestos/arquivos de atualização produzidos pela mesma build. A versão da tag, do `package.json` e dos manifestos deve coincidir. O workflow não publica um Release com artefatos faltando.

## Dados

Sem mudança de schema ou formato de backup. O pacote baixado fica no cache do atualizador, separado do SQLite e do backup. O instalador deve manter o `userData` existente. Uma versão que altere schema continua sujeita às regras de migração e backup do `GUIDE.md`.

## Telas

- Em Configurações, estado discreto: verificando, baixando com progresso, pronto, ou falha com "Tentar novamente".
- Durante a espera, a tela de sync informa que a sincronização começará após a atualização; os dados locais continuam acessíveis.
- Banner de atualização pronta segue `UI_DESIGN.md`, sem cobrir o conteúdo nem interromper uma edição.
- No macOS sem assinatura, mostrar **"Nova versão disponível"** e **"Abrir Release"**, sem prometer instalação automática.

## Dependências e validação

- Trocar o `publish` de exemplo pelo GitHub público do projeto e anexar ao workflow os manifestos, blockmaps e o arquivo macOS exigido pelo atualizador.
- Testar seleção de versão, erro de rede, manifesto ausente, pacote incorreto, download concluído e fechamento com salvamento/agente ativo. Fazer smoke test do instalador em Windows e Linux; atualização macOS requer build assinado.
- O primeiro Release com este recurso exige instalação manual; só as versões seguintes poderão atualizar por dentro do app.
- A implementação da barreira de startup depende do motor de sincronização do PR #30. Esta spec é entregue no mesmo PR por pedido de Luis; o plano e o build desta feature ainda exigem aprovação separada.

## Perguntas em aberto

Nenhuma sobre o comportamento. A spec permanece em draft até aprovação explícita de Luis, conforme `docs/workflow.md`.

# Roteiro manual — terminal nativo de agentes (Windows)

Execute este roteiro uma vez com **Codex**, uma com **Claude Code** e uma com
**OpenCode**. Antes
de começar, autentique o CLI no Windows e selecione-o nas configurações do
Agente de Código.

1. Inicie uma tarefa em um repositório Git e confirme que a tela mostra
   **Terminal nativo** e informa uma worktree isolada.
2. Verifique cores ANSI, cursor móvel, saída que redesenha a mesma linha e
   perguntas interativas do CLI.
3. Digite um comando/pergunta normal, cole texto com várias linhas e confirme
   que o conteúdo chega sem perder quebras de linha.
4. Pressione `Ctrl+C` enquanto o CLI está trabalhando; ele deve receber a
   interrupção sem encerrar o aplicativo.
5. Redimensione a janela/painel do terminal e confirme que o CLI se adapta ao
   novo número de colunas e linhas.
6. Navegue para outra tela e volte para Agentes. Confirme que a sessão reconecta
   com o buffer e o tamanho anteriores, sem abrir um segundo processo.
7. Faça uma pequena alteração e saia normalmente do CLI no terminal. Confirme
   que a sessão MCP é revogada, o diff é arquivado e nenhum pedido de aprovação
   final permanece pendente.
8. Confirme que a árvore original não mudou e que a sessão encerrada não aparece
   como aguardando aprovação.

Falhas de inicialização, encerramento ou fechamento da janela devem
encerrar o PTY e revogar a sessão MCP; não devem aplicar alterações sem a
aprovação final.

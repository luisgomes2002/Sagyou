# Roteiro manual — terminal nativo de agentes (Windows)

Execute este roteiro uma vez com **Codex** e uma vez com **Claude Code**. Antes
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
6. Faça uma pequena alteração, use **Encerrar e revisar diff**, recuse uma vez
   e aceite uma vez. A árvore original só deve mudar após a aceitação.

Falhas de inicialização, encerramento, `Ctrl+C` ou fechamento da janela devem
encerrar o PTY e revogar a sessão MCP; não devem aplicar alterações sem a
aprovação final.

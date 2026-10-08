# Avaliação do MarkItDown para extração de arquivos

Data da avaliação: 2026-10-08. Esta avaliação não altera o parser usado pelo aplicativo.

## Método

- **Parser atual:** `src/main/document-parser.ts`, com `pdfjs-dist`, `mammoth` e `xlsx`.
- **Candidato:** MarkItDown 0.1.8, instalado com os extras `pdf`, `docx` e `xlsx`, em Python 3.12.3.
- **Tempo:** uma conversão quente por arquivo. A inicialização do Node/Python e os imports ficaram fora do cronômetro; os números medem somente a conversão.
- **Qualidade:** caracteres, estrutura Markdown e cobertura do vocabulário. Cobertura é a porcentagem de tokens distintos do parser atual também presentes na saída do MarkItDown. Ela indica perda de texto, mas não substitui revisão visual de tabelas ou layouts.
- Os PDFs e DOCX são arquivos locais reais do aplicativo. Para XLSX não havia upload local; foi usada a planilha pública de referência do repositório oficial do MarkItDown. O HTML é `dist/linux-unpacked/LICENSES.chromium.html`, um artefato real de distribuição.

## Resultados

| Formato e amostra | Parser atual | MarkItDown | Cobertura de tokens | Leitura |
| --- | ---: | ---: | ---: | --- |
| PDF real, 11,7 KB | 8.561 caracteres, 506,7 ms | 8.855 caracteres, 582,3 ms | 100,0% | Mesma informação; MarkItDown preservou mais quebras de linha. |
| PDF real, 419,8 KB | 5.182 caracteres, 1.175,8 ms | 5.246 caracteres, 531,8 ms | 99,1% | Mesma informação; MarkItDown foi mais rápido nesta amostra. |
| PDF real, 1,53 MB | 35.352 caracteres, 630,4 ms | 36.972 caracteres, 2.342,1 ms | 99,9% | Mesma informação; parser atual foi 3,7 vezes mais rápido. |
| DOCX real, 13,1 KB | 7.380 caracteres, 261,5 ms | 7.801 caracteres, 296,3 ms | 100,0% | MarkItDown gerou 14 títulos Markdown; o atual retorna texto simples. |
| DOCX real, 259,1 KB | 11.262 caracteres, 238,4 ms | 11.516 caracteres, 259,3 ms | 100,0% | MarkItDown gerou 9 títulos Markdown; tempos equivalentes. |
| XLSX de referência, 11,6 KB | 573 caracteres, 102,6 ms | 808 caracteres, 33,6 ms | 96,2% | MarkItDown gerou 2 títulos e 31 linhas de tabela Markdown; o atual produz texto tabular simples. |
| HTML de distribuição, 15,1 MB | 50.000 caracteres, 50,8 ms, truncado | 14.756.932 caracteres, 1.807,3 ms | 95,9% do texto atual | O candidato processou todo o arquivo; é necessário aplicar limite antes de indexar. |

## Tamanho e distribuição no Electron

O ambiente de teste completo ocupou **342 MB descompactado** e **114 MB em arquivo tar.gz**. O `dist/linux-unpacked` atual ocupa 478 MB; portanto, uma inclusão semelhante aumentaria o diretório distribuído em aproximadamente **72%**, antes da variação por plataforma e do instalador.

Os maiores componentes do ambiente foram `pandas` (72 MB), `onnxruntime` (67 MB), `numpy` e suas bibliotecas (70 MB combinados), `cryptography` (16 MB) e `lxml` (12 MB). O runtime Python e esses binários nativos precisam ser embarcados para cada plataforma e arquitetura, testados nas três matrizes de release e executados por `child_process` ou por um serviço persistente. Isso também adiciona atualizações de segurança fora do ecossistema npm.

MarkItDown requer Python 3.10 ou superior. Seus extras para PDF, DOCX e XLSX incluem respectivamente `pdfminer.six`/`pdfplumber`, `mammoth`/`lxml` e `pandas`/`openpyxl`; parte deles duplica capacidades e dependências que o Sagyou já entrega em JavaScript.

## Decisão e implementação posterior

Após a avaliação, foi decidido incluir o MarkItDown para que o usuário instale apenas o Sagyou. A implementação usa `markitdown[all]` 0.1.8 e PyInstaller para gerar, em cada runner nativo de release, um executável autocontido. O usuário não precisa ter Python nem pacotes Python no computador.

O runtime Linux x64 gerado ocupa **260 MB** dentro de `dist/linux-unpacked/resources/markitdown`. Ele foi validado dentro do app descompactado com um PDF real. Windows e macOS são gerados nos respectivos runners do workflow de release. Cada conversão tem limite de arquivo de 20 MB, saída de 50.000 caracteres e timeout de 30 segundos.

O parser passa a aceitar também PowerPoint, Excel legado, EPUB, ZIP, imagens e áudio. Funcionalidades dependentes de serviços externos do MarkItDown, como transcrição de áudio e URLs do YouTube, continuam sujeitas à configuração e conectividade exigidas por esses serviços.

## Referências

- [README oficial do MarkItDown](https://github.com/microsoft/markitdown/blob/main/packages/markitdown/README.md)
- [Dependências e extras oficiais](https://github.com/microsoft/markitdown/blob/main/packages/markitdown/pyproject.toml)
- [Planilha de referência usada na medição](https://github.com/microsoft/markitdown/blob/main/packages/markitdown/tests/test_files/test.xlsx)

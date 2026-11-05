---
name: sagyou-migration
description: Use quando uma mudança do Sagyou adiciona ou altera tabelas, colunas ou formato persistido (SQLite do desktop, SQLite do app mobile, schema D1 do sync-server, arquivos em userData, formato do backup), ou quando dado antigo some ou não carrega depois de uma mudança.
---

# Sagyou: migrações de dados

Há **dados reais em produção nas máquinas dos usuários** (tasks, finanças, memórias). Não existe banco central para consertar depois: o que a migração estraga, estraga em cada instalação. Fonte da verdade: `CLAUDE.md` → "Data / Schema safety" e `docs/data-migrations.md`.

A spec precisa da seção de dados. Se algo é removido, renomeado ou apagado, a spec e o PR trazem `⚠️ Breaking schema change — existing data may be affected.`

## Onde cada coisa muda
- **Desktop (`apps/desktop/src/main/store.ts`):** uma função `migrate<Coisa>(db)` **idempotente**, chamada em `getDb()` depois das anteriores. Padrão: checar com `PRAGMA table_info(<tabela>)` e só então `ALTER TABLE … ADD COLUMN`. Não há número de versão: a função precisa ser segura em banco novo, antigo e já migrado.
- **Mobile (`apps/mobile/src/data/schema.ts`):** versionado por `PRAGMA user_version`. Acrescente um passo **no fim** de `MIGRATIONS`; nunca edite nem reordene um passo que já foi publicado.
- **Sync-server (`sync-server/schema.sql`, Cloudflare D1):** o arquivo é rodado de novo inteiro (`npm run db:schema`), então tudo é `CREATE … IF NOT EXISTS`. O servidor só guarda ids opacos, cifra e números: nunca acrescente coluna com conteúdo em claro.
- **Formato em memória e backup:** carga e import passam pelos normalizadores de `store/normalization.ts`; um caminho de carga novo usa os mesmos. Backup é a versão 7 (`backup-validation.ts`); mudança de formato exige migração explícita e teste de exportar e importar.

## Regras que perdem dados se esquecidas
- **Só aditivo:** campo novo opcional com default na leitura (`??`). Nunca remova, renomeie nem mude o tipo ou o formato de campo persistido sem migração e fallback para dado antigo.
- **Preserve o que não entende:** chaves desconhecidas de config e campos legados (`legacyFinancialMetadata`, `activeCodePathId`) sobrevivem a salvar e a ida e volta pelo backup.
- **`persistAll` apaga e reinsere:** a primeira gravação da sessão faz delete + insert das tabelas principais e esvazia `settings`. Por isso: nada de `ON DELETE CASCADE` que alcance tabela satélite (`memory`), e marcas de "migração já rodou" vão num arquivo próprio em `userData`, não em `settings`.
- **Validação nova que dado existente pode violar** precisa de um reparo em `backup-repair.ts`, ou trava o usuário fora do próprio backup.
- **Migração que apaga dado:** snapshot primeiro (cópia crua no main, `db.backup`), passos idempotentes, marca gravada só no fim, e não roda em build de dev sem variável explícita (o banco de dev tem sufixo, o resto de `userData` não). Modelo: `modules/ai/legacy-chat-removal.ts`.
- **Moeda é texto decimal**, nunca `number`.
- Ids e extensões vindos de backup são não confiáveis: passam por `safeAttachmentName`.

## Teste (antes do código)
- Banco **antigo** (sem a coluna/tabela) migra e mantém os dados; rodar a migração duas vezes não muda nada.
- Banco novo funciona.
- Carregar → salvar sem edição não perde campo nem muda valor (inclusive campos que a tela não mostra).
- Backup antigo importa; backup novo exporta e importa de volta igual.
- No mobile: instalação que pulou versões chega ao schema atual.

Arquivos de teste ficam ao lado: `apps/desktop/src/main/__tests__/store.test.ts`, `apps/mobile/src/**/__tests__`, `sync-server/src/__tests__`. Um arquivo só: `npm test -w sagyou -- <caminho>`.

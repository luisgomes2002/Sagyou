# Migrações de dados

Configurações e históricos antigos são normalizados somente ao carregar. A gravação preserva
campos desconhecidos de configuração, e conversas antigas sem `projectId` mantêm o fallback
legado. Nomes antigos de ferramentas são convertidos apenas quando uma chamada é executada;
o histórico salvo não é reescrito por essa compatibilidade.

Antes de importar um backup, o Sagyou cria um snapshot automático local. Para reverter uma
importação, importe esse snapshot em **Backup**. Não edite SQLite, arquivos de backup ou a
versão do backup manualmente: qualquer mudança de formato exige uma migração explícita e testes
de importação/exportação.

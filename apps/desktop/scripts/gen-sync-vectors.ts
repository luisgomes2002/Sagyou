// Generates packages/core/src/__tests__/fixtures/sync-vectors.json from the sync
// code as it stood BEFORE it moved to packages/core (plan 2026-10-31-mobile-app,
// Task 3). The JSON pins what goes over the wire — record payloads, hashes, the
// sealed batch, the derived ids, the recovery and pairing codes — so the core
// rewrite (noble/fflate instead of node crypto/zlib) can prove it is byte
// compatible with every desktop already syncing.
//
// Run once, from the repository root:  npx tsx apps/desktop/scripts/gen-sync-vectors.ts
// Do not regenerate after the move: the point is that the file came from the old code.
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { encodeBatch, type WireRecord } from '../src/main/modules/sync/sync-batch'
import {
  deriveKeys,
  keyProof,
  opaqueDeviceId,
  sealBatch,
  toRecoveryCode
} from '../src/main/modules/sync/sync-crypto'
import { encodePairCode } from '../src/main/modules/sync/sync-engine'
import {
  extractDataRecords,
  extractMemoryRecords,
  hashPayload
} from '../src/main/modules/sync/sync-records'
import type { AiMemory } from '../src/main/modules/ai/memory'

const T = '2026-10-30T12:00:00.000Z'

// One of every syncable unit, with the awkward bits on purpose: accents, emoji,
// keys out of order, decimal-string money, device-local fields that must be dropped.
const source = {
  projects: [
    {
      updatedAt: T,
      id: 'p1',
      name: 'Sagyou — ação 🚀',
      color: '#6366f1',
      order: 0,
      createdAt: T,
      description: 'Descrição com "aspas" e \\barra',
      columns: [
        { id: 'c1', name: 'Backlog', order: 0 },
        { id: 'c2', name: 'Done', order: 1 }
      ],
      links: [{ id: 'l1', label: 'GitHub', url: 'https://github.com' }],
      codePaths: [{ id: 'cp1', path: 'C:\\Users\\luis\\Sagyou' }],
      activeCodePathIds: ['cp1'],
      activeCodePathId: 'cp1'
    },
    {
      id: 'p2',
      name: 'Arquivado',
      color: '#000000',
      order: 1,
      archived: true,
      createdAt: T,
      updatedAt: T,
      columns: [{ id: 'c3', name: 'A fazer', order: 0 }]
    }
  ],
  tasks: [
    {
      id: 't1',
      projectId: 'p1',
      columnId: 'c1',
      title: 'Tarefa ñ',
      description: 'linha 1\nlinha 2',
      priority: 'high',
      dueDate: '2026-11-02',
      tags: ['b', 'a', 'á'],
      sprintId: 's1',
      images: [{ id: 'img1', name: 'print.png', ext: '.png', size: 1234, addedAt: T }],
      timeSpent: 3600,
      order: 0,
      createdAt: T,
      updatedAt: T
    },
    {
      id: 't2',
      projectId: 'p1',
      columnId: 'c2',
      title: 'Feita',
      priority: 'low',
      tags: [],
      order: 1,
      createdAt: T,
      updatedAt: T,
      completedAt: T
    }
  ],
  sprints: [
    { id: 's1', projectId: 'p1', name: 'Sprint 1', createdAt: T },
    { id: 's0', projectId: 'p1', name: 'Sprint 0', createdAt: T, closedAt: T }
  ],
  tombstones: [],
  notes: [
    {
      id: 'n1',
      projectId: 'p1',
      content: 'Nota 📝',
      color: '#fef08a',
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      linkedTaskIds: ['t1'],
      createdAt: T,
      updatedAt: T
    },
    {
      id: 'n2',
      projectId: 'p1',
      type: 'text',
      content: 'Bloco de texto',
      color: '#ffffff',
      x: 400,
      y: 900,
      width: 300,
      height: 40,
      fontSize: 18,
      createdAt: T,
      updatedAt: T
    }
  ],
  goals: [
    {
      id: 'g1',
      title: 'Ler livros',
      kind: 'quantity',
      target: 12,
      unit: 'livros',
      projectId: 'p1',
      entries: [{ id: 'ge1', value: 2, date: '2026-10-01', createdAt: T }],
      createdAt: T,
      updatedAt: T
    }
  ],
  habits: [
    {
      id: 'h1',
      name: 'Água',
      color: '#00aaff',
      completions: ['2026-10-30', '2026-10-29'],
      createdAt: T,
      updatedAt: T
    }
  ],
  lists: [
    {
      id: 'ft1',
      name: 'Conta',
      currency: 'BRL',
      profileId: 'personal',
      provider: 'Banco',
      actualBalance: '1000.10',
      legacyFinancialMetadata: { budget: 500 },
      createdAt: T,
      updatedAt: T,
      items: [{ id: 'i1', name: 'Pão', qty: 1.5, price: '5.25', done: false }],
      transactions: [
        {
          id: 'tx1',
          description: 'Mercado',
          amount: '1500.5',
          type: 'expense',
          date: '2026-10-30',
          category: 'Alimentação',
          details: [{ id: 'dt1', description: 'Arroz', amount: '20.00' }],
          receiptFileIds: ['f1'],
          createdAt: T
        },
        {
          id: 'tx2',
          description: 'Salário',
          amount: 1000,
          type: 'income',
          date: '2026-10-05'
        }
      ],
      goals: [
        { id: 'fg1', name: 'Reserva', targetAmount: '1000', targetMonth: 12, targetYear: 2026 }
      ],
      debts: [
        {
          id: 'd1',
          name: 'Cartão',
          originalAmount: '300',
          remainingAmount: '200',
          createdAt: T,
          updatedAt: T
        }
      ],
      yieldSources: [{ id: 'ys1', name: 'CDB', createdAt: T }],
      yieldEntries: [{ id: 'ye1', sourceId: 'ys1', date: '2026-10-01', amount: '10', createdAt: T }]
    },
    {
      id: 'ft2',
      name: '円',
      currency: 'JPY',
      profileId: 'trabalho',
      createdAt: T,
      updatedAt: T,
      items: [],
      transactions: [{ id: 'tx3', description: 'Ramen', amount: '1200', type: 'expense', date: '2026-10-10' }],
      goals: []
    }
  ],
  financialProfiles: [
    { id: 'personal', name: 'Minhas finanças', createdAt: T, updatedAt: T },
    {
      id: 'trabalho',
      name: 'Trabalho',
      createdAt: T,
      updatedAt: T,
      customCategories: ['Viagem', 'Almoço']
    }
  ],
  files: [
    {
      id: 'f1',
      name: 'recibo.pdf',
      ext: '.pdf',
      size: 4096,
      mimeType: 'application/pdf',
      projectId: 'p1',
      addedAt: T
    }
  ],
  timeBlocks: [
    {
      id: 'tb1',
      date: '2026-10-31',
      startTime: '09:00',
      endTime: '10:30',
      title: 'Foco',
      taskId: 't1',
      createdAt: T,
      updatedAt: T
    }
  ],
  routines: [
    {
      id: 'r1',
      title: 'Academia',
      days: [1, 3, 5],
      startTime: '07:00',
      endTime: '08:00',
      createdAt: T,
      updatedAt: T
    }
  ],
  activeTimers: [{ taskId: 't1', startedAt: 1 }],
  uiPreferences: { theme: 'dark' }
}

const memories: AiMemory[] = [
  {
    id: 'm1',
    projectId: 'p1',
    type: 'decisao',
    title: 'Cifra do sync',
    body: 'XChaCha20-Poly1305 — decidido em 2026-10-30.',
    tags: ['sync', 'cifra'],
    pinned: true,
    source: 'user',
    sourceConversationId: null,
    createdAt: T,
    updatedAt: T,
    lastAccessedAt: T,
    accessCount: 7,
    archivedAt: null
  }
]

const dataRecords = extractDataRecords(source)
const memoryRecords = extractMemoryRecords(memories)

// A fixed key so derived values are reproducible; the nonce inside the sealed
// batch is random, which is fine — the core only has to open it.
const keyHex = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, '0')).join(
  ''
)
const key = new Uint8Array(keyHex.match(/../g)!.map((h) => parseInt(h, 16)))
const { enc, id } = deriveKeys(key)
const deviceId = '0123456789abcdef0123456789abcdef'
const opaque = opaqueDeviceId(id, deviceId)
const batchId = '7f1c2e3a-0000-4000-8000-000000000001'
const wire: WireRecord[] = [
  ...dataRecords.slice(0, 5).map((r, i) => ({
    kind: r.kind,
    id: r.id,
    hlc: `000001793480000-000${i}-${deviceId}`,
    baseHlc: null,
    deleted: false,
    payload: r.payload
  })),
  {
    kind: 'task',
    id: 'gone',
    hlc: `000001793480001-0000-${deviceId}`,
    baseHlc: `000001793480000-0000-${deviceId}`,
    deleted: true
  }
]
const sealed = sealBatch(enc, opaque, batchId, encodeBatch(wire))
const url = 'https://sagyou-sync.exemplo.workers.dev'
const invite = 'abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-'

const out = {
  generatedFrom: 'apps/desktop/src/main/modules/sync (antes do packages/core)',
  source,
  dataRecords,
  memories,
  memoryRecords,
  payloadHashes: dataRecords.map((r) => ({ payload: r.payload, hash: hashPayload(r.payload) })),
  crypto: {
    keyHex,
    encHex: Buffer.from(enc).toString('hex'),
    idHex: Buffer.from(id).toString('hex'),
    deviceId,
    opaqueId: opaque,
    keyProof: keyProof(id),
    recoveryCode: toRecoveryCode(key, url),
    pairCode: encodePairCode(url, key, invite),
    url,
    invite
  },
  batch: { batchId, records: wire, sealed }
}

const target = join(__dirname, '..', '..', '..', 'packages', 'core', 'src', '__tests__', 'fixtures')
mkdirSync(target, { recursive: true })
writeFileSync(join(target, 'sync-vectors.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`sync-vectors.json: ${dataRecords.length} data records, ${memoryRecords.length} memory`)

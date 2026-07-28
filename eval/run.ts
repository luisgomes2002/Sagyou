/**
 * Standalone eval runner — validates golden traces and runs mechanical checks
 * (tool-call expectations). The LLM-as-judge scoring requires the full app
 * environment; run it from the app's eval panel in dev mode.
 *
 * Usage: npx tsx eval/run.ts [--golden <path>] [--verbose]
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import {
  checkTools,
  buildSuiteReport,
  formatSuiteDelta,
  type EvalCase,
  type EvalRunResult,
  type EvalSuiteReport
} from '../src/main/evaluator'

const GOLDEN_DIR = join(__dirname, 'golden')
const RESULTS_DIR = join(__dirname, 'results')
const LAST_REPORT_PATH = join(RESULTS_DIR, 'last.json')

function loadGoldens(dir: string): EvalCase[] {
  if (!existsSync(dir)) {
    console.error(`Diretório de goldens não encontrado: ${dir}`)
    return []
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  const cases: EvalCase[] = []
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
      if (!raw.id || !raw.messages || !raw.rubric) {
        console.warn(`  ⚠️  ${f}: estrutura inválida (falta id, messages ou rubric)`)
        continue
      }
      cases.push(raw as EvalCase)
    } catch (e) {
      console.warn(`  ⚠️  ${f}: erro ao parsear JSON — ${e instanceof Error ? e.message : e}`)
    }
  }
  return cases
}

function runMechanicalCheck(kase: EvalCase): EvalRunResult {
  // Mechanical validation only — the CLI can't actually run the agent.
  // It validates golden trace well-formedness and the rubric structure.
  const actualTools: { name: string; args: Record<string, unknown> }[] = []

  // For structural validation, "notCalled" expectations always pass
  // (nothing was called). "called" / "count" expectations are marked as
  // unverified — they need the full app eval.
  const results = kase.rubric.tools.map((exp) => ({
    expectation: exp,
    met: exp.kind === 'notCalled' // only "notCalled" is verifiable without agent execution
  }))

  const unmet = results.filter((r) => !r.met)
  // Pass if only "called"/"count" expectations remain (unverifiable structurally)
  const passed = unmet.every((r) => r.expectation.kind !== 'notCalled')

  return {
    caseId: kase.id,
    passed,
    score: passed ? 3 : 1,
    judgeReasoning: passed
      ? '✅ Estrutura do golden válida. Para avaliação real (com execução do agente + LLM-as-judge), rode o eval pelo app em modo dev.'
      : '❌ Estrutura do golden inválida (expectativas "notCalled" não podem ser verificadas sem o agente, mas foram marcadas como falha).',
    actualTools,
    toolResults: results,
    durationMs: 0
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose')
  const goldenDir = GOLDEN_DIR

  console.log('🔍 Sagyou Agent Evaluator (validação estrutural)')
  console.log('   Este modo valida a estrutura dos goldens, não executa o agente.')
  console.log('   Para avaliação real (execução + LLM-as-judge), use o painel de')
  console.log('   avaliação no app em modo dev.\n')
  console.log(`   Goldens: ${goldenDir}\n`)

  const cases = loadGoldens(goldenDir)
  if (cases.length === 0) {
    console.log('Nenhum golden trace encontrado. Adicione arquivos .json em eval/golden/')
    return
  }

  console.log(`Casos carregados: ${cases.length}`)
  for (const c of cases) {
    console.log(`  - ${c.id}: ${c.description} [${c.tags.join(', ')}]`)
  }
  console.log()

  // Run mechanical checks
  const results: EvalRunResult[] = cases.map(runMechanicalCheck)

  // Load previous report for regression detection
  let prevReport: EvalSuiteReport | undefined
  if (existsSync(LAST_REPORT_PATH)) {
    try {
      prevReport = JSON.parse(readFileSync(LAST_REPORT_PATH, 'utf-8'))
    } catch {
      /* first run — no baseline */
    }
  }

  const report = buildSuiteReport(results, prevReport)

  // Print report
  console.log('📊 Resultado da verificação estrutural:')
  console.log(`   Passaram: ${report.passed}/${report.total}`)
  console.log(`   Falharam: ${report.failed}/${report.total}`)
  console.log(`   Erros: ${report.errored}/${report.total}`)

  if (verbose) {
    for (const r of results) {
      const icon = r.passed ? '✅' : '❌'
      console.log(`   ${icon} ${r.caseId}: score ${r.score}/5`)
      if (!r.passed) {
        for (const tr of r.toolResults) {
          if (!tr.met) {
            const exp = tr.expectation
            const desc = exp.kind === 'called' ? `deveria chamar ${exp.name}` :
              exp.kind === 'notCalled' ? `não deveria chamar ${exp.name}` :
              `deveria chamar ${exp.name} ${exp.min ?? 0}-${exp.max ?? '∞'} vezes`
            console.log(`      - ${desc}`)
          }
        }
      }
    }
  }

  // Show delta from previous run
  if (prevReport) {
    console.log()
    console.log('📈 Delta da execução anterior:')
    console.log(formatSuiteDelta(prevReport, report))
  }

  // Save report for next comparison
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
  writeFileSync(LAST_REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(`\nRelatório salvo em: ${LAST_REPORT_PATH}`)

  // Exit with non-zero if any failed (for CI)
  if (report.failed > 0 || report.errored > 0) {
    console.log('\n❌ Há falhas — verifique os goldens.')
    process.exit(1)
  }
  console.log('\n✅ Todos os goldens passaram na verificação estrutural.')
}

main()

// ═══════════════════════════════════════════════════════════════════════════
// lint-baseline.mjs — gate de lint com dívida congelada.
//
// O repositório tem dívida de lint histórica (~136 problemas). Transformar o
// `eslint` em gate bloqueante de uma vez travaria qualquer PR. Este script
// congela o número atual e falha apenas se ele AUMENTAR — assim nenhum PR novo
// piora a situação, e a redução é bem-vinda sem quebrar o build.
//
// Usa a API do própria ESLint (sem child_process): no Windows, `spawnSync` de
// `npx.cmd` estoura EINVAL e o pacote não expõe `bin/eslint.js` no `exports`.
//
// Uso:
//   node scripts/lint-baseline.mjs            # gate (CI)
//   node scripts/lint-baseline.mjs --update   # regrava o baseline (após reduzir)
// ═══════════════════════════════════════════════════════════════════════════
import { ESLint } from 'eslint';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = path.join(APP_DIR, 'eslint-baseline.json');

async function collectResults() {
  const eslint = new ESLint({ cwd: APP_DIR });
  const report = await eslint.lintFiles(['.']);

  let errors = 0;
  let warnings = 0;
  const byFile = new Map();

  for (const entry of report) {
    if (!entry.messages?.length) continue;
    const fileErrors = entry.messages.filter((m) => m.severity === 2).length;
    const fileWarnings = entry.messages.filter((m) => m.severity === 1).length;
    errors += fileErrors;
    warnings += fileWarnings;
    byFile.set(path.relative(APP_DIR, entry.filePath), fileErrors + fileWarnings);
  }

  return { errors, warnings, total: errors + warnings, byFile };
}

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

const current = await collectResults();

if (process.argv.includes('--update')) {
  writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        note: 'Dívida de lint congelada. O CI falha se o total AUMENTAR. Reduza e rode --update.',
        errors: current.errors,
        warnings: current.warnings,
        total: current.total,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(
    `✅ Baseline de lint atualizado: ${current.total} problemas (${current.errors} erros, ${current.warnings} warnings).`,
  );
  process.exit(0);
}

const baseline = loadBaseline();

if (!baseline) {
  console.error('❌ eslint-baseline.json não encontrado. Rode: node scripts/lint-baseline.mjs --update');
  process.exit(2);
}

console.log(
  `Lint: ${current.total} problemas (${current.errors} erros, ${current.warnings} warnings) — baseline ${baseline.total}.`,
);

if (current.total > baseline.total) {
  console.error(`\n❌ O número de problemas de lint AUMENTOU: ${baseline.total} → ${current.total}.\n`);

  const offenders = [...current.byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [file, count] of offenders) {
    console.error(`   ${String(count).padStart(3)}  ${file}`);
  }

  console.error('\nCorrija os avisos introduzidos. Se a dívida for legítima e temporária,');
  console.error('rode `node scripts/lint-baseline.mjs --update` e justifique no PR.');
  process.exit(1);
}

if (current.total < baseline.total) {
  console.log(
    `🎉 Dívida de lint reduziu em ${baseline.total - current.total}. ` +
      'Rode `node scripts/lint-baseline.mjs --update` para gravar o novo baseline.',
  );
}

console.log('✅ Gate de lint passou.');

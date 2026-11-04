// ═══════════════════════════════════════════════════════════════════════════
// Bancada de teste do motor de geração de cursos
//
// Roda o MOTOR REAL (prompt, schema, cadeia de fallback) contra cada provedor
// configurado — um por vez, para medir cada um isoladamente — e contra a
// cadeia completa. Gera relatório em tabela e em JSON.
//
// Uso:
//   npx tsx scripts/test-course-engine.mjs            # todos + cadeia
//   npx tsx scripts/test-course-engine.mjs groq       # só um provedor
//   npx tsx scripts/test-course-engine.mjs --chain    # só a cadeia
//
// Só usa conteúdo SINTÉTICO: material de cliente nunca vai para provedor
// gratuito.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// ── Carrega .env.local (o Next não roda aqui) ──────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!match) continue;
  const value = match[2].replace(/^"|"$/g, '');
  if (!process.env[match[1]]) process.env[match[1]] = value;
}

const { generateCourseWithFallback } = await import('../src/domain/ai/course-engine');
const { readCompatProviders, buildProviderChain } = await import('../src/lib/ai-providers');

const REFERENCE = `Política interna de proteção de dados (material SINTÉTICO para teste).
1. Dados pessoais são qualquer informação que identifique ou possa identificar uma pessoa.
2. O tratamento exige base legal: consentimento, execução de contrato, obrigação legal ou legítimo interesse.
3. Incidentes devem ser comunicados ao DPO em até 24 horas.
4. Dados sensíveis (saúde, biometria, origem racial, religião) exigem proteção reforçada.
5. O titular pode solicitar acesso, correção, portabilidade e eliminação dos dados.
6. A retenção deve ser limitada à finalidade; descarte após o prazo definido na política.
7. Acesso é concedido por menor privilégio e revisado trimestralmente.`;

const PROMPT = 'Treinamento obrigatório de LGPD e proteção de dados para todos os colaboradores';
const SECTOR = 'juridico';

const filter = process.argv[2];
const providerCount = 10;

/** Fotografia do ambiente de IA, para isolar um provedor sem destruir os outros. */
const SLOT_FIELDS = ['BASE_URL', 'API_KEY', 'MODEL', 'LABEL', 'STRUCTURED', 'TIMEOUT_MS', 'MAX_TOKENS'];

function snapshot() {
  const saved = new Map();
  for (let i = 1; i <= providerCount; i++) {
    for (const field of SLOT_FIELDS) {
      const key = `AI_${i}_${field}`;
      if (process.env[key] !== undefined) saved.set(key, process.env[key]);
    }
  }
  return saved;
}

function restore(saved) {
  for (let i = 1; i <= providerCount; i++) {
    for (const field of SLOT_FIELDS) delete process.env[`AI_${i}_${field}`];
  }
  for (const [key, value] of saved) process.env[key] = value;
}

/**
 * Isola um slot: restaura a fotografia e remove os demais.
 * (A primeira versão deste script apagava os slots sem restaurar — o segundo
 * provedor era testado contra ambiente vazio e "passava" caindo no template.)
 */
function isolate(slot, saved) {
  restore(saved);
  for (let i = 1; i <= providerCount; i++) {
    if (i === slot) continue;
    for (const field of SLOT_FIELDS) delete process.env[`AI_${i}_${field}`];
  }
}

async function run(label) {
  const startedAt = Date.now();
  const result = await generateCourseWithFallback(PROMPT, SECTOR, REFERENCE);
  const elapsedMs = Date.now() - startedAt;
  const course = result.data;

  const lessonsOk = course.lessons.every((l) => l.content.length >= 200);
  const quizOk = course.quiz.every(
    (q) => q.correctIndex >= 0 && q.correctIndex < q.options.length && q.options.length >= 2,
  );

  return {
    label,
    provider: result.provider,
    fellBack: result.provider.startsWith('local'),
    elapsedMs,
    lessons: course.lessons.length,
    lessonsOk,
    quiz: course.quiz.length,
    quizOk,
    chars: course.lessons.reduce((sum, l) => sum + l.content.length, 0),
    title: course.title,
    errors: result.errors ?? [],
  };
}

function printRow(r) {
  const status = r.fellBack ? 'FALLBACK' : 'ok';
  console.log(
    `  ${r.label.padEnd(14)} ${status.padEnd(9)} ${String(r.elapsedMs + 'ms').padStart(8)}  ` +
      `aulas=${r.lessons}${r.lessonsOk ? '' : '(!)'} quiz=${r.quiz}${r.quizOk ? '' : '(!)'} ` +
      `chars=${r.chars} -> ${r.provider}`,
  );
  for (const error of r.errors) console.log(`     ! ${error.slice(0, 150)}`);
}

const configured = readCompatProviders();
console.log(`\nProvedores configurados: ${configured.length}`);
for (const [i, p] of configured.entries()) {
  console.log(`  ${i + 1}. ${p.label} — ${p.model} (${p.structured}, ${p.timeoutMs}ms)`);
}

const results = [];
const savedEnv = snapshot();

// ── 1. Cada provedor isolado ───────────────────────────────────────────────
console.log('\n── Cada provedor isolado ──────────────────────────────────');
for (let slot = 1; slot <= configured.length; slot++) {
  const label = configured[slot - 1].label;
  if (filter && filter !== '--chain' && !label.toLowerCase().includes(filter.toLowerCase())) continue;
  isolate(slot, savedEnv);
  const r = await run(label);
  results.push(r);
  printRow(r);
}

// ── 2. Cadeia completa (fallback real) ─────────────────────────────────────
if (!filter || filter === '--chain') {
  console.log('\n── Cadeia completa (fallback em ordem) ────────────────────');
  restore(savedEnv);
  console.log(`  ordem: ${buildProviderChain().map((p) => p.name).join(' -> ')}`);
  const r = await run('cadeia');
  results.push(r);
  printRow(r);
}

// ── 3. Relatório ───────────────────────────────────────────────────────────
const outDir = path.resolve(process.cwd(), 'test-results');
mkdirSync(outDir, { recursive: true });
const reportPath = path.join(outDir, 'course-engine-report.json');
writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf8');

const okCount = results.filter((r) => !r.fellBack).length;
console.log(`\n${okCount}/${results.length} execuções geraram conteúdo por IA (sem template).`);
console.log(`Relatório: ${reportPath}\n`);

process.exit(okCount === results.length ? 0 : 1);

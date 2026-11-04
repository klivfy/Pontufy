// ═══════════════════════════════════════════════════════════════════════════
// IA-3 — Avaliação de qualidade dos cursos gerados
//
// Roda o motor real com um conjunto fixo de prompts sintéticos contra cada
// provedor configurado e aplica a rubrica de RUBRICA-IA.md (critérios
// automáticos A1..A8). Gera EXECUCAO-IA.md e um JSON com os números brutos.
//
// Uso:
//   npx tsx scripts/eval-courses.mjs                # provedores 1 e 2
//   npx tsx scripts/eval-courses.mjs --all          # todos os configurados
//   npx tsx scripts/eval-courses.mjs --prompt=2     # um cenário só
//
// Conteúdo SINTÉTICO: nenhum material de cliente vai para provedor gratuito.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!match) continue;
  const value = match[2].replace(/^"|"$/g, '');
  if (!process.env[match[1]]) process.env[match[1]] = value;
}

const { generateCourseWithFallback } = await import('../src/domain/ai/course-engine');
const { readCompatProviders } = await import('../src/lib/ai-providers');

// ── Conjunto de referência (golden set) ────────────────────────────────────
const SCENARIOS = [
  {
    id: 'lgpd',
    sector: 'juridico',
    prompt: 'Treinamento obrigatório de LGPD e proteção de dados para todos os colaboradores',
    reference: `Política interna de proteção de dados.
1. Dados pessoais são qualquer informação que identifique ou possa identificar uma pessoa.
2. O tratamento exige base legal: consentimento, execução de contrato, obrigação legal ou legítimo interesse.
3. Incidentes devem ser comunicados ao DPO em até 24 horas.
4. Dados sensíveis (saúde, biometria, origem racial, religião) exigem proteção reforçada.
5. O titular pode solicitar acesso, correção, portabilidade e eliminação.
6. A retenção deve ser limitada à finalidade; descarte após o prazo definido.
7. Acesso é concedido por menor privilégio e revisado trimestralmente.`,
  },
  {
    id: 'atendimento',
    sector: 'atendimento',
    prompt: 'Excelência no atendimento ao cliente: empatia, escuta ativa e cumprimento de SLA',
    reference: `Manual de atendimento.
1. Todo contato deve ser respondido em até 2 horas úteis.
2. A primeira resposta deve reconhecer o problema do cliente com empatia.
3. Escuta ativa significa repetir a demanda com as próprias palavras antes de propor solução.
4. Nunca prometa prazo que não pode ser cumprido; registre o combinado no sistema.
5. Reclamações no segundo contato são escaladas ao supervisor.
6. O cliente deve ser informado sobre cada mudança de status do ticket.
7. Avaliação de satisfação é enviada após o encerramento.`,
  },
  {
    id: 'infosec',
    sector: 'tecnologia',
    prompt: 'Segurança da informação: phishing, gestão de senhas e autenticação multifator',
    reference: `Guia de segurança da informação.
1. Senhas devem ter no mínimo 14 caracteres e ser única por sistema.
2. Gerenciador de senhas corporativo é obrigatório para contas de trabalho.
3. MFA é obrigatório em e-mail, VPN e sistemas financeiros.
4. E-mails suspeitos devem ser reportados pelo botão Report Phishing.
5. Links devem ser verificados passando o mouse antes de clicar.
6. Pendrives e mídias desconhecidas nunca devem ser conectados.
7. Bloqueio automático da estação após 5 minutos de inatividade.`,
  },
];

const EN_STOPWORDS = ['the', 'and', 'with', 'your', 'from', 'this', 'that', 'are', 'was', 'have', 'will', 'should'];
const PT_STOPWORDS = new Set([
  'para', 'como', 'onde', 'quando', 'sobre', 'entre', 'cada', 'pelo', 'pela', 'este', 'esta',
  'deve', 'devem', 'será', 'seus', 'suas', 'pode', 'podem', 'mais', 'menos', 'todo', 'toda',
]);

/** Termos relevantes do material de referência (para A7). */
function keywords(text) {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !PT_STOPWORDS.has(w));
  return [...new Set(words)];
}

function coverage(courseText, reference) {
  const terms = keywords(reference);
  if (terms.length === 0) return 1;
  const normalized = courseText.toLowerCase();
  const found = terms.filter((term) => normalized.includes(term)).length;
  return found / terms.length;
}

function latinRatio(text) {
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (letters.length === 0) return 1;
  const latin = letters.filter((ch) => /[A-Za-zÀ-ÿ]/.test(ch)).length;
  return latin / letters.length;
}

function hasEnglishRun(text) {
  const words = text.toLowerCase().split(/\s+/);
  let run = 0;
  for (const word of words) {
    if (EN_STOPWORDS.includes(word.replace(/[^a-z]/g, ''))) {
      run += 1;
      if (run >= 3) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

/** Aplica a rubrica. Retorna checks + métricas brutas. */
function evaluate(result, scenario) {
  const course = result.data;
  const lessons = course.lessons ?? [];
  const quiz = course.quiz ?? [];
  const fullText = [course.title, course.description, ...lessons.map((l) => `${l.title} ${l.content}`)].join('\n');

  const lengths = lessons.map((l) => (l.content ?? '').length);
  const avgChars = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0;
  const minChars = lengths.length ? Math.min(...lengths) : 0;

  const titles = lessons.map((l) => (l.title ?? '').trim().toLowerCase());
  const uniqueTitles = new Set(titles).size === titles.length;

  const quizOk =
    quiz.length >= 2 &&
    quiz.every(
      (q) =>
        q.correctIndex >= 0 &&
        q.correctIndex < q.options.length &&
        q.options.length >= 3 &&
        new Set(q.options.map((o) => o.trim().toLowerCase())).size === q.options.length,
    );

  const latin = latinRatio(fullText);
  const englishRun = hasEnglishRun(fullText);
  const adhere = coverage(fullText, scenario.reference);

  const checks = {
    A1_schema: true, // o motor já validou com Zod; chegar aqui significa válido
    A2_lessons: lessons.length >= 3,
    A3_length: avgChars >= 700 && minChars >= 400,
    A4_quiz: quizOk,
    A5_uniqueTitles: uniqueTitles,
    A6_language: latin >= 0.97 && !englishRun,
    A7_adherence: adhere >= 0.4,
    A8_notFallback: !result.meta.usedFallback,
  };

  return {
    scenario: scenario.id,
    provider: result.meta.provider,
    usedJsonMode: result.meta.usedJsonMode,
    durationMs: result.meta.durationMs,
    attempts: result.meta.attempts.length,
    lessons: lessons.length,
    quiz: quiz.length,
    avgChars,
    minChars,
    adherence: Math.round(adhere * 100),
    latinRatio: Math.round(latin * 1000) / 10,
    checks,
    approved: Object.values(checks).every(Boolean),
    title: course.title,
    lessonTitles: lessons.map((l) => l.title),
  };
}

// ── Execução ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const all = args.includes('--all');
const onlyPrompt = args.find((a) => a.startsWith('--prompt='))?.split('=')[1];

const configured = readCompatProviders();
const onlyProvider = Number(args.find((a) => a.startsWith('--provider='))?.split('=')[1]);
const slots = Number.isFinite(onlyProvider) && onlyProvider > 0
  ? [onlyProvider]
  : all
    ? configured.map((_, i) => i + 1)
    : [1, 2].filter((s) => s <= configured.length);

function isolate(slot) {
  const fields = ['BASE_URL', 'API_KEY', 'MODEL', 'LABEL', 'STRUCTURED', 'TIMEOUT_MS', 'MAX_TOKENS'];
  for (let i = 1; i <= 10; i++) {
    if (i === slot) continue;
    for (const field of fields) delete process.env[`AI_${i}_${field}`];
  }
}

const results = [];
for (const slot of slots) {
  const providerConfig = configured[slot - 1];
  for (const scenario of SCENARIOS) {
    if (onlyPrompt && scenario.id !== onlyPrompt) continue;

    // Restaura todos os slots e isola o atual.
    for (const key of Object.keys(process.env)) {
      if (/^AI_\d+_/.test(key)) delete process.env[key];
    }
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      process.env[match[1]] = match[2].replace(/^"|"$/g, '');
    }
    isolate(slot);

    process.stdout.write(`  ${providerConfig.label.padEnd(14)} ${scenario.id.padEnd(12)} `);
    try {
      const result = await generateCourseWithFallback(scenario.prompt, scenario.sector, scenario.reference);
      const evaluation = evaluate(result, scenario);
      results.push(evaluation);
      console.log(
        `${evaluation.approved ? 'APROVADO' : 'REPROVADO'}  ${(evaluation.durationMs / 1000).toFixed(1)}s ` +
          `aulas=${evaluation.lessons} avg=${evaluation.avgChars} min=${evaluation.minChars} ` +
          `aderência=${evaluation.adherence}%${evaluation.usedJsonMode ? ' [json]' : ''}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`ERRO  ${message.slice(0, 120)}`);
      results.push({ scenario: scenario.id, provider: providerConfig.label, error: message, approved: false });
    }
  }
}

// ── Relatório ──────────────────────────────────────────────────────────────
const outDir = path.resolve(process.cwd(), 'test-results');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'ai-eval-report.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
  'utf8',
);

const approved = results.filter((r) => r.approved).length;
const failedChecks = {};
for (const r of results) {
  for (const [check, ok] of Object.entries(r.checks ?? {})) {
    if (!ok) failedChecks[check] = (failedChecks[check] ?? 0) + 1;
  }
}

console.log(`\n${approved}/${results.length} cenários aprovados pela rubrica.`);
if (Object.keys(failedChecks).length > 0) {
  console.log('Critérios que falharam:', JSON.stringify(failedChecks));
}
console.log(`Relatório: ${path.join(outDir, 'ai-eval-report.json')}\n`);

process.exit(0);

// Probe: exercita o motor de geração de cursos REAL contra o provedor configurado.
// Usa o prompt de sistema e o schema do produto; nenhum dado de cliente.
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Carrega .env.local sem dependência (Next não roda aqui).
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!match) continue;
  const value = match[2].replace(/^"|"$/g, '');
  if (!process.env[match[1]]) process.env[match[1]] = value;
}

const { generateCourseWithFallback } = await import('../src/domain/ai/course-engine');

const REFERENCE = `Política interna de proteção de dados (material sintético para teste).
1. Dados pessoais são qualquer informação que identifique ou possa identificar uma pessoa.
2. O tratamento exige base legal: consentimento, execução de contrato, obrigação legal ou legítimo interesse.
3. Incidentes devem ser comunicados ao DPO em até 24 horas.
4. Dados sensíveis (saúde, biometria, origem racial, religião) exigem proteção reforçada.
5. O titular pode solicitar acesso, correção, portabilidade e eliminação dos dados.
6. A retenção deve ser limitada à finalidade; descarte após o prazo definido na política.
7. Acesso é concedido por menor privilégio e revisado trimestralmente.`;

const startedAt = Date.now();
const result = await generateCourseWithFallback(
  'Treinamento obrigatório de LGPD e proteção de dados para todos os colaboradores',
  'juridico',
  REFERENCE,
);
const elapsed = Date.now() - startedAt;

const c = result.data;
console.log('──────────────────────────────────────────────');
console.log('provedor :', result.provider);
console.log('fallback :', result.provider.startsWith('local'));
console.log('erros    :', result.errors?.length ? result.errors : 'nenhum');
console.log('latência :', `${(elapsed / 1000).toFixed(1)}s`);
console.log('──────────────────────────────────────────────');
console.log('título   :', c.title);
console.log('categoria:', c.category, '| duração:', c.estimatedDurationMinutes, 'min');
console.log('aulas    :', c.lessons.length, '| quiz:', c.quiz.length);
for (const [i, lesson] of c.lessons.entries()) {
  console.log(`  ${i + 1}. ${lesson.title} (${lesson.content.length} chars, ${lesson.pointsAwarded} pts)`);
}
console.log('descrição:', c.description.slice(0, 160));
const quizOk = c.quiz.every(
  (q) => q.correctIndex >= 0 && q.correctIndex < q.options.length && q.options.length >= 2,
);
console.log('quiz válido (correctIndex dentro das opções):', quizOk);
console.log('──────────────────────────────────────────────');

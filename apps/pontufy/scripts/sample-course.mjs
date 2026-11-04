// Amostragem para o julgamento qualitativo (Q1..Q4 da RUBRICA-IA.md).
// Gera um curso e imprime estrutura + trechos — nenhum dado de cliente.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
delete process.env.AI_2_BASE_URL;
delete process.env.AI_3_BASE_URL;

const { generateCourseWithFallback } = await import('../src/domain/ai/course-engine');

const REFERENCE = `Guia de segurança da informação.
1. Senhas devem ter no mínimo 14 caracteres e ser única por sistema.
2. Gerenciador de senhas corporativo é obrigatório para contas de trabalho.
3. MFA é obrigatório em e-mail, VPN e sistemas financeiros.
4. E-mails suspeitos devem ser reportados pelo botão Report Phishing.
5. Links devem ser verificados passando o mouse antes de clicar.
6. Pendrives e mídias desconhecidas nunca devem ser conectados.
7. Bloqueio automático da estação após 5 minutos de inatividade.`;

const result = await generateCourseWithFallback(
  'Segurança da informação: phishing, gestão de senhas e autenticação multifator',
  'tecnologia',
  REFERENCE,
);

const c = result.data;
console.log('provedor:', result.meta.provider);
console.log('título  :', c.title);
console.log('descrição:', c.description.slice(0, 240));
console.log('\n--- aulas (título + 1º parágrafo) ---');
for (const l of c.lessons) {
  const first = l.content.split('\n').filter((x) => x.trim() && !x.trim().startsWith('#')).slice(0, 2).join(' ');
  console.log(`\n[${l.order}] ${l.title}`);
  console.log(first.slice(0, 380));
}
console.log('\n--- quiz ---');
for (const q of c.quiz) {
  console.log(`- ${q.question}`);
  console.log(`  opções: ${q.options.join(' | ')}`);
  console.log(`  correta: ${q.options[q.correctIndex]}`);
}

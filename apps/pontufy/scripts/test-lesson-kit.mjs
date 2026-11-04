// ═══════════════════════════════════════════════════════════════════════════
// Bancada do kit multi-formato (vídeo, slides, leitura fácil, checkpoint)
//
// Roda o MOTOR REAL (`enrichLessonsWithKits`) contra os provedores configurados,
// com duas aulas SINTÉTICAS, e mostra — por aula — quem respondeu, quantas
// cenas/slides saíram e qual a legibilidade do resumo.
//
// Uso:
//   npx tsx scripts/test-lesson-kit.mjs
//   npx tsx scripts/test-lesson-kit.mjs --off   # força derivação local
//
// Nenhum material de cliente é enviado: o texto abaixo é inventado.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env.local');
try {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2].replace(/^"|"$/g, '');
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
} catch {
  // Sem .env.local, roda com o que estiver no ambiente.
}

if (process.argv.includes('--off')) process.env.COURSE_KIT_GENERATION = 'off';

const { enrichLessonsWithKits } = await import('../src/domain/ai/lesson-kit-engine');
const { buildProviderChain } = await import('../src/lib/ai-providers');
const { kitMetrics } = await import('../src/domain/learning/lesson-kit');

const LESSONS = [
  {
    title: 'Por que a proteção de dados importa',
    content: `## O que é dado pessoal

Dado pessoal é qualquer informação que identifica alguém. Nome, CPF, e-mail e telefone são exemplos óbvios. Um número de matrícula também é, quando leva a uma pessoa.

## O risco real

Vazamento não é só multa. Um arquivo enviado para o e-mail errado pode expor salário, laudo médico e endereço de colegas. A LGPD prevê sanção, mas o dano que chega primeiro é a perda de confiança.

## O que fazer

Antes de compartilhar uma planilha, verifique se ela precisa conter nome e CPF. Na dúvida, anonimize. Use sempre o canal oficial da empresa.`,
  },
  {
    title: 'Rotina segura de compartilhamento',
    content: `## Regra do mínimo necessário

Compartilhe apenas as colunas que a outra área precisa. Enviar a base inteira "para garantir" aumenta o risco sem resolver nada.

## Canais permitidos

Use o drive corporativo e o e-mail da empresa. Pendrive pessoal e WhatsApp Web estão fora. Se precisar de exceção, peça autorização ao DPO.

## Quando algo dá errado

Comunique o DPO em até 24 horas. Descreva o que vazou, para quem e quando. Não apague evidências tentando consertar sozinho.`,
  },
];

const chain = buildProviderChain();
console.log(`Provedores configurados: ${chain.length ? chain.map((p) => p.name).join(' → ') : 'nenhum (só derivação)'}`);
console.log(`Modo: ${process.env.COURSE_KIT_GENERATION === 'off' ? 'derivação forçada (--off)' : 'IA com fallback'}\n`);

const started = Date.now();
const { kits, meta } = await enrichLessonsWithKits({ lessons: LESSONS, concurrency: 2 });

console.log(`Tempo total: ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`Kits gerados por IA: ${meta.generated} · derivados: ${meta.derived}`);
if (meta.provider) console.log(`Provedor: ${meta.provider}`);
if (meta.errors.length) console.log(`Erros: ${meta.errors.join(' | ').slice(0, 300)}`);
console.log('');

for (const [index, kit] of kits.entries()) {
  const m = kitMetrics(kit);
  console.log(`${index + 1}. ${LESSONS[index].title}`);
  console.log(`   slides: ${m.slides} | cenas: ${m.scenes} | vídeo: ${m.videoSeconds}s | checkpoint: ${m.checkpointQuestions}`);
  console.log(`   leitura fácil: ${m.words} palavras · Flesch ${m.flesch} (${m.level})`);
  console.log(`   resumo: ${kit.plain.summary.slice(0, 120)}…`);
  console.log(`   cena 1: "${kit.video.scenes[0]?.onScreen}" — ${kit.video.scenes[0]?.seconds}s`);
  console.log('');
}

const ok =
  kits.length === LESSONS.length &&
  kits.every((kit) => kit.slides.length >= 1 && kit.video.scenes.length >= 2 && kit.plain.summary.length >= 40);
console.log(ok ? '✅ kit utilizável em todas as aulas' : '❌ kit incompleto');
process.exit(ok ? 0 : 1);

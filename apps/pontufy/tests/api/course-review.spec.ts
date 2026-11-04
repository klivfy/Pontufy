import { test, expect } from '@playwright/test';
import {
  reviewCourseAgainstMaterial,
  reviewBlocksPublication,
} from '../../src/domain/ai/course-review';
import { makeValidCourse } from '../helpers/fake-provider';
import { startFakeProvider, configureFakeSlot, clearProviderEnv, type FakeProvider } from '../helpers/fake-provider';

// ═══════════════════════════════════════════════════════════════════════════
// A9 — revisão de aderência ao material (LLM-as-judge)
//
// O caso que originou este módulo: o quiz marcava "escanear o pen drive com
// antivírus" como correto, contra o material que dizia "pendrives desconhecidos
// NUNCA devem ser conectados". A rubrica automática do IA-3 aprovou o curso —
// só a revisão semântica pega negação invertida.
// ═══════════════════════════════════════════════════════════════════════════

const MATERIAL =
  'Política de segurança. Senhas devem ter no mínimo 14 caracteres. ' +
  'Pendrives e mídias desconhecidas nunca devem ser conectados à rede corporativa. ' +
  'MFA é obrigatório em e-mail e VPN.';

const course = makeValidCourse() as never;

let providers: FakeProvider[] = [];

test.beforeEach(() => {
  clearProviderEnv();
  providers = [];
});

test.afterEach(async () => {
  await Promise.all(providers.map((p) => p.close()));
  providers = [];
  clearProviderEnv();
});

async function fakeReview(payload: unknown, mode: 'ok' | 'garbage' | 'http-error' = 'ok'): Promise<FakeProvider> {
  // `fenced: false` de propósito: a revisão usa structured output puro. Se um
  // provedor devolver JSON em cerca markdown, o juiz falha e a revisão fica
  // 'unavailable' — que bloqueia a publicação. Para revisão, falhar fechado é
  // o comportamento desejado; não há modo JSON de recuperação aqui.
  const provider = await startFakeProvider({ mode, course: payload, fenced: false });
  providers.push(provider);
  return provider;
}

test.describe('A9 — revisão de curso contra o material', () => {
  test('sem material, a revisão é pulada e não bloqueia por si só', async () => {
    const review = await reviewCourseAgainstMaterial(course, undefined);

    expect(review.status).toBe('skipped');
    expect(reviewBlocksPublication(review)).toBe(false);
  });

  test('material muito curto não é revisado (evita falso conflito)', async () => {
    const review = await reviewCourseAgainstMaterial(course, 'curto demais');

    expect(review.status).toBe('skipped');
  });

  test('detecta contradição e registra regra, trecho e severidade', async () => {
    const provider = await fakeReview({
      conflicts: [
        {
          rule: 'Pendrives e mídias desconhecidas nunca devem ser conectados à rede corporativa.',
          finding: 'Quiz marca como correta a alternativa "Escanear com antivírus antes de abrir".',
          severity: 'high',
        },
      ],
      unverifiable: ['prazo de bloqueio de tela'],
    });
    configureFakeSlot(1, provider, { structured: 'schema' });

    const review = await reviewCourseAgainstMaterial(course, MATERIAL);

    expect(review.status).toBe('conflicts');
    if (review.status !== 'conflicts') return;
    expect(review.conflicts).toHaveLength(1);
    expect(review.conflicts[0].severity).toBe('high');
    expect(review.conflicts[0].rule).toContain('nunca devem ser conectados');
    expect(review.unverifiable).toContain('prazo de bloqueio de tela');
    // Curso com contradição NÃO pode ser publicado automaticamente.
    expect(reviewBlocksPublication(review)).toBe(true);
  });

  test('curso aderente passa limpo', async () => {
    const provider = await fakeReview({ conflicts: [], unverifiable: [] });
    configureFakeSlot(1, provider, { structured: 'schema' });

    const review = await reviewCourseAgainstMaterial(course, MATERIAL);

    expect(review.status).toBe('clean');
    expect(reviewBlocksPublication(review)).toBe(false);
  });

  test('juiz indisponível deixa a revisão como unavailable e bloqueia publicação', async () => {
    const provider = await fakeReview({}, 'http-error');
    configureFakeSlot(1, provider, { structured: 'schema' });

    const review = await reviewCourseAgainstMaterial(course, MATERIAL);

    expect(review.status).toBe('unavailable');
    // Sem revisão não há como afirmar conformidade.
    expect(reviewBlocksPublication(review)).toBe(true);
  });

  test('sem provedor configurado a revisão é unavailable, nunca "clean"', async () => {
    const review = await reviewCourseAgainstMaterial(course, MATERIAL);

    expect(review.status).toBe('unavailable');
    expect(reviewBlocksPublication(review)).toBe(true);
  });
});

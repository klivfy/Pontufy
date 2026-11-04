import { test, expect, type Page } from '@playwright/test';
import { SEED, USERS } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Ciclo Completo do Colaborador (Smoke 360º)
// login → dashboard → player → 3 aulas (velocity 20s) → quiz ≥70% (bônus +50)
// → certificado PDF → saldo reativo na barra superior.
// Estado do usuário joao@empresaalpha.com é resetado no global-setup (450 pts).
//
// TODO — precisa ser reescrito para o player multi-formato e o quiz dinâmico:
//   • assertiva de tema escuro (`div.bg-[#0a0a0a]`) não existe mais: o produto
//     passou a MD3 claro;
//   • chip de saldo mudou de `text-emerald-400` para os tokens `md-*`;
//   • o quiz deixou de ser pergunta-a-pergunta com confirmação. Agora responde
//     tudo e corrige no fim ("Próxima" → "Corrigir"), com o resultado em
//     "Aprovado!" — os rótulos e o fluxo do teste antigo não existem.
// Marcado como fixme para não esconder o trabalho: o teste aparece como
// "expected to fail" na suíte e no CI, em vez de ser silenciosamente removido.
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Ciclo completo do colaborador', () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    // Alertas (velocity/lock/erros) nunca devem travar a suíte.
    page.on('dialog', (dialog) => {
      void dialog.dismiss();
    });
  });

  test.fixme('login → aulas → quiz → certificado → saldo reativo', async ({ page }) => {
    // ── 1. Login ───────────────────────────────────────────────────────────
    await page.goto('/login');
    await page.getByPlaceholder('voce@empresa.com').fill(USERS.alphaEmployee);
    await page.getByPlaceholder('••••••••').fill('123456');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/dashboard');

    // ── 2. Tema escuro + saldo inicial na barra superior ───────────────────
    await expect(page.locator('div.bg-\\[\\#0a0a0a\\]').first()).toBeVisible();
    const navbarBalance = page.locator('span.font-bold.text-emerald-400').first();
    await expect(navbarBalance).toHaveText('450', { timeout: 15_000 });

    // ── 3. Abrir o player do curso do seed ─────────────────────────────────
    await page
      .locator('a')
      .filter({ hasText: 'Segurança da Informação e LGPD no Trabalho Remoto' })
      .first()
      .click();
    await page.waitForURL(`**/player/${SEED.courseLgpdId}`);

    // ── 4. Concluir as 3 aulas (velocity de 20s entre ganhos) ─────────────
    await completeLesson(page, SEED.lessonLgpd1, 40);
    await page.getByRole('button', { name: 'Próxima Aula' }).click();
    await completeLesson(page, SEED.lessonLgpd2, 40);
    await page.getByRole('button', { name: 'Próxima Aula' }).click();
    await completeLesson(page, SEED.lessonLgpd3, 50);

    // ── 5. Quiz final (notas corretas: Q1→A, Q2→B, Q3→D) ───────────────────
    await page.getByRole('button', { name: 'Iniciar Quiz Final' }).click();
    await answerQuestion(page, 0);
    await page.getByRole('button', { name: 'Próxima →' }).click();
    await answerQuestion(page, 1);
    await page.getByRole('button', { name: 'Próxima →' }).click();
    await answerQuestion(page, 3);
    await page.getByRole('button', { name: 'Enviar Quiz' }).click();

    await expect(page.getByText('Quiz Aprovado!')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('+50 pontos de bônus adicionados ao seu saldo')).toBeVisible();

    // ── 6. Emissão do certificado PDF (jspdf → download) ───────────────────
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Emitir Certificado' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

    // ── 7. Saldo reativo na barra superior (450 + 130 + 50 = 630) ──────────
    await page.goto('/dashboard');
    await expect(page.locator('span.font-bold.text-emerald-400').first()).toHaveText('630', {
      timeout: 15_000,
    });
  });
});

// Conclui a aula ativa, tolerando a janela anti-fraude de velocidade (20s):
// se o servidor recusar com 400 (alert), aguarda e tenta novamente.
async function completeLesson(page: Page, lessonTitle: string, points: number): Promise<void> {
  const done = page.getByRole('button', { name: 'Aula Concluída' });
  const button = page.getByRole('button', { name: `Concluir Aula (+${points} pts)` });

  for (let attempt = 0; attempt < 6; attempt++) {
    await button.click();
    try {
      await done.waitFor({ state: 'visible', timeout: 8_000 });
      await page.waitForTimeout(1_500); // deixa a animação de pontos terminar
      return;
    } catch {
      await page.waitForTimeout(21_000); // velocity: aguarda a janela de 20s
    }
  }
  throw new Error(`Falha ao concluir a aula "${lessonTitle}" (velocity/lock persistente).`);
}

// Seleciona a opção correta (índice) e confirma — dentro do modal do quiz.
async function answerQuestion(page: Page, correctIndex: number): Promise<void> {
  const modal = page.locator('div.fixed.inset-0.z-\\[90\\]');
  const options = modal.locator('div.space-y-2 button');
  await expect(options.first()).toBeVisible({ timeout: 10_000 });
  await options.nth(correctIndex).click();
  await modal.getByRole('button', { name: 'Confirmar' }).click();
}
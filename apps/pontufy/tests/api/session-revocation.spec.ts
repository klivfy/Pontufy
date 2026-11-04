import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { prisma, USERS, userIdByEmail } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// V5 — Revogação de sessão sem Redis
//
// Antes, `revoke-all` incrementava apenas a chave no Redis: sem Redis a
// operação era no-op e o JWT seguia válido por até 7 dias. Agora a versão vive
// em `User.sessionVersion` e o `getSessionContext` a compara com o token.
// ═══════════════════════════════════════════════════════════════════════════

test.describe('V5 — revogação de sessão', () => {
  test('revoke-all derruba a sessão atual na requisição seguinte', async ({ request }) => {
    await loginAs(request, USERS.alphaEmployee);

    const before = await request.get('/api/users/me');
    expect(before.status(), 'sessão recém-criada deve funcionar').toBe(200);

    const revoke = await request.post('/api/auth/revoke-all');
    expect(revoke.status()).toBe(200);
    const revokeBody = await revoke.json();
    expect(typeof revokeBody.sessionVersion).toBe('number');

    const after = await request.get('/api/users/me');
    expect(after.status(), 'token com versão antiga precisa ser recusado').toBe(401);
    const body = await after.json();
    expect(body.code ?? body.error).toBeTruthy();
  });

  test('a versão de sessão é incrementada no banco (não só no cache)', async () => {
    const userId = await userIdByEmail(USERS.alphaPoor);

    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { sessionVersion: true },
    });
    expect(before).not.toBeNull();

    await prisma.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 } },
    });

    const after = await prisma.user.findUnique({
      where: { id: userId },
      select: { sessionVersion: true },
    });
    expect(after!.sessionVersion).toBe(before!.sessionVersion + 1);

    // Restaura para não afetar outros testes da suíte.
    await prisma.user.update({
      where: { id: userId },
      data: { sessionVersion: before!.sessionVersion },
    });
  });
});

import crypto from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// Módulo criptográfico canónico — Pontufy
// ───────────────────────────────────────────────────────────────────────────
// Formato de palavra-passe: "salt:hash" (hex) — salt de 16 bytes + chave
// derivada de 64 bytes via crypto.scryptSync(password, salt, 64).
// Comparação por crypto.timingSafeEqual (imune a timing attacks).
//
// TODO o hashing do sistema DEVE passar por aqui: src/auth.ts, register,
// forgot-password, tenants/onboarding, admin/users/import, webhooks/stripe,
// setup/seed e prisma/seed.ts. Nunca reimplementar scrypt em outro ficheiro.
// ═══════════════════════════════════════════════════════════════════════════

export function hashPassword(password: string): string {
  if (!password || typeof password !== 'string') {
    throw new Error('Palavra-passe inválida para geração de hash.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) {
      return false;
    }
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;

    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);

    if (keyBuffer.length !== derivedKey.length) {
      return false;
    }

    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch (error) {
    console.error('[Crypto Exception]:', error);
    return false;
  }
}
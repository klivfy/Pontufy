import { handlers } from '@/auth';
import { NextResponse, type NextRequest } from 'next/server';
import { getClientIp, ipRateLimit } from '@/lib/security/auth-guard';

// ═══════════════════════════════════════════════════════════════════════════
// Rate limiting por IP antes do NextAuth (janela deslizante).
//
// Padrão: 5 tentativas / 15 min. O contador é POR IP, não por conta — e aí
// mora um problema real descoberto na suíte E2E: uma empresa inteira atrás do
// mesmo NAT (saída única para a internet) esgota as 5 tentativas e ninguém
// mais consegue entrar por 15 minutos, mesmo com credenciais corretas.
//
// Por isso os dois números são configuráveis por ambiente. O padrão continua
// conservador; quem tem IP compartilhado (rede corporativa, VPN, escritório)
// sobe o limite sem alterar código.
//
// Fail-open quando o Redis está indisponível: `ipRateLimit` devolve allowed.
// ═══════════════════════════════════════════════════════════════════════════

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const AUTH_MAX = positiveInt(process.env.AUTH_RATE_LIMIT_MAX, 5);
const AUTH_WINDOW = positiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS, 15 * 60);

export const { GET } = handlers;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const result = await ipRateLimit(ip, 'auth', AUTH_MAX, AUTH_WINDOW);

  if (!result.allowed) {
    const minutes = Math.max(1, Math.round(AUTH_WINDOW / 60));
    return NextResponse.json(
      {
        error: `Muitas tentativas de login. Aguarde ${minutes} minutos antes de tentar novamente.`,
        retryAfter: result.resetIn,
      },
      { status: 429 },
    );
  }

  return handlers.POST(request);
}

import type { NextAuthConfig } from 'next-auth';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

// NODE_ENV is 'production' during `next build` too (not just at request-serving
// runtime), and Turbopack evaluates this module while collecting page data — so
// throwing unconditionally here fails every build, including Preview deploys that
// legitimately don't carry a Production-only secret yet. NEXT_PHASE distinguishes
// the build step from an actual running server; only the latter should crash.
const isBuildPhase = process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;

if (!process.env.AUTH_SECRET && process.env.NODE_ENV === 'production' && !isBuildPhase) {
  // Fail closed: the fallback below is a fixed, publicly-readable string. Silently
  // signing production JWTs with it would let anyone who reads this source forge a
  // session (including super_admin) — crash loudly instead of degrading silently.
  throw new Error(
    '[SECURITY] AUTH_SECRET não está definido em produção. Configure a variável de ' +
      'ambiente antes de iniciar a aplicação.',
  );
}

const authSecret = process.env.AUTH_SECRET || 'pontufy-dev-insecure-replace-in-production';

export const authConfig = {
  secret: authSecret,
  trustHost: true,
  providers: [],
  callbacks: {
    // Edge-safe authorization gate. NOTE: with a custom proxy handler (proxy.ts)
    // this only takes effect when returning a Response (next-auth/lib/index.js
    // runs the handler branch before the `!authorized` redirect). Kept as the
    // authoritative allowlist for public routes — the handler relies on it for
    // redirect semantics and any future matcher widening.
    async authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const pathname = nextUrl.pathname;

      const isPublicRoute =
        pathname.startsWith('/login') ||
        pathname.startsWith('/register') ||
        pathname.startsWith('/auth') ||
        pathname.startsWith('/forgot-password') ||
        pathname.startsWith('/reset-password') ||
        pathname.startsWith('/superadmin/login') ||
        pathname.startsWith('/termos') ||
        pathname.startsWith('/privacidade') ||
        pathname.startsWith('/api/auth') ||
        pathname.startsWith('/api/webhooks');

      if (isLoggedIn && pathname === '/login') {
        return Response.redirect(new URL('/dashboard', nextUrl));
      }

      if (!isLoggedIn && !isPublicRoute) {
        return false;
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tenantId = user.tenantId;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.tenantId = token.tenantId as string;
        session.user.role = token.role as string;
      }
      return session;
    }
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60,
    // 7.5 — Rotação/renovação contínua: re-emite o JWT (sem relogar) quando o
    // cookie tem mais de 24h, renovando a expiração de sessões ativas.
    updateAge: 24 * 60 * 60,
  },
  cookies: {
    sessionToken: {
      // 7.4 — __Host- em produção: exige Secure + path=/ + sem Domain (mais
      // restritivo que __Secure-). Em dev usa nome simples (HTTP local).
      name: process.env.NODE_ENV === 'production'
        ? '__Host-authjs.session-token'
        : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
} satisfies NextAuthConfig;

import type { NextConfig } from "next";

// ═══════════════════════════════════════════════════════════════════════════
// Headers de segurança (V10)
//
// O app não tinha NENHUM header de segurança: sem HSTS, sem nosniff, sem
// Referrer-Policy, sem CSP. Toda defesa contra XSS dependia exclusivamente do
// escape do React — e não é assim que se defende em profundidade.
//
// A CSP entra em **Report-Only** de propósito: habilitar bloqueio sem observar
// violações reais quebraria a aplicação em produção (Next injeta scripts
// inline no bootstrap). O passo 2 — depois de coletar relatórios — é migrar
// para CSP bloqueante com nonce.
// ═══════════════════════════════════════════════════════════════════════════

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // Next App Router injeta script inline de bootstrap. Sem nonce, é preciso
  // 'unsafe-inline' — motivo pelo qual o modo bloqueante fica para o passo 2.
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co https://api.resend.com https://api.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  // Força HTTPS por 2 anos (inclui subdomínios). Só faz sentido em produção.
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma", "@prisma/engines"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "**.amazonaws.com" },
    ],
  },
  async headers() {
    return [
      {
        // Aplica a todas as rotas — inclusive /api, onde o proxy não chega.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

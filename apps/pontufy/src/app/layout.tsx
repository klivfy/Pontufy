import type { Metadata, Viewport } from "next";
import { Google_Sans_Flex, Geist_Mono } from "next/font/google";
import AuthProvider from "@/components/providers/AuthProvider";
import AppShell from "@/components/layout/AppShell";
import DynamicThemeProvider from "@/components/theme/DynamicThemeProvider";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

// Tipografia M3: Google Sans Flex é a família padrão de produto do Google e está
// publicada no Google Fonts (v26+), então `next/font/google` a baixa no build e
// serve self-hosted — sem requisição a terceiros em runtime e sem FOUT.
//
// É uma fonte variável (wght 1–1000, opsz 6–144, wdth, slnt, GRAD, ROND). O eixo
// `opsz` fica habilitado para o navegador ajustar o desenho em títulos grandes.
// É uma fonte variável (wght 1–1000, opsz 6–144, wdth, slnt, GRAD, ROND). O eixo
// `opsz` fica habilitado para o navegador ajustar o desenho em títulos grandes.
const googleSansFlex = Google_Sans_Flex({
  variable: "--font-google-sans-flex",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  // O next/font não tem métricas de fallback para esta família e o build imprime
  // `Warning: Failed to find font override values for font 'Google Sans Flex'`.
  // É ruído esperado, não falha: o @font-face é gerado normalmente e a pilha de
  // fallback vive em `--font-sans` (globals.css). Desligar o ajuste automático
  // documenta a intenção — o efeito prático é o mesmo (sem `size-adjust`).
  adjustFontFallback: false,
});

// Mono só para hashes/verificação de certificado e blocos de código.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pontufy — Plataforma de Gamificação Corporativa",
  description:
    "Transforme treinamentos corporativos em experiências engajadoras com gamificação, IA e recompensas reais.",
  applicationName: "Pontufy",
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/icon-192x192.png",
  },
  metadataBase: new URL("https://pontufy.com"),
  other: {
    lomadee: "2324685",
  },
  // Explicit meta tags for lomadee verification
  verification: {
    other: {
      lomadee: "2324685",
    },
  },
};

export const viewport: Viewport = {
  // M3 light surface-container-low — barra do navegador acompanha o tema claro.
  themeColor: "#f7f4ef",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${googleSansFlex.variable} ${geistMono.variable} font-sans h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-md-surface-container-low text-md-on-surface">
        <AuthProvider>
          <DynamicThemeProvider>
            <ToastProvider>
              <AppShell>{children}</AppShell>
            </ToastProvider>
          </DynamicThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

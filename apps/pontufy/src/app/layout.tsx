import type { Metadata } from "next";
import { Roboto, Geist_Mono } from "next/font/google";
import AuthProvider from "@/components/providers/AuthProvider";
import AppShell from "@/components/layout/AppShell";
import DynamicThemeProvider from "@/components/theme/DynamicThemeProvider";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

// Tipografia Pontufy (MD3): Google Sans Flex é a família corporativa, mas NÃO
// está publicada no Google Fonts nem licenciada para redistribuição local — o
// carregamento seguro via `next/font/google` é impossível. Estratégia: Roboto
// (webfont real, --font-roboto) entra no stack `--font-sans` do globals.css:
//   "Google Sans Flex", "Google Sans", var(--font-roboto), "Roboto", sans-serif
// Navegadores com Google Sans instalada localmente a usam; os demais caem em
// Roboto com métricas visuais equivalentes (mesmo DNA tipográfico).
const roboto = Roboto({
  variable: "--font-roboto",
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pontufy — Plataforma de Gamificação Corporativa",
  description: "Transforme treinamentos corporativos em experiências engajadoras com gamificação, IA e recompensas reais.",
  applicationName: "Pontufy",
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/icon-192x192.png",
  },
  metadataBase: new URL("https://pontufy.com"),
  other: {
    lomadee: "2324685",
    "theme-color": "#0a0a0a",
  },
  // Explicit meta tags for lomadee verification
  verification: {
    other: {
      lomadee: "2324685",
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${roboto.variable} ${geistMono.variable} font-sans h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-brand-gray">
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

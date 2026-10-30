'use client';

import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import Navbar from './Navbar';
import Footer from './Footer';

const NO_SHELL_ROUTES = [
  '/login',
  '/register',
  '/auth',
  '/forgot-password',
  '/reset-password',
  '/superadmin',
  '/admin',
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const isAuthPage = NO_SHELL_ROUTES.some((r) => pathname.startsWith(r));

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <>
      <Navbar />
      <div className="pt-[72px] flex-1">
        {/* Transição de página M3 (5.5): fade + slide sutil, chaveada por rota.
            Com prefers-reduced-motion, renderiza estático (sem animação). */}
        <motion.main
          key={pathname}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
          className="min-h-[60vh]"
        >
          {children}
        </motion.main>
      </div>
      <Footer />
    </>
  );
}
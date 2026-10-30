'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { LayoutDashboard, LogOut, ShieldCheck, User, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { signOutAll } from '@/components/auth/signOutAll';
import { MD3SearchBar } from '@/components/ui/MD3SearchBar';

export interface MD3DrawerLink {
  href: string;
  label: string;
}

interface MD3NavigationDrawerProps {
  open: boolean;
  onClose: () => void;
  links: MD3DrawerLink[];
  activeHref: string;
}

// MD3 Navigation Drawer — modal deslizante em mobile (direita, 320dp),
// com backdrop e bloqueio de scroll. Em desktop o Header mantém a navegação
// colapsável inline (hidden md:flex), conforme o padrão MD3.
export function MD3NavigationDrawer({ open, onClose, links, activeHref }: MD3NavigationDrawerProps) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const role = (session?.user as { role?: string } | undefined)?.role;
  const isActive = (href: string) => pathname === href || activeHref === href;

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.button
            type="button"
            aria-label="Fechar menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 w-full h-full bg-black/60"
          />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            className="absolute top-0 right-0 bottom-0 w-[320px] max-w-[85vw] bg-md-surface border-l border-md-outline shadow-2xl flex flex-col"
          >
            {/* Header do drawer */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-md-outline flex-shrink-0">
              <Link href="/dashboard" onClick={onClose} className="text-lg font-black tracking-tight text-white">
                <span className="text-md-primary-container">Pontu</span>fy
              </Link>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar menu"
                className="p-2 text-gray-400 hover:text-white transition-colors rounded-full"
              >
                <X size={20} />
              </button>
            </div>

            {/* Busca MD3 (mobile) */}
            <div className="px-4 py-3 border-b border-md-outline flex-shrink-0">
              <MD3SearchBar compact />
            </div>

            {/* Navegação */}
            <nav className="flex-1 overflow-y-auto px-2 py-3">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                    isActive(link.href)
                      ? 'bg-md-primary/20 text-white font-bold'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              ))}

              {role === 'admin_rh' && (
                <Link
                  href="/admin"
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-md-secondary mt-1 transition-colors"
                >
                  <LayoutDashboard size={16} />
                  Painel RH
                </Link>
              )}
              {role === 'super_admin' && (
                <Link
                  href="/superadmin"
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-violet-400 mt-1 transition-colors"
                >
                  <ShieldCheck size={16} />
                  Console
                </Link>
              )}
            </nav>

            {/* Rodapé do usuário */}
            {status === 'authenticated' && (
              <div className="border-t border-md-outline px-4 py-4 flex-shrink-0">
                <div className="flex items-center gap-3 mb-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-md-primary flex items-center justify-center text-white font-black">
                      {session?.user?.name?.[0]?.toUpperCase() ?? <User size={18} />}
                    </div>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-md-surface ${
                        isOnline ? 'bg-emerald-500' : 'bg-red-500'
                      }`}
                      title={isOnline ? 'Conectado' : 'Offline'}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{session?.user?.name}</p>
                    <p className="text-xs text-gray-500 truncate">{session?.user?.email}</p>
                  </div>
                </div>
                <Link
                  href="/profile"
                  onClick={onClose}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                >
                  <User size={15} />
                  Meu Perfil
                </Link>
                <button
                  type="button"
                  onClick={() => signOutAll('/login')}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                >
                  <LogOut size={15} />
                  Sair da conta
                </button>
              </div>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
'use client';
import { useState, useRef, useEffect } from 'react';
import { User, LogOut, LayoutDashboard, ShieldCheck, Building2, Menu, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { signOutAll } from '@/components/auth/signOutAll';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { PointsChip } from '@/components/ui/Chip';
import { MD3SearchBar } from '@/components/ui/MD3SearchBar';
import { MD3NavigationDrawer } from '@/components/layout/MD3NavigationDrawer';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const pointsBalance = useStore((s) => s.currentPointsBalance);
  const { isOnline } = useNetworkStatus();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathnameRef = useRef(pathname);

  const role = (session?.user as { role?: string } | undefined)?.role;

  useEffect(() => {
    if (pathnameRef.current !== pathname) {
      pathnameRef.current = pathname;
      setIsMobileMenuOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 30);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  const navLinks = [
    { href: '/dashboard', label: 'Início' },
    { href: '/cursos', label: 'Meus Cursos' },
    { href: '/skills', label: 'Trilhas' },
    { href: '/battles', label: 'Batalhas' },
    { href: '/loja', label: 'Benefícios' },
    { href: '/wallet', label: 'Carteira' },
    { href: '/certificados', label: 'Certificados' },
  ];

  const isActive = (href: string) => pathname === href;

  return (
    <>
      <nav
        className={`fixed top-0 w-full z-50 px-4 sm:px-8 py-3 transition-all duration-500 ${
          isScrolled || isMobileMenuOpen
            ? 'bg-md-surface/96 backdrop-blur-sm shadow-lg shadow-black/50'
            : 'bg-gradient-to-b from-black/80 via-black/40 to-transparent'
        }`}
      >
        <div className="flex items-center justify-between">
          {/* Left: Logo + Desktop links */}
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="text-xl font-black tracking-tight text-white flex-shrink-0">
              <span className="text-md-primary-container">Pontu</span>fy
            </Link>

            <div className="hidden md:flex items-center gap-0.5">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors rounded-full ${
                    isActive(link.href)
                      ? 'text-white font-bold bg-md-primary/20'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {link.label}
                </Link>
              ))}

              {role === 'admin_rh' && (
                <Link
                  href="/admin"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-md-secondary hover:text-md-secondary/80 transition-colors ml-1"
                >
                  <LayoutDashboard size={14} />
                  Painel RH
                </Link>
              )}
              {role === 'super_admin' && (
                <Link
                  href="/superadmin"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-violet-400 hover:text-violet-300 transition-colors ml-1"
                >
                  <ShieldCheck size={14} />
                  Console
                </Link>
              )}
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* Points badge (terciário #a1c0ae — padrão MD3 obrigatório) */}
            <Link href="/wallet">
              <PointsChip value={pointsBalance} />
            </Link>

            {/* Notification bell */}
            <NotificationBell />

            {/* Search (desktop) — MD3SearchBar expansível integrada ao useStore */}
            <div className="hidden md:flex relative items-center">
              <MD3SearchBar />
            </div>

            {/* User menu (desktop) */}
            {status === 'authenticated' && (
              <div className="hidden md:block relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="relative w-8 h-8 rounded-full bg-md-primary flex items-center justify-center hover:bg-md-primary-container transition-colors text-white font-black text-sm"
                >
                  {session?.user?.name?.[0]?.toUpperCase() ?? <User size={16} />}
                  {/* Badge de status de conexão (3.4) */}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-md-surface ${
                      isOnline ? 'bg-emerald-500' : 'bg-red-500'
                    }`}
                    title={isOnline ? 'Conectado' : 'Offline'}
                  />
                </button>
                {/* Badge de nível/role (3.4) */}
                {role && (
                  <span className="absolute -top-1.5 -right-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-md-tertiary text-md-on-tertiary">
                    {role === 'super_admin' ? 'SA' : role === 'admin_rh' ? 'RH' : 'EM'}
                  </span>
                )}

                {isDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-md-surface-container rounded-xl shadow-2xl border border-md-outline py-1 overflow-hidden">
                    <div className="px-4 py-3 border-b border-md-outline">
                      <p className="text-sm font-semibold text-white truncate">
                        {session?.user?.name}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {session?.user?.email}
                      </p>
                    </div>
                    <Link
                      href="/profile"
                      onClick={() => setIsDropdownOpen(false)}
                      className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/5 transition-colors font-medium"
                    >
                      <User size={15} />
                      Meu Perfil
                    </Link>
                    {role === 'super_admin' && (
                      <Link
                        href="/superadmin/tenants"
                        onClick={() => setIsDropdownOpen(false)}
                        className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-violet-300 hover:bg-white/5 transition-colors font-medium"
                      >
                        <Building2 size={15} />
                        Trocar de locatário
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => signOutAll('/login')}
                      className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors font-medium"
                    >
                      <LogOut size={15} />
                      Sair da conta
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Mobile: hamburger */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Abrir menu de navegação"
              className="md:hidden p-2 text-gray-400 hover:text-white transition-colors"
            >
              {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile: MD3 Navigation Drawer (modal deslizante) */}
      <MD3NavigationDrawer
        open={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        links={navLinks}
        activeHref={pathname}
      />
    </>
  );
}

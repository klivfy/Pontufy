'use client';

import { useState, useEffect, useMemo, createContext, useContext, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutAll } from '@/components/auth/signOutAll';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import {
  LayoutDashboard,
  BarChart3,
  Sparkles,
  Users,
  Gift,
  Settings,
  FileText,
  ShieldCheck,
  Menu,
  X,
  ChevronDown,
  LogOut,
  CreditCard,
  Building2,
} from 'lucide-react';
import Wordmark from '@/components/brand/Wordmark';

interface AdminLayoutContextType {
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
}

const AdminLayoutContext = createContext<AdminLayoutContextType | null>(null);

export function useAdminLayout() {
  const ctx = useContext(AdminLayoutContext);
  if (!ctx) throw new Error('useAdminLayout must be used within AdminLayoutProvider');
  return ctx;
}

interface NavItem {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  external?: boolean;
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Visão Geral',
    items: [
      { href: '/admin', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
      { href: '/admin/analytics', icon: <BarChart3 size={20} />, label: 'Analytics' },
    ],
  },
  {
    label: 'Cursos & Treinamentos',
    items: [
      { href: '/admin/wizard', icon: <Sparkles size={20} />, label: 'IA Cursos' },
      { href: '/admin/skills', icon: <FileText size={20} />, label: 'Trilhas de Habilidade' },
    ],
  },
  {
    label: 'Colaboradores',
    items: [
      { href: '/admin/team', icon: <Users size={20} />, label: 'Equipe' },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { href: '/admin/rewards', icon: <Gift size={20} />, label: 'Recompensas' },
    ],
  },
  {
    label: 'Configurações',
    items: [
      { href: '/admin/settings/branding', icon: <Settings size={20} />, label: 'Marca & Identidade' },
      { href: '/admin/billing', icon: <CreditCard size={20} />, label: 'Assinatura' },
      { href: '/admin/audit-logs', icon: <ShieldCheck size={20} />, label: 'Auditoria' },
    ],
  },
];

export function AdminLayoutProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [aiCredits, setAiCredits] = useState(0);
  const [tenant, setTenant] = useState<{ name: string; aiCredits: number } | null>(null);

  // Título da página derivado da MESMA lista que monta a navegação.
  //
  // Antes havia `{children && false} // Placeholder ...` no header: um
  // comentário `//` solto em JSX não é comentário — vira TEXTO na tela, e era
  // ele que aparecia como "// Placeholder - actual title comes from page".
  //
  // Prefixo mais longo ganha, senão `/admin/settings/branding` casaria com
  // `/admin` e mostraria "Dashboard".
  const pageTitle = useMemo(() => {
    const items = NAV_SECTIONS.flatMap((section) => section.items);
    const match = items
      .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0];

    return match?.label ?? 'Administração';
  }, [pathname]);

  // Load tenant info and AI credits
  useEffect(() => {
    fetch('/api/admin/tenant/branding', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data) {
          setTenant(data);
          setAiCredits(data.aiCredits || 0);
        }
      })
      .catch(() => {});
  }, []);

  // Handle outside click for profile dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-profile-dropdown]')) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = () => signOutAll('/login');

  return (
    <AdminLayoutContext.Provider value={{ navOpen, setNavOpen }}>
      <div className="min-h-screen bg-md-surface-dim md:flex">
        {/* Mobile overlay */}
        {navOpen && (
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Navigation Drawer */}
        <aside
          className={`fixed h-full z-50 transition-all duration-300 ease-standard bg-md-surface-container border-r border-md-outline flex flex-col ${
            navCollapsed
              ? 'w-16 md:w-16'
              : 'w-64 md:w-64'
          } ${navOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
          aria-label="Navegação administrativa"
        >
          {/* Drawer Header */}
          <div className={`flex items-center justify-between p-4 border-b border-md-outline ${navCollapsed ? 'justify-center' : ''}`}>
            {!navCollapsed && (
              <Link href="/admin" className="flex items-center gap-2 text-xl font-black tracking-tighter text-md-on-surface">
                <Wordmark />
                <span className="text-md-primary">Admin</span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => setNavCollapsed(!navCollapsed)}
              className={`p-2 rounded-xl hover:bg-md-surface-container-high transition-colors ${
                navCollapsed ? 'mx-auto' : 'ml-auto'
              }`}
              aria-label={navCollapsed ? 'Expandir menu' : 'Colapsar menu'}
              aria-expanded={!navCollapsed}
            >
              <ChevronDown
                size={20}
                className={`text-md-on-surface-variant transition-transform duration-200 ${
                  navCollapsed ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>

          {/* Tenant Badge */}
          {!navCollapsed && tenant && (
            <div className="mx-3 mb-4 p-3 bg-md-primary-container/20 border border-md-primary-container/30 rounded-xl">
              <div className="flex items-center gap-2 text-body-sm">
                <Building2 size={16} className="text-md-primary" />
                <span className="font-semibold text-md-on-surface truncate">{tenant.name}</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <CreditCard size={14} className="text-md-tertiary" />
                <span className="text-label-sm font-semibold text-md-on-tertiary-container bg-md-tertiary-container px-2 py-0.5 rounded-full">
                  {aiCredits} créditos IA
                </span>
              </div>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-2" aria-label="Menu principal">
            {NAV_SECTIONS.map((section) => (
              <div key={section.label} className={navCollapsed ? 'hidden' : 'block'}>
                <h3 className="px-3 py-1 text-label-sm text-md-on-surface-variant uppercase tracking-widest">
                  {section.label}
                </h3>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-body-md font-medium transition-all duration-200 ${
                        item.href === pathname
                          ? 'bg-md-primary-container text-md-on-primary-container'
                          : 'text-md-on-surface-variant hover:bg-md-surface-container-high hover:text-md-on-surface'
                      }`}
                      onClick={() => setNavOpen(false)}
                    >
                      <span className="flex-shrink-0" aria-hidden="true">{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className="ml-auto px-2 py-0.5 text-label-sm font-semibold bg-md-primary-container text-md-on-primary-container rounded-full">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Collapsed nav tooltips would go here - simplified for now */}

          {/* Drawer Footer */}
          <div className="p-3 border-t border-md-outline" data-profile-dropdown>
            {!navCollapsed ? (
              <>
                <Link
                  href="/dashboard"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-body-md font-medium text-md-on-surface-variant hover:bg-md-surface-container-high hover:text-md-on-surface transition-colors mb-2"
                  onClick={() => setNavOpen(false)}
                >
                  <span className="flex-shrink-0"><LayoutDashboard size={20} /></span>
                  <span>Visão do Colaborador</span>
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-body-md font-medium text-md-error hover:bg-md-error/10 transition-colors"
                >
                  <span className="flex-shrink-0"><LogOut size={20} /></span>
                  <span>Sair</span>
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => { window.location.href = '/dashboard'; }}
                  className="p-2.5 rounded-xl text-md-on-surface-variant hover:bg-md-surface-container-high hover:text-md-on-surface transition-colors"
                  title="Visão do Colaborador"
                >
                  <LayoutDashboard size={22} />
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="p-2.5 rounded-xl text-md-error hover:bg-md-error/10 transition-colors"
                  title="Sair"
                >
                  <LogOut size={22} />
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Mobile drawer toggle button (only visible on mobile when drawer closed) */}
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-xl bg-md-surface-container border border-md-outline shadow-md"
          aria-label="Abrir menu"
        >
          <Menu size={24} className="text-md-on-surface" />
        </button>

        {/* Main Content */}
        <main className={`flex-1 min-h-screen transition-all duration-300 ${navCollapsed ? 'md:ml-16' : 'md:ml-64'}`}>
          {/* Top App Bar */}
          <header className="sticky top-0 z-30 bg-md-surface-container border-b border-md-outline backdrop-blur-sm bg-opacity-80">
            <div className="flex items-center justify-between h-16 px-4 sm:px-6 md:px-8">
              {/* Page Title */}
              <div className="flex-1 min-w-0" data-page-title>
                <h1 className="text-title-lg font-bold text-md-on-surface truncate">{pageTitle}</h1>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <NotificationBell />

                {/* Profile Dropdown */}
                <div className="relative" data-profile-dropdown>
                  <button
                    type="button"
                    onClick={() => setProfileOpen(!profileOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-md-surface-container-high transition-colors"
                    aria-label="Menu do perfil"
                    aria-expanded={profileOpen}
                  >
                    <div className="w-8 h-8 rounded-full bg-md-primary-container flex items-center justify-center">
                      <span className="text-label-lg font-bold text-md-on-primary-container">
                        {tenant?.name?.charAt(0).toUpperCase() || 'A'}
                      </span>
                    </div>
                    <span className="hidden sm:block text-body-md font-medium text-md-on-surface truncate max-w-[140px]">
                      {tenant?.name || 'Administrador'}
                    </span>
                    <span className="hidden sm:block text-label-sm text-md-on-tertiary-container bg-md-tertiary-container px-2 py-0.5 rounded-full">
                      admin_rh
                    </span>
                    <ChevronDown size={16} className={`text-md-on-surface-variant transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {profileOpen && (
                    <div className="absolute right-0 top-full mt-2 w-56 bg-md-surface-container border border-md-outline rounded-2xl shadow-lg md-elevation-3 py-2">
                      <div className="px-4 py-3 border-b border-md-outline">
                        <p className="text-body-md font-semibold text-md-on-surface">{tenant?.name || 'Administrador'}</p>
                        <p className="text-body-sm text-md-on-surface-variant">admin@empresa.com</p>
                        <span className="inline-block mt-1 text-label-sm text-md-on-tertiary-container bg-md-tertiary-container px-2 py-0.5 rounded-full">admin_rh</span>
                      </div>
                      <Link
                        href="/profile"
                        className="flex items-center gap-3 px-4 py-2.5 text-body-md text-md-on-surface-variant hover:bg-md-surface-container-high hover:text-md-on-surface"
                        onClick={() => setProfileOpen(false)}
                      >
                        <Settings size={20} />
                        Configurações
                      </Link>
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-body-md text-md-error hover:bg-md-error/10"
                      >
                        <LogOut size={20} />
                        Sair
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>

          {/* Page Content */}
          <div className="p-4 sm:p-6 md:p-8">
            {children}
          </div>
        </main>
      </div>
    </AdminLayoutContext.Provider>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminLayoutProvider>{children}</AdminLayoutProvider>;
}
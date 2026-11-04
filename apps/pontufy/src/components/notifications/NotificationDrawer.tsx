'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCheck, Coins, Gift, GraduationCap, TrendingUp, Megaphone, Bell, Swords, Trophy, Award } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/store/useStore';

export type NotificationType =
  | 'POINTS_EARNED'
  | 'REWARD_REDEEMED'
  | 'COURSE_ASSIGNED'
  | 'LEVEL_UP'
  | 'SYSTEM'
  | 'BATTLE_CHALLENGE'
  | 'BATTLE_RESULT'
  | 'CERTIFICATE_READY'
  | 'DEPT_BONUS_AWARDED';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  link: string | null;
  createdAt: string;
}

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_STYLES: Record<NotificationType, { icon: typeof Coins; badge: string; iconColor: string }> = {
  POINTS_EARNED: { icon: Coins, badge: 'bg-md-tertiary/50 text-md-tertiary border-md-tertiary/30', iconColor: 'text-md-tertiary' },
  REWARD_REDEEMED: { icon: Gift, badge: 'bg-md-highlight/50 text-md-on-highlight border-md-highlight/30', iconColor: 'text-md-on-highlight' },
  COURSE_ASSIGNED: { icon: GraduationCap, badge: 'bg-md-primary/50 text-md-primary border-md-primary/30', iconColor: 'text-md-primary' },
  LEVEL_UP: { icon: TrendingUp, badge: 'bg-md-highlight/50 text-md-on-highlight border-md-highlight/30', iconColor: 'text-md-on-highlight' },
  SYSTEM: { icon: Megaphone, badge: 'bg-md-surface-container-high text-md-on-surface-variant border-md-outline', iconColor: 'text-md-on-surface-variant' },
  BATTLE_CHALLENGE: { icon: Swords, badge: 'bg-md-secondary/50 text-md-secondary border-md-secondary/30', iconColor: 'text-md-secondary' },
  BATTLE_RESULT: { icon: Trophy, badge: 'bg-md-secondary/50 text-md-secondary border-md-secondary/30', iconColor: 'text-md-secondary' },
  CERTIFICATE_READY: { icon: Award, badge: 'bg-md-primary/20 text-md-primary border-md-primary/30', iconColor: 'text-md-primary' },
  DEPT_BONUS_AWARDED: { icon: Gift, badge: 'bg-md-tertiary/50 text-md-tertiary border-md-tertiary/30', iconColor: 'text-md-tertiary' },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days}d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

async function fetchNotifications(page = 1, limit = 30) {
  const res = await fetch(`/api/notifications?page=${page}&limit=${limit}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function NotificationDrawer({ isOpen, onClose }: NotificationDrawerProps) {
  const unreadNotifications = useStore((s) => s.unreadNotifications);
  const setUnreadNotifications = useStore((s) => s.setUnreadNotifications);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchNotifications()
      .then((json) => {
        if (cancelled) return;
        setItems(json.data || []);
        setUnreadNotifications(json.unreadCount ?? 0);
      })
      .catch((err) => {
        if (!cancelled) console.error('Falha ao carregar notificações:', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, setUnreadNotifications]);

  const markRead = useCallback(
    async (id: string) => {
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadNotifications(Math.max(0, unreadNotifications - 1));
      try {
        await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      } catch {}
    },
    [unreadNotifications, setUnreadNotifications],
  );

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadNotifications(0);
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
    } catch {}
  }, [setUnreadNotifications]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-md-surface-container border-l border-md-outline shadow-2xl z-50 flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b border-md-outline">
              <h2 className="text-lg font-bold text-md-on-surface flex items-center gap-2">
                <Bell size={18} className="text-md-tertiary" />
                Notificações
                {unreadNotifications > 0 && (
                  <span className="bg-md-tertiary/50 text-md-tertiary text-xs font-bold px-2 py-0.5 rounded-full">
                    {unreadNotifications} novas
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unreadNotifications === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-md-on-surface-variant hover:text-md-tertiary hover:bg-md-surface-container-low transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <CheckCheck size={14} />
                  Marcar todas
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container rounded-xl transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isLoading && (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="bg-md-surface-container-low border border-md-outline rounded-xl p-4 animate-pulse space-y-2">
                      <div className="h-3 bg-md-surface-container-highest rounded w-1/2" />
                      <div className="h-2 bg-md-surface-container-highest rounded w-3/4" />
                    </div>
                  ))}
                </div>
              )}

              {!isLoading && items.length === 0 && (
                <div className="text-center py-16">
                  <Bell size={48} className="mx-auto text-md-on-surface-muted mb-3" />
                  <p className="text-md-on-surface-variant">Nenhuma notificação por aqui.</p>
                  <p className="text-sm text-md-on-surface-muted mt-1">Conclua aulas e resgate recompensas para receber avisos.</p>
                </div>
              )}

              {!isLoading &&
                items.map((item) => {
                  const style = TYPE_STYLES[item.type] || TYPE_STYLES.SYSTEM;
                  const Icon = style.icon;
                  return (
                    <motion.button
                      key={item.id}
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => {
                        if (!item.read) markRead(item.id);
                      }}
                      className={`w-full text-left bg-md-surface-container-low border rounded-xl p-4 transition-colors ${
                        item.read
                          ? 'border-md-outline hover:border-md-outline'
                          : 'border-md-tertiary/25 hover:border-md-tertiary/40'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`inline-flex p-2 rounded-lg border ${style.badge}`}>
                          <Icon size={16} className={style.iconColor} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className={`text-sm font-semibold ${item.read ? 'text-md-on-surface' : 'text-md-on-surface'}`}>
                              {item.title}
                            </p>
                            <span className="text-[10px] text-md-on-surface-muted flex-shrink-0">
                              {timeAgo(item.createdAt)}
                            </span>
                          </div>
                          <p className="text-sm text-md-on-surface-variant mt-0.5">{item.message}</p>
                        </div>
                        {!item.read && <span className="w-2 h-2 rounded-full bg-md-tertiary mt-2 flex-shrink-0" />}
                      </div>
                    </motion.button>
                  );
                })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
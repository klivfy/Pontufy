'use client';
import { Bell } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import { NotificationDrawer } from './NotificationDrawer';

export function NotificationBell() {
  const unreadNotifications = useStore((s) => s.unreadNotifications);
  const setUnreadNotifications = useStore((s) => s.setUnreadNotifications);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const refreshUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?page=1&limit=1', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      if (typeof json.unreadCount === 'number') {
        setUnreadNotifications(json.unreadCount);
      }
    } catch {}
  }, [setUnreadNotifications]);

  useEffect(() => {
    refreshUnread();
    let eventSource: EventSource | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const startPoll = () => {
      if (pollId) return;
      pollId = setInterval(() => {
        void refreshUnread();
      }, 15_000);
    };

    try {
      eventSource = new EventSource('/api/notifications/stream');
      eventSource.addEventListener('notification', () => {
        refreshUnread();
      });
      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        startPoll();
      };
    } catch {
      startPoll();
    }

    return () => {
      eventSource?.close();
      if (pollId) clearInterval(pollId);
    };
  }, [refreshUnread]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsDrawerOpen(true)}
        className="relative p-2 text-gray-400 hover:text-white transition-colors"
        aria-label="Notificações"
      >
        <Bell size={20} />
        {unreadNotifications > 0 && (
          <span className="absolute top-0.5 right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-black text-[10px] font-black border-2 border-[#0a0a0a]">
            {unreadNotifications > 99 ? '99+' : unreadNotifications}
          </span>
        )}
      </button>

      <NotificationDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
    </>
  );
}
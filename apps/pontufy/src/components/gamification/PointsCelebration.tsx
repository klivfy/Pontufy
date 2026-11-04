'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Coins } from 'lucide-react';
import { playFeedbackSound, haptic } from '@/lib/feedback';
import { Confetti, type ConfettiHandle } from '@/components/ui/Confetti';
import { CountUp } from '@/components/ui/CountUp';

// Celebração de pontos (TAREFA 5): confete em Canvas, som sutil (Web Audio),
// vibração háptica e CountUp — tudo respeitando prefers-reduced-motion e a
// preferência de som do usuário. O saldo global é atualizado via useStore.

interface PointsCelebrationProps {
  points: number;
  isVisible: boolean;
  onComplete?: () => void;
  message?: string;
}

export default function PointsCelebration({
  points,
  isVisible,
  onComplete,
  message = 'Você acaba de ganhar',
}: PointsCelebrationProps) {
  const reduced = useReducedMotion();
  const confettiRef = useRef<ConfettiHandle>(null);

  useEffect(() => {
    if (!isVisible) return;
    playFeedbackSound('points');
    haptic([30, 50, 30]);
    if (!reduced) {
      const t = setTimeout(() => confettiRef.current?.burst(), 180);
      return () => clearTimeout(t);
    }
  }, [isVisible, reduced]);

  useEffect(() => {
    if (!isVisible) return;
    const timer = setTimeout(() => onComplete?.(), 2800);
    return () => clearTimeout(timer);
  }, [isVisible, onComplete]);

  return (
    <>
      <Confetti ref={confettiRef} />
      <AnimatePresence>
        {isVisible && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-md-tertiary/10"
            />
            <motion.div
              initial={{ scale: 0.4, opacity: 0, y: 40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 16 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              className="relative bg-md-surface px-10 py-8 rounded-3xl shadow-2xl border border-md-outline flex flex-col items-center gap-3"
            >
              <motion.div
                animate={reduced ? undefined : { scale: [1, 1.12, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                className="bg-md-tertiary/15 p-4 rounded-full"
              >
                <Coins size={48} className="text-md-tertiary" />
              </motion.div>
              <h2 className="text-2xl font-black text-md-on-surface">Incrível!</h2>
              <p className="text-md-on-surface-variant text-sm">{message}</p>
              <div className="text-4xl font-black text-md-tertiary">
                +<CountUp value={points} />
                <span className="text-lg font-bold"> Pontos</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
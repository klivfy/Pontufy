'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

export interface ConfettiHandle {
  burst: (origin?: { x: number; y: number }) => void;
}

interface ConfettiProps {
  className?: string;
  colors?: string[];
  particleCount?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  size: number;
  color: string;
  rotation: number;
  rotSpeed: number;
  life: number;
  decay: number;
}

const PALETTE_MD3 = ['#f5c8bf', '#e0d2c5', '#cad9ca', '#a7e3c1', '#495453'];

// Confete em Canvas (TAREFA 5.1) — sem dependência externa, DPR-aware,
// respeita prefers-reduced-motion (renderiza sem animação). Chame via ref:
//   const confetti = useRef<ConfettiHandle>(null); confetti.current?.burst();
export const Confetti = forwardRef<ConfettiHandle, ConfettiProps>(
  function Confetti({ className = '', colors = PALETTE_MD3, particleCount = 90 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particles = useRef<Particle[]>([]);
    const raf = useRef<number | null>(null);
    const reduced = useReducedMotion();

    useImperativeHandle(ref, () => ({
      burst(origin) {
        const canvas = canvasRef.current;
        if (!canvas || reduced) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const cx = origin?.x ?? rect.width / 2;
        const cy = origin?.y ?? rect.height / 2;
        particles.current = Array.from({ length: particleCount }, () => ({
          x: cx,
          y: cy,
          vx: (Math.random() - 0.5) * 11,
          vy: -(Math.random() * 9 + 3),
          gravity: 0.22,
          size: Math.random() * 5 + 3,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.3,
          life: 1,
          decay: 0.006 + Math.random() * 0.008,
        }));

        const step = () => {
          const canvasEl = canvasRef.current;
          const ctx2 = canvasEl?.getContext('2d');
          if (!canvasEl || !ctx2) return;
          ctx2.clearRect(0, 0, canvasEl.width, canvasEl.height);
          const rect2 = canvasEl.getBoundingClientRect();
          particles.current = particles.current.filter((p) => p.life > 0);
          if (particles.current.length === 0) {
            ctx2.clearRect(0, 0, canvasEl.width, canvasEl.height);
            raf.current = null;
            return;
          }
          for (const p of particles.current) {
            p.vy += p.gravity;
            p.x += p.vx;
            p.y += p.vy;
            p.rotation += p.rotSpeed;
            p.life -= p.decay;
            ctx2.save();
            ctx2.translate(p.x, p.y);
            ctx2.rotate(p.rotation);
            ctx2.globalAlpha = Math.max(p.life, 0);
            ctx2.fillStyle = p.color as CanvasFillStrokeStyles['fillStyle'];
            ctx2.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            ctx2.restore();
          }
          void rect2;
          raf.current = requestAnimationFrame(step);
        };
        if (raf.current) cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(step);
      },
    }));

    useEffect(() => {
      return () => {
        if (raf.current) cancelAnimationFrame(raf.current);
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-[90] ${className}`}
      />
    );
  },
);

// Burst automático: dispara uma vez ao montar (sucesso de resgate, quiz).
export function ConfettiBurst({ className, colors, particleCount }: ConfettiProps) {
  const ref = useRef<ConfettiHandle>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.burst(), 250);
    return () => clearTimeout(t);
  }, []);
  return <Confetti ref={ref} className={className} colors={colors} particleCount={particleCount} />;
}
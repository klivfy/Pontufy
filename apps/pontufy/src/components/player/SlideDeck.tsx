'use client';

import { ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { Slide } from '@/schemas/lesson-kit';

/**
 * Deck de slides da aula.
 *
 * Minimalismo aqui é função, não estética: cada slide tem título e até cinco
 * marcadores, sem animação de entrada por item, sem transição 3D. O que o
 * instrutor projeta é o que o colaborador vê — e o que ele pode percorrer pelo
 * teclado no celular.
 *
 * `notes` (fala do instrutor) fica escondido por padrão: é bastidor, não
 * conteúdo do aluno.
 */
export default function SlideDeck({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(false);

  const total = slides.length;
  const slide = slides[Math.min(index, total - 1)];

  const goTo = useCallback((next: number) => setIndex(Math.max(0, Math.min(total - 1, next))), [total]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        setIndex((current) => Math.min(total - 1, current + 1));
      }
      if (event.key === 'ArrowLeft') setIndex((current) => Math.max(0, current - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  if (total === 0) return null;

  return (
    <div className="space-y-3">
      <div className="relative rounded-3xl bg-md-surface-container-lowest border border-md-outline-variant md-elevation-1 overflow-hidden">
        <div className="aspect-[16/9] flex flex-col justify-between p-6 sm:p-10">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-widest text-md-on-surface-muted">
            <span>Slide {index + 1} de {total}</span>
            <span className="hidden sm:inline">← → para navegar</span>
          </div>

          <div className="my-4">
            <h3 className="text-xl sm:text-3xl font-black text-md-on-surface leading-tight tracking-tight">
              {slide.title}
            </h3>
            <ul className="mt-5 space-y-2.5">
              {slide.bullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm sm:text-base text-md-on-surface-variant leading-relaxed">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-md-tertiary shrink-0" aria-hidden="true" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="h-1 rounded-full bg-md-surface-container-high overflow-hidden">
            <div
              className="h-full bg-md-primary transition-all duration-300"
              style={{ width: `${((index + 1) / total) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Ir para o slide ${i + 1}`}
              className={`h-2 rounded-full transition-all ${
                i === index ? 'w-6 bg-md-primary' : 'w-2 bg-md-outline hover:bg-md-on-surface-muted'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-1">
          {slide.notes && (
            <button
              type="button"
              onClick={() => setShowNotes((value) => !value)}
              aria-pressed={showNotes}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-md-on-surface-variant hover:bg-md-surface-container transition-colors"
            >
              {showNotes ? <EyeOff size={14} /> : <Eye size={14} />}
              {showNotes ? 'Ocultar fala' : 'Ver fala'}
            </button>
          )}
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            aria-label="Slide anterior"
            className="p-2 rounded-full text-md-on-surface-variant hover:bg-md-surface-container disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={index >= total - 1}
            aria-label="Próximo slide"
            className="p-2 rounded-full text-md-on-surface-variant hover:bg-md-surface-container disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {showNotes && slide.notes && (
        <div className="rounded-2xl bg-md-surface-container p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-md-on-surface-muted mb-1">
            Fala do instrutor
          </p>
          <p className="text-sm text-md-on-surface-variant leading-relaxed">{slide.notes}</p>
        </div>
      )}
    </div>
  );
}

'use client';

import { BookOpen, Check, CheckCircle2, Presentation, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { LessonKit } from '@/schemas/lesson-kit';
import { MarkdownContent } from './LessonContent';
import LessonVideo from './LessonVideo';
import SlideDeck from './SlideDeck';

/**
 * O ambiente da aula: quatro formatos da MESMA matéria.
 *
 * ┌ Leitura ─ texto completo, para quem estuda
 * ├ Vídeo ── roteiro narrado, para quem tem 6 minutos
 * ├ Slides ─ o que o instrutor projeta
 * └ Fácil ── resumo em linguagem simples, para revisar no celular
 *
 * Os quatro saem do mesmo conteúdo, então trocar de formato nunca muda o
 * assunto — muda a densidade. É essa a proposta do motor: a mesma aula em
 * quatro velocidades, em vez de quatro artefatos desconectados.
 *
 * O checkpoint fica sempre no fim, fora das abas: fixação é o fecho da aula,
 * não um quinto formato.
 */

type TabKey = 'leitura' | 'video' | 'slides' | 'facil';

const TABS: Array<{ key: TabKey; label: string; icon: typeof BookOpen }> = [
  { key: 'video', label: 'Vídeo', icon: Sparkles },
  { key: 'slides', label: 'Slides', icon: Presentation },
  { key: 'facil', label: 'Leitura fácil', icon: CheckCircle2 },
  { key: 'leitura', label: 'Texto completo', icon: BookOpen },
];

export interface LessonKitViewProps {
  kit: LessonKit;
  markdown: string;
}

export default function LessonKitView({ kit, markdown }: LessonKitViewProps) {
  const [tab, setTab] = useState<TabKey>('video');
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  const checkpoint = kit.checkpoint;
  const answeredCount = Object.keys(answers).length;
  const correctCount = useMemo(
    () => checkpoint.filter((question, index) => answers[index] === question.correctIndex).length,
    [answers, checkpoint],
  );

  return (
    <div className="space-y-6">
      {/* Seletor de formato — segmented control M3 */}
      <div
        role="tablist"
        aria-label="Formato da aula"
        className="inline-flex flex-wrap gap-1 rounded-full bg-md-surface-container p-1"
      >
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors ${
                active
                  ? 'bg-md-surface-container-lowest text-md-on-surface md-elevation-1'
                  : 'text-md-on-surface-variant hover:text-md-on-surface'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Painel */}
      <div>
        {tab === 'video' && <LessonVideo video={kit.video} />}

        {tab === 'slides' && <SlideDeck slides={kit.slides} />}

        {tab === 'facil' && (
          <div className="rounded-3xl border border-md-outline-variant bg-md-surface-container-lowest p-6 sm:p-8 space-y-6">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-md-on-surface-muted mb-2">
                Em 40 segundos
              </p>
              <p className="text-base sm:text-lg text-md-on-surface leading-relaxed">{kit.plain.summary}</p>
            </div>

            {kit.plain.bullets.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-md-on-surface-muted mb-2">
                  O que levar
                </p>
                <ul className="space-y-2">
                  {kit.plain.bullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-md-on-surface-variant">
                      <Check size={16} className="mt-0.5 text-md-tertiary shrink-0" />
                      <span className="leading-relaxed">{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {kit.plain.glossary && kit.plain.glossary.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-md-on-surface-muted mb-2">
                  Termos da aula
                </p>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {kit.plain.glossary.map((entry) => (
                    <div key={entry.term} className="rounded-2xl bg-md-surface-container p-3">
                      <dt className="text-sm font-bold text-md-on-surface">{entry.term}</dt>
                      <dd className="text-xs text-md-on-surface-variant leading-relaxed mt-1">
                        {entry.definition}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        )}

        {tab === 'leitura' && (
          markdown ? (
            <MarkdownContent content={markdown} />
          ) : (
            <p className="text-sm text-md-on-surface-variant">Sem texto completo para esta aula.</p>
          )
        )}
      </div>

      {/* Checkpoint de fixação */}
      {checkpoint.length > 0 && (
        <section className="rounded-3xl border border-md-outline-variant bg-md-surface-container-low p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h3 className="text-sm font-bold text-md-on-surface uppercase tracking-wide">Fixação rápida</h3>
            <span className="text-xs text-md-on-surface-muted">
              {correctCount}/{checkpoint.length} corretas
            </span>
          </div>

          <ol className="space-y-6">
            {checkpoint.map((question, qIndex) => {
              const chosen = answers[qIndex];
              const isRevealed = revealed[qIndex] ?? false;
              return (
                <li key={qIndex}>
                  <p className="text-sm font-semibold text-md-on-surface mb-3">
                    {qIndex + 1}. {question.question}
                  </p>
                  <div className="grid gap-2">
                    {question.options.map((option, oIndex) => {
                      const isChosen = chosen === oIndex;
                      const isCorrect = oIndex === question.correctIndex;
                      const showState = isRevealed || isChosen;
                      const tone = !showState
                        ? 'border-md-outline-variant hover:border-md-primary/40 hover:bg-md-surface-container'
                        : isCorrect
                          ? 'border-md-tertiary/50 bg-md-tertiary/10'
                          : isChosen
                            ? 'border-md-error/40 bg-md-error/10'
                            : 'border-md-outline-variant';
                      return (
                        <button
                          key={oIndex}
                          type="button"
                          onClick={() => {
                            setAnswers((prev) => ({ ...prev, [qIndex]: oIndex }));
                            setRevealed((prev) => ({ ...prev, [qIndex]: true }));
                          }}
                          className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm text-md-on-surface transition-colors ${tone}`}
                        >
                          <span>{option}</span>
                          {showState && isCorrect && <CheckCircle2 size={16} className="text-md-tertiary shrink-0" />}
                          {showState && isChosen && !isCorrect && <X size={16} className="text-md-error shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  {(revealed[qIndex] || answeredCount === checkpoint.length) && question.explanation && (
                    <p className="mt-2 text-xs text-md-on-surface-variant leading-relaxed">
                      {question.explanation}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

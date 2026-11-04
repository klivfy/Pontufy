'use client';

import { motion } from 'framer-motion';
import { Award, Check, CheckCircle2, Loader2, RefreshCw, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// Quiz final — dinâmico
//
// Duas diferenças de comportamento em relação ao modal antigo, ambas de
// propósito:
//
// 1. NÃO mostra acerto/erro a cada pergunta. O cliente não recebe mais o
//    gabarito junto com as alternativas: a prova agora é sorteada no servidor e
//    corrigida lá. Feedback imediato exigiria mandar `correctIndex` para o
//    navegador — e quem abre o devtools acerta tudo.
//
// 2. Cada tentativa é diferente. Ao refazer, o servidor sorteia outro
//    subconjunto do banco, com dificuldade calibrada pelo número da tentativa
//    (quem reprovou pega mais fáceis; quem já passou pega mais difíceis).
//
// O que se perde em micro-feedback se devolve no fim: a revisão mostra questão
// a questão o que estava certo e por quê.
// ═══════════════════════════════════════════════════════════════════════════

export interface PublicQuestion {
  id: string;
  question: string;
  options: string[];
}

interface SelectionResponse {
  seed: string;
  attemptNumber: number;
  questions: PublicQuestion[];
}

interface ReviewItem {
  id: string;
  correct: boolean;
  correctIndex: number;
  explanation?: string;
}

interface QuizResult {
  score: number;
  total: number;
  passed: boolean;
  percentage: number;
  bonusAwarded: boolean;
  perQuestion?: ReviewItem[];
}

interface DynamicQuizProps {
  courseId: string;
  courseTitle: string;
  alreadyPassed: boolean;
  onClose: () => void;
  onQuizPassed: (result: { score: number; total: number; bonusAwarded: boolean }) => void;
  onEmitCertificate: () => void;
}

export default function DynamicQuiz({
  courseId,
  courseTitle,
  alreadyPassed,
  onClose,
  onQuizPassed,
  onEmitCertificate,
}: DynamicQuizProps) {
  const [selection, setSelection] = useState<SelectionResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [attemptKey, setAttemptKey] = useState(0);

  const reload = useCallback(() => {
    setSelection(null);
    setLoadError(null);
    setResult(null);
    setAnswers({});
    setIndex(0);
    setSubmitError(null);
    setAttemptKey((value) => value + 1);
  }, []);

  // O sorteio é pedido ao servidor: o cliente recebe semente + perguntas sem
  // gabarito. `cancelled` evita setState depois de desmontar ou de um novo
  // sorteio — e mantém o setState fora do corpo síncrono do efeito.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const res = await fetch(`/api/courses/${courseId}/quiz?seed=${encodeURIComponent(seed)}`, {
          cache: 'no-store',
        });
        const data = (await res.json()) as SelectionResponse & { error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data?.error ?? 'Não foi possível preparar o quiz.');
        if (!data.questions?.length) throw new Error('Este curso ainda não tem questões de avaliação.');
        setSelection(data);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Falha ao carregar o quiz.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [courseId, attemptKey]);

  const total = selection?.questions.length ?? 0;
  const answeredCount = Object.keys(answers).length;
  const current = selection?.questions[index];

  const submit = async () => {
    if (!selection) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: selection.seed, answers }),
      });
      const data = (await res.json()) as QuizResult & { error?: string };
      if (!res.ok) throw new Error(data?.error ?? 'Falha ao corrigir o quiz.');
      setResult(data);
      if (data.passed) {
        onQuizPassed({ score: data.score, total: data.total, bonusAwarded: data.bonusAwarded });
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Falha ao corrigir o quiz.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-md-inverse-surface/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl bg-md-surface-container-lowest md-elevation-5"
        role="dialog"
        aria-modal="true"
        aria-label={`Quiz final — ${courseTitle}`}
      >
        {/* Cabeçalho */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-md-outline-variant bg-md-surface-container-lowest/95 backdrop-blur px-5 sm:px-7 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-md-on-surface-muted">Quiz final</p>
            <h2 className="text-base font-bold text-md-on-surface truncate">{courseTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar quiz"
            className="p-2 rounded-full text-md-on-surface-variant hover:bg-md-surface-container transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 sm:px-7 py-6">
          {/* Carregando / erro de carga */}
          {!selection && !loadError && (
            <div className="flex items-center justify-center py-16 text-md-on-surface-variant">
              <Loader2 className="animate-spin text-md-primary" size={28} />
            </div>
          )}

          {loadError && (
            <div className="space-y-4 py-8 text-center">
              <XCircle size={40} className="mx-auto text-md-error" />
              <p className="text-sm text-md-on-surface">{loadError}</p>
              <button
                type="button"
                onClick={() => reload()}
                className="md-btn md-btn-tonal mx-auto"
              >
                <RefreshCw size={16} /> Tentar de novo
              </button>
            </div>
          )}

          {/* Resultado */}
          {selection && result && (
            <div className="space-y-6">
              <div className="text-center">
                <div
                  className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full ${
                    result.passed ? 'bg-md-tertiary/15 text-md-tertiary' : 'bg-md-error/10 text-md-error'
                  }`}
                >
                  {result.passed ? <CheckCircle2 size={38} /> : <XCircle size={38} />}
                </div>
                <h3 className="text-xl font-black text-md-on-surface">
                  {result.passed ? 'Aprovado!' : 'Quase lá'}
                </h3>
                <p className="text-sm text-md-on-surface-variant mt-1">
                  {result.score} de {result.total} corretas · {result.percentage}%
                  {result.passed ? '' : ' · mínimo de 70%'}
                </p>
                {result.bonusAwarded && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-md-tertiary-container px-3 py-1 text-xs font-bold text-md-on-tertiary-container">
                    <Award size={13} /> +50 pontos de bônus
                  </p>
                )}
              </div>

              {/* Revisão */}
              <div className="space-y-3">
                {selection.questions.map((question, qIndex) => {
                  const review = result.perQuestion?.find((item) => item.id === question.id);
                  const chosen = answers[question.id];
                  if (!review) return null;
                  return (
                    <div key={question.id} className="rounded-2xl border border-md-outline-variant p-4">
                      <p className="text-sm font-semibold text-md-on-surface mb-2">
                        {qIndex + 1}. {question.question}
                      </p>
                      <div className="space-y-1.5 text-xs">
                        <p className={`flex items-start gap-1.5 ${review.correct ? 'text-md-tertiary' : 'text-md-on-surface-variant'}`}>
                          <Check size={13} className="mt-0.5 shrink-0" />
                          {question.options[review.correctIndex]}
                        </p>
                        {!review.correct && typeof chosen === 'number' && (
                          <p className="flex items-start gap-1.5 text-md-error">
                            <X size={13} className="mt-0.5 shrink-0" />
                            {question.options[chosen]}
                          </p>
                        )}
                        {review.explanation && (
                          <p className="text-md-on-surface-variant leading-relaxed pt-1">{review.explanation}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                {!result.passed && (
                  <button type="button" onClick={() => reload()} className="md-btn md-btn-outlined">
                    <RefreshCw size={16} /> Nova tentativa
                  </button>
                )}
                {result.passed && (
                  <button type="button" onClick={onEmitCertificate} className="md-btn md-btn-filled">
                    <Award size={16} /> Emitir certificado
                  </button>
                )}
                <button type="button" onClick={onClose} className="md-btn md-btn-text">
                  Fechar
                </button>
              </div>
            </div>
          )}

          {/* Pergunta */}
          {selection && !result && current && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-widest text-md-on-surface-muted mb-2">
                  <span>
                    Questão {index + 1} de {total}
                  </span>
                  <span>
                    {selection.attemptNumber > 1 ? `Tentativa ${selection.attemptNumber}` : '1ª tentativa'}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-md-surface-container overflow-hidden">
                  <div
                    className="h-full bg-md-primary transition-all duration-300"
                    style={{ width: `${(answeredCount / total) * 100}%` }}
                  />
                </div>
              </div>

              <p className="text-base sm:text-lg font-semibold text-md-on-surface leading-snug">
                {current.question}
              </p>

              <div className="grid gap-2">
                {current.options.map((option, optionIndex) => {
                  const active = answers[current.id] === optionIndex;
                  return (
                    <button
                      key={optionIndex}
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [current.id]: optionIndex }))}
                      className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${
                        active
                          ? 'border-md-primary bg-md-primary/10 text-md-on-surface font-semibold'
                          : 'border-md-outline-variant text-md-on-surface-variant hover:border-md-primary/40 hover:bg-md-surface-container'
                      }`}
                    >
                      <span>{option}</span>
                      {active && <Check size={16} className="text-md-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {submitError && <p className="text-xs text-md-error">{submitError}</p>}

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0}
                  className="md-btn md-btn-text disabled:opacity-40"
                >
                  Anterior
                </button>

                {index < total - 1 ? (
                  <button
                    type="button"
                    onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
                    className="md-btn md-btn-filled"
                  >
                    Próxima
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={submitting || answeredCount === 0}
                    className="md-btn md-btn-filled"
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Corrigindo
                      </>
                    ) : (
                      <>Corrigir ({answeredCount}/{total})</>
                    )}
                  </button>
                )}
              </div>

              {alreadyPassed && (
                <p className="text-[11px] text-md-on-surface-muted text-center">
                  Você já aprovou este quiz. Refazer não duplica o bônus.
                </p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

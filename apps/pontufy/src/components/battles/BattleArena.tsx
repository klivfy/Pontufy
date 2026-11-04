'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Timer, AlertTriangle, Swords, Trophy, RotateCcw } from 'lucide-react';
import { playFeedbackSound, haptic } from '@/lib/feedback';

// TAREFA 13.4 — Arena de batalha: cronômetro estrito de 15s/questão +
// detecção de perda de foco (anula o turno para evitar consulta externa).

export interface BattleQuestionView {
  question: string;
  options: string[];
}

interface BattleArenaProps {
  battleId: string;
  onClose: () => void;
  onFinished?: () => void;
}

type Phase = 'loading' | 'playing' | 'result' | 'error';

export default function BattleArena({ battleId, onClose, onFinished }: BattleArenaProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<BattleQuestionView[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(15);
  const [focusLost, setFocusLost] = useState(false);
  const [result, setResult] = useState<{
    score: number;
    correct: boolean[];
    forfeited: boolean;
    winnerId: string | null;
  } | null>(null);
  const [error, setError] = useState('');

  const startRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const focusLostRef = useRef(false);

  // ── Detecção de perda de foco (13.4): outra aba / janela desfocada ───────
  useEffect(() => {
    const onHide = () => {
      if (phaseRef.current === 'playing') {
        focusLostRef.current = true;
        setFocusLost(true);
      }
    };
    const onBlur = () => onHide();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;

  // ── Carregamento das questões (somente quando é o seu turno) ─────────────
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/battles/${battleId}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.questions) {
          setQuestions(data.questions);
          setAnswers(data.questions.map(() => -1));
          startRef.current = Date.now();
          setPhase('playing');
        } else {
          setError(data?.error || 'Não é o seu turno ainda.');
          setPhase('error');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Erro ao carregar a batalha.');
          setPhase('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [battleId]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const advance = useCallback(() => {
    setCurrentIdx((i) => {
      if (i >= questions.length - 1) {
        clearTimer();
        void submitTurn();
        return i;
      }
      return i + 1;
    });
    setSelected(null);
  }, [questions.length, clearTimer]);

  // ── Cronômetro estrito: 15s por questão, auto-avanço sem resposta ────────
  useEffect(() => {
    if (phase !== 'playing') return;
    setSecondsLeft(15);
    clearTimer();
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearTimer();
          advance();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return clearTimer;
  }, [currentIdx, phase, clearTimer, advance]);

  const submitTurn = async () => {
    if (phaseRef.current !== 'playing') return;
    setPhase('result');
    clearTimer();
    const elapsedSeconds = Math.floor((Date.now() - startRef.current) / 1000);
    try {
      const res = await fetch(`/api/battles/${battleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          elapsedSeconds,
          focusLost: focusLostRef.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Erro ao registrar o turno.');
        setPhase('error');
        return;
      }
      setResult({
        score: data.score,
        correct: data.correct,
        forfeited: data.forfeited,
        winnerId: data.winnerId,
      });
      if (data.forfeited) {
        playFeedbackSound('quiz-wrong');
        haptic([15, 40, 15]);
      } else {
        playFeedbackSound(data.score >= 3 ? 'quiz-correct' : 'quiz-wrong');
      }
      onFinished?.();
    } catch {
      setError('Erro de conexão ao registrar o turno.');
      setPhase('error');
    }
  };

  const handleSelect = (idx: number) => {
    if (phase !== 'playing' || focusLost) return;
    setSelected(idx);
    setAnswers((prev) => prev.map((a, i) => (i === currentIdx ? idx : a)));
    // Seleção não trava o cronômetro: a questão avança no tempo ou no próximo.
  };

  const handleAdvanceNow = () => {
    if (selected === null || phase !== 'playing' || focusLost) return;
    playFeedbackSound('quiz-correct');
    haptic(20);
    advance();
  };

  const renderTimer = () => {
    const pct = (secondsLeft / 15) * 100;
    const urgent = secondsLeft <= 5;
    return (
      <div className="w-full max-w-md mx-auto mb-6">
        <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
          <span className={urgent ? 'text-md-error' : 'text-md-on-surface-variant'}>
            <Timer size={14} className="inline mr-1" />
            {secondsLeft}s
          </span>
          <span className="text-md-on-surface-variant">
            Questão {currentIdx + 1} de {questions.length}
          </span>
        </div>
        <div className="h-2 bg-md-surface-container-high rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ease-linear ${
              urgent ? 'bg-md-error' : 'bg-md-primary'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  };

  if (phase === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <Loader2 className="animate-spin text-md-primary" size={36} />
        <p className="text-md-on-surface-variant text-sm">Preparando o duelo…</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="py-16 text-center">
        <Swords className="mx-auto text-md-on-surface-variant mb-4" size={40} />
        <p className="text-md-on-surface font-medium">{error}</p>
        <button
          onClick={onClose}
          className="mt-6 px-6 py-2.5 rounded-full bg-md-primary text-md-on-primary font-bold text-sm hover:opacity-90 transition"
        >
          Voltar
        </button>
      </div>
    );
  }

  if (phase === 'result' && result) {
    const wins = result.correct.filter(Boolean).length;
    return (
      <div className="py-10 text-center">
        {result.forfeited ? (
          <AlertTriangle className="mx-auto text-md-secondary mb-4" size={48} />
        ) : (
          <Trophy className={`mx-auto mb-4 ${wins >= 3 ? 'text-md-secondary' : 'text-md-on-surface-variant'}`} size={48} />
        )}
        <h3 className="text-2xl font-black text-md-on-surface mb-1">
          {result.forfeited ? 'Turno anulado' : `Você acertou ${wins} de ${questions.length}`}
        </h3>
        <p className="text-md-on-surface-variant text-sm mt-2 max-w-md mx-auto">
          {result.forfeited
            ? 'A perda de foco durante o duelo anula o turno (regra anti-consulta).'
            : result.winnerId
              ? 'Batalha finalizada! Pontos creditados no ranking do seu departamento.'
              : 'Empate! Nenhum departamento pontua neste duelo.'}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-full bg-md-primary text-md-on-primary font-bold text-sm hover:opacity-90 transition flex items-center gap-2"
          >
            <RotateCcw size={16} /> Voltar às batalhas
          </button>
        </div>
      </div>
    );
  }

  const q = questions[currentIdx];
  return (
    <div className="py-6">
      {focusLost && (
        <div className="mb-4 p-3 rounded-lg bg-md-secondary/25 border border-md-secondary/30 text-md-secondary text-sm text-center font-semibold">
          Perda de foco detectada! O turno será anulado ao enviar.
        </div>
      )}
      {renderTimer()}
      <div className="max-w-2xl mx-auto bg-md-surface-container border border-md-outline-variant rounded-2xl p-6 md:p-8">
        <h3 className="text-lg md:text-xl font-bold text-md-on-surface leading-snug mb-6">
          {q?.question}
        </h3>
        <div className="space-y-2.5">
          {q?.options.map((opt, idx) => {
            const isSelected = selected === idx;
            return (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                disabled={focusLost}
                className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition ${
                  isSelected
                    ? 'border-md-primary bg-md-primary/15 text-md-on-surface'
                    : 'border-md-outline-variant bg-md-surface-container-low text-md-on-surface hover:border-md-outline hover:bg-md-surface-container'
                } ${focusLost ? 'opacity-60' : ''}`}
              >
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-md-surface-container-high text-xs font-bold mr-3">
                  {String.fromCharCode(65 + idx)}
                </span>
                {opt}
              </button>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleAdvanceNow}
            disabled={selected === null || focusLost}
            className="px-6 py-2.5 rounded-full bg-md-primary text-md-on-primary font-bold text-sm hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {currentIdx >= questions.length - 1 ? 'Enviar duelo' : 'Próxima questão'}
          </button>
        </div>
      </div>
    </div>
  );
}
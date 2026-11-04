'use client';

import { ChevronLeft, ChevronRight, Captions, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { LessonVideo as LessonVideoData } from '@/schemas/lesson-kit';

/**
 * Videoaula narrada.
 *
 * A "videoaula" não é um MP4: é um roteiro de cenas que o player executa —
 * título grande, fala e tempo. A narração usa a voz do próprio navegador
 * (`speechSynthesis`, pt-BR), então funciona sem chave de API, sem TTS pago e
 * sem baixar nada.
 *
 * Consequência honesta: a qualidade da voz varia por dispositivo, e em
 * navegador sem voz instalada a aula continua legível (o texto na tela e a
 * legenda carregam o conteúdo; a cena avança pelo tempo declarado no roteiro).
 * Por isso legenda é padrão e existe o botão de voz.
 *
 * `videoUrl` no curso real (quando existir) continua sendo tratado pelo
 * `VideoPlayer` antigo — este componente é para o roteiro gerado.
 */
export default function LessonVideo({ video }: { video: LessonVideoData }) {
  const scenes = video.scenes;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [captionsOn, setCaptionsOn] = useState(true);
  // Inicializador preguiçoso em vez de useEffect: o valor não muda em runtime e
  // setState dentro de efeito dispara render em cascata (react-hooks).
  const [supported] = useState(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window,
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scene = scenes[Math.min(index, scenes.length - 1)];

  const totalSeconds = useMemo(
    () => scenes.reduce((sum, item) => sum + item.seconds, 0),
    [scenes],
  );

  const stopSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const goTo = useCallback(
    (next: number) => {
      clearTimer();
      stopSpeech();
      setIndex(Math.max(0, Math.min(scenes.length - 1, next)));
    },
    [clearTimer, scenes.length, stopSpeech],
  );

  // Motor de reprodução: fala a cena e avança.
  useEffect(() => {
    if (!playing) {
      clearTimer();
      stopSpeech();
      return;
    }

    const finishScene = () => {
      if (index + 1 < scenes.length) {
        setIndex((current) => current + 1);
      } else {
        setPlaying(false);
      }
    };

    // Rede de segurança: se a síntese de voz não existir (ou não disparar
    // `onend`), a cena ainda avança no tempo declarado no roteiro.
    timer.current = setTimeout(finishScene, Math.max(4, scene.seconds) * 1000);

    if (voiceOn && supported) {
      const utterance = new SpeechSynthesisUtterance(scene.narration);
      utterance.lang = 'pt-BR';
      utterance.rate = 1.02;
      utterance.pitch = 1;
      utterance.onend = () => {
        clearTimer();
        finishScene();
      };
      utterance.onerror = () => {
        // Mantém o timer como plano B.
      };
      const voices = window.speechSynthesis.getVoices();
      const ptVoice = voices.find((v) => v.lang?.toLowerCase().startsWith('pt'));
      if (ptVoice) utterance.voice = ptVoice;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }

    return () => {
      clearTimer();
      stopSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index, voiceOn, supported]);

  const progress = scenes.length > 1 ? (index / (scenes.length - 1)) * 100 : 100;
  const elapsed = scenes.slice(0, index).reduce((sum, item) => sum + item.seconds, 0);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="rounded-3xl overflow-hidden bg-md-inverse-surface md-elevation-3">
      {/* Palco */}
      <div className="relative min-h-[320px] sm:min-h-[380px] flex flex-col justify-between p-6 sm:p-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(ellipse 70% 60% at 20% 0%, color-mix(in srgb, var(--color-md-tertiary) 22%, transparent) 0%, transparent 70%)',
          }}
        />

        <div className="relative flex items-center justify-between text-[11px] font-bold uppercase tracking-widest text-white/50">
          <span>{video.title}</span>
          <span>
            Cena {index + 1}/{scenes.length}
          </span>
        </div>

        <div className=" relative my-8 flex-1 flex flex-col justify-center">
          <p className="text-2xl sm:text-4xl font-black text-white leading-tight tracking-tight">
            {scene.onScreen}
          </p>
          <p className="mt-4 text-sm text-md-tertiary-container/90 flex items-center gap-2">
            <span className="inline-block h-1 w-8 rounded-full bg-md-tertiary-container/70" />
            {scene.visual}
          </p>
        </div>

        {captionsOn && (
          <p className="relative text-sm sm:text-base text-white/85 leading-relaxed max-w-3xl">
            {scene.narration}
          </p>
        )}
      </div>

      {/* Barra de progresso por cena */}
      <div className="flex gap-1 px-4 sm:px-6" aria-hidden="true">
        {scenes.map((item, i) => (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Ir para a cena ${i + 1}`}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < index ? 'bg-md-tertiary-container' : i === index ? 'bg-md-tertiary-container/70' : 'bg-white/15'
            }`}
          />
        ))}
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-4">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="Cena anterior"
          className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={20} />
        </button>

        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="inline-flex items-center gap-2 rounded-full bg-md-tertiary-container px-5 py-2.5 text-sm font-bold text-md-on-tertiary-container hover:bg-md-tertiary-container/90 transition-colors"
        >
          {playing ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
          {playing ? 'Pausar' : index === 0 ? 'Assistir' : 'Continuar'}
        </button>

        <button
          type="button"
          onClick={() => goTo(index + 1)}
          disabled={index >= scenes.length - 1}
          aria-label="Próxima cena"
          className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
        >
          <ChevronRight size={20} />
        </button>

        <span className="ml-1 text-xs font-mono text-white/50">
          {formatTime(elapsed)} / {formatTime(totalSeconds)}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setVoiceOn((v) => !v)}
            aria-pressed={voiceOn}
            title="Narração por voz do dispositivo"
            className={`p-2 rounded-full transition-colors ${
              voiceOn ? 'text-md-tertiary-container hover:bg-white/10' : 'text-white/40 hover:bg-white/10'
            }`}
          >
            {voiceOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            type="button"
            onClick={() => setCaptionsOn((c) => !c)}
            aria-pressed={captionsOn}
            title="Legenda"
            className={`p-2 rounded-full transition-colors ${
              captionsOn ? 'text-md-tertiary-container hover:bg-white/10' : 'text-white/40 hover:bg-white/10'
            }`}
          >
            <Captions size={18} />
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-6 pb-4 text-[11px] text-white/35">
        Progresso da aula: {Math.round(progress)}%
      </div>
    </div>
  );
}

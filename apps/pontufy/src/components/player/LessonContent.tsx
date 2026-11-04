'use client';

import { type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, BookOpen } from 'lucide-react';

// Renderiza EXCLUSIVAMENTE o markdown da aula ativa (prop `content`) — nunca a
// descrição global do curso. Aula de vídeo usa VideoPlayer + este mesmo
// conteúdo abaixo; aulas de texto usam apenas este componente.

interface LessonContentProps {
  content: string;
  lessonTitle: string;
  lessonIndex: number; // 1-based
  totalLessons: number;
  points: number;
  completed: boolean;
  isCompleting: boolean;
  onComplete: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}

function formatInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-md-on-surface">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: ReactNode[] = [];
  let currentParagraph: string[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let key = 0;

  const flush = () => {
    if (currentList) {
      const items = currentList.items;
      if (currentList.type === 'ul') {
        elements.push(
          <ul key={key++} className="list-disc ml-5 space-y-1.5 mb-5 text-md-on-surface">
            {items.map((item, i) => (
              <li key={i} className="leading-relaxed">{formatInline(item)}</li>
            ))}
          </ul>,
        );
      } else {
        elements.push(
          <ol key={key++} className="list-decimal ml-5 space-y-1.5 mb-5 text-md-on-surface">
            {items.map((item, i) => (
              <li key={i} className="leading-relaxed">{formatInline(item)}</li>
            ))}
          </ol>,
        );
      }
      currentList = null;
    }
    if (currentParagraph.length > 0) {
      const text = currentParagraph.join(' ');
      if (text.trim()) {
        elements.push(
          <p key={key++} className="mb-5 leading-relaxed text-md-on-surface">
            {formatInline(text)}
          </p>,
        );
      }
      currentParagraph = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('## ')) {
      flush();
      elements.push(
        <h2 key={key++} className="text-xl font-bold text-md-on-surface mt-8 mb-3 first:mt-0 border-b border-md-outline pb-2">
          {formatInline(trimmed.slice(3))}
        </h2>,
      );
    } else if (trimmed.startsWith('### ')) {
      flush();
      elements.push(
        <h3 key={key++} className="text-base font-bold text-md-on-surface mt-6 mb-2">
          {formatInline(trimmed.slice(4))}
        </h3>,
      );
    } else if (/^[-*]\s/.test(trimmed)) {
      if (currentParagraph.length > 0) flush();
      if (!currentList || currentList.type !== 'ul') {
        if (currentList) flush();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(trimmed.replace(/^[-*]\s/, ''));
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (currentParagraph.length > 0) flush();
      if (!currentList || currentList.type !== 'ol') {
        if (currentList) flush();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(trimmed.replace(/^\d+\.\s/, ''));
    } else if (trimmed === '') {
      flush();
    } else {
      if (currentList) flush();
      currentParagraph.push(trimmed);
    }
  }
  flush();

  return <div className="lesson-content text-sm sm:text-base leading-relaxed">{elements}</div>;
}

export default function LessonContent({
  content,
  lessonTitle,
  lessonIndex,
  totalLessons,
  points,
  completed,
  isCompleting,
  onComplete,
  onPrevious,
  onNext,
}: LessonContentProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto">
        {/* Cabeçalho da aula */}
        <div className="bg-md-surface border-b border-md-outline px-6 sm:px-10 py-6">
          <div className="flex items-center gap-2 text-md-on-surface-muted text-xs mb-2">
            <BookOpen size={13} />
            <span>Aula {lessonIndex} de {totalLessons}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-md-on-surface">{lessonTitle}</h2>
        </div>

        {/* Conteúdo markdown DA AULA ATIVA */}
        <div className="px-6 sm:px-10 py-8 max-w-4xl">
          {content ? (
            <MarkdownContent content={content} />
          ) : (
            <div className="text-center py-16">
              <BookOpen size={40} className="mx-auto text-md-on-surface-muted mb-4" />
              <p className="text-md-on-surface-variant">Conteúdo desta aula em breve.</p>
            </div>
          )}
        </div>
      </div>

      {/* Barra de navegação inferior */}
      <div className="flex-shrink-0 px-6 sm:px-10 py-5 bg-md-surface border-t border-md-outline">
        <div className="flex flex-wrap items-center justify-between gap-3 max-w-4xl">
          <button
            onClick={() => onPrevious?.()}
            disabled={!onPrevious}
            className={`px-4 py-3 rounded-lg font-bold transition-all text-sm flex items-center gap-2 border ${
              onPrevious
                ? 'border-md-outline text-md-on-surface hover:border-md-outline-variant hover:text-md-on-surface'
                : 'border-md-outline text-md-on-surface-muted cursor-not-allowed'
            }`}
          >
            <ArrowLeft size={15} /> Aula Anterior
          </button>

          <button
            onClick={onComplete}
            disabled={completed || isCompleting}
            className={`px-6 py-3 rounded-lg font-bold transition-all text-sm flex items-center gap-2 ${
              completed
                ? 'bg-md-surface-container text-md-on-surface-muted cursor-not-allowed border border-md-outline'
                : 'bg-md-primary text-md-on-primary hover:bg-md-primary-container'
            }`}
          >
            {completed ? (
              <>
                <CheckCircle2 size={16} /> Aula Concluída
              </>
            ) : isCompleting ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Concluindo...
              </>
            ) : (
              <>Concluir Aula (+{points} pts)</>
            )}
          </button>

          <button
            onClick={() => onNext?.()}
            disabled={!onNext}
            className={`px-4 py-3 rounded-lg font-bold transition-all text-sm flex items-center gap-2 ${
              onNext
                ? 'bg-md-secondary text-md-on-secondary hover:bg-md-secondary/90'
                : 'bg-md-surface-container text-md-on-surface-muted cursor-not-allowed border border-md-outline'
            }`}
          >
            Próxima Aula <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
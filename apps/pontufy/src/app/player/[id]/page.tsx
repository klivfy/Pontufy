'use client';
import { useState, useMemo, use } from 'react';
import Link from 'next/link';
import { AnimatePresence } from 'framer-motion';

import VideoPlayer from '@/components/player/VideoPlayer';
import LessonContent from '@/components/player/LessonContent';
import CourseSidebar from '@/components/player/CourseSidebar';
import QuizModal, { type QuizModuleData } from '@/components/player/QuizModal';
import PointsCelebration from '@/components/gamification/PointsCelebration';
import CelebrationModal from '@/components/gamification/CelebrationModal';
import { useCourse, triggerLessonCompletion } from '@/hooks/useApi';
import { useStore } from '@/store/useStore';
import { getCachedCourses } from '@/lib/local-courses';
import { parseQuizModules } from '@/schemas/quiz';
import { downloadCertificate } from '@/lib/download-certificate';
import { getUserTier } from '@/lib/gamification';
import { Loader2, BookOpen, ArrowLeft, Award, Trophy, Crown, Medal, LoaderCircle } from 'lucide-react';

interface LessonItem {
  id: string;
  title: string;
  type: string;
  points: number;
  completed: boolean;
  content: string; // markdown da aula ativa (nunca a descrição do curso)
  contentUrl?: string | null;
}

interface ApiLesson {
  id: string;
  title: string;
  type: string;
  points?: number;
  pointsAssigned?: number;
  completed?: boolean;
  contentUrl?: string | null;
}

interface LocalCourse {
  id: string;
  title: string;
  description: string | null;
  lessons: LessonItem[];
  quiz: QuizModuleData[] | null;
}

export default function CoursePlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: apiCourse, isLoading, mutate } = useCourse(id);

  const addPoints = useStore((s) => s.addPoints);
  const deductPoints = useStore((s) => s.deductPoints);

  // Cache offline (localStorage, síncrono) derivado — sem setState em effect.
  const localCourse = useMemo<LocalCourse | null>(() => {
    const cached = getCachedCourses().find((c) => c.id === id);
    if (!cached) return null;
    // A3 — o cache já guarda o quiz em objeto; nada de `JSON.parse` aqui.
    // `parseQuizModules` valida o contrato e devolve [] para cache antigo.
    const quiz = parseQuizModules(cached.quizJson);
    return {
      id: cached.id,
      title: cached.title,
      description: cached.description,
      lessons: cached.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        type: l.type,
        contentUrl: l.contentUrl,
        content: l.contentUrl ?? '',
        points: l.pointsAssigned,
        completed: false,
      })),
      quiz,
    };
  }, [id]);

  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [completedOverrides, setCompletedOverrides] = useState<Set<string>>(new Set());
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationPoints, setCelebrationPoints] = useState(0);
  const [celebrationMessage, setCelebrationMessage] = useState('Você acaba de ganhar');
  const [isCompleting, setIsCompleting] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizPassed, setQuizPassed] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Level-up celebration state
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [levelUpData, setLevelUpData] = useState<{
    previousTier: string;
    newTier: { name: string; color: string; icon: typeof Trophy | typeof Crown | typeof Medal };
    points: number;
  } | null>(null);

  const course = apiCourse && !apiCourse.error ? apiCourse : localCourse;

  if (isLoading && !localCourse) {
    return (
      <div className="flex items-center justify-center h-screen bg-md-surface-dim">
        <Loader2 className="animate-spin text-md-primary" size={36} />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-md-surface-dim gap-4">
        <BookOpen size={48} className="text-md-on-surface-muted" />
        <p className="text-md-on-surface text-lg font-bold">Curso não encontrado.</p>
        <Link href="/dashboard" className="text-md-primary-container font-bold hover:text-md-secondary transition-colors">
          ← Voltar ao Início
        </Link>
      </div>
    );
  }

  const lessons: LessonItem[] = ((course?.lessons ?? []) as ApiLesson[]).map((l) => ({
    id: l.id,
    title: l.title,
    type: l.type,
    points: l.points ?? l.pointsAssigned ?? 0,
    completed: !!l.completed,
    content: l.contentUrl ?? '',
    contentUrl: l.contentUrl,
  }));

  const completedMap = new Set<string>([
    ...lessons.filter((l) => l.completed).map((l) => l.id),
    ...completedOverrides,
  ]);

  const firstIncomplete = lessons.find((l) => !completedMap.has(l.id));
  const activeLesson = lessons.find((l) => l.id === activeLessonId) ?? firstIncomplete ?? lessons[0];
  const completedCount = lessons.filter((l) => completedMap.has(l.id)).length;
  const allCompleted = lessons.length > 0 && completedCount === lessons.length;
  const modules: QuizModuleData[] = course.quiz ?? [];
  const passed = quizPassed || !!course.quizPassed;

  if (!activeLesson) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-md-surface-dim gap-4">
        <p className="text-md-on-surface text-lg font-bold">Este curso não possui aulas.</p>
        <Link href="/dashboard" className="text-md-primary-container font-bold hover:text-md-secondary transition-colors">
          ← Voltar ao Início
        </Link>
      </div>
    );
  }

  const currentIndex = lessons.findIndex((l) => l.id === activeLesson.id);
  const prevLesson = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null;
  const isVideoLesson = activeLesson.type === 'video';

  const celebrate = (points: number, message: string) => {
    setCelebrationPoints(points);
    setCelebrationMessage(message);
    setShowCelebration(true);
  };

  // Verifica subida de nível após ganho de pontos
  const checkLevelUp = (previousPoints: number, newPoints: number) => {
    const previousTier = getUserTier(previousPoints);
    const newTier = getUserTier(newPoints);
    
    if (previousTier.name !== newTier.name) {
      const TierIcon = previousTier.name === 'Mestre' ? Trophy : 
        previousTier.name === 'Especialista' ? Crown : Trophy;
      setLevelUpData({
        previousTier: previousTier.name,
        newTier: {
          name: newTier.name,
          color: newTier.name === 'Mestre' ? 'text-md-on-highlight' :
            newTier.name === 'Especialista' ? 'text-md-secondary' :
            newTier.name === 'Analista Sénior' ? 'text-md-primary' :
            newTier.name === 'Analista' ? 'text-md-tertiary' : 'text-md-on-surface-variant',
          icon: TierIcon,
        },
        points: newPoints,
      });
      setShowLevelUp(true);
    }
  };

  const handleLessonComplete = async () => {
    if (completedMap.has(activeLesson.id) || isCompleting) return;

    const previousPoints = useStore.getState().currentPointsBalance;
    setIsCompleting(true);
    // Otimista: reflete os pontos imediatamente no store global (Navbar reativa).
    addPoints(activeLesson.points);
    const newPoints = useStore.getState().currentPointsBalance;
    checkLevelUp(previousPoints, newPoints);
    try {
      const res = await triggerLessonCompletion(activeLesson.id, {
        courseId: course.id,
        courseTitle: course.title,
        courseDescription: course.description,
        lessons: lessons.map((l) => ({
          id: l.id,
          title: l.title,
          type: l.type,
          contentUrl: l.contentUrl ?? undefined,
          points: l.points,
        })),
      });

      if (res.success) {
        setCompletedOverrides((prev) => new Set(prev).add(activeLesson.id));
        celebrate(activeLesson.points, 'Você acaba de ganhar');
        mutate();
      } else if (res.queued) {
        // Offline: salvo na fila local; será sincronizado automaticamente.
        setCompletedOverrides((prev) => new Set(prev).add(activeLesson.id));
        celebrate(activeLesson.points, 'Aula salva offline — sincronização automática');
      } else {
        // Rollback do saldo otimista em caso de falha.
        deductPoints(activeLesson.points);
        alert(res.error || 'Erro ao completar a aula.');
      }
    } catch (error) {
      deductPoints(activeLesson.points);
      console.error(error);
      alert('Erro ao concluir a aula.');
    } finally {
      setIsCompleting(false);
    }
  };

  const handleDownloadCertificate = async () => {
    setIsDownloading(true);
    try {
      await downloadCertificate(course.id, course.title);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao baixar certificado.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleQuizPassed = (result: { score: number; total: number; bonusAwarded: boolean }) => {
    setQuizPassed(true);
    if (result.bonusAwarded) {
      const previousPoints = useStore.getState().currentPointsBalance;
      addPoints(50);
      const newPoints = useStore.getState().currentPointsBalance;
      checkLevelUp(previousPoints, newPoints);
      celebrate(50, 'Bônus por aprovação no quiz');
    }
  };

  const lessonNavProps = {
    lessonTitle: activeLesson.title,
    lessonIndex: currentIndex + 1,
    totalLessons: lessons.length,
    points: activeLesson.points,
    completed: completedMap.has(activeLesson.id),
    isCompleting,
    onComplete: handleLessonComplete,
    onPrevious: prevLesson ? () => setActiveLessonId(prevLesson.id) : null,
    onNext: nextLesson ? () => setActiveLessonId(nextLesson.id) : null,
  };

  return (
    <div className="flex flex-col h-screen bg-md-surface-dim overflow-hidden">
      <PointsCelebration
        points={celebrationPoints}
        isVisible={showCelebration}
        message={celebrationMessage}
        onComplete={() => setShowCelebration(false)}
      />
      <CelebrationModal
        isVisible={showLevelUp}
        onComplete={() => { setShowLevelUp(false); setLevelUpData(null); }}
        type="levelUp"
        title="Subiu de Nível!"
        subtitle={`Parabéns! Você alcançou o nível ${levelUpData?.newTier?.name}.`}
        newTier={levelUpData ? {
          name: levelUpData.newTier.name,
          color: levelUpData.newTier.color,
          icon: levelUpData.newTier.icon,
        } : undefined}
        previousTier={levelUpData?.previousTier}
      />

      {/* Top bar (Udemy-style) */}
      <div className="h-14 flex-shrink-0 bg-md-surface border-b border-md-outline flex items-center px-4 gap-4 z-40">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-md-on-surface-variant hover:text-md-on-surface transition-colors text-sm font-medium"
        >
          <ArrowLeft size={18} />
          <span className="hidden sm:inline">Voltar</span>
        </Link>
        <div className="h-5 w-px bg-md-outline" />
        <h1 className="text-sm font-bold text-md-on-surface truncate flex-1">{course.title}</h1>
        <div className="text-xs text-md-on-surface-variant hidden sm:block">
          {completedCount}/{lessons.length} aulas
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Content area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {isVideoLesson ? (
            <>
              <div className="aspect-video lg:aspect-auto lg:flex-none lg:h-[52%] bg-black flex-shrink-0">
                <VideoPlayer lesson={{ id: activeLesson.id, title: activeLesson.title, videoUrl: activeLesson.contentUrl ?? undefined }} />
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                <LessonContent content={activeLesson.content} {...lessonNavProps} />
              </div>
            </>
          ) : (
            <LessonContent content={activeLesson.content} {...lessonNavProps} />
          )}

          {/* CTA do Quiz / Certificado (rodapé do conteúdo) */}
          {allCompleted && (
            <div className="flex-shrink-0 px-6 sm:px-10 py-6 border-t border-md-outline bg-md-surface-dim">
              {!passed ? (
                <div className="max-w-4xl flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-md-tertiary/10 rounded-full flex items-center justify-center">
                      <Trophy size={18} className="text-md-tertiary" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-md-on-surface">Quiz final disponível!</p>
                      <p className="text-xs text-md-on-surface-variant">Nota mínima: 70% · Bônus de +50 pts</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setQuizOpen(true)}
                    className="px-6 py-3 rounded-lg font-bold text-sm bg-md-primary text-md-on-primary hover:bg-md-primary-container transition-colors"
                  >
                    Iniciar Quiz Final
                  </button>
                </div>
              ) : (
                <div className="max-w-4xl flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-md-tertiary/10 rounded-full flex items-center justify-center">
                      <Award size={18} className="text-md-tertiary" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-md-on-surface">Curso concluído!</p>
                      <p className="text-xs text-md-on-surface-variant">Seu certificado com código de verificação está pronto.</p>
                    </div>
                  </div>
                  <button
                    onClick={handleDownloadCertificate}
                    disabled={isDownloading}
                    className="flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm bg-md-surface-container text-md-on-surface hover:bg-md-surface-container-high border border-md-outline disabled:opacity-50 transition-colors"
                  >
                    {isDownloading ? (
                      <>
                        <LoaderCircle size={16} className="animate-spin" /> Gerando...
                      </>
                    ) : (
                      <>
                        <Award size={16} /> Emitir Certificado
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar (desktop) */}
        <div className="hidden lg:flex w-[340px] xl:w-[380px] flex-shrink-0 border-l border-md-outline flex-col">
          <CourseSidebar
            lessons={lessons.map((l) => ({
              id: l.id,
              title: l.title,
              points: l.points,
              completed: completedMap.has(l.id),
            }))}
            activeLesson={{
              id: activeLesson.id,
              title: activeLesson.title,
              points: activeLesson.points,
              completed: completedMap.has(activeLesson.id),
            }}
            completedCount={completedCount}
            onLessonClick={(lesson) => setActiveLessonId(lesson.id)}
            allCompleted={allCompleted}
            quizPassed={passed}
            onOpenQuiz={() => setQuizOpen(true)}
          />
        </div>
      </div>

      {/* Sidebar (mobile bottom sheet) */}
      <div className="lg:hidden border-t border-md-outline bg-md-surface max-h-[40vh] overflow-hidden">
        <CourseSidebar
          lessons={lessons.map((l) => ({
            id: l.id,
            title: l.title,
            points: l.points,
            completed: completedMap.has(l.id),
          }))}
          activeLesson={{
            id: activeLesson.id,
            title: activeLesson.title,
            points: activeLesson.points,
            completed: completedMap.has(activeLesson.id),
          }}
          completedCount={completedCount}
          onLessonClick={(lesson) => setActiveLessonId(lesson.id)}
          allCompleted={allCompleted}
          quizPassed={passed}
          onOpenQuiz={() => setQuizOpen(true)}
        />
      </div>

      {/* Quiz Modal (remontado a cada abertura → estado sempre limpo) */}
      <AnimatePresence>
        {quizOpen && (
          <QuizModal
            courseId={course.id}
            courseTitle={course.title}
            modules={modules}
            alreadyPassed={passed}
            onClose={() => setQuizOpen(false)}
            onQuizPassed={handleQuizPassed}
            onEmitCertificate={handleDownloadCertificate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
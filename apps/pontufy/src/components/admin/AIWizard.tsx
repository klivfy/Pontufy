'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, CheckCircle, ChevronRight, ArrowLeft, AlertCircle, Upload, X, FileText, AlertTriangle, Zap, Loader2 } from 'lucide-react';
import { generateTrainingCourse, checkAIProviders } from '@/actions/course-generator';
import type { GenerateTrainingResult } from '@/actions/course-generator';
import { saveCourse } from '@/lib/local-courses';
import { mutate } from 'swr';

type SuccessResult = Extract<GenerateTrainingResult, { success: true }>;

const ALLOWED_EXTENSIONS = [
  '.pdf', '.txt', '.md', '.docx', '.doc',
  '.pptx', '.xlsx', '.csv',
  '.mp4', '.mp3', '.wav', '.webm',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function AIWizard() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [prompt, setPrompt] = useState('');
  const [sector, setSector] = useState('tech');
  const [error, setError] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const [loadingProgress, setLoadingProgress] = useState(0);
  const [activeChecklist, setActiveChecklist] = useState(0);
  const [result, setResult] = useState<SuccessResult | null>(null);
  // IA-5 — publicar é ato humano: o curso nasce rascunho e este é o botão.
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  async function handlePublish() {
    if (!result) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const response = await fetch(`/api/admin/courses/${result.courseId}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `Falha ao publicar (${response.status})`);
      }
      setPublished(true);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : 'Falha ao publicar o curso.');
    } finally {
      setPublishing(false);
    }
  }

  const [providerStatus, setProviderStatus] = useState<{
    available: string[];
    configured: boolean;
    diagnostics?: Record<string, string>;
    chainOrder?: string[];
  } | null>(null);

  useEffect(() => {
    checkAIProviders().then(setProviderStatus).catch(() => {});
  }, []);

  const sectorLabels: Record<string, string> = {
    tech: 'Tecnologia e Inovação',
    health: 'Saúde e Bem-Estar',
    retail: 'Varejo e Vendas',
    industry: 'Indústria e Manufatura',
  };

  const checklistItems = files.length > 0
    ? [
        'Processando materiais de referência...',
        'Enviando prompt para a IA...',
        'Estruturando módulos de ensino...',
        'Calibrando distribuição de recompensas (pts)...',
        'Finalizando formatação...',
      ]
    : [
        'Enviando prompt para a IA...',
        'Estruturando módulos de ensino...',
        'Calibrando distribuição de recompensas (pts)...',
        'Finalizando formatação...',
      ];

  const addFiles = (newFiles: FileList | File[]) => {
    const valid: File[] = [];
    for (const f of Array.from(newFiles)) {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) continue;
      if (f.size > MAX_FILE_SIZE) continue;
      if (files.length + valid.length >= MAX_FILES) break;
      valid.push(f);
    }
    if (valid.length > 0) setFiles((prev) => [...prev, ...valid]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const extractTextFromFiles = async (): Promise<string> => {
    if (files.length === 0) return '';

    const clientTexts: string[] = [];
    const serverFiles: File[] = [];

    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase();
      if (ext === 'txt' || ext === 'md' || ext === 'csv') {
        const text = await f.text();
        clientTexts.push(`=== ${f.name} ===\n${text}`);
      } else {
        serverFiles.push(f);
      }
    }

    if (serverFiles.length > 0) {
      const formData = new FormData();
      serverFiles.forEach((f) => formData.append('files', f));
      try {
        const res = await fetch('/api/files/extract', { method: 'POST', body: formData });
        if (res.ok) {
          const { results } = await res.json();
          for (const r of results) {
            if (r.text) clientTexts.push(`=== ${r.name} ===\n${r.text}`);
          }
        }
      } catch (err) {
        console.error('[AIWizard] Erro ao extrair texto dos arquivos:', err);
      }
    }

    return clientTexts.join('\n\n');
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setStep(2);
    setLoadingProgress(0);
    setActiveChecklist(0);
    setError('');

    try {
      const referenceContent = await extractTextFromFiles();

      const res = await generateTrainingCourse({
        prompt,
        sector: sectorLabels[sector] ?? sector,
        referenceContent: referenceContent || undefined,
      });

      if (!res.success) {
        setError(res.error);
        setStep(1);
        return;
      }

      saveCourse({
        id: res.course.id,
        title: res.course.title,
        description: res.course.description,
        status: res.course.status,
        createdAt: res.course.createdAt,
        cachedAt: Date.now(),
        quizJson: res.course.quizJson,
        lessons: res.course.lessons,
      });

      setResult(res);
      setStep(3);

      mutate('/api/courses?limit=50');
      mutate('/api/courses?page=1&limit=12');
      mutate('/api/courses/enrolled');
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro inesperado ao gerar curso. Verifique o console do servidor.';
      setError(message);
      setStep(1);
    }
  };

  useEffect(() => {
    if (step === 2) {
      const total = checklistItems.length;
      const interval = setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev >= 95) return 95;
          const next = prev + 1;
          const stepSize = Math.floor(90 / total);
          const newChecklist = Math.min(total - 1, Math.floor(next / stepSize));
          setActiveChecklist(newChecklist);
          return next;
        });
      }, 200);
      return () => clearInterval(interval);
    }
  }, [step, checklistItems.length]);

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1, 2, 3].map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-label-lg font-bold transition-all ${
              step > s
                ? 'bg-md-tertiary text-md-on-tertiary'
                : step === s
                ? 'bg-md-primary text-md-on-primary'
                : 'bg-md-surface-container-high text-md-on-surface-variant border border-md-outline'
            }`}
          >
            {step > s ? <CheckCircle size={20} /> : s}
          </div>
          {s < 3 && (
            <div
              className={`w-16 h-1 rounded-full hidden sm:block ${
                step > s ? 'bg-md-tertiary' : 'bg-md-outline'
              }`}
            />
          )}
          <span
            className={`hidden md:block text-label-sm font-medium ${
              step >= s ? 'text-md-on-surface' : 'text-md-on-surface-variant'
            }`}
          >
            {['Escopo', 'Geração', 'Revisão'][s - 1]}
          </span>
        </div>
      ))}
    </div>
  );

  if (step === 1) {
    return (
      <div className="md-card-outlined md-elevation-1 p-6 sm:p-8 animate-[fadeIn_0.3s_ease-out]">
        {renderStepIndicator()}

        <div className="mb-8">
          <h2 className="text-headline-sm font-bold text-md-on-surface flex items-center gap-2 mb-2">
            <Sparkles className="text-md-primary" size={24} /> Assistente de IA
          </h2>
          <p className="text-body-md text-md-on-surface-variant">Crie treinamentos corporativos engajadores em segundos.</p>
        </div>

        {providerStatus && !providerStatus.configured && (
          <div className="mb-6 p-4 bg-md-highlight/10 border border-md-highlight/30 rounded-xl">
            <div className="flex items-start gap-3 text-md-on-highlight">
              <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-body-md font-bold">Motor de IA não configurado</p>
                <p className="text-body-sm mt-1">
                  Nenhuma chave de API de IA está configurada. Os cursos serão gerados com um <strong>template básico</strong>.
                </p>
                <p className="text-body-sm mt-2 font-medium">
                  Para geração inteligente, configure no Vercel (Settings → Environment Variables):
                </p>
                <ul className="text-body-sm mt-1 space-y-1 ml-4 list-disc">
                  <li><code className="bg-md-highlight/20 px-1 rounded text-xs">GEMINI_API_KEY</code> — Gratuito em aistudio.google.com</li>
                  <li><code className="bg-md-highlight/20 px-1 rounded text-xs">OPENAI_API_KEY</code> — platform.openai.com</li>
                  <li><code className="bg-md-highlight/20 px-1 rounded text-xs">ANTHROPIC_API_KEY</code> — console.anthropic.com</li>
                </ul>
                <p className="text-xs mt-3 text-md-on-highlight/70 font-medium">
                  Importante: Configure a variável para TODOS os ambientes (Production, Preview e Development) no Vercel.
                </p>
                {providerStatus.diagnostics && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-md-on-highlight/70">Diagnóstico do servidor</summary>
                    <ul className="mt-1 space-y-0.5 text-xs text-md-on-highlight/60">
                      {Object.entries(providerStatus.diagnostics).map(([k, v]) => (
                        <li key={k}><strong>{k}:</strong> {v}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          </div>
        )}

        {providerStatus && providerStatus.configured && (
          <div className="mb-6 p-3 bg-md-tertiary-container/20 border border-md-tertiary-container/30 rounded-xl flex items-center gap-3 text-md-on-tertiary-container">
            <Zap size={18} />
            <span className="text-body-sm font-medium">
              IA ativa: {providerStatus.available.join(', ')}
              {providerStatus.chainOrder && providerStatus.chainOrder.length > 0 && (
                <span className="text-md-on-tertiary-container/80 ml-1">
                  (ordem: {providerStatus.chainOrder.join(' → ')})
                </span>
              )}
            </span>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-md-error/10 border border-md-error/30 rounded-xl flex items-center gap-3 text-md-error">
            <AlertCircle size={20} />
            <span className="text-body-sm font-medium">{error}</span>
          </div>
        )}

        <div className="space-y-6">
          <div>
            <label className="text-label-lg text-md-on-surface-variant mb-2 block">
              Setor/Vertical de Atuação
            </label>
            <select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className="w-full bg-md-surface-container border border-md-outline text-md-on-surface rounded-xl p-3 outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 transition-all text-body-md"
            >
              <option value="tech">Tecnologia e Inovação</option>
              <option value="health">Saúde e Bem-Estar</option>
              <option value="retail">Varejo e Vendas</option>
              <option value="industry">Indústria e Manufatura</option>
            </select>
          </div>

          <div>
            <label className="text-label-lg text-md-on-surface-variant mb-2 block">
              O que você deseja ensinar?
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-32 bg-md-surface-container border border-md-outline text-md-on-surface rounded-xl p-3 outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 transition-all resize-none text-body-md placeholder:text-md-on-surface-variant/50"
              placeholder="Ex: Crie um treinamento de LGPD focado na equipe de atendimento ao cliente, com foco prático em proteção de dados e cenários de call center..."
            />
          </div>

          <div>
            <label className="text-label-lg text-md-on-surface-variant mb-2 block">
              Material de Referência <span className="text-md-on-surface-variant/60 font-normal">(opcional)</span>
            </label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                dragOver
                  ? 'border-md-primary bg-md-primary/5'
                  : 'border-md-outline hover:border-md-primary hover:bg-md-surface-container-high/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALLOWED_EXTENSIONS.join(',')}
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
                className="hidden"
              />
              <Upload size={24} className="mx-auto mb-2 text-md-on-surface-variant/50" />
              <p className="text-body-sm text-md-on-surface-variant">
                Arraste arquivos aqui ou <span className="text-md-primary font-semibold">clique para selecionar</span>
              </p>
              <p className="text-xs text-md-on-surface-variant/50 mt-1">
                PDF, Word, TXT, PowerPoint, Excel, MD, MP4, MP3 — até {MAX_FILES} arquivos, 10MB cada
              </p>
            </div>

            {files.length > 0 && (
              <div className="mt-3 space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 bg-md-surface-container-high rounded-lg px-3 py-2 group">
                    <FileText size={16} className="text-md-primary flex-shrink-0" />
                    <span className="text-body-sm text-md-on-surface truncate flex-1">{f.name}</span>
                    <span className="text-xs text-md-on-surface-variant/60">{formatFileSize(f.size)}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      className="p-1 rounded hover:bg-md-outline transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X size={14} className="text-md-on-surface-variant/50" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-4 border-t border-md-outline">
            <div className="flex items-center gap-2 text-body-sm">
              <span className="text-md-on-surface-variant">Custo da operação:</span>
              <span className="font-bold text-md-primary bg-md-primary-container px-2 py-0.5 rounded-full">
                1 Crédito de IA
              </span>
            </div>

            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className={`md-btn md-btn-filled flex items-center justify-center gap-2 px-8 transition-all ${
                prompt.trim()
                  ? ''
                  : 'opacity-50 cursor-not-allowed'
              }`}
            >
              Gerar Treinamento <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="md-card-outlined md-elevation-1 p-6 sm:p-12 text-center animate-[fadeIn_0.3s_ease-out]">
        {renderStepIndicator()}

        <div className="w-16 h-16 bg-md-primary rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-md-primary/30 animate-pulse">
          <Sparkles className="text-md-on-primary" size={32} />
        </div>
        <h2 className="text-headline-sm font-bold text-md-on-surface mb-2">A IA está trabalhando...</h2>
        <p className="text-body-md text-md-on-surface-variant mb-10">Isso pode levar até 30 segundos.</p>

        <div className="w-full max-w-xl mx-auto h-2 bg-md-outline rounded-full overflow-hidden mb-8">
          <div
            className="h-full bg-md-primary rounded-full transition-all duration-300 ease-out"
            style={{ width: `${loadingProgress}%` }}
          />
        </div>

        <div className="w-full max-w-sm mx-auto text-left space-y-4">
          {checklistItems.map((item, index) => {
            const isCompleted = index < activeChecklist;
            const isActive = index === activeChecklist;
            return (
              <div
                key={index}
                className={`flex items-center gap-3 transition-all duration-500 ${
                  isCompleted ? 'text-md-tertiary' : isActive ? 'text-md-on-surface font-semibold' : 'text-md-on-surface-variant/60'
                }`}
              >
                {isCompleted ? (
                  <CheckCircle size={18} />
                ) : (
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                      isActive ? 'border-md-primary border-t-md-tertiary animate-spin' : 'border-md-outline'
                    }`}
                  />
                )}
                <span className="text-body-sm">{item}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (step === 3 && result) {
    const lessons = result.course.lessons;
    const isTemplate = result.provider.startsWith('local:');
    const review = result.review;
    const conflicts = review?.status === 'conflicts' ? review.conflicts : [];
    const reviewUnavailable = review?.status === 'unavailable';

    return (
      <div className="md-card-outlined md-elevation-1 p-6 sm:p-8 animate-[fadeIn_0.3s_ease-out]">
        {renderStepIndicator()}

        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-headline-sm font-bold text-md-on-surface flex items-center gap-2">
              <CheckCircle className="text-md-tertiary" /> Curso em revisão
            </h2>
            <p className="text-body-md text-md-on-surface-variant mt-1">
              <strong>{result.course.title}</strong> foi salvo como <strong>rascunho</strong>.
              Revise o conteúdo e publique quando aprovar.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {published ? (
              <span className="text-body-sm font-semibold text-md-tertiary flex items-center gap-1">
                <CheckCircle size={16} /> Publicado
              </span>
            ) : (
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="md-btn-filled px-4 py-2 text-body-sm font-semibold disabled:opacity-60"
              >
                {publishing ? 'Publicando…' : 'Publicar curso'}
              </button>
            )}
            <button
              onClick={() => {
                setStep(1);
                setPrompt('');
                setFiles([]);
                setResult(null);
                setPublished(false);
                setPublishError(null);
              }}
              className="text-body-sm font-semibold text-md-on-surface-variant hover:text-md-primary flex items-center gap-1 transition-colors"
            >
              <ArrowLeft size={16} /> Criar outro
            </button>
          </div>
        </div>

        {publishError && (
          <div className="mb-6 p-4 bg-md-error/10 border border-md-error/30 rounded-xl text-body-sm text-md-on-error-container">
            <strong>Não foi possível publicar:</strong> {publishError}
          </div>
        )}

        {isTemplate && (
          <div className="mb-6 p-4 bg-md-highlight/10 border border-md-highlight/30 rounded-xl flex items-start gap-3 text-md-on-highlight">
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
            <div className="text-body-sm">
              <p className="font-bold">Conteúdo gerado por template</p>
              <p className="mt-1">
                Este curso foi criado com um modelo básico porque nenhuma IA está configurada ou todos os provedores falharam.
                Para cursos personalizados e inteligentes, configure uma <code className="bg-md-highlight/20 px-1 rounded text-xs">GEMINI_API_KEY</code> no Vercel.
              </p>
              {result.aiErrors && result.aiErrors.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-medium text-md-on-highlight/70">Ver erros dos provedores</summary>
                  <ul className="mt-1 space-y-1 ml-4 list-disc text-xs text-md-on-highlight/60">
                    {result.aiErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
            </div>
          </div>
        )}

        {/* A9 — o que a revisão automática encontrou. Publicar com conflito
            aberto é decisão consciente do RH, não descuido. */}
        {conflicts.length > 0 && (
          <div className="mb-6 p-4 bg-md-error/10 border border-md-error/30 rounded-xl flex items-start gap-3 text-md-on-error-container">
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
            <div className="text-body-sm">
              <p className="font-bold">
                {conflicts.length} possível(is) contradição(ões) com o material de referência
              </p>
              <p className="mt-1">
                A revisão automática comparou o curso com o material enviado. Confirme antes de publicar.
              </p>
              <ul className="mt-2 space-y-2 ml-4 list-disc text-xs">
                {conflicts.map((conflict, index) => (
                  <li key={index}>
                    <span className="font-semibold">[{conflict.severity === 'high' ? 'grave' : 'atenção'}]</span>{' '}
                    {conflict.finding}
                    <br />
                    <span className="opacity-80">Regra do material: {conflict.rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {reviewUnavailable && (
          <div className="mb-6 p-4 bg-md-highlight/10 border border-md-highlight/30 rounded-xl flex items-start gap-3 text-md-on-highlight">
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
            <div className="text-body-sm">
              <p className="font-bold">Revisão automática indisponível</p>
              <p className="mt-1">
                Nenhum provedor de IA conseguiu comparar o curso com o material. A revisão manual é
                obrigatória neste caso — o curso permanece como rascunho até você publicar.
              </p>
            </div>
          </div>
        )}

        {review?.status === 'clean' && (
          <div className="mb-6 p-4 bg-md-tertiary-container/40 border border-md-tertiary/30 rounded-xl flex items-start gap-3">
            <CheckCircle size={18} className="flex-shrink-0 mt-0.5 text-md-tertiary" />
            <div className="text-body-sm">
              <p className="font-bold text-md-on-surface">Revisão automática sem conflitos</p>
              <p className="mt-1 text-md-on-surface-variant">
                O curso foi comparado com o material e não contraria nenhuma regra identificada.
                Ainda assim, a publicação é sua decisão.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mb-6 text-body-sm">
          <span className="bg-md-tertiary-container text-md-on-tertiary-container font-bold px-3 py-1 rounded-full">
            {result.lessonsCount} aulas
          </span>
          <span className={`font-medium px-3 py-1 rounded-full ${
            isTemplate ? 'bg-md-highlight/10 text-md-on-highlight' : 'bg-md-tertiary-container text-md-on-tertiary-container'
          }`}>
            {isTemplate ? 'Template local' : `IA: ${result.provider}`}
          </span>
          <span className="bg-md-surface-container-high text-md-on-surface-variant font-medium px-3 py-1 rounded-full">
            Créditos restantes: {result.creditsRemaining}
          </span>
          {!result.persisted && (
            <span className="bg-md-highlight/10 text-md-on-highlight font-medium px-3 py-1 rounded-full">
              Salvo localmente
            </span>
          )}
        </div>

        {lessons.length > 0 && (
          <div className="bg-md-surface-container border border-md-outline rounded-xl p-6 mb-8">
            <h3 className="text-title-lg font-bold text-md-on-surface mb-4">Estrutura do Curso</h3>
            <div className="divide-y divide-md-outline bg-md-surface-container-high border border-md-outline rounded-lg overflow-hidden shadow-sm">
              {lessons.map((lesson, i) => (
                <div key={i} className="px-4 py-3 flex justify-between items-center">
                  <span className="text-body-md font-medium text-md-on-surface">{lesson.title}</span>
                  <span className="text-label-sm font-bold text-md-primary bg-md-primary-container px-2 py-1 rounded-full">
                    +{lesson.pointsAssigned} pts
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={() => {
              window.location.href = '/admin';
            }}
            className="md-btn md-btn-filled"
          >
            Voltar ao Painel
          </button>
        </div>
      </div>
    );
  }

  return null;
}
interface VideoPlayerProps {
  lesson: {
    id: string;
    title: string;
    duration?: string;
    videoUrl?: string;
  };
  onComplete?: () => void;
}

const URL_RE = /^https?:\/\//i;

export default function VideoPlayer({ lesson, onComplete }: VideoPlayerProps) {
  if (!lesson) return null;

  const hasVideo = typeof lesson.videoUrl === 'string' && URL_RE.test(lesson.videoUrl);

  return (
    <div className="w-full flex flex-col bg-black h-full relative">
      {hasVideo ? (
        <video
          key={lesson.id}
          src={lesson.videoUrl}
          controls
          playsInline
          preload="metadata"
          className="w-full h-full object-contain"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center relative overflow-hidden group">
          <div className="absolute inset-0 bg-md-surface-dim flex items-center justify-center">
            <div className="text-center">
              <h3 className="text-md-on-surface text-2xl font-bold mb-2">{lesson.title}</h3>
              <p className="text-md-on-surface-variant text-sm">Área do Player de Vídeo</p>
            </div>
          </div>

          <div className="absolute bottom-0 w-full p-4 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-between items-center">
            <div className="text-md-on-surface text-sm">00:00 / {lesson.duration ?? '--:--'}</div>
            <button
              onClick={onComplete}
              className="bg-md-primary hover:bg-md-primary-container text-white font-bold py-1.5 px-4 rounded text-sm transition-colors"
            >
              Marcar como Concluída
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
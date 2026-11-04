'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-md-surface-container-low text-md-on-surface p-6">
        <div className="max-w-md w-full bg-md-surface-container-lowest p-8 rounded-2xl border border-md-outline-variant text-center shadow-2xl">
          <div className="w-16 h-16 mx-auto mb-6 bg-md-error-container text-md-on-error-container rounded-full flex items-center justify-center border border-md-error/30">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-3">Falha Crítica no Sistema</h2>
          <p className="text-md-on-surface mb-8 text-sm">
            Ocorreu um erro inesperado na renderização do aplicativo. A equipe
            técnica foi notificada.
          </p>
          <button
            onClick={() => reset()}
            className="w-full bg-md-tertiary hover:bg-md-tertiary text-white font-bold py-3 px-6 rounded-full transition-all shadow-md hover:shadow-lg"
          >
            Tentar Recarregar
          </button>
          {error.digest && (
            <p className="mt-6 text-xs text-md-on-surface-variant font-mono">
              Digest: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}

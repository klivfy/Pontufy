import { Suspense } from 'react';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export default function ResetPasswordPage() {
  const SuspenseBoundary = () => (
    <Suspense
      fallback={
        <div className="min-h-screen bg-md-surface-dim flex flex-col items-center justify-center px-4 relative">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 60% 40% at 50% 0%, color-mix(in srgb, var(--color-md-primary) 10%, transparent) 0%, transparent 70%)',
            }}
          />
          <div className="md-card-outlined md-elevation-3 p-8 w-full max-w-md mx-auto">
            <div className="space-y-4">
              <div className="h-8 w-32 bg-md-surface-container-high rounded-xl animate-pulse" />
              <div className="h-5 w-48 bg-md-surface-container-high rounded-xl animate-pulse" />
              <div className="h-14 bg-md-surface-container-high border border-md-outline rounded-xl animate-pulse" />
              <div className="h-14 bg-md-surface-container-high border border-md-outline rounded-xl animate-pulse" />
              <div className="h-14 bg-md-surface-container-high rounded-full animate-pulse" />
            </div>
          </div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );

  return <SuspenseBoundary />;
}
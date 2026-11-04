import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-md-surface-dim flex flex-col items-center justify-center px-4 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 0%, color-mix(in srgb, var(--color-md-primary) 10%, transparent) 0%, transparent 70%)',
        }}
      />

      <div className="w-full max-w-md">
        <Suspense
          fallback={
            <div className="md-card-outlined md-elevation-3 p-8">
              <div className="space-y-4">
                <div className="h-8 w-32 bg-md-surface-container-high rounded-xl animate-pulse" />
                <div className="h-5 w-48 bg-md-surface-container-high rounded-xl animate-pulse" />
                <div className="h-14 bg-md-surface-container-high border border-md-outline rounded-xl animate-pulse" />
                <div className="h-14 bg-md-surface-container-high border border-md-outline rounded-xl animate-pulse" />
                <div className="h-14 bg-md-surface-container-high rounded-full animate-pulse" />
              </div>
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import BillingClient from './BillingClient';

export default function AdminBillingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="animate-spin text-md-primary" size={40} />
        </div>
      }
    >
      <BillingClient />
    </Suspense>
  );
}

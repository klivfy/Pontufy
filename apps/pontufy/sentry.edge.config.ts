import * as Sentry from '@sentry/nextjs';

import { baseSentryOptions, isSentryEnabled, scrubEvent } from './src/infra/sentry';

// Runtime Edge (o `src/proxy.ts` roda aqui).
if (isSentryEnabled()) {
  Sentry.init({
    ...baseSentryOptions('edge'),
    beforeSend(event) {
      return scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
  });
}

import * as Sentry from '@sentry/nextjs';

import { baseSentryOptions, isSentryEnabled, scrubEvent } from './src/infra/sentry';

// Runtime Node (route handlers, server actions, RSC).
// Sem SENTRY_DSN o init é no-op — não custa nada e não inicializa transporte.
if (isSentryEnabled()) {
  Sentry.init({
    ...baseSentryOptions('server'),
    beforeSend(event) {
      return scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
  });
}

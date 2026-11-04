import * as Sentry from '@sentry/nextjs';

import { baseSentryOptions, isSentryEnabled, scrubEvent } from './src/infra/sentry';

// Runtime do browser. Sem DSN não inicializa — evita baixar o SDK para o
// cliente de quem só está testando localmente.
if (isSentryEnabled()) {
  Sentry.init({
    ...baseSentryOptions('client'),
    beforeSend(event) {
      return scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
  });
}

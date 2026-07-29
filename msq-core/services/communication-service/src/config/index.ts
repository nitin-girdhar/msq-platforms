import { timeoutFromEnv } from '@platform/http';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[communication-service] Missing required env var: ${name}`);
  return value;
}

const smtpHost = process.env['SMTP_HOST'];
const smtpUser = process.env['SMTP_USER'];
const smtpPass = process.env['SMTP_PASS'];
const smtpFromEmail = process.env['SMTP_FROM_EMAIL'];

const interaktApiKey = process.env['INTERAKT_API_KEY'];

export const config = {
  port: parseInt(process.env['COMMUNICATION_SERVICE_PORT'] ?? '4005', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  logLevel: process.env['LOG_LEVEL'] ?? 'info',

  smtp: {
    host: smtpHost ?? '',
    port: parseInt(process.env['SMTP_PORT'] ?? '587', 10),
    secure: process.env['SMTP_SECURE'] === 'true',
    user: smtpUser ?? '',
    pass: smtpPass ?? '',
    fromEmail: smtpFromEmail ?? '',
    fromName: process.env['SMTP_FROM_NAME'] ?? '',
  },

  interakt: {
    apiKey: interaktApiKey ?? '',
    baseUrl: process.env['INTERAKT_API_BASE_URL'] ?? 'https://api.interakt.ai/v1/public/',
    // Third-party network egress — the least trustworthy dependency here and the
    // one most likely to hang. Kept short: a WhatsApp send sits in the latency
    // path of a user-facing request, and it is better to report a failure the
    // user can retry than to hold the connection.
    timeoutMs: timeoutFromEnv('INTERAKT_TIMEOUT_MS', 10_000),
  },

  isEmailConfigured: Boolean(smtpHost && smtpUser && smtpPass && smtpFromEmail),
  isWhatsAppConfigured: Boolean(interaktApiKey),
} as const;

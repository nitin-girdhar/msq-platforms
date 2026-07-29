import { fetchWithTimeout, UpstreamTimeoutError } from '@platform/http';
import { config } from '../../config/index.js';

// ── Interakt API types ──────────────────────────────────────────────────────

export interface SendTemplateInput {
  phoneNumber: string;
  countryCode: string;
  callbackData?: string;
  template: {
    name: string;
    languageCode: string;
    headerValues?: string[];
    bodyValues?: string[];
    buttonValues?: Record<string, string[]>;
  };
}

export interface SendTextInput {
  phoneNumber: string;
  countryCode: string;
  callbackData?: string;
  message: string;
}

export interface SendMediaInput {
  phoneNumber: string;
  countryCode: string;
  callbackData?: string;
  type: 'Image' | 'Document' | 'Video';
  mediaUrl: string;
  caption?: string;
  filename?: string;
}

export interface InteraktApiResponse {
  result: boolean;
  message: string;
  data?: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function cleanPhoneNumber(phone: string): { countryCode: string; phoneNumber: string } {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+')) {
    const countryCode = cleaned.substring(0, cleaned.length - 10);
    const phoneNumber = cleaned.substring(cleaned.length - 10);
    return { countryCode: countryCode.replace('+', ''), phoneNumber };
  }
  if (cleaned.length === 10) {
    return { countryCode: '91', phoneNumber: cleaned };
  }
  return { countryCode: '', phoneNumber: cleaned };
}

async function interaktRequest(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<InteraktApiResponse> {
  const url = `${config.interakt.baseUrl}${endpoint}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${config.interakt.apiKey}`,
      },
      body: JSON.stringify(body),
      timeoutMs: config.interakt.timeoutMs,
      // Never the full URL: it is a third-party endpoint and the error text is
      // surfaced upward.
      target: 'interakt',
    });
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      throw new Error(`Interakt API did not respond within ${err.timeoutMs}ms`);
    }
    throw new Error(`Could not reach the Interakt API: ${(err as Error).message}`);
  }

  // Read the body as text first and parse defensively. Interakt sits behind a
  // CDN, so a 5xx can arrive as an HTML error page — the previous
  // `await response.json()` ran BEFORE the `response.ok` check and threw an
  // opaque JSON parse error, hiding the real status from the caller.
  const raw = await response.text();
  let data: InteraktApiResponse | null = null;
  try {
    data = raw ? (JSON.parse(raw) as InteraktApiResponse) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      `Interakt API error (${response.status}): ${data?.message ?? (raw.slice(0, 200) || 'Unknown error')}`,
    );
  }

  if (!data) {
    throw new Error(`Interakt API returned a non-JSON success body (${response.status})`);
  }

  return data;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function sendTemplateMessage(input: SendTemplateInput): Promise<InteraktApiResponse> {
  const body: Record<string, unknown> = {
    fullPhoneNumber: `${input.countryCode}${input.phoneNumber}`,
    callbackData: input.callbackData ?? '',
    type: 'Template',
    template: {
      name: input.template.name,
      languageCode: input.template.languageCode,
      ...(input.template.headerValues?.length
        ? { headerValues: input.template.headerValues }
        : {}),
      ...(input.template.bodyValues?.length
        ? { bodyValues: input.template.bodyValues }
        : {}),
      ...(input.template.buttonValues
        ? { buttonValues: input.template.buttonValues }
        : {}),
    },
  };

  return interaktRequest('message/', body);
}

export async function sendTextMessage(input: SendTextInput): Promise<InteraktApiResponse> {
  const body: Record<string, unknown> = {
    fullPhoneNumber: `${input.countryCode}${input.phoneNumber}`,
    callbackData: input.callbackData ?? '',
    type: 'Text',
    data: {
      message: input.message,
    },
  };

  return interaktRequest('message/', body);
}

export async function sendMediaMessage(input: SendMediaInput): Promise<InteraktApiResponse> {
  const mediaData: Record<string, unknown> = {
    mediaUrl: input.mediaUrl,
  };
  if (input.caption) mediaData['caption'] = input.caption;
  if (input.filename) mediaData['filename'] = input.filename;

  const body: Record<string, unknown> = {
    fullPhoneNumber: `${input.countryCode}${input.phoneNumber}`,
    callbackData: input.callbackData ?? '',
    type: input.type,
    data: mediaData,
  };

  return interaktRequest('message/', body);
}

export { cleanPhoneNumber };

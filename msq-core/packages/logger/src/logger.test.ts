import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { REDACT_PATHS, sanitizeUrl } from './redact.js';
import { hashForLog, scrubText } from './scrub.js';
import { errorSerializer } from './serializers.js';
import { createLoggerOptions } from './create-logger.js';

/** Builds a logger writing to memory, mirroring the real service config. */
function captureLogger(): { logger: pino.Logger; lines: () => Record<string, unknown>[] } {
  const written: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      written.push(chunk.toString());
      callback();
    },
  });

  // `transport` cannot be combined with a destination stream, and it is absent
  // in production anyway — which is the configuration under test.
  const options = createLoggerOptions({ service: 'test-service', nodeEnv: 'production' });
  const logger = pino(options as pino.LoggerOptions, stream);

  return {
    logger,
    lines: () => written.join('').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  };
}

describe('sanitizeUrl', () => {
  it('blanks the Meta webhook verify token but keeps the rest of the URL', () => {
    const url = '/api/v1/webhook?hub.mode=subscribe&hub.verify_token=s3cret&hub.challenge=abc123';
    const result = sanitizeUrl(url);

    expect(result).not.toContain('s3cret');
    expect(result).toContain('hub.mode=subscribe');
    expect(result).toContain('hub.challenge=abc123');
    expect(result).toContain('hub.verify_token=[REDACTED]');
  });

  it('blanks an access_token query param', () => {
    expect(sanitizeUrl('/v21.0/123/events?access_token=EAAG123abc')).not.toContain('EAAG123abc');
  });

  it('leaves URLs without a query string untouched', () => {
    expect(sanitizeUrl('/api/v1/capi/auto-trigger')).toBe('/api/v1/capi/auto-trigger');
  });

  it('does not throw on malformed percent-encoding', () => {
    expect(() => sanitizeUrl('/x?bad=%E0%A4%A&ok=1')).not.toThrow();
  });
});

describe('scrubText', () => {
  it('removes emails and phone numbers', () => {
    const result = scrubText('contact a.b+tag@example.co.uk on 9876543210');
    expect(result).not.toContain('a.b+tag@example.co.uk');
    expect(result).not.toContain('9876543210');
  });

  it('preserves UUIDs, ISO dates and IP addresses', () => {
    const text = 'lead 4bf92f35-77b3-4da6-a3ce-929d0e0e4736 at 2026-08-03 from 172.16.1.9';
    expect(scrubText(text)).toBe(text);
  });
});

describe('errorSerializer', () => {
  it('drops the axios config carrying the Meta access token', () => {
    const err = Object.assign(new Error('Request failed with status code 400'), {
      name: 'AxiosError',
      isAxiosError: true,
      config: {
        url: 'https://graph.facebook.com/v21.0/123/events',
        params: { access_token: 'EAAGm0PX4ZCpsBO_SUPER_SECRET' },
        headers: { Authorization: 'Bearer nope' },
      },
      request: { _header: 'POST /v21.0 HTTP/1.1\nAuthorization: Bearer nope' },
      response: { status: 400, statusText: 'Bad Request', data: { error: { message: 'Invalid parameter' } } },
    });

    const serialized = errorSerializer(err);
    const asText = JSON.stringify(serialized);

    expect(asText).not.toContain('EAAGm0PX4ZCpsBO_SUPER_SECRET');
    expect(asText).not.toContain('Bearer nope');
    expect(serialized['config']).toBeUndefined();
    expect(serialized['request']).toBeUndefined();
    // The diagnostically useful parts survive.
    expect(serialized.message).toBe('Request failed with status code 400');
    expect((serialized['response'] as Record<string, unknown>)['status']).toBe(400);
    expect(JSON.stringify(serialized['response'])).toContain('Invalid parameter');
  });

  it('truncates an unbounded upstream response body', () => {
    const err = Object.assign(new Error('boom'), {
      response: { status: 500, data: 'x'.repeat(10_000) },
    });

    const data = (errorSerializer(err)['response'] as Record<string, unknown>)['data'] as string;
    expect(data.length).toBeLessThan(600);
    expect(data).toContain('[truncated]');
  });

  it('scrubs PII the leads-service echoed back inside an error message', () => {
    const err = new Error(
      'Intake lead creation failed (422): {"email":"jane@example.com","phone":"9876543210"}',
    );

    const message = errorSerializer(err).message as string;
    expect(message).not.toContain('jane@example.com');
    expect(message).not.toContain('9876543210');
    // Still says what went wrong.
    expect(message).toContain('Intake lead creation failed (422)');
  });

  it('does not mutate the original error', () => {
    const err = Object.assign(new Error('boom'), { config: { params: { access_token: 'secret' } } });
    errorSerializer(err);
    expect((err as unknown as Record<string, unknown>)['config']).toBeDefined();
  });
});

describe('createLoggerOptions', () => {
  it('redacts Meta integration credentials', () => {
    const { logger, lines } = captureLogger();

    logger.info(
      { integration: { id: 'abc', access_token: 'EAAG_secret', app_secret: 'app_secret_val', verify_token: 'vt_val' } },
      'integration loaded',
    );

    const raw = JSON.stringify(lines()[0]);
    expect(raw).not.toContain('EAAG_secret');
    expect(raw).not.toContain('app_secret_val');
    expect(raw).not.toContain('vt_val');
    expect(raw).toContain('[REDACTED]');
    // Non-sensitive fields still come through.
    expect(raw).toContain('abc');
  });

  it('redacts lead PII wherever it is nested', () => {
    const { logger, lines } = captureLogger();

    logger.info({ lead: { id: 'lead-1', email: 'jane@example.com', phone: '9876543210' } }, 'lead');

    const raw = JSON.stringify(lines()[0]);
    expect(raw).not.toContain('jane@example.com');
    expect(raw).not.toContain('9876543210');
    expect(raw).toContain('lead-1');
  });

  it('emits an ISO-8601 UTC timestamp with milliseconds', () => {
    const { logger, lines } = captureLogger();
    logger.info('hello');

    expect(lines()[0]!['time']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('stamps the service name and drops pid/hostname', () => {
    const { logger, lines } = captureLogger();
    logger.info('hello');

    const line = lines()[0]!;
    expect(line['service']).toBe('test-service');
    expect(line['pid']).toBeUndefined();
    expect(line['hostname']).toBeUndefined();
  });

  it('honours an explicit level over LOG_LEVEL', () => {
    const options = createLoggerOptions({ service: 's', nodeEnv: 'production', level: 'warn' });
    expect(options['level']).toBe('warn');
  });

  it('omits the pretty transport in production and includes it otherwise', () => {
    expect(createLoggerOptions({ service: 's', nodeEnv: 'production' })['transport']).toBeUndefined();
    expect(createLoggerOptions({ service: 's', nodeEnv: 'development' })['transport']).toBeDefined();
  });

  it('produces no duplicate redact paths', () => {
    expect(new Set(REDACT_PATHS).size).toBe(REDACT_PATHS.length);
  });
});

describe('hashForLog', () => {
  it('is stable and normalises case and whitespace', () => {
    expect(hashForLog(' Jane@Example.com ')).toBe(hashForLog('jane@example.com'));
    expect(hashForLog('a')).toHaveLength(12);
    expect(hashForLog('a')).not.toBe(hashForLog('b'));
  });
});

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { config } from './config/index.js';
import { v1Router } from './api/v1/index.js';
import { AppError } from './lib/errors.js';
import { closeAllPools, startCapabilityCache } from '@platform/db';

const app = Fastify({
  logger: {
    level: config.logLevel,
    ...(config.nodeEnv !== 'production'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  },
});

app.register(cookie);

app.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    const level = error.statusCode >= 500 ? 'error' : 'warn';
    app.log[level]({ err: error, path: request.url }, error.message);
    const body: Record<string, unknown> = { success: false, error: error.message };
    if (error.details !== undefined) body['details'] = error.details;
    return reply.status(error.statusCode).send(body);
  }
  if (error instanceof ZodError) {
    return reply.status(422).send({
      success: false,
      error: 'Validation failed',
      details: error.flatten().fieldErrors,
    });
  }
  app.log.error({ err: error, path: request.url }, 'Unhandled error');
  return reply.status(500).send({ success: false, error: 'Internal server error' });
});

app.register(v1Router, { prefix: '/api/v1' });

app.get('/health', async () => ({ status: 'ok', service: 'identity-service' }));

const start = async () => {
  try {
    // Tier C3: subscribe to capability-matrix changes so a role's tools/tabs can
    // be re-granted in the DB and take effect within seconds. Best-effort — a TTL
    // in the cache bounds staleness if the subscription can't be established.
    // Surface the degraded state loudly at boot: a silently-dropped LISTEN is what
    // let a revoked capability keep serving for up to the TTL window (Issue #2).
    // Credential endpoints fresh-resolve regardless, so this affects only the
    // cached gate's invalidation latency.
    const capabilityListenEstablished = await startCapabilityCache();
    if (!capabilityListenEstablished) {
      app.log.warn(
        'capability-cache LISTEN not established at boot; cached capability gates fall back to TTL-bounded staleness (credential endpoints still fresh-resolve)',
      );
    }
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

const stop = async () => {
  app.log.info('Graceful shutdown initiated');
  await app.close();
  await closeAllPools();
  process.exit(0);
};

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

start();

import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from './config/index.js';
import { v1Router } from './api/v1/index.js';
import { AppError } from './lib/errors.js';
import { closeAllPools } from '@platform/db';
import { assertInternalServiceSecret } from '@platform/service-auth';
import { createLoggerOptions } from '@platform/logger';

const app = Fastify({
  logger: createLoggerOptions({
    service: 'admin-service',
    nodeEnv: config.nodeEnv,
    level: config.logLevel,
  }),
});

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

app.get('/health', async () => ({ status: 'ok', service: 'admin-service' }));

const start = async () => {
  try {
    // Fail fast rather than accepting traffic we cannot authenticate: without
    // this secret every gateway-proxied request is rejected as unauthorized,
    // and in production a placeholder value is refused outright.
    assertInternalServiceSecret({ nodeEnv: config.nodeEnv, logPrefix: '[admin-service] ' });
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

import type { FastifyInstance } from 'fastify';
import { authRouter } from './auth/auth.router.js';
import { usersRouter } from './users/users.router.js';
import { orgsRouter } from './orgs/orgs.router.js';
import { apiClientsRouter } from './api-clients/api-clients.router.js';
import { publicReadRouter } from './public/public-read.router.js';

export async function v1Router(app: FastifyInstance): Promise<void> {
  await app.register(authRouter, { prefix: '/auth' });
  await app.register(usersRouter);
  await app.register(orgsRouter);
  await app.register(apiClientsRouter);
  await app.register(publicReadRouter);
}

import type { FastifyRequest, FastifyReply } from 'fastify';
import { sessionCookieOptions, clearedSessionCookieOptions } from '../../../lib/cookies.js';
import { config } from '../../../config/index.js';
import { UnauthorizedError } from '../../../lib/errors.js';
import * as service from './auth.service.js';
import { loginSchema, switchOrgSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from './auth.schema.js';

export class AuthController {
  login = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(request.body);
    const { token, user, licensed_products } = await service.login(body);
    return reply
      .setCookie(config.authCookieName, token, sessionCookieOptions())
      .status(200)
      // licensed_products is echoed alongside the user (not inside it): the auth
      // cookie is httpOnly, so this is the client's only way to know which
      // product to land on. Sibling field, so SessionUser stays the /auth/me shape.
      .send({ success: true, data: { user, licensed_products } });
  };

  logout = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[config.authCookieName];
    // Token revocation is best-effort: a failure to blocklist the jti must never
    // prevent the client cookie from being cleared, otherwise logout returns 500
    // and leaves a stale session cookie behind. The gateway also revokes the jti
    // at the edge, so the session still ends even if this write fails.
    try {
      await service.logout(token);
    } catch (err) {
      request.log.error({ err }, 'logout: token revocation failed; clearing cookie anyway');
    }
    return reply
      .setCookie(config.authCookieName, '', clearedSessionCookieOptions())
      .status(200)
      .send({ success: true, data: null });
  };

  me = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[config.authCookieName];
    try {
      const user = await service.getSession(token);
      return reply.status(200).send({ success: true, data: { user } });
    } catch (err) {
      if (err instanceof UnauthorizedError && err.message !== 'Not authenticated' && err.message !== 'Session expired') {
        return reply
          .setCookie(config.authCookieName, '', clearedSessionCookieOptions())
          .status(401)
          .send({ success: false, error: err.message });
      }
      throw err;
    }
  };

  myOrgs = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[config.authCookieName];
    const { orgs, can_view_all } = await service.getMyOrgs(token);
    return reply.status(200).send({ success: true, data: { orgs, can_view_all } });
  };

  switchOrg = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[config.authCookieName];
    const body = switchOrgSchema.parse(request.body);
    const { token: new_token, user } = await service.switchOrg(token, body);
    return reply
      .setCookie(config.authCookieName, new_token, sessionCookieOptions())
      .status(200)
      .send({ success: true, data: { user } });
  };

  changePassword = async (request: FastifyRequest, reply: FastifyReply) => {
    const user_id = (request.headers['x-user-id'] as string) ?? '';
    if (!user_id) throw new UnauthorizedError('Not authenticated');

    const body = changePasswordSchema.parse(request.body);
    const new_token = await service.changePassword(user_id, body.current_password, body.new_password);

    return reply
      .setCookie(config.authCookieName, new_token, sessionCookieOptions())
      .status(200)
      .send({ success: true, data: null });
  };

  // Pre-login, gateway-secret only. Always the same 200, sent BEFORE the lookup
  // runs, so neither the body nor the timing says whether the email exists.
  forgotPassword = async (request: FastifyRequest, reply: FastifyReply) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    void service.requestPasswordReset(email).catch((err: unknown) => {
      console.error('[auth] requestPasswordReset failed:', (err as Error).message);
    });
    return reply.status(200).send({ success: true, data: null });
  };

  resetPassword = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = resetPasswordSchema.parse(request.body);
    await service.resetPassword(body.token, body.new_password);
    return reply.status(200).send({ success: true, data: null });
  };
}

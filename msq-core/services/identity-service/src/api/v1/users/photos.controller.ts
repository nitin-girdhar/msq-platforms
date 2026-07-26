import type { FastifyRequest, FastifyReply } from 'fastify';
import { NotFoundError } from '../../../lib/errors.js';
import * as service from './photos.service.js';
import type { UploadPhotoInput } from './users.schema.js';

export class PhotosController {
  // POST /users/me/photo — self-service upload.
  uploadMine = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    const data = request.body as UploadPhotoInput;
    const stored = await service.uploadPhoto({ org_id, user_id, role, tenant_id }, rank, user_id, data);
    return reply.status(201).send({ success: true, data: stored });
  };

  // POST /users/:id/photo — admin changes another user's photo (Team screen).
  uploadForUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    const { id } = request.params as { id: string };
    const data = request.body as UploadPhotoInput;
    const stored = await service.uploadPhoto({ org_id, user_id, role, tenant_id }, rank, id, data);
    return reply.status(201).send({ success: true, data: stored });
  };

  // GET /users/:id/photo — authenticated, RLS-scoped image bytes with caching.
  getPhoto = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const { id } = request.params as { id: string };
    const photo = await service.getPhoto({ org_id, user_id, role, tenant_id }, id);
    if (!photo) throw new NotFoundError('No photo for this user');

    // The key embeds an immutable upload timestamp, so it is a stable, strong
    // ETag: a changed photo yields a new key and busts the cache automatically.
    const etag = `"${Buffer.from(photo.key).toString('base64url')}"`;
    if (request.headers['if-none-match'] === etag) {
      return reply.status(304).header('ETag', etag).header('Cache-Control', 'private, max-age=86400').send();
    }
    return reply
      .header('Content-Type', photo.content_type ?? 'image/jpeg')
      .header('ETag', etag)
      // Private (per-user PII) but cacheable: the URL is stable per photo, so the
      // browser reuses it across the team grid instead of refetching every load.
      .header('Cache-Control', 'private, max-age=86400')
      .send(photo.bytes);
  };
}

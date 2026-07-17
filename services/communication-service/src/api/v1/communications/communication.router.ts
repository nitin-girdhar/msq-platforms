import type { FastifyInstance } from 'fastify';
import { authenticate, requireInternalSecret } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { CommunicationController } from './communication.controller.js';
import {
  sendEmailSchema,
  sendWhatsAppTextSchema,
  sendWhatsAppTemplateSchema,
  sendCommunicationSchema,
} from './communication.schema.js';

const ctrl = new CommunicationController();

export async function communicationsRouter(app: FastifyInstance) {
  app.get('/communications/status',
    { preHandler: [authenticate] },
    ctrl.getStatus,
  );

  app.post('/communications/email',
    { preHandler: [authenticate, validate({ body: sendEmailSchema })] },
    ctrl.sendEmail,
  );

  app.post('/communications/whatsapp/text',
    { preHandler: [authenticate, validate({ body: sendWhatsAppTextSchema })] },
    ctrl.sendWhatsAppText,
  );

  app.post('/communications/whatsapp/template',
    { preHandler: [authenticate, validate({ body: sendWhatsAppTemplateSchema })] },
    ctrl.sendWhatsAppTemplate,
  );

  app.post('/communications/send',
    { preHandler: [authenticate, validate({ body: sendCommunicationSchema })] },
    ctrl.send,
  );

  // Public/partner API dispatch — gateway-authenticated (API key + scope +
  // recipient allowlist already enforced). Internal secret only here.
  app.post('/communications/public-send',
    { preHandler: [requireInternalSecret, validate({ body: sendCommunicationSchema })] },
    ctrl.publicSend,
  );
}

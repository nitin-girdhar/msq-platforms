import { describe, it, expect, vi, beforeEach } from 'vitest';

// The 404/410 pruning branch is the one most likely to be wrong and least
// likely to be noticed: it only fires when somebody deletes the app, and its
// failure mode (an endpoint that errors forever on every poller tick) is
// invisible until the table is large.

const sendNotification = vi.fn();

class FakeWebPushError extends Error {
  constructor(public statusCode: number) {
    super(`push failed with ${statusCode}`);
    this.name = 'WebPushError';
  }
}

vi.mock('web-push', () => ({
  default: { sendNotification, setVapidDetails: vi.fn() },
  WebPushError: FakeWebPushError,
}));

const findSubscriptions = vi.fn();
const deleteSubscription = vi.fn();
const touchLastUsed = vi.fn();

vi.mock('../repository.js', () => ({ findSubscriptions, deleteSubscription, touchLastUsed }));

const { sendToUser } = await import('../sender.js');

const SUB = { id: 'sub-1', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'p', auth: 'a' };
const PAYLOAD = { title: 'Follow-up due', body: 'Follow-up due for Asha', url: '/lms/dashboard/follow-ups' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env['VAPID_PUBLIC_KEY'] = 'pub';
  process.env['VAPID_PRIVATE_KEY'] = 'priv';
  process.env['VAPID_SUBJECT'] = 'mailto:ops@example.com';
  findSubscriptions.mockResolvedValue([SUB]);
  deleteSubscription.mockResolvedValue(1);
  touchLastUsed.mockResolvedValue(undefined);
});

describe('sendToUser with WEB_PUSH_ENABLED', () => {
  it('sends nothing and never touches the push service or the table when set to false', async () => {
    process.env['WEB_PUSH_ENABLED'] = 'false';
    try {
      const result = await sendToUser('user-1', 'org-1', PAYLOAD);
      expect(result).toEqual({ sent: 0, pruned: 0 });
      expect(sendNotification).not.toHaveBeenCalled();
      expect(findSubscriptions).not.toHaveBeenCalled();
    } finally {
      delete process.env['WEB_PUSH_ENABLED'];
    }
  });

  it('sends when the variable is missing, so UAT and production keep working', async () => {
    delete process.env['WEB_PUSH_ENABLED'];
    sendNotification.mockResolvedValueOnce({});
    const result = await sendToUser('user-1', 'org-1', PAYLOAD);
    expect(result.sent).toBe(1);
  });

  it('sends when set to true', async () => {
    process.env['WEB_PUSH_ENABLED'] = 'true';
    try {
      sendNotification.mockResolvedValueOnce({});
      expect((await sendToUser('user-1', 'org-1', PAYLOAD)).sent).toBe(1);
    } finally {
      delete process.env['WEB_PUSH_ENABLED'];
    }
  });
});

describe('sendToUser', () => {
  it('deletes the row and reports pruned:1 on a 410', async () => {
    sendNotification.mockRejectedValueOnce(new FakeWebPushError(410));

    const result = await sendToUser('user-1', 'org-1', PAYLOAD);

    expect(deleteSubscription).toHaveBeenCalledWith(SUB.endpoint);
    expect(result).toEqual({ sent: 0, pruned: 1 });
  });

  it('prunes on a 404 as well', async () => {
    sendNotification.mockRejectedValueOnce(new FakeWebPushError(404));

    const result = await sendToUser('user-1', 'org-1', PAYLOAD);

    expect(deleteSubscription).toHaveBeenCalledOnce();
    expect(result.pruned).toBe(1);
  });

  it('does NOT prune on a transient failure, and never throws', async () => {
    sendNotification.mockRejectedValueOnce(new FakeWebPushError(500));

    const result = await sendToUser('user-1', 'org-1', PAYLOAD);

    expect(deleteSubscription).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, pruned: 0 });
  });

  it('swallows a plain network error rather than breaking the caller loop', async () => {
    sendNotification.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(sendToUser('user-1', 'org-1', PAYLOAD)).resolves.toEqual({ sent: 0, pruned: 0 });
    expect(deleteSubscription).not.toHaveBeenCalled();
  });

  it('scopes the subscription lookup by org as well as user', async () => {
    sendNotification.mockResolvedValue(undefined);

    await sendToUser('user-1', 'org-1', PAYLOAD);

    expect(findSubscriptions).toHaveBeenCalledWith('user-1', 'org-1');
  });

  it('stamps last_used_at only for the devices that actually received it', async () => {
    findSubscriptions.mockResolvedValue([SUB, { ...SUB, id: 'sub-2', endpoint: 'https://fcm.googleapis.com/fcm/send/dead' }]);
    sendNotification
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new FakeWebPushError(410));

    const result = await sendToUser('user-1', 'org-1', PAYLOAD);

    expect(result).toEqual({ sent: 1, pruned: 1 });
    expect(touchLastUsed).toHaveBeenCalledWith(['sub-1']);
  });

  it('never POSTs to a stored endpoint outside the push services, and drops the row', async () => {
    const poisoned = { ...SUB, id: 'sub-x', endpoint: 'http://169.254.169.254/latest/meta-data/x' };
    findSubscriptions.mockResolvedValue([poisoned, SUB]);
    sendNotification.mockResolvedValue(undefined);

    const result = await sendToUser('user-1', 'org-1', PAYLOAD);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0]![0]).toMatchObject({ endpoint: SUB.endpoint });
    expect(deleteSubscription).toHaveBeenCalledWith(poisoned.endpoint);
    expect(result).toEqual({ sent: 1, pruned: 1 });
  });

  it('truncates an oversized body instead of letting the send throw', async () => {
    sendNotification.mockResolvedValue(undefined);

    await sendToUser('user-1', 'org-1', { ...PAYLOAD, body: 'x'.repeat(10_000) });

    const [, body] = sendNotification.mock.calls[0] as [unknown, string];
    expect(JSON.parse(body).body).toHaveLength(400);
  });
});

describe('tenant brand icon / badge in the payload', () => {
  const KEY = '0198f3a0-0000-7000-8000-000000000001';
  const sentBody = () => JSON.parse(String(sendNotification.mock.calls[0]![1])) as Record<string, unknown>;

  it('passes a same-origin brand asset path through', async () => {
    sendNotification.mockResolvedValue({});
    await sendToUser('u', 'o', {
      ...PAYLOAD,
      icon: `/api/public/branding/${KEY}/assets/push_icon?v=2026-10-06T00%3A00%3A00Z`,
      badge: `/api/public/branding/${KEY}/assets/push_badge`,
    });
    expect(sentBody()['icon']).toBe(`/api/public/branding/${KEY}/assets/push_icon?v=2026-10-06T00%3A00%3A00Z`);
    expect(sentBody()['badge']).toBe(`/api/public/branding/${KEY}/assets/push_badge`);
  });

  it('drops anything that is not exactly a brand asset path', async () => {
    sendNotification.mockResolvedValue({});
    await sendToUser('u', 'o', {
      ...PAYLOAD,
      icon: 'https://evil.example/x.png',
      badge: `/api/public/branding/${KEY}/assets/logo`,
    });
    expect(sentBody()).not.toHaveProperty('icon');
    expect(sentBody()).not.toHaveProperty('badge');
  });
});

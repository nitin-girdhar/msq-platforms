import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint } from '../endpoint-policy.js';

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://fcm.googleapis.com:443/fcm/send/abc',
  ])('accepts a real push-service endpoint: %s', (u) => {
    expect(isAllowedPushEndpoint(u)).toBe(true);
  });

  it.each([
    ['cloud metadata over http', 'http://169.254.169.254/latest/meta-data/x'],
    ['cloud metadata over https', 'https://169.254.169.254/latest/meta-data/x'],
    ['loopback', 'https://localhost:4000/internal'],
    ['loopback ip', 'https://127.0.0.1/x'],
    ['internal service name', 'https://hr-service:4007/api/v1/x'],
    ['plain http on an allowed host', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['credentials in the url', 'https://user:pw@fcm.googleapis.com/x'],
    ['custom port', 'https://fcm.googleapis.com:8443/x'],
    ['look-alike suffix', 'https://evilfcm.googleapis.com.attacker.example/x'],
    ['look-alike prefix', 'https://notfcm.googleapis.com/x'],
    ['not a url', 'not-a-url'],
    ['other scheme', 'file:///etc/passwd'],
  ])('rejects %s', (_label, u) => {
    expect(isAllowedPushEndpoint(u)).toBe(false);
  });
});

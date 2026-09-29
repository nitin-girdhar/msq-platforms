# Web Push Notifications & Progressive Web App (PWA)

The platform can be installed as a Progressive Web App on your device, letting you receive push notifications for follow-ups even when the browser is closed.

## What is a PWA?

A PWA is a website you install on your home screen (like an app) but without downloading it from an app store. It works offline for some features, loads faster on return visits, and can send you push notifications.

## Installation

### iPhone (Safari)

1. Open `https://apps.fitclass.in` in **Safari** (not Chrome).
2. Tap the **Share** button (bottom center or top right, depending on iOS version).
3. Scroll down and tap **"Add to Home Screen"**.
4. Choose a name (the default is fine) and tap **"Add"**.
5. The app icon now appears on your home screen. **Open it from that icon** to use the app.
   - Opening from Safari (a tab) will NOT receive notifications.
   - Only the home-screen icon enables push.

**Why Safari, not Chrome?** On iOS, only Safari can register a PWA for push notifications. Chrome on iOS cannot do it.

### Android (Chrome)

1. Open `https://apps.fitclass.in` in Chrome.
2. When you first visit, an **"Install"** prompt may appear at the bottom. Tap it.
3. If the prompt doesn't appear, open Chrome's menu (three dots) → **"Install app"**.
4. Confirm the installation. The app now opens in standalone mode (no browser address bar) and can receive notifications in the background.

## Enabling push notifications

Once installed, the app will ask for notification permission. Grant it so you receive alerts for due follow-ups.

If you deny permission by mistake:
- **iPhone:** Settings → The app's name → Notifications → toggle on.
- **Android:** Open the app, go to Settings, or use your phone's notification settings to re-enable it.

## Important limitations

### iPhone

- **You must install from Safari and launch from the home-screen icon.** No icon = no notifications, even if you granted permission in a Safari tab.
- **Deleting the home-screen icon stops notifications** until you re-install and re-grant permission.
- **iOS delivery is best-effort and can be delayed** by the system, especially if the device has low battery or you haven't used the app recently. The follow-ups grid in the app remains the authoritative source of truth — push is an **added convenience, not a guarantee**. Critical actions should not rely on push notification timing.

### Android

- Notifications work in the background without installing (install is optional but recommended for a faster, cleaner experience).
- If you uninstall the app or revoke notification permission, you'll stop receiving pushes until you reinstall and re-grant.

### Both platforms

- **Re-installs and deploys:** if the app is deployed while you have it open, you may miss some notifications until you restart the app.
- **Permission revocation:** revoking notification permission in your phone's settings deletes the device's subscription. You must re-grant to re-subscribe.

## What happens when you delete the icon or uninstall?

- **Notifications stop immediately** — the device's subscription is deleted from the server.
- **Re-installing re-subscribes automatically** on your next app launch (you won't see a permission prompt if you already granted it before).

## Troubleshooting

**I granted permission but I'm not receiving notifications.**

- **iPhone:** Confirm you opened the app from the home-screen icon, not from a Safari tab. The app URL should show no browser chrome (no address bar). Safari tabs cannot receive push.
- **Both:** Check your phone's notification settings for the app — permission may be revoked there. Re-grant it.
- **Both:** Try force-quitting and reopening the app. A stale or interrupted subscription sometimes re-syncs on restart.
- **Deployment timing:** if a new version just deployed, the old service worker may still be running. Hard-refresh the page (or clear Safari's cache) and restart the app.

**The notification arrived late.**

This is expected, especially on iOS. Apple's system can throttle notification delivery for battery or engagement reasons. **Check the app itself** — the follow-ups grid is always current and is not affected by notification delays.

**I deleted the icon and want to re-subscribe.**

Simply re-install: Safari (iPhone) → Share → Add to Home Screen, or Chrome (Android) → Install app. Launch it once, grant permission when asked, and you'll be re-subscribed automatically.

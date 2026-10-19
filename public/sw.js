// Appens servicearbetare: tar bara emot notiser (Web Push) och öppnar rätt sak vid tryck.
// Den sparar ingenting i cache, så appen laddas alltid från servern som vanligt.
// Servern skickar { title, body, tag, open } (se server/push.ts).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'KSK-appen';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: '/icon-192x192.png',
    badge: '/icon-96x96.png',
    lang: 'sv',
    data: { open: data.open || { view: 'home' } },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const open = (event.notification.data && event.notification.data.open) || { view: 'home' };
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const own = wins.filter((c) => new URL(c.url).origin === self.location.origin);
    const win = own.find((c) => c.focused) || own[0];
    if (win) {
      win.postMessage({ type: 'coachassist-open', open });
      try { await win.focus(); } catch (_) { /* vissa webbläsare tillåter inte focus */ }
      return;
    }
    await self.clients.openWindow('/?open=' + encodeURIComponent(JSON.stringify(open)));
  })());
});

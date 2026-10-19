// Notiser (Web Push) för chatt och inlägg. Servern: server/push.ts. Servicearbetaren: public/sw.js.
//
// Notiser gäller en enhet i taget (telefonen, iPaden, datorn). På iPhone/iPad fungerar de bara när
// appen är tillagd på hemskärmen (iOS 16.4 eller senare) och öppnad därifrån.
import { getApiUrl, getAuthHeader } from './firebase';

export type PushOpen =
  | { view: 'chat'; clubId: string; conversationId: string }
  | { view: 'post'; clubId: string; teamId: string; postId: string }
  | { view: 'home' };

export type PushSupport = 'ok' | 'ios-install' | 'unsupported';

export interface PushPrefs { chat: boolean; posts: boolean }
export interface PushStatus extends PushPrefs { support: PushSupport; permission: NotificationPermission | 'unsupported'; subscribed: boolean }

// Vilket konto som slog på notiser på den här enheten (och vilka val), så att appen kan förnya
// prenumerationen om webbläsaren byter adress – men inte slå på notiser åt ett annat konto.
const OWNER_KEY = 'coachassist.push';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export function pushSupport(): PushSupport {
  const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  if (isIos() && !isStandalone()) return 'ios-install';
  return ok ? 'ok' : 'unsupported';
}

const call = async (path: string, body?: any) => {
  const res = await fetch(getApiUrl(path), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...getAuthHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).catch(() => { throw new Error('Kunde inte nå servern. Kontrollera anslutningen och försök igen.'); });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.error || `Något gick fel (${res.status})`);
  return json;
};

let registration: Promise<ServiceWorkerRegistration | null> | null = null;
/** Registrerar servicearbetaren (en gång). */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!registration) {
    registration = 'serviceWorker' in navigator && window.isSecureContext
      ? navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).catch((e) => { console.warn('[Notiser] Servicearbetaren:', e); return null; })
      : Promise.resolve(null);
  }
  return registration;
}

const currentSubscription = async () => (await registerServiceWorker())?.pushManager.getSubscription() ?? null;

const readOwner = (): { userId: string; chat: boolean; posts: boolean } | null => {
  try { return JSON.parse(localStorage.getItem(OWNER_KEY) || 'null'); } catch { return null; }
};
const writeOwner = (v: { userId: string; chat: boolean; posts: boolean } | null) => {
  try { if (v) localStorage.setItem(OWNER_KEY, JSON.stringify(v)); else localStorage.removeItem(OWNER_KEY); } catch { /* privat läge */ }
};

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function getPushStatus(): Promise<PushStatus> {
  const support = pushSupport();
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  const base = { support, permission, subscribed: false, chat: true, posts: true } as PushStatus;
  if (support !== 'ok') return base;
  const sub = await currentSubscription();
  if (!sub) return base;
  const r = await call('/api/push/status', { endpoint: sub.endpoint });
  return { ...base, subscribed: !!r.subscribed, chat: r.chat !== false, posts: r.posts !== false };
}

/** Slår på notiser på den här enheten (frågar om lov första gången). Måste anropas från ett tryck. */
export async function enablePush(userId: string, prefs: PushPrefs): Promise<PushStatus> {
  if (pushSupport() !== 'ok') throw new Error('Notiser fungerar inte här.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notiser är blockerade för appen. Tillåt dem i enhetens inställningar och försök igen.'
      : 'Du behöver tillåta notiser för att få dem.');
  }
  const reg = await registerServiceWorker();
  if (!reg) throw new Error('Appen kunde inte starta notiserna i den här webbläsaren.');
  const { publicKey } = await call('/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  // En prenumeration med en annan servernyckel (t.ex. efter byte av nycklar) måste göras om.
  const key = sub?.options?.applicationServerKey;
  if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  const r = await call('/api/push/subscribe', { subscription: sub.toJSON(), ...prefs });
  writeOwner({ userId, ...prefs });
  return { support: 'ok', permission, subscribed: !!r.subscribed, chat: r.chat !== false, posts: r.posts !== false };
}

export async function updatePushPrefs(userId: string, prefs: PushPrefs): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Notiser är inte påslagna på den här enheten.');
  await call('/api/push/subscribe', { subscription: sub.toJSON(), ...prefs });
  writeOwner({ userId, ...prefs });
}

/** Stänger av notiser på den här enheten (även vid utloggning). */
export async function disablePush(): Promise<void> {
  writeOwner(null);
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await call('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function sendTestPush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Notiser är inte påslagna på den här enheten.');
  await call('/api/push/test', { endpoint: sub.endpoint });
}

/**
 * Vid start: registrera servicearbetaren och se till att servern har enhetens aktuella adress
 * (webbläsaren kan byta den). Gör bara något om samma konto har slagit på notiser här.
 */
export async function syncPush(userId: string): Promise<void> {
  if (pushSupport() !== 'ok') return;
  await registerServiceWorker();
  const owner = readOwner();
  if (!owner || owner.userId !== userId || Notification.permission !== 'granted') return;
  try {
    const sub = await currentSubscription();
    if (!sub) { await enablePush(userId, { chat: owner.chat, posts: owner.posts }); return; }
    const r = await call('/api/push/status', { endpoint: sub.endpoint });
    if (!r.subscribed) await call('/api/push/subscribe', { subscription: sub.toJSON(), chat: owner.chat, posts: owner.posts });
  } catch (e) {
    console.warn('[Notiser] Kunde inte förnya:', e);
  }
}

/** Lyssnar på tryck på notiser (från servicearbetaren) och på ?open= i adressen vid start. */
export function listenForPushOpen(handler: (open: PushOpen) => void): () => void {
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get('open');
    if (raw) {
      url.searchParams.delete('open');
      window.history.replaceState({}, '', url.toString());
      const open = JSON.parse(raw);
      if (open && typeof open.view === 'string') setTimeout(() => handler(open), 0);
    }
  } catch { /* trasig adress */ }
  if (!('serviceWorker' in navigator)) return () => {};
  const onMessage = (e: MessageEvent) => {
    if (e.data?.type === 'coachassist-open' && e.data.open) handler(e.data.open);
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}

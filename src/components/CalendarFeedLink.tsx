// Lagets prenumerationslänk (iCal) med hemlig nyckel. Hämtas från /api/calendar-feed
// (se server/calendarFeed.ts). Alla i laget ser länken; bara tränare kan skapa en ny.
import React, { useEffect, useState } from 'react';
import { Calendar, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { getApiUrl, getAuthHeader } from '../lib/firebase';
import { Button } from './ui';

interface FeedInfo { path: string; canRotate: boolean }

const call = async (method: string, path: string, body?: any): Promise<FeedInfo> => {
  const res = await fetch(getApiUrl(path), {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...getAuthHeader() },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => { throw new Error('Kunde inte nå servern.'); });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.path) throw new Error(json?.error || `Kunde inte hämta länken (${res.status}).`);
  return json;
};

export const CalendarFeedLink: React.FC<{
  clubId?: string | null; teamId?: string | null; title?: string; subtitle?: string;
  showAddButtons?: boolean; // knappar som lägger till kalendern direkt (Apple/Google)
}> = ({
  clubId, teamId, title = 'Lagets prenumerationslänk (iCal)', subtitle, showAddButtons,
}) => {
  const [info, setInfo] = useState<FeedInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotated, setRotated] = useState(false);

  useEffect(() => {
    setInfo(null); setError(null); setConfirmRotate(false); setRotated(false);
    if (!clubId || !teamId) return;
    let cancelled = false;
    call('GET', `/api/calendar-feed?clubId=${encodeURIComponent(clubId)}&teamId=${encodeURIComponent(teamId)}`)
      .then((r) => { if (!cancelled) setInfo(r); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [clubId, teamId]);

  const url = info ? new URL(getApiUrl(info.path), window.location.origin).href : '';
  // webcal: öppnar Kalender-appen på iPhone/iPad/Mac (och Outlook på Windows) direkt
  const webcalUrl = url.replace(/^https?:/, 'webcal:');
  const googleUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`;

  const copy = () => {
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rotate = async () => {
    if (!clubId || !teamId) return;
    setBusy(true); setError(null);
    try {
      setInfo(await call('POST', '/api/calendar-feed/rotate', { clubId, teamId }));
      setRotated(true);
      setConfirmRotate(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 sm:p-4 bg-indigo-50/70 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
      <div className="flex items-center gap-1.5 mb-1 min-w-0">
        <Calendar size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
        <span className="text-sm font-semibold text-indigo-800 dark:text-indigo-200 truncate">{title}</span>
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">
        {subtitle || 'Lägg in länken i mobilens, Googles eller Apples kalender för att få lagets träningar och matcher automatiskt. Dela den bara med laget.'}
      </p>

      {!clubId || !teamId ? (
        <p className="text-xs text-zinc-500">Välj ett lag först.</p>
      ) : error ? (
        <p className="text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>
      ) : !info ? (
        <p className="text-xs text-zinc-500">Hämtar länken…</p>
      ) : (
        <>
          <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 pl-3 pr-1 py-1 rounded-xl border border-indigo-100 dark:border-indigo-900/30 min-w-0">
            <span className="text-xs font-mono text-zinc-800 dark:text-zinc-200 truncate select-all min-w-0 flex-1">{url}</span>
            <Button size="sm" onClick={copy} icon={copied ? <Check size={14} /> : <Copy size={14} />}>
              {copied ? 'Kopierad' : 'Kopiera'}
            </Button>
          </div>

          {showAddButtons && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              <a
                href={webcalUrl}
                className="h-11 px-4 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold bg-white text-zinc-800 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
              >
                <Calendar size={16} /> iPhone, iPad, Mac
              </a>
              <a
                href={googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-11 px-4 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold bg-white text-zinc-800 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
              >
                <ExternalLink size={16} /> Google Kalender
              </a>
            </div>
          )}

          {rotated && (
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mt-2">
              ✓ Ny länk skapad. Den gamla fungerar inte längre – dela den nya med laget.
            </p>
          )}

          {info.canRotate && (
            <div className="mt-2">
              {!confirmRotate ? (
                <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => setConfirmRotate(true)}>
                  Skapa ny länk
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-zinc-700 dark:text-zinc-300">
                    Den nuvarande länken slutar fungera för alla som prenumererar. Fortsätta?
                  </span>
                  <Button size="sm" variant="danger" disabled={busy} onClick={rotate}>Skapa ny länk</Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmRotate(false)}>Avbryt</Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Arket "Notiser": slå på/av notiser för chatt, inlägg och kallelser på den här enheten.
 * Överst väljer en ledare (rollen Ledare) vilka kallelser hen vill ha – det gäller personen, inte enheten.
 * Logiken ligger i src/lib/push.ts.
 */
import React, { useEffect, useState } from 'react';
import { Bell, BellOff, CalendarCheck, Check, MessageCircle, Megaphone, Send, Share, SquarePlus } from 'lucide-react';
import { Button, Sheet } from './ui';
import { disablePush, enablePush, getPushStatus, PushStatus, saveLeaderRsvpTypes, sendTestPush, updatePushPrefs } from '../lib/push';
import type { RsvpKind } from '../types';

export type LeaderRsvp = { clubId: string; teamId: string; types: RsvpKind[] };

const KINDS: [RsvpKind, string][] = [['training', 'Träning'], ['match', 'Match'], ['other', 'Övrigt']];

// Ledarens val av kallelser. Sparas direkt vid varje tryck.
const LeaderRsvpCard: React.FC<{ leader: LeaderRsvp; onChanged: (types: RsvpKind[]) => void }> = ({ leader, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (k: RsvpKind) => {
    const next = leader.types.includes(k) ? leader.types.filter(x => x !== k) : [...leader.types, k];
    setBusy(true);
    setError(null);
    try { onChanged(await saveLeaderRsvpTypes(leader.clubId, leader.teamId, next)); } catch (e: any) { setError(e?.message || 'Kunde inte spara.'); }
    setBusy(false);
  };
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-2.5">
      <div>
        <p className="font-semibold text-zinc-800 dark:text-zinc-100">Kallelser som ledare</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Välj vilka aktiviteter du vill bli kallad till och svara på. Gäller dig, på alla enheter.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {KINDS.map(([k, label]) => {
          const on = leader.types.includes(k);
          return (
            <button key={k} type="button" aria-pressed={on} disabled={busy} onClick={() => toggle(k)}
              className={`min-h-[40px] px-3.5 rounded-xl border text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-all disabled:opacity-60 ${
                on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}>
              {on && <Check size={14} strokeWidth={3} />}{label}
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};

const Toggle: React.FC<{ icon: React.ReactNode; label: string; description: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({
  icon, label, description, checked, disabled, onChange,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-default"
  >
    <span className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center justify-center shrink-0">{icon}</span>
    <span className="flex-1 min-w-0">
      <span className="block font-semibold text-zinc-800 dark:text-zinc-100">{label}</span>
      <span className="block text-sm text-zinc-500 dark:text-zinc-400">{description}</span>
    </span>
    <span className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${checked ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
      <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </span>
  </button>
);

export const NotificationsSheet: React.FC<{
  open: boolean; onClose: () => void; userId: string | null;
  leaderRsvp?: LeaderRsvp | null; onLeaderRsvpChanged?: (types: RsvpKind[]) => void;
}> = ({ open, onClose, userId, leaderRsvp, onLeaderRsvpChanged }) => {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    getPushStatus().then(setStatus).catch((e) => {
      setStatus(null);
      setMessage({ tone: 'error', text: e?.message || 'Kunde inte läsa notisinställningarna.' });
    });
  }, [open]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try { await fn(); } catch (e: any) { setMessage({ tone: 'error', text: e?.message || 'Något gick fel.' }); }
    setBusy(false);
  };

  const enable = () => run(async () => {
    if (!userId) return;
    setStatus(await enablePush(userId, { chat: status?.chat ?? true, posts: status?.posts ?? true, sessions: status?.sessions ?? true }));
    setMessage({ tone: 'ok', text: 'Notiserna är påslagna på den här enheten.' });
  });
  const setPref = (key: 'chat' | 'posts' | 'sessions', v: boolean) => run(async () => {
    if (!userId || !status) return;
    const next = { chat: status.chat, posts: status.posts, sessions: status.sessions, [key]: v };
    await updatePushPrefs(userId, next);
    setStatus({ ...status, ...next });
  });
  const disable = () => run(async () => {
    await disablePush();
    setStatus(await getPushStatus());
    setMessage({ tone: 'ok', text: 'Notiserna är avstängda på den här enheten.' });
  });
  const test = () => run(async () => {
    await sendTestPush();
    setMessage({ tone: 'ok', text: 'En testnotis är skickad. Den kan dröja några sekunder.' });
  });

  const s = status;
  return (
    <Sheet open={open} onClose={onClose} title="Notiser">
      <div className="px-3 pb-2 flex flex-col gap-3">
        {leaderRsvp && onLeaderRsvpChanged && <LeaderRsvpCard leader={leaderRsvp} onChanged={onLeaderRsvpChanged} />}
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Få en notis när någon skriver i chatten, när tränaren lägger upp ett nytt inlägg eller när det finns nya pass att svara på. Valet gäller bara
          den här enheten – slå på det på varje telefon, iPad eller dator där du vill ha notiser.
        </p>

        {!s && !message && <p className="text-sm text-zinc-500">Läser in …</p>}

        {s?.support === 'ios-install' && (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-900 dark:text-amber-100 flex flex-col gap-2">
            <p className="font-semibold">Lägg till appen på hemskärmen först</p>
            <p>På iPhone och iPad fungerar notiser bara när appen öppnas från hemskärmen (iOS 16.4 eller senare):</p>
            <ol className="list-decimal pl-5 flex flex-col gap-1">
              <li className="flex-wrap">Tryck på <Share size={14} className="inline -mt-0.5" /> Dela i Safari.</li>
              <li>Välj <SquarePlus size={14} className="inline -mt-0.5" /> Lägg till på hemskärmen.</li>
              <li>Öppna appen från hemskärmen och kom tillbaka hit.</li>
            </ol>
          </div>
        )}

        {s?.support === 'unsupported' && (
          <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800 p-4 text-sm text-zinc-700 dark:text-zinc-200">
            Den här webbläsaren kan inte visa notiser från appen. Prova Safari, Chrome, Edge eller Firefox i senaste versionen.
          </div>
        )}

        {s?.support === 'ok' && s.permission === 'denied' && (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-900 dark:text-amber-100">
            Notiser är blockerade för appen. Tillåt dem i enhetens inställningar (iPhone: Inställningar → Notiser → appen;
            dator: hänglåset bredvid adressen) och öppna sedan det här igen.
          </div>
        )}

        {s?.support === 'ok' && s.permission !== 'denied' && !s.subscribed && (
          <Button size="lg" block icon={<Bell size={18} />} onClick={enable} disabled={busy || !userId}>
            Slå på notiser
          </Button>
        )}

        {s?.subscribed && (
          <>
            <div className="flex flex-col gap-0.5 -mx-3">
              <Toggle icon={<MessageCircle size={18} />} label="Chatt" description="Nya meddelanden i dina chattar" checked={s.chat} disabled={busy} onChange={(v) => setPref('chat', v)} />
              <Toggle icon={<Megaphone size={18} />} label="Inlägg" description="Nya inlägg från tränarna" checked={s.posts} disabled={busy} onChange={(v) => setPref('posts', v)} />
              <Toggle icon={<CalendarCheck size={18} />} label="Kallelser" description="Nya pass och kallelser att svara på" checked={s.sessions} disabled={busy} onChange={(v) => setPref('sessions', v)} />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="secondary" block icon={<Send size={16} />} onClick={test} disabled={busy}>Skicka testnotis</Button>
              <Button variant="ghost" block icon={<BellOff size={16} />} onClick={disable} disabled={busy}>Stäng av här</Button>
            </div>
          </>
        )}

        {message && (
          <p className={`text-sm font-semibold ${message.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{message.text}</p>
        )}
      </div>
    </Sheet>
  );
};

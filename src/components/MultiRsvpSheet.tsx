/**
 * Svara på flera pass – ett ark där man bockar för kommande aktiviteter och ger
 * samma svar (Kommer/Delvis/Kan inte) och samma kommentar på alla på en gång.
 * Spelare svarar för sig själva. Tränare svarar för sig själva eller väljer en
 * person i laget (samma rätt som i passvyn). Sparas med POST /api/rsvp/batch.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Check, X, HelpCircle, CalendarRange, CheckCircle2, Trash2 } from 'lucide-react';
import { RsvpStatus, SquadPlayer, TrainingSession, PlayerRsvp } from '../types';
import { saveRsvpBatch } from '../lib/firebase';
import { isMatchSession } from '../utils/sessionCategory';
import { Button, Sheet, TextInput } from './ui';

interface MultiRsvpSheetProps {
  open: boolean;
  onClose: () => void;
  sessions: TrainingSession[];
  squad: SquadPlayer[];
  isCoach: boolean;
  clubId?: string | null;
  teamId?: string | null;
  onUpdateSession: (session: TrainingSession) => void;
}

const sessionStart = (s: TrainingSession) => {
  const d = new Date(s.date);
  const [h, m] = (s.startTime || '00:00').split(':').map(Number);
  if (!isNaN(h)) d.setHours(h, isNaN(m) ? 0 : m, 0, 0);
  return d.getTime();
};

const sessionEnd = (s: TrainingSession) => {
  if (s.endTime) {
    const d = new Date(s.date);
    const [h, m] = s.endTime.split(':').map(Number);
    if (!isNaN(h)) {
      d.setHours(h, isNaN(m) ? 0 : m, 0, 0);
      return d.getTime();
    }
  }
  return sessionStart(s) + 2 * 60 * 60 * 1000;
};

// "2026-10-21" för datumrutorna (lokal tid)
const toDateInput = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayKey = (ts: number) => toDateInput(ts);

const STATUS: { id: RsvpStatus; label: string; icon: React.ReactNode; on: string; badge: string }[] = [
  { id: 'attending', label: 'Kommer', icon: <Check size={18} strokeWidth={2.6} />, on: 'bg-emerald-600 text-white border-emerald-600', badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  { id: 'partial', label: 'Delvis', icon: <HelpCircle size={18} />, on: 'bg-amber-500 text-white border-amber-500', badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  { id: 'declined', label: 'Kan inte', icon: <X size={18} strokeWidth={2.6} />, on: 'bg-red-600 text-white border-red-600', badge: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300' },
];

const chipClass = 'h-10 px-3 rounded-full border text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap';
const chipOff = 'border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800';
const chipOn = 'border-indigo-600 bg-indigo-600 text-white';

export default function MultiRsvpSheet({ open, onClose, sessions, squad, isCoach, clubId, teamId, onUpdateSession }: MultiRsvpSheetProps) {
  // Den inloggades egen rad (spelarraden går före ledarraden), som i passvyn.
  const me = useMemo(() => {
    const mine = squad.filter(p => p.isMe);
    return mine.find(p => p.role !== 'leader') || mine[0] || null;
  }, [squad]);

  // Tränare kan välja vem svaret gäller: sig själv eller någon i laget.
  const people = useMemo(() => {
    const others = squad
      .filter(p => p.id && !p.isMe && !p.id.startsWith('guest_'))
      .sort((a, b) => (a.role === 'leader' ? 1 : 0) - (b.role === 'leader' ? 1 : 0) || a.name.localeCompare(b.name, 'sv'));
    return others;
  }, [squad]);

  const [personId, setPersonId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<RsvpStatus | null>(null);
  const [comment, setComment] = useState('');
  const [showRange, setShowRange] = useState(false);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ count: number; label: string } | null>(null);

  const targetId = personId || me?.id || null;
  const target = targetId ? squad.find(p => p.id === targetId) || null : null;
  const forSelf = !!me && targetId === me.id;

  const upcoming = useMemo(() => {
    const now = Date.now();
    return sessions
      .filter(s => !s.isIgnored && sessionEnd(s) >= now)
      .sort((a, b) => sessionStart(a) - sessionStart(b));
  }, [sessions]);

  const answerOf = (s: TrainingSession): PlayerRsvp | undefined => (targetId ? s.rsvps?.[targetId] : undefined);
  const unanswered = useMemo(() => upcoming.filter(s => !answerOf(s)), [upcoming, targetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Varje gång arket öppnas (eller personen byts) börjar man med alla obesvarade valda.
  const reset = (pid: string | null) => {
    const tid = pid || me?.id || null;
    setSelected(new Set(upcoming.filter(s => !(tid && s.rsvps?.[tid])).map(s => s.id)));
    setStatus(null);
    setError(null);
    setDone(null);
  };
  useEffect(() => {
    if (!open) return;
    setPersonId(null);
    setComment('');
    setShowRange(false);
    setRangeFrom(upcoming[0] ? toDateInput(upcoming[0].date) : toDateInput(Date.now()));
    setRangeTo(upcoming[0] ? toDateInput(upcoming[0].date + 7 * 24 * 60 * 60 * 1000) : toDateInput(Date.now()));
    reset(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const selectRange = () => {
    if (!rangeFrom || !rangeTo) return;
    const [a, b] = rangeFrom <= rangeTo ? [rangeFrom, rangeTo] : [rangeTo, rangeFrom];
    setSelected(new Set(upcoming.filter(s => { const k = dayKey(s.date); return k >= a && k <= b; }).map(s => s.id)));
  };

  const selectedSessions = upcoming.filter(s => selected.has(s.id));
  const replacesComment = selectedSessions.some(s => {
    const c = answerOf(s)?.comment || '';
    return c && c !== comment.trim();
  });
  const allSelected = upcoming.length > 0 && selected.size === upcoming.length;
  const onlyUnanswered = unanswered.length > 0 && selected.size === unanswered.length && unanswered.every(s => selected.has(s.id));

  const save = async (finalStatus: RsvpStatus | null) => {
    if (!targetId || !clubId || !teamId || selectedSessions.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await saveRsvpBatch({
        clubId, teamId, memberId: targetId, sessionIds: selectedSessions.map(s => s.id),
        status: finalStatus, ...(finalStatus ? { comment: comment.trim() } : {}),
      });
      for (const s of selectedSessions) {
        const r = res.rsvps[s.id];
        const rsvps = { ...(s.rsvps || {}) };
        let attendance = (s.attendance || []).filter(id => id !== targetId);
        if (r) {
          rsvps[targetId] = { status: r.status as RsvpStatus, comment: r.comment, updatedAt: r.updatedAt, updatedBy: r.updatedBy };
          if (r.status !== 'declined') attendance = [...attendance, targetId];
        } else {
          delete rsvps[targetId];
        }
        onUpdateSession({ ...s, rsvps, attendance, updatedAt: Date.now() });
      }
      const label = finalStatus ? STATUS.find(x => x.id === finalStatus)!.label : 'Svaren togs bort';
      setDone({ count: selectedSessions.length, label });
    } catch (err: any) {
      setError(err?.message || 'Svaren kunde inte sparas. Försök igen.');
    } finally {
      setSaving(false);
    }
  };

  const n = selectedSessions.length;

  // Rubriker per månad i listan
  let lastMonth = '';

  const footer = done ? (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200">
        <CheckCircle2 size={20} className="shrink-0" />
        <span className="text-sm font-semibold">
          {done.label === 'Svaren togs bort'
            ? `Svaren togs bort på ${done.count} pass.`
            : `Klart! ${done.label} på ${done.count} pass${forSelf ? '' : ` för ${target?.name}`}.`}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => reset(personId)}>Svara på fler</Button>
        <Button onClick={onClose}>Stäng</Button>
      </div>
    </div>
  ) : (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Svar">
        {STATUS.map(o => (
          <button
            key={o.id}
            type="button"
            onClick={() => setStatus(prev => (prev === o.id ? null : o.id))}
            aria-pressed={status === o.id}
            className={`h-12 rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] cursor-pointer ${
              status === o.id ? o.on : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-750'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
      <div>
        <label htmlFor="multi-rsvp-comment" className="sr-only">Kommentar till tränaren</label>
        <TextInput
          id="multi-rsvp-comment"
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          placeholder="Kommentar, t.ex. Skadad eller Jobbar"
          className="w-full h-11 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-base sm:text-sm outline-none focus:ring-2 focus:ring-indigo-500/50"
        />
        {replacesComment && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Kommentaren ersätter den som redan finns på de valda passen.</p>
        )}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      <Button block size="lg" disabled={!status || n === 0 || saving || !targetId} onClick={() => save(status)}>
        {saving ? 'Sparar…' : n === 0 ? 'Välj pass i listan' : !status ? `Välj svar för ${n} pass` : `Spara ${STATUS.find(x => x.id === status)!.label.toLowerCase()} på ${n} pass`}
      </Button>
      {n > 0 && selectedSessions.some(s => answerOf(s)) && (
        <button
          type="button"
          disabled={saving}
          onClick={() => save(null)}
          className="w-full h-10 text-sm font-semibold text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <Trash2 size={15} />
          Ta bort {forSelf ? 'dina' : 'svaren'} på valda pass
        </button>
      )}
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Svara på flera pass" footer={footer}>
      <div className="px-2 space-y-3">
        {/* Vem svaret gäller */}
        {isCoach ? (
          <div>
            <label htmlFor="multi-rsvp-person" className="block text-sm font-semibold text-zinc-600 dark:text-zinc-300 mb-1">Svaret gäller</label>
            <select
              id="multi-rsvp-person"
              value={targetId || ''}
              onChange={(e) => { const v = e.target.value || null; setPersonId(v); reset(v); }}
              className="w-full h-11 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-base sm:text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer"
            >
              {me && <option value={me.id}>Mig själv ({me.name})</option>}
              {!me && <option value="">Välj person</option>}
              {people.map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.role === 'leader' ? ' (ledare)' : ''}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {forSelf ? 'Du svarar för dig själv. Välj en spelare för att svara åt hen.' : `Du svarar åt ${target?.name || 'personen'}. Svaret märks "Tränare".`}
            </p>
          </div>
        ) : !me ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 px-1">Ditt konto är inte kopplat till någon i truppen, så du kan inte svara på kallelser.</p>
        ) : null}

        {/* Snabbval */}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${chipClass} ${onlyUnanswered ? chipOn : chipOff}`} disabled={unanswered.length === 0} onClick={() => setSelected(new Set(unanswered.map(s => s.id)))}>
            Obesvarade ({unanswered.length})
          </button>
          <button type="button" className={`${chipClass} ${allSelected ? chipOn : chipOff}`} onClick={() => setSelected(new Set(upcoming.map(s => s.id)))}>
            Alla ({upcoming.length})
          </button>
          <button type="button" className={`${chipClass} ${showRange ? chipOn : chipOff}`} aria-expanded={showRange} onClick={() => setShowRange(v => !v)}>
            <CalendarRange size={16} />
            Datum
          </button>
          {selected.size > 0 && (
            <button type="button" className={`${chipClass} ${chipOff}`} onClick={() => setSelected(new Set())}>Avmarkera</button>
          )}
        </div>

        {showRange && (
          <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                Från
                <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="mt-1 w-full h-11 px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-base sm:text-sm font-medium" />
              </label>
              <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                Till och med
                <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="mt-1 w-full h-11 px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-base sm:text-sm font-medium" />
              </label>
            </div>
            <Button block variant="secondary" onClick={selectRange}>Välj passen mellan datumen</Button>
          </div>
        )}

        {/* Listan */}
        {upcoming.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 px-1 py-6 text-center">Det finns inga kommande pass.</p>
        ) : (
          <ul className="space-y-1" aria-label="Kommande pass">
            {upcoming.map(s => {
              const d = new Date(s.date);
              const month = d.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
              const header = month !== lastMonth ? month : null;
              lastMonth = month;
              const a = answerOf(s);
              const st = a ? STATUS.find(x => x.id === a.status) : null;
              const checked = selected.has(s.id);
              const deadlinePassed = !!s.rsvpConfig?.deadline && s.rsvpConfig.deadline < Date.now();
              const weekday = d.toLocaleDateString('sv-SE', { weekday: 'short' }).replace('.', '');
              return (
                <React.Fragment key={s.id}>
                  {header && <li className="pt-2 pb-1 px-1 text-xs font-bold text-zinc-500 dark:text-zinc-400 first-letter:uppercase" aria-hidden="true">{header}</li>}
                  <li>
                    <label className={`flex items-center gap-3 p-2.5 rounded-2xl cursor-pointer transition-colors ${checked ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(s.id)}
                        aria-label={`${weekday} ${d.getDate()} ${d.toLocaleDateString('sv-SE', { month: 'short' })} ${s.startTime || ''} ${s.title || ''}`.trim()}
                        className="w-5 h-5 rounded accent-indigo-600 shrink-0 cursor-pointer"
                      />
                      <span className="w-11 shrink-0 text-center leading-tight">
                        <span className="block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 first-letter:uppercase">{weekday}</span>
                        <span className="block text-lg font-bold">{d.getDate()}</span>
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold truncate">{s.title || (isMatchSession(s) ? 'Match' : 'Träning')}</span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">
                          {s.startTime}{s.endTime ? `–${s.endTime}` : ''}{isMatchSession(s) ? ' · Match' : ''}{s.location ? ` · ${s.location}` : ''}
                        </span>
                        {a?.comment && <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate italic">"{a.comment}"</span>}
                        {deadlinePassed && <span className="block text-[11px] font-medium text-red-600 dark:text-red-400">Sista svarsdag har passerat</span>}
                      </span>
                      <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-lg ${st ? st.badge : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                        {st ? st.label : 'Ej svarat'}
                      </span>
                    </label>
                  </li>
                </React.Fragment>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

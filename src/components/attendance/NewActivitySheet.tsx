/**
 * Ny aktivitet från menyn Närvaro (tränare och admin): träning, match eller övrig aktivitet,
 * en enskild eller återkommande varje vecka, med plats, samling, LOK-aktivitet och kallelse.
 * Aktiviteterna blir vanliga pass (syns i Kalendern, på Översikt och i kalenderprenumerationen).
 */
import { useEffect, useMemo, useState } from 'react';
import { Dumbbell, Trophy, Shapes, Bell } from 'lucide-react';
import { TrainingSession, TrainingSettings } from '../../types';
import { Button, SegmentedTabs, Sheet, TextArea, TextInput } from '../ui';
import { CATEGORY_LABEL, toDateInput } from './shared';
import type { SessionCategory } from '../../utils/sessionCategory';

interface NewActivitySheetProps {
  open: boolean;
  onClose: () => void;
  settings?: TrainingSettings;
  squadCount: number;
  /** Sparar de nya passen; notify = skicka en notis till laget. */
  onCreate: (sessions: TrainingSession[], notify: boolean) => void;
}

const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

const label = 'block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5';
const input = 'w-full h-11 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-base sm:text-sm outline-none focus:ring-2 focus:ring-indigo-500/50';
const check = 'w-5 h-5 rounded accent-indigo-600 shrink-0 cursor-pointer';

const addMinutes = (time: string, minutes: number) => {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, (m || 0) + minutes, 0, 0);
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
};

const toNoon = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
};

// Alla datum mellan från och till (högst ett år) som faller på valda veckodagar (0 = måndag).
const weeklyDates = (from: string, until: string, days: number[]) => {
  if (!from || !until || days.length === 0 || until < from) return [];
  const [y, m, d] = from.split('-').map(Number);
  const cursor = new Date(y, m - 1, d, 12, 0, 0);
  const found: string[] = [];
  for (let i = 0; i < 366; i++) {
    const s = toDateInput(cursor.getTime());
    if (s > until) break;
    if (days.includes((cursor.getDay() + 6) % 7)) found.push(s);
    cursor.setDate(cursor.getDate() + 1);
  }
  return found;
};

export default function NewActivitySheet({ open, onClose, settings, squadCount, onCreate }: NewActivitySheetProps) {
  const defaultStart = settings?.defaultStartTime || '18:00';
  const defaultEnd = settings?.defaultEndTime || addMinutes(defaultStart, settings?.defaultDuration || 90);

  const [kind, setKind] = useState<SessionCategory>('training');
  const [title, setTitle] = useState('');
  const [opponent, setOpponent] = useState('');
  const [homeAway, setHomeAway] = useState<'home' | 'away'>('home');
  const [repeat, setRepeat] = useState<'single' | 'weekly'>('single');
  const [date, setDate] = useState('');
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [repeatUntil, setRepeatUntil] = useState('');
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);
  const [location, setLocation] = useState('');
  const [gathering, setGathering] = useState('');
  const [description, setDescription] = useState('');
  const [lok, setLok] = useState(true);
  const [invite, setInvite] = useState(true);
  const [deadlineDays, setDeadlineDays] = useState<number | ''>(1);
  const [deadlineTime, setDeadlineTime] = useState('12:00');
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Nytt tomt formulär varje gång arket öppnas
  useEffect(() => {
    if (!open) return;
    const today = toDateInput(Date.now());
    setKind('training'); setTitle(''); setOpponent(''); setHomeAway('home');
    setRepeat('single'); setDate(today); setRepeatDays([]); setRepeatUntil('');
    setStartTime(defaultStart); setEndTime(defaultEnd);
    setLocation(''); setGathering(''); setDescription('');
    setLok(true); setInvite(true); setDeadlineDays(1); setDeadlineTime('12:00'); setNotify(true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dates = useMemo(
    () => (repeat === 'single' ? (date ? [date] : []) : weeklyDates(date, repeatUntil, repeatDays)),
    [repeat, date, repeatUntil, repeatDays],
  );

  const autoTitle = kind === 'match' && opponent.trim()
    ? `Match mot ${opponent.trim()}`
    : CATEGORY_LABEL[kind];

  const save = () => {
    if (dates.length === 0) {
      setError(repeat === 'single' ? 'Välj ett datum.' : 'Välj veckodagar och ett slutdatum efter startdatumet.');
      return;
    }
    if (!startTime) { setError('Välj starttid.'); return; }
    if (endTime && endTime <= startTime) { setError('Sluttiden måste vara efter starttiden.'); return; }
    const now = Date.now();
    const seriesId = dates.length > 1 ? crypto.randomUUID() : undefined;
    const created: TrainingSession[] = dates.map(dateStr => {
      const [y, m, d] = dateStr.split('-').map(Number);
      let rsvpConfig: TrainingSession['rsvpConfig'];
      if (invite) {
        let deadline: number | undefined;
        if (deadlineDays !== '') {
          const [dh, dm] = (deadlineTime || '12:00').split(':').map(Number);
          deadline = new Date(y, m - 1, d - Number(deadlineDays), dh, dm, 0).getTime();
        }
        rsvpConfig = { deadline, invitedAt: now, invitedCount: squadCount };
      }
      return {
        id: crypto.randomUUID(),
        seriesId,
        title: title.trim() || autoTitle,
        date: toNoon(dateStr),
        startTime,
        endTime: endTime || undefined,
        type: kind,
        category: kind,
        location: location.trim() || undefined,
        gatheringTime: gathering || undefined,
        description: description.trim() || undefined,
        opponent: kind === 'match' ? opponent.trim() || undefined : undefined,
        homeAway: kind === 'match' ? homeAway : undefined,
        lok: lok ? undefined : false,
        rsvpConfig,
        hideContentForPlayers: settings?.defaultHideContentForPlayers || false,
        moments: [],
        createdAt: now,
        updatedAt: now,
      };
    });
    onCreate(created, invite && notify);
    onClose();
  };

  const n = dates.length;
  const footer = (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      <Button block size="lg" onClick={save} disabled={n === 0}>
        {n > 1 ? `Spara ${n} aktiviteter` : 'Spara'}
        {invite && notify ? ' och skicka kallelse' : ''}
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Ny aktivitet" footer={footer}>
      <div className="px-2 pb-2 space-y-5">
        <div>
          <p className={label}>Typ</p>
          <SegmentedTabs<SessionCategory>
            size="lg"
            tabs={[
              { id: 'training', label: 'Träning', icon: <Dumbbell size={15} /> },
              { id: 'match', label: 'Match', icon: <Trophy size={15} /> },
              { id: 'other', label: 'Övrigt', icon: <Shapes size={15} /> },
            ]}
            value={kind}
            onChange={setKind}
          />
        </div>

        {kind === 'match' && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
            <div>
              <label htmlFor="act-opponent" className={label}>Motståndare</label>
              <TextInput id="act-opponent" type="text" value={opponent} onChange={(e) => setOpponent(e.target.value)} maxLength={80} className={input} />
            </div>
            <SegmentedTabs<'home' | 'away'>
              size="lg"
              tabs={[{ id: 'home', label: 'Hemma' }, { id: 'away', label: 'Borta' }]}
              value={homeAway}
              onChange={setHomeAway}
            />
          </div>
        )}

        <div>
          <label htmlFor="act-title" className={label}>Rubrik</label>
          <TextInput id="act-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} maxLength={120} className={input} />
        </div>

        <div className="space-y-3">
          <p className={label}>Upprepning</p>
          <SegmentedTabs<'single' | 'weekly'>
            size="lg"
            tabs={[{ id: 'single', label: 'Enskild' }, { id: 'weekly', label: 'Varje vecka' }]}
            value={repeat}
            onChange={setRepeat}
          />
          <div className={repeat === 'weekly' ? 'grid grid-cols-2 gap-2' : ''}>
            <div>
              <label htmlFor="act-date" className={label}>{repeat === 'weekly' ? 'Från' : 'Datum'}</label>
              <input id="act-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
            </div>
            {repeat === 'weekly' && (
              <div>
                <label htmlFor="act-until" className={label}>Till och med</label>
                <input id="act-until" type="date" value={repeatUntil} min={date} onChange={(e) => setRepeatUntil(e.target.value)} className={input} />
              </div>
            )}
          </div>
          {repeat === 'weekly' && (
            <div>
              <div className="grid grid-cols-7 gap-1" role="group" aria-label="Veckodagar">
                {WEEKDAYS.map((w, i) => {
                  const on = repeatDays.includes(i);
                  return (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setRepeatDays(prev => (on ? prev.filter(x => x !== i) : [...prev, i]))}
                      className={`h-11 rounded-xl border text-sm font-semibold cursor-pointer transition-colors ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-750'}`}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                {n === 0 ? 'Välj veckodagar och ett slutdatum.' : `${n} ${n === 1 ? 'aktivitet' : 'aktiviteter'} skapas.`}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor="act-start" className={label}>Start</label>
            <input id="act-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="act-end" className={label}>Slut</label>
            <input id="act-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="act-gathering" className={label}>Samling</label>
            <input id="act-gathering" type="time" value={gathering} onChange={(e) => setGathering(e.target.value)} className={input} />
          </div>
        </div>

        <div>
          <label htmlFor="act-location" className={label}>Plats</label>
          <TextInput id="act-location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="T.ex. Kungsgårdens IP, konstgräs" maxLength={120} className={input} />
        </div>

        <div>
          <label htmlFor="act-description" className={label}>Information</label>
          <TextArea id="act-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} className={`${input} h-auto py-2.5 resize-y`} />
        </div>

        <label className="flex items-start gap-3 p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 cursor-pointer">
          <input type="checkbox" checked={lok} onChange={(e) => setLok(e.target.checked)} className={`${check} mt-0.5`} />
          <span>
            <span className="block text-sm font-semibold">LOK-aktivitet</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">Räknas med på närvarokorten för aktivitetsstöd.</span>
          </span>
        </label>

        <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} className={`${check} mt-0.5`} />
            <span>
              <span className="block text-sm font-semibold">Skapa kallelse</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">Laget kan svara Kommer, Delvis eller Kan inte.</span>
            </span>
          </label>
          {invite && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="act-deadline-days" className={label}>Sista svarsdag</label>
                  <select
                    id="act-deadline-days"
                    value={deadlineDays}
                    onChange={(e) => setDeadlineDays(e.target.value === '' ? '' : Number(e.target.value))}
                    className={`${input} cursor-pointer`}
                  >
                    <option value="">Ingen</option>
                    <option value={0}>Samma dag</option>
                    {[1, 2, 3, 4, 5, 6, 7].map(x => <option key={x} value={x}>{x} {x === 1 ? 'dag' : 'dagar'} före</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="act-deadline-time" className={label}>Klockan</label>
                  <input id="act-deadline-time" type="time" value={deadlineTime} disabled={deadlineDays === ''} onChange={(e) => setDeadlineTime(e.target.value)} className={`${input} disabled:opacity-50`} />
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className={check} />
                <span className="text-sm font-semibold inline-flex items-center gap-1.5"><Bell size={15} /> Skicka notis till laget</span>
              </label>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

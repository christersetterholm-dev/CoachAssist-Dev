/**
 * En serie pass (skapade tillsammans): se alla pass, ändra alla eller kommande, förläng serien och
 * ta bort kommande pass (de hamnar i papperskorgen).
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Pencil, Trash2 } from 'lucide-react';
import type { TrainingSession } from '../../types';
import { Button, MenuItem, Sheet } from '../ui';
import BulkEditSheet from './BulkEditSheet';
import { describeSeries, extendSeries, seriesSessions } from './seriesUtils';

interface SeriesSheetProps {
  open: boolean;
  onClose: () => void;
  seriesId: string | null;
  allSessions: TrainingSession[];
  onUpdateSessions: (changed: TrainingSession[]) => void;
  onAddSessions: (created: TrainingSession[]) => void;
  onDeleteSessions: (ids: string[]) => void;
}

const dateInput = 'w-full h-11 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-base sm:text-sm';
const toInput = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export default function SeriesSheet({ open, onClose, seriesId, allSessions, onUpdateSessions, onAddSessions, onDeleteSessions }: SeriesSheetProps) {
  const list = useMemo(() => seriesSessions(allSessions, seriesId || undefined), [allSessions, seriesId]);
  const upcoming = list.filter(s => s.date >= startOfToday());
  const [mode, setMode] = useState<'menu' | 'extend' | 'delete'>('menu');
  const [edit, setEdit] = useState<'all' | 'upcoming' | null>(null);
  const [until, setUntil] = useState('');
  const [deleteFrom, setDeleteFrom] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('menu'); setMsg(null); setEdit(null);
    const last = list[list.length - 1];
    if (last) { const d = new Date(last.date); d.setDate(d.getDate() + 28); setUntil(toInput(d.getTime())); }
    setDeleteFrom(toInput(Date.now()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seriesId]);

  const extension = useMemo(() => (until ? extendSeries(list, until) : []), [list, until]);
  const toDelete = useMemo(() => {
    if (!deleteFrom) return [];
    const [y, m, d] = deleteFrom.split('-').map(Number);
    const from = new Date(y, m - 1, d).getTime();
    return list.filter(s => s.date >= from);
  }, [list, deleteFrom]);

  const footer = mode === 'extend' ? (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="secondary" onClick={() => setMode('menu')}>Tillbaka</Button>
      <Button disabled={extension.length === 0} onClick={() => { onAddSessions(extension); setMsg(`${extension.length} pass lades till.`); setMode('menu'); }}>
        Lägg till {extension.length} pass
      </Button>
    </div>
  ) : mode === 'delete' ? (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="secondary" onClick={() => setMode('menu')}>Tillbaka</Button>
      <Button variant="danger" disabled={toDelete.length === 0} onClick={() => { onDeleteSessions(toDelete.map(s => s.id)); setMsg(`${toDelete.length} pass flyttades till papperskorgen.`); setMode('menu'); }}>
        Ta bort {toDelete.length} pass
      </Button>
    </div>
  ) : undefined;

  return (
    <>
      <Sheet open={open && !edit} onClose={onClose} title="Återkommande pass" footer={footer}>
        <div className="px-2 pb-2 space-y-3">
          <p className="text-sm font-semibold">{describeSeries(list)}</p>
          {msg && <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">{msg}</p>}

          {mode === 'menu' && (
            <div className="space-y-1">
              <MenuItem icon={<Pencil size={18} />} label="Ändra alla tillfällen" description={`${list.length} pass, även genomförda (t.ex. LOK-aktivitet)`} onClick={() => setEdit('all')} />
              <MenuItem icon={<Pencil size={18} />} label="Ändra kommande tillfällen" description={upcoming.length ? `${upcoming.length} pass från idag` : 'Inga kommande pass'} onClick={() => upcoming.length && setEdit('upcoming')} />
              <MenuItem icon={<CalendarPlus size={18} />} label="Lägg till fler veckor" description="Fler veckor på samma dagar och tider" onClick={() => setMode('extend')} />
              <MenuItem icon={<Trash2 size={18} />} label="Ta bort tillfällen från ett datum" description="T.ex. när träningstiden byts mitt i säsongen" tone="danger" onClick={() => setMode('delete')} />
            </div>
          )}

          {mode === 'extend' && (
            <div className="space-y-2">
              <label htmlFor="series-until" className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300">Lägg till veckor till och med</label>
              <input id="series-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={dateInput} />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {extension.length ? `${extension.length} nya pass på samma veckodagar och tider. De får samma plats, information och kallelse men inget upplägg.` : 'Inga nya datum före det datumet.'}
              </p>
            </div>
          )}

          {mode === 'delete' && (
            <div className="space-y-2">
              <label htmlFor="series-from" className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300">Ta bort pass från och med</label>
              <input id="series-from" type="date" value={deleteFrom} onChange={(e) => setDeleteFrom(e.target.value)} className={dateInput} />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{toDelete.length} pass flyttas till papperskorgen i Kalendern och kan återställas därifrån.</p>
            </div>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-zinc-600 dark:text-zinc-300">Visa alla tillfällen</summary>
            <ul className="mt-2 space-y-0.5 text-zinc-600 dark:text-zinc-300">
              {list.map(s => (
                <li key={s.id} className="tabular-nums">
                  {new Date(s.date).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })} {s.startTime}{s.endTime ? `–${s.endTime}` : ''}
                  {s.location ? ` · ${s.location}` : ''}{s.lok === false ? ' · ej LOK' : ''}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </Sheet>
      <BulkEditSheet
        open={open && !!edit}
        onClose={() => setEdit(null)}
        sessions={edit === 'upcoming' ? upcoming : list}
        subtitle={edit === 'upcoming' ? 'Kommande tillfällen' : 'Alla tillfällen'}
        onApply={(updated) => { onUpdateSessions(updated); setMsg(`${updated.length} pass ändrades.`); }}
      />
    </>
  );
}

/**
 * Bocka tränare som närvarande på flera pass på en gång (från fliken Närvarokort), t.ex. pass
 * som inte räknas för LOK-stöd för att ingen tränare är bockad. Sparas pass för pass med /api/attendance.
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { saveAttendance } from '../../lib/firebase';
import type { LokActivity, LokRow } from '../../lib/lok';
import { Button, Sheet } from '../ui';

interface LeaderBatchSheetProps {
  open: boolean;
  onClose: () => void;
  clubId: string;
  teamId: string;
  activities: LokActivity[];
  leaders: LokRow[];
  onSaved: (sessionId: string, attendance: string[]) => void;
  onDone: () => void;
}

const check = 'w-5 h-5 rounded accent-indigo-600 shrink-0 cursor-pointer';

export default function LeaderBatchSheet({ open, onClose, clubId, teamId, activities, leaders, onSaved, onDone }: LeaderBatchSheetProps) {
  const [who, setWho] = useState<Set<string>>(new Set());
  const [which, setWhich] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setWho(new Set());
    setWhich(new Set(activities.map(a => a.id)));
    setError(null);
    // Bara när arket öppnas: listan räknas om vid varje omritning
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const add = [...who];
    let failed = 0;
    for (const sessionId of which) {
      try {
        const res = await saveAttendance({ clubId, teamId, sessionId, add });
        onSaved(sessionId, res.attendance);
      } catch {
        failed++;
      }
    }
    setSaving(false);
    if (failed) setError(`${failed} pass kunde inte sparas. Försök igen.`);
    else onClose();
    onDone();
  };

  const n = which.size, m = who.size;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Bocka tränare på flera pass"
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
          <Button block size="lg" disabled={saving || n === 0 || m === 0} onClick={save}>
            {saving ? 'Sparar…' : m === 0 ? 'Välj tränare' : n === 0 ? 'Välj pass' : `Bocka ${m} tränare på ${n} pass`}
          </Button>
        </div>
      }
    >
      <div className="px-2 pb-2 space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Bocka bara de tränare som verkligen var med – närvarokorten är underlag för bidrag.</p>
        <div>
          <p className="text-sm font-semibold mb-2">Tränare</p>
          <div className="flex flex-wrap gap-2">
            {leaders.map(l => {
              const on = who.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setWho(s => toggle(s, l.id))}
                  className={`h-10 px-3 rounded-full border text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200'}`}
                >
                  {on && <Check size={15} strokeWidth={2.6} />}
                  {l.name}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold flex-1">Pass utan tränare ({activities.length})</p>
            <button type="button" className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 cursor-pointer" onClick={() => setWhich(n === activities.length ? new Set() : new Set(activities.map(a => a.id)))}>
              {n === activities.length ? 'Avmarkera alla' : 'Välj alla'}
            </button>
          </div>
          <ul className="space-y-1">
            {activities.map(a => {
              const d = new Date(a.date);
              return (
                <li key={a.id}>
                  <label className="flex items-center gap-3 p-2 rounded-xl cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <input type="checkbox" checked={which.has(a.id)} onChange={() => setWhich(s => toggle(s, a.id))} className={check} />
                    <span className="flex-1 min-w-0 text-sm">
                      <span className="font-semibold">{d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                      <span className="text-zinc-500 dark:text-zinc-400"> · {a.startTime}–{a.endTime} · {a.title || 'Aktivitet'}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Sheet>
  );
}

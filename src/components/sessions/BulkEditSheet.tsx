/**
 * Ändra flera pass på en gång (valda i Närvaro eller hela/kommande delen av en serie).
 * Bara de fält man bockar för ändras; övriga uppgifter, svar och närvaro rörs inte.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Dumbbell, Trophy, Shapes } from 'lucide-react';
import type { TrainingSession } from '../../types';
import { categorizeSession, type SessionCategory } from '../../utils/sessionCategory';
import { Button, SegmentedTabs, Sheet, TextArea, TextInput } from '../ui';
import { applyChanges, FIELD_LABEL, type BulkChanges, type BulkField } from './seriesUtils';

interface BulkEditSheetProps {
  open: boolean;
  onClose: () => void;
  sessions: TrainingSession[];
  /** T.ex. "12 valda pass" eller "Alla pass i serien". */
  subtitle: string;
  onApply: (updated: TrainingSession[]) => void;
}

const label = 'block text-sm font-semibold text-zinc-700 dark:text-zinc-300';
const input = 'w-full h-11 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-base sm:text-sm outline-none focus:ring-2 focus:ring-indigo-500/50';
const check = 'w-5 h-5 rounded accent-indigo-600 shrink-0 cursor-pointer';

export default function BulkEditSheet({ open, onClose, sessions, subtitle, onApply }: BulkEditSheetProps) {
  const first = sessions[0];
  const [on, setOn] = useState<Set<BulkField>>(new Set());
  const [values, setValues] = useState<BulkChanges>({});

  // Börja med det första passets värden, inget förbockat
  useEffect(() => {
    if (!open || !first) return;
    setOn(new Set());
    setValues({
      title: first.title, type: categorizeSession(first), startTime: first.startTime, endTime: first.endTime || '',
      gatheringTime: first.gatheringTime || '', location: first.location || '', description: first.description || '', lok: first.lok !== false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (f: BulkField) => setOn(prev => { const n = new Set(prev); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  const set = (f: BulkField, v: any) => { setValues(prev => ({ ...prev, [f]: v })); setOn(prev => new Set(prev).add(f)); };

  const apply = () => {
    const changes: BulkChanges = {};
    on.forEach(f => { (changes as any)[f] = (values as any)[f]; });
    const updated = applyChanges(sessions, changes).filter((s, i) => s !== sessions[i]);
    onApply(updated);
    onClose();
  };

  const row = (f: BulkField, control: ReactNode) => (
    <div className="flex items-start gap-3">
      <input type="checkbox" checked={on.has(f)} onChange={() => toggle(f)} aria-label={`Ändra ${FIELD_LABEL[f].toLowerCase()}`} className={`${check} mt-2.5`} />
      <div className="flex-1 min-w-0 space-y-1.5">
        <span className={label}>{FIELD_LABEL[f]}</span>
        {control}
      </div>
    </div>
  );

  const n = on.size;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Ändra ${sessions.length} pass`}
      footer={<Button block size="lg" disabled={n === 0} onClick={apply}>{n === 0 ? 'Bocka för vad som ska ändras' : `Ändra ${n} ${n === 1 ? 'uppgift' : 'uppgifter'} på ${sessions.length} pass`}</Button>}
    >
      <div className="px-2 pb-2 space-y-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}. Bocka för det som ska ändras – resten lämnas som det är. Svar, närvaro och upplägg rörs inte.</p>
        {row('lok', (
          <label className="flex items-center gap-2 h-11 cursor-pointer">
            <input type="checkbox" checked={!!values.lok} onChange={(e) => set('lok', e.target.checked)} className={check} />
            <span className="text-sm">Räknas för LOK-stöd (gäller även genomförda pass)</span>
          </label>
        ))}
        {row('type', (
          <SegmentedTabs<SessionCategory>
            size="lg"
            tabs={[
              { id: 'training', label: 'Träning', icon: <Dumbbell size={15} /> },
              { id: 'match', label: 'Match', icon: <Trophy size={15} /> },
              { id: 'other', label: 'Övrigt', icon: <Shapes size={15} /> },
            ]}
            value={(values.type as SessionCategory) || 'training'}
            onChange={(v) => set('type', v)}
          />
        ))}
        {row('title', <TextInput type="text" value={values.title || ''} onChange={(e) => set('title', e.target.value)} maxLength={120} className={input} />)}
        <div className="grid grid-cols-2 gap-3">
          {row('startTime', <input type="time" value={values.startTime || ''} onChange={(e) => set('startTime', e.target.value)} className={input} />)}
          {row('endTime', <input type="time" value={values.endTime || ''} onChange={(e) => set('endTime', e.target.value)} className={input} />)}
        </div>
        {row('gatheringTime', <input type="time" value={values.gatheringTime || ''} onChange={(e) => set('gatheringTime', e.target.value)} className={input} />)}
        {row('location', <TextInput type="text" value={values.location || ''} onChange={(e) => set('location', e.target.value)} maxLength={120} className={input} />)}
        {row('description', <TextArea value={values.description || ''} onChange={(e) => set('description', e.target.value)} rows={3} maxLength={1000} className={`${input} h-auto py-2.5 resize-y`} />)}
      </div>
    </Sheet>
  );
}

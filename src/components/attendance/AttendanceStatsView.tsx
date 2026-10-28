/**
 * Närvarostatistik (tränare): period, typ av aktivitet och grupp (spelare eller tränare).
 * En stapel per person, uppdelad på match, övrigt och träning, med närvaro i procent och lagets
 * medelnärvaro. Ett tryck på en person visar detaljer. Kan sparas som bild eller Excel.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Download, Image as ImageIcon, FileSpreadsheet, ChevronDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import { SquadPlayer, TrainingSession } from '../../types';
import type { SessionCategory } from '../../utils/sessionCategory';
import { computeAttendanceStats, KINDS, PersonStats } from '../../utils/attendanceStats';
import { Button, Card, EmptyState, MenuItem, SegmentedTabs, Sheet } from '../ui';
import { teamLeaders, teamPlayers, toDateInput } from './shared';

interface AttendanceStatsViewProps {
  squad: SquadPlayer[];
  sessions: TrainingSession[];
  teamName?: string;
}

type Group = 'players' | 'leaders';
type Preset = '30d' | '6m' | 'halfyear' | 'year' | 'custom';

const KIND_TEXT: Record<SessionCategory, string> = { training: 'Träning', match: 'Match', other: 'Övrigt' };
// Ordningen i staplarna: match, övrigt, träning (som laget.se)
const BAR_ORDER: SessionCategory[] = ['match', 'other', 'training'];
const KIND_BAR: Record<SessionCategory, string> = {
  training: 'bg-indigo-500 dark:bg-indigo-400',
  match: 'bg-red-500 dark:bg-red-400',
  other: 'bg-sky-500 dark:bg-sky-400',
};

const chipClass = 'h-10 px-3.5 rounded-full border text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors whitespace-nowrap';
const chipOff = 'border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800';
const chipOn = 'border-indigo-600 bg-indigo-600 text-white';
const dateInput = 'w-full h-11 px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-base sm:text-sm font-medium';

const presetRange = (p: Preset): [string, string] => {
  const now = new Date();
  const today = toDateInput(now.getTime());
  if (p === '30d') return [toDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30).getTime()), today];
  if (p === '6m') return [toDateInput(new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).getTime()), today];
  if (p === 'halfyear') return [`${now.getFullYear()}-${now.getMonth() < 6 ? '01-01' : '07-01'}`, today];
  return [`${now.getFullYear()}-01-01`, today];
};

const PRESETS: { id: Exclude<Preset, 'custom'>; label: string }[] = [
  { id: '30d', label: '30 dagar' },
  { id: '6m', label: '6 månader' },
  { id: 'halfyear', label: 'Halvåret' },
  { id: 'year', label: 'I år' },
];

const formatDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function AttendanceStatsView({ squad, sessions, teamName }: AttendanceStatsViewProps) {
  const [preset, setPreset] = useState<Preset>('6m');
  const [[from, to], setRange] = useState<[string, string]>(() => presetRange('6m'));
  const [kinds, setKinds] = useState<SessionCategory[]>(KINDS);
  const [group, setGroup] = useState<Group>('players');
  const [sortBy, setSortBy] = useState<'percent' | 'name'>('percent');
  const [openId, setOpenId] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const people = useMemo(() => (group === 'players' ? teamPlayers(squad) : teamLeaders(squad)), [squad, group]);
  const stats = useMemo(
    () => computeAttendanceStats({ sessions, people, from, to: to < from ? from : to, kinds }),
    [sessions, people, from, to, kinds],
  );
  const rows = useMemo(() => {
    const list = [...stats.people];
    if (sortBy === 'name') list.sort((a, b) => a.person.name.localeCompare(b.person.name, 'sv'));
    else list.sort((a, b) => b.percent - a.percent || b.attended - a.attended || a.person.name.localeCompare(b.person.name, 'sv'));
    return list;
  }, [stats, sortBy]);

  const total = stats.sessions.length;
  const periodLabel = `${formatDate(from)} – ${formatDate(to)}`;
  const groupLabel = group === 'players' ? 'Spelare' : 'Tränare';

  const choosePreset = (p: Exclude<Preset, 'custom'>) => { setPreset(p); setRange(presetRange(p)); };
  const toggleKind = (k: SessionCategory) => setKinds(prev => {
    const next = prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k];
    return next.length ? KINDS.filter(x => next.includes(x)) : prev; // minst en typ
  });

  const fileBase = `Närvaro ${teamName ? `${teamName} ` : ''}${from} till ${to}`.replace(/[\\/:*?"<>|]/g, '');

  const saveImage = async () => {
    setIsExportOpen(false);
    setExportError(null);
    if (!chartRef.current) return;
    try {
      const { toPng } = await import('html-to-image');
      const bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
      const url = await toPng(chartRef.current, { backgroundColor: bg, pixelRatio: 2 });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileBase}.png`;
      a.click();
    } catch (e: any) {
      setExportError(`Bilden kunde inte skapas: ${e?.message || e}`);
    }
  };

  const saveExcel = () => {
    setIsExportOpen(false);
    const data = rows.map(r => ({
      Namn: r.person.name,
      'Närvaro %': r.percent,
      Träning: r.byKind.training,
      Match: r.byKind.match,
      Övrigt: r.byKind.other,
      Totalt: r.attended,
      'Av aktiviteter': total,
      'Svarade kommer men kom inte': r.noShow,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, groupLabel);
    XLSX.writeFile(wb, `${fileBase}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Period</p>
          <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" role="group" aria-label="Period">
            {PRESETS.map(p => (
              <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => choosePreset(p.id)} className={`${chipClass} ${preset === p.id ? chipOn : chipOff}`}>{p.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Från
              <input type="date" value={from} max={to} onChange={(e) => { if (e.target.value) { setPreset('custom'); setRange([e.target.value, to]); } }} className={`mt-1 ${dateInput}`} />
            </label>
            <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Till och med
              <input type="date" value={to} min={from} onChange={(e) => { if (e.target.value) { setPreset('custom'); setRange([from, e.target.value]); } }} className={`mt-1 ${dateInput}`} />
            </label>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Aktiviteter</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Typ av aktivitet">
              {KINDS.map(k => (
                <button key={k} type="button" aria-pressed={kinds.includes(k)} onClick={() => toggleKind(k)} className={`${chipClass} ${kinds.includes(k) ? chipOn : chipOff}`}>
                  <span className={`w-2.5 h-2.5 rounded-full ${KIND_BAR[k]}`} aria-hidden="true" />
                  {KIND_TEXT[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 sm:ml-auto">
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Grupp</p>
            <SegmentedTabs<Group>
              size="lg"
              tabs={[{ id: 'players', label: 'Spelare' }, { id: 'leaders', label: 'Tränare' }]}
              value={group}
              onChange={(g) => { setGroup(g); setOpenId(null); }}
            />
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <SegmentedTabs<'percent' | 'name'>
          tabs={[{ id: 'percent', label: 'Högst närvaro' }, { id: 'name', label: 'Namn' }]}
          value={sortBy}
          onChange={setSortBy}
        />
        <Button variant="secondary" icon={<Download size={18} />} onClick={() => setIsExportOpen(true)} disabled={total === 0 || rows.length === 0} className="ml-auto">
          Spara
        </Button>
      </div>
      {exportError && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{exportError}</p>}

      <div ref={chartRef}>
        <Card className="space-y-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{groupLabel} · {periodLabel}</p>
              <p className="text-2xl font-bold tracking-tight">Medelnärvaro {total ? `${stats.average} %` : '–'}</p>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold" aria-label="Antal aktiviteter">
              {BAR_ORDER.filter(k => kinds.includes(k)).map(k => (
                <li key={k} className="inline-flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${KIND_BAR[k]}`} aria-hidden="true" />
                  {KIND_TEXT[k]} ({stats.totals[k]})
                </li>
              ))}
            </ul>
          </div>

          {total === 0 || rows.length === 0 ? (
            <EmptyState
              title={rows.length === 0 ? `Inga ${groupLabel.toLowerCase()} i truppen` : 'Inga genomförda aktiviteter'}
              text={rows.length === 0 ? undefined : 'Välj en annan period eller fler typer av aktiviteter.'}
            />
          ) : (
            <ul className="space-y-1">
              {rows.map(r => (
                <PersonBar key={r.person.id} row={r} total={total} kinds={kinds} open={openId === r.person.id} onToggle={() => setOpenId(id => (id === r.person.id ? null : r.person.id))} totals={stats.totals} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Sheet open={isExportOpen} onClose={() => setIsExportOpen(false)} title="Spara statistiken">
        <div className="px-2 pb-2 space-y-1">
          <MenuItem icon={<ImageIcon size={18} />} label="Bild (PNG)" description="Diagrammet som bild, t.ex. att dela i chatten" onClick={saveImage} />
          <MenuItem icon={<FileSpreadsheet size={18} />} label="Excel" description="En rad per person med alla siffror" onClick={saveExcel} />
        </div>
      </Sheet>
    </div>
  );
}

const PersonBar: React.FC<{
  row: PersonStats;
  total: number;
  kinds: SessionCategory[];
  totals: Record<SessionCategory, number>;
  open: boolean;
  onToggle: () => void;
}> = ({ row, total, kinds, totals, open, onToggle }) => (
  <li>
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="w-full grid grid-cols-1 sm:grid-cols-[12rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-2 py-1.5 rounded-xl text-left cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
    >
      <span className="flex items-center gap-2 min-w-0 text-sm">
        <span className="font-semibold truncate">{row.person.name}</span>
        <span className="shrink-0 text-zinc-500 dark:text-zinc-400 tabular-nums">{row.percent} %</span>
        <ChevronDown size={14} className={`shrink-0 text-zinc-400 transition-transform sm:hidden ${open ? 'rotate-180' : ''}`} />
      </span>
      <span className="flex h-6 rounded-lg bg-zinc-100 dark:bg-zinc-800 overflow-hidden" aria-hidden="true">
        {BAR_ORDER.filter(k => kinds.includes(k) && row.byKind[k] > 0).map(k => {
          const w = (row.byKind[k] / total) * 100;
          return (
            <span key={k} style={{ width: `${w}%` }} className={`${KIND_BAR[k]} h-full flex items-center justify-center text-[11px] font-bold text-white tabular-nums border-r border-white/40 dark:border-zinc-900/40 last:border-r-0`}>
              {w >= 6 ? row.byKind[k] : ''}
            </span>
          );
        })}
      </span>
    </button>
    {open && (
      <div className="mx-2 mb-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 text-sm space-y-1">
        <p className="font-semibold">{row.attended} av {total} aktiviteter</p>
        <p className="text-zinc-600 dark:text-zinc-300">
          {BAR_ORDER.filter(k => kinds.includes(k)).map(k => `${KIND_TEXT[k]} ${row.byKind[k]} av ${totals[k]}`).join(' · ')}
        </p>
        {row.noShow > 0 && (
          <p className="text-amber-700 dark:text-amber-300">Svarade kommer men bockades inte som närvarande: {row.noShow} {row.noShow === 1 ? 'gång' : 'gånger'}</p>
        )}
      </div>
    )}
  </li>
);

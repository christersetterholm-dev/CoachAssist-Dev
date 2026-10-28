/**
 * Administration → Närvaro/LOK (föreningsadmin, t.ex. kansliet):
 * kommunala regler för aktivitetsstöd, RF:s regler (fasta) och föreningens summering av alla lags närvarokort.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { getLokClub, getLokRules, saveLokRules } from '../../lib/firebase';
import { lokPeriods, type LokGroupTable, type LokLock, type LokRules, type LokTotals, type LokType } from '../../lib/lok';
import { Badge, Button, Card, SegmentedTabs, TextInput } from '../ui';
import { GroupTable } from './LokParts';

interface ClubSummary {
  period: { key: string; label: string };
  teams: { teamId: string; name: string; totals: LokTotals; lock: LokLock | null; changedSinceLock: boolean; warnings: number }[];
  totals: LokTotals;
  groups: { participants: LokGroupTable; leaders: LokGroupTable };
}

const label = 'block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1';
const input = 'w-full h-11 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-base sm:text-sm font-medium';

const ruleText = (r: LokRules) => [
  `Deltagare som fyller ${r.minAge}–${r.maxAge} år under året${r.disabilityNoUpperAge ? ' (ingen övre gräns vid funktionsnedsättning)' : ''}`,
  `Minst ${r.minParticipants} deltagare och en ledare (minst ${r.leaderMinAge} år), minst ${r.minMinutes} minuter`,
  ...(r.maxPerLeader ? [`Högst ${r.maxPerLeader} deltagare per ledare`] : []),
  ...(r.maxParticipants ? [`Högst ${r.maxParticipants} deltagare per sammankomst`] : []),
  ...(r.onePerDay ? ['En deltagare räknas en gång per dag'] : []),
  ...r.weeklyCaps.map((c, i, all) => `Högst ${c.max} tillfällen per vecka${all.length > 1 ? ` (${i === 0 ? `till och med ${c.maxAge} år` : `äldre`})` : ''}`),
];

export default function LokAdminPanel({ clubId }: { clubId: string }) {
  const periods = useMemo(() => lokPeriods(), []);
  const [rules, setRules] = useState<{ state: LokRules; municipal: LokRules; canEdit: boolean } | null>(null);
  const [draft, setDraft] = useState<LokRules | null>(null);
  const [groupsText, setGroupsText] = useState({ participants: '', leaders: '' });
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [period, setPeriod] = useState(periods[0].key);
  const [type, setType] = useState<LokType>('state');
  const [summary, setSummary] = useState<ClubSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLokRules(clubId).then((r) => {
      setRules(r);
      setDraft(r.municipal);
      setGroupsText({ participants: r.municipal.participantGroups.join(', '), leaders: r.municipal.leaderGroups.join(', ') });
    }).catch((e) => setError(e?.message || 'Kunde inte hämta reglerna.'));
  }, [clubId]);

  useEffect(() => {
    if (!rules?.canEdit) return;
    if (type === 'municipal' && !rules.municipal.enabled) { setSummary(null); return; }
    setLoading(true);
    setError(null);
    getLokClub(clubId, period, type)
      .then(setSummary)
      .catch((e) => { setSummary(null); setError(e?.message || 'Kunde inte hämta föreningens närvarokort.'); })
      .finally(() => setLoading(false));
  }, [clubId, period, type, rules]);

  const set = <K extends keyof LokRules>(k: K, v: LokRules[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const num = (v: string) => (v === '' ? null : Number(v));
  const parseGroups = (s: string) => s.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));

  const saveRules = async () => {
    if (!draft) return;
    setSaveMsg(null);
    try {
      const res = await saveLokRules(clubId, { ...draft, participantGroups: parseGroups(groupsText.participants), leaderGroups: parseGroups(groupsText.leaders) });
      setRules((r) => (r ? { ...r, municipal: res.municipal } : r));
      setDraft(res.municipal);
      setGroupsText({ participants: res.municipal.participantGroups.join(', '), leaders: res.municipal.leaderGroups.join(', ') });
      setSaveMsg('Reglerna är sparade.');
    } catch (e: any) {
      setSaveMsg(e?.message || 'Reglerna kunde inte sparas.');
    }
  };

  const exportExcel = () => {
    if (!summary) return;
    const rows = summary.teams.map((t) => ({
      Lag: t.name, Sammankomster: t.totals.gatherings, Deltagartillfällen: t.totals.participantOccasions, Ledartillfällen: t.totals.leaderOccasions,
      Intygat: t.lock ? `${t.lock.lockedBy} ${new Date(t.lock.lockedAt).toLocaleDateString('sv-SE')}` : 'Nej', 'Att kontrollera': t.warnings,
    }));
    rows.push({ Lag: 'Totalt', Sammankomster: summary.totals.gatherings, Deltagartillfällen: summary.totals.participantOccasions, Ledartillfällen: summary.totals.leaderOccasions, Intygat: '', 'Att kontrollera': 0 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Lag');
    const groupSheet = (g: LokGroupTable) => [['', ...g.labels], ['Flickor/kvinnor', ...g.female], ['Pojkar/män', ...g.male], ['Okänt kön', ...g.unknown]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(groupSheet(summary.groups.participants)), 'Deltagare per ålder');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(groupSheet(summary.groups.leaders)), 'Ledare per ålder');
    XLSX.writeFile(wb, `LOK ${type === 'state' ? 'statligt' : 'kommunalt'} ${summary.period.key}.xlsx`);
  };

  if (!rules || !draft) {
    return error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <div className="flex justify-center py-10 text-zinc-400"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {rules.canEdit && (
        <Card className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <h3 className="text-lg font-bold">Föreningens närvarokort</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Summering av alla lag – underlag för ansökan. Korten för varje lag finns under Närvaro → Närvarokort.</p>
            </div>
            <Button variant="secondary" icon={<FileSpreadsheet size={18} />} onClick={exportExcel} disabled={!summary}>Excel</Button>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 max-w-sm">
              <label htmlFor="lok-admin-period" className={label}>Period</label>
              <select id="lok-admin-period" value={period} onChange={(e) => setPeriod(e.target.value)} className={`${input} cursor-pointer`}>
                {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <SegmentedTabs<LokType>
              size="lg"
              tabs={[{ id: 'state', label: 'Statligt' }, ...(rules.municipal.enabled ? [{ id: 'municipal' as LokType, label: 'Kommunalt' }] : [])]}
              value={type}
              onChange={setType}
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
          {loading && <div className="flex justify-center py-6 text-zinc-400"><Loader2 className="animate-spin" /></div>}
          {summary && !loading && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-xs text-zinc-500 dark:text-zinc-400 text-right">
                      <th scope="col" className="text-left font-semibold py-1.5 pr-2">Lag</th>
                      <th scope="col" className="font-semibold py-1.5 px-2">Sammankomster</th>
                      <th scope="col" className="font-semibold py-1.5 px-2">Deltagartillfällen</th>
                      <th scope="col" className="font-semibold py-1.5 px-2">Ledartillfällen</th>
                      <th scope="col" className="text-left font-semibold py-1.5 pl-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.teams.map((t) => (
                      <tr key={t.teamId} className="border-t border-zinc-100 dark:border-zinc-800 text-right">
                        <th scope="row" className="text-left font-semibold py-2 pr-2">{t.name}</th>
                        <td className="py-2 px-2">{t.totals.gatherings}</td>
                        <td className="py-2 px-2">{t.totals.participantOccasions}</td>
                        <td className="py-2 px-2">{t.totals.leaderOccasions}</td>
                        <td className="py-2 pl-3 text-left">
                          <span className="flex flex-wrap gap-1.5">
                            {t.lock ? <Badge tone={t.changedSinceLock ? 'warning' : 'success'} icon={<ShieldCheck size={12} />}>{t.changedSinceLock ? 'Ändrat efter intygande' : `Intygat ${new Date(t.lock.lockedAt).toLocaleDateString('sv-SE')}`}</Badge> : <Badge>Inte intygat</Badge>}
                            {t.warnings > 0 && <Badge tone="warning" icon={<AlertTriangle size={12} />}>{t.warnings} att kontrollera</Badge>}
                          </span>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-zinc-200 dark:border-zinc-700 text-right font-bold">
                      <th scope="row" className="text-left py-2 pr-2">Totalt</th>
                      <td className="py-2 px-2">{summary.totals.gatherings}</td>
                      <td className="py-2 px-2">{summary.totals.participantOccasions}</td>
                      <td className="py-2 px-2">{summary.totals.leaderOccasions}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <GroupTable title="Deltagartillfällen per kön och ålder" table={summary.groups.participants} />
                <GroupTable title="Ledartillfällen per kön och ålder" table={summary.groups.leaders} />
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Varje lag räknas för sig: en person som var med i två lag samma dag kan räknas två gånger. Statligt LOK-stöd söks i RF:s system – Truppio skickar inget dit.
              </p>
            </>
          )}
        </Card>
      )}

      <Card className="space-y-2">
        <h3 className="text-lg font-bold">Statligt aktivitetsstöd (RF)</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">RF:s regler som gäller från 1 juli 2025. De är lika för alla föreningar och kan inte ändras här.</p>
        <ul className="text-sm list-disc pl-5 space-y-1">{ruleText(rules.state).map((t) => <li key={t}>{t}</li>)}</ul>
      </Card>

      <Card className="space-y-4">
        <div>
          <h3 className="text-lg font-bold">Kommunalt aktivitetsstöd</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Fyll i kommunens regler. Fråga kommunen (kultur- och fritidsförvaltningen) vad som gäller.</p>
        </div>
        <fieldset disabled={!rules.canEdit} className="space-y-4 disabled:opacity-70">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} className="w-5 h-5 rounded accent-indigo-600" />
            <span className="text-sm font-semibold">Föreningen söker kommunalt aktivitetsstöd</span>
          </label>
          {draft.enabled && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><label htmlFor="r-min" className={label}>Deltagare från (år)</label><input id="r-min" type="number" min={0} value={draft.minAge} onChange={(e) => set('minAge', Number(e.target.value))} className={input} /></div>
                <div><label htmlFor="r-max" className={label}>Till och med (år)</label><input id="r-max" type="number" min={0} value={draft.maxAge} onChange={(e) => set('maxAge', Number(e.target.value))} className={input} /></div>
                <div><label htmlFor="r-lead" className={label}>Ledare minst (år)</label><input id="r-lead" type="number" min={0} value={draft.leaderMinAge} onChange={(e) => set('leaderMinAge', Number(e.target.value))} className={input} /></div>
                <div><label htmlFor="r-part" className={label}>Minst deltagare</label><input id="r-part" type="number" min={1} value={draft.minParticipants} onChange={(e) => set('minParticipants', Number(e.target.value))} className={input} /></div>
                <div><label htmlFor="r-minutes" className={label}>Minst minuter</label><input id="r-minutes" type="number" min={0} value={draft.minMinutes} onChange={(e) => set('minMinutes', Number(e.target.value))} className={input} /></div>
                <div><label htmlFor="r-maxp" className={label}>Högst deltagare</label><input id="r-maxp" type="number" min={1} placeholder="Ingen gräns" value={draft.maxParticipants ?? ''} onChange={(e) => set('maxParticipants', num(e.target.value))} className={input} /></div>
                <div><label htmlFor="r-perl" className={label}>Högst per ledare</label><input id="r-perl" type="number" min={1} placeholder="Ingen gräns" value={draft.maxPerLeader ?? ''} onChange={(e) => set('maxPerLeader', num(e.target.value))} className={input} /></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label htmlFor="r-pg" className={label}>Åldersgrupper deltagare (lägsta ålder i varje grupp)</label><TextInput id="r-pg" type="text" value={groupsText.participants} onChange={(e) => setGroupsText((g) => ({ ...g, participants: e.target.value }))} placeholder="0, 7, 13, 17, 21" className={input} /></div>
                <div><label htmlFor="r-lg" className={label}>Åldersgrupper ledare</label><TextInput id="r-lg" type="text" value={groupsText.leaders} onChange={(e) => setGroupsText((g) => ({ ...g, leaders: e.target.value }))} placeholder="13, 21, 36, 51, 66" className={input} /></div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={draft.onePerDay} onChange={(e) => set('onePerDay', e.target.checked)} className="w-5 h-5 rounded accent-indigo-600" /><span className="text-sm">En deltagare räknas en gång per dag</span></label>
                <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={draft.disabilityNoUpperAge} onChange={(e) => set('disabilityNoUpperAge', e.target.checked)} className="w-5 h-5 rounded accent-indigo-600" /><span className="text-sm">Ingen övre åldersgräns vid funktionsnedsättning</span></label>
              </div>
            </>
          )}
        </fieldset>
        {rules.canEdit ? (
          <div className="flex items-center gap-3">
            <Button onClick={saveRules}>Spara reglerna</Button>
            {saveMsg && <span className="text-sm text-zinc-600 dark:text-zinc-300" role="status">{saveMsg}</span>}
          </div>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Bara föreningens administratörer kan ändra reglerna.</p>
        )}
      </Card>
    </div>
  );
}

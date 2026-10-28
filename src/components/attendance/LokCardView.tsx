/**
 * Fliken Närvarokort (tränare): lagets närvarokort för LOK-stöd per halvår, statligt eller kommunalt.
 * Visar summor, vad som saknas, deltagartillfällen per kön och ålder och själva korten (25 aktiviteter
 * per kort). Kan skrivas ut / sparas som PDF och intygas (låses). Uträkningen görs på servern (server/lok.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Lock, LockOpen, Printer, ChevronLeft, ChevronRight, ShieldCheck, Loader2 } from 'lucide-react';
import { getLokCard, getLokRules, lockLokCard, unlockLokCard } from '../../lib/firebase';
import { formatLockDate, LOK_TYPE_LABEL, lokPeriods, type LokCardResponse, type LokType } from '../../lib/lok';
import { Button, Card, EmptyState, IconButton, SegmentedTabs, Sheet } from '../ui';
import { CardGrid, GroupTable, LokPrint, PER_CARD } from './LokParts';

interface LokCardViewProps {
  clubId?: string | null;
  teamId?: string | null;
  clubName?: string;
}

const dmy = (ts: number) => new Date(ts).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });

export default function LokCardView({ clubId, teamId, clubName }: LokCardViewProps) {
  const periods = useMemo(() => lokPeriods(), []);
  const [period, setPeriod] = useState(periods[0].key);
  const [type, setType] = useState<LokType>('state');
  const [municipalOn, setMunicipalOn] = useState(false);
  const [data, setData] = useState<LokCardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [printing, setPrinting] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clubId) return;
    getLokRules(clubId).then(r => setMunicipalOn(!!r?.municipal?.enabled)).catch(() => setMunicipalOn(false));
  }, [clubId]);

  const load = useCallback(async () => {
    if (!clubId || !teamId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getLokCard(clubId, teamId, period, type));
      setPage(0);
    } catch (e: any) {
      setData(null);
      setError(e?.message || 'Kunde inte hämta närvarokortet.');
    } finally {
      setLoading(false);
    }
  }, [clubId, teamId, period, type]);

  useEffect(() => { load(); }, [load]);

  const doLock = async (unlock = false) => {
    if (!clubId || !teamId) return;
    setBusy(true);
    try {
      await (unlock ? unlockLokCard : lockLokCard)({ clubId, teamId, period, type });
      setConfirmLock(false);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Det gick inte.');
    } finally {
      setBusy(false);
    }
  };

  const stopPrinting = useCallback(() => setPrinting(false), []);

  if (!clubId || !teamId) {
    return <Card><EmptyState title="Välj ett lag" text="Närvarokorten gäller det aktiva laget." /></Card>;
  }

  const card = data?.card;
  const pages = card ? Math.max(1, Math.ceil(card.activities.length / PER_CARD)) : 1;
  const w = card?.warnings;
  const activityName = (id: string) => {
    const a = card?.activities.find(x => x.id === id);
    return a ? `${a.title || 'Aktivitet'} ${dmy(a.date)}` : id;
  };
  const warningCount = w ? w.noEndTime.length + w.tooShort.length + w.noBirthYear.length + w.noGender.length : 0;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 max-w-sm">
            <label htmlFor="lok-period" className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Period</label>
            <select
              id="lok-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-base sm:text-sm font-semibold cursor-pointer"
            >
              {periods.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          {municipalOn && (
            <SegmentedTabs<LokType>
              size="lg"
              tabs={[{ id: 'state', label: 'Statligt' }, { id: 'municipal', label: 'Kommunalt' }]}
              value={type}
              onChange={setType}
            />
          )}
        </div>
        <p className="flex gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>
            Korten är underlag. Statligt LOK-stöd söks i RF:s system (IdrottOnline/Idrottsarenan) – Truppio skickar inget dit.
            {type === 'state' ? ' Räknat enligt RF:s regler från 1 juli 2025.' : ' Räknat enligt föreningens kommunala regler (Administration → Närvaro/LOK).'}
          </span>
        </p>
      </Card>

      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {loading && !data && (
        <div className="flex justify-center py-10 text-zinc-400"><Loader2 className="animate-spin" /></div>
      )}

      {data && card && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Sammankomster', card.totals.gatherings],
              ['Deltagartillfällen', card.totals.participantOccasions],
              ['Ledartillfällen', card.totals.leaderOccasions],
            ].map(([label, n]) => (
              <Card key={label as string} className="text-center">
                <p className="text-2xl sm:text-3xl font-bold tabular-nums">{n}</p>
                <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
              </Card>
            ))}
          </div>

          <Card className="flex flex-col sm:flex-row sm:items-center gap-3">
            {data.lock ? (
              <>
                <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 flex items-center justify-center shrink-0"><ShieldCheck size={20} /></span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">Intygat av {data.lock.lockedBy}</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{formatLockDate(data.lock.lockedAt)}</p>
                  {data.changedSinceLock && (
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                      Närvaron har ändrats efter att kortet intygades
                      {data.lock.totals ? ` (då ${data.lock.totals.gatherings} sammankomster och ${data.lock.totals.participantOccasions} deltagartillfällen)` : ''}.
                    </p>
                  )}
                </div>
                {data.canUnlock && <Button variant="secondary" icon={<LockOpen size={18} />} disabled={busy} onClick={() => doLock(true)}>Lås upp</Button>}
              </>
            ) : (
              <>
                <span className="w-10 h-10 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center shrink-0"><Lock size={20} /></span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">Inte intygat</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">När halvåret är klart intygar en tränare att uppgifterna stämmer.</p>
                </div>
                <Button variant="secondary" icon={<ShieldCheck size={18} />} onClick={() => setConfirmLock(true)}>Intyga och lås</Button>
              </>
            )}
            <Button icon={<Printer size={18} />} onClick={() => setPrinting(true)} disabled={card.activities.length === 0}>Skriv ut / PDF</Button>
          </Card>

          {w && warningCount + w.notLok > 0 && (
            <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 space-y-2">
              <p className="font-semibold flex items-center gap-2 text-amber-800 dark:text-amber-200"><AlertTriangle size={18} /> Kontrollera</p>
              <ul className="text-sm space-y-1.5 text-zinc-700 dark:text-zinc-200 list-disc pl-5">
                {w.noEndTime.length > 0 && <li>Sluttid saknas, räknas inte: {w.noEndTime.map(activityName).join(', ')}</li>}
                {w.tooShort.length > 0 && <li>För korta ({data.rules.minMinutes} min krävs): {w.tooShort.map(activityName).join(', ')}</li>}
                {w.noBirthYear.length > 0 && <li>Personnummer saknas (räknas inte som deltagare): {w.noBirthYear.join(', ')}. Fyll i under Administration → Medlemmar.</li>}
                {w.noGender.length > 0 && <li>Kön kan inte räknas fram ur personnumret: {w.noGender.join(', ')}.</li>}
                {w.notLok > 0 && <li>{w.notLok} {w.notLok === 1 ? 'aktivitet är' : 'aktiviteter är'} inte markerade som LOK-aktivitet och finns inte med.</li>}
              </ul>
            </Card>
          )}

          <Card className="grid gap-6 lg:grid-cols-2">
            <GroupTable title="Deltagartillfällen per kön och ålder" table={card.groups.participants} />
            <GroupTable title="Ledartillfällen per kön och ålder" table={card.groups.leaders} />
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold">Närvarokort {pages > 1 ? `${page + 1} av ${pages}` : ''}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">1 = räknas · <span className="text-red-600 dark:text-red-400">(1)</span> = närvarande men räknas inte · x = inte närvarande. Röd kolumn = räknas inte som sammankomst (håll över för orsak).</p>
              </div>
              {pages > 1 && (
                <>
                  <IconButton label="Föregående kort" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={20} /></IconButton>
                  <IconButton label="Nästa kort" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight size={20} /></IconButton>
                </>
              )}
            </div>
            {card.activities.length === 0 ? (
              <EmptyState title="Inga genomförda LOK-aktiviteter" text="Välj ett annat halvår eller kontrollera att aktiviteterna är markerade som LOK-aktivitet." />
            ) : (
              <CardGrid card={card} from={page * PER_CARD} to={page * PER_CARD + PER_CARD} />
            )}
          </Card>

          {printing && (
            <LokPrint card={card} type={type} clubName={clubName || ''} teamName={data.teamName} periodLabel={data.period.label} onDone={stopPrinting} />
          )}
        </>
      )}

      <Sheet
        open={confirmLock}
        onClose={() => setConfirmLock(false)}
        title="Intyga närvarokortet"
        footer={<Button block size="lg" disabled={busy} onClick={() => doLock(false)}>{busy ? 'Sparar…' : 'Intyga och lås'}</Button>}
      >
        <div className="px-2 pb-2 space-y-2 text-sm text-zinc-700 dark:text-zinc-200">
          <p>Du intygar att närvaron för <b>{LOK_TYPE_LABEL[type].toLowerCase()}</b>, {periods.find(p => p.key === period)?.label}, stämmer.</p>
          <p>Summorna sparas med ditt namn och datum. Ändras närvaron senare syns det på kortet. Bara föreningens administratörer kan låsa upp.</p>
        </div>
      </Sheet>
    </div>
  );
}

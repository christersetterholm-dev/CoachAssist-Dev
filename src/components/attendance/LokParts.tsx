/**
 * Delar som närvarokorten (fliken Närvarokort) och föreningens summering i Administration delar:
 * tabellen med deltagartillfällen per kön och ålder, rutnätet med 1 / (1) / x och utskriften.
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { LokActivity, LokCard, LokGroupTable, LokRow, LokSummary, LokType } from '../../lib/lok';
import { activityLabel, LOK_TYPE_LABEL, presentOn } from '../../lib/lok';

/** Antal aktiviteter per närvarokort (som på pappersblanketten). */
export const PER_CARD = 25;

const dm = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const GroupTable: React.FC<{ title: string; table: LokGroupTable; className?: string }> = ({ title, table, className = '' }) => {
  const hasUnknown = table.unknown.some(n => n > 0);
  const rows: [string, number[]][] = [['Flickor/kvinnor', table.female], ['Pojkar/män', table.male], ...(hasUnknown ? [['Okänt kön', table.unknown] as [string, number[]]] : [])];
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm tabular-nums">
        <caption className="text-left text-sm font-semibold mb-1.5">{title}</caption>
        <thead>
          <tr className="text-xs text-zinc-500 dark:text-zinc-400">
            <th scope="col" className="text-left font-semibold py-1 pr-2">Ålder</th>
            {table.labels.map(l => <th key={l} scope="col" className="text-right font-semibold py-1 px-2">{l}</th>)}
            <th scope="col" className="text-right font-semibold py-1 pl-2">Totalt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, nums]) => (
            <tr key={label} className="border-t border-zinc-100 dark:border-zinc-800">
              <th scope="row" className="text-left font-medium py-1.5 pr-2 whitespace-nowrap">{label}</th>
              {nums.map((n, i) => <td key={i} className="text-right py-1.5 px-2">{n}</td>)}
              <td className="text-right py-1.5 pl-2 font-semibold">{nums.reduce((a, b) => a + b, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const cellClass = (c: string) =>
  c === '1' ? 'font-bold text-zinc-900 dark:text-white' : c === '(1)' ? 'text-red-600 dark:text-red-400' : 'text-zinc-300 dark:text-zinc-600';

const PeopleRows: React.FC<{ rows: LokRow[]; from: number; to: number; offset: number }> = ({ rows, from, to, offset }) => (
  <>
    {rows.map((r, i) => (
      <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
        <td className="sticky left-0 z-10 bg-white dark:bg-zinc-900 py-1 pr-2 text-xs text-zinc-400 tabular-nums">{offset + i + 1}</td>
        <th scope="row" className="sticky left-6 z-10 bg-white dark:bg-zinc-900 py-1 pr-3 text-left font-medium whitespace-nowrap max-w-[11rem] truncate">{r.name}</th>
        <td className="py-1 pr-3 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap tabular-nums">{r.personnummer || <span className="text-amber-600 dark:text-amber-400">saknas</span>}</td>
        {r.cells.slice(from, to).map((c, j) => <td key={j} className={`text-center py-1 px-0.5 text-xs ${cellClass(c)}`}>{c}</td>)}
        <td className="text-right py-1 pl-2 font-semibold tabular-nums">{r.total}</td>
      </tr>
    ))}
  </>
);

const SumRow: React.FC<{ label: string; activities: LokActivity[]; value: (a: LokActivity) => number }> = ({ label, activities, value }) => (
  <tr className="border-t-2 border-zinc-200 dark:border-zinc-700 font-semibold">
    <td className="sticky left-0 z-10 bg-white dark:bg-zinc-900" />
    <th scope="row" className="sticky left-6 z-10 bg-white dark:bg-zinc-900 py-1 pr-3 text-left">{label}</th>
    <td />
    {activities.map(a => (
      <td key={a.id} className={`text-center py-1 px-0.5 text-xs tabular-nums ${a.approved ? '' : 'text-red-600 dark:text-red-400'}`}>
        {a.approved ? value(a) : `(${value(a)})`}
      </td>
    ))}
    <td />
  </tr>
);

/** Rutnätet för ett kort (aktiviteterna from–to). Bara de som var med på något av kortets pass visas (som laget.se). */
export const CardGrid: React.FC<{ card: LokCard; from: number; to: number }> = ({ card, from, to }) => {
  const acts = card.activities.slice(from, to);
  const participants = presentOn(card.participants, from, to);
  const leaders = presentOn(card.leaders, from, to);
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="text-sm border-separate border-spacing-0 mx-4 sm:mx-0">
        <thead>
          <tr className="align-bottom">
            <th className="sticky left-0 z-10 bg-white dark:bg-zinc-900 w-6" />
            <th scope="col" className="sticky left-6 z-10 bg-white dark:bg-zinc-900 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 pb-1 pr-3">Namn</th>
            <th scope="col" className="text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 pb-1 pr-3">Födelsedata</th>
            {acts.map(a => (
              <th key={a.id} scope="col" title={`${a.title || activityLabel(a)}${a.reason ? ` – räknas inte: ${a.reason}` : ''}`} className="pb-1 px-0.5 text-[10px] font-semibold leading-tight text-center min-w-[2.1rem] align-bottom">
                <span className={`lok-vlabel mx-auto ${a.approved ? 'text-zinc-500 dark:text-zinc-400' : 'text-red-600 dark:text-red-400'}`}>{activityLabel(a)}</span>
                <span className="block tabular-nums">{dm(a.date)}</span>
                <span className="block tabular-nums text-zinc-400">{a.startTime}</span>
              </th>
            ))}
            <th scope="col" className="text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 pb-1 pl-2">Summa</th>
          </tr>
        </thead>
        <tbody>
          <tr><th colSpan={acts.length + 4} scope="colgroup" className="sticky left-0 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 pt-2 pb-1">Deltagare</th></tr>
          <PeopleRows rows={participants} from={from} to={to} offset={0} />
          <SumRow label="Summa" activities={acts} value={a => a.counted} />
          {leaders.length > 0 && (
            <>
              <tr><th colSpan={acts.length + 4} scope="colgroup" className="sticky left-0 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 pt-4 pb-1">Ledare</th></tr>
              <PeopleRows rows={leaders} from={from} to={to} offset={participants.length} />
              <SumRow label="Summa" activities={acts} value={a => a.leaders} />
            </>
          )}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Utskrift (eller spara som PDF): alla kort, ett per sida i liggande A4, i samma upplägg som pappersblanketten.
 * Läggs direkt i <body>; CSS i index.css (body.lok-printing) döljer resten av appen vid utskrift.
 */
export const LokPrint: React.FC<{
  card: LokCard; type: LokType; clubName: string; teamName: string; periodLabel: string; onDone: () => void;
}> = ({ card, type, clubName, teamName, periodLabel, onDone }) => {
  useEffect(() => {
    document.body.classList.add('lok-printing');
    const done = () => { document.body.classList.remove('lok-printing'); onDone(); };
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); document.body.classList.remove('lok-printing'); };
  }, [onDone]);

  const pages = Math.max(1, Math.ceil(card.activities.length / PER_CARD));
  const places = Array.from(new Set(card.activities.map(a => a.location).filter(Boolean)));
  return createPortal(
    <div id="lok-print">
      {Array.from({ length: pages }, (_, p) => {
        const from = p * PER_CARD, to = from + PER_CARD;
        const acts = card.activities.slice(from, to);
        const participants = presentOn(card.participants, from, to);
        const leaders = presentOn(card.leaders, from, to);
        const summary: LokSummary = card.pages[p] || card;
        const last = p === pages - 1;
        return (
          <section key={p} className="lok-page">
            <table className="lok-head">
              <tbody>
                <tr><th>Närvarokort nr</th><td>{p + 1} av {pages}</td><th>{LOK_TYPE_LABEL[type]}</th></tr>
                <tr><th>Förening</th><td>{clubName}</td><th>Lag</th></tr>
                <tr><th>Idrott</th><td>Fotboll</td><td>{teamName}</td></tr>
                <tr><th>Anläggning/lokal</th><td colSpan={2}>{places.join(', ')}</td></tr>
                <tr><th>Avser perioden</th><td colSpan={2}>{periodLabel}</td></tr>
                <tr><th>Riktigheten av lämnade uppgifter intygas</th><td colSpan={2} className="lok-sign">Namnteckning</td></tr>
              </tbody>
            </table>
            <table className="lok-grid">
              <thead>
                <tr>
                  <th>Nr</th><th>Namn</th><th>Födelsedata</th>
                  {acts.map((a, i) => <th key={a.id}>{i + 1}<span className="lok-vlabel">{activityLabel(a)}</span>{dm(a.date)}<br />{a.startTime}<br />{a.endTime}</th>)}
                  <th>Summa</th>
                </tr>
              </thead>
              <tbody>
                <tr><th colSpan={acts.length + 4} className="lok-section">Deltagare</th></tr>
                {participants.map((r, i) => (
                  <tr key={r.id}><td>{i + 1}</td><td className="lok-name">{r.name}</td><td>{r.personnummer}</td>{r.cells.slice(from, to).map((c, j) => <td key={j}>{c}</td>)}<td>{r.total}</td></tr>
                ))}
                <tr className="lok-sum"><td /><td>Summa</td><td />{acts.map(a => <td key={a.id}>{a.approved ? a.counted : `(${a.counted})`}</td>)}<td /></tr>
                {leaders.length > 0 && <tr><th colSpan={acts.length + 4} className="lok-section">Ledare</th></tr>}
                {leaders.map((r, i) => (
                  <tr key={r.id}><td>{participants.length + i + 1}</td><td className="lok-name">{r.name}</td><td>{r.personnummer}</td>{r.cells.slice(from, to).map((c, j) => <td key={j}>{c}</td>)}<td>{r.total}</td></tr>
                ))}
                {leaders.length > 0 && <tr className="lok-sum"><td /><td>Summa</td><td />{acts.map(a => <td key={a.id}>{a.approved ? a.leaders : `(${a.leaders})`}</td>)}<td /></tr>}
              </tbody>
            </table>
            <div className="lok-foot">
              <p>Antal sammankomster: <b>{summary.totals.gatherings}</b> · Antal deltagartillfällen: <b>{summary.totals.participantOccasions}</b> · Antal ledartillfällen: <b>{summary.totals.leaderOccasions}</b></p>
              <GroupTable title="Deltagartillfällen" table={summary.groups.participants} />
              <GroupTable title="Ledartillfällen" table={summary.groups.leaders} />
              {last && pages > 1 && (
                <p>Hela perioden ({pages} kort): <b>{card.totals.gatherings}</b> sammankomster · <b>{card.totals.participantOccasions}</b> deltagartillfällen · <b>{card.totals.leaderOccasions}</b> ledartillfällen</p>
              )}
              <p className="lok-note">1 = räknas · (1) = närvarande men räknas inte · x = inte närvarande. Underlag framtaget i Truppio.</p>
            </div>
          </section>
        );
      })}
    </div>,
    document.body,
  );
};

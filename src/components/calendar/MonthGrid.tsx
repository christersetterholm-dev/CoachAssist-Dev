// Kalenderns vy "Månad": rutnät med veckor som rader (mån–sön), veckonummer, röda dagar och en
// panel för vald dag (under rutnätet på mobil, till höger från 1024 px).
import React, { useMemo } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { Button } from '../ui';
import type { TrainingSession } from '../../types';
import { categorizeSession } from '../../utils/sessionCategory';
import { getISOWeek, holidayOn } from '../../utils/swedishHolidays';

const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
const cx = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(' ');

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// Samma färger som Agenda: match röd, träning grön, övrigt gul.
const DOT: Record<string, string> = { match: 'bg-rose-500', training: 'bg-emerald-500', other: 'bg-amber-500' };

// Kort namn i rutan: första ordet ("Träning - Kungsgårdens SK" → "Träning").
const firstWord = (title: string) => (title || 'Aktivitet').trim().split(/[\s\-–:,]+/)[0] || 'Aktivitet';

export const MonthGrid: React.FC<{
  month: Date;
  sessions: TrainingSession[];
  selectedDay: Date;
  onSelectDay: (d: Date) => void;
  onOpenSession: (id: string) => void;
  onNewSessionOnDay?: (d: Date) => void;
}> = ({ month, sessions, selectedDay, onSelectDay, onOpenSession, onNewSessionOnDay }) => {
  const today = new Date();

  const byDay = useMemo(() => {
    const map = new Map<string, TrainingSession[]>();
    for (const s of sessions) {
      const k = dayKey(new Date(s.date));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    for (const list of map.values()) list.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    return map;
  }, [sessions]);

  // Veckorna som visas: från måndagen på/före den 1:a till söndagen på/efter månadens sista dag.
  const weeks = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7));
    const out: Date[][] = [];
    for (let w = 0; w < 6; w++) {
      const week = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i));
      if (week[0] > last) break;
      out.push(week);
    }
    return out;
  }, [month]);

  const dayEvents = byDay.get(dayKey(selectedDay)) || [];
  const selHoliday = holidayOn(selectedDay);
  const selTitle = selectedDay.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="lg:flex lg:items-start gap-4 mt-2">
      {/* Rutnätet */}
      <div className="flex-1 min-w-0 bg-white dark:bg-zinc-900 sm:rounded-3xl border-y sm:border border-zinc-200/80 dark:border-zinc-800 overflow-hidden">
        <div className="grid grid-cols-[22px_repeat(7,minmax(0,1fr))] sm:grid-cols-[32px_repeat(7,minmax(0,1fr))] border-b border-zinc-100 dark:border-zinc-800">
          <span />
          {WEEKDAYS.map((w, i) => (
            <span key={w} className={cx('py-2 text-center text-[11px] sm:text-xs font-semibold', i === 6 ? 'text-rose-500' : 'text-zinc-500 dark:text-zinc-400')}>{w}</span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={dayKey(week[0])} className="grid grid-cols-[22px_repeat(7,minmax(0,1fr))] sm:grid-cols-[32px_repeat(7,minmax(0,1fr))] border-b last:border-b-0 border-zinc-100 dark:border-zinc-800">
            <span className="pt-2 text-center text-[10px] sm:text-[11px] text-zinc-400 tabular-nums">{getISOWeek(week[0])}</span>
            {week.map((d) => {
              const inMonth = d.getMonth() === month.getMonth();
              const isToday = sameDay(d, today);
              const isSelected = sameDay(d, selectedDay);
              const holiday = holidayOn(d);
              const red = d.getDay() === 0 || !!holiday?.red;
              const events = byDay.get(dayKey(d)) || [];
              return (
                <button
                  key={dayKey(d)}
                  type="button"
                  onClick={() => onSelectDay(d)}
                  aria-label={`${d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}${events.length ? `, ${events.length} aktivitet${events.length > 1 ? 'er' : ''}` : ''}`}
                  aria-pressed={isSelected}
                  className={cx(
                    'min-h-[72px] sm:min-h-[96px] px-0.5 sm:px-1.5 pt-1.5 pb-1 text-left flex flex-col items-stretch gap-0.5 cursor-pointer transition-colors border-l border-zinc-50 dark:border-zinc-800/60',
                    isSelected ? 'bg-indigo-50/70 dark:bg-indigo-950/30' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                    !inMonth && 'opacity-40'
                  )}
                >
                  <span className="flex justify-center sm:justify-start">
                    <span
                      className={cx(
                        'w-7 h-7 rounded-full inline-flex items-center justify-center text-sm tabular-nums',
                        isToday ? 'bg-indigo-600 text-white font-bold' : red ? 'text-rose-500 font-semibold' : 'text-zinc-800 dark:text-zinc-100 font-medium',
                        isSelected && !isToday && 'ring-2 ring-indigo-500'
                      )}
                    >
                      {d.getDate()}
                    </span>
                  </span>
                  {holiday && (
                    <span className="block truncate text-center sm:text-left text-[9px] sm:text-[11px] leading-tight text-rose-500">{holiday.name}</span>
                  )}
                  {events.slice(0, 2).map((s) => (
                    <span key={s.id} className="block min-w-0">
                      <span className="flex items-center gap-0.5 sm:gap-1 min-w-0">
                        <span className={cx('w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0', DOT[categorizeSession(s)])} />
                        <span className="truncate text-[9px] sm:text-xs leading-tight text-zinc-700 dark:text-zinc-200">
                          <span className="font-semibold tabular-nums">{s.startTime}</span>
                          <span className="hidden sm:inline"> {s.title || 'Aktivitet'}</span>
                        </span>
                      </span>
                      {/* Mobil: första ordet på egen rad under klockslaget (rutorna är smala). */}
                      <span className="sm:hidden block truncate pl-2 text-[9px] leading-tight text-zinc-500 dark:text-zinc-400">{firstWord(s.title)}</span>
                    </span>
                  ))}
                  {events.length > 2 && (
                    <span className="text-[9px] sm:text-[11px] font-semibold text-zinc-500 pl-2">+{events.length - 2}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Vald dag */}
      <div className="mt-3 lg:mt-0 lg:w-80 lg:shrink-0 lg:sticky lg:top-2 mx-3 sm:mx-0 p-4 rounded-2xl sm:rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
        <h3 className="text-lg font-bold first-letter:uppercase">{selTitle}</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          vecka {getISOWeek(selectedDay)}
          {selHoliday && <span className="text-rose-500"> · {selHoliday.name}</span>}
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {dayEvents.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400 py-2">Inget inplanerat.</p>}
          {dayEvents.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpenSession(s.id)}
              className="w-full flex items-start gap-3 p-2.5 rounded-xl text-left cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-100 dark:border-zinc-800"
            >
              <span className={cx('mt-1.5 w-2.5 h-2.5 rounded-full shrink-0', DOT[categorizeSession(s)])} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold truncate">{s.title || 'Aktivitet'}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                  {s.startTime}{s.endTime ? `–${s.endTime}` : ''}
                </span>
                {s.location && (
                  <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 truncate"><MapPin size={12} className="shrink-0" />{s.location}</span>
                )}
              </span>
            </button>
          ))}
        </div>
        {onNewSessionOnDay && (
          <Button variant="secondary" size="sm" block icon={<Plus size={16} />} className="mt-3" onClick={() => onNewSessionOnDay(selectedDay)}>
            Ny aktivitet den här dagen
          </Button>
        )}
      </div>
    </div>
  );
};

export default MonthGrid;

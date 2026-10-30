// Antal i en svarsruta: spelare stort, ledare inom parentes, t.ex. "19 (2)". Se rsvpCounts i shared.ts.
import React from 'react';
import type { SplitCount } from './shared';

export const SplitNumber: React.FC<{ n: SplitCount; className?: string }> = ({ n, className = '' }) => (
  <span className={`tabular-nums ${className}`}>
    {n.players}
    {n.leaders > 0 && <span className="text-[0.65em] font-semibold opacity-75"> ({n.leaders})</span>}
  </span>
);

/** Förklaringen under rutorna; visas bara när det finns ledare eller provspelare att förklara. */
export const SplitCaption: React.FC<{ counts: { guests: number } & Record<'attending' | 'partial' | 'declined' | 'unanswered', SplitCount>; className?: string }> = ({ counts, className = '' }) => {
  const hasLeaders = [counts.attending, counts.partial, counts.declined, counts.unanswered].some(c => c.leaders > 0);
  if (!hasLeaders && counts.guests === 0) return null;
  const parts = [
    hasLeaders ? 'Spelare, ledare inom parentes' : null,
    counts.guests > 0 ? `${counts.guests} provspelare räknas till Kommer` : null,
  ].filter(Boolean);
  return <p className={`text-xs text-zinc-500 dark:text-zinc-400 ${className}`}>{parts.join(' · ')}</p>;
};

// Lägger in en ändring som räknats fram ur en äldre ögonblicksbild av passen (t.ex. kalendersynken från laget.se,
// som hämtar kalendern i flera sekunder) ovanpå passens senaste version. Tidigare ersattes hela listan med
// resultatet, så planering som kommit in under tiden (eller en hämtning från servern) försvann (okt 2026).
//
// before = passen när ändringen började räknas, after = resultatet, latest = passen nu.
// Bara de fält som ändringen faktiskt ändrade läggs in, och bara om de inte ändrats på annat håll under tiden.
// Pass som ändringen tog bort tas bort, nya pass läggs till, och pass som kommit till under tiden behålls.
import type { TrainingSession } from '../types';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeSessionChanges(before: TrainingSession[], after: TrainingSession[], latest: TrainingSession[]): TrainingSession[] {
  const beforeById = new Map(before.map((s) => [s.id, s]));
  const afterById = new Map(after.map((s) => [s.id, s]));
  const result: TrainingSession[] = [];
  const seen = new Set<string>();

  for (const current of latest) {
    seen.add(current.id);
    const b = beforeById.get(current.id);
    const a = afterById.get(current.id);
    if (!b) { result.push(current); continue; } // kom till under tiden
    if (!a) continue; // ändringen tog bort passet
    if (same(a, b)) { result.push(current); continue; }

    const merged: any = { ...current };
    let changed = false;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === 'updatedAt') continue;
      const av = (a as any)[key], bv = (b as any)[key];
      if (same(av, bv)) continue; // ändringen rörde inte fältet
      if (!same((current as any)[key], bv)) continue; // ändrat på annat håll under tiden – det gäller
      if (av === undefined) delete merged[key]; else merged[key] = av;
      changed = true;
    }
    if (changed) merged.updatedAt = Math.max(current.updatedAt || 0, a.updatedAt || 0);
    result.push(changed ? merged : current);
  }

  for (const s of after) {
    if (!beforeById.has(s.id) && !seen.has(s.id)) result.push(s); // nytt pass från ändringen
  }
  return result;
}

// Animationer på taktiktavlan: "steg" (nyckelbilder) som spelas upp efter varandra.
//
// Steg 1 är utgångsläget, steg 2, 3 … är nya situationer. Varje steg är en hel bild av tavlan:
// egna spelare, motståndare, boll, ritningar och en kort text. Vid uppspelning glider spelare,
// motståndare och boll från ett steg till nästa. Ritningarna hör till sitt steg och byts när
// spelarna har kommit fram.
//
// Filen innehåller bara räknandet (ingen React), så att den kan testas för sig
// (tests/boardAnimation.test.mjs). Tavlor utan steg fungerar precis som förut.

export interface BoardToken {
  id: string;
  x: number; // 0–100 procent av planen
  y: number;
  [key: string]: any; // nummer, namn, roll m.m. följer med som de är
}

export interface BoardPos { x: number; y: number }

export interface BoardFrame {
  id: string;
  players: BoardToken[];
  opponents: BoardToken[];
  footballPos: BoardPos | null;
  drawings: any[];
  note?: string;
}

export type BoardSpeed = 'slow' | 'normal' | 'fast';

export interface BoardAnimation {
  frames: BoardFrame[];
  speed?: BoardSpeed;
  showTrails?: boolean;
  // Steget som var valt när tavlan sparades. Tavlans vanliga fält (spelare, boll, ritningar …)
  // är just det steget, så att äldre appversioner visar samma bild.
  current?: number;
}

export const MAX_FRAMES = 20;
export const NOTE_MAX_LENGTH = 120;

export const SPEED_MS: Record<BoardSpeed, number> = { slow: 2500, normal: 1500, fast: 900 };
export const SPEED_LABEL: Record<BoardSpeed, string> = { slow: 'Långsam', normal: 'Normal', fast: 'Snabb' };

export const stepDurationMs = (speed?: BoardSpeed) => SPEED_MS[speed || 'normal'] || SPEED_MS.normal;

// Uppspelningstempo (väljs vid Spela-knappen, sparas per enhet – inte i tavlan). 0,5× = hälften så fort.
export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5] as const;
export const DEFAULT_PLAYBACK_RATE = 1;

export function normalizePlaybackRate(raw: any): number {
  const n = typeof raw === 'string' ? parseFloat(raw) : raw;
  return (PLAYBACK_RATES as readonly number[]).includes(n) ? n : DEFAULT_PLAYBACK_RATE;
}

// Nästa tempo när man trycker på tempoknappen (går runt).
export function nextPlaybackRate(rate: number): number {
  const i = (PLAYBACK_RATES as readonly number[]).indexOf(normalizePlaybackRate(rate));
  return PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
}

// "0,25×", "1×", "1,5×"
export const playbackRateLabel = (rate: number) => `${String(normalizePlaybackRate(rate)).replace('.', ',')}×`;

// Hur länge ett steg tar med tavlans hastighet och valt tempo.
export const scaledStepMs = (speed: BoardSpeed | undefined, rate: number) => stepDurationMs(speed) / normalizePlaybackRate(rate);

export const newFrameId = () => `fr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Mjuk start och inbromsning, som när en spelare springer.
export function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const num = (v: any, fallback = 50) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

// Det som sparas kan komma från äldre/andra appversioner: tvätta till giltiga steg.
export function normalizeAnimation(raw: any): BoardAnimation | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.frames)) return null;
  const tokens = (list: any) => (Array.isArray(list) ? list : [])
    .filter((t: any) => t && typeof t === 'object' && t.id != null)
    .map((t: any) => ({ ...t, id: String(t.id), x: num(t.x), y: num(t.y) }));
  const frames: BoardFrame[] = raw.frames
    .filter((f: any) => f && typeof f === 'object')
    .slice(0, MAX_FRAMES)
    .map((f: any) => ({
      id: typeof f.id === 'string' && f.id ? f.id : newFrameId(),
      players: tokens(f.players),
      opponents: tokens(f.opponents),
      footballPos: f.footballPos && typeof f.footballPos === 'object'
        ? { x: num(f.footballPos.x), y: num(f.footballPos.y) }
        : null,
      drawings: Array.isArray(f.drawings) ? f.drawings : [],
      note: typeof f.note === 'string' ? f.note.slice(0, NOTE_MAX_LENGTH) : '',
    }));
  if (frames.length === 0) return null;
  const speed: BoardSpeed = raw.speed === 'slow' || raw.speed === 'fast' ? raw.speed : 'normal';
  const current = Math.min(Math.max(Math.floor(num(raw.current, 0)), 0), frames.length - 1);
  return { frames, speed, showTrails: raw.showTrails !== false, current };
}

// Ett nytt steg börjar som en kopia av steget det skapas från (utan text).
export function copyFrame(frame: BoardFrame): BoardFrame {
  return {
    id: newFrameId(),
    players: frame.players.map(p => ({ ...p })),
    opponents: frame.opponents.map(o => ({ ...o })),
    footballPos: frame.footballPos ? { ...frame.footballPos } : null,
    drawings: frame.drawings.map(d => (d && typeof d === 'object' ? { ...d } : d)),
    note: '',
  };
}

export function insertFrameAfter(frames: BoardFrame[], index: number): { frames: BoardFrame[]; index: number } {
  if (frames.length === 0 || frames.length >= MAX_FRAMES) return { frames, index };
  const at = Math.min(Math.max(index, 0), frames.length - 1);
  const next = [...frames];
  next.splice(at + 1, 0, copyFrame(frames[at]));
  return { frames: next, index: at + 1 };
}

export function removeFrame(frames: BoardFrame[], index: number): { frames: BoardFrame[]; index: number } {
  if (frames.length <= 1 || index < 0 || index >= frames.length) return { frames, index };
  const next = frames.filter((_, i) => i !== index);
  return { frames: next, index: Math.min(index, next.length - 1) };
}

export function moveFrame(frames: BoardFrame[], from: number, to: number): BoardFrame[] {
  if (from === to || from < 0 || to < 0 || from >= frames.length || to >= frames.length) return frames;
  const next = [...frames];
  const [f] = next.splice(from, 1);
  next.splice(to, 0, f);
  return next;
}

export interface AnimatedToken extends BoardToken {
  opacity: number; // 1 = syns helt; < 1 när en spelare kommer in eller går ut mellan två steg
}

export interface AnimatedBoard {
  players: AnimatedToken[];
  opponents: AnimatedToken[];
  footballPos: BoardPos | null;
  drawings: any[];
  note: string;
  fromIndex: number;
  toIndex: number;
  progress: number; // 0–1 inom övergången (före mjukningen)
}

function blendTokens(from: BoardToken[], to: BoardToken[], t: number): AnimatedToken[] {
  const fromById = new Map(from.map(p => [p.id, p]));
  const toIds = new Set(to.map(p => p.id));
  const out: AnimatedToken[] = to.map(target => {
    const start = fromById.get(target.id);
    if (!start) return { ...target, opacity: t };
    return { ...target, x: lerp(start.x, target.x, t), y: lerp(start.y, target.y, t), opacity: 1 };
  });
  for (const p of from) {
    if (!toIds.has(p.id)) out.push({ ...p, opacity: 1 - t });
  }
  return out.filter(p => p.opacity > 0.001);
}

// Tavlan mitt i övergången från steg `fromIndex` till `fromIndex + 1` (progress 0–1).
export function frameAt(frames: BoardFrame[], fromIndex: number, progress: number): AnimatedBoard | null {
  if (frames.length === 0) return null;
  const i = Math.min(Math.max(Math.floor(fromIndex), 0), frames.length - 1);
  const j = Math.min(i + 1, frames.length - 1);
  const p = i === j ? 1 : Math.min(1, Math.max(0, progress));
  const from = frames[i];
  const to = frames[j];
  const t = easeInOut(p);
  let footballPos: BoardPos | null = null;
  if (from.footballPos && to.footballPos) {
    footballPos = { x: lerp(from.footballPos.x, to.footballPos.x, t), y: lerp(from.footballPos.y, to.footballPos.y, t) };
  } else {
    footballPos = (t < 0.5 ? from.footballPos : to.footballPos) || null;
  }
  const arrived = p >= 1;
  return {
    players: blendTokens(from.players, to.players, t),
    opponents: blendTokens(from.opponents, to.opponents, t),
    footballPos,
    // Ritningarna i ett steg visar vad som ska hända härnäst; de ligger kvar tills spelarna är framme.
    drawings: arrived ? to.drawings : from.drawings,
    note: (arrived ? to.note : from.note) || '',
    fromIndex: i,
    toIndex: j,
    progress: p,
  };
}

// Var uppspelningen är efter `elapsedMs`, räknat från steg `startIndex`.
export function playbackPosition(frameCount: number, startIndex: number, elapsedMs: number, stepMs: number): { fromIndex: number; progress: number; done: boolean } {
  const last = Math.max(frameCount - 1, 0);
  const start = Math.min(Math.max(startIndex, 0), last);
  if (start >= last || stepMs <= 0) return { fromIndex: last, progress: 1, done: true };
  const steps = Math.max(elapsedMs, 0) / stepMs;
  const fromIndex = start + Math.floor(steps);
  if (fromIndex >= last) return { fromIndex: last - 1, progress: 1, done: true };
  return { fromIndex, progress: steps - Math.floor(steps), done: false };
}

// Spåren: varje spelares väg genom stegen fram till där uppspelningen är nu.
// Ger en lista med punkter per id (bara spelare som faktiskt har rört sig).
export function trailsUpTo(frames: BoardFrame[], kind: 'players' | 'opponents', fromIndex: number, progress: number): Map<string, BoardPos[]> {
  const out = new Map<string, BoardPos[]>();
  if (frames.length < 2) return out;
  const i = Math.min(Math.max(Math.floor(fromIndex), 0), frames.length - 1);
  const t = easeInOut(progress);
  for (let k = 0; k <= Math.min(i + 1, frames.length - 1); k++) {
    for (const tok of frames[k][kind]) {
      let pt: BoardPos = { x: tok.x, y: tok.y };
      if (k === i + 1) {
        const prev = frames[i][kind].find(p => p.id === tok.id);
        if (!prev) continue;
        pt = { x: lerp(prev.x, tok.x, t), y: lerp(prev.y, tok.y, t) };
      }
      const list = out.get(tok.id);
      if (!list) {
        out.set(tok.id, [pt]);
      } else {
        const last = list[list.length - 1];
        if (Math.abs(last.x - pt.x) > 0.05 || Math.abs(last.y - pt.y) > 0.05) list.push(pt);
      }
    }
  }
  for (const [id, pts] of out) if (pts.length < 2) out.delete(id);
  return out;
}

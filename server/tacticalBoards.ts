// Lagets taktiktavlor (menyposten Taktiktavla).
//
// Sparas per lag i clubs_data som segmentet 'tacticalboards' med formen { boards: [...] }.
// Appen sparar och tar bort en tavla i taget via /api/tacticalboards, så att två tränare som
// arbetar samtidigt inte skriver över varandras tavlor. Spelare får bara de tavlor som en
// tränare har delat (sharedWithPlayers) – resten skickas aldrig till dem.
import type { Db } from './database.ts';

export const SEGMENT = 'tacticalboards';
const MAX_BOARD_BYTES = 1_000_000;

export interface TacticalBoardDoc {
  id: string;
  name: string;
  sharedWithPlayers: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
  // Själva tavlan: ritningar, spelare, motståndare, boll, plan m.m. (samma fält som uppställningens
  // tacticalBoard plus planens utseende). Servern tittar inte i den.
  state: Record<string, any>;
}

function readAll(db: Db, clubId: string, teamId: string): TacticalBoardDoc[] {
  const row: any = db.prepare('SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = ?').get(clubId, teamId, SEGMENT);
  if (!row) return [];
  try {
    const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    return Array.isArray(parsed?.boards) ? parsed.boards : [];
  } catch {
    return [];
  }
}

function writeAll(db: Db, clubId: string, teamId: string, boards: TacticalBoardDoc[]) {
  db.prepare(`
    INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
  `).run(clubId, teamId, SEGMENT, JSON.stringify({ boards }), Date.now());
}

// Det som får skickas till en viss person: tränare ser allt, övriga bara delade tavlor.
export function visibleBoards(boards: TacticalBoardDoc[], isCoach: boolean): TacticalBoardDoc[] {
  return isCoach ? boards : boards.filter((b) => b.sharedWithPlayers === true);
}

export function listBoards(db: Db, clubId: string, teamId: string, isCoach: boolean): TacticalBoardDoc[] {
  return visibleBoards(readAll(db, clubId, teamId), isCoach).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// För den allmänna dokumentläsningen (/api/docs): samma filtrering som ovan.
export function filterDoc(doc: any, isCoach: boolean): any {
  if (!doc || !Array.isArray(doc.boards)) return doc;
  return { ...doc, boards: visibleBoards(doc.boards, isCoach) };
}

export interface SaveResult { ok: boolean; board?: TacticalBoardDoc; status?: number; error?: string }

export function saveBoard(db: Db, clubId: string, teamId: string, id: string, input: any, userId: string): SaveResult {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, status: 400, error: 'Ogiltigt id.' };
  if (!input || typeof input !== 'object') return { ok: false, status: 400, error: 'Tavlan saknas.' };
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
  if (!name) return { ok: false, status: 400, error: 'Tavlan måste ha ett namn.' };
  const state = input.state && typeof input.state === 'object' && !Array.isArray(input.state) ? input.state : {};
  if (JSON.stringify(state).length > MAX_BOARD_BYTES) return { ok: false, status: 413, error: 'Tavlan är för stor.' };

  let saved: TacticalBoardDoc | null = null;
  db.transaction(() => {
    const boards = readAll(db, clubId, teamId);
    const now = Date.now();
    const existing = boards.find((b) => b.id === id);
    saved = {
      id,
      name,
      sharedWithPlayers: input.sharedWithPlayers === true,
      createdAt: existing?.createdAt || now,
      createdBy: existing?.createdBy || userId,
      updatedAt: now,
      updatedBy: userId,
      state,
    };
    writeAll(db, clubId, teamId, existing ? boards.map((b) => (b.id === id ? saved! : b)) : [saved!, ...boards]);
  })();
  return { ok: true, board: saved! };
}

export function deleteBoard(db: Db, clubId: string, teamId: string, id: string): boolean {
  let removed = false;
  db.transaction(() => {
    const boards = readAll(db, clubId, teamId);
    const next = boards.filter((b) => b.id !== id);
    removed = next.length !== boards.length;
    if (removed) writeAll(db, clubId, teamId, next);
  })();
  return removed;
}

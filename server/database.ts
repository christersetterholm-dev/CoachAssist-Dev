// Databaslager för CoachAssist.
//
// Använder SQLite via better-sqlite3 om det paketet fungerar på maskinen, annars via
// Node.js inbyggda SQLite (node:sqlite, Node 22.13+). Båda exponeras med samma API
// (prepare/get/all/run, exec, pragma, transaction) så att resten av servern inte märker
// skillnad.
//
// Om en gammal JSON-databas (coachassist_db.json, appens tidigare nödlösning) finns och
// SQLite-databasen är tom, flyttas innehållet automatiskt över vid start.
import fs from 'fs';
import path from 'path';

export interface Statement {
  get(...params: any[]): any;
  all(...params: any[]): any[];
  run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface Db {
  driver: 'better-sqlite3' | 'node:sqlite';
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(p: string): any;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
}

type RequireFn = (id: string) => any;

// better-sqlite3 tolererar booleans och undefined; node:sqlite gör det inte.
const normalize = (args: any[]) => args.map((a) => (typeof a === 'boolean' ? (a ? 1 : 0) : a === undefined ? null : a));

function wrapNodeSqlite(raw: any): Db {
  const db: Db = {
    driver: 'node:sqlite',
    prepare(sql: string) {
      const st = raw.prepare(sql);
      return {
        get: (...a: any[]) => {
          const row = st.get(...normalize(a));
          return row === undefined ? undefined : { ...row };
        },
        all: (...a: any[]) => st.all(...normalize(a)).map((r: any) => ({ ...r })),
        run: (...a: any[]) => st.run(...normalize(a)),
      };
    },
    exec(sql: string) { raw.exec(sql); },
    pragma(p: string) {
      try { return raw.prepare('PRAGMA ' + p).all(); } catch { raw.exec('PRAGMA ' + p); return undefined; }
    },
    transaction(fn: any) {
      return ((...args: any[]) => {
        raw.exec('BEGIN');
        try { const r = fn(...args); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; }
      }) as any;
    },
    close() { raw.close(); },
  };
  return db;
}

function openRaw(file: string, req: RequireFn): Db {
  const errors: string[] = [];
  try {
    const BetterSqlite = req('better-sqlite3');
    const test = new BetterSqlite(':memory:');
    test.close();
    const d = new BetterSqlite(file);
    d.driver = 'better-sqlite3';
    return d as Db;
  } catch (e: any) {
    errors.push('better-sqlite3: ' + (e?.message || e));
  }
  try {
    const { DatabaseSync } = req('node:sqlite');
    return wrapNodeSqlite(new DatabaseSync(file));
  } catch (e: any) {
    errors.push('node:sqlite: ' + (e?.message || e));
  }
  throw new Error(
    'Ingen SQLite-motor kunde startas. Använd Node.js 22 eller senare (inbyggd SQLite) ' +
    'eller se till att paketet better-sqlite3 går att installera.\n  ' + errors.join('\n  ')
  );
}

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    has_logged_in INTEGER DEFAULT 0,
    temp_password TEXT
  );
  CREATE TABLE IF NOT EXISTS users_data (
    userId TEXT NOT NULL,
    segment TEXT NOT NULL,
    data TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    PRIMARY KEY (userId, segment),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS shared_leaderboards (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    coachUid TEXT
  );
  CREATE TABLE IF NOT EXISTS clubs_data (
    clubId TEXT NOT NULL,
    teamId TEXT NOT NULL,
    segment TEXT NOT NULL,
    data TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    PRIMARY KEY (clubId, teamId, segment)
  );
  CREATE TABLE IF NOT EXISTS system_docs (
    path TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS uploaded_files (
    filename TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    data_base64 TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Medlemsregister: en rad per person och klubb. id behåller tidigare trupp-id
  -- så att historik (poäng, närvaro, uppställningar) fortsätter peka rätt.
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    club_id TEXT NOT NULL,
    user_id TEXT,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    personnummer TEXT,
    position TEXT,
    number TEXT,
    photo_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_members_club ON members(club_id);
  CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
  CREATE INDEX IF NOT EXISTS idx_members_email ON members(email COLLATE NOCASE);

  -- Roller per lag. team_id = 'club_global' betyder roll på föreningsnivå.
  CREATE TABLE IF NOT EXISTS team_roles (
    member_id TEXT NOT NULL,
    club_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    role TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (member_id, team_id, role)
  );
  CREATE INDEX IF NOT EXISTS idx_team_roles_team ON team_roles(club_id, team_id);

  -- Svar på kallelser: en rad per person och aktivitet.
  CREATE TABLE IF NOT EXISTS rsvps (
    club_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    status TEXT NOT NULL,
    comment TEXT,
    updated_at INTEGER NOT NULL,
    updated_by TEXT,
    PRIMARY KEY (club_id, team_id, session_id, member_id)
  );
`;

const USER_COLUMNS = [
  'username TEXT', 'has_logged_in INTEGER DEFAULT 0', 'temp_password TEXT', 'google_id TEXT',
  'google_email TEXT', 'avatar_url TEXT', "auth_provider TEXT DEFAULT 'local'",
];

function createSchema(db: Db) {
  db.exec(SCHEMA);
  for (const col of USER_COLUMNS) {
    try { db.exec(`ALTER TABLE users ADD COLUMN ${col};`); } catch (_) { /* finns redan */ }
  }
}

const TABLE_COLUMNS: Record<string, string[]> = {
  users: ['id', 'email', 'username', 'password_hash', 'created_at', 'has_logged_in', 'temp_password', 'google_id', 'google_email', 'avatar_url', 'auth_provider'],
  users_data: ['userId', 'segment', 'data', 'updatedAt'],
  shared_leaderboards: ['id', 'data', 'updatedAt', 'coachUid'],
  clubs_data: ['clubId', 'teamId', 'segment', 'data', 'updatedAt'],
  system_docs: ['path', 'data', 'updatedAt'],
  password_resets: ['id', 'email', 'code_hash', 'expires_at', 'attempts', 'used', 'created_at'],
  uploaded_files: ['filename', 'mime_type', 'data_base64', 'created_at'],
};

// Flyttar data från den gamla JSON-databasen till SQLite (en gång).
export function importJsonStore(db: Db, jsonPath: string): { imported: number } {
  const store = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  let imported = 0;
  db.transaction(() => {
    for (const [table, cols] of Object.entries(TABLE_COLUMNS)) {
      let rows = store[table] ? Object.values(store[table]) as any[] : [];
      // JSON-databasen saknade unikhetskontroll på e-post. Behåll det konto som använts
      // (inloggat) först; dubbletter hoppas över i stället för att skriva över.
      if (table === 'users') rows = rows.sort((x, y) => (Number(y?.has_logged_in) || 0) - (Number(x?.has_logged_in) || 0));
      const verb = table === 'users' ? 'INSERT OR IGNORE' : 'INSERT OR REPLACE';
      const stmt = db.prepare(`${verb} INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const values = cols.map((c) => {
          const v = row[c];
          if (v === undefined || v === null) {
            if (c === 'created_at' || c === 'updatedAt') return Date.now();
            if (c === 'attempts' || c === 'used' || c === 'has_logged_in') return 0;
            return null;
          }
          if (c === 'data' && typeof v !== 'string') return JSON.stringify(v);
          return v;
        });
        try {
          const r = stmt.run(...values);
          if (Number(r.changes) > 0) imported++;
          else console.warn(`[Databas] Hoppade över dubblett i ${table}: ${row.email || row.id || ''}`);
        } catch (e: any) {
          console.warn(`[Databas] Kunde inte flytta en rad i ${table}:`, e?.message || e);
        }
      }
    }
  })();
  return { imported };
}

export function openDatabase(opts: { dbPath: string; dataDir: string; require: RequireFn }): Db {
  const { dbPath, dataDir } = opts;
  const db = openRaw(dbPath, opts.require);
  createSchema(db);
  console.log(`[Databas] SQLite (${db.driver}) öppnad: ${dbPath}`);

  // Engångsflytt från JSON-nödlösningen
  const jsonPath = path.join(dataDir, 'coachassist_db.json');
  if (fs.existsSync(jsonPath)) {
    const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as any)?.n || 0;
    const docCount = (db.prepare('SELECT COUNT(*) AS n FROM clubs_data').get() as any)?.n || 0;
    if (userCount === 0 && docCount === 0) {
      const { imported } = importJsonStore(db, jsonPath);
      const archived = `${jsonPath}.flyttad-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      fs.renameSync(jsonPath, archived);
      console.log(`[Databas] Flyttade ${imported} rader från JSON-databasen till SQLite. Originalet sparat som ${path.basename(archived)}`);
    } else {
      console.warn('[Databas] coachassist_db.json finns men SQLite-databasen innehåller redan data; JSON-filen ignoreras.');
    }
  }
  return db;
}

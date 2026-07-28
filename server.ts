import express from 'express';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';

// Environment-safe way to define __dirname and __filename in both ESM (dev) and CJS (prod esbuild bundle)
const _filename = typeof import.meta !== 'undefined' && import.meta.url
  ? fileURLToPath(import.meta.url)
  : __filename;
const _dirname = typeof import.meta !== 'undefined' && import.meta.url
  ? path.dirname(_filename)
  : __dirname;

// Environment variables for persistence on cloud platforms
const isProduction = process.env.NODE_ENV === 'production' || _dirname.includes('dist') || _dirname.includes('\\dist');
const DATA_DIR = process.env.DATA_DIR || (isProduction ? path.join(_dirname, '..') : process.cwd());
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'coachassist.db');

// Ensure the local upload folder exists
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Initialize SQLite database
const db = new Database(DB_PATH);

// Create database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
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
    coachUid TEXT,
    FOREIGN KEY (coachUid) REFERENCES users(id) ON DELETE SET NULL
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
`);

const JWT_SECRET = process.env.JWT_SECRET || 'coachassist-local-secret-key-12345';

// --- FIRESTORE PERSISTENT BACKEND STORAGE (CLOUD RUN RESILIENCE) ---
let firebaseConfig: any = null;
try {
  const configPath = path.join(_dirname, 'firebase-applet-config.json');
  const altConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } else if (fs.existsSync(altConfigPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(altConfigPath, 'utf8'));
  }
} catch (e) {
  console.error('Could not load firebase-applet-config.json:', e);
}

const FIREBASE_API_KEY = firebaseConfig?.apiKey || '';

let dbModeConfig = {
  mode: process.env.DATABASE_MODE || 'hybrid', // 'hybrid' | 'local_sqlite' | 'firestore_only'
  customFirestoreProjectId: '',
  customFirestoreApiKey: '',
  customRemoteUrl: '',
  updatedAt: Date.now(),
  updatedBy: 'system'
};

// Load saved database configuration from system_docs table in SQLite
try {
  const savedRow: any = db.prepare("SELECT data FROM system_docs WHERE path = 'system/db_config'").get();
  if (savedRow) {
    const parsed = typeof savedRow.data === 'string' ? JSON.parse(savedRow.data) : savedRow.data;
    dbModeConfig = { ...dbModeConfig, ...parsed };
    console.log(`[DB Config] Initialized database mode: ${dbModeConfig.mode}`);
  }
} catch (e) {
  console.warn('[DB Config] Could not read system/db_config from SQLite:', e);
}

function getActiveFirestoreParams() {
  const projId = dbModeConfig.customFirestoreProjectId || firebaseConfig?.projectId;
  const apiKey = dbModeConfig.customFirestoreApiKey || FIREBASE_API_KEY;
  const dbId = firebaseConfig?.firestoreDatabaseId || '(default)';
  const baseUrl = projId ? `https://firestore.googleapis.com/v1/projects/${projId}/databases/${dbId}/documents` : null;
  return { baseUrl, apiKey, projId };
}

function toFirestoreFields(obj: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        fields[key] = { integerValue: val.toString() };
      } else {
        fields[key] = { doubleValue: val };
      }
    } else if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (typeof val === 'object') {
      fields[key] = { stringValue: JSON.stringify(val) };
    }
  }
  return fields;
}

function fromFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  if (!fields) return result;
  for (const [key, valObj] of Object.entries(fields)) {
    if ('stringValue' in valObj) {
      const str = valObj.stringValue;
      if ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
        try {
          result[key] = JSON.parse(str);
        } catch {
          result[key] = str;
        }
      } else {
        result[key] = str;
      }
    } else if ('integerValue' in valObj) {
      result[key] = parseInt(valObj.integerValue, 10);
    } else if ('doubleValue' in valObj) {
      result[key] = valObj.doubleValue;
    } else if ('booleanValue' in valObj) {
      result[key] = valObj.booleanValue;
    } else if ('nullValue' in valObj) {
      result[key] = null;
    } else if ('mapValue' in valObj) {
      result[key] = fromFirestoreFields(valObj.mapValue.fields || {});
    }
  }
  return result;
}

async function getFirestoreDoc(docPath: string): Promise<Record<string, any> | null> {
  if (dbModeConfig.mode === 'local_sqlite') {
    return null; // Standalone local SQLite mode: skip Firestore calls
  }
  const { baseUrl, apiKey } = getActiveFirestoreParams();
  if (!baseUrl || !apiKey) return null;
  try {
    const encodedPath = docPath.split('/').map(encodeURIComponent).join('/');
    const url = `${baseUrl}/${encodedPath}?key=${apiKey}`;
    const res = await axios.get(url, { validateStatus: s => s < 500, timeout: 5000 });
    if (res.status === 200 && res.data?.fields) {
      return fromFirestoreFields(res.data.fields);
    }
    return null;
  } catch (e: any) {
    console.error(`Firestore GET error for ${docPath}:`, e.message);
    return null;
  }
}

async function setFirestoreDoc(docPath: string, data: Record<string, any>): Promise<boolean> {
  if (dbModeConfig.mode === 'local_sqlite') {
    return true; // Standalone local SQLite mode: local write succeeded
  }
  const { baseUrl, apiKey } = getActiveFirestoreParams();
  if (!baseUrl || !apiKey) return false;
  try {
    const encodedPath = docPath.split('/').map(encodeURIComponent).join('/');
    const url = `${baseUrl}/${encodedPath}?key=${apiKey}`;
    const fields = toFirestoreFields(data);
    const res = await axios.patch(url, { fields }, {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: s => s < 500,
      timeout: 5000
    });
    return res.status === 200;
  } catch (e: any) {
    console.error(`Firestore PATCH error for ${docPath}:`, e.message);
    return false;
  }
}

// --- CUSTOM PWA ICONS MANAGEMENT ---
let customPwaIcons: {
  appName?: string;
  themeColor?: string;
  files: Record<string, string>;
} | null = null;

function applyCustomPwaIconsToDisk(iconsObj: { appName?: string; themeColor?: string; files: Record<string, string> }) {
  const publicDir = path.join(process.cwd(), 'public');
  const distDir = path.join(process.cwd(), 'dist');

  for (const [fileName, dataUrl] of Object.entries(iconsObj.files)) {
    if (!dataUrl) continue;
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    try {
      if (fs.existsSync(publicDir)) {
        fs.writeFileSync(path.join(publicDir, fileName), buffer);
      }
    } catch (e) {
      console.error(`Error saving ${fileName} to public:`, e);
    }

    try {
      if (fs.existsSync(distDir)) {
        fs.writeFileSync(path.join(distDir, fileName), buffer);
      }
    } catch (e) {}
  }

  if (iconsObj.appName || iconsObj.themeColor) {
    const manifestObj = {
      name: iconsObj.appName || 'CoachAssist',
      short_name: iconsObj.appName || 'CoachAssist',
      description: `${iconsObj.appName || 'CoachAssist'} PWA App`,
      start_url: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: iconsObj.themeColor || '#4f46e5',
      theme_color: iconsObj.themeColor || '#4f46e5',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    };
    const manifestStr = JSON.stringify(manifestObj, null, 2);
    try {
      if (fs.existsSync(publicDir)) {
        fs.writeFileSync(path.join(publicDir, 'manifest.webmanifest'), manifestStr, 'utf-8');
      }
    } catch (e) {}
    try {
      if (fs.existsSync(distDir)) {
        fs.writeFileSync(path.join(distDir, 'manifest.webmanifest'), manifestStr, 'utf-8');
      }
    } catch (e) {}
  }
}

async function loadAndApplyPwaIconsFromFirestore() {
  try {
    const docData = await getFirestoreDoc('app_docs/system_pwa_icons');
    if (docData && docData.files) {
      const filesMap = typeof docData.files === 'string' ? JSON.parse(docData.files) : docData.files;
      customPwaIcons = {
        appName: docData.appName,
        themeColor: docData.themeColor,
        files: filesMap
      };
      applyCustomPwaIconsToDisk(customPwaIcons);
      console.log('[PWA Icons] Restored custom PWA icons from Firestore.');
    }
  } catch (err) {
    console.error('[PWA Icons] Error restoring PWA icons from Firestore:', err);
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Restore custom PWA icons from Firestore on startup
  loadAndApplyPwaIconsFromFirestore();

  // --- CUSTOM PWA ICONS SERVING MIDDLEWARE ---
  app.use((req, res, next) => {
    if (!customPwaIcons) return next();

    const reqPath = req.path.replace(/^\//, '');

    if (customPwaIcons.files && customPwaIcons.files[reqPath]) {
      const dataUrl = customPwaIcons.files[reqPath];
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(imgBuffer);
    }

    if (reqPath === 'manifest.webmanifest' && customPwaIcons.appName) {
      const manifestObj = {
        name: customPwaIcons.appName,
        short_name: customPwaIcons.appName,
        description: `${customPwaIcons.appName} PWA App`,
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: customPwaIcons.themeColor || '#4f46e5',
        theme_color: customPwaIcons.themeColor || '#4f46e5',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      };
      res.setHeader('Content-Type', 'application/manifest+json');
      return res.json(manifestObj);
    }

    next();
  });

  // Subpath and routing prefix middleware for hosting under custom folders (e.g., /coachassist/ or any other custom folder name)
  app.use((req, res, next) => {
    const url = req.url;
    const pathPart = url.split('?')[0];
    const segments = pathPart.split('/').filter(Boolean);

    // If there are no segments or the first segment is a known root-level route, bypass
    if (segments.length === 0 || ['api', 'assets', 'uploads', 'rebuild', 'favicon.ico'].includes(segments[0])) {
      return next();
    }

    const subfolder = segments[0];

    // 1. Handle missing trailing slash for the subfolder base (e.g. /my-subfolder -> /my-subfolder/)
    // This is crucial so that relative paths (base: "./") resolve relative to the subfolder rather than the domain root.
    if (segments.length === 1 && !pathPart.endsWith('/')) {
      const query = url.includes('?') ? '?' + url.split('?')[1] : '';
      console.log(`[Subfolder Redirect] Redirecting ${url} to /${subfolder}/${query}`);
      return res.redirect(301, `/${subfolder}/${query}`);
    }

    // 2. Rewrite req.url to strip the subfolder prefix (e.g. /my-subfolder/api/health -> /api/health)
    const match = url.match(/^\/([^\/]+)\/(api|assets|uploads|favicon\.ico|rebuild)(.*)$/);
    if (match) {
      req.url = '/' + match[2] + match[3];
      console.log(`[Subfolder Rewriter] Rewrote URL: ${url} -> ${req.url}`);
    } else {
      // Also rewrite root of subpath (e.g. /my-subfolder/ -> /)
      if (segments.length === 1) {
        req.url = '/' + (url.includes('?') ? '?' + url.split('?')[1] : '');
        console.log(`[Subfolder Rewriter] Rewrote root: ${url} -> ${req.url}`);
      }
    }
    next();
  });

  app.use(express.json());

  // Static serving of uploaded images
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', db: 'sqlite', mode: dbModeConfig.mode });
  });

  // --- SYSTEM DATABASE & ENVIRONMENT ENDPOINTS (ROOT ADMIN) ---

  // Get current DB Config and System Status
  app.get('/api/system/db-config', (_req, res) => {
    let dbSize = 0;
    try {
      if (fs.existsSync(DB_PATH)) {
        dbSize = fs.statSync(DB_PATH).size;
      }
    } catch {}

    const { baseUrl, projId } = getActiveFirestoreParams();
    const dbId = firebaseConfig?.firestoreDatabaseId || '(default)';
    const firestoreUrl = projId 
      ? (dbId && dbId !== '(default)'
          ? `https://console.firebase.google.com/project/${projId}/firestore/databases/${dbId}/data`
          : `https://console.firebase.google.com/project/${projId}/firestore/data`)
      : null;

    res.json({
      mode: dbModeConfig.mode,
      dbPath: DB_PATH,
      dbSize,
      isProduction,
      firestoreConfigured: !!baseUrl,
      firestoreProjectId: projId || null,
      firestoreDatabaseId: dbId,
      firestoreUrl,
      customFirestoreProjectId: dbModeConfig.customFirestoreProjectId || '',
      customFirestoreApiKey: dbModeConfig.customFirestoreApiKey || '',
      customRemoteUrl: dbModeConfig.customRemoteUrl || '',
      updatedAt: dbModeConfig.updatedAt,
      updatedBy: dbModeConfig.updatedBy
    });
  });

  // Update DB Config (Root Admin)
  app.post('/api/system/db-config', (req, res) => {
    const { mode, customFirestoreProjectId, customFirestoreApiKey, customRemoteUrl } = req.body;
    if (!mode || !['hybrid', 'local_sqlite', 'firestore_only'].includes(mode)) {
      return res.status(400).json({ error: 'Ogiltigt databasläge. Välj hybrid, local_sqlite eller firestore_only.' });
    }

    dbModeConfig.mode = mode;
    dbModeConfig.customFirestoreProjectId = (customFirestoreProjectId || '').trim();
    dbModeConfig.customFirestoreApiKey = (customFirestoreApiKey || '').trim();
    dbModeConfig.customRemoteUrl = (customRemoteUrl || '').trim();
    dbModeConfig.updatedAt = Date.now();
    dbModeConfig.updatedBy = 'root_admin';

    const serialized = JSON.stringify(dbModeConfig);

    try {
      db.prepare(`
        INSERT INTO system_docs (path, data, updatedAt)
        VALUES ('system/db_config', ?, ?)
        ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
      `).run(serialized, dbModeConfig.updatedAt);

      if (mode !== 'local_sqlite') {
        setFirestoreDoc('app_docs/system_db_config', { data: serialized, updatedAt: dbModeConfig.updatedAt })
          .catch(err => console.error('Error syncing system db config to firestore:', err));
      }

      console.log(`[DB Config] Updated database mode to: ${mode}`);
      res.json({ success: true, dbModeConfig });
    } catch (e: any) {
      console.error('[DB Config] Failed to save database configuration:', e);
      res.status(500).json({ error: 'Kunde inte spara databasinställningar' });
    }
  });

  // Export Database Dump as JSON
  app.get('/api/system/db-export', (_req, res) => {
    try {
      const users = db.prepare('SELECT id, email, created_at FROM users').all();
      const users_data = db.prepare('SELECT userId, segment, data, updatedAt FROM users_data').all();
      const clubs_data = db.prepare('SELECT clubId, teamId, segment, data, updatedAt FROM clubs_data').all();
      const shared_leaderboards = db.prepare('SELECT id, data, updatedAt, coachUid FROM shared_leaderboards').all();
      const system_docs = db.prepare('SELECT path, data, updatedAt FROM system_docs').all();

      const dump = {
        version: '1.0',
        exportedAt: Date.now(),
        dbMode: dbModeConfig.mode,
        tables: {
          users,
          users_data,
          clubs_data,
          shared_leaderboards,
          system_docs
        }
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="coachassist_backup_${new Date().toISOString().slice(0, 10)}.json"`);
      res.send(JSON.stringify(dump, null, 2));
    } catch (e: any) {
      console.error('Error exporting database dump:', e);
      res.status(500).json({ error: 'Kunde inte exportera databasen' });
    }
  });

  // Import Database Dump from JSON
  app.post('/api/system/db-import', (req, res) => {
    const dump = req.body;
    if (!dump || !dump.tables) {
      return res.status(400).json({ error: 'Ogiltigt säkerhetskopieformat' });
    }

    try {
      const { users = [], users_data = [], clubs_data = [], shared_leaderboards = [], system_docs = [] } = dump.tables;

      const transaction = db.transaction(() => {
        // Users
        const stmtUser = db.prepare(`
          INSERT INTO users (id, email, password_hash, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET email = excluded.email
        `);
        for (const u of users) {
          stmtUser.run(u.id, u.email, u.password_hash || 'imported_user', u.created_at || Date.now());
        }

        // Users data
        const stmtUserData = db.prepare(`
          INSERT INTO users_data (userId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `);
        for (const ud of users_data) {
          const rawData = typeof ud.data === 'string' ? ud.data : JSON.stringify(ud.data);
          stmtUserData.run(ud.userId, ud.segment, rawData, ud.updatedAt || Date.now());
        }

        // Clubs data
        const stmtClubData = db.prepare(`
          INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `);
        for (const cd of clubs_data) {
          const rawData = typeof cd.data === 'string' ? cd.data : JSON.stringify(cd.data);
          stmtClubData.run(cd.clubId, cd.teamId, cd.segment, rawData, cd.updatedAt || Date.now());
        }

        // Leaderboards
        const stmtLeaderboard = db.prepare(`
          INSERT INTO shared_leaderboards (id, data, updatedAt, coachUid)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `);
        for (const lb of shared_leaderboards) {
          const rawData = typeof lb.data === 'string' ? lb.data : JSON.stringify(lb.data);
          stmtLeaderboard.run(lb.id, rawData, lb.updatedAt || Date.now(), lb.coachUid || null);
        }

        // System docs
        const stmtSysDoc = db.prepare(`
          INSERT INTO system_docs (path, data, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `);
        for (const sd of system_docs) {
          const rawData = typeof sd.data === 'string' ? sd.data : JSON.stringify(sd.data);
          stmtSysDoc.run(sd.path, rawData, sd.updatedAt || Date.now());
        }
      });

      transaction();

      console.log('[DB Import] Successfully imported database dump.');
      res.json({ success: true, importedRecords: users.length + users_data.length + clubs_data.length });
    } catch (e: any) {
      console.error('[DB Import] Error importing database:', e);
      res.status(500).json({ error: 'Kunde inte importera databasen: ' + e.message });
    }
  });

  // Manual Sync between SQLite and Firestore
  app.post('/api/system/db-sync-now', async (_req, res) => {
    if (dbModeConfig.mode === 'local_sqlite') {
      return res.status(400).json({ error: 'Databasen är inställd på Fristående Lokal SQLite. Slå på Hybrid-läge först för att synka med molnet.' });
    }

    try {
      let syncedCount = 0;

      // Sync users_data
      const userRows: any[] = db.prepare('SELECT userId, segment, data, updatedAt FROM users_data').all();
      for (const row of userRows) {
        const docPath = `app_docs/users_${row.userId}_data_${row.segment}`;
        const rawData = typeof row.data === 'string' ? row.data : JSON.stringify(row.data);
        await setFirestoreDoc(docPath, { data: rawData, updatedAt: row.updatedAt });
        syncedCount++;
      }

      // Sync clubs_data
      const clubRows: any[] = db.prepare('SELECT clubId, teamId, segment, data, updatedAt FROM clubs_data').all();
      for (const row of clubRows) {
        const docPath = `app_docs/clubs_${row.clubId}_teams_${row.teamId}_data_${row.segment}`;
        const rawData = typeof row.data === 'string' ? row.data : JSON.stringify(row.data);
        await setFirestoreDoc(docPath, { data: rawData, updatedAt: row.updatedAt });
        syncedCount++;
      }

      res.json({ success: true, syncedCount, message: `Synkroniserade ${syncedCount} poster till Firestore.` });
    } catch (e: any) {
      console.error('Manual DB sync error:', e);
      res.status(500).json({ error: 'Synkroniseringen misslyckades: ' + e.message });
    }
  });

  // --- AUTHENTICATION ENDPOINTS ---

  // Register
  app.post('/api/auth/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'E-post och lösenord krävs' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    try {
      let existing = db.prepare('SELECT id FROM users WHERE email = ?').get(trimmedEmail);
      if (!existing) {
        const fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`);
        if (fUser && fUser.id) {
          existing = fUser;
        }
      }

      if (existing) {
        return res.status(400).json({ error: 'E-postadressen är redan registrerad' });
      }

      const userId = crypto.randomUUID();
      const passwordHash = await bcrypt.hash(password, 10);
      const createdAt = Date.now();

      db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
        userId,
        trimmedEmail,
        passwordHash,
        createdAt
      );

      // Asynchronously persist to Cloud Firestore for permanent storage across container restarts
      setFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`, {
        id: userId,
        email: trimmedEmail,
        password_hash: passwordHash,
        created_at: createdAt
      }).catch(e => console.error('Firestore user save error:', e));

      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`, {
        id: userId,
        email: trimmedEmail,
        password_hash: passwordHash,
        created_at: createdAt
      }).catch(e => console.error('Firestore user_id save error:', e));

      const token = jwt.sign({ id: userId, email: trimmedEmail }, JWT_SECRET, { expiresIn: '30d' });
      res.json({
        token,
        user: {
          uid: userId,
          email: trimmedEmail,
          displayName: trimmedEmail.split('@')[0],
          photoURL: null
        }
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Kunde inte skapa konto' });
    }
  });

  // Login
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'E-post och lösenord krävs' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    try {
      let userRow: any = db.prepare('SELECT * FROM users WHERE email = ?').get(trimmedEmail);

      // If user not found in local SQLite (e.g. fresh container restart), restore from Cloud Firestore
      if (!userRow) {
        const fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`);
        if (fUser && fUser.id && fUser.password_hash) {
          try {
            db.prepare('INSERT OR REPLACE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
              fUser.id,
              fUser.email || trimmedEmail,
              fUser.password_hash,
              fUser.created_at || Date.now()
            );
            userRow = {
              id: fUser.id,
              email: fUser.email || trimmedEmail,
              password_hash: fUser.password_hash,
              created_at: fUser.created_at || Date.now()
            };
          } catch (e) {
            console.error('Error caching Firestore user to SQLite:', e);
          }
        }
      }

      if (!userRow) {
        return res.status(400).json({ error: 'Fel e-post eller lösenord' });
      }

      const isValid = await bcrypt.compare(password, userRow.password_hash);
      if (!isValid) {
        return res.status(400).json({ error: 'Fel e-post eller lösenord' });
      }

      const token = jwt.sign({ id: userRow.id, email: userRow.email }, JWT_SECRET, { expiresIn: '30d' });
      res.json({
        token,
        user: {
          uid: userRow.id,
          email: userRow.email,
          displayName: userRow.email.split('@')[0],
          photoURL: null
        }
      });
    } catch (error: any) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Kunde inte logga in' });
    }
  });

  // Helper function to send email for password reset
  const sendVerificationEmail = async (email: string, code: string) => {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpFrom = process.env.SMTP_FROM || 'CoachAssist <no-reply@coachassist.app>';

    console.log(`[PASSWORD RESET CODE] Email: ${email} | Verification Code: ${code}`);

    if (smtpHost && smtpUser && smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass
          }
        });

        await transporter.sendMail({
          from: smtpFrom,
          to: email,
          subject: 'Återställ ditt lösenord - CoachAssist',
          html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e4e4e7; rounded: 12px;">
              <h2 style="color: #18181b; margin-bottom: 8px;">Återställning av lösenord</h2>
              <p style="color: #71717a; font-size: 14px;">Du har begärt att återställa lösenordet för ditt CoachAssist-konto.</p>
              <div style="background-color: #f4f4f5; padding: 16px; text-align: center; border-radius: 8px; margin: 24px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #4f46e5;">${code}</span>
              </div>
              <p style="color: #71717a; font-size: 13px;">Koden är giltig i <strong>15 minuter</strong>. Om du inte begärt återställningen kan du ignorera detta meddelande.</p>
            </div>
          `
        });
        return true;
      } catch (err) {
        console.error('Failed to send verification email via SMTP:', err);
      }
    }
    return false;
  };

  // Phase 1: Request password reset email code
  app.post('/api/auth/request-reset', async (req, res) => {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Ange en giltig e-postadress.' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    try {
      // Rate limiting check: max 3 requests per 10 minutes per email
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      const recentRequestsCount: any = db.prepare(
        'SELECT COUNT(*) as count FROM password_resets WHERE email = ? AND created_at > ?'
      ).get(trimmedEmail, tenMinutesAgo);

      if (recentRequestsCount && recentRequestsCount.count >= 5) {
        return res.status(429).json({
          error: 'För många återställningsförsök. Vänligen vänta 10 minuter innan du försöker igen.'
        });
      }

      // Defense against email enumeration: respond identically regardless of user existence
      const userRow: any = db.prepare('SELECT id FROM users WHERE email = ?').get(trimmedEmail);

      if (userRow) {
        // Generate cryptographically secure 6-digit code
        const codeNum = crypto.randomInt(100000, 999999);
        const code = codeNum.toString();
        const codeHash = await bcrypt.hash(code, 10);
        const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins expiry
        const id = crypto.randomUUID();

        // Invalidate any old unused codes for this email
        db.prepare('UPDATE password_resets SET used = 1 WHERE email = ? AND used = 0').run(trimmedEmail);

        // Store reset code
        db.prepare(
          'INSERT INTO password_resets (id, email, code_hash, expires_at, attempts, used, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)'
        ).run(id, trimmedEmail, codeHash, expiresAt, Date.now());

        // Send email
        await sendVerificationEmail(trimmedEmail, code);
      }

      // Return unified success message
      res.json({
        success: true,
        message: 'Om e-postadressen finns registrerad har vi skickat en 6-siffrig verifieringskod.'
      });
    } catch (error: any) {
      console.error('Request reset error:', error);
      res.status(500).json({ error: 'Kunde inte behandla begäran om återställning.' });
    }
  });

  // Phase 2: Verify code and update password
  app.post('/api/auth/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'E-postadress, verifieringskod och nytt lösenord krävs.' });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'Det nya lösenordet måste vara minst 6 tecken långt.' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const cleanCode = code.toString().trim();

    try {
      // Find latest active reset request for this email
      const resetRow: any = db.prepare(
        'SELECT * FROM password_resets WHERE email = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1'
      ).get(trimmedEmail, Date.now());

      if (!resetRow) {
        return res.status(400).json({
          error: 'Ingen giltig verifieringskod hittades eller koden har gått ut. Begär en ny kod.'
        });
      }

      if (resetRow.attempts >= 5) {
        return res.status(400).json({
          error: 'För många felaktiga försök för denna kod. Vänligen begär en ny verifieringskod.'
        });
      }

      // Verify code match
      const isCodeValid = await bcrypt.compare(cleanCode, resetRow.code_hash);

      if (!isCodeValid) {
        // Increment attempt counter
        db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(resetRow.id);
        const remaining = 4 - resetRow.attempts;
        return res.status(400).json({
          error: `Felaktig verifieringskod. Du har ${Math.max(0, remaining)} försök kvar.`
        });
      }

      // Verify user exists
      let userRow: any = db.prepare('SELECT id, email, created_at FROM users WHERE email = ?').get(trimmedEmail);
      if (!userRow) {
        const fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`);
        if (fUser && fUser.id) {
          userRow = fUser;
        }
      }

      if (!userRow) {
        return res.status(404).json({ error: 'Användarkontot kunde inte hittas.' });
      }

      // Mark code as used
      db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(resetRow.id);

      // Update password hash
      const newPasswordHash = await bcrypt.hash(newPassword, 10);
      db.prepare('INSERT OR REPLACE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
        userRow.id,
        trimmedEmail,
        newPasswordHash,
        userRow.created_at || Date.now()
      );

      // Asynchronously update Firestore password hash
      setFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`, {
        id: userRow.id,
        email: trimmedEmail,
        password_hash: newPasswordHash,
        created_at: userRow.created_at || Date.now()
      }).catch(e => console.error('Firestore reset password update error:', e));

      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userRow.id)}`, {
        id: userRow.id,
        email: trimmedEmail,
        password_hash: newPasswordHash,
        created_at: userRow.created_at || Date.now()
      }).catch(e => console.error('Firestore reset password update error:', e));

      // Issue fresh authentication JWT token
      const token = jwt.sign({ id: userRow.id, email: userRow.email }, JWT_SECRET, { expiresIn: '30d' });

      res.json({
        message: 'Lösenordet har återställts!',
        token,
        user: {
          uid: userRow.id,
          email: userRow.email,
          displayName: userRow.email.split('@')[0],
          photoURL: null
        }
      });
    } catch (error: any) {
      console.error('Reset password error:', error);
      res.status(500).json({ error: 'Kunde inte återställa lösenordet.' });
    }
  });

  // Get Me (Current Session Info)
  app.get('/api/auth/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(' ');
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

      const decoded: any = jwt.verify(token, JWT_SECRET);
      let userRow: any = db.prepare('SELECT id, email FROM users WHERE id = ?').get(decoded.id);

      if (!userRow) {
        // Attempt restore from Firestore
        const fUser = (await getFirestoreDoc(`server_user_ids/${encodeURIComponent(decoded.id)}`)) ||
                      (decoded.email ? await getFirestoreDoc(`server_users/${encodeURIComponent(decoded.email)}`) : null);
        
        const userEmail = fUser?.email || decoded.email || 'user@coachassist.app';
        const passwordHash = fUser?.password_hash || 'restored_session';
        const createdAt = fUser?.created_at || Date.now();

        try {
          db.prepare('INSERT OR REPLACE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
            decoded.id,
            userEmail,
            passwordHash,
            createdAt
          );
          userRow = { id: decoded.id, email: userEmail };
        } catch (e) {
          console.error('Error auto-restoring user in SQLite:', e);
        }
      }

      if (!userRow) {
        return res.status(404).json({ error: 'Användaren hittades inte' });
      }

      res.json({
        uid: userRow.id,
        email: userRow.email,
        displayName: userRow.email.split('@')[0],
        photoURL: null
      });
    } catch (err) {
      res.status(401).json({ error: 'Token är ogiltig eller har gått ut' });
    }
  });

  // --- DOCUMENTS SYNC ENDPOINTS (Firestore simulation) ---

  // GET Document Data
  app.get('/api/docs', async (req, res) => {
    const pathStr = req.query.path as string;
    if (!pathStr) return res.status(400).send('Path is required');

    if (pathStr.startsWith('shared_leaderboards/')) {
      const id = pathStr.split('/')[1];
      try {
        let row: any = db.prepare('SELECT data FROM shared_leaderboards WHERE id = ?').get(id);
        if (!row) {
          const fDoc = await getFirestoreDoc(`app_docs/shared_leaderboards_${id}`);
          if (fDoc && fDoc.data) {
            const rawData = typeof fDoc.data === 'string' ? fDoc.data : JSON.stringify(fDoc.data);
            db.prepare('INSERT OR REPLACE INTO shared_leaderboards (id, data, updatedAt, coachUid) VALUES (?, ?, ?, ?)').run(
              id, rawData, Date.now(), fDoc.coachUid || null
            );
            return res.json(typeof fDoc.data === 'string' ? JSON.parse(fDoc.data) : fDoc.data);
          }
          return res.status(404).json({ error: 'Not found' });
        }
        res.json(JSON.parse(row.data));
      } catch (e: any) {
        console.error('Error fetching shared leaderboard:', e);
        res.status(500).json({ error: 'Failed to fetch shared leaderboard' });
      }
    } else if (pathStr.startsWith('users/')) {
      const parts = pathStr.split('/');
      const userId = parts[1];
      const segment = parts[3];

      if (userId !== 'guest') {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

        try {
          const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
          const partsAuth = authStr.split(' ');
          const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

          const decoded: any = jwt.verify(token, JWT_SECRET);
          if (decoded.id !== userId && decoded.email !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
          }
        } catch (e: any) {
          console.error('Error verifying token for user data:', e);
          return res.status(401).json({ error: 'Invalid session or token' });
        }
      }

      let row: any = db.prepare('SELECT data FROM users_data WHERE userId = ? AND segment = ?').get(userId, segment);
      if (!row) {
        const fDoc = await getFirestoreDoc(`app_docs/users_${userId}_data_${segment}`);
        if (fDoc && fDoc.data) {
          const rawData = typeof fDoc.data === 'string' ? fDoc.data : JSON.stringify(fDoc.data);
          db.prepare(`
            INSERT INTO users_data (userId, segment, data, updatedAt)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
          `).run(userId, segment, rawData, Date.now());
          return res.json(typeof fDoc.data === 'string' ? JSON.parse(fDoc.data) : fDoc.data);
        }
        return res.status(404).json({ error: 'Not found' });
      }
      res.json(JSON.parse(row.data));
    } else if (pathStr.startsWith('clubs/')) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

      try {
        const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const partsAuth = authStr.split(' ');
        const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

        jwt.verify(token, JWT_SECRET);
        const parts = pathStr.split('/');
        const clubId = parts[1];
        const teamId = parts[3] || 'club_global';
        const segment = parts[5] || parts[3] || 'data';

        let row: any = db.prepare('SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = ?').get(clubId, teamId, segment);
        if (!row) {
          const fDoc = await getFirestoreDoc(`app_docs/clubs_${clubId}_${teamId}_${segment}`);
          if (fDoc && fDoc.data) {
            const rawData = typeof fDoc.data === 'string' ? fDoc.data : JSON.stringify(fDoc.data);
            db.prepare(`
              INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
            `).run(clubId, teamId, segment, rawData, Date.now());
            return res.json(typeof fDoc.data === 'string' ? JSON.parse(fDoc.data) : fDoc.data);
          }
          return res.status(404).json({ error: 'Not found' });
        }
        res.json(JSON.parse(row.data));
      } catch (e: any) {
        console.error('Error fetching club data:', e);
        res.status(500).json({ error: 'Failed to fetch club data' });
      }
    } else if (pathStr.startsWith('admins/')) {
      try {
        let row: any = db.prepare('SELECT data FROM system_docs WHERE path = ?').get(pathStr);
        if (!row) {
          const fDoc = await getFirestoreDoc(`app_docs/admins_${encodeURIComponent(pathStr)}`);
          if (fDoc && fDoc.data) {
            const rawData = typeof fDoc.data === 'string' ? fDoc.data : JSON.stringify(fDoc.data);
            db.prepare('INSERT OR REPLACE INTO system_docs (path, data, updatedAt) VALUES (?, ?, ?)').run(pathStr, rawData, Date.now());
            return res.json(typeof fDoc.data === 'string' ? JSON.parse(fDoc.data) : fDoc.data);
          }
          return res.status(404).json({ error: 'Not found' });
        }
        res.json(JSON.parse(row.data));
      } catch (e: any) {
        console.error('Error fetching admin doc:', e);
        res.status(500).json({ error: 'Failed to fetch admin doc' });
      }
    } else {
      res.status(400).json({ error: 'Invalid path' });
    }
  });

  // POST/PUT Document Data
  app.post('/api/docs', (req, res) => {
    const pathStr = req.query.path as string;
    const { data } = req.body;
    if (!pathStr) return res.status(400).send('Path is required');

    if (pathStr.startsWith('shared_leaderboards/')) {
      const id = pathStr.split('/')[1];
      try {
        const serializedData = JSON.stringify(data);
        const coachUid = data.coachUid || null;
        
        db.prepare(`
          INSERT INTO shared_leaderboards (id, data, updatedAt, coachUid)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt, coachUid = excluded.coachUid
        `).run(id, serializedData, Date.now(), coachUid);

        setFirestoreDoc(`app_docs/shared_leaderboards_${id}`, { data: serializedData, coachUid, updatedAt: Date.now() })
          .catch(e => console.error('Firestore shared leaderboard sync error:', e));

        res.json({ success: true });
      } catch (e: any) {
        console.error('Error saving shared leaderboard:', e);
        res.status(500).json({ error: 'Failed to save shared leaderboard' });
      }
    } else if (pathStr.startsWith('users/')) {
      try {
        const parts = pathStr.split('/');
        const userId = parts[1];
        const segment = parts[3];

        if (userId !== 'guest') {
          const authHeader = req.headers.authorization;
          if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

          try {
            const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
            const partsAuth = authStr.split(' ');
            const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

            const decoded: any = jwt.verify(token, JWT_SECRET);
            if (decoded.id !== userId && decoded.email !== userId) {
              return res.status(403).json({ error: 'Forbidden' });
            }
          } catch (e: any) {
            console.error('Error verifying token for saving user data:', e);
            return res.status(401).json({ error: 'Invalid session or token' });
          }
        }

        const serializedData = JSON.stringify(data);
        db.prepare(`
          INSERT INTO users_data (userId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(userId, segment, serializedData, Date.now());

        setFirestoreDoc(`app_docs/users_${userId}_data_${segment}`, { data: serializedData, updatedAt: Date.now() })
          .catch(e => console.error('Firestore user data sync error:', e));

        res.json({ success: true });
      } catch (e: any) {
        console.error('Error saving user data:', e);
        res.status(500).json({ error: 'Failed to save user data' });
      }
    } else if (pathStr.startsWith('clubs/')) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

      try {
        const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const partsAuth = authStr.split(' ');
        const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

        jwt.verify(token, JWT_SECRET);
        const parts = pathStr.split('/');
        const clubId = parts[1];
        const teamId = parts[3] || 'club_global';
        const segment = parts[5] || parts[3] || 'data';

        const serializedData = JSON.stringify(data);
        db.prepare(`
          INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(clubId, teamId, segment, serializedData, Date.now());

        setFirestoreDoc(`app_docs/clubs_${clubId}_${teamId}_${segment}`, { data: serializedData, updatedAt: Date.now() })
          .catch(e => console.error('Firestore club data sync error:', e));

        res.json({ success: true });
      } catch (e: any) {
        console.error('Error saving club data:', e);
        res.status(500).json({ error: 'Failed to save club data' });
      }
    } else if (pathStr.startsWith('admins/')) {
      try {
        const serializedData = JSON.stringify(data);
        db.prepare(`
          INSERT INTO system_docs (path, data, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(pathStr, serializedData, Date.now());

        setFirestoreDoc(`app_docs/admins_${encodeURIComponent(pathStr)}`, { data: serializedData, updatedAt: Date.now() })
          .catch(e => console.error('Firestore admin doc sync error:', e));

        res.json({ success: true });
      } catch (e: any) {
        console.error('Error saving admin doc:', e);
        res.status(500).json({ error: 'Failed to save admin doc' });
      }
    } else {
      res.status(400).json({ error: 'Invalid path' });
    }
  });

  // --- LOCAL FILE STORAGE ENDPOINTS ---

  // Configure Multer for local uploads with randomized safe names
  const storageConfig = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'photo_' + uniqueSuffix + ext);
    }
  });
  const upload = multer({ storage: storageConfig });

  // Upload image
  app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ url: fileUrl });
  });

  // Delete image
  app.delete('/api/delete-file', (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).send('Path is required');

    try {
      const filename = path.basename(filePath);
      const fullPath = path.join(UPLOADS_DIR, filename);

      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'File not found' });
      }
    } catch (e: any) {
      console.error('Error deleting file:', e);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

  // --- PWA ICONS DIRECT APPLICATION ENDPOINT ---
  app.post('/api/pwa-icons', express.json({ limit: '15mb' }), async (req, res) => {
    try {
      const { appName, themeColor, icons } = req.body;
      if (!icons || !Array.isArray(icons)) {
        return res.status(400).json({ error: 'Inga ikoner skickades med' });
      }

      const filesMap: Record<string, string> = {};
      for (const item of icons) {
        if (item.fileName && item.dataUrl) {
          filesMap[item.fileName] = item.dataUrl;

          // Map aliases
          if (item.fileName === 'icon-192x192.png') {
            filesMap['icon-192.png'] = item.dataUrl;
          }
          if (item.fileName === 'icon-512x512.png') {
            filesMap['icon-512.png'] = item.dataUrl;
          }
          if (item.fileName === 'apple-touch-icon.png') {
            filesMap['apple-touch-icon-precomposed.png'] = item.dataUrl;
          }
          if (item.fileName === 'favicon-48x48.png' || item.fileName === 'favicon-32x32.png') {
            filesMap['favicon.png'] = item.dataUrl;
          }
        }
      }

      customPwaIcons = {
        appName: appName || 'CoachAssist',
        themeColor: themeColor || '#4f46e5',
        files: filesMap
      };

      // Apply to disk
      applyCustomPwaIconsToDisk(customPwaIcons);

      // Persist to Firestore so it persists across restarts
      await setFirestoreDoc('app_docs/system_pwa_icons', {
        appName: customPwaIcons.appName,
        themeColor: customPwaIcons.themeColor,
        files: JSON.stringify(filesMap),
        updatedAt: Date.now()
      });

      res.json({
        success: true,
        message: 'Appens PWA-ikoner har uppdaterats och verkställts i appen!'
      });
    } catch (err: any) {
      console.error('[PWA Icons] Error saving custom PWA icons:', err);
      res.status(500).json({ error: 'Kunde inte spara PWA-ikonerna: ' + err.message });
    }
  });

  app.get('/api/pwa-icons', (_req, res) => {
    if (customPwaIcons) {
      res.json({
        appName: customPwaIcons.appName,
        themeColor: customPwaIcons.themeColor,
        hasCustomIcons: true
      });
    } else {
      res.json({ hasCustomIcons: false });
    }
  });

  // --- PRE-EXISTING PROXY ENDPOINTS ---

  // Proxy endpoint to bypass CORS for image exports
  app.get('/api/proxy', async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).send('URL query parameter is required');
    }

    try {
      console.log(`[Proxy] Fetching: ${url}`);
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      res.setHeader('Content-Type', String(response.headers['content-type'] || 'image/jpeg'));
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      
      response.data.pipe(res);
    } catch (error: any) {
      console.error(`[Proxy] Error fetching ${url}:`, error.message);
      res.status(500).send(`Failed to fetch image: ${error.message}`);
    }
  });

  // Calendar proxy endpoint to fetch webcal ICS files
  app.get('/api/fetch-calendar', async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL query parameter is required' });
    }

    let fetchUrl = url.trim();
    if (fetchUrl.startsWith('webcal://')) {
      fetchUrl = 'https://' + fetchUrl.slice(9);
    } else if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
      fetchUrl = 'https://' + fetchUrl;
    }

    try {
      console.log(`[Calendar Proxy] Fetching: ${fetchUrl}`);
      const response = await axios({
        method: 'get',
        url: fetchUrl,
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(response.data);
    } catch (error: any) {
      console.error(`[Calendar Proxy] Error fetching ${fetchUrl}:`, error.message);
      res.status(500).json({ error: `Failed to fetch calendar: ${error.message}` });
    }
  });

  // --- VITE AND SPA SERVING ---

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = _dirname;
    // Serve assets with absolute precision to prevent any rewrite or subfolder routing issues
    app.use('/assets', express.static(path.join(distPath, 'assets')));
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (typeof PORT === 'string' && isNaN(Number(PORT))) {
    app.listen(PORT, () => {
      console.log(`Server running on Unix socket/pipe: ${PORT}`);
    });
  } else {
    app.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

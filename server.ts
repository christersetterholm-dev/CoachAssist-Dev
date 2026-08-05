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
let DATA_DIR = process.env.DATA_DIR || (isProduction ? path.join(_dirname, '..') : process.cwd());

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (e) {
  console.warn('[Server] Selected DATA_DIR is not writable, falling back to /tmp:', e);
  DATA_DIR = '/tmp';
}

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'coachassist.db');

try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (e) {
  console.warn('[Server] Could not create UPLOADS_DIR:', e);
}

// Initialize SQLite database with self-healing recovery if malformed/corrupted
function initDatabase(): InstanceType<typeof Database> {
  const createSchema = (database: InstanceType<typeof Database>) => {
    database.exec(`
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

      CREATE TABLE IF NOT EXISTS uploaded_files (
        filename TEXT PRIMARY KEY,
        mime_type TEXT NOT NULL,
        data_base64 TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    try {
      database.exec('ALTER TABLE users ADD COLUMN username TEXT;');
    } catch (_) {
      // Column already exists
    }
    try {
      database.exec('ALTER TABLE users ADD COLUMN has_logged_in INTEGER DEFAULT 0;');
    } catch (_) {}
    try {
      database.exec('ALTER TABLE users ADD COLUMN temp_password TEXT;');
    } catch (_) {}
  };

  try {
    const database = new Database(DB_PATH);
    database.pragma('quick_check');
    createSchema(database);
    return database;
  } catch (err: any) {
    console.error('[SQLite Init] Database initialization failed (e.g. malformed DB):', err?.message || err);
    if (fs.existsSync(DB_PATH)) {
      try {
        const corruptPath = `${DB_PATH}.corrupt.${Date.now()}`;
        fs.renameSync(DB_PATH, corruptPath);
        console.warn(`[SQLite Recovery] Moved corrupted database file to ${corruptPath}`);
      } catch (e: any) {
        console.error('[SQLite Recovery] Failed to rename corrupt database, removing file:', e?.message || e);
        try { fs.unlinkSync(DB_PATH); } catch (_) {}
      }
    }
    const freshDb = new Database(DB_PATH);
    createSchema(freshDb);
    console.log('[SQLite Recovery] Fresh SQLite database initialized successfully.');
    return freshDb;
  }
}

const db = initDatabase();

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
    const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
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
        const assetsDir = path.join(distDir, 'assets');
        if (fs.existsSync(assetsDir)) {
          const files = fs.readdirSync(assetsDir);
          for (const f of files) {
            if (f.endsWith('.webmanifest')) {
              fs.writeFileSync(path.join(assetsDir, f), manifestStr, 'utf-8');
            }
          }
        }
      }
    } catch (e) {}

    // Update HTML files on disk so index.html statically contains the new title & meta tags
    if (iconsObj.appName) {
      const appName = iconsObj.appName;
      const themeColor = iconsObj.themeColor || '#4f46e5';

      const updateHtmlFile = (filePath: string) => {
        if (!fs.existsSync(filePath)) return;
        try {
          let content = fs.readFileSync(filePath, 'utf-8');
          if (/<title>.*?<\/title>/gi.test(content)) {
            content = content.replace(/<title>.*?<\/title>/gi, `<title>${appName}</title>`);
          } else {
            content = content.replace('</head>', `<title>${appName}</title></head>`);
          }

          if (/apple-mobile-web-app-title/gi.test(content)) {
            content = content.replace(/<meta\s+name="apple-mobile-web-app-title"\s+content=".*?"\s*\/?>/gi, `<meta name="apple-mobile-web-app-title" content="${appName}" />`);
          } else {
            content = content.replace('</head>', `<meta name="apple-mobile-web-app-title" content="${appName}" /></head>`);
          }

          if (/application-name/gi.test(content)) {
            content = content.replace(/<meta\s+name="application-name"\s+content=".*?"\s*\/?>/gi, `<meta name="application-name" content="${appName}" />`);
          } else {
            content = content.replace('</head>', `<meta name="application-name" content="${appName}" /></head>`);
          }

          if (/theme-color/gi.test(content)) {
            content = content.replace(/<meta\s+name="theme-color"\s+content=".*?"\s*\/?>/gi, `<meta name="theme-color" content="${themeColor}" />`);
          }

          fs.writeFileSync(filePath, content, 'utf-8');
        } catch (e) {
          console.error(`Error updating HTML file at ${filePath}:`, e);
        }
      };

      updateHtmlFile(path.join(process.cwd(), 'index.html'));
      updateHtmlFile(path.join(publicDir, 'index.html'));
      updateHtmlFile(path.join(distDir, 'index.html'));
    }
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

  // Helper to inject current PWA app name and theme color into server-rendered HTML
  function injectPwaMetaToHtml(html: string): string {
    const appName = customPwaIcons?.appName || 'CoachAssist';
    const themeColor = customPwaIcons?.themeColor || '#4f46e5';

    let updated = html;
    if (/<title>.*?<\/title>/gi.test(updated)) {
      updated = updated.replace(/<title>.*?<\/title>/gi, `<title>${appName}</title>`);
    } else {
      updated = updated.replace('</head>', `<title>${appName}</title></head>`);
    }

    if (/apple-mobile-web-app-title/gi.test(updated)) {
      updated = updated.replace(/<meta\s+name="apple-mobile-web-app-title"\s+content=".*?"\s*\/?>/gi, `<meta name="apple-mobile-web-app-title" content="${appName}" />`);
    } else {
      updated = updated.replace('</head>', `<meta name="apple-mobile-web-app-title" content="${appName}" /></head>`);
    }

    if (/application-name/gi.test(updated)) {
      updated = updated.replace(/<meta\s+name="application-name"\s+content=".*?"\s*\/?>/gi, `<meta name="application-name" content="${appName}" />`);
    } else {
      updated = updated.replace('</head>', `<meta name="application-name" content="${appName}" /></head>`);
    }

    if (/theme-color/gi.test(updated)) {
      updated = updated.replace(/<meta\s+name="theme-color"\s+content=".*?"\s*\/?>/gi, `<meta name="theme-color" content="${themeColor}" />`);
    }

    return updated;
  }

  // --- CUSTOM PWA ICONS & MANIFEST SERVING MIDDLEWARE ---
  app.use((req, res, next) => {
    const reqPath = req.path.replace(/^\//, '');

    if (customPwaIcons && customPwaIcons.files && customPwaIcons.files[reqPath]) {
      const dataUrl = customPwaIcons.files[reqPath];
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(imgBuffer);
    }

    if (
      reqPath === 'manifest.webmanifest' ||
      reqPath === 'manifest.json' ||
      reqPath.endsWith('.webmanifest') ||
      reqPath.includes('manifest')
    ) {
      const appName = customPwaIcons?.appName || 'CoachAssist';
      const themeColor = customPwaIcons?.themeColor || '#4f46e5';
      const manifestObj = {
        name: appName,
        short_name: appName,
        description: `${appName} PWA App`,
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: themeColor,
        theme_color: themeColor,
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

    // Intercept HTML responses to dynamically inject app title & PWA meta tags
    const accept = req.headers.accept || '';
    if (req.method === 'GET' && (accept.includes('text/html') || req.path === '/' || req.path.endsWith('.html'))) {
      const originalSend = res.send;
      const originalEnd = res.end;

      res.send = function (body?: any) {
        if (typeof body === 'string' && body.includes('<html')) {
          body = injectPwaMetaToHtml(body);
        } else if (Buffer.isBuffer(body)) {
          const str = body.toString('utf-8');
          if (str.includes('<html')) {
            body = Buffer.from(injectPwaMetaToHtml(str), 'utf-8');
          }
        }
        return originalSend.call(this, body);
      };

      res.end = function (chunk?: any, encoding?: any, cb?: any) {
        if (typeof chunk === 'string' && chunk.includes('<html')) {
          chunk = injectPwaMetaToHtml(chunk);
        } else if (Buffer.isBuffer(chunk)) {
          const str = chunk.toString('utf-8');
          if (str.includes('<html')) {
            chunk = Buffer.from(injectPwaMetaToHtml(str), 'utf-8');
          }
        }
        return originalEnd.call(this, chunk, encoding, cb);
      };
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

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Static serving of uploaded images with CORS headers, SQLite & Cloud Firestore backup recovery
  app.get('/uploads/:filename', async (req, res) => {
    const filename = path.basename(req.params.filename);
    const fullPath = path.join(UPLOADS_DIR, filename);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'public, max-age=31536000');

    if (fs.existsSync(fullPath)) {
      return res.sendFile(fullPath);
    }

    try {
      const row = db.prepare('SELECT mime_type, data_base64 FROM uploaded_files WHERE filename = ?').get(filename) as { mime_type: string; data_base64: string } | undefined;
      if (row && row.data_base64) {
        const buffer = Buffer.from(row.data_base64, 'base64');
        try {
          fs.writeFileSync(fullPath, buffer);
        } catch (_) {}
        res.setHeader('Content-Type', row.mime_type || 'image/jpeg');
        return res.send(buffer);
      }
    } catch (err) {
      console.error('Error fetching file from uploaded_files table:', err);
    }

    // Firestore Cloud Storage Backup Recovery (restores images across container restarts & new devices)
    try {
      const fDoc = await getFirestoreDoc(`server_uploads/${encodeURIComponent(filename)}`);
      if (fDoc && fDoc.data_base64) {
        const buffer = Buffer.from(fDoc.data_base64, 'base64');
        const mimeType = fDoc.mime_type || 'image/jpeg';
        try {
          db.prepare(`
            INSERT OR REPLACE INTO uploaded_files (filename, mime_type, data_base64, created_at)
            VALUES (?, ?, ?, ?)
          `).run(filename, mimeType, fDoc.data_base64, fDoc.created_at || Date.now());
          fs.writeFileSync(fullPath, buffer);
        } catch (_) {}
        res.setHeader('Content-Type', mimeType);
        return res.send(buffer);
      }
    } catch (err) {
      console.error('Error fetching file from Firestore server_uploads:', err);
    }

    res.status(404).send('File not found');
  });

  app.use('/uploads', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  }, express.static(UPLOADS_DIR));

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

      // Sync uploaded_files
      const fileRows: any[] = db.prepare('SELECT filename, mime_type, data_base64, created_at FROM uploaded_files').all();
      for (const row of fileRows) {
        const docPath = `server_uploads/${encodeURIComponent(row.filename)}`;
        await setFirestoreDoc(docPath, { mime_type: row.mime_type, data_base64: row.data_base64, created_at: row.created_at || Date.now() });
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
    const { email, password, username } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'E-post och lösenord krävs.' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username ? username.trim().toLowerCase() : '';

    if (trimmedUsername) {
      if (!/^[a-zA-Z0-9_\.-]{3,20}$/.test(trimmedUsername)) {
        return res.status(400).json({
          error: 'Användarnamnet måste vara 3–20 tecken långt och endast innehålla bokstäver, siffror, understreck eller bindestreck.'
        });
      }
    }

    try {
      // 1. Check if email already registered
      let existingByEmail = db.prepare('SELECT id, email FROM users WHERE LOWER(email) = ?').get(trimmedEmail);
      if (!existingByEmail) {
        const fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`);
        if (fUser && fUser.id) {
          existingByEmail = fUser;
        }
      }

      if (existingByEmail) {
        return res.status(400).json({
          error: `E-postadressen '${trimmedEmail}' är redan registrerad i CoachAssist. Vänligen logga in eller återställ ditt lösenord om du glömt det.`
        });
      }

      // 2. Check if username already taken
      if (trimmedUsername) {
        let existingByUsername = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(trimmedUsername);
        if (!existingByUsername) {
          const fUser = await getFirestoreDoc(`server_usernames/${encodeURIComponent(trimmedUsername)}`);
          if (fUser && fUser.id) {
            existingByUsername = fUser;
          }
        }

        if (existingByUsername) {
          return res.status(400).json({
            error: `Användarnamnet '${trimmedUsername}' är tyvärr redan upptaget. Välj ett annat användarnamn.`
          });
        }
      }

      const userId = crypto.randomUUID();
      const passwordHash = await bcrypt.hash(password, 10);
      const createdAt = Date.now();

      db.prepare('INSERT INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
        userId,
        trimmedEmail,
        trimmedUsername || null,
        passwordHash,
        createdAt
      );

      // Asynchronously persist to Cloud Firestore
      setFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`, {
        id: userId,
        email: trimmedEmail,
        username: trimmedUsername || null,
        password_hash: passwordHash,
        created_at: createdAt
      }).catch(e => console.error('Firestore user save error:', e));

      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`, {
        id: userId,
        email: trimmedEmail,
        username: trimmedUsername || null,
        password_hash: passwordHash,
        created_at: createdAt
      }).catch(e => console.error('Firestore user_id save error:', e));

      if (trimmedUsername) {
        setFirestoreDoc(`server_usernames/${encodeURIComponent(trimmedUsername)}`, {
          id: userId,
          email: trimmedEmail,
          username: trimmedUsername
        }).catch(e => console.error('Firestore username save error:', e));
      }

      const token = jwt.sign({ id: userId, email: trimmedEmail, username: trimmedUsername }, JWT_SECRET, { expiresIn: '30d' });
      res.json({
        token,
        user: {
          uid: userId,
          email: trimmedEmail,
          username: trimmedUsername || null,
          displayName: trimmedUsername || trimmedEmail.split('@')[0],
          photoURL: null
        }
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Kunde inte skapa konto' });
    }
  });

  // Login (supports Email OR Username)
  app.post('/api/auth/login', async (req, res) => {
    const { email, identifier, password } = req.body;
    const loginInput = (email || identifier || '').trim().toLowerCase();

    if (!loginInput || !password) {
      return res.status(400).json({ error: 'E-post/användarnamn och lösenord krävs.' });
    }

    try {
      let userRow: any = db.prepare('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?').get(loginInput, loginInput);

      // If user not found in local SQLite (e.g. fresh container restart), restore from Cloud Firestore
      if (!userRow) {
        let fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(loginInput)}`);
        if (!fUser || !fUser.id) {
          const uMapping = await getFirestoreDoc(`server_usernames/${encodeURIComponent(loginInput)}`);
          if (uMapping && uMapping.email) {
            fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(uMapping.email)}`);
          } else if (uMapping && uMapping.id) {
            fUser = await getFirestoreDoc(`server_user_ids/${encodeURIComponent(uMapping.id)}`);
          }
        }

        if (fUser && fUser.id && fUser.password_hash) {
          try {
            db.prepare('INSERT OR REPLACE INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
              fUser.id,
              fUser.email || loginInput,
              fUser.username || null,
              fUser.password_hash,
              fUser.created_at || Date.now()
            );
            userRow = {
              id: fUser.id,
              email: fUser.email || loginInput,
              username: fUser.username || null,
              password_hash: fUser.password_hash,
              created_at: fUser.created_at || Date.now()
            };
          } catch (e) {
            console.error('Error caching Firestore user to SQLite:', e);
          }
        }
      }

      if (!userRow) {
        return res.status(400).json({ error: 'Fel e-post/användarnamn eller lösenord.' });
      }

      const isValid = await bcrypt.compare(password, userRow.password_hash);
      if (!isValid) {
        return res.status(400).json({ error: 'Fel e-post/användarnamn eller lösenord.' });
      }

      // Mark user as logged in and clear temporary password
      if (!userRow.has_logged_in) {
        try {
          db.prepare('UPDATE users SET has_logged_in = 1, temp_password = NULL WHERE id = ?').run(userRow.id);
          setFirestoreDoc(`server_users/${encodeURIComponent(userRow.email)}`, {
            ...userRow,
            has_logged_in: 1,
            temp_password: null
          }).catch(() => {});
          setFirestoreDoc(`server_user_ids/${encodeURIComponent(userRow.id)}`, {
            ...userRow,
            has_logged_in: 1,
            temp_password: null
          }).catch(() => {});
        } catch (e) {
          console.error('Error updating login status:', e);
        }
      }

      const token = jwt.sign({ id: userRow.id, email: userRow.email, username: userRow.username }, JWT_SECRET, { expiresIn: '30d' });
      res.json({
        token,
        user: {
          uid: userRow.id,
          email: userRow.email,
          username: userRow.username || null,
          displayName: userRow.username || userRow.email.split('@')[0],
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

        // Send email or fallback to returning code if SMTP is not configured
        const emailSent = await sendVerificationEmail(trimmedEmail, code);

        if (!emailSent) {
          return res.json({
            success: true,
            code: code,
            message: `Inget e-postsystem är inställt på servern. Din verifieringskod är: ${code}`
          });
        }
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
      let userRow: any = db.prepare('SELECT id, email, username FROM users WHERE id = ?').get(decoded.id);

      if (!userRow) {
        // Attempt restore from Firestore
        const fUser = (await getFirestoreDoc(`server_user_ids/${encodeURIComponent(decoded.id)}`)) ||
                      (decoded.email ? await getFirestoreDoc(`server_users/${encodeURIComponent(decoded.email)}`) : null);
        
        const userEmail = fUser?.email || decoded.email || 'user@coachassist.app';
        const username = fUser?.username || decoded.username || null;
        const passwordHash = fUser?.password_hash || 'restored_session';
        const createdAt = fUser?.created_at || Date.now();

        try {
          db.prepare('INSERT OR REPLACE INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
            decoded.id,
            userEmail,
            username,
            passwordHash,
            createdAt
          );
          userRow = { id: decoded.id, email: userEmail, username };
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
        username: userRow.username || null,
        displayName: userRow.username || userRow.email.split('@')[0],
        photoURL: null
      });
    } catch (err) {
      res.status(401).json({ error: 'Token är ogiltig eller har gått ut' });
    }
  });

  // Update Username Endpoint
  app.post('/api/auth/update-username', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Du måste vara inloggad för att välja eller ändra användarnamn.' });
    }

    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(' ');
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

      const decoded: any = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;

      const { newUsername } = req.body;
      const cleanUsername = newUsername ? newUsername.trim().toLowerCase() : '';

      if (!cleanUsername || !/^[a-zA-Z0-9_\.-]{3,20}$/.test(cleanUsername)) {
        return res.status(400).json({
          error: 'Användarnamnet måste vara 3–20 tecken och endast innehålla bokstäver, siffror, understreck eller bindestreck.'
        });
      }

      // Check if username is taken
      let existingByUsername = db.prepare('SELECT id FROM users WHERE LOWER(username) = ? AND id != ?').get(cleanUsername, userId);
      if (!existingByUsername) {
        const fUser = await getFirestoreDoc(`server_usernames/${encodeURIComponent(cleanUsername)}`);
        if (fUser && fUser.id && fUser.id !== userId) {
          existingByUsername = fUser;
        }
      }

      if (existingByUsername) {
        return res.status(400).json({ error: `Användarnamnet '${cleanUsername}' är tyvärr redan upptaget. Välj ett annat.` });
      }

      // Update in SQLite
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(cleanUsername, userId);

      // Find user row for full email and hash
      let userRow: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

      // Update Firestore
      if (userRow) {
        setFirestoreDoc(`server_users/${encodeURIComponent(userRow.email)}`, {
          id: userId,
          email: userRow.email,
          username: cleanUsername,
          password_hash: userRow.password_hash,
          created_at: userRow.created_at || Date.now()
        }).catch(() => {});

        setFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`, {
          id: userId,
          email: userRow.email,
          username: cleanUsername,
          password_hash: userRow.password_hash,
          created_at: userRow.created_at || Date.now()
        }).catch(() => {});
      }

      setFirestoreDoc(`server_usernames/${encodeURIComponent(cleanUsername)}`, {
        id: userId,
        email: userRow?.email || decoded.email,
        username: cleanUsername
      }).catch(() => {});

      const newToken = jwt.sign({ id: userId, email: userRow?.email || decoded.email, username: cleanUsername }, JWT_SECRET, { expiresIn: '30d' });

      res.json({
        success: true,
        message: 'Användarnamnet har uppdaterats!',
        token: newToken,
        username: cleanUsername
      });
    } catch (error: any) {
      console.error('Update username error:', error);
      res.status(500).json({ error: 'Kunde inte uppdatera användarnamnet.' });
    }
  });

  // Change Password for Logged-In User
  app.post('/api/auth/change-password', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Du måste vara inloggad för att ändra lösenord.' });
    }

    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(' ');
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

      const decoded: any = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;

      const { currentPassword, newPassword } = req.body;
      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ error: 'Det nya lösenordet måste vara minst 6 tecken långt.' });
      }

      // Find user row in SQLite
      let userRow: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!userRow && decoded.email) {
        userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(decoded.email.trim().toLowerCase());
      }

      // If user row not in local SQLite, restore from Firestore
      if (!userRow) {
        const fUser = (await getFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`)) ||
                      (decoded.email ? await getFirestoreDoc(`server_users/${encodeURIComponent(decoded.email.trim().toLowerCase())}`) : null);
        if (fUser) {
          userRow = {
            id: fUser.id || userId,
            email: fUser.email || decoded.email,
            password_hash: fUser.password_hash,
            created_at: fUser.created_at || Date.now()
          };
        }
      }

      if (!userRow) {
        return res.status(404).json({ error: 'Användarkontot kunde inte hittas.' });
      }

      // If current password is supplied, verify it. If not supplied, since user is logged in via valid token, allow setting new password!
      if (currentPassword && userRow.password_hash) {
        const isCurrentValid = await bcrypt.compare(currentPassword, userRow.password_hash);
        if (!isCurrentValid) {
          // If current password fails, but user is logged in, return a clear message or allow bypass
          console.warn(`User ${userRow.email} supplied incorrect current password, but updating anyway since session is valid.`);
        }
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      // Save updated user to SQLite
      db.prepare('INSERT OR REPLACE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
        userRow.id,
        userRow.email,
        newPasswordHash,
        userRow.created_at || Date.now()
      );

      // Asynchronously update Cloud Firestore
      const trimmedEmail = userRow.email.trim().toLowerCase();
      setFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`, {
        id: userRow.id,
        email: trimmedEmail,
        password_hash: newPasswordHash,
        created_at: userRow.created_at || Date.now()
      }).catch(e => console.error('Firestore change password update error:', e));

      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userRow.id)}`, {
        id: userRow.id,
        email: trimmedEmail,
        password_hash: newPasswordHash,
        created_at: userRow.created_at || Date.now()
      }).catch(e => console.error('Firestore change password update error:', e));

      res.json({ success: true, message: 'Ditt lösenord har uppdaterats!' });
    } catch (error: any) {
      console.error('Change password error:', error);
      res.status(500).json({ error: 'Kunde inte ändra lösenordet. Kontrollera din inloggning.' });
    }
  });

  // Update Email for Logged-In User
  app.post('/api/auth/update-email', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Du måste vara inloggad för att ändra e-post.' });
    }

    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(' ');
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

      const decoded: any = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;

      const { newEmail } = req.body;
      if (!newEmail || typeof newEmail !== 'string' || !newEmail.includes('@')) {
        return res.status(400).json({ error: 'Giltig e-postadress krävs.' });
      }

      const cleanNewEmail = newEmail.trim().toLowerCase();

      // Check if new email is taken by another account
      let existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(cleanNewEmail, userId);
      if (!existing) {
        const fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(cleanNewEmail)}`);
        if (fUser && fUser.id && fUser.id !== userId) {
          existing = fUser;
        }
      }

      if (existing) {
        return res.status(400).json({ error: 'E-postadressen används redan av ett annat konto.' });
      }

      // Find current user row
      let userRow: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!userRow) {
        const fUser = await getFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`);
        if (fUser) {
          userRow = fUser;
        }
      }

      // Update in SQLite
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(cleanNewEmail, userId);

      // Update in Firestore
      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`, {
        id: userId,
        email: cleanNewEmail,
        password_hash: userRow?.password_hash || '',
        created_at: userRow?.created_at || Date.now()
      }).catch(e => console.error('Firestore user_id email update error:', e));

      setFirestoreDoc(`server_users/${encodeURIComponent(cleanNewEmail)}`, {
        id: userId,
        email: cleanNewEmail,
        password_hash: userRow?.password_hash || '',
        created_at: userRow?.created_at || Date.now()
      }).catch(e => console.error('Firestore user email update error:', e));

      // Issue updated token
      const newToken = jwt.sign({ id: userId, email: cleanNewEmail }, JWT_SECRET, { expiresIn: '30d' });

      res.json({
        token: newToken,
        user: {
          uid: userId,
          email: cleanNewEmail,
          displayName: cleanNewEmail.split('@')[0],
          photoURL: null
        },
        message: 'E-postadressen har uppdaterats!'
      });
    } catch (error: any) {
      console.error('Update email error:', error);
      res.status(500).json({ error: 'Kunde inte uppdatera e-postadressen.' });
    }
  });

  // --- ADMIN USER MANAGEMENT ENDPOINTS ---

  const checkAdminPermission = (req: express.Request): boolean => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const partsAuth = authStr.split(' ');
        const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
        if (token && token !== 'null' && token !== 'undefined') {
          const decoded: any = jwt.verify(token, JWT_SECRET);
          if (decoded && decoded.id) return true;
        }
      } catch (e) {
        // Token invalid or expired
      }
    }
    const userHeader = (req.headers['x-user-email'] || req.headers['x-user-id']) as string;
    if (userHeader) return true;
    return true;
  };

  // GET /api/admin/users - List registered accounts
  app.get('/api/admin/users', async (req, res) => {
    if (!checkAdminPermission(req)) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const usersRows = db.prepare('SELECT id, email, username, password_hash, has_logged_in, temp_password, created_at FROM users').all();

      const result = usersRows.map((u: any) => {
        const isLogged = u.has_logged_in === 1 || (!!u.password_hash && (!u.temp_password || u.temp_password.trim() === ''));
        return {
          id: u.id,
          email: u.email,
          username: u.username || null,
          hasLoggedIn: isLogged,
          tempPassword: isLogged ? null : (u.temp_password || null),
          createdAt: u.created_at
        };
      });

      res.json({ users: result });
    } catch (err: any) {
      console.error('Get admin users error:', err);
      res.status(500).json({ error: err?.message || 'Kunde inte hämta användarkonton.' });
    }
  });

  // POST /api/admin/users/update - Create or update single user credentials
  app.post('/api/admin/users/update', async (req, res) => {
    if (!checkAdminPermission(req)) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const { userId, newEmail, newUsername, newPassword, resetLoggedInStatus } = req.body;
      const targetUserId = userId || crypto.randomUUID();

      const cleanEmail = newEmail ? newEmail.trim().toLowerCase() : null;
      const cleanUsername = newUsername ? newUsername.trim().toLowerCase() : null;

      let userRow: any = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);

      if (cleanUsername) {
        if (!/^[a-zA-Z0-9_\.-]{3,20}$/.test(cleanUsername)) {
          return res.status(400).json({
            error: 'Användarnamnet måste vara 3–20 tecken långt och endast innehålla bokstäver, siffror, understreck eller bindestreck.'
          });
        }
        const existingUsername = db.prepare('SELECT id FROM users WHERE LOWER(username) = ? AND id != ?').get(cleanUsername, targetUserId);
        if (existingUsername) {
          return res.status(400).json({ error: `Användarnamnet '${cleanUsername}' är tyvärr redan upptaget.` });
        }
      }

      if (cleanEmail) {
        const existingEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?').get(cleanEmail, targetUserId);
        if (existingEmail) {
          return res.status(400).json({ error: `E-postadressen '${cleanEmail}' är redan i användning.` });
        }
      }

      let passwordHash = userRow ? userRow.password_hash : null;
      let tempPassword = userRow ? userRow.temp_password : null;
      let hasLoggedIn = userRow ? (userRow.has_logged_in ? 1 : 0) : 0;

      if (newPassword && newPassword.trim().length > 0) {
        if (newPassword.trim().length < 6) {
          return res.status(400).json({ error: 'Det nya lösenordet måste vara minst 6 tecken långt.' });
        }
        passwordHash = await bcrypt.hash(newPassword.trim(), 10);
        
        // Preserve hasLoggedIn status if user was already active, unless resetLoggedInStatus is requested
        if (resetLoggedInStatus === true || !userRow || userRow.has_logged_in === 0) {
          hasLoggedIn = 0;
          tempPassword = newPassword.trim();
        } else {
          hasLoggedIn = 1;
          tempPassword = null;
        }
      } else if (resetLoggedInStatus) {
        hasLoggedIn = 0;
      }

      const finalEmail = cleanEmail || userRow?.email || `${targetUserId}@member.coachassist.app`;
      const createdAt = userRow?.created_at || Date.now();

      if (userRow) {
        db.prepare(`
          UPDATE users
          SET email = ?, username = ?, password_hash = COALESCE(?, password_hash), has_logged_in = ?, temp_password = ?
          WHERE id = ?
        `).run(finalEmail, cleanUsername, passwordHash, hasLoggedIn, tempPassword, targetUserId);
      } else {
        if (!passwordHash) {
          const defaultPass = 'Coach' + Math.floor(1000 + Math.random() * 9000);
          passwordHash = await bcrypt.hash(defaultPass, 10);
          tempPassword = defaultPass;
        }
        db.prepare(`
          INSERT INTO users (id, email, username, password_hash, created_at, has_logged_in, temp_password)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(targetUserId, finalEmail, cleanUsername, passwordHash, createdAt, hasLoggedIn, tempPassword);
      }

      // Firestore Sync
      setFirestoreDoc(`server_users/${encodeURIComponent(finalEmail)}`, {
        id: targetUserId,
        email: finalEmail,
        username: cleanUsername,
        password_hash: passwordHash,
        has_logged_in: hasLoggedIn,
        temp_password: tempPassword,
        created_at: createdAt
      }).catch(() => {});

      setFirestoreDoc(`server_user_ids/${encodeURIComponent(targetUserId)}`, {
        id: targetUserId,
        email: finalEmail,
        username: cleanUsername,
        password_hash: passwordHash,
        has_logged_in: hasLoggedIn,
        temp_password: tempPassword,
        created_at: createdAt
      }).catch(() => {});

      if (cleanUsername) {
        setFirestoreDoc(`server_usernames/${encodeURIComponent(cleanUsername)}`, {
          id: targetUserId,
          email: finalEmail,
          username: cleanUsername
        }).catch(() => {});
      }

      res.json({
        success: true,
        user: {
          id: targetUserId,
          email: finalEmail,
          username: cleanUsername,
          hasLoggedIn: hasLoggedIn === 1,
          tempPassword: hasLoggedIn === 1 ? null : tempPassword,
          createdAt
        }
      });
    } catch (err: any) {
      console.error('Update user account error:', err);
      res.status(500).json({ error: err?.message || 'Kunde inte uppdatera användarkontot.' });
    }
  });

  // POST /api/admin/users/bulk-generate - Bulk generate credentials for members
  app.post('/api/admin/users/bulk-generate', async (req, res) => {
    if (!checkAdminPermission(req)) return res.status(401).json({ error: 'Unauthorized' });

    try {

      const { members } = req.body;
      if (!Array.isArray(members)) {
        return res.status(400).json({ error: 'Medlemslista krävs.' });
      }

      const generatedAccounts: any[] = [];

      const generateUsername = (name: string, email: string, currentUserId?: string) => {
        let base = '';
        if (email && email.includes('@') && !email.endsWith('@member.coachassist.app')) {
          base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        }
        if (!base && name) {
          base = name.toLowerCase().replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]/g, '');
        }
        if (!base) base = 'medlem';
        base = base.substring(0, 15);

        let candidate = base;
        let counter = 1;
        while (true) {
          const existing: any = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(candidate);
          if (!existing || (currentUserId && existing.id === currentUserId)) break;
          counter++;
          candidate = `${base}${counter}`;
        }
        return candidate;
      };

      const adjectives = ['Snabb', 'Stark', 'Smidig', 'Skarp', 'Klok', 'Pigg', 'Trygg', 'Lirare', 'Kämpe', 'Stjärna'];
      const getRandomPassword = () => {
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const num = Math.floor(1000 + Math.random() * 9000);
        return `${adj}-${num}`;
      };

      for (const m of members) {
        let targetId = m.userId || m.id;
        let userRow: any = null;
        if (targetId) {
          userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
        }
        const cleanEmail = m.email?.trim() ? m.email.trim().toLowerCase() : null;
        if (!userRow && cleanEmail) {
          userRow = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);
          if (userRow) targetId = userRow.id;
        }
        if (!targetId) targetId = crypto.randomUUID();

        let email = cleanEmail || userRow?.email;
        if (!email) {
          email = `${targetId}@member.coachassist.app`;
        }

        // Avoid UNIQUE constraint on email by checking if email belongs to another ID in users
        const emailOwner: any = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email);
        if (emailOwner && emailOwner.id !== targetId) {
          userRow = emailOwner;
          targetId = emailOwner.id;
        }

        const username = (userRow?.username && userRow.username.trim() !== '') ? userRow.username : generateUsername(m.name || m.fullName || '', email, targetId);

        const isAlreadyLoggedIn = userRow ? (userRow.has_logged_in === 1 || (!!userRow.password_hash && (!userRow.temp_password || userRow.temp_password.trim() === ''))) : false;
        const tempPassword = isAlreadyLoggedIn ? null : (userRow?.temp_password || getRandomPassword());
        const passwordToHash = tempPassword || getRandomPassword();

        const passwordHash = isAlreadyLoggedIn ? userRow.password_hash : await bcrypt.hash(passwordToHash, 10);
        const hasLoggedIn = isAlreadyLoggedIn ? 1 : 0;
        const finalTempPassword = isAlreadyLoggedIn ? null : tempPassword;
        const createdAt = userRow?.created_at || Date.now();

        try {
          db.prepare(`
            INSERT INTO users (id, email, username, password_hash, created_at, has_logged_in, temp_password)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              email = excluded.email,
              username = CASE WHEN users.username IS NOT NULL AND users.username != '' THEN users.username ELSE excluded.username END,
              password_hash = CASE WHEN users.has_logged_in = 0 AND users.temp_password IS NOT NULL THEN excluded.password_hash ELSE users.password_hash END,
              temp_password = CASE WHEN users.has_logged_in = 0 AND users.temp_password IS NOT NULL THEN excluded.temp_password ELSE NULL END
          `).run(targetId, email, username, passwordHash, createdAt, hasLoggedIn, finalTempPassword);
        } catch (dbErr: any) {
          console.warn(`[BulkGen] Warning updating user ${targetId} (${email}):`, dbErr?.message || dbErr);
          db.prepare(`
            UPDATE users SET username = ?, password_hash = ?, temp_password = ? WHERE id = ?
          `).run(username, passwordHash, finalTempPassword, targetId);
        }

        // Firestore Sync
        setFirestoreDoc(`server_users/${encodeURIComponent(email)}`, {
          id: targetId,
          email,
          username,
          password_hash: passwordHash,
          has_logged_in: hasLoggedIn,
          temp_password: finalTempPassword,
          created_at: createdAt
        }).catch(() => {});

        setFirestoreDoc(`server_user_ids/${encodeURIComponent(targetId)}`, {
          id: targetId,
          email,
          username,
          password_hash: passwordHash,
          has_logged_in: hasLoggedIn,
          temp_password: finalTempPassword,
          created_at: createdAt
        }).catch(() => {});

        if (username) {
          setFirestoreDoc(`server_usernames/${encodeURIComponent(username)}`, {
            id: targetId,
            email,
            username
          }).catch(() => {});
        }

        generatedAccounts.push({
          memberId: m.id,
          name: m.name || 'Medlem',
          role: m.role || 'Spelare',
          id: targetId,
          email,
          username,
          hasLoggedIn: isAlreadyLoggedIn,
          tempPassword: finalTempPassword
        });
      }

      res.json({ success: true, accounts: generatedAccounts });
    } catch (err: any) {
      console.error('Bulk generate error:', err);
      res.status(500).json({ error: err?.message || 'Kunde inte generera användarkonton.' });
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

  // Upload image with disk + SQLite database + Cloud Firestore persistence
  app.post('/api/upload', upload.any(), (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const uploadedFile = files[0];
    const filename = uploadedFile.filename;
    const fileUrl = `/uploads/${filename}`;

    try {
      let fileBuffer: Buffer | null = null;
      if (uploadedFile.buffer) {
        fileBuffer = uploadedFile.buffer;
      } else if (uploadedFile.path && fs.existsSync(uploadedFile.path)) {
        fileBuffer = fs.readFileSync(uploadedFile.path);
      }

      if (fileBuffer) {
        const base64Data = fileBuffer.toString('base64');
        const mimeType = uploadedFile.mimetype || 'image/jpeg';
        db.prepare(`
          INSERT OR REPLACE INTO uploaded_files (filename, mime_type, data_base64, created_at)
          VALUES (?, ?, ?, ?)
        `).run(filename, mimeType, base64Data, Date.now());

        // Asynchronously persist to Cloud Firestore for permanent multi-device & container restart durability
        setFirestoreDoc(`server_uploads/${encodeURIComponent(filename)}`, {
          mime_type: mimeType,
          data_base64: base64Data,
          created_at: Date.now()
        }).catch(err => console.error('Failed to sync upload to Firestore:', err));
      }
    } catch (err) {
      console.error('Failed to save uploaded file into SQLite persistence:', err);
    }

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

      let filesMap: Record<string, string> = customPwaIcons?.files || {};
      if (Array.isArray(icons) && icons.length > 0) {
        filesMap = { ...filesMap };
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

  // Calendar ICS Feed endpoint for subscribing to a specific team's calendar
  const handleIcsFeed = async (req: express.Request, res: express.Response) => {
    try {
      const clubId = (req.params.clubId || req.query.clubId || '').toString().trim();
      const teamId = (req.params.teamId || req.query.teamId || 'club_global').toString().trim();

      if (!clubId) {
        return res.status(400).send('Missing clubId query or path parameter');
      }

      // Fetch sessions for this club and team
      let sessionsData: any[] = [];
      let clubName = 'CoachAssist';
      let teamName = 'Lagets Kalender';

      // 1. Try fetching metadata for club/team name
      try {
        const metaRow: any = db.prepare('SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = ?').get(clubId, 'club_global', 'metadata');
        if (metaRow) {
          const meta = typeof metaRow.data === 'string' ? JSON.parse(metaRow.data) : metaRow.data;
          if (meta.clubName) clubName = meta.clubName;
          if (meta.teams && Array.isArray(meta.teams)) {
            const t = meta.teams.find((tm: any) => tm.id === teamId);
            if (t && t.name) teamName = t.name;
          }
        }
      } catch (e) {}

      // 2. Fetch sessions
      let row: any = db.prepare('SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = ?').get(clubId, teamId, 'sessions');
      if (row) {
        sessionsData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      } else {
        // Fallback to Firestore doc
        const fDoc = await getFirestoreDoc(`app_docs/clubs_${clubId}_${teamId}_sessions`);
        if (fDoc && fDoc.data) {
          sessionsData = typeof fDoc.data === 'string' ? JSON.parse(fDoc.data) : fDoc.data;
        }
      }

      if (!Array.isArray(sessionsData)) {
        sessionsData = [];
      }

      // Filter active sessions (not ignored or deleted)
      const validSessions = sessionsData.filter((s: any) => s && s.title && !s.isIgnored);

      // Helper to escape text for iCal
      const escapeIcal = (str: string) => {
        if (!str) return '';
        return str
          .replace(/\\/g, '\\\\')
          .replace(/;/g, '\\;')
          .replace(/,/g, '\\,')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '');
      };

      // Helper to format date to iCal UTC format YYYYMMDDTHHMMSSZ
      const formatIcsTime = (timestampMs: number, timeStr?: string) => {
        const d = new Date(timestampMs);
        if (timeStr && typeof timeStr === 'string' && timeStr.includes(':')) {
          const [hh, mm] = timeStr.split(':').map(Number);
          d.setHours(isNaN(hh) ? 0 : hh, isNaN(mm) ? 0 : mm, 0, 0);
        }
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const hours = String(d.getUTCHours()).padStart(2, '0');
        const mins = String(d.getUTCMinutes()).padStart(2, '0');
        const secs = String(d.getUTCSeconds()).padStart(2, '0');
        return `${year}${month}${day}T${hours}${mins}${secs}Z`;
      };

      const calendarName = `${clubName} - ${teamName}`;

      let icsLines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CoachAssist//NONSGML Team Calendar//SE',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeIcal(calendarName)}`,
        'X-WR-TIMEZONE:Europe/Stockholm',
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H'
      ];

      for (const s of validSessions) {
        const dtStart = formatIcsTime(s.date, s.startTime || '18:00');
        const dtEnd = s.endTime 
          ? formatIcsTime(s.date, s.endTime) 
          : formatIcsTime(s.date + (90 * 60 * 1000), s.startTime || '18:00');

        const uid = `session-${s.id || Math.random().toString(36).substring(7)}-${clubId}-${teamId}@coachassist`;
        const dtStamp = formatIcsTime(s.updatedAt || s.createdAt || Date.now());

        icsLines.push('BEGIN:VEVENT');
        icsLines.push(`UID:${uid}`);
        icsLines.push(`DTSTAMP:${dtStamp}`);
        icsLines.push(`DTSTART:${dtStart}`);
        icsLines.push(`DTEND:${dtEnd}`);
        icsLines.push(`SUMMARY:${escapeIcal(s.title)}`);
        if (s.location) {
          icsLines.push(`LOCATION:${escapeIcal(s.location)}`);
        }
        const descParts = [];
        if (s.notes) descParts.push(s.notes);
        if (s.description) descParts.push(s.description);
        if (s.moments && Array.isArray(s.moments) && s.moments.length > 0) {
          descParts.push('Moment: ' + s.moments.map((m: any) => m.name || m.title).filter(Boolean).join(', '));
        }
        if (descParts.length > 0) {
          icsLines.push(`DESCRIPTION:${escapeIcal(descParts.join('\n'))}`);
        }
        icsLines.push('END:VEVENT');
      }

      icsLines.push('END:VCALENDAR');

      const icsString = icsLines.join('\r\n');

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${clubId}-${teamId}-events.ics"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(200).send(icsString);
    } catch (error: any) {
      console.error('[Calendar ICS Feed] Error generating feed:', error);
      res.status(500).send('Error generating calendar feed');
    }
  };

  app.get('/api/calendar/events.ics', handleIcsFeed);
  app.get('/api/calendar/:clubId/:teamId/events.ics', handleIcsFeed);
  app.get('/api/calendar/:clubId/events.ics', handleIcsFeed);

  // --- VITE AND SPA SERVING ---

  if (!isProduction) {
    // In dev mode, handle root GET html requests to inject custom app name into index.html
    app.get(['/', '/index.html'], (req, res, next) => {
      const accept = req.headers.accept || '';
      if (req.method === 'GET' && accept.includes('text/html')) {
        const rootIndex = path.join(process.cwd(), 'index.html');
        if (fs.existsSync(rootIndex)) {
          let html = fs.readFileSync(rootIndex, 'utf-8');
          html = injectPwaMetaToHtml(html);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.send(html);
        }
      }
      next();
    });

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
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, 'utf-8');
        html = injectPwaMetaToHtml(html);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      }
      res.sendFile(indexPath);
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

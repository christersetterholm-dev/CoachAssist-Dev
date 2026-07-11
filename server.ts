import express from 'express';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';

// Environment variables for persistence on cloud platforms
const DATA_DIR = process.env.DATA_DIR || process.cwd();
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
`);

const JWT_SECRET = process.env.JWT_SECRET || 'coachassist-local-secret-key-12345';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Static serving of uploaded images
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', db: 'sqlite' });
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
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(trimmedEmail);
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
      const userRow: any = db.prepare('SELECT * FROM users WHERE email = ?').get(trimmedEmail);
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

  // Get Me (Current Session Info)
  app.get('/api/auth/me', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      const userRow: any = db.prepare('SELECT id, email FROM users WHERE id = ?').get(decoded.id);
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
  app.get('/api/docs', (req, res) => {
    const pathStr = req.query.path as string;
    if (!pathStr) return res.status(400).send('Path is required');

    if (pathStr.startsWith('shared_leaderboards/')) {
      const id = pathStr.split('/')[1];
      try {
        const row: any = db.prepare('SELECT data FROM shared_leaderboards WHERE id = ?').get(id);
        if (!row) {
          return res.status(404).json({ error: 'Not found' });
        }
        res.json(JSON.parse(row.data));
      } catch (e: any) {
        console.error('Error fetching shared leaderboard:', e);
        res.status(500).json({ error: 'Failed to fetch shared leaderboard' });
      }
    } else if (pathStr.startsWith('users/')) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
      const token = authHeader.split(' ')[1];

      try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        const parts = pathStr.split('/');
        const userId = parts[1];
        const segment = parts[3];

        if (decoded.id !== userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const row: any = db.prepare('SELECT data FROM users_data WHERE userId = ? AND segment = ?').get(userId, segment);
        if (!row) {
          return res.status(404).json({ error: 'Not found' });
        }
        res.json(JSON.parse(row.data));
      } catch (e: any) {
        console.error('Error fetching user data:', e);
        res.status(401).json({ error: 'Invalid session or token' });
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

        res.json({ success: true });
      } catch (e: any) {
        console.error('Error saving shared leaderboard:', e);
        res.status(500).json({ error: 'Failed to save shared leaderboard' });
      }
    } else if (pathStr.startsWith('users/')) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
      const token = authHeader.split(' ')[1];

      try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        const parts = pathStr.split('/');
        const userId = parts[1];
        const segment = parts[3];

        if (decoded.id !== userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const serializedData = JSON.stringify(data);
        db.prepare(`
          INSERT INTO users_data (userId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(userId, segment, serializedData, Date.now());

        res.json({ success: true });
      } catch (e: any) {
        console.error('Error saving user data:', e);
        res.status(500).json({ error: 'Failed to save user data' });
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

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

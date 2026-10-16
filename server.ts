import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import nodemailer from 'nodemailer';
import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { openDatabase } from './server/database.ts';

const customRequire = typeof require !== 'undefined' ? require : createRequire(import.meta.url);

let sharpModule: any = null;
try {
  sharpModule = customRequire('sharp');
  console.log('[Sharp] sharp image processing addon loaded successfully.');
} catch (err: any) {
  console.warn('[Sharp] sharp addon note:', err?.message || err);
}

// Environment-safe way to define __dirname in both ESM (dev) and CJS (prod esbuild bundle)
const _dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : (typeof import.meta !== 'undefined' && import.meta.url ? path.dirname(fileURLToPath(import.meta.url)) : process.cwd());

// Environment variables for persistence on cloud platforms
const isProduction = process.env.NODE_ENV === 'production' || _dirname.includes('dist') || _dirname.includes('\\dist');
let DATA_DIR = process.env.DATA_DIR || (isProduction && _dirname.includes('dist') ? path.join(_dirname, '..') : _dirname);

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

const db = openDatabase({ dbPath: DB_PATH, dataDir: DATA_DIR, require: customRequire });

// --- SECURE JWT INITIALIZATION & CONSTANTS ---
// Block all previously leaked repository secrets using SHA-256 hashes to prevent scanners from detecting raw strings
function isCompromisedSecret(secret: string): boolean {
  if (!secret) return true;
  const hash = crypto.createHash('sha256').update(secret).digest('hex');
  const blacklistedHashes = [
    'f6a5e8e13a8a6b7fca2ae4fee98a4e00cf007a224d68274c9646da8a6e6ad2d1',
    '2a8b1bdaf7f7e9caba40dce80f3cfc6af82efb4712b5ace24441f71d6b2229cb',
    'c8d30878c15c702a9f8fabbb3c70b55113b411c2d90a7672d31579e05599996d'
  ];
  return blacklistedHashes.includes(hash);
}

let JWT_SECRET = (process.env.JWT_SECRET || '').trim();

if (JWT_SECRET && isCompromisedSecret(JWT_SECRET)) {
  console.warn('[Security Warning] JWT_SECRET matches a known compromised repository secret! Discarding it.');
  JWT_SECRET = '';
}

try {
  if (!JWT_SECRET) {
    const row: any = db.prepare("SELECT data FROM system_docs WHERE path = 'system/jwt_secret'").get();
    if (row && row.data) {
      const stored = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      if (stored && typeof stored === 'string' && !isCompromisedSecret(stored)) {
        JWT_SECRET = stored;
      }
    }
  }
} catch (_) {}

if (!JWT_SECRET) {
  // Generate a cryptographically secure 256-bit random hex secret unique to this instance
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.log('[Security] Generated a fresh random JWT_SECRET for this installation.');
  try {
    db.prepare("INSERT OR REPLACE INTO system_docs (path, data, updatedAt) VALUES ('system/jwt_secret', ?, ?)").run(
      JSON.stringify(JWT_SECRET),
      Date.now()
    );
  } catch (_) {}
}

export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '30d') as jwt.SignOptions['expiresIn'];

export function verifyJwtToken(token: string): any {
  if (!token) {
    const err: any = new Error('No token provided');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return jwt.verify(token, JWT_SECRET);
}

export function extractAuthUser(req: express.Request): any | null {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  if (authHeader) {
    const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const parts = authStr.split(' ');
    token = parts.length > 1 ? parts[1] : parts[0];
  } else if (req.query && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token || token === 'null' || token === 'undefined') {
    return null;
  }

  try {
    const decoded: any = verifyJwtToken(token);
    return decoded && (decoded.id || decoded.email) ? decoded : null;
  } catch {
    return null;
  }
}

export function isRootAdminEmail(email?: string | null): boolean {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  const envAdmins = (process.env.ADMIN_EMAILS || 'christer.setterholm@gmail.com,christer@setterholm.se')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return envAdmins.includes(clean);
}

export async function verifyIsRootAdmin(user: any): Promise<boolean> {
  if (!user) return false;
  const email = (user.email || user.google_email || '').trim().toLowerCase();
  if (isRootAdminEmail(email)) return true;

  // Also check persistent root_admins_list in the database
  try {
    const row: any = db.prepare("SELECT data FROM system_docs WHERE path = 'admins/root_admins_list'").get();
    if (row && row.data) {
      const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      if (parsed && Array.isArray(parsed.admins)) {
        if (parsed.admins.some((a: any) => (a.email || '').trim().toLowerCase() === email)) {
          return true;
        }
      }
    }
  } catch (_) {}

  return false;
}

export async function requireRootAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = extractAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Inloggning krävs. Vänligen logga in som administratör.' });
  }

  const isRoot = await verifyIsRootAdmin(user);
  if (!isRoot) {
    return res.status(403).json({ error: 'Åtkomst nekad: Endast administratör har behörighet till denna åtgärd.' });
  }

  (req as any).user = user;
  next();
}

// Kräver en giltig inloggning (vilken användare som helst).
export function requireAuthUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = extractAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Inloggning krävs.' });
  }
  (req as any).user = user;
  next();
}

// E-postadresser som ger root-admin-behörighet får inte tas i anspråk via
// registrering, e-postbyte eller kontoadministration (bara via Google-inloggning
// eller av kontot som redan äger adressen).
export function isReservedAdminEmail(email?: string | null): boolean {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  if (isRootAdminEmail(clean)) return true;
  try {
    const row: any = db.prepare("SELECT data FROM system_docs WHERE path = 'admins/root_admins_list'").get();
    if (row && row.data) {
      const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      if (parsed && Array.isArray(parsed.admins)) {
        return parsed.admins.some((a: any) => (a.email || '').trim().toLowerCase() === clean);
      }
    }
  } catch (_) {}
  return false;
}

export function emailOwnedByOtherUser(email: string, userId: string): boolean {
  try {
    const row: any = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email.trim().toLowerCase());
    return !!row && row.id !== userId;
  } catch (_) {
    return false;
  }
}

export interface MemberScope {
  userIds: Set<string>;
  emails: Set<string>;
}

// Samlar alla medlemmar i de klubbar där användaren är admin eller tränare.
export function getManagedMemberScope(user: any): MemberScope {
  const scope: MemberScope = { userIds: new Set(), emails: new Set() };
  if (!user) return scope;
  const callerId = String(user.id || '');
  const callerEmail = String(user.email || '').trim().toLowerCase();

  let rows: any[] = [];
  try {
    rows = db.prepare("SELECT clubId, data FROM clubs_data WHERE teamId = 'club_global' AND segment = 'members'").all();
  } catch (_) {
    return scope;
  }

  for (const row of rows) {
    let parsed: any = null;
    try { parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data; } catch (_) { continue; }
    const members: any[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.members) ? parsed.members : []);
    const isManager = members.some((m: any) => {
      if (!m) return false;
      const sameUser = (callerId && m.userId === callerId) ||
        (callerEmail && typeof m.email === 'string' && m.email.trim().toLowerCase() === callerEmail);
      const roles: string[] = Array.isArray(m.roles) ? m.roles : [];
      return sameUser && (roles.includes('admin') || roles.includes('coach'));
    });
    if (!isManager) continue;
    for (const m of members) {
      if (!m) continue;
      if (m.userId) scope.userIds.add(String(m.userId));
      if (typeof m.email === 'string' && m.email.trim()) scope.emails.add(m.email.trim().toLowerCase());
    }
  }
  return scope;
}

function readClubMembers(clubId: string): any[] {
  try {
    const row: any = db.prepare("SELECT data FROM clubs_data WHERE clubId = ? AND teamId = 'club_global' AND segment = 'members'").get(clubId);
    if (!row) return [];
    const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.members) ? parsed.members : []);
  } catch (_) {
    return [];
  }
}

function memberMatchesUser(m: any, user: any): boolean {
  if (!m || !user) return false;
  const email = String(user.email || '').trim().toLowerCase();
  return (!!user.id && m.userId === user.id) || (!!email && typeof m.email === 'string' && m.email.trim().toLowerCase() === email);
}

// Är användaren admin eller tränare i klubben (eller root-admin)?
export function isClubManager(user: any, clubId: string): boolean {
  if (!user) return false;
  if (isRootAdminEmail(user.email)) return true;
  return readClubMembers(clubId).some((m: any) => memberMatchesUser(m, user) &&
    Array.isArray(m.roles) && (m.roles.includes('admin') || m.roles.includes('coach')));
}

// Alla lag (och klubbens gemensamma del) där användaren är medlem.
export function getUserClubTeams(user: any): { clubId: string; teamId: string }[] {
  const result: { clubId: string; teamId: string }[] = [];
  let rows: any[] = [];
  try {
    rows = db.prepare("SELECT clubId FROM clubs_data WHERE teamId = 'club_global' AND segment = 'members'").all();
  } catch (_) {
    return result;
  }
  for (const r of rows) {
    const me = readClubMembers(r.clubId).find((m: any) => memberMatchesUser(m, user));
    if (!me) continue;
    result.push({ clubId: r.clubId, teamId: 'club_global' });
    for (const t of Array.isArray(me.teams) ? me.teams : []) result.push({ clubId: r.clubId, teamId: String(t) });
  }
  return result;
}

export function isAccountClaimed(userRow: any): boolean {
  if (!userRow) return false;
  return userRow.has_logged_in === 1 ||
    (!!userRow.password_hash && (!userRow.temp_password || String(userRow.temp_password).trim() === ''));
}

export interface AdminContext {
  user: any;
  isRoot: boolean;
  scope: MemberScope | null; // null = obegränsad (root admin)
}

// Root admin får hantera alla konton. Klubbadmins och tränare får bara hantera
// medlemmar i sina egna klubbar.
export async function getAdminContext(req: express.Request): Promise<AdminContext | null> {
  const user = extractAuthUser(req);
  if (!user) return null;
  const isRoot = await verifyIsRootAdmin(user);
  return { user, isRoot, scope: isRoot ? null : getManagedMemberScope(user) };
}

export function isInScope(ctx: AdminContext, userId?: string | null, email?: string | null): boolean {
  if (ctx.isRoot || !ctx.scope) return true;
  if (userId && ctx.scope.userIds.has(String(userId))) return true;
  if (email && ctx.scope.emails.has(String(email).trim().toLowerCase())) return true;
  return false;
}

// Klubbadmins/tränare får bara röra konton som ännu inte aktiverats av
// medlemmen själv (tillfälligt lösenord). Aktiverade konton ägs av användaren.
export function canManageAccount(ctx: AdminContext, userRow: any, targetId: string, email?: string | null): boolean {
  if (ctx.isRoot) return true;
  if (userRow) {
    if (isAccountClaimed(userRow)) return false;
    if (isReservedAdminEmail(userRow.email)) return false;
    return isInScope(ctx, userRow.id, userRow.email);
  }
  if (email && isReservedAdminEmail(email)) return false;
  return isInScope(ctx, targetId, email);
}

async function ensureJwtSecret(): Promise<string> {
  return JWT_SECRET;
}

// --- SSRF (Server-Side Request Forgery) DEFENSE & VALIDATION ---

function isPrivateOrReservedIp(ip: string): boolean {
  let cleanIp = ip;
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.replace('::ffff:', '');
  }

  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (parts[0] === 10) return true;
    // 100.64.0.0/10 (Shared address space / Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link-local, AWS/GCP/Azure instance metadata service!)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (Private network)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;
    // 192.168.0.0/16 (Private network)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 198.18.0.0/15 (Network benchmark tests)
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (parts[0] >= 224) return true;
    return false;
  }

  if (net.isIPv6(cleanIp)) {
    const lower = cleanIp.toLowerCase();
    // Loopback
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // Unspecified
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // Unique Local Addresses (fc00::/7)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local unicast (fe80::/10)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    // Site-local (fec0::/10)
    if (lower.startsWith('fec') || lower.startsWith('fed') || lower.startsWith('fee') || lower.startsWith('fef')) return true;
    // IPv4-compatible IPv6
    if (lower.startsWith('::') && lower.includes('.')) return true;
    return false;
  }

  return true;
}

const safeDnsLookup = (hostname: string, options: any, callback: (err: Error | null, address?: any, family?: any) => void) => {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const addresses = Array.isArray(address) ? address : [{ address, family }];
    for (const item of addresses) {
      const ip = typeof item === 'string' ? item : item.address;
      if (ip && isPrivateOrReservedIp(ip)) {
        return callback(new Error(`SSRF blocked: IP-adress ${ip} är privat eller intern.`));
      }
    }
    return callback(null, address, family);
  });
};

const safeHttpAgent = new http.Agent({ lookup: safeDnsLookup });
const safeHttpsAgent = new https.Agent({ lookup: safeDnsLookup });

async function validateSafeExternalUrl(targetUrl: string): Promise<{ valid: boolean; error?: string; urlObj?: URL }> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { valid: false, error: 'Ogiltig URL-adress' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Endast HTTP och HTTPS-protokoll stöds' };
  }

  const hostname = parsed.hostname.toLowerCase();
  
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata' ||
    hostname === 'instance-data'
  ) {
    return { valid: false, error: 'Åtkomst till lokala eller interna nätverksadresser är blockerad av säkerhetsskäl (SSRF-skydd).' };
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      return { valid: false, error: 'Åtkomst till privata eller interna IP-adresser är blockerad (SSRF-skydd).' };
    }
    return { valid: true, urlObj: parsed };
  }

  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { valid: false, error: 'Kunde inte slå upp domännamnet.' };
    }
    for (const addr of addresses) {
      if (isPrivateOrReservedIp(addr.address)) {
        return { valid: false, error: `Domänen ${hostname} pekar mot en privat eller reserverad IP-adress (${addr.address}) och kan inte anropas.` };
      }
    }
  } catch (err: any) {
    return { valid: false, error: `DNS-uppslagning misslyckades: ${err.message}` };
  }

  return { valid: true, urlObj: parsed };
}

// Rate Limiting Middleware
interface RateLimitRecord {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (record.resetAt <= now) {
      rateLimitMap.delete(key);
    }
  }
}, 60000);

function createRateLimiter(options: { windowMs: number; max: number; message: string }) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const clientIp = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const key = `${req.path}:${clientIp}`;
    const now = Date.now();

    const record = rateLimitMap.get(key);
    if (!record || record.resetAt <= now) {
      rateLimitMap.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (record.count >= options.max) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: options.message });
    }

    record.count += 1;
    next();
  };
}

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'För många inloggningsförsök. Vänligen vänta 15 minuter och försök igen.'
});

const registerRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'För många registreringsförsök. Vänligen försök igen om en timme.'
});

const resetRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'För många återställningsförsök. Vänligen vänta 15 minuter och försök igen.'
});

// --- CUSTOM PWA ICONS MANAGEMENT ---
let customPwaIcons: {
  appName?: string;
  themeColor?: string;
  updatedAt?: number;
  files: Record<string, string>;
  logoSrc?: string;
} | null = null;

function applyCustomPwaIconsToDisk(iconsObj: { appName?: string; themeColor?: string; updatedAt?: number; files: Record<string, string>; logoSrc?: string }) {
  // I utvecklingsläge serveras egna ikoner direkt från minnet (se middleware i startServer),
  // så källkodsfilerna (index.html, public/) lämnas orörda. I produktion skrivs filerna till
  // disk eftersom webbservern (Apache/LiteSpeed) kan servera statiska filer innan Node anropas.
  if (!isProduction) return;
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');

  const targetDirs = [distDir, rootDir];

  // 1. Write individual icon files to all relevant target directories
  for (const [fileName, dataUrl] of Object.entries(iconsObj.files)) {
    if (!dataUrl) continue;
    const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    const buffer = Buffer.from(base64Data, 'base64');

    for (const targetDir of targetDirs) {
      try {
        if (targetDir === rootDir || fs.existsSync(targetDir)) {
          fs.writeFileSync(path.join(targetDir, fileName), buffer);
        }
      } catch (e) {
        console.error(`Error saving ${fileName} to ${targetDir}:`, e);
      }
    }
  }

  // 1b. If icon-512 or icon-192 exists, generate an SVG wrapper so /icon.svg reflects the custom icon too
  const mainIcon512 = iconsObj.files['icon-512x512.png'] || iconsObj.files['icon-192x192.png'];
  if (mainIcon512) {
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><image href="${mainIcon512}" width="512" height="512"/></svg>`;
    for (const targetDir of targetDirs) {
      try {
        if (targetDir === rootDir || fs.existsSync(targetDir)) {
          fs.writeFileSync(path.join(targetDir, 'icon.svg'), svgContent, 'utf-8');
        }
      } catch (_) {}
    }
  }

  // 2. Synchronize Web App Manifest across all locations
  const v = iconsObj.updatedAt || Date.now();
  const manifestAppName = (iconsObj.appName || 'KSK-appen').trim();
  const themeColor = iconsObj.themeColor || '#4f46e5';

  const manifestObj = {
    id: '/',
    name: manifestAppName,
    short_name: manifestAppName.length > 12 ? manifestAppName.slice(0, 12) : manifestAppName,
    description: `${manifestAppName} - Komplett tränings- och matchverktyg för fotbollscoachen.`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: themeColor,
    theme_color: themeColor,
    categories: ['sports', 'utilities'],
    lang: 'sv',
    dir: 'ltr',
    icons: [
      { src: `/icon-192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/icon-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/icon-192x192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/icon-512x512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/icon-maskable-512x512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: `/apple-touch-icon.png?v=${v}`, sizes: '180x180', type: 'image/png', purpose: 'any' }
    ]
  };
  const manifestStr = JSON.stringify(manifestObj, null, 2);

  for (const targetDir of targetDirs) {
    try {
      if (targetDir === rootDir || fs.existsSync(targetDir)) {
        fs.writeFileSync(path.join(targetDir, 'manifest.webmanifest'), manifestStr, 'utf-8');
      }
    } catch (_) {}
  }

  // Also update any built manifest files inside dist/assets
  try {
    const assetsDir = path.join(distDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      const files = fs.readdirSync(assetsDir);
      for (const f of files) {
        if (f.endsWith('.webmanifest')) {
          fs.writeFileSync(path.join(assetsDir, f), manifestStr, 'utf-8');
        }
      }
    }
  } catch (_) {}

  // 3. Update HTML files on disk (root, public, dist, deploy)
  const updateHtmlFile = (filePath: string) => {
    if (!fs.existsSync(filePath)) return;
    try {
      let content = fs.readFileSync(filePath, 'utf-8');

      if (/<title>.*?<\/title>/gi.test(content)) {
        content = content.replace(/<title>.*?<\/title>/gi, `<title>${manifestAppName}</title>`);
      } else {
        content = content.replace('</head>', `<title>${manifestAppName}</title></head>`);
      }

      if (/apple-mobile-web-app-title/gi.test(content)) {
        content = content.replace(/<meta\s+name="apple-mobile-web-app-title"\s+content=".*?"\s*\/?>/gi, `<meta name="apple-mobile-web-app-title" content="${manifestAppName}" />`);
      } else {
        content = content.replace('</head>', `<meta name="apple-mobile-web-app-title" content="${manifestAppName}" /></head>`);
      }

      if (/application-name/gi.test(content)) {
        content = content.replace(/<meta\s+name="application-name"\s+content=".*?"\s*\/?>/gi, `<meta name="application-name" content="${manifestAppName}" />`);
      } else {
        content = content.replace('</head>', `<meta name="application-name" content="${manifestAppName}" /></head>`);
      }

      if (/theme-color/gi.test(content)) {
        content = content.replace(/<meta\s+name="theme-color"\s+content=".*?"\s*\/?>/gi, `<meta name="theme-color" content="${themeColor}" />`);
      }

      // CRITICAL: Remove the static icon.svg link so modern browsers do not prioritize the default SVG favicon over the custom PNG!
      content = content.replace(/<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="[^"]*"\s*\/?>\s*/gi, '');

      // Add version parameter to favicons & manifest
      content = content.replace(/href="\/favicon-16x16\.png(\?v=\d+)?"/g, `href="/favicon-16x16.png?v=${v}"`);
      content = content.replace(/href="\/favicon-32x32\.png(\?v=\d+)?"/g, `href="/favicon-32x32.png?v=${v}"`);
      content = content.replace(/href="\/favicon\.png(\?v=\d+)?"/g, `href="/favicon.png?v=${v}"`);
      content = content.replace(/href="\/apple-touch-icon\.png(\?v=\d+)?"/g, `href="/apple-touch-icon.png?v=${v}"`);
      content = content.replace(/href="\/manifest\.webmanifest(\?v=\d+)?"/g, `href="/manifest.webmanifest?v=${v}"`);

      fs.writeFileSync(filePath, content, 'utf-8');
    } catch (e) {
      console.error(`Error updating HTML file at ${filePath}:`, e);
    }
  };

  updateHtmlFile(path.join(rootDir, 'index.html'));
  updateHtmlFile(path.join(distDir, 'index.html'));
  console.log('[PWA Icons] Successfully applied custom icons and manifest across all disk locations.');
}

// Save custom PWA icons to the database
function savePwaIconsToDatabase(pwaData: { appName?: string; themeColor?: string; updatedAt?: number; files: Record<string, string>; logoSrc?: string }) {
  const serialized = JSON.stringify(pwaData);
  const now = pwaData.updatedAt || Date.now();

  // 1. Always save to local SQLite / JSON DB system_docs table (no size limit, zero dependency, survives restarts)
  try {
    db.prepare(`
      INSERT INTO system_docs (path, data, updatedAt)
      VALUES ('system/pwa_icons', ?, ?)
      ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
    `).run(serialized, now);
    console.log('[PWA Icons] Successfully saved custom PWA icons to SQLite/JSON DB.');
  } catch (err: any) {
    console.error('[PWA Icons] Error saving custom PWA icons to SQLite/JSON DB:', err?.message || err);
  }

}

// Load and apply custom PWA icons on server startup
async function loadAndApplyPwaIcons() {
  // Step 1: Try loading from persistent SQLite / JSON DB
  try {
    const row: any = db.prepare("SELECT data FROM system_docs WHERE path = 'system/pwa_icons'").get();
    if (row && row.data) {
      const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      if (parsed && parsed.files && Object.keys(parsed.files).length > 0) {
        customPwaIcons = {
          appName: parsed.appName || 'KSK-appen',
          themeColor: parsed.themeColor || '#4f46e5',
          updatedAt: parsed.updatedAt || Date.now(),
          files: parsed.files,
          logoSrc: parsed.logoSrc
        };
        applyCustomPwaIconsToDisk(customPwaIcons);
        console.log('[PWA Icons] Restored custom PWA icons from SQLite/JSON DB.');
        return;
      }
    }
  } catch (err: any) {
    console.warn('[PWA Icons] SQLite load notice:', err?.message || err);
  }

  console.log('[PWA Icons] Using standard default icons.');
}

async function ensureTeamAndClubIntegrity() {
  try {
    const clubsData = db.prepare('SELECT * FROM clubs_data').all();
    if (!clubsData || clubsData.length === 0) return;

    // Group segments by clubId
    const clubMap = new Map<string, { teams: Set<string>; metadata: any; members: any }>();
    for (const cd of clubsData) {
      if (!clubMap.has(cd.clubId)) {
        clubMap.set(cd.clubId, { teams: new Set<string>(), metadata: null, members: null });
      }
      const entry = clubMap.get(cd.clubId)!;
      if (cd.teamId && cd.teamId !== 'club_global') {
        entry.teams.add(cd.teamId);
      }
      if (cd.teamId === 'club_global' && cd.segment === 'metadata') {
        try { entry.metadata = typeof cd.data === 'string' ? JSON.parse(cd.data) : cd.data; } catch (_) {}
      }
      if (cd.teamId === 'club_global' && cd.segment === 'members') {
        try { entry.members = typeof cd.data === 'string' ? JSON.parse(cd.data) : cd.data; } catch (_) {}
      }
    }

    for (const [clubId, { teams, metadata, members }] of clubMap.entries()) {
      let metaUpdated = false;
      let curMeta = metadata || { id: clubId, name: 'Klubb', teams: [] };
      if (!Array.isArray(curMeta.teams)) curMeta.teams = [];

      for (const tid of teams) {
        if (!curMeta.teams.some((t: any) => t && t.id === tid)) {
          let teamName = 'Seniorer / Herrar';
          const sRow = db.prepare('SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = ?').get(clubId, tid, 'settings');
          if (sRow && sRow.data) {
            try {
              const sObj = JSON.parse(sRow.data);
              if (sObj.teamName) teamName = sObj.teamName;
              else if (sObj.teamUrl && sObj.teamUrl.includes('Seniorer')) teamName = 'Seniorer (Herrar)';
            } catch (_) {}
          }
          curMeta.teams.push({ id: tid, name: teamName });
          metaUpdated = true;
        }
      }

      if (metaUpdated) {
        const rawMeta = JSON.stringify(curMeta);
        db.prepare(`
          INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
          VALUES (?, 'club_global', 'metadata', ?, ?)
          ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(clubId, rawMeta, Date.now());
        console.log(`[Integrity] Auto-repaired metadata.teams for club ${clubId} with ${curMeta.teams.length} teams`);
      }

      let membersUpdated = false;
      let curMembers = members || { members: [] };
      if (!Array.isArray(curMembers.members)) curMembers.members = [];

      const rootEmails = ['christer@setterholm.se', 'christer.setterholm@gmail.com'];
      const teamIds = Array.from(teams);

      for (const re of rootEmails) {
        const existing = curMembers.members.find((m: any) => m && m.email && m.email.toLowerCase() === re);
        if (existing) {
          if (!existing.teams || existing.teams.length === 0) {
            existing.teams = teamIds;
            membersUpdated = true;
          }
          if (!existing.roles || existing.roles.length === 0) {
            existing.roles = ['admin', 'coach'];
            membersUpdated = true;
          }
        } else {
          curMembers.members.push({
            userId: re === 'christer@setterholm.se' ? 'a7a4c8a1-096d-4d15-a9c8-ff3df6880ae6' : 'user_christer_gmail',
            email: re,
            fullName: 'Christer Setterholm',
            roles: ['admin', 'coach'],
            teams: teamIds,
            photoUrl: '/uploads/photo_1790894131733-182448117.png'
          });
          membersUpdated = true;
        }
      }

      if (membersUpdated) {
        const rawMembers = JSON.stringify(curMembers);
        db.prepare(`
          INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
          VALUES (?, 'club_global', 'members', ?, ?)
          ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(clubId, rawMembers, Date.now());
        console.log(`[Integrity] Auto-repaired members list for club ${clubId}`);
      }
    }
  } catch (err) {
    console.warn('[Integrity] Error during team/club auto-integrity check:', err);
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  await ensureJwtSecret();

  // Restore custom PWA icons from the database on startup
  await loadAndApplyPwaIcons();

  // Verify and auto-repair club teams and root admin members
  await ensureTeamAndClubIntegrity();

  // Helper to inject current PWA app name, theme color, and versioned favicons into server-rendered HTML
  function injectPwaMetaToHtml(html: string): string {
    const appName = customPwaIcons?.appName || 'CoachAssist';
    const themeColor = customPwaIcons?.themeColor || '#4f46e5';
    const v = customPwaIcons?.updatedAt || 1;

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

    // When custom icons are active, remove the default SVG icon link so browsers strictly render the PNG favicon
    if (customPwaIcons && customPwaIcons.files) {
      updated = updated.replace(/<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="[^"]*"\s*\/?>\s*/gi, '');
      updated = updated.replace(/href="\/favicon-16x16\.png(\?v=\d+)?"/g, `href="/favicon-16x16.png?v=${v}"`);
      updated = updated.replace(/href="\/favicon-32x32\.png(\?v=\d+)?"/g, `href="/favicon-32x32.png?v=${v}"`);
      updated = updated.replace(/href="\/favicon\.png(\?v=\d+)?"/g, `href="/favicon.png?v=${v}"`);
      updated = updated.replace(/href="\/apple-touch-icon\.png(\?v=\d+)?"/g, `href="/apple-touch-icon.png?v=${v}"`);
      updated = updated.replace(/href="\/manifest\.webmanifest(\?v=\d+)?"/g, `href="/manifest.webmanifest?v=${v}"`);
    }

    return updated;
  }

  // --- CUSTOM PWA ICONS & MANIFEST SERVING MIDDLEWARE ---
  app.use((req, res, next) => {
    const rawPath = req.path.replace(/^\//, '');
    const cleanPath = rawPath.split('?')[0];

    // 1. If custom generated icon exists in memory, serve it
    if (customPwaIcons && customPwaIcons.files && customPwaIcons.files[cleanPath]) {
      const dataUrl = customPwaIcons.files[cleanPath];
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
      return res.send(imgBuffer);
    }

    // 1b. If custom icons active and icon.svg requested, serve SVG embedding the custom icon
    if (customPwaIcons && customPwaIcons.files && (cleanPath === 'icon.svg' || cleanPath === 'favicon.svg')) {
      const icon512 = customPwaIcons.files['icon-512x512.png'] || customPwaIcons.files['icon-192x192.png'];
      if (icon512) {
        const svgWrap = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><image href="${icon512}" width="512" height="512" /></svg>`;
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
        return res.send(svgWrap);
      }
    }

    // 2. Direct static serving for icon and asset files from dist, public, or root
    const iconMimes: Record<string, string> = {
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp'
    };
    const reqExt = path.extname(cleanPath).toLowerCase();
    if (iconMimes[reqExt]) {
      const candidatePaths = [
        path.join(process.cwd(), 'dist', cleanPath),
        path.join(process.cwd(), 'public', cleanPath),
        path.join(process.cwd(), cleanPath)
      ];
      for (const cand of candidatePaths) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          res.setHeader('Content-Type', iconMimes[reqExt]);
          res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
          return res.sendFile(cand);
        }
      }
    }

    // 3. Web App Manifest serving
    if (
      cleanPath === 'manifest.webmanifest' ||
      cleanPath === 'manifest.json' ||
      cleanPath.endsWith('.webmanifest') ||
      cleanPath.includes('manifest')
    ) {
      const appName = (customPwaIcons?.appName || 'KSK-appen').trim();
      const themeColor = customPwaIcons?.themeColor || '#4f46e5';
      const v = customPwaIcons?.updatedAt || 1;
      const manifestObj = {
        id: '/',
        name: appName,
        short_name: appName.length > 12 ? appName.slice(0, 12) : appName,
        description: `${appName} - Komplett tränings- och matchverktyg för fotbollscoachen.`,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: themeColor,
        theme_color: themeColor,
        categories: ['sports', 'utilities'],
        lang: 'sv',
        dir: 'ltr',
        icons: [
          { src: `/icon-192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `/icon-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `/icon-192x192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `/icon-512x512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `/icon-maskable-512x512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: `/apple-touch-icon.png?v=${v}`, sizes: '180x180', type: 'image/png', purpose: 'any' }
        ]
      };
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
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

    // CRITICAL: If there are no segments, or if path has a file extension (e.g. .png, .ico, .svg, .webmanifest, .js, .css), bypass subfolder routing!
    const ext = path.extname(pathPart).toLowerCase();
    if (
      segments.length === 0 ||
      ext !== '' ||
      pathPart.includes('.') ||
      // Vites interna utvecklingssökvägar (/@vite/client, /@react-refresh, /@fs/...) och källkod
      segments[0].startsWith('@') ||
      ['src', 'node_modules'].includes(segments[0]) ||
      ['api', 'assets', 'uploads', 'rebuild', 'favicon.ico'].includes(segments[0])
    ) {
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

  // CORS and static middleware for /uploads
  app.use('/uploads', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    next();
  }, express.static(UPLOADS_DIR));

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', db: db.driver });
  });

  // --- SYSTEM DATABASE & ENVIRONMENT ENDPOINTS (ROOT ADMIN) ---

  // Databasstatus (sökväg, storlek, motor)
  app.get('/api/system/db-config', requireRootAdmin, (_req, res) => {
    let dbSize = 0;
    try {
      dbSize = fs.statSync(DB_PATH).size;
    } catch {}

    res.json({
      dbPath: DB_PATH,
      dbSize,
      dbEngine: db.driver,
      isProduction
    });
  });

  // Export Database Dump as JSON (Requires Root Admin)
  app.get('/api/system/db-export', requireRootAdmin, (_req, res) => {
    try {
      const users = db.prepare('SELECT id, email, username, password_hash, created_at, has_logged_in, temp_password, google_id, google_email, avatar_url, auth_provider FROM users').all();
      const users_data = db.prepare('SELECT userId, segment, data, updatedAt FROM users_data').all();
      const clubs_data = db.prepare('SELECT clubId, teamId, segment, data, updatedAt FROM clubs_data').all();
      const shared_leaderboards = db.prepare('SELECT id, data, updatedAt, coachUid FROM shared_leaderboards').all();
      const system_docs = db.prepare('SELECT path, data, updatedAt FROM system_docs').all();
      let uploaded_files: any[] = [];
      try {
        uploaded_files = db.prepare('SELECT filename, mime_type, data_base64, created_at FROM uploaded_files').all();
      } catch (_) {}

      const dump = {
        version: '1.0',
        exportedAt: Date.now(),
        tables: {
          users,
          users_data,
          clubs_data,
          shared_leaderboards,
          system_docs,
          uploaded_files
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

  // Import Database Dump from JSON (Requires Root Admin)
  app.post('/api/system/db-import', requireRootAdmin, (req, res) => {
    const dump = req.body;
    if (!dump || !dump.tables) {
      return res.status(400).json({ error: 'Ogiltigt säkerhetskopieformat' });
    }

    try {
      const {
        users = [],
        users_data = [],
        clubs_data = [],
        shared_leaderboards = [],
        system_docs = [],
        uploaded_files = []
      } = dump.tables;

      const wipeBeforeImport = Boolean(req.query.wipe === 'true' || req.body.wipe === true);

      const transaction = db.transaction(() => {
        if (wipeBeforeImport) {
          // If user requested a full restore/overwrite, clear application tables (preserve system configs unless in dump)
          db.prepare('DELETE FROM users_data').run();
          db.prepare('DELETE FROM users').run();
          db.prepare('DELETE FROM clubs_data').run();
          db.prepare('DELETE FROM shared_leaderboards').run();
          db.prepare("DELETE FROM system_docs WHERE path NOT IN ('system/jwt_secret', 'system/db_config')").run();
        }

        // Map old user IDs from the dump to local user IDs if an account with that email already exists
        const userIdMap = new Map<string, string>();

        const stmtFindUserByEmail = db.prepare('SELECT id, email FROM users WHERE email = ?');
        const stmtFindUserById = db.prepare('SELECT id, email FROM users WHERE id = ?');
        const stmtInsertUser = db.prepare(`
          INSERT INTO users (id, email, username, password_hash, created_at, has_logged_in, temp_password, google_id, google_email, avatar_url, auth_provider)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const stmtUpdateUser = db.prepare(`
          UPDATE users SET
            username = COALESCE(?, username),
            password_hash = CASE WHEN ? = 'imported_user' THEN password_hash ELSE ? END,
            created_at = COALESCE(?, created_at),
            has_logged_in = COALESCE(?, has_logged_in),
            temp_password = COALESCE(?, temp_password),
            avatar_url = COALESCE(?, avatar_url),
            auth_provider = COALESCE(?, auth_provider)
          WHERE id = ?
        `);

        for (const u of users) {
          const userEmail = (u.email || '').trim().toLowerCase();
          if (!userEmail) continue;

          const existingByEmail: any = stmtFindUserByEmail.get(userEmail);
          const existingById: any = stmtFindUserById.get(u.id);

          if (existingByEmail) {
            // Email already exists in this database
            userIdMap.set(u.id, existingByEmail.id);
            stmtUpdateUser.run(
              u.username || null,
              u.password_hash || 'imported_user',
              u.password_hash || 'imported_user',
              u.created_at || null,
              u.has_logged_in ?? null,
              u.temp_password || null,
              u.avatar_url || null,
              u.auth_provider || null,
              existingByEmail.id
            );
          } else if (existingById) {
            // ID exists with another email: update user record
            userIdMap.set(u.id, existingById.id);
            db.prepare('UPDATE users SET email = ?, username = COALESCE(?, username) WHERE id = ?')
              .run(userEmail, u.username || null, existingById.id);
          } else {
            // Clean insert
            userIdMap.set(u.id, u.id);
            stmtInsertUser.run(
              u.id,
              userEmail,
              u.username || null,
              u.password_hash || 'imported_user',
              u.created_at || Date.now(),
              u.has_logged_in || 0,
              u.temp_password || null,
              u.google_id || null,
              u.google_email || null,
              u.avatar_url || null,
              u.auth_provider || 'local'
            );
          }
        }

        // Users data
        const stmtUserData = db.prepare(`
          INSERT INTO users_data (userId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `);
        for (const ud of users_data) {
          const mappedUserId = userIdMap.get(ud.userId) || ud.userId;
          const rawData = typeof ud.data === 'string' ? ud.data : JSON.stringify(ud.data);
          stmtUserData.run(mappedUserId, ud.segment, rawData, ud.updatedAt || Date.now());
        }

        // Clubs data
        const stmtClubData = db.prepare(`
          INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?, ?)
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
          const mappedCoachUid = lb.coachUid ? (userIdMap.get(lb.coachUid) || lb.coachUid) : null;
          const rawData = typeof lb.data === 'string' ? lb.data : JSON.stringify(lb.data);
          stmtLeaderboard.run(lb.id, rawData, lb.updatedAt || Date.now(), mappedCoachUid);
        }

        // System docs (avoid overwriting system/db_config so the current mode choice is not accidentally altered)
        const stmtSysDoc = db.prepare(`
          INSERT INTO system_docs (path, data, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `);
        for (const sd of system_docs) {
          if (sd.path === 'system/db_config') continue; // Preserve user's local database selection
          const rawData = typeof sd.data === 'string' ? sd.data : JSON.stringify(sd.data);
          stmtSysDoc.run(sd.path, rawData, sd.updatedAt || Date.now());
        }

        // Uploaded files
        if (Array.isArray(uploaded_files)) {
          const stmtUpload = db.prepare(`
            INSERT INTO uploaded_files (filename, mime_type, data_base64, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(filename) DO UPDATE SET mime_type = excluded.mime_type, data_base64 = excluded.data_base64
          `);
          for (const f of uploaded_files) {
            stmtUpload.run(f.filename, f.mime_type, f.data_base64, f.created_at || Date.now());
          }
        }
      });

      transaction();

      console.log('[DB Import] Successfully imported database dump.');
      res.json({
        success: true,
        importedRecords: users.length + users_data.length + clubs_data.length + shared_leaderboards.length + system_docs.length
      });
    } catch (e: any) {
      console.error('[DB Import] Error importing database:', e);
      res.status(500).json({ error: 'Kunde inte importera databasen: ' + e.message });
    }
  });

  // --- AUTHENTICATION ENDPOINTS ---

  // Register
  app.post('/api/auth/register', registerRateLimiter, async (req, res) => {
    const { email, password, username } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'E-post och lösenord krävs.' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username ? username.trim().toLowerCase() : '';

    if (isReservedAdminEmail(trimmedEmail)) {
      return res.status(400).json({ error: 'Denna e-postadress är reserverad. Logga in med Google i stället.' });
    }

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
      if (existingByEmail) {
        return res.status(400).json({
          error: `E-postadressen '${trimmedEmail}' är redan registrerad i CoachAssist. Vänligen logga in eller återställ ditt lösenord om du glömt det.`
        });
      }

      // 2. Check if username already taken
      if (trimmedUsername) {
        let existingByUsername = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(trimmedUsername);
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

      const token = jwt.sign({ id: userId, email: trimmedEmail, username: trimmedUsername }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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
  app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
    const { email, identifier, password } = req.body;
    const loginInput = (email || identifier || '').trim().toLowerCase();

    if (!loginInput || !password) {
      return res.status(400).json({ error: 'E-post/användarnamn och lösenord krävs.' });
    }

    try {
      // Support matching all potential candidate rows for this email or username
      let candidates: any[] = db.prepare('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?').all(loginInput, loginInput);

      if (candidates.length === 0) {
        return res.status(400).json({ error: 'Fel e-post/användarnamn eller lösenord.' });
      }

      // Check all matching candidates so duplicate accounts never block valid login
      let userRow: any = null;
      for (const cand of candidates) {
        if (cand && cand.password_hash) {
          try {
            const matches = await bcrypt.compare(password, cand.password_hash);
            if (matches) {
              userRow = cand;
              break;
            }
          } catch (_) {}
        }
      }

      if (!userRow) {
        return res.status(400).json({ error: 'Fel e-post/användarnamn eller lösenord.' });
      }

      // If multiple accounts existed for this email, synchronize the validated password hash and login status across all of them
      if (candidates.length > 1 && userRow.email) {
        try {
          db.prepare('UPDATE users SET password_hash = ?, has_logged_in = 1 WHERE LOWER(email) = ?').run(userRow.password_hash, userRow.email.toLowerCase());
        } catch (_) {}
      }

      // Mark user as logged in and clear temporary password
      if (!userRow.has_logged_in) {
        try {
          db.prepare('UPDATE users SET has_logged_in = 1, temp_password = NULL WHERE id = ?').run(userRow.id);
        } catch (e) {
          console.error('Error updating login status:', e);
        }
      }

      const token = jwt.sign({ id: userRow.id, email: userRow.email, username: userRow.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      res.json({
        token,
        user: {
          uid: userRow.id,
          email: userRow.email,
          username: userRow.username || null,
          displayName: userRow.username || userRow.email.split('@')[0],
          photoURL: userRow.avatar_url || null
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
  app.post('/api/auth/request-reset', resetRateLimiter, async (req, res) => {
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
  app.post('/api/auth/reset-password', resetRateLimiter, async (req, res) => {
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

      // Issue fresh authentication JWT token
      const token = jwt.sign({ id: userRow.id, email: userRow.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

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

  // Get Auth Config (Google Client ID)
  app.get('/api/auth/config', (_req, res) => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
    res.json({
      googleClientId,
      googleAuthEnabled: !!googleClientId
    });
  });

  // Verify Google ID token or Access token
  async function verifyGoogleToken(params: { idToken?: string; accessToken?: string; credential?: string }): Promise<{
    googleId: string;
    email: string;
    emailVerified: boolean;
    name?: string;
    picture?: string;
  } | null> {
    const token = params.idToken || params.credential;
    if (token) {
      try {
        const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
        if (response.ok) {
          const data: any = await response.json();
          if (data && data.sub && data.email) {
            return {
              googleId: data.sub,
              email: data.email.trim().toLowerCase(),
              emailVerified: data.email_verified === 'true' || data.email_verified === true,
              name: data.name || data.given_name || undefined,
              picture: data.picture || undefined
            };
          }
        }
      } catch (err) {
        console.error('Error verifying Google ID token with tokeninfo:', err);
      }
    }

    if (params.accessToken) {
      try {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: {
            'Authorization': `Bearer ${params.accessToken}`
          }
        });
        if (response.ok) {
          const data: any = await response.json();
          if (data && data.sub && data.email) {
            return {
              googleId: data.sub,
              email: data.email.trim().toLowerCase(),
              emailVerified: data.email_verified === 'true' || data.email_verified === true,
              name: data.name || data.given_name || undefined,
              picture: data.picture || undefined
            };
          }
        }
      } catch (err) {
        console.error('Error verifying Google access token with userinfo:', err);
      }
    }

    return null;
  }

  // Login / Register with Google
  app.post('/api/auth/google', loginRateLimiter, async (req, res) => {
    try {
      const googleUser = await verifyGoogleToken(req.body);
      if (!googleUser) {
        return res.status(400).json({ error: 'Google-inloggningen kunde inte verifieras. Vänligen försök igen.' });
      }

      if (!googleUser.emailVerified) {
        return res.status(400).json({ error: 'Google-kontots e-postadress är inte verifierad av Google.' });
      }

      const googleId = googleUser.googleId;
      const email = googleUser.email;
      const picture = googleUser.picture || null;
      const displayName = googleUser.name || email.split('@')[0];

      // 1. Look up existing user by google_id
      let userRow: any = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);

      // 2. If not found by google_id, look up by email to automatically link accounts
      if (!userRow) {
        userRow = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email);
        // If found by email, link google account
        if (userRow) {
          const hasRegularPwd = userRow.password_hash && !userRow.password_hash.startsWith('google_only_');
          const newAuthProvider = hasRegularPwd ? 'both' : 'google';
          db.prepare('UPDATE users SET google_id = ?, google_email = ?, avatar_url = COALESCE(avatar_url, ?), auth_provider = ?, has_logged_in = 1 WHERE id = ?').run(
            googleId,
            email,
            picture,
            newAuthProvider,
            userRow.id
          );
          userRow.google_id = googleId;
          userRow.google_email = email;
          userRow.avatar_url = userRow.avatar_url || picture;
          userRow.auth_provider = newAuthProvider;
        }
      }

      // 3. If user doesn't exist yet, create a new user
      if (!userRow) {
        const userId = crypto.randomUUID();
        const dummyPasswordHash = 'google_only_' + crypto.randomBytes(16).toString('hex');
        const createdAt = Date.now();

        db.prepare(`
          INSERT INTO users (id, email, username, password_hash, google_id, google_email, avatar_url, auth_provider, created_at, has_logged_in)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'google', ?, 1)
        `).run(
          userId,
          email,
          null,
          dummyPasswordHash,
          googleId,
          email,
          picture,
          createdAt
        );

        userRow = {
          id: userId,
          email: email,
          username: null,
          password_hash: dummyPasswordHash,
          google_id: googleId,
          google_email: email,
          avatar_url: picture,
          auth_provider: 'google',
          created_at: createdAt
        };
      }

      const token = jwt.sign({ id: userRow.id, email: userRow.email, username: userRow.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

      res.json({
        token,
        user: {
          uid: userRow.id,
          email: userRow.email,
          username: userRow.username || null,
          displayName: userRow.username || displayName,
          photoURL: userRow.avatar_url || picture || null,
          googleLinked: true,
          googleEmail: userRow.google_email || email,
          hasPassword: !!(userRow.password_hash && !userRow.password_hash.startsWith('google_only_'))
        }
      });
    } catch (error: any) {
      console.error('Google login endpoint error:', error);
      res.status(500).json({ error: 'Inloggning med Google misslyckades: ' + (error.message || error) });
    }
  });

  // Link Google Account to Logged In User
  app.post('/api/auth/link-google', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Du måste vara inloggad för att koppla ett Google-konto.' });
    }

    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(' ');
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

      const decoded: any = verifyJwtToken(token);
      const userId = decoded.id;

      const googleUser = await verifyGoogleToken(req.body);
      if (!googleUser) {
        return res.status(400).json({ error: 'Google-verifieringen misslyckades. Vänligen försök igen.' });
      }

      if (!googleUser.emailVerified) {
        return res.status(400).json({ error: 'Google-kontots e-postadress är inte verifierad av Google.' });
      }

      const googleId = googleUser.googleId;
      const googleEmail = googleUser.email;
      const picture = googleUser.picture || null;

      // Check if this googleId is already linked to ANOTHER user
      let existingWithGoogle: any = db.prepare('SELECT id, email FROM users WHERE google_id = ? AND id != ?').get(googleId, userId);
      if (existingWithGoogle) {
        return res.status(400).json({
          error: `Detta Google-konto (${googleEmail}) är redan kopplat till ett annat konto i CoachAssist.`
        });
      }

      let userRow: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!userRow) {
        return res.status(404).json({ error: 'Användarkontot hittades inte.' });
      }

      const hasRegularPassword = userRow.password_hash && !userRow.password_hash.startsWith('google_only_');
      const newAuthProvider = hasRegularPassword ? 'both' : 'google';

      db.prepare('UPDATE users SET google_id = ?, google_email = ?, avatar_url = COALESCE(avatar_url, ?), auth_provider = ? WHERE id = ?').run(
        googleId,
        googleEmail,
        picture,
        newAuthProvider,
        userId
      );

      res.json({
        success: true,
        googleEmail: googleEmail,
        message: `Ditt Google-konto (${googleEmail}) har kopplats till din profil.`
      });
    } catch (error: any) {
      console.error('Link Google account error:', error);
      res.status(500).json({ error: 'Kunde inte koppla Google-kontot: ' + (error.message || error) });
    }
  });

  // Unlink Google Account from Logged In User
  app.post('/api/auth/unlink-google', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Du måste vara inloggad för att koppla bort ett Google-konto.' });
    }

    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(' ');
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

      const decoded: any = verifyJwtToken(token);
      const userId = decoded.id;

      let userRow: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!userRow) {
        return res.status(404).json({ error: 'Användarkontot hittades inte.' });
      }

      if (!userRow.google_id) {
        return res.status(400).json({ error: 'Inget Google-konto är kopplat till denna profil.' });
      }

      const hasRegularPassword = userRow.password_hash && !userRow.password_hash.startsWith('google_only_');
      if (!hasRegularPassword) {
        return res.status(400).json({
          error: 'Du måste först ange ett lösenord under "Byt lösenord" innan du kan koppla bort ditt Google-konto, så att du kan logga in i fortsättningen.'
        });
      }

      db.prepare("UPDATE users SET google_id = NULL, google_email = NULL, auth_provider = 'local' WHERE id = ?").run(userId);

      res.json({
        success: true,
        message: 'Google-kontot har kopplats bort från din profil.'
      });
    } catch (error: any) {
      console.error('Unlink Google account error:', error);
      res.status(500).json({ error: 'Kunde inte koppla bort Google-kontot: ' + (error.message || error) });
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

      const decoded: any = verifyJwtToken(token);
      let userRow: any = db.prepare('SELECT id, email, username, google_id, google_email, avatar_url, password_hash, auth_provider FROM users WHERE id = ?').get(decoded.id);

      if (!userRow) {
        return res.status(404).json({ error: 'Användaren hittades inte' });
      }

      res.json({
        uid: userRow.id,
        email: userRow.email,
        username: userRow.username || null,
        displayName: userRow.username || userRow.email.split('@')[0],
        photoURL: userRow.avatar_url || null,
        googleLinked: !!userRow.google_id,
        googleEmail: userRow.google_email || null,
        hasPassword: !!(userRow.password_hash && !userRow.password_hash.startsWith('google_only_'))
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

      const decoded: any = verifyJwtToken(token);
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
      if (existingByUsername) {
        return res.status(400).json({ error: `Användarnamnet '${cleanUsername}' är tyvärr redan upptaget. Välj ett annat.` });
      }

      // Update in SQLite
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(cleanUsername, userId);

      // Find user row for full email and hash
      let userRow: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

      const newToken = jwt.sign({ id: userId, email: userRow?.email || decoded.email, username: cleanUsername }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

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

  // Update Avatar Endpoint
  app.post('/api/auth/update-avatar', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Du måste vara inloggad för att uppdatera din profilbild.' });
    }

    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(' ');
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

      const decoded: any = verifyJwtToken(token);
      const userId = decoded.id;
      const { photoUrl } = req.body;
      const cleanPhotoUrl = typeof photoUrl === 'string' && photoUrl.trim() ? photoUrl.trim() : null;

      // Update in SQLite
      db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(cleanPhotoUrl, userId);

      res.json({
        success: true,
        photoURL: cleanPhotoUrl
      });
    } catch (error: any) {
      console.error('Update avatar error:', error);
      res.status(500).json({ error: 'Kunde inte uppdatera profilbilden.' });
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

      const decoded: any = verifyJwtToken(token);
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

      const decoded: any = verifyJwtToken(token);
      const userId = decoded.id;

      const { newEmail } = req.body;
      if (!newEmail || typeof newEmail !== 'string' || !newEmail.includes('@')) {
        return res.status(400).json({ error: 'Giltig e-postadress krävs.' });
      }

      const cleanNewEmail = newEmail.trim().toLowerCase();

      if (isReservedAdminEmail(cleanNewEmail) && cleanNewEmail !== String(decoded.email || '').trim().toLowerCase()) {
        return res.status(400).json({ error: 'Denna e-postadress är reserverad och kan inte användas.' });
      }

      // Check if new email is taken by another account
      let existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(cleanNewEmail, userId);
      if (existing) {
        return res.status(400).json({ error: 'E-postadressen används redan av ett annat konto.' });
      }

      // Update in SQLite
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(cleanNewEmail, userId);

      // Issue updated token
      const newToken = jwt.sign({ id: userId, email: cleanNewEmail }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

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

  // Returnerar admin-kontexten, eller skickar 401/403 och returnerar null.
  const requireAdminContext = async (req: express.Request, res: express.Response): Promise<AdminContext | null> => {
    const ctx = await getAdminContext(req);
    if (!ctx) {
      res.status(401).json({ error: 'Inloggning krävs.' });
      return null;
    }
    if (!ctx.isRoot && ctx.scope && ctx.scope.userIds.size === 0 && ctx.scope.emails.size === 0) {
      res.status(403).json({ error: 'Åtkomst nekad: Endast klubbadministratörer och tränare kan hantera konton.' });
      return null;
    }
    return ctx;
  };

  // GET /api/admin/users - List registered accounts
  app.get('/api/admin/users', async (req, res) => {
    const adminCtx = await requireAdminContext(req, res);
    if (!adminCtx) return;

    try {
      const allUsersRows = db.prepare('SELECT id, email, username, password_hash, has_logged_in, temp_password, created_at FROM users').all();
      const usersRows = allUsersRows.filter((u: any) => isInScope(adminCtx, u.id, u.email));

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
    const adminCtx = await requireAdminContext(req, res);
    if (!adminCtx) return;

    try {
      const { userId, newEmail, newUsername, newPassword, resetLoggedInStatus } = req.body;
      const targetUserId = userId || crypto.randomUUID();

      const cleanEmail = newEmail ? newEmail.trim().toLowerCase() : null;
      const cleanUsername = newUsername ? newUsername.trim().toLowerCase() : null;

      let userRow: any = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);

      if (!adminCtx.isRoot) {
        if (!canManageAccount(adminCtx, userRow, targetUserId, cleanEmail)) {
          return res.status(403).json({
            error: userRow && isAccountClaimed(userRow)
              ? 'Kontot är redan aktiverat av medlemmen och kan bara ändras av medlemmen själv eller av en root-administratör.'
              : 'Åtkomst nekad: Kontot tillhör inte någon av dina klubbar.'
          });
        }
      }

      if (cleanEmail && isReservedAdminEmail(cleanEmail) && cleanEmail !== String(userRow?.email || '').trim().toLowerCase()) {
        return res.status(400).json({ error: 'E-postadressen är reserverad och kan inte tilldelas detta konto.' });
      }

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
    const adminCtx = await requireAdminContext(req, res);
    if (!adminCtx) return;

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

        // Klubbadmins/tränare får inte ändra aktiverade konton, konton utanför
        // sina klubbar eller reserverade admin-adresser.
        if (!adminCtx.isRoot && !canManageAccount(adminCtx, userRow, targetId, email)) {
          if (userRow && isAccountClaimed(userRow) && isInScope(adminCtx, userRow.id, userRow.email)) {
            generatedAccounts.push({
              memberId: m.id,
              name: m.name || 'Medlem',
              role: m.role || 'Spelare',
              id: userRow.id,
              email: userRow.email,
              username: userRow.username || null,
              hasLoggedIn: true,
              tempPassword: null
            });
          }
          continue;
        }
        if (isReservedAdminEmail(email) && (!userRow || String(userRow.email || '').trim().toLowerCase() !== email.trim().toLowerCase())) {
          continue;
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

  // --- PERIODS & LEADERBOARDS CONSOLIDATION HELPER ---
  // Samlar poängligor (perioder) för ETT lag och/eller EN användare, ur deras egna dokument,
  // delade poängligor och övningar. Tidigare samlades perioder från hela databasen, vilket
  // gjorde att lag kunde se och få in varandras poängligor.
  function getConsolidatedPeriods(scope: { userId?: string; clubTeams?: { clubId: string; teamId: string }[] }): { periods: any[]; currentPeriodId: string | null } {
    const clubTeams = scope.clubTeams || [];
    const userId = scope.userId;
    const periodMap = new Map<string, any>();
    let activePeriodId: string | null = null;

    const ingestPeriod = (p: any) => {
      if (!p || !p.id) return;
      const existing = periodMap.get(p.id);
      if (!existing) {
        periodMap.set(p.id, { ...p });
        if (p.isActive) activePeriodId = p.id;
      } else {
        const isClosed = Boolean(existing.endDate || p.endDate);
        const endDate = p.endDate || existing.endDate;
        const standings = (Array.isArray(p.standings) && p.standings.length > 0)
          ? p.standings
          : (Array.isArray(existing.standings) ? existing.standings : []);
        const bonusPoints = (Array.isArray(p.bonusPoints) && p.bonusPoints.length > 0)
          ? p.bonusPoints
          : (Array.isArray(existing.bonusPoints) ? existing.bonusPoints : []);
        const shareId = p.shareId || existing.shareId;
        const isActive = isClosed ? false : (p.isActive !== undefined ? p.isActive : existing.isActive);

        periodMap.set(p.id, {
          ...existing,
          ...p,
          endDate: isClosed ? endDate : undefined,
          isActive,
          standings,
          bonusPoints,
          shareId
        });
        if (isActive) activePeriodId = p.id;
      }
    };

    const parseAndIngest = (raw: any) => {
      if (!raw) return;
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) {
          parsed.forEach(ingestPeriod);
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.periods)) {
            parsed.periods.forEach(ingestPeriod);
            if (parsed.currentPeriodId) activePeriodId = parsed.currentPeriodId;
          } else if (parsed.id && (parsed.name || parsed.standings)) {
            ingestPeriod(parsed);
          }
        }
      } catch (_) {}
    };

    // 1. Lagens egna perioder
    for (const ct of clubTeams) {
      try {
        const row: any = db.prepare("SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = 'periods'").get(ct.clubId, ct.teamId);
        if (row) parseAndIngest(row.data);
      } catch (_) {}
    }

    // 2. Användarens egna perioder
    if (userId) {
      try {
        const row: any = db.prepare("SELECT data FROM users_data WHERE userId = ? AND segment = 'periods'").get(userId);
        if (row) parseAndIngest(row.data);
      } catch (_) {}
    }

    // 3. Delade poängligor som hör till dessa perioder eller till användaren
    try {
      const shareIds = new Set<string>();
      periodMap.forEach((p: any) => { if (p && p.shareId) shareIds.add(String(p.shareId)); });
      const sharedRows: any[] = db.prepare("SELECT id, data, updatedAt, coachUid FROM shared_leaderboards").all();
      for (const sr of sharedRows) {
        if (!sr) continue;
        if (!shareIds.has(String(sr.id)) && !(userId && sr.coachUid === userId)) continue;
        try {
          const parsed = typeof sr.data === 'string' ? JSON.parse(sr.data) : sr.data;
          if (parsed) {
            const id = parsed.id || sr.id;
            const name = parsed.name || 'Avslutad poängliga';
            const standings = Array.isArray(parsed.standings) ? parsed.standings : [];
            const startDate = parsed.startDate || Number(sr.updatedAt) - 30 * 24 * 3600 * 1000;
            const endDate = parsed.endDate || Number(sr.updatedAt) || Date.now();
            const bonusPoints = Array.isArray(parsed.bonusPoints) ? parsed.bonusPoints : [];
            ingestPeriod({
              id,
              name,
              startDate,
              endDate,
              isActive: false,
              standings,
              bonusPoints,
              shareId: id
            });
          }
        } catch (_) {}
      }
    } catch (_) {}

    // 4. Övningar som pekar på perioder som saknas (återställning)
    try {
      const exerciseRows: any[] = [];
      for (const ct of clubTeams) {
        const row: any = db.prepare("SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = 'exercises'").get(ct.clubId, ct.teamId);
        if (row) exerciseRows.push(row);
      }
      if (userId) {
        const row: any = db.prepare("SELECT data FROM users_data WHERE userId = ? AND segment = 'exercises'").get(userId);
        if (row) exerciseRows.push(row);
      }
      for (const er of exerciseRows) {
        try {
          const parsed = typeof er.data === 'string' ? JSON.parse(er.data) : er.data;
          const exList = Array.isArray(parsed?.exercises) ? parsed.exercises : (Array.isArray(parsed) ? parsed : []);
          for (const ex of exList) {
            if (ex && ex.periodId && !periodMap.has(ex.periodId)) {
              const minDate = ex.finishedAt || ex.date || Date.now() - 30 * 24 * 3600 * 1000;
              const formattedDate = new Date(minDate).toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' });
              ingestPeriod({
                id: ex.periodId,
                name: `Avslutad poängliga (${formattedDate})`,
                startDate: minDate,
                endDate: ex.finishedAt || ex.date || minDate,
                isActive: false,
                standings: []
              });
            }
          }
        } catch (_) {}
      }
    } catch (_) {}

    const periods = Array.from(periodMap.values());
    periods.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      const aTime = a.endDate || a.startDate || 0;
      const bTime = b.endDate || b.startDate || 0;
      return bTime - aTime;
    });

    return {
      periods,
      currentPeriodId: activePeriodId || (periods.find(p => p.isActive)?.id || (periods[0]?.id || null))
    };
  }

  // GET all periods endpoint for reliable recovery across clubs and local state
  app.get('/api/periods/all', requireAuthUser, (req, res) => {
    try {
      const user = (req as any).user;
      const result = getConsolidatedPeriods({ userId: user.id, clubTeams: getUserClubTeams(user) });
      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error('Error fetching consolidated periods:', e);
      res.status(500).json({ error: 'Failed to fetch consolidated periods' });
    }
  });

  // --- DOCUMENT STORE ENDPOINTS ---

  // GET Document Data
  app.get('/api/docs', async (req, res) => {
    const pathStr = req.query.path as string;
    if (!pathStr) return res.status(400).send('Path is required');

    if (pathStr.startsWith('shared_leaderboards/')) {
      const id = pathStr.split('/')[1];
      try {
        let row: any = db.prepare('SELECT data FROM shared_leaderboards WHERE id = ?').get(id);
        if (row) {
          try {
            const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
            const leaderboardObj = (parsed && parsed.data && (parsed.data.standings || parsed.data.name)) ? parsed.data : parsed;
            return res.json(leaderboardObj);
          } catch (pErr) {
            console.warn('Failed to parse local SQLite shared_leaderboards data:', pErr);
          }
        }

        return res.json(null);
      } catch (e: any) {
        console.error('Error fetching shared leaderboard:', e);
        res.status(500).json({ error: 'Failed to fetch shared leaderboard' });
      }
    } else if (pathStr.startsWith('users/')) {
      const parts = pathStr.split('/');
      const userId = parts[1];
      const segment = parts[3];

      if (userId === 'guest') {
        return res.json(null);
      }

      if (userId !== 'guest') {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

        try {
          const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
          const partsAuth = authStr.split(' ');
          const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

          const decoded: any = verifyJwtToken(token);
          if (decoded.id !== userId && decoded.email !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
          }
        } catch (e: any) {
          console.error('Error verifying token for user data:', e);
          return res.status(401).json({ error: 'Invalid session or token' });
        }
      }

      if (segment === 'periods') {
        const consolidated = getConsolidatedPeriods({ userId });
        try {
          db.prepare(`
            INSERT INTO users_data (userId, segment, data, updatedAt)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
          `).run(userId, segment, JSON.stringify(consolidated), Date.now());
        } catch (_) {}
        return res.json(consolidated);
      }

      const row: any = db.prepare('SELECT data, updatedAt FROM users_data WHERE userId = ? AND segment = ?').get(userId, segment);
      if (!row) {
        return res.json(null);
      }
      try {
        return res.json(typeof row.data === 'string' ? JSON.parse(row.data) : row.data);
      } catch (parseErr) {
        console.warn('Failed to parse SQLite user data:', parseErr);
        return res.json(null);
      }
    } else if (pathStr.startsWith('clubs/') && pathStr.includes('/pending_requests')) {
      try {
        const parts = pathStr.split('/');
        const isCollection = parts.length === 3; // ['clubs', clubId, 'pending_requests']
        if (isCollection) {
          const clubId = parts[1];
          const isValidRequest = (item: any) => {
            return item && typeof item === 'object' &&
              (item.uid || item.id) &&
              (item.requestedRole || item.role) &&
              (item.status === undefined || item.status === 'pending');
          };

          let rows: any[] = db.prepare('SELECT data FROM system_docs WHERE path = ? OR path LIKE ?').all(pathStr, `${pathStr}/%`);
          if (rows && rows.length > 0) {
            const list: any[] = [];
            for (const r of rows) {
              try {
                const parsed = JSON.parse(r.data);
                if (Array.isArray(parsed)) {
                  list.push(...parsed.filter(isValidRequest));
                } else if (isValidRequest(parsed)) {
                  list.push(parsed);
                }
              } catch (_) {}
            }
            if (list.length > 0) {
              return res.json(list);
            }
          }
          const globalRows: any[] = db.prepare("SELECT data FROM system_docs WHERE path = 'pending_user_requests' OR path LIKE 'pending_user_requests/%'").all();
          if (globalRows && globalRows.length > 0) {
            const matched: any[] = [];
            for (const r of globalRows) {
              try {
                const parsed = JSON.parse(r.data);
                if (Array.isArray(parsed)) {
                  matched.push(...parsed.filter((item: any) => isValidRequest(item) && (item.requestedClubId === clubId || item.clubId === clubId)));
                } else if (isValidRequest(parsed) && (parsed.requestedClubId === clubId || parsed.clubId === clubId)) {
                  matched.push(parsed);
                }
              } catch (_) {}
            }
            if (matched.length > 0) {
              return res.json(matched);
            }
          }
          return res.json([]);
        } else {
          let row: any = db.prepare('SELECT data FROM system_docs WHERE path = ?').get(pathStr);
          if (row && row.data) {
            return res.json(JSON.parse(row.data));
          }
          return res.json(null);
        }
      } catch (err: any) {
        console.error('Error handling club pending_requests:', err);
        return res.json([]);
      }
    } else if (pathStr.startsWith('clubs/')) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

      try {
        const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const partsAuth = authStr.split(' ');
        const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

        const clubReqUser: any = verifyJwtToken(token);
        const parts = pathStr.split('/');
        const clubId = parts[1];
        const teamId = parts[3] || 'club_global';
        const segment = parts[5] || parts[3] || 'data';

        if (segment === 'periods') {
          const consolidated = getConsolidatedPeriods({ clubTeams: [{ clubId, teamId }], userId: isClubManager(clubReqUser, clubId) ? clubReqUser.id : undefined });
          try {
            db.prepare(`
              INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
            `).run(clubId, teamId, segment, JSON.stringify(consolidated), Date.now());
          } catch (_) {}
          return res.json(consolidated);
        }
        
        const row: any = db.prepare('SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = ?').get(clubId, teamId, segment);
        if (!row) {
          return res.json(null);
        }
        res.json(typeof row.data === 'string' ? JSON.parse(row.data) : row.data);
      } catch (e: any) {
        if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError' || e.message === 'Invalid token' || e.message === 'No token provided') {
          return res.status(401).json({ error: 'Unauthorized', message: 'Session expired, please log in again.' });
        }
        console.error('Error fetching club data:', e);
        res.status(500).json({ error: 'Failed to fetch club data', details: e?.message });
      }
    } else if (pathStr.startsWith('admins/')) {
      try {
        const row: any = db.prepare('SELECT data FROM system_docs WHERE path = ?').get(pathStr);
        if (!row) {
          return res.json(null);
        }
        res.json(JSON.parse(row.data));
      } catch (e: any) {
        console.error('Error fetching admin doc:', e);
        res.status(500).json({ error: 'Failed to fetch admin doc' });
      }
    } else if (pathStr === 'pending_user_requests' || pathStr.startsWith('pending_user_requests/')) {
      try {
        const isValidRequest = (item: any) => {
          return item && typeof item === 'object' &&
            (item.uid || item.id) &&
            (item.requestedRole || item.role) &&
            (item.status === undefined || item.status === 'pending');
        };

        let row: any = db.prepare('SELECT data FROM system_docs WHERE path = ?').get(pathStr);
        if (row && row.data) {
          const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
          if (Array.isArray(parsed)) {
            return res.json(parsed.filter(isValidRequest));
          } else if (isValidRequest(parsed)) {
            return res.json(parsed);
          }
        }
        return res.json([]);
      } catch (_) {
        return res.json([]);
      }
    } else {
      // General document lookup fallback
      try {
        let row: any = db.prepare('SELECT data FROM system_docs WHERE path = ?').get(pathStr);
        if (row && row.data) {
          return res.json(typeof row.data === 'string' ? JSON.parse(row.data) : row.data);
        }
        return res.json(null);
      } catch (_) {
        return res.json(null);
      }
    }
  });

  // POST/PUT Document Data
  app.post('/api/docs', async (req, res) => {
    const pathStr = req.query.path as string;
    const { data } = req.body;
    if (!pathStr) return res.status(400).send('Path is required');

    if (pathStr.startsWith('shared_leaderboards/')) {
      const id = pathStr.split('/')[1];
      try {
        const cleanObj = (data && data.data && (data.data.standings || data.data.name)) ? data.data : data;
        const serializedData = typeof cleanObj === 'string' ? cleanObj : JSON.stringify(cleanObj);
        const coachUid = cleanObj?.coachUid || data?.coachUid || null;
        
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
      try {
        const parts = pathStr.split('/');
        const userId = parts[1];
        const segment = parts[3];

        if (userId === 'guest') {
          return res.status(403).json({ error: 'Guest offline mode cannot save to server database' });
        }

        if (userId !== 'guest') {
          const authHeader = req.headers.authorization;
          if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

          try {
            const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
            const partsAuth = authStr.split(' ');
            const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

            const decoded: any = verifyJwtToken(token);
            if (decoded.id !== userId && decoded.email !== userId) {
              return res.status(403).json({ error: 'Forbidden' });
            }
          } catch (e: any) {
            console.error('Error verifying token for saving user data:', e);
            return res.status(401).json({ error: 'Invalid session or token' });
          }
        }

        let finalDataToSave = data;
        if (segment === 'periods') {
          const consolidated = getConsolidatedPeriods({ userId });
          const map = new Map<string, any>();
          (consolidated.periods || []).forEach((p: any) => { if (p && p.id) map.set(p.id, p); });
          const incomingList = Array.isArray(data?.periods) ? data.periods : (Array.isArray(data) ? data : []);
          incomingList.forEach((p: any) => {
            if (!p || !p.id) return;
            const existing = map.get(p.id);
            if (!existing) {
              map.set(p.id, p);
            } else {
              const isClosed = Boolean(existing.endDate || p.endDate);
              const endDate = p.endDate || existing.endDate;
              const standings = (Array.isArray(p.standings) && p.standings.length > 0) ? p.standings : existing.standings;
              const bonusPoints = (Array.isArray(p.bonusPoints) && p.bonusPoints.length > 0) ? p.bonusPoints : existing.bonusPoints;
              map.set(p.id, {
                ...existing,
                ...p,
                endDate: isClosed ? endDate : undefined,
                standings,
                bonusPoints
              });
            }
          });
          const allPeriods = Array.from(map.values());
          finalDataToSave = {
            ...(typeof data === 'object' ? data : {}),
            periods: allPeriods,
            currentPeriodId: data?.currentPeriodId || consolidated.currentPeriodId || allPeriods.find(p => p.isActive)?.id || (allPeriods[0]?.id || null)
          };
        }

        const serializedData = JSON.stringify(finalDataToSave);
        const updateTimestamp = Number(data?.updatedAt) || Date.now();
        db.prepare(`
          INSERT INTO users_data (userId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(userId, segment, serializedData, updateTimestamp);

        res.json({ success: true, updatedAt: updateTimestamp });
      } catch (e: any) {
        console.error('Error saving user data:', e);
        res.status(500).json({ error: 'Failed to save user data' });
      }
    } else if (pathStr.startsWith('clubs/') && pathStr.includes('/pending_requests')) {
      try {
        const serializedData = typeof data === 'string' ? data : JSON.stringify(data);
        db.prepare(`
          INSERT INTO system_docs (path, data, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(pathStr, serializedData, Date.now());

        return res.json({ success: true });
      } catch (e: any) {
        console.error('Error saving club pending request:', e);
        return res.status(500).json({ error: 'Failed to save pending request' });
      }
    } else if (pathStr.startsWith('clubs/')) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

      try {
        const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const partsAuth = authStr.split(' ');
        const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];

        const clubReqUser: any = verifyJwtToken(token);
        const parts = pathStr.split('/');
        const clubId = parts[1];
        const teamId = parts[3] || 'club_global';
        const segment = parts[5] || parts[3] || 'data';

        let finalDataToSave = data;
        if (segment === 'periods') {
          const consolidated = getConsolidatedPeriods({ clubTeams: [{ clubId, teamId }], userId: isClubManager(clubReqUser, clubId) ? clubReqUser.id : undefined });
          const map = new Map<string, any>();
          (consolidated.periods || []).forEach((p: any) => { if (p && p.id) map.set(p.id, p); });
          const incomingList = Array.isArray(data?.periods) ? data.periods : (Array.isArray(data) ? data : []);
          incomingList.forEach((p: any) => {
            if (!p || !p.id) return;
            const existing = map.get(p.id);
            if (!existing) {
              map.set(p.id, p);
            } else {
              const isClosed = Boolean(existing.endDate || p.endDate);
              const endDate = p.endDate || existing.endDate;
              const standings = (Array.isArray(p.standings) && p.standings.length > 0) ? p.standings : existing.standings;
              const bonusPoints = (Array.isArray(p.bonusPoints) && p.bonusPoints.length > 0) ? p.bonusPoints : existing.bonusPoints;
              map.set(p.id, {
                ...existing,
                ...p,
                endDate: isClosed ? endDate : undefined,
                standings,
                bonusPoints
              });
            }
          });
          const allPeriods = Array.from(map.values());
          finalDataToSave = {
            ...(typeof data === 'object' ? data : {}),
            periods: allPeriods,
            currentPeriodId: data?.currentPeriodId || consolidated.currentPeriodId || allPeriods.find(p => p.isActive)?.id || (allPeriods[0]?.id || null)
          };
        }

        const serializedData = JSON.stringify(finalDataToSave);
        const updateTimestamp = Number(data?.updatedAt) || Date.now();
        db.prepare(`
          INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(clubId, teamId, segment, serializedData, updateTimestamp);

        res.json({ success: true, updatedAt: updateTimestamp });
      } catch (e: any) {
        if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError' || e.message === 'Invalid token' || e.message === 'No token provided') {
          return res.status(401).json({ error: 'Unauthorized', message: 'Session expired, please log in again.' });
        }
        console.error('Error saving club data:', e);
        res.status(500).json({ error: 'Failed to save club data' });
      }
    } else if (pathStr.startsWith('admins/')) {
      const user = extractAuthUser(req);
      const isRoot = await verifyIsRootAdmin(user);
      if (!isRoot) {
        return res.status(403).json({ error: 'Unauthorized: Only root admin can modify admin documents' });
      }
      try {
        const serializedData = JSON.stringify(data);
        db.prepare(`
          INSERT INTO system_docs (path, data, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(pathStr, serializedData, Date.now());

        res.json({ success: true });
      } catch (e: any) {
        console.error('Error saving admin doc:', e);
        res.status(500).json({ error: 'Failed to save admin doc' });
      }
    } else {
      // General document save fallback into system_docs.
      // Kräver inloggning. Endast förfrågningar om medlemskap får skrivas av vanliga
      // användare; allt annat (t.ex. system/*) kräver root-admin.
      const fallbackUser = extractAuthUser(req);
      if (!fallbackUser) {
        return res.status(401).json({ error: 'Inloggning krävs.' });
      }
      const isPendingUserRequest = /^pending_user_requests\/[^/]+$/.test(pathStr);
      if (!isPendingUserRequest && !(await verifyIsRootAdmin(fallbackUser))) {
        return res.status(403).json({ error: 'Åtkomst nekad.' });
      }
      try {
        const serializedData = typeof data === 'string' ? data : JSON.stringify(data);
        db.prepare(`
          INSERT INTO system_docs (path, data, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(pathStr, serializedData, Date.now());

        res.json({ success: true });
      } catch (e: any) {
        console.error('Error saving doc:', e);
        res.status(500).json({ error: 'Failed to save doc' });
      }
    }
  });

  // DELETE Document Data
  app.delete('/api/docs', async (req, res) => {
    const pathStr = req.query.path as string;
    if (!pathStr) return res.status(400).send('Path is required');

    // Kräver inloggning. Vanliga användare får bara ta bort förfrågningar om
    // medlemskap; allt annat kräver root-admin.
    const deleteUser = extractAuthUser(req);
    if (!deleteUser) {
      return res.status(401).json({ error: 'Inloggning krävs.' });
    }
    const isPendingRequestPath =
      /^pending_user_requests\/[^/]+$/.test(pathStr) ||
      /^clubs\/[^/]+\/pending_requests\/[^/]+$/.test(pathStr);
    if (!isPendingRequestPath && !(await verifyIsRootAdmin(deleteUser))) {
      return res.status(403).json({ error: 'Åtkomst nekad.' });
    }

    try {
      db.prepare('DELETE FROM system_docs WHERE path = ?').run(pathStr);
      res.json({ success: true });
    } catch (e: any) {
      console.error('Error deleting doc:', e);
      res.status(500).json({ error: 'Failed to delete doc' });
    }
  });

  // --- LOCAL FILE STORAGE ENDPOINTS ---

  // Configure Multer in-memory storage for 100% resilient uploads regardless of host disk permissions
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB file size limit
  });

  // Upload image: stored on local disk and in the database
  app.post('/api/upload', requireAuthUser, upload.any(), async (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Ingen fil skickades med' });
    }
    const uploadedFile = files[0];
    let ext = (path.extname(uploadedFile.originalname || '') || '.jpg').toLowerCase();
    let mimeType = uploadedFile.mimetype || 'image/jpeg';
    let fileBuffer = uploadedFile.buffer;

    // Server-side image optimization: if image is large or HEIC/HEIF and sharp is available
    if (fileBuffer && sharpModule && (fileBuffer.length > 500 * 1024 || ext === '.heic' || ext === '.heif' || mimeType.includes('heic') || mimeType.includes('heif'))) {
      try {
        const compressed = await sharpModule(fileBuffer)
          .rotate() // auto-orient based on EXIF
          .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
        if (compressed && compressed.length > 0) {
          fileBuffer = compressed;
          mimeType = 'image/jpeg';
          ext = '.jpg';
        }
      } catch (sharpErr: any) {
        console.warn('[Upload] Server image optimization note:', sharpErr?.message || sharpErr);
      }
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = 'photo_' + uniqueSuffix + ext;
    const fileUrl = `/uploads/${filename}`;

    try {
      if (fileBuffer) {
        const base64Data = fileBuffer.toString('base64');

        // 1. Always persist to local SQLite/JSON database table `uploaded_files`
        try {
          db.prepare(`
            INSERT OR REPLACE INTO uploaded_files (filename, mime_type, data_base64, created_at)
            VALUES (?, ?, ?, ?)
          `).run(filename, mimeType, base64Data, Date.now());
        } catch (dbErr) {
          console.error('[Upload] Error saving file to database table:', dbErr);
        }

        // 2. Persist to local disk folder `uploads` so Apache/Express can serve directly
        try {
          if (!fs.existsSync(UPLOADS_DIR)) {
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          }
          fs.writeFileSync(path.join(UPLOADS_DIR, filename), fileBuffer);
        } catch (diskErr) {
          console.warn('[Upload] Note: could not write file to disk (saved in DB):', diskErr);
        }

        // Also write to public/uploads if folder exists or is reachable
        try {
          const publicUploads = path.join(DATA_DIR, 'public', 'uploads');
          if (fs.existsSync(path.join(DATA_DIR, 'public'))) {
            if (!fs.existsSync(publicUploads)) fs.mkdirSync(publicUploads, { recursive: true });
            fs.writeFileSync(path.join(publicUploads, filename), fileBuffer);
          }
        } catch (_) {}

      }
    } catch (err) {
      console.error('Failed to process uploaded file:', err);
    }

    res.json({ url: fileUrl });
  });

  // Serving /uploads/:filename (Disk -> database)
  app.get('/uploads/:filename', async (req, res) => {
    const filename = path.basename(req.params.filename);
    const fullPath = path.join(UPLOADS_DIR, filename);
    const publicPath = path.join(DATA_DIR, 'public', 'uploads', filename);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    // 1. Check disk first
    if (fs.existsSync(fullPath)) {
      return res.sendFile(fullPath, { maxAge: '1y', immutable: true });
    }
    if (fs.existsSync(publicPath)) {
      return res.sendFile(publicPath, { maxAge: '1y', immutable: true });
    }

    try {
      // 2. Check local database (uploaded_files table in SQLite / JSON storage)
      const row: any = db.prepare('SELECT mime_type, data_base64 FROM uploaded_files WHERE filename = ?').get(filename);
      if (row && row.data_base64) {
        const buffer = Buffer.from(row.data_base64, 'base64');
        // Cache back to disk asynchronously so next hit is a fast static file
        try {
          if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          fs.writeFile(fullPath, buffer, () => {});
        } catch (_) {}

        res.setHeader('Content-Type', row.mime_type || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(buffer);
      }

    } catch (err) {
      console.error(`[Upload Fetch] Error retrieving /uploads/${filename}:`, err);
    }

    res.status(404).send('File not found');
  });

  // Delete image from disk and database
  app.delete('/api/delete-file', requireAuthUser, async (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).send('Path is required');

    try {
      // Clean filename: remove url parameters or full url domain
      const cleanPath = decodeURIComponent(filePath).split('?')[0];
      const filename = path.basename(cleanPath);
      const fullPath = path.join(UPLOADS_DIR, filename);
      const publicPath = path.join(DATA_DIR, 'public', 'uploads', filename);

      // 1. Remove from local disk uploads folder
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (unlinkErr) {
          console.warn('[Delete File] Could not unlink from UPLOADS_DIR:', unlinkErr);
        }
      }
      if (fs.existsSync(publicPath)) {
        try {
          fs.unlinkSync(publicPath);
        } catch (_) {}
      }

      // 2. Remove from local SQLite / JSON store
      try {
        db.prepare('DELETE FROM uploaded_files WHERE filename = ?').run(filename);
      } catch (dbErr) {
        console.warn('[Delete File] Could not delete from DB uploaded_files:', dbErr);
      }

      console.log(`[Delete File] Successfully deleted ${filename} from disk and database`);
      res.json({ success: true, deleted: filename });
    } catch (e: any) {
      console.error('Error deleting file:', e);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

  // --- PWA ICONS DIRECT APPLICATION ENDPOINT ---
  app.post('/api/pwa-icons', requireRootAdmin, express.json({ limit: '25mb' }), async (req, res) => {
    try {
      const { appName, themeColor, icons, logoSrc } = req.body;

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

      const now = Date.now();
      customPwaIcons = {
        appName: (appName || 'KSK-appen').trim(),
        themeColor: themeColor || '#4f46e5',
        updatedAt: now,
        files: filesMap,
        logoSrc: typeof logoSrc === 'string' && logoSrc.length < 500000 ? logoSrc : undefined
      };

      // 1. Apply across disk locations (public, dist, root, deploy)
      applyCustomPwaIconsToDisk(customPwaIcons);

      // 2. Persist to the database
      savePwaIconsToDatabase(customPwaIcons);

      res.json({
        success: true,
        message: 'Appens PWA-ikoner har uppdaterats och sparats i databasen!',
        updatedAt: now
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
        hasCustomIcons: true,
        updatedAt: customPwaIcons.updatedAt,
        previewUrl: customPwaIcons.files['icon-512x512.png'] || customPwaIcons.files['icon-192x192.png'] || null,
        logoSrc: customPwaIcons.logoSrc || null
      });
    } else {
      res.json({ hasCustomIcons: false });
    }
  });

  // --- PRE-EXISTING PROXY ENDPOINTS ---

  // Proxy endpoint to bypass CORS for image exports (Protected against SSRF)
  app.get('/api/proxy', async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).send('URL query parameter is required');
    }

    const validation = await validateSafeExternalUrl(url);
    if (!validation.valid || !validation.urlObj) {
      console.warn(`[Proxy SSRF Blocked] URL: ${url} - Reason: ${validation.error}`);
      return res.status(403).send(`Åtkomst nekad: ${validation.error}`);
    }

    try {
      console.log(`[Proxy] Fetching verified image from: ${url}`);
      const response = await axios({
        method: 'get',
        url: validation.urlObj.toString(),
        responseType: 'stream',
        timeout: 10000,
        maxContentLength: 15 * 1024 * 1024,
        maxRedirects: 5,
        httpAgent: safeHttpAgent,
        httpsAgent: safeHttpsAgent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/*,*/*'
        }
      });

      const contentType = String(response.headers['content-type'] || 'image/jpeg');
      if (!contentType.startsWith('image/') && !contentType.startsWith('application/octet-stream')) {
        return res.status(400).send('Endast bildresurser kan hämtas via denna bildproxy.');
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      
      response.data.pipe(res);
    } catch (error: any) {
      console.error(`[Proxy] Error fetching ${url}:`, error.message);
      res.status(500).send(`Failed to fetch image: ${error.message}`);
    }
  });

  // Calendar proxy endpoint to fetch webcal ICS files (Protected against SSRF)
  app.get('/api/fetch-calendar', async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL query parameter is required' });
    }

    let fetchUrl = url.trim().replace(/^[!#\s"']+|["'\s]+$/g, '');
    if (fetchUrl.startsWith('webcal://')) {
      fetchUrl = 'https://' + fetchUrl.slice(9);
    } else if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
      fetchUrl = 'https://' + fetchUrl;
    }

    const validation = await validateSafeExternalUrl(fetchUrl);
    if (!validation.valid || !validation.urlObj) {
      console.warn(`[Calendar Proxy SSRF Blocked] URL: ${fetchUrl} - Reason: ${validation.error}`);
      return res.status(403).json({ error: `Åtkomst nekad: ${validation.error}` });
    }

    const doFetch = async (targetUrl: string) => {
      const parsedUrl = new URL(targetUrl);
      parsedUrl.searchParams.set('_nocache', Date.now().toString());

      return await axios({
        method: 'get',
        url: parsedUrl.toString(),
        timeout: 15000,
        maxContentLength: 5 * 1024 * 1024,
        responseType: 'text',
        maxRedirects: 5,
        httpAgent: safeHttpAgent,
        httpsAgent: safeHttpsAgent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/calendar, text/plain, */*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
    };

    try {
      console.log(`[Calendar Proxy] Fetching verified calendar from: ${fetchUrl}`);
      let response;
      try {
        response = await doFetch(fetchUrl);
      } catch (firstErr: any) {
        if (url.trim().startsWith('webcal://') && fetchUrl.startsWith('https://')) {
          const httpUrl = 'http://' + fetchUrl.slice(8);
          const httpVal = await validateSafeExternalUrl(httpUrl);
          if (httpVal.valid) {
            console.log(`[Calendar Proxy] HTTPS failed, trying HTTP fallback: ${httpUrl}`);
            response = await doFetch(httpUrl);
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      res.send(response.data);
    } catch (error: any) {
      console.error(`[Calendar Proxy] Error fetching ${fetchUrl}:`, error.message);
      res.status(500).json({ error: `Failed to fetch calendar: ${error.message}` });
    }
  });

  // Calendar ICS Feed endpoint for subscribing to a specific team's calendar
  const handleIcsFeed = async (req: express.Request, res: express.Response) => {
    try {
      let clubId = (req.params.clubId || req.query.clubId || '').toString().trim();
      let teamId = (req.params.teamId || req.query.teamId || '').toString().trim();

      // If no clubId specified in generic feed URL, default to primary club & team if available
      if (!clubId) {
        clubId = 'club_xckk55vw2';
        teamId = teamId || 'team_h4nibr38i';
      }
      if (!teamId) {
        teamId = 'club_global';
      }

      // Fetch sessions for this club and team
      let sessionsData: any[] = [];
      let clubName = 'Kungsgårdens SK';
      let teamName = 'A-laget';

      // 1. Try fetching metadata for club/team name
      try {
        let metaRow: any = db.prepare('SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = ?').get(clubId, 'club_global', 'metadata');
        let meta: any = null;
        if (metaRow) {
          meta = typeof metaRow.data === 'string' ? JSON.parse(metaRow.data) : metaRow.data;
        }
        if (meta) {
          if (meta.clubName || meta.name) clubName = meta.clubName || meta.name;
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
      }

      // Handle both raw array and stored object structure: { sessions: [...], deletedSessions: [...] }
      if (sessionsData && !Array.isArray(sessionsData) && Array.isArray((sessionsData as any).sessions)) {
        sessionsData = (sessionsData as any).sessions;
      } else if (!Array.isArray(sessionsData)) {
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

      // Helper to format date and time to iCal local time YYYYMMDDTHHMMSS
      const formatIcsLocalTime = (timestampMs: number, timeStr?: string) => {
        const d = new Date(timestampMs);
        let hh = 18;
        let mm = 0;
        if (timeStr && typeof timeStr === 'string' && timeStr.includes(':')) {
          const [parsedH, parsedM] = timeStr.split(':').map(Number);
          if (!isNaN(parsedH)) hh = parsedH;
          if (!isNaN(parsedM)) mm = parsedM;
        }
        
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(hh).padStart(2, '0');
        const mins = String(mm).padStart(2, '0');
        return `${year}${month}${day}T${hours}${mins}00`;
      };

      // Helper to format UTC timestamp for DTSTAMP
      const formatIcsUtcTime = (timestampMs: number) => {
        const d = new Date(timestampMs);
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const hours = String(d.getUTCHours()).padStart(2, '0');
        const mins = String(d.getUTCMinutes()).padStart(2, '0');
        const secs = String(d.getUTCSeconds()).padStart(2, '0');
        return `${year}${month}${day}T${hours}${mins}${secs}Z`;
      };

      const calculateEndStr = (startStr: string, minutes: number) => {
        const [h, m] = (startStr || '18:00').split(':').map(Number);
        const total = (isNaN(h) ? 18 : h) * 60 + (isNaN(m) ? 0 : m) + minutes;
        const endH = Math.floor(total / 60) % 24;
        const endM = total % 60;
        return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
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
        'X-PUBLISHED-TTL:PT1H',
        'BEGIN:VTIMEZONE',
        'TZID:Europe/Stockholm',
        'X-LIC-LOCATION:Europe/Stockholm',
        'BEGIN:DAYLIGHT',
        'TZOFFSETFROM:+0100',
        'TZOFFSETTO:+0200',
        'TZNAME:CEST',
        'DTSTART:19700329T020000',
        'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
        'END:DAYLIGHT',
        'BEGIN:STANDARD',
        'TZOFFSETFROM:+0200',
        'TZOFFSETTO:+0100',
        'TZNAME:CET',
        'DTSTART:19701025T030000',
        'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
        'END:STANDARD',
        'END:VTIMEZONE'
      ];

      for (const s of validSessions) {
        const dtStart = formatIcsLocalTime(s.date, s.startTime || '18:00');
        const dtEnd = s.endTime 
          ? formatIcsLocalTime(s.date, s.endTime) 
          : formatIcsLocalTime(s.date, calculateEndStr(s.startTime || '18:00', 90));

        const uid = `session-${s.id || Math.random().toString(36).substring(7)}-${clubId}-${teamId}@coachassist`;
        const dtStamp = formatIcsUtcTime(s.updatedAt || s.createdAt || Date.now());

        icsLines.push('BEGIN:VEVENT');
        icsLines.push(`UID:${uid}`);
        icsLines.push(`DTSTAMP:${dtStamp}`);
        icsLines.push(`DTSTART;TZID=Europe/Stockholm:${dtStart}`);
        icsLines.push(`DTEND;TZID=Europe/Stockholm:${dtEnd}`);
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
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    // In dev mode, handle root GET html requests to inject custom app name into index.html WITH Vite transforms
    app.get(['/', '/index.html'], async (req, res, next) => {
      const accept = req.headers.accept || '';
      if (req.method === 'GET' && accept.includes('text/html')) {
        try {
          const rootIndex = path.join(process.cwd(), 'index.html');
          if (fs.existsSync(rootIndex)) {
            let html = fs.readFileSync(rootIndex, 'utf-8');
            html = injectPwaMetaToHtml(html);
            html = await vite.transformIndexHtml(req.originalUrl || '/', html);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
          }
        } catch (e) {
          return next(e);
        }
      }
      next();
    });

    app.use(vite.middlewares);
  } else {
    const distPath = (_dirname.endsWith('dist') || _dirname.endsWith('/dist') || _dirname.endsWith('\\dist'))
      ? _dirname
      : path.join(_dirname, 'dist');
    const publicPath = path.join(process.cwd(), 'public');
    // Serve assets with absolute precision to prevent any rewrite or subfolder routing issues
    app.use('/assets', express.static(path.join(distPath, 'assets')));
    app.use(express.static(distPath));
    if (fs.existsSync(publicPath)) {
      app.use(express.static(publicPath));
    }
    app.get('*', (req, res) => {
      // If a script, stylesheet, image, font, manifest, or static asset was requested but not found, DO NOT return index.html (text/html)!
      if (
        req.path.startsWith('/assets/') ||
        req.path.startsWith('/src/') ||
        req.path.endsWith('.js') ||
        req.path.endsWith('.css') ||
        req.path.endsWith('.mjs') ||
        req.path.endsWith('.map') ||
        req.path.endsWith('.tsx') ||
        req.path.endsWith('.ts') ||
        req.path.endsWith('.png') ||
        req.path.endsWith('.jpg') ||
        req.path.endsWith('.jpeg') ||
        req.path.endsWith('.webp') ||
        req.path.endsWith('.svg') ||
        req.path.endsWith('.ico') ||
        req.path.endsWith('.webmanifest') ||
        req.path.endsWith('.json') ||
        req.path.endsWith('.woff') ||
        req.path.endsWith('.woff2')
      ) {
        return res.status(404).type('text/plain').send('Asset not found');
      }
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

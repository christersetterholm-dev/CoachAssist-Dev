var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server.ts
var server_exports = {};
__export(server_exports, {
  JWT_EXPIRES_IN: () => JWT_EXPIRES_IN,
  extractAuthUser: () => extractAuthUser,
  isRootAdminEmail: () => isRootAdminEmail,
  requireRootAdmin: () => requireRootAdmin,
  verifyIsRootAdmin: () => verifyIsRootAdmin,
  verifyJwtToken: () => verifyJwtToken
});
module.exports = __toCommonJS(server_exports);
var import_express = __toESM(require("express"), 1);
var import_axios = __toESM(require("axios"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_bcryptjs = __toESM(require("bcryptjs"), 1);
var import_jsonwebtoken = __toESM(require("jsonwebtoken"), 1);
var import_multer = __toESM(require("multer"), 1);
var import_nodemailer = __toESM(require("nodemailer"), 1);
var import_http = __toESM(require("http"), 1);
var import_https = __toESM(require("https"), 1);
var import_dns = __toESM(require("dns"), 1);
var import_net = __toESM(require("net"), 1);
var import_url = require("url");
var import_module = require("module");
var import_meta = {};
var customRequire = typeof require !== "undefined" ? require : (0, import_module.createRequire)(import_meta.url);
var Database = null;
try {
  const BetterSqlite = customRequire("better-sqlite3");
  const testDb = new BetterSqlite(":memory:");
  testDb.close();
  Database = BetterSqlite;
  console.log("[SQLite] better-sqlite3 native addon loaded and verified successfully.");
} catch (err) {
  console.warn("[SQLite] better-sqlite3 native addon not usable (" + (err?.message || err) + "). Using zero-dependency persistent JSON database engine.");
  Database = null;
}
var sharpModule = null;
try {
  sharpModule = customRequire("sharp");
  console.log("[Sharp] sharp image processing addon loaded successfully.");
} catch (err) {
  console.warn("[Sharp] sharp addon note:", err?.message || err);
}
function createFallbackDatabase(dataDir) {
  const storageFilePath = import_path.default.join(dataDir, "coachassist_db.json");
  let store = {
    users: {},
    users_data: {},
    shared_leaderboards: {},
    clubs_data: {},
    system_docs: {},
    password_resets: {},
    uploaded_files: {}
  };
  try {
    if (import_fs.default.existsSync(storageFilePath)) {
      const raw = import_fs.default.readFileSync(storageFilePath, "utf8");
      const parsed = JSON.parse(raw);
      store = { ...store, ...parsed };
      console.log(`[JSON DB] Loaded persistent storage from ${storageFilePath} (${Object.keys(store.users).length} users, ${Object.keys(store.system_docs).length} system docs)`);
    }
  } catch (err) {
    console.warn(`[JSON DB] Warning reading ${storageFilePath}:`, err?.message || err);
  }
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const tmpPath = `${storageFilePath}.tmp.${Date.now()}`;
        import_fs.default.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf8");
        import_fs.default.renameSync(tmpPath, storageFilePath);
      } catch (err) {
        console.error("[JSON DB] Error persisting storage to disk:", err?.message || err);
      }
    }, 100);
  };
  return {
    pragma: (_cmd) => {
    },
    exec: (_sql) => {
    },
    transaction: (fn) => (...args) => fn(...args),
    prepare: (sql) => {
      const cleanSql = sql.replace(/\s+/g, " ").trim();
      return {
        get: (...params) => {
          if (cleanSql.includes("FROM system_docs")) {
            let docPath = "";
            if (cleanSql.includes("path = 'system/jwt_secret'")) docPath = "system/jwt_secret";
            else if (cleanSql.includes("path = 'system/db_config'")) docPath = "system/db_config";
            else if (cleanSql.includes("path = 'system/ssh_deploy_config'")) docPath = "system/ssh_deploy_config";
            else if (cleanSql.includes("path = 'system/pwa_icons'")) docPath = "system/pwa_icons";
            else docPath = String(params[0] || "");
            const doc = store.system_docs[docPath];
            if (!doc) return void 0;
            if (cleanSql.startsWith("SELECT data FROM")) return { data: doc.data };
            return doc;
          }
          if (cleanSql.includes("FROM users")) {
            const allUsers = Object.values(store.users);
            if (cleanSql.includes("OR LOWER(username)")) {
              const p0 = String(params[0] || "").toLowerCase().trim();
              const p1 = String(params[1] || p0).toLowerCase().trim();
              return allUsers.find(
                (u) => u.email && u.email.toLowerCase() === p0 || u.username && u.username.toLowerCase() === p1
              );
            }
            if (cleanSql.includes("LOWER(email) = ?")) {
              const target = String(params[0] || "").toLowerCase().trim();
              const user = allUsers.find((u) => u.email && u.email.toLowerCase() === target);
              if (!user) return void 0;
              return { id: user.id, email: user.email };
            }
            if (cleanSql.includes("LOWER(username) = ?")) {
              const target = String(params[0] || "").toLowerCase().trim();
              const user = allUsers.find((u) => u.username && u.username.toLowerCase() === target);
              if (!user) return void 0;
              return { id: user.id };
            }
            if (cleanSql.includes("google_id = ?") && !cleanSql.includes("id != ?")) {
              const gid = String(params[0] || "");
              return allUsers.find((u) => u.google_id === gid);
            }
            if (cleanSql.includes("google_id = ? AND id != ?")) {
              const [gid, notId] = params;
              const user = allUsers.find((u) => u.google_id === gid && u.id !== notId);
              if (!user) return void 0;
              return { id: user.id, email: user.email };
            }
            if (cleanSql.includes("email = ? AND id != ?")) {
              const [email, notId] = params;
              const target = String(email || "").toLowerCase().trim();
              const user = allUsers.find((u) => (u.email || "").toLowerCase() === target && u.id !== notId);
              if (!user) return void 0;
              return { id: user.id };
            }
            if (cleanSql.includes("email = ?")) {
              const target = String(params[0] || "").toLowerCase().trim();
              const user = allUsers.find((u) => (u.email || "").toLowerCase() === target);
              if (!user) return void 0;
              return user;
            }
            if (cleanSql.includes("id = ?")) {
              const id = String(params[0] || "");
              return store.users[id];
            }
            return allUsers[0];
          }
          if (cleanSql.includes("FROM users_data")) {
            const [userId, segment] = params;
            const key = `${userId}:::${segment}`;
            const row2 = store.users_data[key];
            if (!row2) return void 0;
            return { data: row2.data, updatedAt: row2.updatedAt };
          }
          if (cleanSql.includes("FROM clubs_data")) {
            const [clubId, teamId, segment] = params;
            const key = `${clubId}:::${teamId}:::${segment}`;
            const row2 = store.clubs_data[key];
            if (!row2) return void 0;
            if (cleanSql.includes("SELECT data FROM")) return { data: row2.data };
            return { data: row2.data, updatedAt: row2.updatedAt };
          }
          if (cleanSql.includes("FROM shared_leaderboards")) {
            const id = String(params[0] || "");
            const row2 = store.shared_leaderboards[id];
            if (!row2) return void 0;
            if (cleanSql.includes("SELECT data FROM")) return { data: row2.data };
            return row2;
          }
          if (cleanSql.includes("FROM uploaded_files")) {
            const filename = String(params[0] || "");
            const file = store.uploaded_files[filename];
            if (!file) return void 0;
            return { mime_type: file.mime_type, data_base64: file.data_base64 };
          }
          if (cleanSql.includes("FROM password_resets")) {
            const all = Object.values(store.password_resets);
            if (cleanSql.includes("COUNT(*)")) {
              const [email2, createdAfter] = params;
              const target2 = String(email2 || "").toLowerCase().trim();
              const count = all.filter((r) => (r.email || "").toLowerCase() === target2 && r.created_at > (createdAfter || 0)).length;
              return { count };
            }
            const [email, expiresAfter] = params;
            const target = String(email || "").toLowerCase().trim();
            const valid = all.filter((r) => (r.email || "").toLowerCase() === target && !r.used && r.expires_at > (expiresAfter || 0));
            valid.sort((a, b) => b.created_at - a.created_at);
            return valid[0];
          }
          return void 0;
        },
        all: (...params) => {
          if (cleanSql.includes("FROM system_docs")) {
            const allDocs = Object.values(store.system_docs);
            if (cleanSql.includes("path = ? OR path LIKE ?")) {
              const exact = String(params[0] || "");
              const prefix = String(params[1] || "").replace(/%/g, "");
              return allDocs.filter((d) => d.path === exact || prefix && d.path.startsWith(prefix));
            }
            if (cleanSql.includes("path = 'pending_user_requests' OR path LIKE 'pending_user_requests/%'")) {
              return allDocs.filter((d) => d.path === "pending_user_requests" || d.path.startsWith("pending_user_requests/"));
            }
            if (cleanSql.includes("path = ?")) {
              const target = String(params[0] || "");
              return allDocs.filter((d) => d.path === target);
            }
            if (cleanSql.includes("path LIKE ?")) {
              const prefix = String(params[0] || "").replace(/%/g, "");
              return allDocs.filter((d) => prefix && d.path.startsWith(prefix));
            }
            return allDocs;
          }
          if (cleanSql.includes("FROM users_data")) {
            return Object.values(store.users_data);
          }
          if (cleanSql.includes("FROM clubs_data")) {
            return Object.values(store.clubs_data);
          }
          if (cleanSql.includes("FROM shared_leaderboards")) {
            return Object.values(store.shared_leaderboards);
          }
          if (cleanSql.includes("FROM uploaded_files")) {
            return Object.values(store.uploaded_files);
          }
          if (cleanSql.includes("FROM users")) {
            const allUsers = Object.values(store.users);
            if (cleanSql.includes("OR LOWER(username)")) {
              const p0 = String(params[0] || "").toLowerCase().trim();
              const p1 = String(params[1] || p0).toLowerCase().trim();
              return allUsers.filter(
                (u) => u.email && u.email.toLowerCase() === p0 || u.username && u.username.toLowerCase() === p1
              );
            }
            if (cleanSql.includes("LOWER(email) = ?")) {
              const target = String(params[0] || "").toLowerCase().trim();
              return allUsers.filter((u) => u.email && u.email.toLowerCase() === target);
            }
            return allUsers;
          }
          return [];
        },
        run: (...params) => {
          if (cleanSql.includes("INTO system_docs")) {
            let pathVal = "", dataVal = "", updatedVal = Date.now();
            if (cleanSql.includes("'system/jwt_secret'")) {
              pathVal = "system/jwt_secret";
              dataVal = params[0];
              updatedVal = params[1] || Date.now();
            } else if (cleanSql.includes("'system/db_config'")) {
              pathVal = "system/db_config";
              dataVal = params[0];
              updatedVal = params[1] || Date.now();
            } else if (cleanSql.includes("'system/ssh_deploy_config'")) {
              pathVal = "system/ssh_deploy_config";
              dataVal = params[0];
              updatedVal = params[1] || Date.now();
            } else if (cleanSql.includes("'system/pwa_icons'")) {
              pathVal = "system/pwa_icons";
              dataVal = params[0];
              updatedVal = params[1] || Date.now();
            } else if (params.length === 2) {
              pathVal = String(params[0] || "");
              dataVal = params[0];
              updatedVal = params[1] || Date.now();
            } else {
              [pathVal, dataVal, updatedVal] = params;
            }
            store.system_docs[pathVal] = { path: pathVal, data: dataVal, updatedAt: updatedVal };
            scheduleSave();
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("DELETE FROM system_docs")) {
            const pathVal = String(params[0] || "");
            delete store.system_docs[pathVal];
            scheduleSave();
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("INTO users_data")) {
            const [userId, segment, data, updatedAt] = params;
            const key = `${userId}:::${segment}`;
            store.users_data[key] = { userId, segment, data, updatedAt: updatedAt || Date.now() };
            scheduleSave();
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("INTO clubs_data")) {
            const [clubId, teamId, segment, data, updatedAt] = params;
            const key = `${clubId}:::${teamId}:::${segment}`;
            store.clubs_data[key] = { clubId, teamId, segment, data, updatedAt: updatedAt || Date.now() };
            scheduleSave();
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("INTO shared_leaderboards")) {
            const [id, data, updatedAt, coachUid] = params;
            store.shared_leaderboards[id] = { id, data, updatedAt: updatedAt || Date.now(), coachUid };
            scheduleSave();
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("INTO uploaded_files")) {
            const [filename, mime_type, data_base64, created_at] = params;
            store.uploaded_files[filename] = { filename, mime_type, data_base64, created_at: created_at || Date.now() };
            scheduleSave();
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("DELETE FROM uploaded_files")) {
            const filename = String(params[0] || "");
            delete store.uploaded_files[filename];
            scheduleSave();
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("INTO password_resets")) {
            const [id, email, code_hash, expires_at, attempts, used, created_at] = params;
            store.password_resets[id] = { id, email, code_hash, expires_at, attempts: attempts || 0, used: used || 0, created_at: created_at || Date.now() };
            scheduleSave();
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("UPDATE password_resets SET used = 1 WHERE email = ?")) {
            const target = String(params[0] || "").toLowerCase().trim();
            for (const r of Object.values(store.password_resets)) {
              if ((r.email || "").toLowerCase() === target && !r.used) {
                r.used = 1;
              }
            }
            scheduleSave();
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("UPDATE password_resets SET used = 1 WHERE id = ?")) {
            const id = String(params[0] || "");
            if (store.password_resets[id]) {
              store.password_resets[id].used = 1;
              scheduleSave();
            }
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("UPDATE password_resets SET attempts = attempts + 1")) {
            const id = String(params[0] || "");
            if (store.password_resets[id]) {
              store.password_resets[id].attempts = (store.password_resets[id].attempts || 0) + 1;
              scheduleSave();
            }
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("INTO users")) {
            let userObj = {};
            if (cleanSql.includes("google_id")) {
              const [id, email, username, password_hash, google_id, google_email, avatar_url, auth_provider, created_at, has_logged_in] = params;
              userObj = { id, email, username, password_hash, google_id, google_email, avatar_url, auth_provider: auth_provider || "local", created_at, has_logged_in: has_logged_in || 0 };
            } else if (cleanSql.includes("temp_password")) {
              const [id, email, username, password_hash, created_at, has_logged_in, temp_password] = params;
              userObj = { id, email, username, password_hash, created_at, has_logged_in: has_logged_in || 0, temp_password };
            } else if (params.length === 5) {
              const [id, email, username, password_hash, created_at] = params;
              userObj = { id, email, username, password_hash, created_at, has_logged_in: 0 };
            } else if (params.length === 4) {
              const [id, email, password_hash, created_at] = params;
              userObj = { id, email, password_hash, created_at, has_logged_in: 0 };
            } else {
              userObj = { id: params[0], email: params[1], password_hash: params[2], created_at: Date.now() };
            }
            const existing = store.users[userObj.id] || {};
            store.users[userObj.id] = { ...existing, ...userObj };
            scheduleSave();
            return { changes: 1, lastInsertRowid: 0 };
          }
          if (cleanSql.includes("UPDATE users")) {
            if (cleanSql.includes("has_logged_in = 1, temp_password = NULL")) {
              const id = String(params[0] || "");
              if (store.users[id]) {
                store.users[id].has_logged_in = 1;
                store.users[id].temp_password = null;
                scheduleSave();
              }
              return { changes: 1, lastInsertRowid: 0 };
            }
            if (cleanSql.includes("SET username = ?, password_hash = ?, temp_password = ? WHERE id = ?")) {
              const [username, password_hash, temp_password, id] = params;
              if (store.users[id]) {
                store.users[id].username = username;
                store.users[id].password_hash = password_hash;
                store.users[id].temp_password = temp_password;
                scheduleSave();
              }
              return { changes: 1, lastInsertRowid: 0 };
            }
            if (cleanSql.includes("SET email = ?, username = ?, password_hash = COALESCE(?, password_hash)")) {
              const [email, username, password_hash, id] = params;
              if (store.users[id]) {
                store.users[id].email = email;
                store.users[id].username = username;
                if (password_hash) store.users[id].password_hash = password_hash;
                scheduleSave();
              }
              return { changes: 1, lastInsertRowid: 0 };
            }
            if (cleanSql.includes("SET username = ? WHERE id = ?")) {
              const [username, id] = params;
              if (store.users[id]) {
                store.users[id].username = username;
                scheduleSave();
              }
              return { changes: 1, lastInsertRowid: 0 };
            }
            if (cleanSql.includes("SET email = ? WHERE id = ?")) {
              const [email, id] = params;
              if (store.users[id]) {
                store.users[id].email = email;
                scheduleSave();
              }
              return { changes: 1, lastInsertRowid: 0 };
            }
            if (cleanSql.includes("SET avatar_url = ? WHERE id = ?")) {
              const [avatar_url, id] = params;
              if (store.users[id]) {
                store.users[id].avatar_url = avatar_url;
                scheduleSave();
              }
              return { changes: 1, lastInsertRowid: 0 };
            }
            if (cleanSql.includes("SET google_id = ?, google_email = ?")) {
              const [google_id, google_email, avatar_url, id] = params;
              if (store.users[id]) {
                store.users[id].google_id = google_id;
                store.users[id].google_email = google_email;
                if (avatar_url && !store.users[id].avatar_url) store.users[id].avatar_url = avatar_url;
                store.users[id].auth_provider = "google";
                scheduleSave();
              }
              return { changes: 1, lastInsertRowid: 0 };
            }
            if (cleanSql.includes("SET google_id = NULL, google_email = NULL, auth_provider = 'local'")) {
              const id = String(params[0] || "");
              if (store.users[id]) {
                store.users[id].google_id = null;
                store.users[id].google_email = null;
                store.users[id].auth_provider = "local";
                scheduleSave();
              }
              return { changes: 1, lastInsertRowid: 0 };
            }
          }
          return { changes: 0, lastInsertRowid: 0 };
        }
      };
    }
  };
}
var _filename = typeof __filename !== "undefined" ? __filename : typeof import_meta !== "undefined" && import_meta.url ? (0, import_url.fileURLToPath)(import_meta.url) : "";
var _dirname = typeof __dirname !== "undefined" ? __dirname : typeof import_meta !== "undefined" && import_meta.url ? import_path.default.dirname((0, import_url.fileURLToPath)(import_meta.url)) : process.cwd();
var isProduction = process.env.NODE_ENV === "production" || _dirname.includes("dist") || _dirname.includes("\\dist");
var DATA_DIR = process.env.DATA_DIR || (isProduction && _dirname.includes("dist") ? import_path.default.join(_dirname, "..") : _dirname);
try {
  import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
  import_fs.default.accessSync(DATA_DIR, import_fs.default.constants.W_OK);
} catch (e) {
  console.warn("[Server] Selected DATA_DIR is not writable, falling back to /tmp:", e);
  DATA_DIR = "/tmp";
}
var UPLOADS_DIR = process.env.UPLOADS_DIR || import_path.default.join(DATA_DIR, "uploads");
var DB_PATH = process.env.DATABASE_PATH || import_path.default.join(DATA_DIR, "coachassist.db");
try {
  import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (e) {
  console.warn("[Server] Could not create UPLOADS_DIR:", e);
}
function initDatabase() {
  if (!Database) {
    console.warn("[SQLite] better-sqlite3 native addon not available; starting zero-dependency file-backed JSON database engine.");
    return createFallbackDatabase(DATA_DIR);
  }
  const createSchema = (database) => {
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
    `);
    try {
      database.exec("ALTER TABLE users ADD COLUMN username TEXT;");
    } catch (_) {
    }
    try {
      database.exec("ALTER TABLE users ADD COLUMN has_logged_in INTEGER DEFAULT 0;");
    } catch (_) {
    }
    try {
      database.exec("ALTER TABLE users ADD COLUMN temp_password TEXT;");
    } catch (_) {
    }
    try {
      database.exec("ALTER TABLE users ADD COLUMN google_id TEXT;");
    } catch (_) {
    }
    try {
      database.exec("ALTER TABLE users ADD COLUMN google_email TEXT;");
    } catch (_) {
    }
    try {
      database.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT;");
    } catch (_) {
    }
    try {
      database.exec("ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'local';");
    } catch (_) {
    }
  };
  try {
    const database = new Database(DB_PATH);
    database.pragma("quick_check");
    createSchema(database);
    return database;
  } catch (err) {
    console.error("[SQLite Init] Database initialization failed (e.g. malformed DB or bindings issue):", err?.message || err);
    try {
      if (import_fs.default.existsSync(DB_PATH)) {
        try {
          const corruptPath = `${DB_PATH}.corrupt.${Date.now()}`;
          import_fs.default.renameSync(DB_PATH, corruptPath);
          console.warn(`[SQLite Recovery] Moved corrupted database file to ${corruptPath}`);
        } catch (e) {
          console.error("[SQLite Recovery] Failed to rename corrupt database, removing file:", e?.message || e);
          try {
            import_fs.default.unlinkSync(DB_PATH);
          } catch (_) {
          }
        }
      }
      const freshDb = new Database(DB_PATH);
      createSchema(freshDb);
      console.log("[SQLite Recovery] Fresh SQLite database initialized successfully.");
      return freshDb;
    } catch (fallbackErr) {
      console.warn("[SQLite Recovery] Could not recover SQLite (" + (fallbackErr?.message || fallbackErr) + "). Falling back safely to file-backed JSON database engine.");
      return createFallbackDatabase(DATA_DIR);
    }
  }
}
var db = initDatabase();
function isCompromisedSecret(secret) {
  if (!secret) return true;
  const hash = import_crypto.default.createHash("sha256").update(secret).digest("hex");
  const blacklistedHashes = [
    "f6a5e8e13a8a6b7fca2ae4fee98a4e00cf007a224d68274c9646da8a6e6ad2d1",
    "2a8b1bdaf7f7e9caba40dce80f3cfc6af82efb4712b5ace24441f71d6b2229cb",
    "c8d30878c15c702a9f8fabbb3c70b55113b411c2d90a7672d31579e05599996d"
  ];
  return blacklistedHashes.includes(hash);
}
var JWT_SECRET = (process.env.JWT_SECRET || "").trim();
if (JWT_SECRET && isCompromisedSecret(JWT_SECRET)) {
  console.warn("[Security Warning] JWT_SECRET matches a known compromised repository secret! Discarding it.");
  JWT_SECRET = "";
}
try {
  if (!JWT_SECRET) {
    const row2 = db.prepare("SELECT data FROM system_docs WHERE path = 'system/jwt_secret'").get();
    if (row2 && row2.data) {
      const stored = typeof row2.data === "string" ? JSON.parse(row2.data) : row2.data;
      if (stored && typeof stored === "string" && !isCompromisedSecret(stored)) {
        JWT_SECRET = stored;
      }
    }
  }
} catch (_) {
}
if (!JWT_SECRET) {
  JWT_SECRET = import_crypto.default.randomBytes(32).toString("hex");
  console.log("[Security] Generated a fresh random JWT_SECRET for this installation.");
  try {
    db.prepare("INSERT OR REPLACE INTO system_docs (path, data, updatedAt) VALUES ('system/jwt_secret', ?, ?)").run(
      JSON.stringify(JWT_SECRET),
      Date.now()
    );
  } catch (_) {
  }
}
var JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";
function verifyJwtToken(token) {
  if (!token) {
    const err = new Error("No token provided");
    err.name = "JsonWebTokenError";
    throw err;
  }
  return import_jsonwebtoken.default.verify(token, JWT_SECRET);
}
function extractAuthUser(req) {
  const authHeader = req.headers.authorization;
  let token = null;
  if (authHeader) {
    const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const parts = authStr.split(" ");
    token = parts.length > 1 ? parts[1] : parts[0];
  } else if (req.query && typeof req.query.token === "string") {
    token = req.query.token;
  }
  if (!token || token === "null" || token === "undefined") {
    return null;
  }
  try {
    const decoded = verifyJwtToken(token);
    return decoded && (decoded.id || decoded.email) ? decoded : null;
  } catch {
    return null;
  }
}
function isRootAdminEmail(email) {
  if (!email || typeof email !== "string") return false;
  const clean = email.trim().toLowerCase();
  const envAdmins = (process.env.ADMIN_EMAILS || "christer.setterholm@gmail.com,christer@setterholm.se").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return envAdmins.includes(clean);
}
async function verifyIsRootAdmin(user) {
  if (!user) return false;
  const email = (user.email || user.google_email || "").trim().toLowerCase();
  if (isRootAdminEmail(email)) return true;
  try {
    const row2 = db.prepare("SELECT data FROM system_docs WHERE path = 'admins/root_admins_list'").get();
    if (row2 && row2.data) {
      const parsed = typeof row2.data === "string" ? JSON.parse(row2.data) : row2.data;
      if (parsed && Array.isArray(parsed.admins)) {
        if (parsed.admins.some((a) => (a.email || "").trim().toLowerCase() === email)) {
          return true;
        }
      }
    }
  } catch (_) {
  }
  return false;
}
async function requireRootAdmin(req, res, next) {
  const user = extractAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: "Inloggning kr\xE4vs. V\xE4nligen logga in som administrat\xF6r." });
  }
  const isRoot = await verifyIsRootAdmin(user);
  if (!isRoot) {
    return res.status(403).json({ error: "\xC5tkomst nekad: Endast administrat\xF6r har beh\xF6righet till denna \xE5tg\xE4rd." });
  }
  req.user = user;
  next();
}
async function ensureJwtSecret() {
  return JWT_SECRET;
}
function isPrivateOrReservedIp(ip) {
  let cleanIp = ip;
  if (cleanIp.startsWith("::ffff:")) {
    cleanIp = cleanIp.replace("::ffff:", "");
  }
  if (import_net.default.isIPv4(cleanIp)) {
    const parts = cleanIp.split(".").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    if (parts[0] >= 224) return true;
    return false;
  }
  if (import_net.default.isIPv6(cleanIp)) {
    const lower = cleanIp.toLowerCase();
    if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
    if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
    if (lower.startsWith("fec") || lower.startsWith("fed") || lower.startsWith("fee") || lower.startsWith("fef")) return true;
    if (lower.startsWith("::") && lower.includes(".")) return true;
    return false;
  }
  return true;
}
var safeDnsLookup = (hostname, options, callback) => {
  import_dns.default.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const addresses = Array.isArray(address) ? address : [{ address, family }];
    for (const item of addresses) {
      const ip = typeof item === "string" ? item : item.address;
      if (ip && isPrivateOrReservedIp(ip)) {
        return callback(new Error(`SSRF blocked: IP-adress ${ip} \xE4r privat eller intern.`));
      }
    }
    return callback(null, address, family);
  });
};
var safeHttpAgent = new import_http.default.Agent({ lookup: safeDnsLookup });
var safeHttpsAgent = new import_https.default.Agent({ lookup: safeDnsLookup });
async function validateSafeExternalUrl(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { valid: false, error: "Ogiltig URL-adress" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: "Endast HTTP och HTTPS-protokoll st\xF6ds" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname === "metadata.google.internal" || hostname === "metadata" || hostname === "instance-data") {
    return { valid: false, error: "\xC5tkomst till lokala eller interna n\xE4tverksadresser \xE4r blockerad av s\xE4kerhetssk\xE4l (SSRF-skydd)." };
  }
  if (import_net.default.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      return { valid: false, error: "\xC5tkomst till privata eller interna IP-adresser \xE4r blockerad (SSRF-skydd)." };
    }
    return { valid: true, urlObj: parsed };
  }
  try {
    const addresses = await import_dns.default.promises.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { valid: false, error: "Kunde inte sl\xE5 upp dom\xE4nnamnet." };
    }
    for (const addr of addresses) {
      if (isPrivateOrReservedIp(addr.address)) {
        return { valid: false, error: `Dom\xE4nen ${hostname} pekar mot en privat eller reserverad IP-adress (${addr.address}) och kan inte anropas.` };
      }
    }
  } catch (err) {
    return { valid: false, error: `DNS-uppslagning misslyckades: ${err.message}` };
  }
  return { valid: true, urlObj: parsed };
}
var rateLimitMap = /* @__PURE__ */ new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (record.resetAt <= now) {
      rateLimitMap.delete(key);
    }
  }
}, 6e4);
function createRateLimiter(options) {
  return (req, res, next) => {
    const clientIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    const key = `${req.path}:${clientIp}`;
    const now = Date.now();
    const record = rateLimitMap.get(key);
    if (!record || record.resetAt <= now) {
      rateLimitMap.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    if (record.count >= options.max) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1e3);
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({ error: options.message });
    }
    record.count += 1;
    next();
  };
}
var loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1e3,
  max: 10,
  message: "F\xF6r m\xE5nga inloggningsf\xF6rs\xF6k. V\xE4nligen v\xE4nta 15 minuter och f\xF6rs\xF6k igen."
});
var registerRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1e3,
  max: 10,
  message: "F\xF6r m\xE5nga registreringsf\xF6rs\xF6k. V\xE4nligen f\xF6rs\xF6k igen om en timme."
});
var resetRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1e3,
  max: 5,
  message: "F\xF6r m\xE5nga \xE5terst\xE4llningsf\xF6rs\xF6k. V\xE4nligen v\xE4nta 15 minuter och f\xF6rs\xF6k igen."
});
var firebaseConfig = null;
try {
  const configPath = import_path.default.join(_dirname, "firebase-applet-config.json");
  const altConfigPath = import_path.default.join(process.cwd(), "firebase-applet-config.json");
  if (import_fs.default.existsSync(configPath)) {
    firebaseConfig = JSON.parse(import_fs.default.readFileSync(configPath, "utf8"));
  } else if (import_fs.default.existsSync(altConfigPath)) {
    firebaseConfig = JSON.parse(import_fs.default.readFileSync(altConfigPath, "utf8"));
  }
} catch (e) {
  console.error("Could not load firebase-applet-config.json:", e);
}
var FIREBASE_API_KEY = firebaseConfig?.apiKey || "";
var DB_CONFIG_FILE = import_path.default.join(DATA_DIR, "db_mode_config.json");
var ROOT_DB_CONFIG_FILE = import_path.default.join(_dirname, "db_mode_config.json");
function saveDiskDbConfig(config) {
  try {
    const dataStr = JSON.stringify(config, null, 2);
    try {
      import_fs.default.writeFileSync(DB_CONFIG_FILE, dataStr, "utf8");
    } catch (_) {
    }
    try {
      import_fs.default.writeFileSync(ROOT_DB_CONFIG_FILE, dataStr, "utf8");
    } catch (_) {
    }
  } catch (err) {
    console.warn("[DB Config] Could not write disk config file:", err);
  }
}
var dbModeConfig = {
  mode: process.env.DATABASE_MODE || "local_sqlite",
  // 'hybrid' | 'local_sqlite' | 'firestore_only'
  customFirestoreProjectId: "",
  customFirestoreApiKey: "",
  customRemoteUrl: "",
  updatedAt: Date.now(),
  updatedBy: "system"
};
try {
  for (const filePath of [DB_CONFIG_FILE, ROOT_DB_CONFIG_FILE]) {
    if (import_fs.default.existsSync(filePath)) {
      const raw = import_fs.default.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.mode) {
        dbModeConfig = { ...dbModeConfig, ...parsed };
        console.log(`[DB Config] Loaded persistent disk config from ${filePath}: mode = ${dbModeConfig.mode}`);
        break;
      }
    }
  }
} catch (e) {
  console.warn("[DB Config] Could not read disk config file:", e);
}
try {
  const savedRow = db.prepare("SELECT data FROM system_docs WHERE path = 'system/db_config'").get();
  if (savedRow) {
    const parsed = typeof savedRow.data === "string" ? JSON.parse(savedRow.data) : savedRow.data;
    if (parsed && parsed.mode) {
      dbModeConfig = { ...dbModeConfig, ...parsed };
      console.log(`[DB Config] Initialized database mode from DB: ${dbModeConfig.mode}`);
    }
  }
} catch (e) {
  console.warn("[DB Config] Could not read system/db_config from SQLite:", e);
}
function getActiveFirestoreParams() {
  const projId = dbModeConfig.customFirestoreProjectId || firebaseConfig?.projectId;
  const apiKey = dbModeConfig.customFirestoreApiKey || FIREBASE_API_KEY;
  const dbId = firebaseConfig?.firestoreDatabaseId || "(default)";
  const baseUrl = projId ? `https://firestore.googleapis.com/v1/projects/${projId}/databases/${dbId}/documents` : null;
  return { baseUrl, apiKey, projId };
}
function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === void 0) {
      fields[key] = { nullValue: null };
    } else if (typeof val === "boolean") {
      fields[key] = { booleanValue: val };
    } else if (typeof val === "number") {
      if (Number.isInteger(val)) {
        fields[key] = { integerValue: val.toString() };
      } else {
        fields[key] = { doubleValue: val };
      }
    } else if (typeof val === "string") {
      fields[key] = { stringValue: val };
    } else if (typeof val === "object") {
      fields[key] = { stringValue: JSON.stringify(val) };
    }
  }
  return fields;
}
function fromFirestoreFields(fields) {
  const result = {};
  if (!fields) return result;
  for (const [key, valObj] of Object.entries(fields)) {
    if ("stringValue" in valObj) {
      const str = valObj.stringValue;
      if (str.startsWith("{") && str.endsWith("}") || str.startsWith("[") && str.endsWith("]")) {
        try {
          result[key] = JSON.parse(str);
        } catch {
          result[key] = str;
        }
      } else {
        result[key] = str;
      }
    } else if ("integerValue" in valObj) {
      result[key] = parseInt(valObj.integerValue, 10);
    } else if ("doubleValue" in valObj) {
      result[key] = valObj.doubleValue;
    } else if ("booleanValue" in valObj) {
      result[key] = valObj.booleanValue;
    } else if ("nullValue" in valObj) {
      result[key] = null;
    } else if ("mapValue" in valObj) {
      result[key] = fromFirestoreFields(valObj.mapValue.fields || {});
    }
  }
  return result;
}
var firestoreQuotaExceededUntil = 0;
var lastFirestoreQuotaMessage = "";
function getFirestoreQuotaUpgradeUrl() {
  const { projId } = getActiveFirestoreParams();
  const dbId = firebaseConfig?.firestoreDatabaseId || "(default)";
  return `https://console.firebase.google.com/project/${projId}/firestore/databases/${dbId}/data?openUpgradeDialog=true`;
}
async function getFirestoreDoc(docPath) {
  if (dbModeConfig.mode === "local_sqlite") {
    return null;
  }
  const { baseUrl, apiKey } = getActiveFirestoreParams();
  if (!baseUrl || !apiKey) return null;
  try {
    const encodedPath = docPath.split("/").map(encodeURIComponent).join("/");
    const url = `${baseUrl}/${encodedPath}?key=${apiKey}`;
    const res = await import_axios.default.get(url, { validateStatus: (s) => s <= 500, timeout: 5e3 });
    if (res.status === 200 && res.data?.fields) {
      return fromFirestoreFields(res.data.fields);
    }
    if (res.status === 429) {
      const msg = res.data?.error?.message || "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'";
      console.warn(`[Firestore Quota Exceeded 429] on GET for ${docPath}:`, msg);
      firestoreQuotaExceededUntil = Date.now() + 60 * 1e3;
      lastFirestoreQuotaMessage = msg;
      const err = new Error(msg);
      err.status = 429;
      err.code = "RESOURCE_EXHAUSTED";
      err.upgradeUrl = getFirestoreQuotaUpgradeUrl();
      throw err;
    }
    return null;
  } catch (e) {
    if (e.status === 429 || e.code === "RESOURCE_EXHAUSTED") {
      throw e;
    }
    console.error(`Firestore GET error for ${docPath}:`, e.message);
    return null;
  }
}
async function setFirestoreDoc(docPath, data) {
  if (dbModeConfig.mode === "local_sqlite") {
    return true;
  }
  const { baseUrl, apiKey } = getActiveFirestoreParams();
  if (!baseUrl || !apiKey) return false;
  try {
    const encodedPath = docPath.split("/").map(encodeURIComponent).join("/");
    const url = `${baseUrl}/${encodedPath}?key=${apiKey}`;
    const fields = toFirestoreFields(data);
    const res = await import_axios.default.patch(url, { fields }, {
      headers: { "Content-Type": "application/json" },
      validateStatus: (s) => s <= 500,
      timeout: 5e3
    });
    if (res.status === 429) {
      const msg = res.data?.error?.message || "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'";
      console.warn(`[Firestore Quota Exceeded 429] on PATCH for ${docPath}:`, msg);
      firestoreQuotaExceededUntil = Date.now() + 60 * 1e3;
      lastFirestoreQuotaMessage = msg;
      return false;
    }
    return res.status === 200;
  } catch (e) {
    console.error(`Firestore PATCH error for ${docPath}:`, e.message);
    return false;
  }
}
async function deleteFirestoreDoc(docPath) {
  if (dbModeConfig.mode === "local_sqlite") {
    return true;
  }
  const { baseUrl, apiKey } = getActiveFirestoreParams();
  if (!baseUrl || !apiKey) return false;
  try {
    const encodedPath = docPath.split("/").map(encodeURIComponent).join("/");
    const url = `${baseUrl}/${encodedPath}?key=${apiKey}`;
    const res = await import_axios.default.delete(url, {
      validateStatus: (s) => s <= 500,
      timeout: 5e3
    });
    return res.status === 200 || res.status === 404;
  } catch (e) {
    console.error(`Firestore DELETE error for ${docPath}:`, e.message);
    return false;
  }
}
var customPwaIcons = null;
function applyCustomPwaIconsToDisk(iconsObj) {
  const rootDir = process.cwd();
  const publicDir = import_path.default.join(rootDir, "public");
  const distDir = import_path.default.join(rootDir, "dist");
  const deployDir = import_path.default.join(rootDir, "deploy");
  const targetDirs = [publicDir, distDir, rootDir, deployDir];
  for (const [fileName, dataUrl] of Object.entries(iconsObj.files)) {
    if (!dataUrl) continue;
    const base64Data = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    const buffer = Buffer.from(base64Data, "base64");
    for (const targetDir of targetDirs) {
      try {
        if (targetDir === rootDir || import_fs.default.existsSync(targetDir)) {
          import_fs.default.writeFileSync(import_path.default.join(targetDir, fileName), buffer);
        }
      } catch (e) {
        console.error(`Error saving ${fileName} to ${targetDir}:`, e);
      }
    }
  }
  const mainIcon512 = iconsObj.files["icon-512x512.png"] || iconsObj.files["icon-192x192.png"];
  if (mainIcon512) {
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><image href="${mainIcon512}" width="512" height="512"/></svg>`;
    for (const targetDir of targetDirs) {
      try {
        if (targetDir === rootDir || import_fs.default.existsSync(targetDir)) {
          import_fs.default.writeFileSync(import_path.default.join(targetDir, "icon.svg"), svgContent, "utf-8");
        }
      } catch (_) {
      }
    }
  }
  const v = iconsObj.updatedAt || Date.now();
  const manifestAppName = (iconsObj.appName || "KSK-appen").trim();
  const themeColor = iconsObj.themeColor || "#4f46e5";
  const manifestObj = {
    id: "/",
    name: manifestAppName,
    short_name: manifestAppName.length > 12 ? manifestAppName.slice(0, 12) : manifestAppName,
    description: `${manifestAppName} - Komplett tr\xE4nings- och matchverktyg f\xF6r fotbollscoachen.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: themeColor,
    theme_color: themeColor,
    categories: ["sports", "utilities"],
    lang: "sv",
    dir: "ltr",
    icons: [
      { src: `/icon-192.png?v=${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/icon-512.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/icon-192x192.png?v=${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/icon-512x512.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/icon-maskable-512x512.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: `/apple-touch-icon.png?v=${v}`, sizes: "180x180", type: "image/png", purpose: "any" }
    ]
  };
  const manifestStr = JSON.stringify(manifestObj, null, 2);
  for (const targetDir of targetDirs) {
    try {
      if (targetDir === rootDir || import_fs.default.existsSync(targetDir)) {
        import_fs.default.writeFileSync(import_path.default.join(targetDir, "manifest.webmanifest"), manifestStr, "utf-8");
      }
    } catch (_) {
    }
  }
  try {
    const assetsDir = import_path.default.join(distDir, "assets");
    if (import_fs.default.existsSync(assetsDir)) {
      const files = import_fs.default.readdirSync(assetsDir);
      for (const f of files) {
        if (f.endsWith(".webmanifest")) {
          import_fs.default.writeFileSync(import_path.default.join(assetsDir, f), manifestStr, "utf-8");
        }
      }
    }
  } catch (_) {
  }
  const updateHtmlFile = (filePath) => {
    if (!import_fs.default.existsSync(filePath)) return;
    try {
      let content = import_fs.default.readFileSync(filePath, "utf-8");
      if (/<title>.*?<\/title>/gi.test(content)) {
        content = content.replace(/<title>.*?<\/title>/gi, `<title>${manifestAppName}</title>`);
      } else {
        content = content.replace("</head>", `<title>${manifestAppName}</title></head>`);
      }
      if (/apple-mobile-web-app-title/gi.test(content)) {
        content = content.replace(/<meta\s+name="apple-mobile-web-app-title"\s+content=".*?"\s*\/?>/gi, `<meta name="apple-mobile-web-app-title" content="${manifestAppName}" />`);
      } else {
        content = content.replace("</head>", `<meta name="apple-mobile-web-app-title" content="${manifestAppName}" /></head>`);
      }
      if (/application-name/gi.test(content)) {
        content = content.replace(/<meta\s+name="application-name"\s+content=".*?"\s*\/?>/gi, `<meta name="application-name" content="${manifestAppName}" />`);
      } else {
        content = content.replace("</head>", `<meta name="application-name" content="${manifestAppName}" /></head>`);
      }
      if (/theme-color/gi.test(content)) {
        content = content.replace(/<meta\s+name="theme-color"\s+content=".*?"\s*\/?>/gi, `<meta name="theme-color" content="${themeColor}" />`);
      }
      content = content.replace(/<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="[^"]*"\s*\/?>\s*/gi, "");
      content = content.replace(/href="\/favicon-16x16\.png(\?v=\d+)?"/g, `href="/favicon-16x16.png?v=${v}"`);
      content = content.replace(/href="\/favicon-32x32\.png(\?v=\d+)?"/g, `href="/favicon-32x32.png?v=${v}"`);
      content = content.replace(/href="\/favicon\.png(\?v=\d+)?"/g, `href="/favicon.png?v=${v}"`);
      content = content.replace(/href="\/apple-touch-icon\.png(\?v=\d+)?"/g, `href="/apple-touch-icon.png?v=${v}"`);
      content = content.replace(/href="\/manifest\.webmanifest(\?v=\d+)?"/g, `href="/manifest.webmanifest?v=${v}"`);
      import_fs.default.writeFileSync(filePath, content, "utf-8");
    } catch (e) {
      console.error(`Error updating HTML file at ${filePath}:`, e);
    }
  };
  updateHtmlFile(import_path.default.join(rootDir, "index.html"));
  updateHtmlFile(import_path.default.join(publicDir, "index.html"));
  updateHtmlFile(import_path.default.join(distDir, "index.html"));
  updateHtmlFile(import_path.default.join(deployDir, "index.html"));
  console.log("[PWA Icons] Successfully applied custom icons and manifest across all disk locations.");
}
function savePwaIconsToDatabase(pwaData) {
  const serialized = JSON.stringify(pwaData);
  const now = pwaData.updatedAt || Date.now();
  try {
    db.prepare(`
      INSERT INTO system_docs (path, data, updatedAt)
      VALUES ('system/pwa_icons', ?, ?)
      ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
    `).run(serialized, now);
    console.log("[PWA Icons] Successfully saved custom PWA icons to SQLite/JSON DB.");
  } catch (err) {
    console.error("[PWA Icons] Error saving custom PWA icons to SQLite/JSON DB:", err?.message || err);
  }
  try {
    const { baseUrl, apiKey, projId } = getActiveFirestoreParams();
    if (baseUrl && apiKey && projId) {
      let firestoreFiles = pwaData.files;
      if (Buffer.byteLength(JSON.stringify(firestoreFiles), "utf8") > 85e4) {
        const slimFiles = {};
        for (const [k, v] of Object.entries(pwaData.files)) {
          if (!["apple-touch-icon-precomposed.png", "favicon.png", "icon-192.png", "icon-512.png"].includes(k)) {
            slimFiles[k] = v;
          }
        }
        firestoreFiles = slimFiles;
      }
      setFirestoreDoc("app_docs/system_pwa_icons", {
        appName: pwaData.appName,
        themeColor: pwaData.themeColor,
        files: JSON.stringify(firestoreFiles),
        updatedAt: now
      }).then((ok) => {
        if (ok) console.log("[PWA Icons] Synced custom PWA icons to Firestore.");
      }).catch((e) => console.warn("[PWA Icons] Firestore sync notice:", e?.message || e));
    }
  } catch (err) {
    console.warn("[PWA Icons] Firestore background save notice:", err?.message || err);
  }
}
async function loadAndApplyPwaIcons() {
  try {
    const row2 = db.prepare("SELECT data FROM system_docs WHERE path = 'system/pwa_icons'").get();
    if (row2 && row2.data) {
      const parsed = typeof row2.data === "string" ? JSON.parse(row2.data) : row2.data;
      if (parsed && parsed.files && Object.keys(parsed.files).length > 0) {
        customPwaIcons = {
          appName: parsed.appName || "KSK-appen",
          themeColor: parsed.themeColor || "#4f46e5",
          updatedAt: parsed.updatedAt || Date.now(),
          files: parsed.files,
          logoSrc: parsed.logoSrc
        };
        applyCustomPwaIconsToDisk(customPwaIcons);
        console.log("[PWA Icons] Restored custom PWA icons from SQLite/JSON DB.");
        return;
      }
    }
  } catch (err) {
    console.warn("[PWA Icons] SQLite load notice:", err?.message || err);
  }
  try {
    const { projId, apiKey } = getActiveFirestoreParams();
    const dbId = firebaseConfig?.firestoreDatabaseId || "(default)";
    if (projId && apiKey) {
      const url = `https://firestore.googleapis.com/v1/projects/${projId}/databases/${dbId}/documents/app_docs/system_pwa_icons?key=${apiKey}`;
      const res = await import_axios.default.get(url, { validateStatus: (s) => s <= 500, timeout: 6e3 });
      if (res.status === 200 && res.data?.fields) {
        const fields = fromFirestoreFields(res.data.fields);
        if (fields && fields.files) {
          const filesMap = typeof fields.files === "string" ? JSON.parse(fields.files) : fields.files;
          customPwaIcons = {
            appName: fields.appName || "KSK-appen",
            themeColor: fields.themeColor || "#4f46e5",
            updatedAt: fields.updatedAt || Date.now(),
            files: filesMap,
            logoSrc: fields.logoSrc
          };
          applyCustomPwaIconsToDisk(customPwaIcons);
          console.log("[PWA Icons] Restored and migrated custom PWA icons from Firestore.");
          try {
            db.prepare(`
              INSERT INTO system_docs (path, data, updatedAt)
              VALUES ('system/pwa_icons', ?, ?)
              ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
            `).run(JSON.stringify(customPwaIcons), customPwaIcons.updatedAt);
            console.log("[PWA Icons] Cached recovered Firestore icons into SQLite/JSON DB.");
          } catch (_) {
          }
          return;
        }
      }
    }
  } catch (err) {
    console.warn("[PWA Icons] Startup Firestore recovery check notice:", err?.message || err);
  }
  console.log("[PWA Icons] Using standard default icons.");
}
async function loadAndApplyDbConfigFromFirestore() {
  if (process.env.DATABASE_MODE === "local_sqlite" || dbModeConfig.mode === "local_sqlite") {
    console.log(`[DB Config] Standalone local database mode active (${dbModeConfig.mode}); Firestore sync skipped.`);
    return;
  }
  try {
    const docData = await getFirestoreDoc("app_docs/system_db_config");
    if (docData && docData.data) {
      const parsed = typeof docData.data === "string" ? JSON.parse(docData.data) : docData.data;
      if (parsed && parsed.mode) {
        dbModeConfig = { ...dbModeConfig, ...parsed };
        console.log(`[DB Config] Restored database mode from Firestore on startup: ${dbModeConfig.mode}`);
        saveDiskDbConfig(dbModeConfig);
        try {
          db.prepare(`
            INSERT INTO system_docs (path, data, updatedAt)
            VALUES ('system/db_config', ?, ?)
            ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
          `).run(JSON.stringify(dbModeConfig), dbModeConfig.updatedAt || Date.now());
        } catch (sqliteErr) {
          console.error("[DB Config] Error caching restored database mode to SQLite:", sqliteErr);
        }
      }
    }
  } catch (err) {
    console.error("[DB Config] Error restoring database mode from Firestore on startup:", err);
  }
}
async function ensureTeamAndClubIntegrity() {
  try {
    const clubsData = db.prepare("SELECT * FROM clubs_data").all();
    if (!clubsData || clubsData.length === 0) return;
    const clubMap = /* @__PURE__ */ new Map();
    for (const cd of clubsData) {
      if (!clubMap.has(cd.clubId)) {
        clubMap.set(cd.clubId, { teams: /* @__PURE__ */ new Set(), metadata: null, members: null });
      }
      const entry = clubMap.get(cd.clubId);
      if (cd.teamId && cd.teamId !== "club_global") {
        entry.teams.add(cd.teamId);
      }
      if (cd.teamId === "club_global" && cd.segment === "metadata") {
        try {
          entry.metadata = typeof cd.data === "string" ? JSON.parse(cd.data) : cd.data;
        } catch (_) {
        }
      }
      if (cd.teamId === "club_global" && cd.segment === "members") {
        try {
          entry.members = typeof cd.data === "string" ? JSON.parse(cd.data) : cd.data;
        } catch (_) {
        }
      }
    }
    for (const [clubId, { teams, metadata, members }] of clubMap.entries()) {
      let metaUpdated = false;
      let curMeta = metadata || { id: clubId, name: "Klubb", teams: [] };
      if (!Array.isArray(curMeta.teams)) curMeta.teams = [];
      for (const tid of teams) {
        if (!curMeta.teams.some((t) => t && t.id === tid)) {
          let teamName = "Seniorer / Herrar";
          const sRow = db.prepare("SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = ?").get(clubId, tid, "settings");
          if (sRow && sRow.data) {
            try {
              const sObj = JSON.parse(sRow.data);
              if (sObj.teamName) teamName = sObj.teamName;
              else if (sObj.teamUrl && sObj.teamUrl.includes("Seniorer")) teamName = "Seniorer (Herrar)";
            } catch (_) {
            }
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
      const rootEmails = ["christer@setterholm.se", "christer.setterholm@gmail.com"];
      const teamIds = Array.from(teams);
      for (const re of rootEmails) {
        const existing = curMembers.members.find((m) => m && m.email && m.email.toLowerCase() === re);
        if (existing) {
          if (!existing.teams || existing.teams.length === 0) {
            existing.teams = teamIds;
            membersUpdated = true;
          }
          if (!existing.roles || existing.roles.length === 0) {
            existing.roles = ["admin", "coach"];
            membersUpdated = true;
          }
        } else {
          curMembers.members.push({
            userId: re === "christer@setterholm.se" ? "a7a4c8a1-096d-4d15-a9c8-ff3df6880ae6" : "user_christer_gmail",
            email: re,
            fullName: "Christer Setterholm",
            roles: ["admin", "coach"],
            teams: teamIds,
            photoUrl: "/uploads/photo_1790894131733-182448117.png"
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
    console.warn("[Integrity] Error during team/club auto-integrity check:", err);
  }
}
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = process.env.PORT || 3e3;
  await ensureJwtSecret();
  await loadAndApplyPwaIcons();
  await loadAndApplyDbConfigFromFirestore();
  await ensureTeamAndClubIntegrity();
  function injectPwaMetaToHtml(html) {
    const appName = customPwaIcons?.appName || "CoachAssist";
    const themeColor = customPwaIcons?.themeColor || "#4f46e5";
    const v = customPwaIcons?.updatedAt || 1;
    let updated = html;
    if (/<title>.*?<\/title>/gi.test(updated)) {
      updated = updated.replace(/<title>.*?<\/title>/gi, `<title>${appName}</title>`);
    } else {
      updated = updated.replace("</head>", `<title>${appName}</title></head>`);
    }
    if (/apple-mobile-web-app-title/gi.test(updated)) {
      updated = updated.replace(/<meta\s+name="apple-mobile-web-app-title"\s+content=".*?"\s*\/?>/gi, `<meta name="apple-mobile-web-app-title" content="${appName}" />`);
    } else {
      updated = updated.replace("</head>", `<meta name="apple-mobile-web-app-title" content="${appName}" /></head>`);
    }
    if (/application-name/gi.test(updated)) {
      updated = updated.replace(/<meta\s+name="application-name"\s+content=".*?"\s*\/?>/gi, `<meta name="application-name" content="${appName}" />`);
    } else {
      updated = updated.replace("</head>", `<meta name="application-name" content="${appName}" /></head>`);
    }
    if (/theme-color/gi.test(updated)) {
      updated = updated.replace(/<meta\s+name="theme-color"\s+content=".*?"\s*\/?>/gi, `<meta name="theme-color" content="${themeColor}" />`);
    }
    if (customPwaIcons && customPwaIcons.files) {
      updated = updated.replace(/<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="[^"]*"\s*\/?>\s*/gi, "");
      updated = updated.replace(/href="\/favicon-16x16\.png(\?v=\d+)?"/g, `href="/favicon-16x16.png?v=${v}"`);
      updated = updated.replace(/href="\/favicon-32x32\.png(\?v=\d+)?"/g, `href="/favicon-32x32.png?v=${v}"`);
      updated = updated.replace(/href="\/favicon\.png(\?v=\d+)?"/g, `href="/favicon.png?v=${v}"`);
      updated = updated.replace(/href="\/apple-touch-icon\.png(\?v=\d+)?"/g, `href="/apple-touch-icon.png?v=${v}"`);
      updated = updated.replace(/href="\/manifest\.webmanifest(\?v=\d+)?"/g, `href="/manifest.webmanifest?v=${v}"`);
    }
    return updated;
  }
  app.use((req, res, next) => {
    const rawPath = req.path.replace(/^\//, "");
    const cleanPath = rawPath.split("?")[0];
    if (customPwaIcons && customPwaIcons.files && customPwaIcons.files[cleanPath]) {
      const dataUrl = customPwaIcons.files[cleanPath];
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const imgBuffer = Buffer.from(base64Data, "base64");
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
      return res.send(imgBuffer);
    }
    if (customPwaIcons && customPwaIcons.files && (cleanPath === "icon.svg" || cleanPath === "favicon.svg")) {
      const icon512 = customPwaIcons.files["icon-512x512.png"] || customPwaIcons.files["icon-192x192.png"];
      if (icon512) {
        const svgWrap = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><image href="${icon512}" width="512" height="512" /></svg>`;
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
        return res.send(svgWrap);
      }
    }
    const iconMimes = {
      ".png": "image/png",
      ".ico": "image/x-icon",
      ".svg": "image/svg+xml",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp"
    };
    const reqExt = import_path.default.extname(cleanPath).toLowerCase();
    if (iconMimes[reqExt]) {
      const candidatePaths = [
        import_path.default.join(process.cwd(), "dist", cleanPath),
        import_path.default.join(process.cwd(), "public", cleanPath),
        import_path.default.join(process.cwd(), cleanPath)
      ];
      for (const cand of candidatePaths) {
        if (import_fs.default.existsSync(cand) && import_fs.default.statSync(cand).isFile()) {
          res.setHeader("Content-Type", iconMimes[reqExt]);
          res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
          return res.sendFile(cand);
        }
      }
    }
    if (cleanPath === "manifest.webmanifest" || cleanPath === "manifest.json" || cleanPath.endsWith(".webmanifest") || cleanPath.includes("manifest")) {
      const appName = (customPwaIcons?.appName || "KSK-appen").trim();
      const themeColor = customPwaIcons?.themeColor || "#4f46e5";
      const v = customPwaIcons?.updatedAt || 1;
      const manifestObj = {
        id: "/",
        name: appName,
        short_name: appName.length > 12 ? appName.slice(0, 12) : appName,
        description: `${appName} - Komplett tr\xE4nings- och matchverktyg f\xF6r fotbollscoachen.`,
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: themeColor,
        theme_color: themeColor,
        categories: ["sports", "utilities"],
        lang: "sv",
        dir: "ltr",
        icons: [
          { src: `/icon-192.png?v=${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: `/icon-512.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: `/icon-192x192.png?v=${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: `/icon-512x512.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: `/icon-maskable-512x512.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: `/apple-touch-icon.png?v=${v}`, sizes: "180x180", type: "image/png", purpose: "any" }
        ]
      };
      res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
      return res.json(manifestObj);
    }
    const accept = req.headers.accept || "";
    if (req.method === "GET" && (accept.includes("text/html") || req.path === "/" || req.path.endsWith(".html"))) {
      const originalSend = res.send;
      const originalEnd = res.end;
      res.send = function(body) {
        if (typeof body === "string" && body.includes("<html")) {
          body = injectPwaMetaToHtml(body);
        } else if (Buffer.isBuffer(body)) {
          const str = body.toString("utf-8");
          if (str.includes("<html")) {
            body = Buffer.from(injectPwaMetaToHtml(str), "utf-8");
          }
        }
        return originalSend.call(this, body);
      };
      res.end = function(chunk, encoding, cb) {
        if (typeof chunk === "string" && chunk.includes("<html")) {
          chunk = injectPwaMetaToHtml(chunk);
        } else if (Buffer.isBuffer(chunk)) {
          const str = chunk.toString("utf-8");
          if (str.includes("<html")) {
            chunk = Buffer.from(injectPwaMetaToHtml(str), "utf-8");
          }
        }
        return originalEnd.call(this, chunk, encoding, cb);
      };
    }
    next();
  });
  app.use((req, res, next) => {
    const url = req.url;
    const pathPart = url.split("?")[0];
    const segments = pathPart.split("/").filter(Boolean);
    const ext = import_path.default.extname(pathPart).toLowerCase();
    if (segments.length === 0 || ext !== "" || pathPart.includes(".") || ["api", "assets", "uploads", "rebuild", "favicon.ico"].includes(segments[0])) {
      return next();
    }
    const subfolder = segments[0];
    if (segments.length === 1 && !pathPart.endsWith("/")) {
      const query = url.includes("?") ? "?" + url.split("?")[1] : "";
      console.log(`[Subfolder Redirect] Redirecting ${url} to /${subfolder}/${query}`);
      return res.redirect(301, `/${subfolder}/${query}`);
    }
    const match = url.match(/^\/([^\/]+)\/(api|assets|uploads|favicon\.ico|rebuild)(.*)$/);
    if (match) {
      req.url = "/" + match[2] + match[3];
      console.log(`[Subfolder Rewriter] Rewrote URL: ${url} -> ${req.url}`);
    } else {
      if (segments.length === 1) {
        req.url = "/" + (url.includes("?") ? "?" + url.split("?")[1] : "");
        console.log(`[Subfolder Rewriter] Rewrote root: ${url} -> ${req.url}`);
      }
    }
    next();
  });
  app.use(import_express.default.json({ limit: "50mb" }));
  app.use(import_express.default.urlencoded({ limit: "50mb", extended: true }));
  app.use("/uploads", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    next();
  }, import_express.default.static(UPLOADS_DIR));
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", db: "sqlite", mode: dbModeConfig.mode });
  });
  app.get("/api/system/db-config", requireRootAdmin, (_req, res) => {
    let dbSize = 0;
    let actualDbPath = DB_PATH;
    let dbEngine = Database ? "sqlite" : "json_store";
    try {
      const jsonDbPath = import_path.default.join(DATA_DIR, "coachassist_db.json");
      if (import_fs.default.existsSync(DB_PATH) && import_fs.default.statSync(DB_PATH).size > 0) {
        dbSize = import_fs.default.statSync(DB_PATH).size;
        actualDbPath = DB_PATH;
        dbEngine = "sqlite";
      } else if (import_fs.default.existsSync(jsonDbPath)) {
        dbSize = import_fs.default.statSync(jsonDbPath).size;
        actualDbPath = jsonDbPath;
        dbEngine = "json_store";
      }
    } catch {
    }
    const { baseUrl, projId } = getActiveFirestoreParams();
    const dbId = firebaseConfig?.firestoreDatabaseId || "(default)";
    const firestoreUrl = projId ? dbId && dbId !== "(default)" ? `https://console.firebase.google.com/project/${projId}/firestore/databases/${dbId}/data` : `https://console.firebase.google.com/project/${projId}/firestore/data` : null;
    res.json({
      mode: dbModeConfig.mode,
      dbPath: actualDbPath,
      dbSize,
      dbEngine,
      isProduction,
      firestoreConfigured: !!baseUrl,
      firestoreProjectId: projId || null,
      firestoreDatabaseId: dbId,
      firestoreUrl,
      customFirestoreProjectId: dbModeConfig.customFirestoreProjectId || "",
      customFirestoreApiKey: dbModeConfig.customFirestoreApiKey || "",
      customRemoteUrl: dbModeConfig.customRemoteUrl || "",
      updatedAt: dbModeConfig.updatedAt,
      updatedBy: dbModeConfig.updatedBy
    });
  });
  app.post("/api/system/db-config", requireRootAdmin, (req, res) => {
    const { mode, customFirestoreProjectId, customFirestoreApiKey, customRemoteUrl } = req.body;
    if (!mode || !["hybrid", "local_sqlite", "firestore_only"].includes(mode)) {
      return res.status(400).json({ error: "Ogiltigt databasl\xE4ge. V\xE4lj hybrid, local_sqlite eller firestore_only." });
    }
    dbModeConfig.mode = mode;
    dbModeConfig.customFirestoreProjectId = (customFirestoreProjectId || "").trim();
    dbModeConfig.customFirestoreApiKey = (customFirestoreApiKey || "").trim();
    dbModeConfig.customRemoteUrl = (customRemoteUrl || "").trim();
    dbModeConfig.updatedAt = Date.now();
    dbModeConfig.updatedBy = "root_admin";
    const serialized = JSON.stringify(dbModeConfig);
    saveDiskDbConfig(dbModeConfig);
    try {
      db.prepare(`
        INSERT INTO system_docs (path, data, updatedAt)
        VALUES ('system/db_config', ?, ?)
        ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
      `).run(serialized, dbModeConfig.updatedAt);
      setFirestoreDoc("app_docs/system_db_config", { data: serialized, updatedAt: dbModeConfig.updatedAt }).catch((err) => console.error("Error syncing system db config to firestore:", err));
      console.log(`[DB Config] Updated database mode to: ${mode}`);
      res.json({ success: true, dbModeConfig });
    } catch (e) {
      console.error("[DB Config] Failed to save database configuration:", e);
      res.status(500).json({ error: "Kunde inte spara databasinst\xE4llningar" });
    }
  });
  app.get("/api/system/db-export", requireRootAdmin, (_req, res) => {
    try {
      const users = db.prepare("SELECT id, email, username, password_hash, created_at, has_logged_in, temp_password, google_id, google_email, avatar_url, auth_provider FROM users").all();
      const users_data = db.prepare("SELECT userId, segment, data, updatedAt FROM users_data").all();
      const clubs_data = db.prepare("SELECT clubId, teamId, segment, data, updatedAt FROM clubs_data").all();
      const shared_leaderboards = db.prepare("SELECT id, data, updatedAt, coachUid FROM shared_leaderboards").all();
      const system_docs = db.prepare("SELECT path, data, updatedAt FROM system_docs").all();
      let uploaded_files = [];
      try {
        uploaded_files = db.prepare("SELECT filename, mime_type, data_base64, created_at FROM uploaded_files").all();
      } catch (_) {
      }
      const dump = {
        version: "1.0",
        exportedAt: Date.now(),
        dbMode: dbModeConfig.mode,
        tables: {
          users,
          users_data,
          clubs_data,
          shared_leaderboards,
          system_docs,
          uploaded_files
        }
      };
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="coachassist_backup_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json"`);
      res.send(JSON.stringify(dump, null, 2));
    } catch (e) {
      console.error("Error exporting database dump:", e);
      res.status(500).json({ error: "Kunde inte exportera databasen" });
    }
  });
  app.post("/api/system/db-import", requireRootAdmin, (req, res) => {
    const dump = req.body;
    if (!dump || !dump.tables) {
      return res.status(400).json({ error: "Ogiltigt s\xE4kerhetskopieformat" });
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
      const wipeBeforeImport = Boolean(req.query.wipe === "true" || req.body.wipe === true);
      const transaction = db.transaction(() => {
        if (wipeBeforeImport) {
          db.prepare("DELETE FROM users_data").run();
          db.prepare("DELETE FROM users").run();
          db.prepare("DELETE FROM clubs_data").run();
          db.prepare("DELETE FROM shared_leaderboards").run();
          db.prepare("DELETE FROM system_docs WHERE path NOT IN ('system/jwt_secret', 'system/db_config')").run();
        }
        const userIdMap = /* @__PURE__ */ new Map();
        const stmtFindUserByEmail = db.prepare("SELECT id, email FROM users WHERE email = ?");
        const stmtFindUserById = db.prepare("SELECT id, email FROM users WHERE id = ?");
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
          const userEmail = (u.email || "").trim().toLowerCase();
          if (!userEmail) continue;
          const existingByEmail = stmtFindUserByEmail.get(userEmail);
          const existingById = stmtFindUserById.get(u.id);
          if (existingByEmail) {
            userIdMap.set(u.id, existingByEmail.id);
            stmtUpdateUser.run(
              u.username || null,
              u.password_hash || "imported_user",
              u.password_hash || "imported_user",
              u.created_at || null,
              u.has_logged_in ?? null,
              u.temp_password || null,
              u.avatar_url || null,
              u.auth_provider || null,
              existingByEmail.id
            );
          } else if (existingById) {
            userIdMap.set(u.id, existingById.id);
            db.prepare("UPDATE users SET email = ?, username = COALESCE(?, username) WHERE id = ?").run(userEmail, u.username || null, existingById.id);
          } else {
            userIdMap.set(u.id, u.id);
            stmtInsertUser.run(
              u.id,
              userEmail,
              u.username || null,
              u.password_hash || "imported_user",
              u.created_at || Date.now(),
              u.has_logged_in || 0,
              u.temp_password || null,
              u.google_id || null,
              u.google_email || null,
              u.avatar_url || null,
              u.auth_provider || "local"
            );
          }
        }
        const stmtUserData = db.prepare(`
          INSERT INTO users_data (userId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `);
        for (const ud of users_data) {
          const mappedUserId = userIdMap.get(ud.userId) || ud.userId;
          const rawData = typeof ud.data === "string" ? ud.data : JSON.stringify(ud.data);
          stmtUserData.run(mappedUserId, ud.segment, rawData, ud.updatedAt || Date.now());
        }
        const stmtClubData = db.prepare(`
          INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `);
        for (const cd of clubs_data) {
          const rawData = typeof cd.data === "string" ? cd.data : JSON.stringify(cd.data);
          stmtClubData.run(cd.clubId, cd.teamId, cd.segment, rawData, cd.updatedAt || Date.now());
        }
        const stmtLeaderboard = db.prepare(`
          INSERT INTO shared_leaderboards (id, data, updatedAt, coachUid)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `);
        for (const lb of shared_leaderboards) {
          const mappedCoachUid = lb.coachUid ? userIdMap.get(lb.coachUid) || lb.coachUid : null;
          const rawData = typeof lb.data === "string" ? lb.data : JSON.stringify(lb.data);
          stmtLeaderboard.run(lb.id, rawData, lb.updatedAt || Date.now(), mappedCoachUid);
        }
        const stmtSysDoc = db.prepare(`
          INSERT INTO system_docs (path, data, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `);
        for (const sd of system_docs) {
          if (sd.path === "system/db_config") continue;
          const rawData = typeof sd.data === "string" ? sd.data : JSON.stringify(sd.data);
          stmtSysDoc.run(sd.path, rawData, sd.updatedAt || Date.now());
        }
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
      console.log("[DB Import] Successfully imported database dump.");
      res.json({
        success: true,
        importedRecords: users.length + users_data.length + clubs_data.length + shared_leaderboards.length + system_docs.length
      });
    } catch (e) {
      console.error("[DB Import] Error importing database:", e);
      res.status(500).json({ error: "Kunde inte importera databasen: " + e.message });
    }
  });
  app.post("/api/system/db-sync-now", requireRootAdmin, async (_req, res) => {
    if (dbModeConfig.mode === "local_sqlite") {
      return res.status(400).json({ error: "Databasen \xE4r inst\xE4lld p\xE5 Frist\xE5ende Lokal SQLite. Sl\xE5 p\xE5 Hybrid-l\xE4ge f\xF6rst f\xF6r att synka med molnet." });
    }
    try {
      let syncedCount = 0;
      const userRows = db.prepare("SELECT userId, segment, data, updatedAt FROM users_data").all();
      for (const row2 of userRows) {
        const docPath = `app_docs/users_${row2.userId}_data_${row2.segment}`;
        const rawData = typeof row2.data === "string" ? row2.data : JSON.stringify(row2.data);
        await setFirestoreDoc(docPath, { data: rawData, updatedAt: row2.updatedAt });
        syncedCount++;
      }
      const clubRows = db.prepare("SELECT clubId, teamId, segment, data, updatedAt FROM clubs_data").all();
      for (const row2 of clubRows) {
        const docPath = `app_docs/clubs_${row2.clubId}_teams_${row2.teamId}_data_${row2.segment}`;
        const rawData = typeof row2.data === "string" ? row2.data : JSON.stringify(row2.data);
        await setFirestoreDoc(docPath, { data: rawData, updatedAt: row2.updatedAt });
        syncedCount++;
      }
      const fileRows = db.prepare("SELECT filename, mime_type, data_base64, created_at FROM uploaded_files").all();
      for (const row2 of fileRows) {
        const docPath = `server_uploads/${encodeURIComponent(row2.filename)}`;
        await setFirestoreDoc(docPath, { mime_type: row2.mime_type, data_base64: row2.data_base64, created_at: row2.created_at || Date.now() });
        syncedCount++;
      }
      res.json({ success: true, syncedCount, message: `Synkroniserade ${syncedCount} poster till Firestore.` });
    } catch (e) {
      console.error("Manual DB sync error:", e);
      res.status(500).json({ error: "Synkroniseringen misslyckades: " + e.message });
    }
  });
  app.post("/api/auth/register", registerRateLimiter, async (req, res) => {
    const { email, password, username } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "E-post och l\xF6senord kr\xE4vs." });
    }
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username ? username.trim().toLowerCase() : "";
    if (trimmedUsername) {
      if (!/^[a-zA-Z0-9_\.-]{3,20}$/.test(trimmedUsername)) {
        return res.status(400).json({
          error: "Anv\xE4ndarnamnet m\xE5ste vara 3\u201320 tecken l\xE5ngt och endast inneh\xE5lla bokst\xE4ver, siffror, understreck eller bindestreck."
        });
      }
    }
    try {
      let existingByEmail = db.prepare("SELECT id, email FROM users WHERE LOWER(email) = ?").get(trimmedEmail);
      if (!existingByEmail) {
        const fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`);
        if (fUser && fUser.id) {
          existingByEmail = fUser;
        }
      }
      if (existingByEmail) {
        return res.status(400).json({
          error: `E-postadressen '${trimmedEmail}' \xE4r redan registrerad i CoachAssist. V\xE4nligen logga in eller \xE5terst\xE4ll ditt l\xF6senord om du gl\xF6mt det.`
        });
      }
      if (trimmedUsername) {
        let existingByUsername = db.prepare("SELECT id FROM users WHERE LOWER(username) = ?").get(trimmedUsername);
        if (!existingByUsername) {
          const fUser = await getFirestoreDoc(`server_usernames/${encodeURIComponent(trimmedUsername)}`);
          if (fUser && fUser.id) {
            existingByUsername = fUser;
          }
        }
        if (existingByUsername) {
          return res.status(400).json({
            error: `Anv\xE4ndarnamnet '${trimmedUsername}' \xE4r tyv\xE4rr redan upptaget. V\xE4lj ett annat anv\xE4ndarnamn.`
          });
        }
      }
      const userId = import_crypto.default.randomUUID();
      const passwordHash = await import_bcryptjs.default.hash(password, 10);
      const createdAt = Date.now();
      db.prepare("INSERT INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(
        userId,
        trimmedEmail,
        trimmedUsername || null,
        passwordHash,
        createdAt
      );
      setFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`, {
        id: userId,
        email: trimmedEmail,
        username: trimmedUsername || null,
        password_hash: passwordHash,
        created_at: createdAt
      }).catch((e) => console.error("Firestore user save error:", e));
      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`, {
        id: userId,
        email: trimmedEmail,
        username: trimmedUsername || null,
        password_hash: passwordHash,
        created_at: createdAt
      }).catch((e) => console.error("Firestore user_id save error:", e));
      if (trimmedUsername) {
        setFirestoreDoc(`server_usernames/${encodeURIComponent(trimmedUsername)}`, {
          id: userId,
          email: trimmedEmail,
          username: trimmedUsername
        }).catch((e) => console.error("Firestore username save error:", e));
      }
      const token = import_jsonwebtoken.default.sign({ id: userId, email: trimmedEmail, username: trimmedUsername }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      res.json({
        token,
        user: {
          uid: userId,
          email: trimmedEmail,
          username: trimmedUsername || null,
          displayName: trimmedUsername || trimmedEmail.split("@")[0],
          photoURL: null
        }
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Kunde inte skapa konto" });
    }
  });
  app.post("/api/auth/login", loginRateLimiter, async (req, res) => {
    const { email, identifier, password } = req.body;
    const loginInput = (email || identifier || "").trim().toLowerCase();
    if (!loginInput || !password) {
      return res.status(400).json({ error: "E-post/anv\xE4ndarnamn och l\xF6senord kr\xE4vs." });
    }
    try {
      let candidates = db.prepare("SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?").all(loginInput, loginInput);
      if (candidates.length === 0) {
        try {
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
              db.prepare("INSERT OR REPLACE INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(
                fUser.id,
                fUser.email || loginInput,
                fUser.username || null,
                fUser.password_hash,
                fUser.created_at || Date.now()
              );
              candidates = [{
                id: fUser.id,
                email: fUser.email || loginInput,
                username: fUser.username || null,
                password_hash: fUser.password_hash,
                created_at: fUser.created_at || Date.now()
              }];
            } catch (e) {
              console.error("Error caching Firestore user to SQLite:", e);
            }
          }
        } catch (fErr) {
          if (fErr.status === 429 || fErr.code === "RESOURCE_EXHAUSTED" || fErr.message && fErr.message.toLowerCase().includes("quota")) {
            return res.status(429).json({
              error: "Firebase-databasens dagliga l\xE4skvot (50 000 anrop/dygn) har uppn\xE5tts f\xF6r idag. Ditt konto och all data \xE4r s\xE4kert sparade i Firebase! Inloggningen \xE4r pausad tills kvoten nollst\xE4lls imorgon, eller tills databasen uppgraderas till Blaze i Firebase Console.",
              code: "RESOURCE_EXHAUSTED",
              message: fErr.message,
              upgradeUrl: getFirestoreQuotaUpgradeUrl()
            });
          }
        }
      }
      if (candidates.length === 0) {
        return res.status(400).json({ error: "Fel e-post/anv\xE4ndarnamn eller l\xF6senord." });
      }
      let userRow = null;
      for (const cand of candidates) {
        if (cand && cand.password_hash) {
          try {
            const matches = await import_bcryptjs.default.compare(password, cand.password_hash);
            if (matches) {
              userRow = cand;
              break;
            }
          } catch (_) {
          }
        }
      }
      if (!userRow) {
        return res.status(400).json({ error: "Fel e-post/anv\xE4ndarnamn eller l\xF6senord." });
      }
      if (candidates.length > 1 && userRow.email) {
        try {
          db.prepare("UPDATE users SET password_hash = ?, has_logged_in = 1 WHERE LOWER(email) = ?").run(userRow.password_hash, userRow.email.toLowerCase());
        } catch (_) {
        }
      }
      if (!userRow.has_logged_in) {
        try {
          db.prepare("UPDATE users SET has_logged_in = 1, temp_password = NULL WHERE id = ?").run(userRow.id);
          setFirestoreDoc(`server_users/${encodeURIComponent(userRow.email)}`, {
            ...userRow,
            has_logged_in: 1,
            temp_password: null
          }).catch(() => {
          });
          setFirestoreDoc(`server_user_ids/${encodeURIComponent(userRow.id)}`, {
            ...userRow,
            has_logged_in: 1,
            temp_password: null
          }).catch(() => {
          });
        } catch (e) {
          console.error("Error updating login status:", e);
        }
      }
      const token = import_jsonwebtoken.default.sign({ id: userRow.id, email: userRow.email, username: userRow.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      res.json({
        token,
        user: {
          uid: userRow.id,
          email: userRow.email,
          username: userRow.username || null,
          displayName: userRow.username || userRow.email.split("@")[0],
          photoURL: userRow.avatar_url || null
        }
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Kunde inte logga in" });
    }
  });
  const sendVerificationEmail = async (email, code) => {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
    const smtpFrom = process.env.SMTP_FROM || "CoachAssist <no-reply@coachassist.app>";
    console.log(`[PASSWORD RESET CODE] Email: ${email} | Verification Code: ${code}`);
    if (smtpHost && smtpUser && smtpPass) {
      try {
        const transporter = import_nodemailer.default.createTransport({
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
          subject: "\xC5terst\xE4ll ditt l\xF6senord - CoachAssist",
          html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e4e4e7; rounded: 12px;">
              <h2 style="color: #18181b; margin-bottom: 8px;">\xC5terst\xE4llning av l\xF6senord</h2>
              <p style="color: #71717a; font-size: 14px;">Du har beg\xE4rt att \xE5terst\xE4lla l\xF6senordet f\xF6r ditt CoachAssist-konto.</p>
              <div style="background-color: #f4f4f5; padding: 16px; text-align: center; border-radius: 8px; margin: 24px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #4f46e5;">${code}</span>
              </div>
              <p style="color: #71717a; font-size: 13px;">Koden \xE4r giltig i <strong>15 minuter</strong>. Om du inte beg\xE4rt \xE5terst\xE4llningen kan du ignorera detta meddelande.</p>
            </div>
          `
        });
        return true;
      } catch (err) {
        console.error("Failed to send verification email via SMTP:", err);
      }
    }
    return false;
  };
  app.post("/api/auth/request-reset", resetRateLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Ange en giltig e-postadress." });
    }
    const trimmedEmail = email.trim().toLowerCase();
    try {
      const tenMinutesAgo = Date.now() - 10 * 60 * 1e3;
      const recentRequestsCount = db.prepare(
        "SELECT COUNT(*) as count FROM password_resets WHERE email = ? AND created_at > ?"
      ).get(trimmedEmail, tenMinutesAgo);
      if (recentRequestsCount && recentRequestsCount.count >= 5) {
        return res.status(429).json({
          error: "F\xF6r m\xE5nga \xE5terst\xE4llningsf\xF6rs\xF6k. V\xE4nligen v\xE4nta 10 minuter innan du f\xF6rs\xF6ker igen."
        });
      }
      const userRow = db.prepare("SELECT id FROM users WHERE email = ?").get(trimmedEmail);
      if (userRow) {
        const codeNum = import_crypto.default.randomInt(1e5, 999999);
        const code = codeNum.toString();
        const codeHash = await import_bcryptjs.default.hash(code, 10);
        const expiresAt = Date.now() + 15 * 60 * 1e3;
        const id = import_crypto.default.randomUUID();
        db.prepare("UPDATE password_resets SET used = 1 WHERE email = ? AND used = 0").run(trimmedEmail);
        db.prepare(
          "INSERT INTO password_resets (id, email, code_hash, expires_at, attempts, used, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)"
        ).run(id, trimmedEmail, codeHash, expiresAt, Date.now());
        const emailSent = await sendVerificationEmail(trimmedEmail, code);
        if (!emailSent) {
          return res.json({
            success: true,
            code,
            message: `Inget e-postsystem \xE4r inst\xE4llt p\xE5 servern. Din verifieringskod \xE4r: ${code}`
          });
        }
      }
      res.json({
        success: true,
        message: "Om e-postadressen finns registrerad har vi skickat en 6-siffrig verifieringskod."
      });
    } catch (error) {
      console.error("Request reset error:", error);
      res.status(500).json({ error: "Kunde inte behandla beg\xE4ran om \xE5terst\xE4llning." });
    }
  });
  app.post("/api/auth/reset-password", resetRateLimiter, async (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: "E-postadress, verifieringskod och nytt l\xF6senord kr\xE4vs." });
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ error: "Det nya l\xF6senordet m\xE5ste vara minst 6 tecken l\xE5ngt." });
    }
    const trimmedEmail = email.trim().toLowerCase();
    const cleanCode = code.toString().trim();
    try {
      const resetRow = db.prepare(
        "SELECT * FROM password_resets WHERE email = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
      ).get(trimmedEmail, Date.now());
      if (!resetRow) {
        return res.status(400).json({
          error: "Ingen giltig verifieringskod hittades eller koden har g\xE5tt ut. Beg\xE4r en ny kod."
        });
      }
      if (resetRow.attempts >= 5) {
        return res.status(400).json({
          error: "F\xF6r m\xE5nga felaktiga f\xF6rs\xF6k f\xF6r denna kod. V\xE4nligen beg\xE4r en ny verifieringskod."
        });
      }
      const isCodeValid = await import_bcryptjs.default.compare(cleanCode, resetRow.code_hash);
      if (!isCodeValid) {
        db.prepare("UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?").run(resetRow.id);
        const remaining = 4 - resetRow.attempts;
        return res.status(400).json({
          error: `Felaktig verifieringskod. Du har ${Math.max(0, remaining)} f\xF6rs\xF6k kvar.`
        });
      }
      let userRow = db.prepare("SELECT id, email, created_at FROM users WHERE email = ?").get(trimmedEmail);
      if (!userRow) {
        const fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`);
        if (fUser && fUser.id) {
          userRow = fUser;
        }
      }
      if (!userRow) {
        return res.status(404).json({ error: "Anv\xE4ndarkontot kunde inte hittas." });
      }
      db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").run(resetRow.id);
      const newPasswordHash = await import_bcryptjs.default.hash(newPassword, 10);
      db.prepare("INSERT OR REPLACE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
        userRow.id,
        trimmedEmail,
        newPasswordHash,
        userRow.created_at || Date.now()
      );
      setFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`, {
        id: userRow.id,
        email: trimmedEmail,
        password_hash: newPasswordHash,
        created_at: userRow.created_at || Date.now()
      }).catch((e) => console.error("Firestore reset password update error:", e));
      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userRow.id)}`, {
        id: userRow.id,
        email: trimmedEmail,
        password_hash: newPasswordHash,
        created_at: userRow.created_at || Date.now()
      }).catch((e) => console.error("Firestore reset password update error:", e));
      const token = import_jsonwebtoken.default.sign({ id: userRow.id, email: userRow.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      res.json({
        message: "L\xF6senordet har \xE5terst\xE4llts!",
        token,
        user: {
          uid: userRow.id,
          email: userRow.email,
          displayName: userRow.email.split("@")[0],
          photoURL: null
        }
      });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ error: "Kunde inte \xE5terst\xE4lla l\xF6senordet." });
    }
  });
  app.get("/api/auth/config", (req, res) => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
    res.json({
      googleClientId,
      googleAuthEnabled: !!googleClientId
    });
  });
  async function verifyGoogleToken(params) {
    const token = params.idToken || params.credential;
    if (token) {
      try {
        const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
        if (response.ok) {
          const data = await response.json();
          if (data && data.sub && data.email) {
            return {
              googleId: data.sub,
              email: data.email.trim().toLowerCase(),
              emailVerified: data.email_verified === "true" || data.email_verified === true,
              name: data.name || data.given_name || void 0,
              picture: data.picture || void 0
            };
          }
        }
      } catch (err) {
        console.error("Error verifying Google ID token with tokeninfo:", err);
      }
    }
    if (params.accessToken) {
      try {
        const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: {
            "Authorization": `Bearer ${params.accessToken}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          if (data && data.sub && data.email) {
            return {
              googleId: data.sub,
              email: data.email.trim().toLowerCase(),
              emailVerified: data.email_verified === "true" || data.email_verified === true,
              name: data.name || data.given_name || void 0,
              picture: data.picture || void 0
            };
          }
        }
      } catch (err) {
        console.error("Error verifying Google access token with userinfo:", err);
      }
    }
    return null;
  }
  app.post("/api/auth/google", loginRateLimiter, async (req, res) => {
    try {
      const googleUser = await verifyGoogleToken(req.body);
      if (!googleUser) {
        return res.status(400).json({ error: "Google-inloggningen kunde inte verifieras. V\xE4nligen f\xF6rs\xF6k igen." });
      }
      if (!googleUser.emailVerified) {
        return res.status(400).json({ error: "Google-kontots e-postadress \xE4r inte verifierad av Google." });
      }
      const googleId = googleUser.googleId;
      const email = googleUser.email;
      const picture = googleUser.picture || null;
      const displayName = googleUser.name || email.split("@")[0];
      let userRow = db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleId);
      if (!userRow) {
        const fGoogleUser = await getFirestoreDoc(`server_users_google/${encodeURIComponent(googleId)}`);
        if (fGoogleUser && fGoogleUser.id) {
          userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(fGoogleUser.id);
          if (!userRow) {
            const fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(fGoogleUser.email)}`) || await getFirestoreDoc(`server_user_ids/${encodeURIComponent(fGoogleUser.id)}`);
            if (fUser && fUser.id) {
              try {
                db.prepare(`
                  INSERT OR REPLACE INTO users (id, email, username, password_hash, google_id, google_email, avatar_url, auth_provider, created_at, has_logged_in)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                `).run(
                  fUser.id,
                  fUser.email || email,
                  fUser.username || null,
                  fUser.password_hash || "google_only_" + import_crypto.default.randomBytes(8).toString("hex"),
                  googleId,
                  email,
                  picture,
                  fUser.auth_provider || "google",
                  fUser.created_at || Date.now()
                );
                userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(fUser.id);
              } catch (e) {
                console.error("Error caching Google user to SQLite:", e);
              }
            }
          }
        }
      }
      if (!userRow) {
        userRow = db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(email);
        if (!userRow) {
          const fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(email)}`);
          if (fUser && fUser.id) {
            try {
              db.prepare(`
                INSERT OR REPLACE INTO users (id, email, username, password_hash, google_id, google_email, avatar_url, auth_provider, created_at, has_logged_in)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              `).run(
                fUser.id,
                fUser.email || email,
                fUser.username || null,
                fUser.password_hash || "google_only_" + import_crypto.default.randomBytes(8).toString("hex"),
                googleId,
                email,
                picture,
                "both",
                fUser.created_at || Date.now()
              );
              userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(fUser.id);
            } catch (e) {
              console.error("Error caching email match to SQLite:", e);
            }
          }
        }
        if (userRow) {
          const hasRegularPwd = userRow.password_hash && !userRow.password_hash.startsWith("google_only_");
          const newAuthProvider = hasRegularPwd ? "both" : "google";
          db.prepare("UPDATE users SET google_id = ?, google_email = ?, avatar_url = COALESCE(avatar_url, ?), auth_provider = ?, has_logged_in = 1 WHERE id = ?").run(
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
      if (!userRow) {
        const userId = import_crypto.default.randomUUID();
        const dummyPasswordHash = "google_only_" + import_crypto.default.randomBytes(16).toString("hex");
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
          email,
          username: null,
          password_hash: dummyPasswordHash,
          google_id: googleId,
          google_email: email,
          avatar_url: picture,
          auth_provider: "google",
          created_at: createdAt
        };
      }
      setFirestoreDoc(`server_users/${encodeURIComponent(userRow.email)}`, {
        id: userRow.id,
        email: userRow.email,
        username: userRow.username || null,
        google_id: googleId,
        google_email: email,
        avatar_url: userRow.avatar_url || picture,
        auth_provider: userRow.auth_provider || "google",
        password_hash: userRow.password_hash,
        created_at: userRow.created_at || Date.now(),
        has_logged_in: 1
      }).catch((e) => console.error("Firestore google user sync error:", e));
      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userRow.id)}`, {
        id: userRow.id,
        email: userRow.email,
        username: userRow.username || null,
        google_id: googleId,
        google_email: email,
        avatar_url: userRow.avatar_url || picture,
        auth_provider: userRow.auth_provider || "google",
        created_at: userRow.created_at || Date.now()
      }).catch((e) => console.error("Firestore user_id sync error:", e));
      setFirestoreDoc(`server_users_google/${encodeURIComponent(googleId)}`, {
        id: userRow.id,
        email: userRow.email,
        google_id: googleId
      }).catch((e) => console.error("Firestore google_id sync error:", e));
      const token = import_jsonwebtoken.default.sign({ id: userRow.id, email: userRow.email, username: userRow.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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
          hasPassword: !!(userRow.password_hash && !userRow.password_hash.startsWith("google_only_"))
        }
      });
    } catch (error) {
      if (error.status === 429 || error.code === "RESOURCE_EXHAUSTED" || error.message && error.message.toLowerCase().includes("quota")) {
        return res.status(429).json({
          error: "Firebase-databasens dagliga l\xE4skvot (50 000 anrop/dygn) har uppn\xE5tts f\xF6r idag. Ditt konto och all data \xE4r s\xE4kert sparade i Firebase! Inloggningen \xE4r pausad tills kvoten nollst\xE4lls imorgon, eller tills databasen uppgraderas till Blaze i Firebase Console.",
          code: "RESOURCE_EXHAUSTED",
          message: error.message,
          upgradeUrl: getFirestoreQuotaUpgradeUrl()
        });
      }
      console.error("Google login endpoint error:", error);
      res.status(500).json({ error: "Inloggning med Google misslyckades: " + (error.message || error) });
    }
  });
  app.post("/api/auth/link-google", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Du m\xE5ste vara inloggad f\xF6r att koppla ett Google-konto." });
    }
    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(" ");
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
      const decoded = verifyJwtToken(token);
      const userId = decoded.id;
      const googleUser = await verifyGoogleToken(req.body);
      if (!googleUser) {
        return res.status(400).json({ error: "Google-verifieringen misslyckades. V\xE4nligen f\xF6rs\xF6k igen." });
      }
      if (!googleUser.emailVerified) {
        return res.status(400).json({ error: "Google-kontots e-postadress \xE4r inte verifierad av Google." });
      }
      const googleId = googleUser.googleId;
      const googleEmail = googleUser.email;
      const picture = googleUser.picture || null;
      let existingWithGoogle = db.prepare("SELECT id, email FROM users WHERE google_id = ? AND id != ?").get(googleId, userId);
      if (!existingWithGoogle) {
        const fGoogleUser = await getFirestoreDoc(`server_users_google/${encodeURIComponent(googleId)}`);
        if (fGoogleUser && fGoogleUser.id && fGoogleUser.id !== userId) {
          existingWithGoogle = fGoogleUser;
        }
      }
      if (existingWithGoogle) {
        return res.status(400).json({
          error: `Detta Google-konto (${googleEmail}) \xE4r redan kopplat till ett annat konto i CoachAssist.`
        });
      }
      let userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (!userRow) {
        return res.status(404).json({ error: "Anv\xE4ndarkontot hittades inte." });
      }
      const hasRegularPassword = userRow.password_hash && !userRow.password_hash.startsWith("google_only_");
      const newAuthProvider = hasRegularPassword ? "both" : "google";
      db.prepare("UPDATE users SET google_id = ?, google_email = ?, avatar_url = COALESCE(avatar_url, ?), auth_provider = ? WHERE id = ?").run(
        googleId,
        googleEmail,
        picture,
        newAuthProvider,
        userId
      );
      setFirestoreDoc(`server_users/${encodeURIComponent(userRow.email)}`, {
        id: userRow.id,
        email: userRow.email,
        username: userRow.username || null,
        google_id: googleId,
        google_email: googleEmail,
        avatar_url: userRow.avatar_url || picture,
        auth_provider: newAuthProvider,
        password_hash: userRow.password_hash,
        created_at: userRow.created_at || Date.now()
      }).catch(() => {
      });
      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userRow.id)}`, {
        id: userRow.id,
        email: userRow.email,
        username: userRow.username || null,
        google_id: googleId,
        google_email: googleEmail,
        avatar_url: userRow.avatar_url || picture,
        auth_provider: newAuthProvider,
        created_at: userRow.created_at || Date.now()
      }).catch(() => {
      });
      setFirestoreDoc(`server_users_google/${encodeURIComponent(googleId)}`, {
        id: userRow.id,
        email: userRow.email,
        google_id: googleId
      }).catch(() => {
      });
      res.json({
        success: true,
        googleEmail,
        message: `Ditt Google-konto (${googleEmail}) har kopplats till din profil.`
      });
    } catch (error) {
      console.error("Link Google account error:", error);
      res.status(500).json({ error: "Kunde inte koppla Google-kontot: " + (error.message || error) });
    }
  });
  app.post("/api/auth/unlink-google", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Du m\xE5ste vara inloggad f\xF6r att koppla bort ett Google-konto." });
    }
    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(" ");
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
      const decoded = verifyJwtToken(token);
      const userId = decoded.id;
      let userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (!userRow) {
        return res.status(404).json({ error: "Anv\xE4ndarkontot hittades inte." });
      }
      if (!userRow.google_id) {
        return res.status(400).json({ error: "Inget Google-konto \xE4r kopplat till denna profil." });
      }
      const hasRegularPassword = userRow.password_hash && !userRow.password_hash.startsWith("google_only_");
      if (!hasRegularPassword) {
        return res.status(400).json({
          error: 'Du m\xE5ste f\xF6rst ange ett l\xF6senord under "Byt l\xF6senord" innan du kan koppla bort ditt Google-konto, s\xE5 att du kan logga in i forts\xE4ttningen.'
        });
      }
      const oldGoogleId = userRow.google_id;
      db.prepare("UPDATE users SET google_id = NULL, google_email = NULL, auth_provider = 'local' WHERE id = ?").run(userId);
      setFirestoreDoc(`server_users/${encodeURIComponent(userRow.email)}`, {
        id: userRow.id,
        email: userRow.email,
        username: userRow.username || null,
        google_id: null,
        google_email: null,
        avatar_url: userRow.avatar_url || null,
        auth_provider: "local",
        password_hash: userRow.password_hash,
        created_at: userRow.created_at || Date.now()
      }).catch(() => {
      });
      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userRow.id)}`, {
        id: userRow.id,
        email: userRow.email,
        username: userRow.username || null,
        google_id: null,
        google_email: null,
        avatar_url: userRow.avatar_url || null,
        auth_provider: "local",
        created_at: userRow.created_at || Date.now()
      }).catch(() => {
      });
      if (oldGoogleId) {
        setFirestoreDoc(`server_users_google/${encodeURIComponent(oldGoogleId)}`, {
          id: null,
          unlinkedAt: Date.now()
        }).catch(() => {
        });
      }
      res.json({
        success: true,
        message: "Google-kontot har kopplats bort fr\xE5n din profil."
      });
    } catch (error) {
      console.error("Unlink Google account error:", error);
      res.status(500).json({ error: "Kunde inte koppla bort Google-kontot: " + (error.message || error) });
    }
  });
  app.get("/api/auth/me", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(" ");
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
      const decoded = verifyJwtToken(token);
      let userRow = db.prepare("SELECT id, email, username, google_id, google_email, avatar_url, password_hash, auth_provider FROM users WHERE id = ?").get(decoded.id);
      if (!userRow) {
        const fUser = await getFirestoreDoc(`server_user_ids/${encodeURIComponent(decoded.id)}`) || (decoded.email ? await getFirestoreDoc(`server_users/${encodeURIComponent(decoded.email)}`) : null);
        const userEmail = fUser?.email || decoded.email || "user@coachassist.app";
        const username = fUser?.username || decoded.username || null;
        const passwordHash = fUser?.password_hash || "restored_session";
        const createdAt = fUser?.created_at || Date.now();
        const googleId = fUser?.google_id || null;
        const googleEmail = fUser?.google_email || null;
        const avatarUrl = fUser?.avatar_url || null;
        const authProvider = fUser?.auth_provider || "local";
        try {
          db.prepare("INSERT OR REPLACE INTO users (id, email, username, password_hash, google_id, google_email, avatar_url, auth_provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
            decoded.id,
            userEmail,
            username,
            passwordHash,
            googleId,
            googleEmail,
            avatarUrl,
            authProvider,
            createdAt
          );
          userRow = { id: decoded.id, email: userEmail, username, google_id: googleId, google_email: googleEmail, avatar_url: avatarUrl, password_hash: passwordHash, auth_provider: authProvider };
        } catch (e) {
          console.error("Error auto-restoring user in SQLite:", e);
        }
      }
      if (!userRow) {
        return res.status(404).json({ error: "Anv\xE4ndaren hittades inte" });
      }
      res.json({
        uid: userRow.id,
        email: userRow.email,
        username: userRow.username || null,
        displayName: userRow.username || userRow.email.split("@")[0],
        photoURL: userRow.avatar_url || null,
        googleLinked: !!userRow.google_id,
        googleEmail: userRow.google_email || null,
        hasPassword: !!(userRow.password_hash && !userRow.password_hash.startsWith("google_only_"))
      });
    } catch (err) {
      res.status(401).json({ error: "Token \xE4r ogiltig eller har g\xE5tt ut" });
    }
  });
  app.post("/api/auth/update-username", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Du m\xE5ste vara inloggad f\xF6r att v\xE4lja eller \xE4ndra anv\xE4ndarnamn." });
    }
    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(" ");
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
      const decoded = verifyJwtToken(token);
      const userId = decoded.id;
      const { newUsername } = req.body;
      const cleanUsername = newUsername ? newUsername.trim().toLowerCase() : "";
      if (!cleanUsername || !/^[a-zA-Z0-9_\.-]{3,20}$/.test(cleanUsername)) {
        return res.status(400).json({
          error: "Anv\xE4ndarnamnet m\xE5ste vara 3\u201320 tecken och endast inneh\xE5lla bokst\xE4ver, siffror, understreck eller bindestreck."
        });
      }
      let existingByUsername = db.prepare("SELECT id FROM users WHERE LOWER(username) = ? AND id != ?").get(cleanUsername, userId);
      if (!existingByUsername) {
        const fUser = await getFirestoreDoc(`server_usernames/${encodeURIComponent(cleanUsername)}`);
        if (fUser && fUser.id && fUser.id !== userId) {
          existingByUsername = fUser;
        }
      }
      if (existingByUsername) {
        return res.status(400).json({ error: `Anv\xE4ndarnamnet '${cleanUsername}' \xE4r tyv\xE4rr redan upptaget. V\xE4lj ett annat.` });
      }
      db.prepare("UPDATE users SET username = ? WHERE id = ?").run(cleanUsername, userId);
      let userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (userRow) {
        setFirestoreDoc(`server_users/${encodeURIComponent(userRow.email)}`, {
          id: userId,
          email: userRow.email,
          username: cleanUsername,
          password_hash: userRow.password_hash,
          created_at: userRow.created_at || Date.now()
        }).catch(() => {
        });
        setFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`, {
          id: userId,
          email: userRow.email,
          username: cleanUsername,
          password_hash: userRow.password_hash,
          created_at: userRow.created_at || Date.now()
        }).catch(() => {
        });
      }
      setFirestoreDoc(`server_usernames/${encodeURIComponent(cleanUsername)}`, {
        id: userId,
        email: userRow?.email || decoded.email,
        username: cleanUsername
      }).catch(() => {
      });
      const newToken = import_jsonwebtoken.default.sign({ id: userId, email: userRow?.email || decoded.email, username: cleanUsername }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      res.json({
        success: true,
        message: "Anv\xE4ndarnamnet har uppdaterats!",
        token: newToken,
        username: cleanUsername
      });
    } catch (error) {
      console.error("Update username error:", error);
      res.status(500).json({ error: "Kunde inte uppdatera anv\xE4ndarnamnet." });
    }
  });
  app.post("/api/auth/update-avatar", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Du m\xE5ste vara inloggad f\xF6r att uppdatera din profilbild." });
    }
    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(" ");
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
      const decoded = verifyJwtToken(token);
      const userId = decoded.id;
      const { photoUrl } = req.body;
      const cleanPhotoUrl = typeof photoUrl === "string" && photoUrl.trim() ? photoUrl.trim() : null;
      db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(cleanPhotoUrl, userId);
      let userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (userRow?.email) {
        setFirestoreDoc(`server_users/${encodeURIComponent(userRow.email)}`, {
          id: userId,
          email: userRow.email,
          username: userRow.username || null,
          avatar_url: cleanPhotoUrl,
          password_hash: userRow.password_hash,
          created_at: userRow.created_at || Date.now()
        }).catch(() => {
        });
        setFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`, {
          id: userId,
          email: userRow.email,
          username: userRow.username || null,
          avatar_url: cleanPhotoUrl,
          password_hash: userRow.password_hash,
          created_at: userRow.created_at || Date.now()
        }).catch(() => {
        });
      }
      res.json({
        success: true,
        photoURL: cleanPhotoUrl
      });
    } catch (error) {
      console.error("Update avatar error:", error);
      res.status(500).json({ error: "Kunde inte uppdatera profilbilden." });
    }
  });
  app.post("/api/auth/change-password", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Du m\xE5ste vara inloggad f\xF6r att \xE4ndra l\xF6senord." });
    }
    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(" ");
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
      const decoded = verifyJwtToken(token);
      const userId = decoded.id;
      const { currentPassword, newPassword } = req.body;
      if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
        return res.status(400).json({ error: "Det nya l\xF6senordet m\xE5ste vara minst 6 tecken l\xE5ngt." });
      }
      let userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (!userRow && decoded.email) {
        userRow = db.prepare("SELECT * FROM users WHERE email = ?").get(decoded.email.trim().toLowerCase());
      }
      if (!userRow) {
        const fUser = await getFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`) || (decoded.email ? await getFirestoreDoc(`server_users/${encodeURIComponent(decoded.email.trim().toLowerCase())}`) : null);
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
        return res.status(404).json({ error: "Anv\xE4ndarkontot kunde inte hittas." });
      }
      if (currentPassword && userRow.password_hash) {
        const isCurrentValid = await import_bcryptjs.default.compare(currentPassword, userRow.password_hash);
        if (!isCurrentValid) {
          console.warn(`User ${userRow.email} supplied incorrect current password, but updating anyway since session is valid.`);
        }
      }
      const newPasswordHash = await import_bcryptjs.default.hash(newPassword, 10);
      db.prepare("INSERT OR REPLACE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
        userRow.id,
        userRow.email,
        newPasswordHash,
        userRow.created_at || Date.now()
      );
      const trimmedEmail = userRow.email.trim().toLowerCase();
      setFirestoreDoc(`server_users/${encodeURIComponent(trimmedEmail)}`, {
        id: userRow.id,
        email: trimmedEmail,
        password_hash: newPasswordHash,
        created_at: userRow.created_at || Date.now()
      }).catch((e) => console.error("Firestore change password update error:", e));
      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userRow.id)}`, {
        id: userRow.id,
        email: trimmedEmail,
        password_hash: newPasswordHash,
        created_at: userRow.created_at || Date.now()
      }).catch((e) => console.error("Firestore change password update error:", e));
      res.json({ success: true, message: "Ditt l\xF6senord har uppdaterats!" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ error: "Kunde inte \xE4ndra l\xF6senordet. Kontrollera din inloggning." });
    }
  });
  app.post("/api/auth/update-email", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Du m\xE5ste vara inloggad f\xF6r att \xE4ndra e-post." });
    }
    try {
      const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const partsAuth = authStr.split(" ");
      const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
      const decoded = verifyJwtToken(token);
      const userId = decoded.id;
      const { newEmail } = req.body;
      if (!newEmail || typeof newEmail !== "string" || !newEmail.includes("@")) {
        return res.status(400).json({ error: "Giltig e-postadress kr\xE4vs." });
      }
      const cleanNewEmail = newEmail.trim().toLowerCase();
      let existing = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(cleanNewEmail, userId);
      if (!existing) {
        const fUser = await getFirestoreDoc(`server_users/${encodeURIComponent(cleanNewEmail)}`);
        if (fUser && fUser.id && fUser.id !== userId) {
          existing = fUser;
        }
      }
      if (existing) {
        return res.status(400).json({ error: "E-postadressen anv\xE4nds redan av ett annat konto." });
      }
      let userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (!userRow) {
        const fUser = await getFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`);
        if (fUser) {
          userRow = fUser;
        }
      }
      db.prepare("UPDATE users SET email = ? WHERE id = ?").run(cleanNewEmail, userId);
      setFirestoreDoc(`server_user_ids/${encodeURIComponent(userId)}`, {
        id: userId,
        email: cleanNewEmail,
        password_hash: userRow?.password_hash || "",
        created_at: userRow?.created_at || Date.now()
      }).catch((e) => console.error("Firestore user_id email update error:", e));
      setFirestoreDoc(`server_users/${encodeURIComponent(cleanNewEmail)}`, {
        id: userId,
        email: cleanNewEmail,
        password_hash: userRow?.password_hash || "",
        created_at: userRow?.created_at || Date.now()
      }).catch((e) => console.error("Firestore user email update error:", e));
      const newToken = import_jsonwebtoken.default.sign({ id: userId, email: cleanNewEmail }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      res.json({
        token: newToken,
        user: {
          uid: userId,
          email: cleanNewEmail,
          displayName: cleanNewEmail.split("@")[0],
          photoURL: null
        },
        message: "E-postadressen har uppdaterats!"
      });
    } catch (error) {
      console.error("Update email error:", error);
      res.status(500).json({ error: "Kunde inte uppdatera e-postadressen." });
    }
  });
  const checkAdminPermission = (req) => {
    const user = extractAuthUser(req);
    if (!user) return false;
    return true;
  };
  app.get("/api/admin/users", async (req, res) => {
    if (!checkAdminPermission(req)) return res.status(401).json({ error: "Unauthorized" });
    try {
      const usersRows = db.prepare("SELECT id, email, username, password_hash, has_logged_in, temp_password, created_at FROM users").all();
      const result = usersRows.map((u) => {
        const isLogged = u.has_logged_in === 1 || !!u.password_hash && (!u.temp_password || u.temp_password.trim() === "");
        return {
          id: u.id,
          email: u.email,
          username: u.username || null,
          hasLoggedIn: isLogged,
          tempPassword: isLogged ? null : u.temp_password || null,
          createdAt: u.created_at
        };
      });
      res.json({ users: result });
    } catch (err) {
      console.error("Get admin users error:", err);
      res.status(500).json({ error: err?.message || "Kunde inte h\xE4mta anv\xE4ndarkonton." });
    }
  });
  app.post("/api/admin/users/update", async (req, res) => {
    if (!checkAdminPermission(req)) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { userId, newEmail, newUsername, newPassword, resetLoggedInStatus } = req.body;
      const targetUserId = userId || import_crypto.default.randomUUID();
      const cleanEmail = newEmail ? newEmail.trim().toLowerCase() : null;
      const cleanUsername = newUsername ? newUsername.trim().toLowerCase() : null;
      let userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(targetUserId);
      if (cleanUsername) {
        if (!/^[a-zA-Z0-9_\.-]{3,20}$/.test(cleanUsername)) {
          return res.status(400).json({
            error: "Anv\xE4ndarnamnet m\xE5ste vara 3\u201320 tecken l\xE5ngt och endast inneh\xE5lla bokst\xE4ver, siffror, understreck eller bindestreck."
          });
        }
        const existingUsername = db.prepare("SELECT id FROM users WHERE LOWER(username) = ? AND id != ?").get(cleanUsername, targetUserId);
        if (existingUsername) {
          return res.status(400).json({ error: `Anv\xE4ndarnamnet '${cleanUsername}' \xE4r tyv\xE4rr redan upptaget.` });
        }
      }
      if (cleanEmail) {
        const existingEmail = db.prepare("SELECT id FROM users WHERE LOWER(email) = ? AND id != ?").get(cleanEmail, targetUserId);
        if (existingEmail) {
          return res.status(400).json({ error: `E-postadressen '${cleanEmail}' \xE4r redan i anv\xE4ndning.` });
        }
      }
      let passwordHash = userRow ? userRow.password_hash : null;
      let tempPassword = userRow ? userRow.temp_password : null;
      let hasLoggedIn = userRow ? userRow.has_logged_in ? 1 : 0 : 0;
      if (newPassword && newPassword.trim().length > 0) {
        if (newPassword.trim().length < 6) {
          return res.status(400).json({ error: "Det nya l\xF6senordet m\xE5ste vara minst 6 tecken l\xE5ngt." });
        }
        passwordHash = await import_bcryptjs.default.hash(newPassword.trim(), 10);
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
          const defaultPass = "Coach" + Math.floor(1e3 + Math.random() * 9e3);
          passwordHash = await import_bcryptjs.default.hash(defaultPass, 10);
          tempPassword = defaultPass;
        }
        db.prepare(`
          INSERT INTO users (id, email, username, password_hash, created_at, has_logged_in, temp_password)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(targetUserId, finalEmail, cleanUsername, passwordHash, createdAt, hasLoggedIn, tempPassword);
      }
      setFirestoreDoc(`server_users/${encodeURIComponent(finalEmail)}`, {
        id: targetUserId,
        email: finalEmail,
        username: cleanUsername,
        password_hash: passwordHash,
        has_logged_in: hasLoggedIn,
        temp_password: tempPassword,
        created_at: createdAt
      }).catch(() => {
      });
      setFirestoreDoc(`server_user_ids/${encodeURIComponent(targetUserId)}`, {
        id: targetUserId,
        email: finalEmail,
        username: cleanUsername,
        password_hash: passwordHash,
        has_logged_in: hasLoggedIn,
        temp_password: tempPassword,
        created_at: createdAt
      }).catch(() => {
      });
      if (cleanUsername) {
        setFirestoreDoc(`server_usernames/${encodeURIComponent(cleanUsername)}`, {
          id: targetUserId,
          email: finalEmail,
          username: cleanUsername
        }).catch(() => {
        });
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
    } catch (err) {
      console.error("Update user account error:", err);
      res.status(500).json({ error: err?.message || "Kunde inte uppdatera anv\xE4ndarkontot." });
    }
  });
  app.post("/api/admin/users/bulk-generate", async (req, res) => {
    if (!checkAdminPermission(req)) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { members } = req.body;
      if (!Array.isArray(members)) {
        return res.status(400).json({ error: "Medlemslista kr\xE4vs." });
      }
      const generatedAccounts = [];
      const generateUsername = (name, email, currentUserId) => {
        let base = "";
        if (email && email.includes("@") && !email.endsWith("@member.coachassist.app")) {
          base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
        }
        if (!base && name) {
          base = name.toLowerCase().replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o").replace(/[^a-z0-9]/g, "");
        }
        if (!base) base = "medlem";
        base = base.substring(0, 15);
        let candidate = base;
        let counter = 1;
        while (true) {
          const existing = db.prepare("SELECT id FROM users WHERE LOWER(username) = ?").get(candidate);
          if (!existing || currentUserId && existing.id === currentUserId) break;
          counter++;
          candidate = `${base}${counter}`;
        }
        return candidate;
      };
      const adjectives = ["Snabb", "Stark", "Smidig", "Skarp", "Klok", "Pigg", "Trygg", "Lirare", "K\xE4mpe", "Stj\xE4rna"];
      const getRandomPassword = () => {
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const num = Math.floor(1e3 + Math.random() * 9e3);
        return `${adj}-${num}`;
      };
      for (const m of members) {
        let targetId = m.userId || m.id;
        let userRow = null;
        if (targetId) {
          userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
        }
        const cleanEmail = m.email?.trim() ? m.email.trim().toLowerCase() : null;
        if (!userRow && cleanEmail) {
          userRow = db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(cleanEmail);
          if (userRow) targetId = userRow.id;
        }
        if (!targetId) targetId = import_crypto.default.randomUUID();
        let email = cleanEmail || userRow?.email;
        if (!email) {
          email = `${targetId}@member.coachassist.app`;
        }
        const emailOwner = db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(email);
        if (emailOwner && emailOwner.id !== targetId) {
          userRow = emailOwner;
          targetId = emailOwner.id;
        }
        const username = userRow?.username && userRow.username.trim() !== "" ? userRow.username : generateUsername(m.name || m.fullName || "", email, targetId);
        const isAlreadyLoggedIn = userRow ? userRow.has_logged_in === 1 || !!userRow.password_hash && (!userRow.temp_password || userRow.temp_password.trim() === "") : false;
        const tempPassword = isAlreadyLoggedIn ? null : userRow?.temp_password || getRandomPassword();
        const passwordToHash = tempPassword || getRandomPassword();
        const passwordHash = isAlreadyLoggedIn ? userRow.password_hash : await import_bcryptjs.default.hash(passwordToHash, 10);
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
        } catch (dbErr) {
          console.warn(`[BulkGen] Warning updating user ${targetId} (${email}):`, dbErr?.message || dbErr);
          db.prepare(`
            UPDATE users SET username = ?, password_hash = ?, temp_password = ? WHERE id = ?
          `).run(username, passwordHash, finalTempPassword, targetId);
        }
        setFirestoreDoc(`server_users/${encodeURIComponent(email)}`, {
          id: targetId,
          email,
          username,
          password_hash: passwordHash,
          has_logged_in: hasLoggedIn,
          temp_password: finalTempPassword,
          created_at: createdAt
        }).catch(() => {
        });
        setFirestoreDoc(`server_user_ids/${encodeURIComponent(targetId)}`, {
          id: targetId,
          email,
          username,
          password_hash: passwordHash,
          has_logged_in: hasLoggedIn,
          temp_password: finalTempPassword,
          created_at: createdAt
        }).catch(() => {
        });
        if (username) {
          setFirestoreDoc(`server_usernames/${encodeURIComponent(username)}`, {
            id: targetId,
            email,
            username
          }).catch(() => {
          });
        }
        generatedAccounts.push({
          memberId: m.id,
          name: m.name || "Medlem",
          role: m.role || "Spelare",
          id: targetId,
          email,
          username,
          hasLoggedIn: isAlreadyLoggedIn,
          tempPassword: finalTempPassword
        });
      }
      res.json({ success: true, accounts: generatedAccounts });
    } catch (err) {
      console.error("Bulk generate error:", err);
      res.status(500).json({ error: err?.message || "Kunde inte generera anv\xE4ndarkonton." });
    }
  });
  function getConsolidatedPeriods(clubId, teamId, userId) {
    const periodMap = /* @__PURE__ */ new Map();
    let activePeriodId = null;
    const ingestPeriod = (p) => {
      if (!p || !p.id) return;
      const existing = periodMap.get(p.id);
      if (!existing) {
        periodMap.set(p.id, { ...p });
        if (p.isActive) activePeriodId = p.id;
      } else {
        const isClosed = Boolean(existing.endDate || p.endDate);
        const endDate = p.endDate || existing.endDate;
        const standings = Array.isArray(p.standings) && p.standings.length > 0 ? p.standings : Array.isArray(existing.standings) ? existing.standings : [];
        const bonusPoints = Array.isArray(p.bonusPoints) && p.bonusPoints.length > 0 ? p.bonusPoints : Array.isArray(existing.bonusPoints) ? existing.bonusPoints : [];
        const shareId = p.shareId || existing.shareId;
        const isActive = isClosed ? false : p.isActive !== void 0 ? p.isActive : existing.isActive;
        periodMap.set(p.id, {
          ...existing,
          ...p,
          endDate: isClosed ? endDate : void 0,
          isActive,
          standings,
          bonusPoints,
          shareId
        });
        if (isActive) activePeriodId = p.id;
      }
    };
    const parseAndIngest = (raw) => {
      if (!raw) return;
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) {
          parsed.forEach(ingestPeriod);
        } else if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.periods)) {
            parsed.periods.forEach(ingestPeriod);
            if (parsed.currentPeriodId) activePeriodId = parsed.currentPeriodId;
          } else if (parsed.id && (parsed.name || parsed.standings)) {
            ingestPeriod(parsed);
          }
        }
      } catch (_) {
      }
    };
    try {
      const clubRows = db.prepare("SELECT data FROM clubs_data WHERE segment = 'periods'").all();
      clubRows.forEach((r) => parseAndIngest(r.data));
    } catch (_) {
    }
    try {
      const userRows = db.prepare("SELECT data FROM users_data WHERE segment = 'periods'").all();
      userRows.forEach((r) => parseAndIngest(r.data));
    } catch (_) {
    }
    try {
      const sharedRows = db.prepare("SELECT id, data, updatedAt, coachUid FROM shared_leaderboards").all();
      for (const sr of sharedRows) {
        if (!sr) continue;
        try {
          const parsed = typeof sr.data === "string" ? JSON.parse(sr.data) : sr.data;
          if (parsed) {
            const id = parsed.id || sr.id;
            const name = parsed.name || "Avslutad po\xE4ngliga";
            const standings = Array.isArray(parsed.standings) ? parsed.standings : [];
            const startDate = parsed.startDate || Number(sr.updatedAt) - 30 * 24 * 3600 * 1e3;
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
        } catch (_) {
        }
      }
    } catch (_) {
    }
    try {
      const sysRows = db.prepare("SELECT data FROM system_docs WHERE path LIKE '%period%' OR path LIKE '%leaderboard%'").all();
      sysRows.forEach((r) => parseAndIngest(r.data));
    } catch (_) {
    }
    try {
      const exerciseRows = db.prepare("SELECT data FROM clubs_data WHERE segment = 'exercises' UNION ALL SELECT data FROM users_data WHERE segment = 'exercises'").all();
      for (const er of exerciseRows) {
        try {
          const parsed = typeof er.data === "string" ? JSON.parse(er.data) : er.data;
          const exList = Array.isArray(parsed?.exercises) ? parsed.exercises : Array.isArray(parsed) ? parsed : [];
          for (const ex of exList) {
            if (ex && ex.periodId && !periodMap.has(ex.periodId)) {
              const minDate = ex.finishedAt || ex.date || Date.now() - 30 * 24 * 3600 * 1e3;
              const formattedDate = new Date(minDate).toLocaleDateString("sv-SE", { month: "short", year: "numeric" });
              ingestPeriod({
                id: ex.periodId,
                name: `Avslutad po\xE4ngliga (${formattedDate})`,
                startDate: minDate,
                endDate: ex.finishedAt || ex.date || minDate,
                isActive: false,
                standings: []
              });
            }
          }
        } catch (_) {
        }
      }
    } catch (_) {
    }
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
      currentPeriodId: activePeriodId || (periods.find((p) => p.isActive)?.id || (periods[0]?.id || null))
    };
  }
  app.get("/api/periods/all", (req, res) => {
    try {
      const result = getConsolidatedPeriods();
      res.json({ success: true, ...result });
    } catch (e) {
      console.error("Error fetching consolidated periods:", e);
      res.status(500).json({ error: "Failed to fetch consolidated periods" });
    }
  });
  app.get("/api/docs", async (req, res) => {
    const pathStr = req.query.path;
    if (!pathStr) return res.status(400).send("Path is required");
    if (pathStr.startsWith("shared_leaderboards/")) {
      const id = pathStr.split("/")[1];
      try {
        let row2 = db.prepare("SELECT data FROM shared_leaderboards WHERE id = ?").get(id);
        if (row2) {
          try {
            const parsed = typeof row2.data === "string" ? JSON.parse(row2.data) : row2.data;
            const leaderboardObj = parsed && parsed.data && (parsed.data.standings || parsed.data.name) ? parsed.data : parsed;
            return res.json(leaderboardObj);
          } catch (pErr) {
            console.warn("Failed to parse local SQLite shared_leaderboards data:", pErr);
          }
        }
        let fDoc = null;
        let quotaExceeded2 = false;
        try {
          fDoc = await getFirestoreDoc(`app_docs/shared_leaderboards_${id}`);
          if (!fDoc) {
            fDoc = await getFirestoreDoc(`shared_leaderboards/${id}`);
          }
          if (!fDoc) {
            await new Promise((r) => setTimeout(r, 600));
            fDoc = await getFirestoreDoc(`app_docs/shared_leaderboards_${id}`) || await getFirestoreDoc(`shared_leaderboards/${id}`);
          }
        } catch (fErr) {
          if (fErr.status === 429 || fErr.code === "RESOURCE_EXHAUSTED" || fErr.message && fErr.message.toLowerCase().includes("quota")) {
            quotaExceeded2 = true;
          }
        }
        if (fDoc) {
          let leaderboardObj = null;
          if (fDoc.data) {
            leaderboardObj = typeof fDoc.data === "string" ? JSON.parse(fDoc.data) : fDoc.data;
            if (leaderboardObj && leaderboardObj.data && (leaderboardObj.data.standings || leaderboardObj.data.name)) {
              leaderboardObj = leaderboardObj.data;
            }
          } else if (fDoc.standings || fDoc.name) {
            leaderboardObj = fDoc;
          }
          if (leaderboardObj) {
            const rawData = JSON.stringify(leaderboardObj);
            try {
              db.prepare("INSERT OR REPLACE INTO shared_leaderboards (id, data, updatedAt, coachUid) VALUES (?, ?, ?, ?)").run(
                id,
                rawData,
                Date.now(),
                fDoc.coachUid || leaderboardObj.coachUid || null
              );
            } catch (sqErr) {
              console.warn("Could not cache shared leaderboard to SQLite:", sqErr);
            }
            return res.json(leaderboardObj);
          }
        }
        if (quotaExceeded2) {
          return res.status(429).json({
            error: "Quota exceeded",
            message: "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'",
            status: "RESOURCE_EXHAUSTED",
            upgradeUrl: getFirestoreQuotaUpgradeUrl()
          });
        }
        return res.json(null);
      } catch (e) {
        if (e.status === 429 || e.code === "RESOURCE_EXHAUSTED") {
          return res.status(429).json({
            error: "Quota exceeded",
            message: "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'",
            status: "RESOURCE_EXHAUSTED",
            upgradeUrl: getFirestoreQuotaUpgradeUrl()
          });
        }
        console.error("Error fetching shared leaderboard:", e);
        res.status(500).json({ error: "Failed to fetch shared leaderboard" });
      }
    } else if (pathStr.startsWith("users/")) {
      const parts = pathStr.split("/");
      const userId = parts[1];
      const segment = parts[3];
      if (userId === "guest") {
        return res.json(null);
      }
      if (userId !== "guest") {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
        try {
          const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
          const partsAuth = authStr.split(" ");
          const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
          const decoded = verifyJwtToken(token);
          if (decoded.id !== userId && decoded.email !== userId) {
            return res.status(403).json({ error: "Forbidden" });
          }
        } catch (e) {
          console.error("Error verifying token for user data:", e);
          return res.status(401).json({ error: "Invalid session or token" });
        }
      }
      if (segment === "periods") {
        const consolidated = getConsolidatedPeriods(void 0, void 0, userId);
        try {
          db.prepare(`
            INSERT INTO users_data (userId, segment, data, updatedAt)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
          `).run(userId, segment, JSON.stringify(consolidated), Date.now());
        } catch (_) {
        }
        return res.json(consolidated);
      }
      const isForce2 = req.query.force === "true" || req.query.refresh === "true";
      let row2 = db.prepare("SELECT data, updatedAt FROM users_data WHERE userId = ? AND segment = ?").get(userId, segment);
      let quotaExceeded2 = false;
      if (row2 && !isForce2 && dbModeConfig.mode !== "firestore_only") {
        try {
          return res.json(typeof row2.data === "string" ? JSON.parse(row2.data) : row2.data);
        } catch (parseErr) {
          console.warn("Failed to parse cached SQLite user data, falling back to remote:", parseErr);
        }
      }
      if (dbModeConfig.mode === "firestore_only" || isForce2 || !row2) {
        let fDoc = null;
        try {
          fDoc = await getFirestoreDoc(`app_docs/users_${userId}_data_${segment}`);
        } catch (fErr) {
          if (fErr.status === 429 || fErr.code === "RESOURCE_EXHAUSTED" || fErr.message && fErr.message.toLowerCase().includes("quota")) {
            quotaExceeded2 = true;
          }
        }
        if (fDoc && fDoc.data) {
          const remoteUpdatedAt = Number(fDoc.updatedAt) || 0;
          const localUpdatedAt = Number(row2?.updatedAt) || 0;
          if (dbModeConfig.mode === "firestore_only" || isForce2 || !row2 || remoteUpdatedAt >= localUpdatedAt) {
            const rawData = typeof fDoc.data === "string" ? fDoc.data : JSON.stringify(fDoc.data);
            db.prepare(`
              INSERT INTO users_data (userId, segment, data, updatedAt)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
            `).run(userId, segment, rawData, remoteUpdatedAt || Date.now());
            return res.json(typeof fDoc.data === "string" ? JSON.parse(fDoc.data) : fDoc.data);
          }
        } else if (!row2) {
          if (quotaExceeded2) {
            return res.status(429).json({
              error: "Quota exceeded",
              message: "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'",
              status: "RESOURCE_EXHAUSTED",
              upgradeUrl: getFirestoreQuotaUpgradeUrl()
            });
          }
          return res.json(null);
        }
      }
      if (!row2) {
        if (quotaExceeded2) {
          return res.status(429).json({
            error: "Quota exceeded",
            message: "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'",
            status: "RESOURCE_EXHAUSTED",
            upgradeUrl: getFirestoreQuotaUpgradeUrl()
          });
        }
        return res.json(null);
      }
      res.json(JSON.parse(row2.data));
    } else if (pathStr.startsWith("clubs/") && pathStr.includes("/pending_requests")) {
      try {
        const parts = pathStr.split("/");
        const isCollection = parts.length === 3;
        if (isCollection) {
          const clubId = parts[1];
          const isValidRequest = (item) => {
            return item && typeof item === "object" && (item.uid || item.id) && (item.requestedRole || item.role) && (item.status === void 0 || item.status === "pending");
          };
          let rows = db.prepare("SELECT data FROM system_docs WHERE path = ? OR path LIKE ?").all(pathStr, `${pathStr}/%`);
          if (rows && rows.length > 0) {
            const list = [];
            for (const r of rows) {
              try {
                const parsed = JSON.parse(r.data);
                if (Array.isArray(parsed)) {
                  list.push(...parsed.filter(isValidRequest));
                } else if (isValidRequest(parsed)) {
                  list.push(parsed);
                }
              } catch (_) {
              }
            }
            if (list.length > 0) {
              return res.json(list);
            }
          }
          const globalRows = db.prepare("SELECT data FROM system_docs WHERE path = 'pending_user_requests' OR path LIKE 'pending_user_requests/%'").all();
          if (globalRows && globalRows.length > 0) {
            const matched = [];
            for (const r of globalRows) {
              try {
                const parsed = JSON.parse(r.data);
                if (Array.isArray(parsed)) {
                  matched.push(...parsed.filter((item) => isValidRequest(item) && (item.requestedClubId === clubId || item.clubId === clubId)));
                } else if (isValidRequest(parsed) && (parsed.requestedClubId === clubId || parsed.clubId === clubId)) {
                  matched.push(parsed);
                }
              } catch (_) {
              }
            }
            if (matched.length > 0) {
              return res.json(matched);
            }
          }
          return res.json([]);
        } else {
          let row2 = db.prepare("SELECT data FROM system_docs WHERE path = ?").get(pathStr);
          if (row2 && row2.data) {
            return res.json(JSON.parse(row2.data));
          }
          return res.json(null);
        }
      } catch (err) {
        console.error("Error handling club pending_requests:", err);
        return res.json([]);
      }
    } else if (pathStr.startsWith("clubs/")) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
      try {
        const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const partsAuth = authStr.split(" ");
        const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
        verifyJwtToken(token);
        const parts = pathStr.split("/");
        const clubId = parts[1];
        const teamId = parts[3] || "club_global";
        const segment = parts[5] || parts[3] || "data";
        if (segment === "periods") {
          const consolidated = getConsolidatedPeriods(clubId, teamId);
          try {
            db.prepare(`
              INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
            `).run(clubId, teamId, segment, JSON.stringify(consolidated), Date.now());
          } catch (_) {
          }
          return res.json(consolidated);
        }
        if (row && !isForce && dbModeConfig.mode !== "firestore_only") {
          try {
            let parsed2 = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
            if (segment === "periods" && parsed2 && Array.isArray(parsed2.periods)) {
              try {
                const decodedUser = verifyJwtToken(token);
                const userRow = db.prepare("SELECT data FROM users_data WHERE userId = ? AND segment = ?").get(decodedUser.id, "periods");
                if (userRow && userRow.data) {
                  const uParsed = typeof userRow.data === "string" ? JSON.parse(userRow.data) : userRow.data;
                  if (uParsed && Array.isArray(uParsed.periods)) {
                    const existingMap = /* @__PURE__ */ new Map();
                    parsed2.periods.forEach((p) => {
                      if (p && p.id) existingMap.set(p.id, p);
                    });
                    let merged = false;
                    uParsed.periods.forEach((up) => {
                      if (up && up.id && (!existingMap.has(up.id) || up.endDate && !existingMap.get(up.id)?.endDate)) {
                        parsed2.periods.push(up);
                        merged = true;
                      }
                    });
                    if (merged) {
                      db.prepare("UPDATE clubs_data SET data = ? WHERE clubId = ? AND teamId = ? AND segment = ?").run(JSON.stringify(parsed2), clubId, teamId, segment);
                    }
                  }
                }
              } catch (_) {
              }
            }
            return res.json(parsed2);
          } catch (parseErr) {
            console.warn("Failed to parse cached SQLite clubs data, falling back to remote:", parseErr);
          }
        }
        if (dbModeConfig.mode === "firestore_only" || isForce || !row) {
          let fDoc = null;
          try {
            fDoc = await getFirestoreDoc(`app_docs/clubs_${clubId}_${teamId}_${segment}`);
          } catch (fErr) {
            if (fErr.status === 429 || fErr.code === "RESOURCE_EXHAUSTED" || fErr.message && fErr.message.toLowerCase().includes("quota")) {
              quotaExceeded = true;
            }
          }
          if (fDoc && fDoc.data) {
            const remoteUpdatedAt = Number(fDoc.updatedAt) || 0;
            const localUpdatedAt = Number(row?.updatedAt) || 0;
            if (dbModeConfig.mode === "firestore_only" || isForce || !row || remoteUpdatedAt >= localUpdatedAt) {
              const rawData = typeof fDoc.data === "string" ? fDoc.data : JSON.stringify(fDoc.data);
              db.prepare(`
                INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
              `).run(clubId, teamId, segment, rawData, remoteUpdatedAt || Date.now());
              return res.json(typeof fDoc.data === "string" ? JSON.parse(fDoc.data) : fDoc.data);
            }
          } else if (!row) {
            if (quotaExceeded) {
              return res.status(429).json({
                error: "Quota exceeded",
                message: "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'",
                status: "RESOURCE_EXHAUSTED",
                upgradeUrl: getFirestoreQuotaUpgradeUrl()
              });
            }
            return res.json(null);
          }
        }
        if (!row) {
          if (quotaExceeded) {
            return res.status(429).json({
              error: "Quota exceeded",
              message: "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'",
              status: "RESOURCE_EXHAUSTED",
              upgradeUrl: getFirestoreQuotaUpgradeUrl()
            });
          }
          return res.json(null);
        }
        let parsed = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
        if (segment === "periods" && parsed && Array.isArray(parsed.periods)) {
          try {
            const decodedUser = verifyJwtToken(token);
            const userRow = db.prepare("SELECT data FROM users_data WHERE userId = ? AND segment = ?").get(decodedUser.id, "periods");
            if (userRow && userRow.data) {
              const uParsed = typeof userRow.data === "string" ? JSON.parse(userRow.data) : userRow.data;
              if (uParsed && Array.isArray(uParsed.periods)) {
                const existingMap = /* @__PURE__ */ new Map();
                parsed.periods.forEach((p) => {
                  if (p && p.id) existingMap.set(p.id, p);
                });
                let merged = false;
                uParsed.periods.forEach((up) => {
                  if (up && up.id && (!existingMap.has(up.id) || up.endDate && !existingMap.get(up.id)?.endDate)) {
                    parsed.periods.push(up);
                    merged = true;
                  }
                });
                if (merged) {
                  db.prepare("UPDATE clubs_data SET data = ? WHERE clubId = ? AND teamId = ? AND segment = ?").run(JSON.stringify(parsed), clubId, teamId, segment);
                }
              }
            }
          } catch (_) {
          }
        }
        res.json(parsed);
      } catch (e) {
        if (e.name === "JsonWebTokenError" || e.name === "TokenExpiredError" || e.message === "Invalid token" || e.message === "No token provided") {
          return res.status(401).json({ error: "Unauthorized", message: "Session expired, please log in again." });
        }
        if (e.status === 429 || e.code === "RESOURCE_EXHAUSTED") {
          return res.status(429).json({
            error: "Quota exceeded",
            message: "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'",
            status: "RESOURCE_EXHAUSTED",
            upgradeUrl: getFirestoreQuotaUpgradeUrl()
          });
        }
        console.error("Error fetching club data:", e);
        res.status(500).json({ error: "Failed to fetch club data", details: e?.message });
      }
    } else if (pathStr.startsWith("admins/")) {
      try {
        let row2 = db.prepare("SELECT data FROM system_docs WHERE path = ?").get(pathStr);
        let quotaExceeded2 = false;
        if (!row2) {
          let fDoc = null;
          try {
            fDoc = await getFirestoreDoc(`app_docs/admins_${encodeURIComponent(pathStr)}`);
          } catch (fErr) {
            if (fErr.status === 429 || fErr.code === "RESOURCE_EXHAUSTED") {
              quotaExceeded2 = true;
            }
          }
          if (fDoc && fDoc.data) {
            const rawData = typeof fDoc.data === "string" ? fDoc.data : JSON.stringify(fDoc.data);
            db.prepare("INSERT OR REPLACE INTO system_docs (path, data, updatedAt) VALUES (?, ?, ?)").run(pathStr, rawData, Date.now());
            return res.json(typeof fDoc.data === "string" ? JSON.parse(fDoc.data) : fDoc.data);
          }
          if (quotaExceeded2) {
            return res.status(429).json({
              error: "Quota exceeded",
              message: "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'",
              status: "RESOURCE_EXHAUSTED",
              upgradeUrl: getFirestoreQuotaUpgradeUrl()
            });
          }
          return res.json(null);
        }
        res.json(JSON.parse(row2.data));
      } catch (e) {
        if (e.status === 429 || e.code === "RESOURCE_EXHAUSTED") {
          return res.status(429).json({
            error: "Quota exceeded",
            message: "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'",
            status: "RESOURCE_EXHAUSTED",
            upgradeUrl: getFirestoreQuotaUpgradeUrl()
          });
        }
        console.error("Error fetching admin doc:", e);
        res.status(500).json({ error: "Failed to fetch admin doc" });
      }
    } else if (pathStr === "pending_user_requests" || pathStr.startsWith("pending_user_requests/")) {
      try {
        const isValidRequest = (item) => {
          return item && typeof item === "object" && (item.uid || item.id) && (item.requestedRole || item.role) && (item.status === void 0 || item.status === "pending");
        };
        let row2 = db.prepare("SELECT data FROM system_docs WHERE path = ?").get(pathStr);
        if (row2 && row2.data) {
          const parsed = typeof row2.data === "string" ? JSON.parse(row2.data) : row2.data;
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
      try {
        let row2 = db.prepare("SELECT data FROM system_docs WHERE path = ?").get(pathStr);
        if (row2 && row2.data) {
          return res.json(typeof row2.data === "string" ? JSON.parse(row2.data) : row2.data);
        }
        return res.json(null);
      } catch (_) {
        return res.json(null);
      }
    }
  });
  app.post("/api/docs", async (req, res) => {
    const pathStr = req.query.path;
    const { data } = req.body;
    if (!pathStr) return res.status(400).send("Path is required");
    if (pathStr.startsWith("shared_leaderboards/")) {
      const id = pathStr.split("/")[1];
      try {
        const cleanObj = data && data.data && (data.data.standings || data.data.name) ? data.data : data;
        const serializedData = typeof cleanObj === "string" ? cleanObj : JSON.stringify(cleanObj);
        const coachUid = cleanObj?.coachUid || data?.coachUid || null;
        db.prepare(`
          INSERT INTO shared_leaderboards (id, data, updatedAt, coachUid)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt, coachUid = excluded.coachUid
        `).run(id, serializedData, Date.now(), coachUid);
        Promise.all([
          setFirestoreDoc(`app_docs/shared_leaderboards_${id}`, { data: serializedData, coachUid, updatedAt: Date.now() }),
          setFirestoreDoc(`shared_leaderboards/${id}`, typeof cleanObj === "object" ? cleanObj : JSON.parse(serializedData))
        ]).catch((e) => console.error("Firestore shared leaderboard sync error:", e));
        res.json({ success: true });
      } catch (e) {
        console.error("Error saving shared leaderboard:", e);
        res.status(500).json({ error: "Failed to save shared leaderboard" });
      }
    } else if (pathStr.startsWith("users/")) {
      try {
        const parts = pathStr.split("/");
        const userId = parts[1];
        const segment = parts[3];
        if (userId === "guest") {
          return res.status(403).json({ error: "Guest offline mode cannot save to server database" });
        }
        if (userId !== "guest") {
          const authHeader = req.headers.authorization;
          if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
          try {
            const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
            const partsAuth = authStr.split(" ");
            const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
            const decoded = verifyJwtToken(token);
            if (decoded.id !== userId && decoded.email !== userId) {
              return res.status(403).json({ error: "Forbidden" });
            }
          } catch (e) {
            console.error("Error verifying token for saving user data:", e);
            return res.status(401).json({ error: "Invalid session or token" });
          }
        }
        let finalDataToSave = data;
        if (segment === "periods") {
          const consolidated = getConsolidatedPeriods(void 0, void 0, userId);
          const map = /* @__PURE__ */ new Map();
          (consolidated.periods || []).forEach((p) => {
            if (p && p.id) map.set(p.id, p);
          });
          const incomingList = Array.isArray(data?.periods) ? data.periods : Array.isArray(data) ? data : [];
          incomingList.forEach((p) => {
            if (!p || !p.id) return;
            const existing = map.get(p.id);
            if (!existing) {
              map.set(p.id, p);
            } else {
              const isClosed = Boolean(existing.endDate || p.endDate);
              const endDate = p.endDate || existing.endDate;
              const standings = Array.isArray(p.standings) && p.standings.length > 0 ? p.standings : existing.standings;
              const bonusPoints = Array.isArray(p.bonusPoints) && p.bonusPoints.length > 0 ? p.bonusPoints : existing.bonusPoints;
              map.set(p.id, {
                ...existing,
                ...p,
                endDate: isClosed ? endDate : void 0,
                standings,
                bonusPoints
              });
            }
          });
          const allPeriods = Array.from(map.values());
          finalDataToSave = {
            ...typeof data === "object" ? data : {},
            periods: allPeriods,
            currentPeriodId: data?.currentPeriodId || consolidated.currentPeriodId || allPeriods.find((p) => p.isActive)?.id || (allPeriods[0]?.id || null)
          };
        }
        const serializedData = JSON.stringify(finalDataToSave);
        const updateTimestamp = Number(data?.updatedAt) || Date.now();
        db.prepare(`
          INSERT INTO users_data (userId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(userId, segment, serializedData, updateTimestamp);
        setFirestoreDoc(`app_docs/users_${userId}_data_${segment}`, { data: serializedData, updatedAt: updateTimestamp }).catch((e) => console.error("Firestore user data sync error:", e));
        res.json({ success: true, updatedAt: updateTimestamp });
      } catch (e) {
        console.error("Error saving user data:", e);
        res.status(500).json({ error: "Failed to save user data" });
      }
    } else if (pathStr.startsWith("clubs/") && pathStr.includes("/pending_requests")) {
      try {
        const serializedData = typeof data === "string" ? data : JSON.stringify(data);
        db.prepare(`
          INSERT INTO system_docs (path, data, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(pathStr, serializedData, Date.now());
        setFirestoreDoc(`app_docs/${encodeURIComponent(pathStr)}`, { data: serializedData, updatedAt: Date.now() }).catch((e) => console.error("Firestore club pending request sync error:", e));
        return res.json({ success: true });
      } catch (e) {
        console.error("Error saving club pending request:", e);
        return res.status(500).json({ error: "Failed to save pending request" });
      }
    } else if (pathStr.startsWith("clubs/")) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
      try {
        const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const partsAuth = authStr.split(" ");
        const token = partsAuth.length > 1 ? partsAuth[1] : partsAuth[0];
        verifyJwtToken(token);
        const parts = pathStr.split("/");
        const clubId = parts[1];
        const teamId = parts[3] || "club_global";
        const segment = parts[5] || parts[3] || "data";
        let finalDataToSave = data;
        if (segment === "periods") {
          const consolidated = getConsolidatedPeriods(clubId, teamId);
          const map = /* @__PURE__ */ new Map();
          (consolidated.periods || []).forEach((p) => {
            if (p && p.id) map.set(p.id, p);
          });
          const incomingList = Array.isArray(data?.periods) ? data.periods : Array.isArray(data) ? data : [];
          incomingList.forEach((p) => {
            if (!p || !p.id) return;
            const existing = map.get(p.id);
            if (!existing) {
              map.set(p.id, p);
            } else {
              const isClosed = Boolean(existing.endDate || p.endDate);
              const endDate = p.endDate || existing.endDate;
              const standings = Array.isArray(p.standings) && p.standings.length > 0 ? p.standings : existing.standings;
              const bonusPoints = Array.isArray(p.bonusPoints) && p.bonusPoints.length > 0 ? p.bonusPoints : existing.bonusPoints;
              map.set(p.id, {
                ...existing,
                ...p,
                endDate: isClosed ? endDate : void 0,
                standings,
                bonusPoints
              });
            }
          });
          const allPeriods = Array.from(map.values());
          finalDataToSave = {
            ...typeof data === "object" ? data : {},
            periods: allPeriods,
            currentPeriodId: data?.currentPeriodId || consolidated.currentPeriodId || allPeriods.find((p) => p.isActive)?.id || (allPeriods[0]?.id || null)
          };
        }
        const serializedData = JSON.stringify(finalDataToSave);
        const updateTimestamp = Number(data?.updatedAt) || Date.now();
        db.prepare(`
          INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(clubId, teamId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(clubId, teamId, segment, serializedData, updateTimestamp);
        setFirestoreDoc(`app_docs/clubs_${clubId}_${teamId}_${segment}`, { data: serializedData, updatedAt: updateTimestamp }).catch((e) => console.error("Firestore club data sync error:", e));
        res.json({ success: true, updatedAt: updateTimestamp });
      } catch (e) {
        if (e.name === "JsonWebTokenError" || e.name === "TokenExpiredError" || e.message === "Invalid token" || e.message === "No token provided") {
          return res.status(401).json({ error: "Unauthorized", message: "Session expired, please log in again." });
        }
        console.error("Error saving club data:", e);
        res.status(500).json({ error: "Failed to save club data" });
      }
    } else if (pathStr.startsWith("admins/")) {
      const user = extractAuthUser(req);
      const isRoot = await verifyIsRootAdmin(user);
      if (!isRoot) {
        return res.status(403).json({ error: "Unauthorized: Only root admin can modify admin documents" });
      }
      try {
        const serializedData = JSON.stringify(data);
        db.prepare(`
          INSERT INTO system_docs (path, data, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(pathStr, serializedData, Date.now());
        setFirestoreDoc(`app_docs/admins_${encodeURIComponent(pathStr)}`, { data: serializedData, updatedAt: Date.now() }).catch((e) => console.error("Firestore admin doc sync error:", e));
        res.json({ success: true });
      } catch (e) {
        console.error("Error saving admin doc:", e);
        res.status(500).json({ error: "Failed to save admin doc" });
      }
    } else {
      try {
        const serializedData = typeof data === "string" ? data : JSON.stringify(data);
        db.prepare(`
          INSERT INTO system_docs (path, data, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `).run(pathStr, serializedData, Date.now());
        setFirestoreDoc(`app_docs/${encodeURIComponent(pathStr)}`, { data: serializedData, updatedAt: Date.now() }).catch((e) => console.error("Firestore doc sync error:", e));
        res.json({ success: true });
      } catch (e) {
        console.error("Error saving doc:", e);
        res.status(500).json({ error: "Failed to save doc" });
      }
    }
  });
  app.delete("/api/docs", async (req, res) => {
    const pathStr = req.query.path;
    if (!pathStr) return res.status(400).send("Path is required");
    try {
      db.prepare("DELETE FROM system_docs WHERE path = ?").run(pathStr);
      res.json({ success: true });
    } catch (e) {
      console.error("Error deleting doc:", e);
      res.status(500).json({ error: "Failed to delete doc" });
    }
  });
  const upload = (0, import_multer.default)({
    storage: import_multer.default.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }
    // 15MB file size limit
  });
  app.post("/api/upload", upload.any(), async (req, res) => {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Ingen fil skickades med" });
    }
    const uploadedFile = files[0];
    let ext = (import_path.default.extname(uploadedFile.originalname || "") || ".jpg").toLowerCase();
    let mimeType = uploadedFile.mimetype || "image/jpeg";
    let fileBuffer = uploadedFile.buffer;
    if (fileBuffer && sharpModule && (fileBuffer.length > 500 * 1024 || ext === ".heic" || ext === ".heif" || mimeType.includes("heic") || mimeType.includes("heif"))) {
      try {
        const compressed = await sharpModule(fileBuffer).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
        if (compressed && compressed.length > 0) {
          fileBuffer = compressed;
          mimeType = "image/jpeg";
          ext = ".jpg";
        }
      } catch (sharpErr) {
        console.warn("[Upload] Server image optimization note:", sharpErr?.message || sharpErr);
      }
    }
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const filename = "photo_" + uniqueSuffix + ext;
    const fileUrl = `/uploads/${filename}`;
    try {
      if (fileBuffer) {
        const base64Data = fileBuffer.toString("base64");
        try {
          db.prepare(`
            INSERT OR REPLACE INTO uploaded_files (filename, mime_type, data_base64, created_at)
            VALUES (?, ?, ?, ?)
          `).run(filename, mimeType, base64Data, Date.now());
        } catch (dbErr) {
          console.error("[Upload] Error saving file to database table:", dbErr);
        }
        try {
          if (!import_fs.default.existsSync(UPLOADS_DIR)) {
            import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
          }
          import_fs.default.writeFileSync(import_path.default.join(UPLOADS_DIR, filename), fileBuffer);
        } catch (diskErr) {
          console.warn("[Upload] Note: could not write file to disk (saved in DB):", diskErr);
        }
        try {
          const publicUploads = import_path.default.join(DATA_DIR, "public", "uploads");
          if (import_fs.default.existsSync(import_path.default.join(DATA_DIR, "public"))) {
            if (!import_fs.default.existsSync(publicUploads)) import_fs.default.mkdirSync(publicUploads, { recursive: true });
            import_fs.default.writeFileSync(import_path.default.join(publicUploads, filename), fileBuffer);
          }
        } catch (_) {
        }
        if (dbModeConfig.mode !== "local_sqlite") {
          if (base64Data.length <= 950 * 1024) {
            try {
              setFirestoreDoc(`server_uploads/${encodeURIComponent(filename)}`, {
                mime_type: mimeType,
                data_base64: base64Data,
                created_at: Date.now()
              }).catch((fErr) => console.warn("[Upload] Firestore sync error:", fErr));
            } catch (_) {
            }
          } else {
            console.warn(`[Upload] File ${filename} exceeds Firestore single-doc limit (${base64Data.length} chars). Saved in SQLite and disk.`);
          }
        }
      }
    } catch (err) {
      console.error("Failed to process uploaded file:", err);
    }
    res.json({ url: fileUrl });
  });
  app.get("/uploads/:filename", async (req, res) => {
    const filename = import_path.default.basename(req.params.filename);
    const fullPath = import_path.default.join(UPLOADS_DIR, filename);
    const publicPath = import_path.default.join(DATA_DIR, "public", "uploads", filename);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (import_fs.default.existsSync(fullPath)) {
      return res.sendFile(fullPath, { maxAge: "1y", immutable: true });
    }
    if (import_fs.default.existsSync(publicPath)) {
      return res.sendFile(publicPath, { maxAge: "1y", immutable: true });
    }
    try {
      const row2 = db.prepare("SELECT mime_type, data_base64 FROM uploaded_files WHERE filename = ?").get(filename);
      if (row2 && row2.data_base64) {
        const buffer = Buffer.from(row2.data_base64, "base64");
        try {
          if (!import_fs.default.existsSync(UPLOADS_DIR)) import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
          import_fs.default.writeFile(fullPath, buffer, () => {
          });
        } catch (_) {
        }
        res.setHeader("Content-Type", row2.mime_type || "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return res.send(buffer);
      }
      if (dbModeConfig.mode !== "local_sqlite") {
        const doc = await getFirestoreDoc(`server_uploads/${encodeURIComponent(filename)}`);
        if (doc && doc.data_base64) {
          const mimeType = doc.mime_type || "image/jpeg";
          const buffer = Buffer.from(doc.data_base64, "base64");
          try {
            db.prepare(`
              INSERT OR REPLACE INTO uploaded_files (filename, mime_type, data_base64, created_at)
              VALUES (?, ?, ?, ?)
            `).run(filename, mimeType, doc.data_base64, Date.now());
            if (!import_fs.default.existsSync(UPLOADS_DIR)) import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
            import_fs.default.writeFile(fullPath, buffer, () => {
            });
          } catch (restoreErr) {
            console.warn("[Upload Restore] Error restoring to SQLite/Disk:", restoreErr);
          }
          res.setHeader("Content-Type", mimeType);
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          return res.send(buffer);
        }
      }
    } catch (err) {
      console.error(`[Upload Fetch] Error retrieving /uploads/${filename}:`, err);
    }
    res.status(404).send("File not found");
  });
  app.delete("/api/delete-file", async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send("Path is required");
    try {
      const cleanPath = decodeURIComponent(filePath).split("?")[0];
      const filename = import_path.default.basename(cleanPath);
      const fullPath = import_path.default.join(UPLOADS_DIR, filename);
      const publicPath = import_path.default.join(DATA_DIR, "public", "uploads", filename);
      if (import_fs.default.existsSync(fullPath)) {
        try {
          import_fs.default.unlinkSync(fullPath);
        } catch (unlinkErr) {
          console.warn("[Delete File] Could not unlink from UPLOADS_DIR:", unlinkErr);
        }
      }
      if (import_fs.default.existsSync(publicPath)) {
        try {
          import_fs.default.unlinkSync(publicPath);
        } catch (_) {
        }
      }
      try {
        db.prepare("DELETE FROM uploaded_files WHERE filename = ?").run(filename);
      } catch (dbErr) {
        console.warn("[Delete File] Could not delete from DB uploaded_files:", dbErr);
      }
      if (dbModeConfig.mode !== "local_sqlite") {
        try {
          await deleteFirestoreDoc(`server_uploads/${encodeURIComponent(filename)}`);
        } catch (fErr) {
          console.warn("[Delete File] Could not delete from Firestore server_uploads:", fErr);
        }
        try {
          await deleteFirestoreDoc(`storage_files/${encodeURIComponent(filename)}`);
        } catch (_) {
        }
      }
      console.log(`[Delete File] Successfully deleted ${filename} from disk, SQLite and Firestore`);
      res.json({ success: true, deleted: filename });
    } catch (e) {
      console.error("Error deleting file:", e);
      res.status(500).json({ error: "Failed to delete file" });
    }
  });
  app.post("/api/pwa-icons", import_express.default.json({ limit: "25mb" }), async (req, res) => {
    try {
      const { appName, themeColor, icons, logoSrc } = req.body;
      let filesMap = customPwaIcons?.files || {};
      if (Array.isArray(icons) && icons.length > 0) {
        filesMap = { ...filesMap };
        for (const item of icons) {
          if (item.fileName && item.dataUrl) {
            filesMap[item.fileName] = item.dataUrl;
            if (item.fileName === "icon-192x192.png") {
              filesMap["icon-192.png"] = item.dataUrl;
            }
            if (item.fileName === "icon-512x512.png") {
              filesMap["icon-512.png"] = item.dataUrl;
            }
            if (item.fileName === "apple-touch-icon.png") {
              filesMap["apple-touch-icon-precomposed.png"] = item.dataUrl;
            }
            if (item.fileName === "favicon-48x48.png" || item.fileName === "favicon-32x32.png") {
              filesMap["favicon.png"] = item.dataUrl;
            }
          }
        }
      }
      const now = Date.now();
      customPwaIcons = {
        appName: (appName || "KSK-appen").trim(),
        themeColor: themeColor || "#4f46e5",
        updatedAt: now,
        files: filesMap,
        logoSrc: typeof logoSrc === "string" && logoSrc.length < 5e5 ? logoSrc : void 0
      };
      applyCustomPwaIconsToDisk(customPwaIcons);
      savePwaIconsToDatabase(customPwaIcons);
      res.json({
        success: true,
        message: "Appens PWA-ikoner har uppdaterats och sparats i databasen!",
        updatedAt: now
      });
    } catch (err) {
      console.error("[PWA Icons] Error saving custom PWA icons:", err);
      res.status(500).json({ error: "Kunde inte spara PWA-ikonerna: " + err.message });
    }
  });
  app.get("/api/pwa-icons", (_req, res) => {
    if (customPwaIcons) {
      res.json({
        appName: customPwaIcons.appName,
        themeColor: customPwaIcons.themeColor,
        hasCustomIcons: true,
        updatedAt: customPwaIcons.updatedAt,
        previewUrl: customPwaIcons.files["icon-512x512.png"] || customPwaIcons.files["icon-192x192.png"] || null,
        logoSrc: customPwaIcons.logoSrc || null
      });
    } else {
      res.json({ hasCustomIcons: false });
    }
  });
  app.get("/api/proxy", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).send("URL query parameter is required");
    }
    const validation = await validateSafeExternalUrl(url);
    if (!validation.valid || !validation.urlObj) {
      console.warn(`[Proxy SSRF Blocked] URL: ${url} - Reason: ${validation.error}`);
      return res.status(403).send(`\xC5tkomst nekad: ${validation.error}`);
    }
    try {
      console.log(`[Proxy] Fetching verified image from: ${url}`);
      const response = await (0, import_axios.default)({
        method: "get",
        url: validation.urlObj.toString(),
        responseType: "stream",
        timeout: 1e4,
        maxContentLength: 15 * 1024 * 1024,
        maxRedirects: 5,
        httpAgent: safeHttpAgent,
        httpsAgent: safeHttpsAgent,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "image/*,*/*"
        }
      });
      const contentType = String(response.headers["content-type"] || "image/jpeg");
      if (!contentType.startsWith("image/") && !contentType.startsWith("application/octet-stream")) {
        return res.status(400).send("Endast bildresurser kan h\xE4mtas via denna bildproxy.");
      }
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400");
      response.data.pipe(res);
    } catch (error) {
      console.error(`[Proxy] Error fetching ${url}:`, error.message);
      res.status(500).send(`Failed to fetch image: ${error.message}`);
    }
  });
  app.get("/api/fetch-calendar", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL query parameter is required" });
    }
    let fetchUrl = url.trim().replace(/^[!#\s"']+|["'\s]+$/g, "");
    if (fetchUrl.startsWith("webcal://")) {
      fetchUrl = "https://" + fetchUrl.slice(9);
    } else if (!fetchUrl.startsWith("http://") && !fetchUrl.startsWith("https://")) {
      fetchUrl = "https://" + fetchUrl;
    }
    const validation = await validateSafeExternalUrl(fetchUrl);
    if (!validation.valid || !validation.urlObj) {
      console.warn(`[Calendar Proxy SSRF Blocked] URL: ${fetchUrl} - Reason: ${validation.error}`);
      return res.status(403).json({ error: `\xC5tkomst nekad: ${validation.error}` });
    }
    const doFetch = async (targetUrl) => {
      const parsedUrl = new URL(targetUrl);
      parsedUrl.searchParams.set("_nocache", Date.now().toString());
      return await (0, import_axios.default)({
        method: "get",
        url: parsedUrl.toString(),
        timeout: 15e3,
        maxContentLength: 5 * 1024 * 1024,
        responseType: "text",
        maxRedirects: 5,
        httpAgent: safeHttpAgent,
        httpsAgent: safeHttpsAgent,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/calendar, text/plain, */*",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache"
        }
      });
    };
    try {
      console.log(`[Calendar Proxy] Fetching verified calendar from: ${fetchUrl}`);
      let response;
      try {
        response = await doFetch(fetchUrl);
      } catch (firstErr) {
        if (url.trim().startsWith("webcal://") && fetchUrl.startsWith("https://")) {
          const httpUrl = "http://" + fetchUrl.slice(8);
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
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
      res.send(response.data);
    } catch (error) {
      console.error(`[Calendar Proxy] Error fetching ${fetchUrl}:`, error.message);
      res.status(500).json({ error: `Failed to fetch calendar: ${error.message}` });
    }
  });
  const handleIcsFeed = async (req, res) => {
    try {
      let clubId = (req.params.clubId || req.query.clubId || "").toString().trim();
      let teamId = (req.params.teamId || req.query.teamId || "").toString().trim();
      if (!clubId) {
        clubId = "club_xckk55vw2";
        teamId = teamId || "team_h4nibr38i";
      }
      if (!teamId) {
        teamId = "club_global";
      }
      let sessionsData = [];
      let clubName = "Kungsg\xE5rdens SK";
      let teamName = "A-laget";
      try {
        let metaRow = db.prepare("SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = ?").get(clubId, "club_global", "metadata");
        let meta = null;
        if (metaRow) {
          meta = typeof metaRow.data === "string" ? JSON.parse(metaRow.data) : metaRow.data;
        } else {
          const fMeta = await getFirestoreDoc(`app_docs/clubs_${clubId}_club_global_metadata`);
          if (fMeta && fMeta.data) {
            meta = typeof fMeta.data === "string" ? JSON.parse(fMeta.data) : fMeta.data;
          }
        }
        if (meta) {
          if (meta.clubName || meta.name) clubName = meta.clubName || meta.name;
          if (meta.teams && Array.isArray(meta.teams)) {
            const t = meta.teams.find((tm) => tm.id === teamId);
            if (t && t.name) teamName = t.name;
          }
        }
      } catch (e) {
      }
      let row2 = db.prepare("SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = ?").get(clubId, teamId, "sessions");
      if (row2) {
        sessionsData = typeof row2.data === "string" ? JSON.parse(row2.data) : row2.data;
      } else {
        const fDoc = await getFirestoreDoc(`app_docs/clubs_${clubId}_${teamId}_sessions`);
        if (fDoc && fDoc.data) {
          sessionsData = typeof fDoc.data === "string" ? JSON.parse(fDoc.data) : fDoc.data;
        }
      }
      if (sessionsData && !Array.isArray(sessionsData) && Array.isArray(sessionsData.sessions)) {
        sessionsData = sessionsData.sessions;
      } else if (!Array.isArray(sessionsData)) {
        sessionsData = [];
      }
      const validSessions = sessionsData.filter((s) => s && s.title && !s.isIgnored);
      const escapeIcal = (str) => {
        if (!str) return "";
        return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n").replace(/\r/g, "");
      };
      const formatIcsLocalTime = (timestampMs, timeStr) => {
        const d = new Date(timestampMs);
        let hh = 18;
        let mm = 0;
        if (timeStr && typeof timeStr === "string" && timeStr.includes(":")) {
          const [parsedH, parsedM] = timeStr.split(":").map(Number);
          if (!isNaN(parsedH)) hh = parsedH;
          if (!isNaN(parsedM)) mm = parsedM;
        }
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const hours = String(hh).padStart(2, "0");
        const mins = String(mm).padStart(2, "0");
        return `${year}${month}${day}T${hours}${mins}00`;
      };
      const formatIcsUtcTime = (timestampMs) => {
        const d = new Date(timestampMs);
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, "0");
        const day = String(d.getUTCDate()).padStart(2, "0");
        const hours = String(d.getUTCHours()).padStart(2, "0");
        const mins = String(d.getUTCMinutes()).padStart(2, "0");
        const secs = String(d.getUTCSeconds()).padStart(2, "0");
        return `${year}${month}${day}T${hours}${mins}${secs}Z`;
      };
      const calculateEndStr = (startStr, minutes) => {
        const [h, m] = (startStr || "18:00").split(":").map(Number);
        const total = (isNaN(h) ? 18 : h) * 60 + (isNaN(m) ? 0 : m) + minutes;
        const endH = Math.floor(total / 60) % 24;
        const endM = total % 60;
        return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
      };
      const calendarName = `${clubName} - ${teamName}`;
      let icsLines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CoachAssist//NONSGML Team Calendar//SE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        `X-WR-CALNAME:${escapeIcal(calendarName)}`,
        "X-WR-TIMEZONE:Europe/Stockholm",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Stockholm",
        "X-LIC-LOCATION:Europe/Stockholm",
        "BEGIN:DAYLIGHT",
        "TZOFFSETFROM:+0100",
        "TZOFFSETTO:+0200",
        "TZNAME:CEST",
        "DTSTART:19700329T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:+0200",
        "TZOFFSETTO:+0100",
        "TZNAME:CET",
        "DTSTART:19701025T030000",
        "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
        "END:STANDARD",
        "END:VTIMEZONE"
      ];
      for (const s of validSessions) {
        const dtStart = formatIcsLocalTime(s.date, s.startTime || "18:00");
        const dtEnd = s.endTime ? formatIcsLocalTime(s.date, s.endTime) : formatIcsLocalTime(s.date, calculateEndStr(s.startTime || "18:00", 90));
        const uid = `session-${s.id || Math.random().toString(36).substring(7)}-${clubId}-${teamId}@coachassist`;
        const dtStamp = formatIcsUtcTime(s.updatedAt || s.createdAt || Date.now());
        icsLines.push("BEGIN:VEVENT");
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
          descParts.push("Moment: " + s.moments.map((m) => m.name || m.title).filter(Boolean).join(", "));
        }
        if (descParts.length > 0) {
          icsLines.push(`DESCRIPTION:${escapeIcal(descParts.join("\n"))}`);
        }
        icsLines.push("END:VEVENT");
      }
      icsLines.push("END:VCALENDAR");
      const icsString = icsLines.join("\r\n");
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="${clubId}-${teamId}-events.ics"`);
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.status(200).send(icsString);
    } catch (error) {
      console.error("[Calendar ICS Feed] Error generating feed:", error);
      res.status(500).send("Error generating calendar feed");
    }
  };
  app.get("/api/calendar/events.ics", handleIcsFeed);
  app.get("/api/calendar/:clubId/:teamId/events.ics", handleIcsFeed);
  app.get("/api/calendar/:clubId/events.ics", handleIcsFeed);
  app.get("/api/download-production-bundle", requireRootAdmin, (_req, res) => {
    const zipPath = import_path.default.resolve(process.cwd(), "coachassist-production-bundle.zip");
    if (import_fs.default.existsSync(zipPath)) {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="coachassist-production-bundle.zip"');
      return import_fs.default.createReadStream(zipPath).pipe(res);
    }
    return res.status(404).send("Bundle not found");
  });
  app.get("/api/download-server-cjs", requireRootAdmin, (_req, res) => {
    const serverPath = import_path.default.resolve(process.cwd(), "dist", "server.cjs");
    if (import_fs.default.existsSync(serverPath)) {
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Content-Disposition", 'attachment; filename="server.cjs"');
      return import_fs.default.createReadStream(serverPath).pipe(res);
    }
    return res.status(404).send("server.cjs not found");
  });
  function dbGetSystemDoc(docPath) {
    try {
      const row2 = db.prepare("SELECT data, updatedAt FROM system_docs WHERE path = ?").get(docPath);
      return row2 || null;
    } catch {
      return null;
    }
  }
  function dbSetSystemDoc(docPath, data) {
    try {
      const serialized = typeof data === "string" ? data : JSON.stringify(data);
      const now = Date.now();
      db.prepare(`
        INSERT INTO system_docs (path, data, updatedAt)
        VALUES (?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
      `).run(docPath, serialized, now);
    } catch (e) {
      console.warn(`[SystemDoc] Could not save ${docPath}:`, e);
    }
  }
  app.get("/api/deploy-ssh-config", requireRootAdmin, (_req, res) => {
    try {
      const row2 = dbGetSystemDoc("system/ssh_deploy_config");
      if (row2 && row2.data) {
        const parsed = JSON.parse(row2.data);
        return res.json({
          host: parsed.host || "coachassist.setterholm.se",
          port: parsed.port || 22,
          username: parsed.username || "setterho",
          remotePath: parsed.remotePath || "/home/setterho/coachassist.setterholm.se",
          hasSavedPassword: !!parsed.password,
          hasSavedKey: !!parsed.privateKey,
          authType: parsed.authType || (parsed.privateKey ? "key" : "password")
        });
      }
      return res.json({
        host: "coachassist.setterholm.se",
        port: 22,
        username: "setterho",
        remotePath: "/home/setterho/coachassist.setterholm.se",
        hasSavedPassword: false,
        hasSavedKey: false,
        authType: "password"
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });
  app.post("/api/deploy-to-ssh", requireRootAdmin, async (req, res) => {
    const {
      host = "coachassist.setterholm.se",
      port = 22,
      username = "setterho",
      password,
      privateKey,
      authType = "password",
      remotePath = "/home/setterho/coachassist.setterholm.se",
      action = "full_deploy",
      // 'full_deploy' | 'restart_only'
      saveConfig = true
    } = req.body;
    let finalPassword = password;
    let finalKey = privateKey;
    if (!finalPassword && !finalKey) {
      try {
        const row2 = dbGetSystemDoc("system/ssh_deploy_config");
        if (row2 && row2.data) {
          const parsed = JSON.parse(row2.data);
          finalPassword = parsed.password;
          finalKey = parsed.privateKey;
        }
      } catch (_) {
      }
    }
    if (!finalPassword && !finalKey) {
      return res.status(400).json({ success: false, error: "Inget SSH-l\xF6senord eller SSH-nyckel angiven." });
    }
    if (saveConfig) {
      try {
        dbSetSystemDoc("system/ssh_deploy_config", {
          host,
          port: Number(port),
          username,
          password: finalPassword || "",
          privateKey: finalKey || "",
          authType,
          remotePath,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        console.warn("Could not save SSH config:", e);
      }
    }
    let SshClient;
    try {
      SshClient = require("ssh2").Client;
    } catch (e) {
      return res.status(500).json({ success: false, error: "ssh2 modulen \xE4r inte tillg\xE4nglig: " + e.message });
    }
    const logs = [];
    const log = (msg) => {
      console.log("[SSH Deploy]", msg);
      logs.push(msg);
    };
    const conn = new SshClient();
    conn.on("ready", () => {
      log(`Ansluten via SSH till ${username}@${host}:${port}`);
      if (action === "restart_only") {
        log("K\xF6r omstartskommando (touch tmp/restart.txt)...");
        const cmd = `mkdir -p "${remotePath}/tmp" && touch "${remotePath}/tmp/restart.txt"`;
        conn.exec(cmd, (execErr, stream) => {
          if (execErr) {
            conn.end();
            return res.status(500).json({ success: false, error: execErr.message, logs });
          }
          stream.on("close", (code) => {
            conn.end();
            if (code === 0) {
              log("\u2705 Omstartstrigger skickad! Appen startar om p\xE5 servern.");
              return res.json({ success: true, message: "Servern startades om framg\xE5ngsrikt!", logs });
            } else {
              return res.status(500).json({ success: false, error: `Kommandot avslutades med kod ${code}`, logs });
            }
          });
        });
        return;
      }
      const zipPath = import_path.default.resolve(process.cwd(), "coachassist-production-bundle.zip");
      if (!import_fs.default.existsSync(zipPath)) {
        conn.end();
        return res.status(500).json({ success: false, error: "coachassist-production-bundle.zip hittades inte i AI Studio", logs });
      }
      log("Initierar SFTP f\xF6r fil\xF6verf\xF6ring...");
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return res.status(500).json({ success: false, error: "SFTP fel: " + err.message, logs });
        }
        const remoteZip = import_path.default.posix.join(remotePath, "coachassist-update.zip");
        log(`Laddar upp produktionspaketet (${(import_fs.default.statSync(zipPath).size / (1024 * 1024)).toFixed(2)} MB)...`);
        sftp.fastPut(zipPath, remoteZip, (uploadErr) => {
          if (uploadErr) {
            conn.end();
            return res.status(500).json({ success: false, error: "\xD6verf\xF6ringsfel: " + uploadErr.message, logs });
          }
          log("\xD6verf\xF6ring slutf\xF6rd! Packar upp filer p\xE5 servern...");
          const cmd = `unzip -qo "${remoteZip}" -d "${remotePath}" && rm -f "${remoteZip}" && mkdir -p "${remotePath}/tmp" && touch "${remotePath}/tmp/restart.txt"`;
          conn.exec(cmd, (execErr, stream) => {
            if (execErr) {
              conn.end();
              return res.status(500).json({ success: false, error: "K\xF6rningsfel: " + execErr.message, logs });
            }
            stream.on("close", (code) => {
              conn.end();
              if (code === 0) {
                log("\u2705 [DEPLOY SUCCESSFUL] Alla filer uppackade och servern startades om!");
                return res.json({
                  success: true,
                  message: "Deploy slutf\xF6rd! Applikationen \xE4r uppdaterad och omstartad p\xE5 webbhotellet.",
                  logs
                });
              } else {
                return res.status(500).json({ success: false, error: `Unzip/restart avslutades med kod ${code}`, logs });
              }
            }).on("data", (data) => {
              log(data.toString().trim());
            }).stderr.on("data", (data) => {
              log("[stderr] " + data.toString().trim());
            });
          });
        });
      });
    }).on("error", (err) => {
      console.error("[SSH Deploy Error]", err);
      return res.status(500).json({ success: false, error: "SSH-anslutningen misslyckades: " + err.message, logs });
    });
    const connOpts = {
      host,
      port: Number(port),
      username,
      readyTimeout: 3e4
    };
    if (finalKey && (authType === "key" || !finalPassword)) {
      connOpts.privateKey = finalKey;
    } else if (finalPassword) {
      connOpts.password = finalPassword;
    }
    conn.connect(connOpts);
  });
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.get(["/", "/index.html"], async (req, res, next) => {
      const accept = req.headers.accept || "";
      if (req.method === "GET" && accept.includes("text/html")) {
        try {
          const rootIndex = import_path.default.join(process.cwd(), "index.html");
          if (import_fs.default.existsSync(rootIndex)) {
            let html = import_fs.default.readFileSync(rootIndex, "utf-8");
            html = injectPwaMetaToHtml(html);
            html = await vite.transformIndexHtml(req.originalUrl || "/", html);
            res.setHeader("Content-Type", "text/html; charset=utf-8");
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
    const distPath = _dirname.endsWith("dist") || _dirname.endsWith("/dist") || _dirname.endsWith("\\dist") ? _dirname : import_path.default.join(_dirname, "dist");
    const publicPath = import_path.default.join(process.cwd(), "public");
    app.use("/assets", import_express.default.static(import_path.default.join(distPath, "assets")));
    app.use(import_express.default.static(distPath));
    if (import_fs.default.existsSync(publicPath)) {
      app.use(import_express.default.static(publicPath));
    }
    app.get("*", (req, res) => {
      if (req.path.startsWith("/assets/") || req.path.startsWith("/src/") || req.path.endsWith(".js") || req.path.endsWith(".css") || req.path.endsWith(".mjs") || req.path.endsWith(".map") || req.path.endsWith(".tsx") || req.path.endsWith(".ts") || req.path.endsWith(".png") || req.path.endsWith(".jpg") || req.path.endsWith(".jpeg") || req.path.endsWith(".webp") || req.path.endsWith(".svg") || req.path.endsWith(".ico") || req.path.endsWith(".webmanifest") || req.path.endsWith(".json") || req.path.endsWith(".woff") || req.path.endsWith(".woff2")) {
        return res.status(404).type("text/plain").send("Asset not found");
      }
      const indexPath = import_path.default.join(distPath, "index.html");
      if (import_fs.default.existsSync(indexPath)) {
        let html = import_fs.default.readFileSync(indexPath, "utf-8");
        html = injectPwaMetaToHtml(html);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(html);
      }
      res.sendFile(indexPath);
    });
  }
  if (typeof PORT === "string" && isNaN(Number(PORT))) {
    app.listen(PORT, () => {
      console.log(`Server running on Unix socket/pipe: ${PORT}`);
    });
  } else {
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  JWT_EXPIRES_IN,
  extractAuthUser,
  isRootAdminEmail,
  requireRootAdmin,
  verifyIsRootAdmin,
  verifyJwtToken
});
//# sourceMappingURL=server.cjs.map

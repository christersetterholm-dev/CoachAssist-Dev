/**
 * Skapar ett konto eller sätter ett nytt lösenord direkt i databasen.
 * Kräver åtkomst till serverns filer, så det kan bara köras av den som äger servern.
 *
 * Användning:
 *   npx tsx scripts/set-password.ts din@epost.se
 *
 * Databasen väljs som i server.ts: DATABASE_PATH, annars DATA_DIR/coachassist.db,
 * annars coachassist.db i projektmappen.
 */
import { createRequire } from 'module';
import { openDatabase } from '../server/database.ts';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Ange en e-postadress: npx tsx scripts/set-password.ts din@epost.se');
  process.exit(1);
}

const dataDir = process.env.DATA_DIR || process.cwd();
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'coachassist.db');
if (!fs.existsSync(dbPath)) {
  console.error(`Hittar ingen databas på ${dbPath}. Starta appen en gång först (npm run dev).`);
  process.exit(1);
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let input = '';

    // Utan terminal (t.ex. inskickad text): läs en rad som den är.
    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin });
      rl.once('line', (line) => { rl.close(); process.stdout.write('\n'); resolve(line); });
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input);
          return;
        } else if (ch === '\u0003') { // Ctrl+C
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(1);
        } else if (ch === '\u007f' || ch === '\b') { // Backsteg
          input = input.slice(0, -1);
        } else if (ch >= ' ') {
          input += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  // NEW_PASSWORD kan sättas för automatiserad körning (t.ex. tester).
  const fromEnv = process.env.NEW_PASSWORD;
  const pw1 = fromEnv ?? await askHidden('Nytt lösenord (minst 8 tecken, syns inte när du skriver): ');
  if (pw1.length < 8) {
    console.error('Lösenordet måste vara minst 8 tecken.');
    process.exit(1);
  }
  const pw2 = fromEnv ?? await askHidden('Upprepa lösenordet: ');
  if (pw1 !== pw2) {
    console.error('Lösenorden matchar inte.');
    process.exit(1);
  }

  const db = openDatabase({ dbPath, dataDir, require: createRequire(import.meta.url) });
  const hash = await bcrypt.hash(pw1, 10);
  const existing: any = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);

  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, has_logged_in = 1, temp_password = NULL WHERE id = ?').run(hash, existing.id);
    console.log(`✅ Nytt lösenord satt för ${email}.`);
  } else {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, email, username, password_hash, created_at, has_logged_in, temp_password) VALUES (?, ?, NULL, ?, ?, 1, NULL)')
      .run(id, email, hash, Date.now());
    console.log(`✅ Konto skapat för ${email}.`);
  }
  console.log(`   Databas: ${dbPath}`);
  db.close();
})();

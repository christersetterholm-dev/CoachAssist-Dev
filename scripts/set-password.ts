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
import Database from 'better-sqlite3';
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
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = process.stdout as any;
    const write = out.write.bind(out);
    let muted = false;
    out.write = (chunk: any, ...rest: any[]) => (muted ? true : write(chunk, ...rest));
    rl.question(question, (answer) => {
      out.write = write;
      write('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

(async () => {
  const pw1 = await askHidden('Nytt lösenord (minst 8 tecken, syns inte när du skriver): ');
  if (pw1.length < 8) {
    console.error('Lösenordet måste vara minst 8 tecken.');
    process.exit(1);
  }
  const pw2 = await askHidden('Upprepa lösenordet: ');
  if (pw1 !== pw2) {
    console.error('Lösenorden matchar inte.');
    process.exit(1);
  }

  const db = new Database(dbPath);
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

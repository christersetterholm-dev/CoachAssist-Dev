// Tester för flytt av data från den gamla JSON-databasen till SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { startServer } from './helpers.mjs';

test('JSON-databasen flyttas till SQLite vid start', async () => {
  const hash = await bcrypt.hash('GammaltLosen1', 10);
  const s = await startServer({
    seedJson: {
      users: { u1: { id: 'u1', email: 'gammal@test.se', username: 'gammal', password_hash: hash, created_at: 1, has_logged_in: 1 } },
      users_data: { 'u1_settings': { userId: 'u1', segment: 'settings', data: '{"x":1}', updatedAt: 5 } },
      clubs_data: { 'k_lag_sessions': { clubId: 'k', teamId: 'lag', segment: 'sessions', data: { sessions: [] }, updatedAt: 7 } },
      shared_leaderboards: {}, system_docs: {}, password_resets: {}, uploaded_files: {},
    },
  });
  try {
    const token = await s.login('gammal@test.se', 'GammaltLosen1');
    const r = await s.api('GET', '/api/docs?path=users/u1/data/settings', { token });
    assert.deepEqual(r.json, { x: 1 });
    const files = fs.readdirSync(s.dataDir);
    assert.ok(files.some((f) => f.startsWith('coachassist_db.json.flyttad-')), 'originalet ska sparas');
    assert.ok(!files.includes('coachassist_db.json'));
  } finally {
    s.stop();
  }
});

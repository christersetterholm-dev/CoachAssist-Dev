// Bygger servern (server.ts) till dist/server.cjs. Paket i node_modules bundlas inte
// utan läses från servern, där "Run NPM Install" i cPanel installerar dem.
import { build } from 'esbuild';

await build({
  entryPoints: ['server.ts'],
  outfile: 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'warning',
  // import.meta används bara i utvecklingsläge (ESM); i CJS-bygget används __dirname.
  logOverride: { 'empty-import-meta': 'silent' },
});
console.log('✓ dist/server.cjs byggd');

// Verktyg för att sätta lösenord direkt i databasen på servern
await build({
  entryPoints: ['scripts/set-password.ts'],
  outfile: 'dist/set-password.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  logLevel: 'warning',
  logOverride: { 'empty-import-meta': 'silent' },
});
console.log('✓ dist/set-password.cjs byggd');

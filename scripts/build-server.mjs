// Bygger servern (server.ts) till dist/server.cjs. Paket i node_modules bundlas inte
// utan läses från servern, där "Run NPM Install" i cPanel installerar dem.
import { build } from 'esbuild';

await build({
  entryPoints: ['server.ts'],
  outfile: 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  logLevel: 'warning',
  // import.meta används bara i utvecklingsläge (ESM); i CJS-bygget används __dirname.
  logOverride: { 'empty-import-meta': 'silent' },
});
console.log('✓ dist/server.cjs byggd');

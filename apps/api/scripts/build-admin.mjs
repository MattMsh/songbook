// Bundles the web admin into public/admin, which the Worker serves as static assets.
import { copyFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('public/admin', { recursive: true });
copyFileSync('admin/index.html', 'public/admin/index.html');
await build({ entryPoints: ['admin/main.ts'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'public/admin/app.js' });

// usage: node tools/shot.mjs <url> <out.png> [w] [h]
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const [url, out, w = 1280, h = 800] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[console]', m.type(), m.text().slice(0, 300)); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(url);
await p.waitForFunction('window.__done', null, { timeout: 60000 });
await p.waitForTimeout(800);
await p.screenshot({ path: out });
await b.close();

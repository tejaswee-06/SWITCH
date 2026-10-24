// End-to-end browser test of the canonical SWITCH journey: real frontend (Vite) + real backend (FastAPI), driven in
// Chromium like a user. Checks that the UI, the store, the backend API and the exported report all agree, that reset
// gives the same result again, the simulated Alexa+ flow, accessibility (axe-core) and narrow-viewport layout.
//
// Usage (backend on :8000 with SWITCH_DEMO_PROFILE=journey, frontend on :5173 via `npm run dev`):
//   npm i --no-save playwright @axe-core/playwright      (or set PLAYWRIGHT_MODULE / AXE_MODULE to installed paths)
//   node tools/e2e_journey.mjs [frontendUrl] [backendUrl]
// Optional: PLAYWRIGHT_CHROMIUM=/path/to/chrome (use an already-installed Chromium).
// Writes docs/e2e-journey-results.json and screenshots to docs/screenshots/journey-*.png.
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let AxeBuilder = null;
try { AxeBuilder = (await import(process.env.AXE_MODULE || '@axe-core/playwright')).default; } catch { /* axe optional */ }
const FE = (process.argv[2] || 'http://127.0.0.1:5173/').replace(/\/$/, '');
const BE = (process.argv[3] || 'http://127.0.0.1:8000').replace(/\/$/, '');
const OUT = path.resolve('docs/screenshots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const consoleErrors = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`); };
const api = async (p, opts = {}) => (await fetch(`${BE}${p}`, { ...opts, headers: { Authorization: 'Bearer demo-owner-token', 'Content-Type': 'application/json', ...(opts.headers || {}) } })).json();

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
ctx.setDefaultTimeout(120000);
const page = await ctx.newPage();
let expectNetErrors = false;   // set only while the test deliberately cuts the backend off
page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/GPU stall|ReadPixels|WebGL/.test(t) && !(expectNetErrors && /ERR_CONNECTION_REFUSED|Failed to fetch/.test(t))) consoleErrors.push(t.slice(0, 300)); } });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('dialog', (d) => d.accept());
await page.addInitScript(() => { try { localStorage.setItem('switch.settings.v1', JSON.stringify({ quality: 'low', reducedMotion: 'on', timeMode: 'manual', manualTime: '21:30' })); } catch { /* ignore */ } });
const S = (fn) => page.evaluate(`(${fn})(window.__switch)`);
const go = async (p) => { await page.locator(`[data-testid=nav-${p}]`).first().click(); await page.waitForTimeout(400); };
const shot = (name) => page.screenshot({ path: path.join(OUT, `journey-${name}.png`) });
const idle = () => page.waitForFunction(() => !window.__switch.getState().backend.busy, null, { timeout: 60000 });

async function uiJourneyToFail(tag) {
  await go('requirements');
  await page.locator('[data-testid=correction-input]').fill("Don't turn off the hallway light while someone is there.");
  await page.locator('[data-testid=draft-btn]').click(); await idle();
  const draft = await S((s) => s.queries.drafts().find((d) => d.stored && d.canonDevice === 'hallway_light'));
  const enforced = await S((s) => s.queries.activeRequirements().some((r) => r.canonDevice === 'hallway_light'));
  ok(`${tag}: correction becomes a saved DRAFT (not enforced)`, !!draft && draft.status === 'DRAFT' && !enforced, draft?.draftId);
  await shot(`${tag}-draft`);
  await page.locator(`[data-testid=confirm-${draft.draftId}]`).click(); await idle();
  const conf = await S((s) => s.queries.requirements().find((r) => r.canonDevice === 'hallway_light' && r.status === 'CONFIRMED'));
  ok(`${tag}: explicit confirmation persists CONFIRMED v1`, conf && conf.version === 1 && (await api(`/requirements/${conf.id}`)).status === 'CONFIRMED', conf?.id);
  await go('replay');
  await page.locator('[data-testid=lab-run]').click(); await idle();
  await page.locator('[data-testid=lab-verdict]').waitFor();
  const verdict = await page.locator('[data-testid=lab-verdict]').textContent();
  const run = await S((s) => { const r = s.actions.currentRun(); const f = r.cases.find((c) => c.result === 'FAIL'); return { runId: r.runId, verdict: r.verdict, ev: f?.offending?.event_id, hash: f?.traceHash, req: f?.requirement, device: f?.device, hl: s.getState().highlight }; });
  return { conf, run, verdict };
}

try {
  // ---------------------------------------------------------------- landing: typewriter, Orb, CTAs (fresh context, motion allowed)
  {
    const lctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const lp = await lctx.newPage();
    lp.on('pageerror', (e) => consoleErrors.push(`landing pageerror: ${e.message}`));
    await lp.goto(`${FE}/`, { waitUntil: 'domcontentloaded' });
    await lp.locator('[data-testid=wordmark]').waitFor();
    const box0 = await lp.locator('[data-testid=wordmark]').boundingBox();
    const typed0 = Number(await lp.locator('[data-testid=wordmark]').getAttribute('data-typed'));
    await lp.waitForFunction(() => document.querySelector('[data-testid=wordmark]')?.dataset.typed === '6', null, { timeout: 30000 });
    const box1 = await lp.locator('[data-testid=wordmark]').boundingBox();
    ok('landing: giant SWITCH wordmark types S→W→I→T→C→H and stays visible', typed0 < 6 && (await lp.locator('[data-testid=wordmark]').getAttribute('aria-label')) === 'SWITCH' && (await lp.locator('.wm-l.on').count()) === 6, `started at ${typed0}`);
    ok('landing: typewriter causes no layout shift', Math.abs(box0.width - box1.width) < 1 && Math.abs(box0.height - box1.height) < 1, `${box0.width}x${box0.height} -> ${box1.width}x${box1.height}`);
    ok('landing: blinking cursor present', await lp.locator('.wordmark .wm-cursor').count() === 1 && (await lp.evaluate(() => getComputedStyle(document.querySelector('.wordmark .wm-cursor')).animationName)) === 'wm-blink');
    await lp.waitForTimeout(1500);
    const orb = await lp.locator('[data-testid=orb-stage]').getAttribute('data-orb-status');
    ok('landing: React Bits Orb initialises WebGL2 (or shows the labelled fallback)', orb === 'ready' || (orb === 'unavailable' && await lp.locator('.orb-note').count() === 1), orb);
    results.push({ name: 'landing: Orb WebGL2 status in this browser', pass: true, info: true, detail: orb });
    ok('landing: SWITCH logo and SIMULATED DEMO label shown', await lp.locator('.orb-logo').count() === 1 && (await lp.locator('.landing-nav .badge-sim').textContent()).includes('SIMULATED DEMO'));
    await lp.screenshot({ path: path.join(OUT, 'journey-landing.png') });
    await lp.locator('[data-testid=landing-theme]').click(); await lp.waitForTimeout(800);
    ok('landing: theme toggle switches to the light theme', (await lp.evaluate(() => document.documentElement.dataset.theme)) === 'light');
    await lp.screenshot({ path: path.join(OUT, 'journey-landing-light.png') });
    await lp.locator('[data-testid=landing-theme]').click();
    await lp.locator('[data-testid=orb-stage]').hover({ position: { x: 200, y: 200 } }); await lp.mouse.down(); await lp.mouse.up();
    await lp.setViewportSize({ width: 390, height: 844 }); await lp.waitForTimeout(600);
    ok('landing: phone layout has no horizontal overflow', (await lp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
    await lp.screenshot({ path: path.join(OUT, 'journey-landing-phone.png') });
    await lp.setViewportSize({ width: 1440, height: 900 });
    await lp.locator('[data-testid=cta-talk]').click();
    await lp.locator('[data-testid=alexa-input]').waitFor({ timeout: 30000 });
    ok('landing: "Talk to SWITCH" enters the app with the assistant open', (await lp.evaluate(() => location.hash)) === '#/home' && await lp.locator('.drawer [data-testid=alexa-msgs]').count() === 1);
    await lp.close();
    const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const rp = await rctx.newPage();
    await rp.goto(`${FE}/`, { waitUntil: 'domcontentloaded' }); await rp.locator('[data-testid=wordmark]').waitFor();
    ok('landing: reduced motion shows the full wordmark immediately', (await rp.locator('[data-testid=wordmark]').getAttribute('data-typed')) === '6');
    await rp.locator('[data-testid=cta-explore]').click(); await rp.locator('.topbar').waitFor();
    ok('landing: "Explore Your Home" opens Home Overview', (await rp.evaluate(() => location.hash)) === '#/home' && await rp.locator('[data-testid=nav-home].active').count() === 1);
    await rctx.close(); await lctx.close();
  }

  // ---------------------------------------------------------------- reset to a known state
  await api('/demo/reset', { method: 'POST', body: JSON.stringify({ profile: 'journey' }) });
  await page.goto(`${FE}/#/home`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__switch && window.__switch.getState().mode === 'backend', null, { timeout: 30000 });
  await page.waitForSelector('.viewer canvas', { timeout: 60000 });
  ok('home: SIMULATED DEMO badge, backend connected, 3D canvas present',
    (await page.locator('.topbar .badge-sim').textContent()).includes('SIMULATED DEMO') && (await page.locator('.topbar [data-testid=engine-chip]').textContent()).includes('Backend connected') && await page.locator('.viewer canvas').count() > 0);
  ok('home: assistant entry point is labelled simulated', (await page.locator('[data-testid=open-alexa]').textContent()).includes('simulated'));
  await page.waitForTimeout(3000); await shot('home');

  // ---------------------------------------------------------------- correction -> confirm -> FAIL
  const A = await uiJourneyToFail('run1');
  ok('replay: faulty candidate produces deterministic FAIL', A.verdict.includes('FAIL') && A.run.verdict === 'FAIL', A.verdict);
  ok('replay: failure is the confirmed hallway requirement at a trace event', A.run.req === A.conf.id && /^E\d{4}$/.test(A.run.ev), `${A.run.req} ${A.run.ev}`);
  const flag = await page.locator('[data-testid=lab-timeline] .tl-flag').first().textContent();
  ok('replay: timeline flags the violating event', flag.includes(A.conf.id), flag);
  const sel = await page.locator('[data-testid=lab-selected]').textContent();
  ok('replay: selected-requirement panel shows the evidence event id', sel.includes(A.run.ev), sel.slice(0, 160));
  ok('replay: approve is disabled while the suite FAILs', await page.locator('[data-testid=lab-approve]').isDisabled());
  ok('3D/timeline/store agree: highlight is the hallway light in the hallway', A.run.hl?.device === 'hallwayLight' && A.run.hl?.room === 'hallway' && A.run.device === 'hallwayLight');
  const at = await S((s) => { const r = s.actions.currentRun(); const f = r.cases.find((c) => c.result === 'FAIL'); const rp = r.replays[f.scenario];
    let on = null, occ = null; const st = JSON.parse(JSON.stringify(rp.initial)); for (const e of rp.trace) { if (e.seq > f.offending.seq) break; if (e.kind === 'device' && e.device === 'hallwayLight') st.devices.hallwayLight.on = e.to; if (e.kind === 'occupancy' && e.room === 'hallway') st.rooms.hallway.occupied = e.to; }
    on = st.devices.hallwayLight.on; occ = st.rooms.hallway.occupied; return { on, occ }; });
  ok('3D replay state at the offending event: hallway occupied and light OFF', at.on === false && at.occ === true, JSON.stringify(at));
  await shot('replay-fail');
  await page.locator('.lab .viewer').first().scrollIntoViewIfNeeded(); await page.locator('.lab .viewer canvas').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(4000); await page.locator('.lab .viewer').first().screenshot({ path: path.join(OUT, 'journey-replay-house.png'), timeout: 180000 });
  await page.locator('[data-testid=lab-run]').scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  const be = await api(`/replays/${A.run.runId}/report`);
  ok('backend report agrees with the UI (run, verdict, evidence event)', be.suite.overall === 'FAIL' && be.failure_evidence[0].events[0].event_id === A.run.ev);

  // ---------------------------------------------------------------- repair -> rerun -> approve
  await page.locator('[data-testid=lab-fix]').click(); await idle();
  const prop = await page.locator('[data-testid=lab-proposal]').textContent();
  ok('repair: proposed diff shown and marked NOT VERIFIED', prop.includes('NOT VERIFIED') && /unless Hallway/.test(prop));
  ok('repair: candidate advanced to v3, approval still disabled', (await page.locator('[data-testid=lab-candidate]').textContent()) === 'v3' && await page.locator('[data-testid=lab-approve]').isDisabled());
  await shot('repair');
  await page.locator('[data-testid=lab-rerun]').click(); await idle();
  const counts = await page.locator('[data-testid=lab-counts]').textContent();
  ok('rerun: repaired candidate PASSes the relevant suite', counts.includes('Suite: PASS') && counts.includes('FAIL 0'), counts);
  await page.locator('[data-testid=lab-approve]').click(); await idle();
  const dec = await page.locator('[data-testid=lab-decision]').textContent();
  ok('approval: explicit human decision recorded (nothing deployed)', dec.includes('APPROVED'), dec.slice(0, 120));
  await shot('approved');

  // ---------------------------------------------------------------- reports + exports
  await go('reports');
  const detail = await page.locator('[data-testid=report-detail]').textContent();
  ok('reports: latest report shows PASS, decision and backend provenance', detail.includes('PASS') && detail.includes('APPROVED') && detail.includes('simulated_demo'));
  await page.locator(`[data-testid=open-${A.run.runId}]`).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid=export-json]').click()]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok('export JSON = canonical backend record for that run', exported.report.run_id === A.run.runId && exported.report.failure_evidence[0].events[0].event_id === A.run.ev);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid=export-md]').click()]);
  const md = fs.readFileSync(await dl2.path(), 'utf8');
  ok('export Markdown contains verdict, evidence and provenance', md.includes('Verdict: **FAIL**') && md.includes(A.run.ev) && md.includes('Provenance'));
  ok('PDF path: print button present (browser print dialog)', await page.locator('[data-testid=export-pdf]').count() === 1);
  await shot('report');

  // ---------------------------------------------------------------- Why SWITCH recorded journey
  await go('why');
  const why = await page.locator('[data-testid=recorded-journey]').textContent();
  ok('why: recorded journey shows correction, FAIL, repair, rerun and decision from records', why.includes('hallway') && why.includes('FAIL') && why.includes('PASS') && why.includes('APPROVED'));
  await shot('why');

  // ---------------------------------------------------------------- Devices / Integrations + Alexa+ (simulated)
  await go('devices');
  ok('integrations: Alexa+ labelled SIMULATED DEMO (never CONNECTED)', (await page.locator('[data-testid=alexa-label]').textContent()) === 'SIMULATED DEMO' && !(await page.locator('main').textContent()).includes('ALEXA+ CONNECTED'));
  await page.locator('[data-testid=alexa-test]').click();
  await page.locator('[data-testid=alexa-test-result]').waitFor();
  const tr = await page.locator('[data-testid=alexa-test-result]').textContent();
  ok('integrations: harmless connection test passes and status stays not_configured', tr.startsWith('Passed') && tr.includes('not_configured'), tr);
  await shot('devices');

  // ---------------------------------------------------------------- reset -> repeat gives identical evidence
  await go('settings');
  await page.locator('[data-testid=reset-demo]').click(); await idle();
  ok('reset: backend household re-seeded (3 requirements, no runs)', await S((s) => s.queries.requirements().length === 3 && s.getState().runs.length === 0));
  const B = await uiJourneyToFail('run2');
  ok('repeatability: same evidence event and trace hash after reset', B.run.ev === A.run.ev && B.run.hash === A.run.hash, `${B.run.ev}/${A.run.ev}`);

  // ---------------------------------------------------------------- assistant (opened from the dock) drives the real workflow
  await page.locator('[data-testid=dock-assistant]').click();
  await page.locator('[data-testid=alexa-input]').waitFor();
  const msgs = () => page.locator('[data-testid=alexa-msgs] > li');
  const say = async (t) => { const n = await msgs().count(); await page.locator('[data-testid=alexa-input]').fill(t); await page.keyboard.press('Enter');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid=alexa-msgs] > li').length >= n + 2 && !document.querySelector('.msg-busy'), n, { timeout: 90000 }); await page.waitForTimeout(300); };
  const lastCard = async () => ({ kind: await page.locator('[data-testid=alexa-msgs] > li').last().locator('[data-card]').getAttribute('data-card').catch(() => null), text: await msgs().last().innerText() });
  await say('Why did it fail?');
  let c = await lastCard();
  ok('assistant: "why did it fail?" explains the actual failed assertion with its trace event', c.kind === 'failure' && c.text.includes(B.run.ev) && c.text.includes(B.conf.id), c.text.slice(0, 160));
  await say('Approve it');
  ok('assistant: approval is not offered while the latest check FAILs', (await page.locator('[data-testid=alexa-pending]').count()) === 0 && (await lastCard()).text.includes('FAIL'));
  await say('Fix it'); c = await lastCard();
  ok('assistant: "fix it" proposes a constrained repair with a readable diff, NOT VERIFIED', c.kind === 'repair' && c.text.includes('NOT VERIFIED') && await msgs().last().locator('.diff').count() === 1);
  await say('Run the checks again'); c = await lastCard();
  ok('assistant: rerun shows the backend verdict (PASS) for the repaired candidate', c.kind === 'replay' && /PASS/.test(c.text) && /FAIL 0/.test(c.text), c.text.slice(0, 160));
  await say('Approve it');
  ok('assistant: approval asks for explicit confirmation', await page.locator('[data-testid=alexa-pending]').count() === 1);
  await page.locator('[data-testid=alexa-yes]').click();
  await page.waitForFunction(() => !document.querySelector('.msg-busy') && document.querySelector('[data-testid=alexa-msgs] > li:last-child [data-card=decision]'), null, { timeout: 60000 });
  c = await lastCard();
  ok('assistant: decision recorded, not deployed', c.kind === 'decision' && c.text.includes('APPROVED') && c.text.includes('Nothing was deployed'));
  await page.waitForTimeout(800);
  ok('assistant: UI store reflects the assistant-recorded decision', await S((s) => s.getState().lab.decision?.decision === 'approved'));
  await say('Are you connected to my Alexa?'); c = await lastCard();
  ok('assistant: status answers honestly (simulated, not connected to Amazon or devices)', c.kind === 'status' && c.text.includes('not connected to Amazon') && !c.text.includes('ALEXA+ CONNECTED'));
  // backend outage: the tool request fails -> honest error + Retry; restored -> Retry works
  expectNetErrors = true;
  await page.route('**/integrations/alexa/mcp', (r) => r.abort('connectionrefused'));
  await say('Show my saved rules'); c = await lastCard();
  ok('assistant: backend outage is reported honestly with a Retry button (no fabricated answer)', c.kind === 'error' && await msgs().last().locator('[data-testid=alexa-retry]').count() === 1, c.text.slice(0, 120));
  await page.unroute('**/integrations/alexa/mcp'); await page.waitForTimeout(300); expectNetErrors = false;
  const before = await msgs().count();
  await msgs().last().locator('[data-testid=alexa-retry]').click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=alexa-msgs] > li').length >= n + 2 && !document.querySelector('.msg-busy'), before, { timeout: 60000 });
  c = await lastCard();
  ok('assistant: after the backend is restored, Retry returns the real result', c.kind === 'requirements' && c.text.includes(B.conf.id));
  const chat = await page.locator('[data-testid=alexa-msgs]').innerText();
  ok('assistant: no raw JSON anywhere in the conversation', !/\{\s*"|"\w+"\s*:|structuredContent/.test(chat));
  await shot('alexa');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('assistant: conversation history survives closing and reopening', await (async () => { await page.locator('[data-testid=open-alexa]').click(); await page.locator('[data-testid=alexa-input]').waitFor(); const n = await msgs().count(); await page.keyboard.press('Escape'); return n > 10; })());

  // ---------------------------------------------------------------- floating dock: every item does something real
  const dockCheck = async (id, check) => { await page.locator(`[data-testid=dock-${id}]`).click(); await page.waitForTimeout(500); const r = await check(); return r; };
  const dockRes = {};
  dockRes.routines = await dockCheck('routines', () => page.evaluate(() => location.hash === '#/replay'));
  dockRes.requirements = await dockCheck('requirements', () => page.evaluate(() => location.hash === '#/requirements'));
  dockRes.reports = await dockCheck('reports', () => page.evaluate(() => location.hash === '#/reports'));
  dockRes.settings = await dockCheck('settings', () => page.evaluate(() => location.hash === '#/settings'));
  dockRes.home = await dockCheck('home', () => page.evaluate(() => location.hash === '#/home'));
  dockRes.house = await dockCheck('house', async () => (await page.evaluate(() => location.hash === '#/home')) && await page.locator('.viewer').count() > 0);
  dockRes.search = await dockCheck('search', () => page.evaluate(() => document.activeElement === document.querySelector('.cmd input')));
  dockRes.notifications = await dockCheck('notifications', () => page.locator('.notif-pop').count().then((n) => n === 1));
  await page.keyboard.press('Escape'); await page.locator('main').click({ position: { x: 5, y: 5 } }).catch(() => {});
  const th0 = await page.evaluate(() => document.documentElement.dataset.theme);
  dockRes.theme = await dockCheck('theme', () => page.evaluate((t) => document.documentElement.dataset.theme !== t, th0));
  await shot('dock-light');
  await page.locator('[data-testid=dock-theme]').click(); await page.waitForTimeout(300);
  dockRes.assistant = await dockCheck('assistant', () => page.locator('.drawer [data-testid=alexa-input]').count().then((n) => n === 1));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('dock: every destination navigates or triggers its action', Object.values(dockRes).every(Boolean), JSON.stringify(dockRes));
  await page.locator('[data-testid=dock-home]').focus(); await page.keyboard.press('ArrowRight');
  ok('dock: keyboard arrow navigation moves focus between items', await page.evaluate(() => document.activeElement?.dataset.testid === 'dock-search'));

  // ---------------------------------------------------------------- accessibility + responsive
  for (const p of ['home', 'why', 'replay', 'requirements', 'reports', 'devices', 'settings']) {
    await go(p); await page.waitForTimeout(p === 'home' ? 2500 : 600);
    if (AxeBuilder) {
      const r = await new AxeBuilder({ page }).exclude('.viewer canvas').analyze();
      const bad = r.violations.filter((v) => ['critical', 'serious'].includes(v.impact));
      ok(`a11y (axe incl. colour contrast, critical/serious): ${p}`, bad.length === 0, bad.map((v) => `${v.id}×${v.nodes.length}`).join(', '));
      const minor = r.violations.filter((v) => !['critical', 'serious'].includes(v.impact));
      results.push({ name: `a11y moderate/minor findings: ${p}`, pass: true, info: true, detail: minor.map((v) => `${v.id}×${v.nodes.length}`).join(', ') || 'none' });
    }
  }
  await page.goto(`${FE}/?fresh=1#/requirements`, { waitUntil: 'domcontentloaded' }); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => document.activeElement?.className || '');
  ok('keyboard: first Tab on a fresh page reaches the skip link', skip.includes('skip-link'), skip);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const focused = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  ok('keyboard: skip link moves focus to the main content', focused === 'main', focused);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0; });
  ok('keyboard: focused control shows a visible focus outline', ring);
  for (const vp of [{ w: 390, h: 844, n: 'phone' }, { w: 820, h: 1180, n: 'tablet' }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    const over = [];
    for (const p of ['home', 'why', 'replay', 'requirements', 'reports', 'devices', 'settings']) {
      await page.goto(`${FE}/#/${p}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(p === 'home' ? 2500 : 900);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 1) over.push(`${p}+${o}px`);
      if (p === 'replay' || p === 'home') await page.screenshot({ path: path.join(OUT, `journey-${vp.n}-${p}.png`) });
    }
    ok(`responsive ${vp.n} ${vp.w}px: no horizontal page overflow`, over.length === 0, over.join(', '));
  }
  // ---------------------------------------------------------------- offline fallback label
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${FE}/?offline#/replay`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
  ok('offline mode is labelled as the local engine', (await page.locator('.topbar [data-testid=engine-chip]').textContent()).includes('Local engine') && (await page.locator('.prov-local').count()) > 0);
} catch (e) {
  ok('journey aborted', false, e.stack || e.message);
}
ok('no uncaught page errors / console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
await browser.close();
const summary = { when: new Date().toISOString(), frontend: FE, backend: BE, passed: results.filter((r) => r.pass && !r.info).length, failed: results.filter((r) => !r.pass).length, results };
fs.writeFileSync(path.resolve('docs/e2e-journey-results.json'), JSON.stringify(summary, null, 1));
console.log(`\n${summary.passed} passed, ${summary.failed} failed`);
process.exit(summary.failed ? 1 : 0);

// End-to-end tests: loads the extension unpacked in Playwright's Chromium, drives
// the popup like a user, and checks storage and the toolbar badge.
// Usage (from tests/): npm test   — screenshots land in tests/output/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const outDir = path.join(here, 'output');
const extDir = path.join(outDir, 'extension');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(extDir, { recursive: true });

// Build a test copy of the extension. Two test-only changes:
//  - host_permissions stands in for the activeTab grant a real toolbar click gives
//  - the shortcut handler is exposed so the keyboard-save path can be driven
for (const name of await fs.readdir(repo)) {
  if (/\.(js|html|css|json)$/.test(name) || name === 'icons') {
    await fs.cp(path.join(repo, name), path.join(extDir, name), { recursive: true });
  }
}
const manifest = JSON.parse(await fs.readFile(path.join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const bgPath = path.join(extDir, 'background.js');
const bg = await fs.readFile(bgPath, 'utf8');
const hooked = bg.replace('chrome.commands.onCommand.addListener(async', 'chrome.commands.onCommand.addListener(globalThis.__onCommand = async');
if (hooked === bg) console.warn('warning: could not hook the shortcut handler; that test will be skipped');
await fs.writeFile(bgPath, hooked);

const server = http.createServer((req, res) => {
  const title = decodeURIComponent(req.url.slice(1)) || 'Home';
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const userDataDir = await fs.mkdtemp(path.join(outDir, 'profile-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 400, height: 600 },
  acceptDownloads: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

// Serve favicons locally so screenshots are deterministic and offline.
const favicon = await fs.readFile(path.join(extDir, 'icons/icon-48.png'));
const networkLog = [];
await ctx.route('https://www.google.com/s2/favicons**', r => r.fulfill({ body: favicon, contentType: 'image/png' }));
ctx.on('request', r => networkLog.push(r.url()));

let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const POPUP = `chrome-extension://${new URL(sw.url()).host}/popup.html`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 100 && !(await sw.evaluate(() => !!globalThis.chrome?.storage?.local).catch(() => false)); i++) await sleep(100);
await sleep(300);
async function waitFor(fn, timeout = 2000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(50);
  }
  return last;
}

const ITEMS = [
  { url: 'https://example.com/alpha', title: 'Alpha article', date: '2024-01-01T10:00:00.000Z' },
  { url: 'https://example.com/beta', title: 'Beta post', date: '2024-02-01T10:00:00.000Z' },
  { url: 'https://example.org/gamma', title: 'Gamma notes', originalTitle: 'Gamma original', date: '2024-03-01T10:00:00.000Z' },
  { url: 'https://example.com', title: 'Unnormalized URL item', date: '2023-12-01T10:00:00.000Z' },
];
const MANY = Array.from({ length: 40 }, (_, i) => ({
  url: `https://site${i % 7}.example/article-${i}`,
  title: `Saved article number ${i + 1} — a reasonably long title that should be clamped to one line`,
  date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
}));

const store = () => sw.evaluate(() => chrome.storage.local.get(null));
const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));
async function seed(data) {
  await sw.evaluate(async d => { await chrome.storage.local.clear(); await chrome.storage.local.set(d); }, data);
}

const pageErrors = [];
async function openPopup({ data = { readingList: ITEMS }, scheme = 'light' } = {}) {
  await seed(data);
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(`${e.message}`));
  page.on('console', m => m.type() === 'error' && pageErrors.push(`console: ${m.text()}`));
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(POPUP);
  await sleep(400);
  // Chrome sizes a popup to its content, capped at 600px tall.
  const h = await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
  await page.setViewportSize({ width: 400, height: Math.min(600, h) });
  await sleep(100);
  return page;
}
const visibleTitles = page => page.evaluate(() =>
  [...document.querySelectorAll('#readingList .reading-item')]
    .filter(el => el.checkVisibility())
    .map(el => el.querySelector('a').textContent));
const countText = page => page.$eval('#linkCount', el => el.textContent.trim());
const isVisible = (page, sel) => page.evaluate(s => !!document.querySelector(s)?.checkVisibility(), sel);
async function linkByTitle(page, title) {
  return page.locator('#readingList .reading-item a', { hasText: title }).first();
}

const results = [];
async function test(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, pass: true, detail: detail ?? '' });
  } catch (e) {
    results.push({ name, pass: false, detail: e.message.split('\n')[0] });
  }
  for (const p of ctx.pages()) await p.close().catch(() => {});
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- tests
await test('renders newest-first by default with count', async () => {
  const p = await openPopup();
  const t = await visibleTitles(p);
  expect(eq(t, ['Gamma notes', 'Beta post', 'Alpha article', 'Unnormalized URL item']), `order: ${t}`);
  expect(await countText(p) === '4', `count ${await countText(p)}`);
});

await test('first click on sort reverses order', async () => {
  const p = await openPopup();
  await p.click('#sortBtn');
  await sleep(300);
  const t = await visibleTitles(p);
  expect(t[0] === 'Unnormalized URL item', `first after sort: ${t[0]}`);
  expect((await store()).newestFirst === false, 'newestFirst not persisted as false');
});

await test('badge shows count and follows deletes', async () => {
  const p = await openPopup();
  expect(await waitFor(async () => (await badge()) === '4'), `badge=${await badge()}`);
  await (await p.locator('.reading-item', { hasText: 'Beta post' }).locator('.delete-btn')).click();
  expect(await waitFor(async () => (await badge()) === '3'), `badge after delete=${await badge()}`);
  expect(await waitFor(async () => (await countText(p)) === '3'), `count after delete=${await countText(p)}`);
});

await test('badge setting checkbox reflects stored state', async () => {
  const p = await openPopup();
  await p.click('#settingsBtn');
  await sleep(400);
  const checked = await p.$eval('#settingsShowBadge', el => el.checked);
  expect(checked === true, 'checkbox unchecked although badge is on');
  await p.click('#settingsShowBadge');
  expect(await waitFor(async () => (await badge()) === ''), `badge after toggle off=${await badge()}`);
  await p.click('#settingsShowBadge');
  expect(await waitFor(async () => (await badge()) === '4'), `badge after toggle on=${await badge()}`);
});

await test('search filters across title, original title and url', async () => {
  const p = await openPopup();
  await p.click('#searchBtn');
  await p.fill('#searchInput', 'gamma original');
  await sleep(400);
  expect(eq(await visibleTitles(p), ['Gamma notes']), `got ${await visibleTitles(p)}`);
  await p.fill('#searchInput', 'example.com');
  await sleep(400);
  expect((await visibleTitles(p)).length === 3, `got ${await visibleTitles(p)}`);
  expect(await countText(p) === '3/4', `count ${await countText(p)}`);
  await p.keyboard.press('Escape');
  await sleep(300);
  expect(!(await isVisible(p, '#searchInput')), 'search still visible after Escape');
  expect((await visibleTitles(p)).length === 4, 'items not restored after closing search');
});

await test('deleting while searching keeps the search', async () => {
  const p = await openPopup();
  await p.click('#searchBtn');
  await p.fill('#searchInput', 'example.com');
  await sleep(400);
  await p.locator('.reading-item', { hasText: 'Alpha article' }).locator('.delete-btn').click();
  await sleep(400);
  expect(await isVisible(p, '#searchInput'), 'search box closed after delete');
  const t = await visibleTitles(p);
  expect(t.length === 2 && !t.includes('Gamma notes'), `visible after delete: ${t}`);
  expect(await countText(p) === '2/3', `count ${await countText(p)}`);
});

await test('rename saves for normalized and un-normalized URLs', async () => {
  const p = await openPopup();
  await p.click('#editMode');
  for (const [from, to] of [['Alpha article', 'Alpha renamed'], ['Unnormalized URL item', 'Root renamed']]) {
    await (await linkByTitle(p, from)).click();
    await p.fill('.edit-input', to);
    await p.keyboard.press('Enter');
    await sleep(300);
  }
  const list = (await store()).readingList;
  const byUrl = Object.fromEntries(list.map(i => [i.url, i.title]));
  expect(byUrl['https://example.com/alpha'] === 'Alpha renamed', `alpha=${byUrl['https://example.com/alpha']}`);
  expect(byUrl['https://example.com'] === 'Root renamed', `root=${byUrl['https://example.com']}`);
  expect((await visibleTitles(p)).includes('Root renamed'), 'UI not updated');
});

await test('Escape cancels a rename but stays in edit mode', async () => {
  const p = await openPopup();
  await p.click('#editMode');
  await (await linkByTitle(p, 'Beta post')).click();
  await p.fill('.edit-input', 'nope');
  await p.keyboard.press('Escape');
  await sleep(300);
  const list = (await store()).readingList;
  expect(list.find(i => i.url === 'https://example.com/beta').title === 'Beta post', 'title changed');
  expect(await p.$eval('#readingList', el => el.classList.contains('edit-mode')), 'edit mode exited');
});

async function withActiveTab(url, fn) {
  const tab = await ctx.newPage();
  await tab.goto(url).catch(() => {});
  const p = await openPopup();
  await tab.bringToFront();
  await sleep(200);
  return fn(p);
}

await test('add current page updates list, count and badge', () => withActiveTab(`${BASE}/Test%20Article`, async p => {
  await p.click('#saveButton');
  await p.waitForSelector('.title-prompt-input', { timeout: 2000 });
  expect(await p.inputValue('.title-prompt-input') === 'Test Article', 'prompt not prefilled');
  await p.fill('.title-prompt-input', 'My test article');
  await p.keyboard.press('Enter');
  await sleep(500);
  const saved = (await store()).readingList.find(i => i.url === `${BASE}/Test%20Article`);
  expect(saved?.title === 'My test article', `saved=${JSON.stringify(saved)}`);
  expect((await visibleTitles(p))[0] === 'My test article', `top=${(await visibleTitles(p))[0]}`);
  expect(await countText(p) === '5', `count ${await countText(p)}`);
  expect(await waitFor(async () => (await badge()) === '5'), `badge=${await badge()}`);
}));

await test('add on an already-saved page does not duplicate', () => withActiveTab(`${BASE}/Beta`, async p => {
  await sw.evaluate(u => chrome.storage.local.get('readingList').then(({ readingList }) =>
    chrome.storage.local.set({ readingList: [...readingList, { url: u, title: 'Beta dup', date: new Date().toISOString() }] })), `${BASE}/Beta`);
  await sleep(300);
  await p.click('#saveButton');
  await sleep(400);
  const prompt = await isVisible(p, '.title-prompt-input');
  if (prompt) { await p.keyboard.press('Enter'); await sleep(300); }
  const n = (await store()).readingList.filter(i => i.url === `${BASE}/Beta`).length;
  expect(n === 1, `duplicates: ${n}`);
  return prompt ? 'showed a prompt (no feedback)' : 'no prompt shown';
}));

await test('cannot save browser-internal pages', () => withActiveTab('about:blank', async p => {
  await p.click('#saveButton');
  await sleep(400);
  if (await isVisible(p, '.title-prompt-input')) { await p.keyboard.press('Enter'); await sleep(300); }
  const bad = (await store()).readingList.filter(i => !/^https?:/.test(i.url));
  expect(bad.length === 0, `saved: ${bad.map(i => i.url)}`);
}));

await test('opening an item records lastOpened', async () => {
  const p = await openPopup();
  const [newPage] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 3000 }),
    (await linkByTitle(p, 'Beta post')).click(),
  ]);
  await sleep(500);
  const item = (await store()).readingList.find(i => i.url === 'https://example.com/beta');
  expect(item.lastOpened, 'lastOpened not recorded');
  expect(newPage.url().startsWith('https://example.com/beta'), `opened ${newPage.url()}`);
});

await test('footer Download works from the settings screen', async () => {
  const p = await openPopup();
  await p.click('#settingsBtn');
  await sleep(500);
  const target = await p.evaluate(() => {
    const els = [...document.querySelectorAll('a, button')].filter(el => el.textContent.trim() === 'Download' && el.checkVisibility());
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight - 45 || r.bottom > innerHeight) continue; // must sit in the footer strip
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (document.elementFromPoint(x, y) === el) return { x, y };
    }
    return null;
  });
  expect(target, 'no clickable footer Download on settings screen');
  const dl = p.waitForEvent('download', { timeout: 2000 });
  await p.mouse.click(target.x, target.y);
  const file = await dl;
  const data = JSON.parse(await fs.readFile(await file.path(), 'utf8'));
  expect(data.length === 4, `exported ${data.length}`);
  return file.suggestedFilename();
});

await test('import merges, dedupes, rejects unsafe URLs', async () => {
  const p = await openPopup();
  const file = path.join(outDir, 'import.json');
  await fs.writeFile(file, JSON.stringify([
    { url: 'https://new.example/one', title: 'New one', date: '2024-05-01T00:00:00.000Z' },
    { url: 'https://new.example/two', title: 'New two', date: '2024-05-02T00:00:00.000Z' },
    { url: 'https://example.com/alpha', title: 'dup', date: '2024-05-03T00:00:00.000Z' },
    { url: 'javascript:alert(1)', title: 'evil', date: '2024-05-04T00:00:00.000Z' },
    { url: 'https://new.example/untitled', date: '2024-05-05T00:00:00.000Z' },
  ]));
  await p.setInputFiles('#uploadJson', file);
  await sleep(600);
  const list = (await store()).readingList;
  expect(!list.some(i => i.url.startsWith('javascript:')), 'javascript: URL imported');
  expect(list.filter(i => i.url === 'https://example.com/alpha').length === 1, 'duplicate imported');
  expect(list.some(i => i.url === 'https://new.example/untitled'), 'item without title rejected');
  expect(list.length === 7, `list length ${list.length}`);
  expect(await countText(p) === '7', `count ${await countText(p)}`);
});

await test('clear-all dialog: cancel, Escape, confirm', async () => {
  const p = await openPopup();
  await p.click('#settingsBtn');
  await sleep(400);
  await p.click('#settingsClearAll');
  await p.waitForSelector('#cancelClear', { state: 'visible', timeout: 2000 });
  await p.click('#cancelClear');
  await sleep(200);
  expect(!(await isVisible(p, '#confirmClear')), 'dialog not closed by Cancel');
  await p.click('#settingsClearAll');
  await p.waitForSelector('#confirmClear', { state: 'visible' });
  await p.keyboard.press('Escape');
  await sleep(200);
  const escClosed = !(await isVisible(p, '#confirmClear'));
  if (!escClosed) await p.click('#cancelClear');
  expect((await store()).readingList.length === 4, 'items deleted by cancel/escape');
  await p.click('#settingsClearAll');
  await p.waitForSelector('#confirmClear', { state: 'visible' });
  await p.click('#confirmClear');
  await sleep(400);
  expect((await store()).readingList.length === 0, 'not cleared');
  expect(await waitFor(async () => (await badge()) === ''), `badge=${await badge()}`);
  expect(escClosed, 'Escape does not close dialog');
});

await test('font choice applies, persists, and loads only when chosen', async () => {
  networkLog.length = 0;
  const p = await openPopup();
  const fontReqsDefault = networkLog.filter(u => u.includes('fonts.googleapis')).length;
  await p.click('#settingsBtn');
  await sleep(300);
  await p.selectOption('#fontSelect', { label: 'Inter' });
  await sleep(300);
  expect((await store()).fontFamily?.includes('Inter'), 'font not stored');
  const ff = await p.$eval('#readingList .reading-item a', el => getComputedStyle(el).fontFamily);
  expect(ff.includes('Inter'), `list font ${ff}`);
  expect(fontReqsDefault === 0, `requested Google Fonts on open with default font (${fontReqsDefault} reqs)`);
});

await test('dark mode swaps popup icons and records theme', async () => {
  const p = await openPopup({ scheme: 'dark' });
  await sleep(300);
  const src = await p.$eval('#searchBtn img', el => el.currentSrc || el.src);
  expect(src.endsWith('search-dark.png'), `search icon ${src}`);
  expect(await waitFor(async () => (await store()).isDarkMode === true), 'isDarkMode not stored');
});

await test('long list: last item reachable above footer, footer in view', async () => {
  const p = await openPopup({ data: { readingList: MANY } });
  await p.evaluate(() => { const w = document.querySelector('.content-wrapper'); w.scrollTop = w.scrollHeight; });
  await p.mouse.move(200, 300);
  await p.mouse.wheel(0, 5000);
  await sleep(300);
  const m = await p.evaluate(() => {
    const items = document.querySelectorAll('.reading-item');
    const last = items[items.length - 1].getBoundingClientRect();
    const footer = document.querySelector('.footer').getBoundingClientRect();
    return { lastBottom: last.bottom, footerTop: footer.top, footerBottom: footer.bottom, vh: innerHeight };
  });
  expect(m.footerBottom <= m.vh + 0.5, `footer off-screen ${JSON.stringify(m)}`);
  expect(m.lastBottom <= m.footerTop + 0.5, `last item hidden ${JSON.stringify(m)}`);
  const hScroll = await p.evaluate(() => { const w = document.querySelector('.content-wrapper'); return w.scrollWidth > w.clientWidth; });
  await p.click('#searchBtn');
  await sleep(300);
  const hScrollSearch = await p.evaluate(() => { const w = document.querySelector('.content-wrapper'); return w.scrollWidth > w.clientWidth; });
  expect(!hScroll && !hScrollSearch, `horizontal overflow (list=${hScroll}, search=${hScrollSearch})`);
});

await test('middle-click opens one background tab and records lastOpened', async () => {
  const p = await openPopup();
  const before = ctx.pages().length;
  await (await linkByTitle(p, 'Alpha article')).click({ button: 'middle' });
  await sleep(800);
  const opened = ctx.pages().length - before;
  const item = (await store()).readingList.find(i => i.url === 'https://example.com/alpha');
  expect(opened === 1, `opened ${opened} tabs`);
  expect(item.lastOpened, 'lastOpened not recorded');
});

await test('shortcut save: adds page, flashes ✓/✕, then restores count', async () => {
  if (!(await sw.evaluate(() => typeof globalThis.__onCommand === 'function'))) return 'skipped (no test hook)';
  await seed({ readingList: ITEMS });
  await sleep(300);
  await sw.evaluate(() => __onCommand('save-page', { url: 'https://example.net/kbd', title: 'Keyboard page' }));
  expect(await badge() === '✓', `badge ${await badge()}`);
  const item = (await store()).readingList.find(i => i.url === 'https://example.net/kbd');
  expect(item?.title === 'Keyboard page' && item.originalTitle === 'Keyboard page', `saved ${JSON.stringify(item)}`);
  expect(await waitFor(async () => (await badge()) === '5', 3000), `badge after flash ${await badge()}`);
  await sw.evaluate(() => __onCommand('save-page', { url: 'https://example.net/kbd', title: 'again' }));
  expect((await store()).readingList.length === 5, 'duplicate saved');
  await sw.evaluate(() => __onCommand('save-page', { url: 'chrome://settings', title: 'Settings' }));
  expect(await badge() === '✕', `badge for invalid ${await badge()}`);
  expect(await waitFor(async () => (await badge()) === '5', 3000), `badge after invalid flash ${await badge()}`);
});

// Chrome sizes the popup to fit all laid-out content, so anything parked
// off-screen (like a closed settings panel) would widen the popup.
await test('popup content stays 400px wide; settings still slides in', async () => {
  const p = await openPopup();
  const width = () => p.evaluate(() => document.documentElement.scrollWidth);
  const widths = [await width()];
  await p.click('#settingsBtn');
  await sleep(100);
  const midX = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('settingsPanel')).transform).m41);
  await sleep(400);
  widths.push(await width());
  await p.click('#settingsBack');
  await sleep(500);
  widths.push(await width());
  expect(widths.every(w => w === 400), `content widths closed/open/closed: ${widths}`);
  expect(midX > 0 && midX < 400, `panel not animating (x=${midX} at 100ms)`);
  expect(!(await isVisible(p, '#settingsPanel')), 'panel visible after closing');
});

// ------------------------------------------------------------ screenshots
const shots = [
  ['short', { readingList: ITEMS }, null],
  ['long', { readingList: MANY }, null],
  ['search', { readingList: MANY }, async p => { await p.click('#searchBtn'); await p.fill('#searchInput', 'number 1'); await sleep(400); }],
  ['edit', { readingList: ITEMS }, async p => { await p.click('#editMode'); await sleep(300); }],
  ['settings', { readingList: ITEMS }, async p => { await p.click('#settingsBtn'); await sleep(600); }],
  ['dialog', { readingList: ITEMS }, async p => { await p.click('#settingsBtn'); await sleep(400); await p.click('#settingsClearAll'); await sleep(300); }],
  ['empty', { readingList: [] }, null],
];
for (const scheme of ['light', 'dark']) {
  for (const [name, data, action] of shots) {
    const p = await openPopup({ data, scheme });
    if (action) await action(p);
    await p.screenshot({ path: path.join(outDir, `${scheme}-${name}.png`) });
    await p.close();
  }
}

// ----------------------------------------------------------------- report
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
const uniqErrors = [...new Set(pageErrors)];
console.log(uniqErrors.length ? `page errors:\n  ${uniqErrors.join('\n  ')}` : 'no page errors');
await ctx.close();
server.close();
await fs.rm(userDataDir, { recursive: true, force: true });
if (results.some(r => !r.pass) || uniqErrors.length) process.exitCode = 1;

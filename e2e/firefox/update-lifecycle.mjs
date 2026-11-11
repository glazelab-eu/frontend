// Service worker update lifecycle in the system's headless Firefox (Playwright's own Firefox is not installed): three builds A -> B -> C,
// served with the cache headers of nginx.conf.template, a persistent profile per case (the worker state survives a browser restart) and
// privacy settings in its user.js. Each update must end with the new build in control: Refresh loads it, a reload and a restart show no
// notice. `stuck` serves workers that ignore the skip-waiting message, what the 23-68 report showed in a user's Firefox (one running,
// one installed worker): the app must recover instead of offering the same notice again.
//
//   npm run e2e:firefox-update                     # all cases against builds of the working tree
//   npm run e2e:firefox-update -- --ref 23318cc    # the same cases against builds of a commit (shows what an older app did)
//   npm run e2e:firefox-update -- default:stuck    # chosen cases, <prefs>:<flags joined by +>
//
// `down` (with `stuck`) takes the server away while Refresh recovers: the installed app must keep its old worker and shell.
//
// FIREFOX overrides the browser (default /usr/bin/firefox); profiles and builds go to $TMPDIR/glazelab-ff-update/. Ports: 40000-49999.
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const FRONTEND = resolve(import.meta.dirname, '../..');
const WORK = join(process.env.TMPDIR || tmpdir(), 'glazelab-ff-update');
const FIREFOX = process.env.FIREFOX || '/usr/bin/firefox';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const pref = (name, value) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`;

/** Privacy settings privacy-aware users run with (names checked against Firefox 157's defaults). */
const PREFS = {
  default: [],
  rfp: [pref('privacy.resistFingerprinting', true)],
  fpp: [pref('privacy.fingerprintingProtection', true)],
  cookie5: [pref('network.cookie.cookieBehavior', 5)],
  firstParty: [pref('privacy.firstparty.isolate', true)],
  clearOnExit: [
    pref('privacy.sanitize.sanitizeOnShutdown', true),
    pref('privacy.clearOnShutdown_v2.cookiesAndStorage', true),
    pref('privacy.clearOnShutdown_v2.cache', true),
  ],
  // Enhanced Tracking Protection "Custom" with everything on and "Fix major site issues" off, plus resistFingerprinting.
  max: [
    pref('browser.contentblocking.category', 'custom'),
    pref('network.cookie.cookieBehavior', 5),
    pref('privacy.trackingprotection.enabled', true),
    pref('privacy.trackingprotection.pbmode.enabled', true),
    pref('privacy.trackingprotection.cryptomining.enabled', true),
    pref('privacy.trackingprotection.fingerprinting.enabled', true),
    pref('privacy.trackingprotection.socialtracking.enabled', true),
    pref('privacy.trackingprotection.emailtracking.enabled', true),
    pref('privacy.fingerprintingProtection', true),
    pref('privacy.resistFingerprinting', true),
    pref('privacy.annotate_channels.strict_list.enabled', true),
    pref('privacy.query_stripping.enabled', true),
    pref('privacy.bounceTrackingProtection.mode', 1),
    pref('privacy.trackingprotection.allow_list.baseline.enabled', false),
    pref('privacy.trackingprotection.allow_list.convenience.enabled', false),
  ],
  // "Block all cookies": no service worker at all, so there is nothing to update and no notice may show.
  blockAll: [pref('network.cookie.cookieBehavior', 2), pref('privacy.resistFingerprinting', true)],
};
const DEFAULT_CASES = [
  'default:basic',
  'rfp:basic',
  'fpp:basic',
  'cookie5:basic',
  'firstParty:basic',
  'clearOnExit:basic',
  'max:basic',
  'max:secondTab',
  'max:dirtyTab',
  'default:stuck',
  'max:stuck+secondTab',
  'max:stuck+dirtyTab',
  'default:stuck+down',
  'blockAll:basic',
];

// --- builds ------------------------------------------------------------------------------------------------------------------------

/** Builds A, B and C of one source tree; each label differs, and so do their service workers. */
async function buildAll(ref) {
  let source = FRONTEND;
  if (ref) {
    source = join(WORK, 'src-' + ref);
    await rm(source, { recursive: true, force: true });
    await mkdir(source, { recursive: true });
    execFileSync('sh', ['-c', `git -C "$0" archive "$1" | tar -x -C "$2"`, FRONTEND, ref, source]);
    await symlink(join(FRONTEND, 'node_modules'), join(source, 'node_modules'));
  }
  const dists = {};
  for (const build of ['a', 'b', 'c']) {
    dists[build] = join(WORK, `dist-${ref ?? 'tree'}-${build}`);
    console.log(`building ${build} from ${ref ?? 'the working tree'}`);
    execFileSync('npx', ['vite', 'build', '--outDir', dists[build], '--emptyOutDir'], {
      cwd: source,
      env: { ...process.env, GLAZELAB_BUILD: `ff-${build}` },
      stdio: 'ignore',
    });
  }
  return dists;
}

// --- server ------------------------------------------------------------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
  '.wasm': 'application/wasm',
};

/** nginx.conf.template's Cache-Control per location: hashed assets for a year, everything else (sw.js, index.html, manifest) no-cache. */
function cacheControl(path) {
  return path.startsWith('/assets/') || /^\/workbox-[0-9a-f]+\.js$/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache';
}

const USER = { id: 'u1', email: 'ada@example.com', displayName: 'Ada', siteAdmin: false, acceptedTermsVersion: null };

async function listen(server) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = 40000 + Math.floor(Math.random() * 10000);
    const ok = await new Promise((done) => {
      server.once('error', () => done(false));
      server.listen(port, '127.0.0.1', () => done(true));
    });
    if (ok) return port;
  }
  throw new Error('no free port in 40000-49999');
}

async function freePort() {
  const probe = createNetServer();
  const port = await listen(probe);
  await new Promise((done) => probe.close(done));
  return port;
}

/**
 * Serves `site.dist` like production; `site.stuck` serves a service worker whose skip-waiting handler does nothing; `site.down` answers
 * 502 to everything (a deployment, a dropped network behind a proxy).
 */
function startServer(site, termsVersion) {
  const json = (res, body) => res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (site.down) return res.writeHead(502, { 'Cache-Control': 'no-store' }).end();
    if (path.startsWith('/api/')) {
      if (path === '/api/auth/me') return json(res, { ...USER, acceptedTermsVersion: termsVersion });
      if (path === '/api/auth/options') return json(res, { emailEnabled: true, operatorEmail: 'operator@example.com', termsVersion });
      if (path === '/api/auth/csrf') return json(res, { token: 't', headerName: 'X-XSRF-TOKEN' });
      if (path === '/api/favorites') return json(res, { glazeIds: [], combinationIds: [] });
      return req.method === 'GET' ? json(res, []) : res.writeHead(404).end();
    }
    let file = resolve(site.dist, '.' + (path === '/' ? '/index.html' : path));
    let body;
    try {
      body = await readFile(file);
    } catch {
      if (path === '/sw.js' || path.startsWith('/assets/') || path.startsWith('/workbox-')) return res.writeHead(404).end();
      file = resolve(site.dist, 'index.html');
      body = await readFile(file);
    }
    if (path === '/sw.js' && site.stuck) body = Buffer.from(body.toString().replace('self.skipWaiting()', 'void 0'));
    res
      .writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': cacheControl(path === '/' ? '/index.html' : path),
      })
      .end(body);
  });
  return server;
}

// --- browser -----------------------------------------------------------------------------------------------------------------------

/** Firefox over WebDriver BiDi on `profile`, which keeps its service workers between launches. */
async function launch(profile, prefs) {
  await mkdir(profile, { recursive: true });
  await writeFile(
    join(profile, 'user.js'),
    [
      pref('browser.shell.checkDefaultBrowser', false),
      pref('intl.accept_languages', 'en'),
      pref('datareporting.policy.dataSubmissionEnabled', false),
      ...prefs,
    ].join('\n') + '\n',
  );
  const port = await freePort();
  const firefox = spawn(FIREFOX, ['--headless', '--profile', profile, `--remote-debugging-port=${port}`, '--no-remote', 'about:blank'], { stdio: 'ignore' });
  const exited = new Promise((done) => firefox.on('exit', done));
  let socket;
  for (let attempt = 0; attempt < 80 && !socket; attempt++) {
    await sleep(500);
    socket = await new Promise((done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
      ws.onopen = () => done(ws);
      ws.onerror = () => done(undefined);
    });
  }
  if (!socket) {
    firefox.kill();
    throw new Error('Firefox did not open WebDriver BiDi');
  }
  let next = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) =>
    new Promise((done) => {
      const id = ++next;
      pending.set(id, done);
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send('session.new', { capabilities: { alwaysMatch: {} } });
  const tab = (await send('browsingContext.getTree')).result.contexts[0].context;
  const run = async (expression, context = tab) => {
    const reply = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' });
    if (reply.error || reply.result.type === 'exception') throw new Error(JSON.stringify(reply.error ?? reply.result.exceptionDetails).slice(0, 300));
    return reply.result.result.value;
  };
  const until = async (expression, context = tab, tries = 80) => {
    for (let attempt = 0; attempt < tries; attempt++) {
      if (await run(`!!(${expression})`, context).catch(() => false)) return true;
      await sleep(150);
    }
    return false;
  };
  const quit = async () => {
    await send('browser.close').catch(() => {});
    await Promise.race([exited, sleep(15000)]);
    firefox.kill();
    await sleep(300);
  };
  return { send, tab, run, until, quit };
}

const STATE = `(async () => {
  const container = navigator.serviceWorker;
  const registration = container ? await container.getRegistration().catch(() => undefined) : undefined;
  return JSON.stringify({
    label: document.querySelector('.app-shell__version')?.textContent.trim() ?? null,
    next: document.querySelector('.app-shell__next-version')?.textContent.trim() ?? null,
    notice: !!document.querySelector('.update-notice'),
    buttons: [...document.querySelectorAll('.update-notice button')].map((button) => button.textContent.trim()),
    controlled: !!container?.controller,
    waiting: !!registration?.waiting,
    title: document.querySelector('#studio-title')?.value ?? null,
    marker: window.__marker ?? null,
  });
})()`;

// --- cases -------------------------------------------------------------------------------------------------------------------------

async function runCase(spec, dists, termsVersion, ref, results) {
  const [prefsName, flagList = 'basic'] = spec.split(':');
  const flags = new Set(flagList.split('+'));
  const profile = join(WORK, 'profiles', spec.replace(/[^a-z0-9]+/gi, '-'));
  await rm(profile, { recursive: true, force: true });
  const site = { dist: dists.a, stuck: false, down: false };
  const server = startServer(site, termsVersion);
  const origin = `http://127.0.0.1:${await listen(server)}`;
  const check = (what, ok, detail = '') => {
    results.push({ spec, what, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${spec} | ${what}${ok ? '' : ' | ' + detail}`);
  };
  let browser = await launch(profile, PREFS[prefsName]);
  const state = async (context) => JSON.parse(await browser.run(STATE, context ?? browser.tab));
  const open = (context, hash = '/') =>
    browser.send('browsingContext.navigate', { context: context ?? browser.tab, url: `${origin}/#${hash}`, wait: 'complete' });
  const reload = () => browser.send('browsingContext.reload', { context: browser.tab, wait: 'complete' });
  const app = (context) => browser.until(`document.querySelector('.app-shell__version')`, context ?? browser.tab);
  const noWorker = prefsName === 'blockAll';
  try {
    await open();
    await app();
    if (!noWorker) check('A: the first worker controls the page', await browser.until('navigator.serviceWorker.controller'));
    for (const build of ['b', 'c']) {
      site.dist = dists[build];
      site.stuck = flags.has('stuck');
      await reload();
      await app();
      if (noWorker) {
        await sleep(3000);
        const now = await state();
        check(
          `${build}: without a service worker the page loads the new build and shows no notice`,
          now.label.includes(`ff-${build}`) && !now.notice,
          JSON.stringify(now),
        );
        continue;
      }
      const shown = await browser.until(`document.querySelector('.update-notice')`);
      check(`${build}: the notice shows for the new build`, shown, JSON.stringify(await state()));
      if (!shown) break;
      if (!ref)
        check(
          `${build}: the footer names the new build`,
          await browser.until(`document.querySelector('.app-shell__next-version')?.textContent.includes('ff-${build}')`),
          JSON.stringify(await state()),
        );
      let other;
      if (flags.has('secondTab') || flags.has('dirtyTab')) {
        other = (await browser.send('browsingContext.create', { type: 'tab' })).result.context;
        await open(other, flags.has('dirtyTab') ? '/studio' : '/');
        await browser.until(flags.has('dirtyTab') ? `document.querySelector('#studio-title')` : `document.querySelector('.app-shell__version')`, other);
        await browser.run(`window.__marker = 1`, other);
        if (flags.has('dirtyTab')) {
          await browser.run(`document.querySelector('#studio-title').focus()`, other);
          const keys = [...'Tab draft'].flatMap((value) => [
            { type: 'keyDown', value },
            { type: 'keyUp', value },
          ]);
          await browser.send('input.performActions', { context: other, actions: [{ type: 'key', id: 'keyboard', actions: keys }] });
        }
        await browser.send('browsingContext.activate', { context: browser.tab });
      }
      const press = () =>
        browser.run(`[...document.querySelectorAll('.update-notice button')].find((button) => button.textContent.trim() === 'Refresh').click()`);
      if (flags.has('down')) {
        const before = (await state()).label;
        site.down = true;
        await press();
        await sleep(7000);
        await app();
        const kept = await state();
        site.down = false;
        check(
          `${build}: Refresh while the server is down keeps the old worker and its shell`,
          kept.label === before && kept.controlled && kept.waiting,
          JSON.stringify(kept),
        );
        if (!(await browser.until(`document.querySelector('.update-notice')`))) {
          check(`${build}: the notice is back once the server is`, false, JSON.stringify(await state()));
          break;
        }
      }
      await press();
      const reached = await browser.until(`document.querySelector('.app-shell__version')?.textContent.includes('ff-${build}')`, browser.tab, 100);
      await sleep(1500);
      const after = await state();
      check(
        `${build}: Refresh loads the new build, nothing waits, no notice`,
        reached && !after.waiting && !after.notice && after.controlled,
        JSON.stringify(after),
      );
      if (other && flags.has('dirtyTab')) {
        const kept = await state(other);
        check(
          `${build}: a tab with unsaved input keeps its page and shows the stale notice without Later`,
          kept.marker === 1 && kept.title === 'Tab draft' && kept.notice && kept.buttons.join() === 'Refresh',
          JSON.stringify(kept),
        );
        await browser.run(
          `(() => { const input = document.querySelector('#studio-title'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
          other,
        );
        await sleep(2500);
        await app(other);
        const left = await state(other);
        check(
          `${build}: once its input is gone, that tab reloads into the new build`,
          left.marker === null && left.label.includes(`ff-${build}`) && !left.notice,
          JSON.stringify(left),
        );
      } else if (other) {
        await sleep(1000);
        await app(other);
        const clean = await state(other);
        check(
          `${build}: a second tab without unsaved input reloads into the new build`,
          clean.marker === null && clean.label.includes(`ff-${build}`) && !clean.notice,
          JSON.stringify(clean),
        );
      }
      if (other) await browser.send('browsingContext.close', { context: other });
      await reload();
      await app();
      await sleep(2500);
      const again = await state();
      check(
        `${build}: after another reload no notice comes back`,
        again.label.includes(`ff-${build}`) && !again.notice && !again.waiting,
        JSON.stringify(again),
      );
    }
    await browser.quit();
    browser = await launch(profile, PREFS[prefsName]);
    await open();
    await app();
    await sleep(3000);
    const restarted = await state();
    check('after a browser restart: the last build, no notice', restarted.label.includes('ff-c') && !restarted.notice, JSON.stringify(restarted));
  } catch (error) {
    check('ran to the end', false, String(error?.stack ?? error).slice(0, 300));
  } finally {
    await browser.quit();
    server.close();
  }
}

const args = process.argv.slice(2);
const refAt = args.indexOf('--ref');
const ref = refAt >= 0 ? args.splice(refAt, 2)[1] : undefined;
const cases = args.length ? args : DEFAULT_CASES;
await mkdir(WORK, { recursive: true });
const termsVersion = (await readFile(join(FRONTEND, 'src/lib/api/terms.ts'), 'utf8')).match(/['"](\d{4}-\d{2}-\d{2}[^'"]*)['"]/)?.[1] ?? null;
const dists = await buildAll(ref);
const results = [];
for (const spec of cases) await runCase(spec, dists, termsVersion, ref, results);
const failed = results.filter((result) => !result.ok);
console.log(
  failed.length
    ? `FAILED ${failed.length} of ${results.length}: ${[...new Set(failed.map((result) => result.spec))].join(', ')}`
    : `ALL ${results.length} PASSED`,
);
process.exit(failed.length ? 1 : 0);

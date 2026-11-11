import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { Api } from '../support/api';
import { barcodeVideo, qrVideo } from '../support/barcodes';
import { E2E_HOME, FIXTURES, TMP } from '../support/paths';
import { showPointer } from '../support/pace';
import { accountOf, type PersonKey, type Seeded } from './seed';

export { expect };

const execute = promisify(execFile);

/** The size the recording is made at: the iPhone X's 375x812 CSS pixels at 2x. */
export const VIDEO_SIZE = { width: 750, height: 1624 };

/** Where the videos go (`GLAZELAB_VIDEOS_OUT`, default `videos` under `E2E_HOME`); the raw recordings are kept in `raw/` beside them. */
export const VIDEOS = process.env.GLAZELAB_VIDEOS_OUT ?? join(E2E_HOME, 'videos');

/** The fake camera films this file; `film` rewrites it before the scanner opens. */
export const CAMERA_FILE = join(FIXTURES, 'videos-camera.y4m');
export const film = (barcode: string) => writeFileSync(CAMERA_FILE, barcodeVideo(barcode));
/** The fake camera films a plain white sheet: a scanner that finds nothing to read. */
export function filmBlank(): void {
  const [width, height] = [640, 480];
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Buffer.alloc(width * height, 235), Buffer.alloc((width * height) / 2, 128)]);
  writeFileSync(CAMERA_FILE, Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`), ...Array<Buffer>(10).fill(frame)]));
}
/** The fake camera films a QR code of a text (a link). */
export const filmQr = (text: string) => writeFileSync(CAMERA_FILE, qrVideo(text));

/** A recording waits for a quiet host (1-minute load average below `GLAZELAB_VIDEOS_MAX_LOAD`, default 3), so it does not stutter. */
async function waitForQuietHost(): Promise<void> {
  const limit = Number(process.env.GLAZELAB_VIDEOS_MAX_LOAD ?? 3);
  const deadline = Date.now() + 40 * 60_000;
  while (loadavg()[0] >= limit && Date.now() < deadline) await new Promise((done) => setTimeout(done, 5_000));
}

/**
 * The recording: screenshots of the page taken back to back at its device pixels (1125x2436), each held until the next and scaled down to 750x1624.
 * Chromium's own screencast and Playwright's video only deliver the page at 1x, which is too soft to read small text on a phone.
 */
class Screencast {
  private frames: Array<{ file: string; at: number }> = [];
  private directory = '';
  private running = false;
  private loop?: Promise<void>;

  async start(page: Page): Promise<void> {
    mkdirSync(TMP, { recursive: true });
    this.directory = mkdtempSync(join(TMP, 'frames-'));
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        const at = Date.now() / 1000;
        try {
          const data = await page.screenshot({ type: 'jpeg', quality: 85, scale: 'device', animations: 'allow', caret: 'initial' });
          const file = join(this.directory, `${this.frames.length}.jpg`);
          writeFileSync(file, data);
          this.frames.push({ file, at });
        } catch {
          // A navigation or a closing page: the next round tries again.
        }
        await new Promise((done) => setTimeout(done, 30));
      }
    })();
  }

  /** Writes the frames as an MP4 (and a VP9 WebM of the same pictures); answers its length in seconds. */
  async save(out: string, raw: string): Promise<number> {
    this.running = false;
    await this.loop;
    if (this.frames.length < 2) throw new Error('The screencast produced no frames');
    const end = Date.now() / 1000;
    const lines = this.frames.map((frame, index) => {
      const next = this.frames[index + 1]?.at ?? Math.max(end, frame.at + 1);
      return `file '${frame.file}'\nduration ${Math.max(next - frame.at, 0.001).toFixed(3)}`;
    });
    lines.push(`file '${this.frames[this.frames.length - 1].file}'`);
    const list = join(this.directory, 'frames.txt');
    writeFileSync(list, lines.join('\n'));
    const common = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-vf',
      `scale=${VIDEO_SIZE.width}:${VIDEO_SIZE.height}:flags=lanczos,fps=30,format=yuv420p`,
      '-an',
    ];
    await execute('ffmpeg', [...common, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-movflags', '+faststart', out]);
    await execute('ffmpeg', [...common, '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-deadline', 'good', '-cpu-used', '6', '-row-mt', '1', raw]);
    rmSync(this.directory, { recursive: true, force: true });
    const probe = await execute('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]);
    return Number(probe.stdout.trim());
  }
}

/** `GLAZELAB_VIDEOS_PACE=0.1` shortens every pause and the typing delay, to debug a spec quickly (the result is not a usable video). */
const PACE = Number(process.env.GLAZELAB_VIDEOS_PACE ?? 1);

/** Acts at a human pace: a visible pointer, taps after a beat, typing key by key, pauses for the viewer. */
export class Human {
  constructor(readonly page: Page) {}

  async pause(milliseconds = 1000): Promise<void> {
    await this.page.waitForTimeout(milliseconds * PACE);
  }

  /** Moves the pointer onto a control and waits a beat (for a native menu, which a page cannot open, or to point at something). */
  async point(target: ReturnType<Page['locator']>): Promise<void> {
    const { x, y } = await this.centre(target);
    await this.page.mouse.move(x, y);
    await this.pause(700);
  }

  /** Brings a control to the middle of the window, clear of the sticky header and the bottom bar, and answers its centre. */
  private async centre(target: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
    await target.waitFor({ state: 'visible' });
    await target.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await this.page.waitForTimeout(250);
    const box = await target.boundingBox();
    if (!box) throw new Error('The control has no box');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Moves the pointer to a control, waits a beat, then taps it where it stands (a touch lands on what is under the finger). */
  async tap(target: ReturnType<Page['locator']>): Promise<void> {
    const { x, y } = await this.centre(target);
    await this.page.mouse.move(x, y);
    await this.pause(450);
    // Where something else (the bottom bar) covers the control, press it where Playwright finds it clickable.
    const covered = await target.evaluate(
      (element, point) => {
        const top = document.elementFromPoint(point.x, point.y);
        return !top || !(element === top || element.contains(top) || top.contains(element));
      },
      { x, y },
    );
    if (covered) await target.click({ timeout: 3000 }).catch(() => this.page.mouse.click(x, y));
    else await this.page.mouse.click(x, y);
    await this.pause(800);
  }

  async type(target: ReturnType<Page['locator']>, text: string): Promise<void> {
    await this.tap(target);
    // Replace what the field holds (a default such as 250 g), as someone selecting it first would.
    await target.fill('');
    await target.pressSequentially(text, { delay: 90 * PACE });
    await this.pause(900);
  }

  /** Smooth scroll of the page to a position. */
  async scroll(top: number): Promise<void> {
    await this.page.evaluate((to) => window.scrollTo({ top: to, behavior: 'smooth' }), top);
    await this.pause(1100);
  }

  /** Scrolls the page down in steps, a beat after each, as a reader would. */
  async browse(steps: number, distance = 520): Promise<void> {
    for (let step = 0; step < steps; step++) {
      await this.page.evaluate((by) => window.scrollBy({ top: by, behavior: 'smooth' }), distance);
      await this.pause(1300);
    }
  }

  /** Smooth scroll of a scrollable element (a sheet or dialog). */
  async scrollIn(target: ReturnType<Page['locator']>, by: number): Promise<void> {
    await target.evaluate((element, distance) => element.scrollBy({ top: distance, behavior: 'smooth' }), by);
    await this.pause(1100);
  }

  /** A swipe sideways on an element, as a finger would. */
  async swipe(target: ReturnType<Page['locator']>, dx: number): Promise<void> {
    const box = (await target.boundingBox())!;
    const y = box.y + box.height / 2;
    const x = box.x + box.width / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + dx, y, { steps: 12 });
    await this.page.mouse.up();
    await this.pause(900);
  }

  /** Runs an optional beat: a failure is logged, and the recording goes on (the checks are the specs' own). */
  async tryStep(name: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      await this.page.screenshot({ path: join(TMP, `skipped-${name.replace(/\W+/g, '-')}.png`) }).catch(() => undefined);
      await this.page.keyboard.press('Escape').catch(() => undefined);
      await this.page.keyboard.press('Escape').catch(() => undefined);
      console.log(`STEP SKIPPED: ${name}: ${String(error).split('\n').slice(0, 9).join(' | ')}`);
    }
  }
}

interface Fixtures {
  seed: Seeded;
  /** The API of another person, in a session of their own. */
  person: (key: PersonKey) => Promise<Api>;
  /** The API with the page's cookies, signed in as the person (the seeded main account by default). */
  signIn: (key?: PersonKey) => Promise<Api>;
  human: Human;
  recording: Screencast;
  /** Starts the take: waits for a quiet host, opens the route and waits for `ready`; the take shows that page for a moment first. */
  begin: (hash: string, ready: (page: Page) => Promise<unknown>) => Promise<void>;
  /** Ends the take: encodes the recording as `<slug>-iphone-x.mp4` and returns its length in seconds. */
  finish: (slug: string) => Promise<number>;
}

export const test = base.extend<Fixtures>({
  baseURL: async ({}, use) => {
    const url = process.env.GLAZELAB_E2E_BASE_URL;
    if (!url) throw new Error('GLAZELAB_E2E_BASE_URL is unset: run the videos through their config (npm run e2e:videos)');
    await use(url);
  },
  seed: async ({}, use) => {
    await use(JSON.parse(process.env.GLAZELAB_VIDEOS_SEED!) as Seeded);
  },
  person: async ({ playwright, baseURL }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (key) => {
      const context = await playwright.request.newContext({ baseURL });
      contexts.push(context);
      const api = new Api(context);
      await api.signIn(accountOf(key));
      return api;
    });
    await Promise.all(contexts.map((context) => context.dispose()));
  },
  signIn: async ({ page }, use) => {
    await use(async (key = 'me') => {
      const api = new Api(page.request);
      await api.signIn(accountOf(key));
      return api;
    });
  },
  human: async ({ page }, use) => {
    await showPointer(page);
    await use(new Human(page));
  },
  recording: async ({}, use) => {
    await use(new Screencast());
  },
  begin: async ({ page, human, recording }, use) => {
    await use(async (hash, ready) => {
      await waitForQuietHost();
      await page.goto(hash.startsWith('http') ? hash : '/' + hash);
      await ready(page);
      await human.pause(300);
      await recording.start(page);
      // The page is shown still for a moment before anything happens.
      await human.pause(1800);
    });
  },
  finish: async ({ page, recording }, use, testInfo) => {
    await use(async (slug) => {
      await new Human(page).pause(1200);
      mkdirSync(join(VIDEOS, 'raw'), { recursive: true });
      const seconds = await recording.save(join(VIDEOS, `${slug}-iphone-x.mp4`), join(VIDEOS, 'raw', `${slug}-iphone-x.webm`));
      testInfo.annotations.push({ type: 'video', description: `${slug}: ${seconds.toFixed(1)} s` });
      console.log(`VIDEO ${slug}-iphone-x.mp4 ${seconds.toFixed(1)} s`);
      return seconds;
    });
  },
});

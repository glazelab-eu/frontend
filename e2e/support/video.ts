import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { OUTPUT } from './paths';

/**
 * Playwright records video through its own ffmpeg build, which is not installed where the browser is the system Chromium:
 * point the browsers path at a folder whose `ffmpeg` is the system one (libvpx encodes the recording).
 */
export function systemFfmpegAsPlaywrightFfmpeg(): void {
  const system = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((path) => existsSync(path));
  if (!system) throw new Error('The walkthrough needs ffmpeg on the PATH (/usr/bin/ffmpeg)');
  const folder = join(OUTPUT, 'playwright-browsers');
  const directory = join(folder, 'ffmpeg-1013');
  mkdirSync(directory, { recursive: true });
  if (!existsSync(join(directory, 'ffmpeg-linux'))) symlinkSync(system, join(directory, 'ffmpeg-linux'));
  process.env.PLAYWRIGHT_BROWSERS_PATH = folder;
}

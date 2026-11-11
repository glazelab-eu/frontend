import type { Page } from '@playwright/test';

/**
 * Steps a page's fake clock (`page.clock.install()`) past the badge poll's interval (30 s) until `shown` holds. The fake clock fires
 * each timer once per fast-forward, and a poll that starts while a load or a seen request is in flight waits for the next one: under
 * load one step may not be enough, so step on until the page shows the news (a real clock keeps going by itself).
 */
export async function runPollsUntil(page: Page, shown: () => Promise<boolean>) {
  for (let step = 0; step < 6; step += 1) {
    await page.clock.fastForward(31_000);
    for (let wait = 0; wait < 10; wait += 1) {
      if (await shown()) return;
      await page.waitForTimeout(150);
    }
  }
}

/** Steps the fake clock until the badge poll has answered `count` more times (to show that something stays away). */
export async function runPolls(page: Page, count: number) {
  let answered = 0;
  const listener = (response: { url: () => string }) => {
    if (response.url().includes('/api/feed/unread')) answered += 1;
  };
  page.on('response', listener);
  try {
    await runPollsUntil(page, async () => answered >= count);
  } finally {
    page.off('response', listener);
  }
}

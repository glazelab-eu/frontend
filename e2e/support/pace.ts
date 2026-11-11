import type { Locator, Page } from '@playwright/test';

/** Set by the walkthrough command (`npm run e2e:walkthrough`): the run is a screen recording, paced for a human viewer. */
export const RECORDING = process.env.E2E_VIDEO === '1';

/** A small dot that follows the pointer and rings on every press, so a viewer sees what was tapped. */
export async function showPointer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let dot: HTMLElement | undefined;
    let x = -100;
    let y = -100;
    const place = (nextX: number, nextY: number, press: boolean) => {
      if (!dot) {
        dot = document.createElement('div');
        dot.setAttribute('popover', 'manual');
        const style = dot.style;
        style.position = 'fixed';
        style.inset = '0 auto auto 0';
        style.margin = '0';
        style.padding = '0';
        style.border = '0';
        style.width = '30px';
        style.height = '30px';
        style.borderRadius = '50%';
        style.background = 'rgba(40, 40, 40, 0.28)';
        style.boxShadow = '0 0 0 2px rgba(255, 255, 255, 0.95), 0 1px 6px rgba(0, 0, 0, 0.35)';
        style.pointerEvents = 'none';
        style.overflow = 'visible';
        document.documentElement.appendChild(dot);
      }
      // The top layer keeps the dot above open dialogs; showing it again moves it above the newest one.
      if (press) {
        dot.hidePopover();
        dot.showPopover();
      } else if (!dot.matches(':popover-open')) dot.showPopover();
      dot.animate([{ transform: `translate(${x - 15}px, ${y - 15}px)` }, { transform: `translate(${nextX - 15}px, ${nextY - 15}px)` }], {
        duration: 320,
        easing: 'ease-in-out',
        fill: 'forwards',
      });
      x = nextX;
      y = nextY;
      if (press) {
        dot.animate([{ boxShadow: '0 0 0 2px #fff, 0 0 0 2px rgba(20,120,90,0.9)' }, { boxShadow: '0 0 0 2px #fff, 0 0 0 22px rgba(20,120,90,0)' }], {
          duration: 520,
          easing: 'ease-out',
        });
      }
    };
    addEventListener('pointermove', (event) => place(event.clientX, event.clientY, false), true);
    addEventListener('pointerdown', (event) => place(event.clientX, event.clientY, true), true);
  });
}

/**
 * Taps, types, scrolls and waits for a test that is also a recording. Without `E2E_VIDEO=1` every call acts at once (a plain
 * click, a fill, no pause, no scroll), so the same steps stay fast as a test.
 */
export class Pace {
  constructor(private readonly page: Page) {}

  /** Installs the tap indicator; call before the first navigation. */
  async start(): Promise<void> {
    if (RECORDING) await showPointer(this.page);
  }

  /** A beat for the viewer. */
  async pause(milliseconds = 1100): Promise<void> {
    if (RECORDING) await this.page.waitForTimeout(milliseconds);
  }

  /** Moves the pointer to a control, waits a beat, then taps it. */
  async tap(target: Locator): Promise<void> {
    if (RECORDING) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (box) await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await this.pause(380);
    }
    await target.click();
  }

  /** Taps a field and enters the text, key by key in a recording. */
  async type(target: Locator, text: string): Promise<void> {
    await this.tap(target);
    if (RECORDING) await target.pressSequentially(text, { delay: 70 });
    else await target.fill(text);
  }

  async scroll(top: number): Promise<void> {
    if (!RECORDING) return;
    await this.page.evaluate((to) => window.scrollTo({ top: to, behavior: 'smooth' }), top);
    await this.pause(900);
  }
}

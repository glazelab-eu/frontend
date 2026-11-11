import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './test';

type Violation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

/** WCAG 2.0/2.1 level A and AA plus axe's best practices; WCAG 2.2 and AAA rules are out of scope. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

export interface AxeOptions {
  /**
   * CSS selectors to check instead of the whole page. A dialog is checked with `DIALOG`; the page-level rules (landmarks, one
   * h1, a page title) then stay out, as axe runs them on whole documents only.
   */
  include?: string[];
  /**
   * Rules not applied to this check, each with the reason. A rule is never switched off for every page: name the rule and say why
   * the app cannot satisfy it here.
   */
  skip?: Array<{ rule: string; reason: string }>;
  /** Parts of the page not checked (CSS selectors), with the reason; same policy as `skip`. */
  exclude?: Array<{ selector: string; reason: string }>;
}

/** Every open dialog (`ModalShell`); a nested one is checked with the one below it. */
export const DIALOG = '[role="dialog"]';

/** One violation as a short block: rule, impact, help link, and each node's selector with axe's explanation. */
export function describeViolation(violation: Violation): string {
  const nodes = violation.nodes.map((node) => `    ${node.target.join(' >> ')}\n      ${node.failureSummary?.replaceAll('\n', '\n      ')}`);
  return `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.helpUrl}\n${nodes.join('\n')}`;
}

/** Fails with a readable report when axe finds a violation on the page, or in the parts named by `include`. */
export async function expectAccessible(page: Page, options: AxeOptions = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  for (const selector of options.include ?? []) builder = builder.include(selector);
  for (const { selector } of options.exclude ?? []) builder = builder.exclude(selector);
  const skipped = (options.skip ?? []).map(({ rule }) => rule);
  if (skipped.length) builder = builder.disableRules(skipped);
  const { violations, incomplete } = await builder.analyze();
  // What axe could not decide (text over a photo, say) is no failure; the report lists it for a human look.
  for (const result of incomplete) {
    const nodes = result.nodes.map((node) => `${node.target.join(' >> ')} (${node.any[0]?.message ?? node.all[0]?.message ?? ''})`);
    test.info().annotations.push({ type: 'axe-needs-review', description: `${result.id}: ${nodes.join('; ')}` });
  }
  expect(violations.map(describeViolation).join('\n\n'), `${violations.length} accessibility violation(s)`).toBe('');
}

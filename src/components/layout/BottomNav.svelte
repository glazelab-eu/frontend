<script lang="ts">
  import { t } from '../../lib/i18n';
  import { navTabs } from '../../lib/layout/bottom-nav';
  import { scrollTopOnSamePage } from '../../lib/layout/headroom';
  import { routeHref, type Route, type Section } from '../../lib/routing/routes';
  interface Props {
    /** The highlighted entry; null for routes outside the navigation, such as not found. */
    section: Section | null;
    /** The page shown: tapping the entry of this very page brings it to its top. */
    route: Route;
  }
  let { section, route }: Props = $props();
  /** Simple 24 px outline icons, one per entry; decorative, the label names the link. */
  const icons: Record<Section, string> = {
    discover: 'M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z',
    stock: 'M4 20V4M20 20V4M4 9h16M4 20h16M8 9V6h3v3M14 9V7h3v2',
    studio: 'M12 5v14M5 12h14',
    clubs:
      'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  };
</script>

<!-- Fixed to the foot of a phone screen; last in the document, so it is read and tabbed to after the page. -->
<nav
  class="bottom-nav"
  aria-label={$t('nav.label')}>
  {#each navTabs as item (item.id)}
    <a
      class={['bottom-nav__link', { 'bottom-nav__link--active': section === item.id }]}
      aria-current={section === item.id ? 'page' : undefined}
      href={routeHref(item.route)}
      onclick={(event) => scrollTopOnSamePage(event, route, item.route)}>
      <svg
        class="bottom-nav__icon"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true">
        <path d={icons[item.id]} />
      </svg>
      <span class="bottom-nav__label">{$t(item.shortLabel)}</span>
    </a>
  {/each}
</nav>

<style>
  /* The bar covers the foot of the screen: a focused field scrolls clear of it (Studio's sticky bar has its own rule). */
  :global(:root:has(.bottom-nav)) {
    scroll-padding-bottom: var(--bottom-nav-clearance);
  }
  .bottom-nav {
    /* Chrome, not body text: the labels keep their size on touch screens (the clearance is sized for them). */
    --font-xs: 0.75rem;
    position: fixed;
    inset: auto 0 0;
    z-index: var(--z-bottom-nav);
    display: flex;
    padding: 0 var(--safe-right) var(--safe-bottom) var(--safe-left);
    border-top: 0.0625rem solid var(--border);
    background: var(--surface);
  }
  .bottom-nav__link {
    container-type: inline-size;
    flex: 1 1 0;
    min-width: 0;
    min-height: var(--bottom-nav-height);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-0-5);
    padding: var(--space-1) var(--space-1);
    color: var(--muted);
    text-decoration: none;
    font-size: var(--font-xs);
    font-weight: 600;
  }
  .bottom-nav__link--active {
    background: var(--sage);
    color: var(--ink);
  }
  .bottom-nav__icon {
    flex: none;
  }
  /* At a large text size a label wraps (even inside a word) rather than getting cut off, and gives way in size when the column is too narrow
     for two lines (320 px wide at 200 %), so the bar never outgrows the clearance. `cqw` needs Firefox 110+ (or a current Chromium or
     Safari); older browsers drop the declaration and keep the label at its full size. */
  .bottom-nav__label {
    max-width: 100%;
    font-size: min(var(--font-xs), 28cqw);
    line-height: 1.15;
    text-align: center;
    overflow-wrap: anywhere;
    hyphens: auto;
  }
</style>

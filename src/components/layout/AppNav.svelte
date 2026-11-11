<script lang="ts">
  import type { BuddyCode } from '../buddies/buddy-actions';
  import { t } from '../../lib/i18n';
  import { navTabs } from '../../lib/layout/bottom-nav';
  import { scrollTopOnSamePage, watchHeader } from '../../lib/layout/headroom';
  import HeaderAccount from './HeaderAccount.svelte';
  import type { User } from '../../lib/api/models';
  import type { ScannedLink } from '../../lib/scan/scanned-link';
  import type { SignOutRequest } from '../../lib/layout/sign-out-focus';
  import { home, routeHref, type Route, type Section } from '../../lib/routing/routes';
  interface Props {
    /** The highlighted entry; null for routes outside the navigation, such as not found. */
    section: Section | null;
    user: User | null;
    online: boolean;
    onSignIn: () => void;
    onLogout: () => void;
    installed: boolean;
    onInstall: () => void;
    /** Activating the offline icon (shown only while offline): the app shows its offline toast. */
    onOffline: () => void;
    /** Below 720 px: one row (brand, offline icon, install, account); the entries live in the bottom navigation. */
    phone: boolean;
    /** The page shown: the account control marks the account page as current. */
    route: Route;
    signOutRequest: SignOutRequest;
    /** Buddy requests waiting for an answer: the account control mentions them in one line of text (never a dot or badge). */
    buddyRequests: number;
    buddyCode: BuddyCode;
    /** Opens the route of a code scanned in the phone account menu. */
    onScan: (link: ScannedLink) => void;
    /** Opens the feedback dialog (signed-in accounts only). */
    onFeedback: () => void;
  }
  let {
    section,
    user,
    online,
    onSignIn,
    onLogout,
    installed,
    onInstall,
    onOffline,
    phone,
    route,
    signOutRequest,
    buddyRequests,
    buddyCode,
    onScan,
    onFeedback,
  }: Props = $props();
  /** Slid out of view while the page scrolls down (under 70em only, in the CSS); see `watchHeader`. */
  let hidden = $state(false);
  const followScroll = (node: HTMLElement) => watchHeader(node, (now) => (hidden = now));
</script>

<header
  class={['app-nav', { 'app-nav--hidden': hidden }]}
  {@attach followScroll}>
  <div class="app-nav__inner">
    <a
      class="app-nav__brand"
      href={routeHref(home)}
      onclick={(event) => scrollTopOnSamePage(event, route, home)}
      aria-label={$t('nav.home')}>
      <img
        class="app-nav__logo"
        src="/icon.svg"
        alt=""
        width="38"
        height="38" />
      <span>{$t('nav.brand')}</span>
    </a>
    {#if !phone}
      <nav
        class="app-nav__links"
        aria-label={$t('nav.label')}>
        {#each navTabs as item (item.id)}
          <a
            class={['app-nav__link', { 'app-nav__link--active': section === item.id }]}
            aria-current={section === item.id ? 'page' : undefined}
            href={routeHref(item.route)}
            onclick={(event) => scrollTopOnSamePage(event, route, item.route)}>
            {$t(item.label)}
          </a>
        {/each}
      </nav>
    {/if}
    <HeaderAccount
      {phone}
      {route}
      {signOutRequest}
      {buddyRequests}
      {buddyCode}
      {onScan}
      {onFeedback}
      {user}
      {online}
      {onSignIn}
      {onLogout}
      {installed}
      {onInstall}
      {onOffline} />
  </div>
</header>

<style>
  /* The background is the installed app's theme colour (scripts/theme-color.ts reads this token); the top padding keeps the content below a
     status bar or cutout the page extends under (0 in a browser tab and with the default iOS status bar). */
  .app-nav {
    /* Sticky: Explore's top, the account and the entries are one tap away however far the page has scrolled. It stays in the flow, so
       nothing moves when it slides away; popups and toasts are above it, dialogs too (--z-*). */
    position: sticky;
    top: 0;
    z-index: var(--z-header);
    background: var(--surface);
    padding-top: var(--safe-top);
    border-bottom: 0.0625rem solid var(--border);
  }
  .app-nav__inner {
    max-width: 77.5rem;
    margin: auto;
    padding: var(--space-4) var(--space-8);
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }
  .app-nav__brand {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    text-decoration: none;
    font-size: var(--font-xl);
    font-weight: 650;
    letter-spacing: -0.04375rem;
  }
  .app-nav__logo {
    border-radius: var(--radius-md);
  }
  /* The entries sit right after the brand and the account area takes the rest (no space-between), so what appears or disappears on the
     right (the offline icon, the buddy request line) cannot move them; below 70em the entries have their own row. */
  .app-nav__links {
    display: flex;
    flex: none;
    margin-right: auto;
    gap: var(--space-1-5);
  }
  .app-nav__link {
    border: 0;
    border-radius: var(--radius-md);
    padding: var(--space-2-5) var(--space-4);
    background: transparent;
    color: var(--muted);
    text-decoration: none;
    text-align: center;
    font-size: var(--font-base);
    font-weight: 550;
    white-space: nowrap;
  }
  .app-nav__link:hover {
    background: var(--canvas);
    color: var(--ink);
  }
  .app-nav__link--active {
    background: var(--sage);
    color: var(--ink);
  }
  /* Between the two-row and the full-width header the entries are tighter, so a long name, the offline icon and the request line keep one row. */
  @media (70em <= width < 80em) {
    .app-nav__link {
      padding-inline: var(--space-3);
    }
  }
  @media (width < 70em) {
    /* The tall header (the entries have their own row; a phone's top bar and bottom navigation take 15% of the screen, a landscape phone's
       header 37%) slides out while the page scrolls down and returns on the way up, or when focus enters it (`watchHeader`). From 70em it
       is 9% of a laptop screen and stays. `--header-offset` tells what is sticky below it where its top edge is. */
    .app-nav--hidden {
      transform: translateY(-100%);
    }
    /* A page printed while the header was slid away keeps its header (a print page is under 70em wide). */
    @media print {
      .app-nav--hidden {
        transform: none;
      }
    }
    @media (prefers-reduced-motion: no-preference) {
      .app-nav {
        transition: transform 0.2s ease;
      }
    }
    .app-nav__inner {
      flex-wrap: wrap;
    }
    .app-nav__brand {
      margin-right: auto;
    }
    .app-nav__links {
      order: 3;
      margin-right: 0;
      width: 100%;
      justify-content: center;
      flex-wrap: wrap;
    }
  }
  @media (width < 45em) {
    .app-nav__inner {
      flex-wrap: nowrap;
      padding: var(--space-3) var(--space-4);
      gap: var(--space-3);
    }
    .app-nav__brand {
      font-size: var(--font-lg);
    }
  }
  /* The narrowest phones: the bar also holds the activity bell (FEED-1), so the wordmark and the gaps give a little. */
  @media (width < 24em) {
    .app-nav__inner {
      gap: var(--space-1-5);
    }
    .app-nav__brand {
      gap: var(--space-1);
      font-size: var(--font-xs);
    }
  }
  @media (pointer: coarse) {
    .app-nav__brand {
      min-height: var(--touch-target);
    }
    .app-nav__links {
      gap: var(--space-2);
    }
  }
</style>

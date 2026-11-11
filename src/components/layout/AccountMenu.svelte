<script lang="ts">
  import { t } from '../../lib/i18n';
  import LanguageSelect from './LanguageSelect.svelte';
  import Avatar from '../avatars/Avatar.svelte';
  import { routeHref, type Route } from '../../lib/routing/routes';
  import type { User } from '../../lib/api/models';
  import type { ScannedLink } from '../../lib/scan/scanned-link';
  import LinkScanner from '../scanning/LinkScanner.svelte';
  import BuddyCodeDialog from '../buddies/BuddyCodeDialog.svelte';
  import type { BuddyCode } from '../buddies/buddy-actions';
  interface Props {
    user: User;
    /** The page shown: the Account entry is marked as current there. */
    route: Route;
    /** Buddy requests waiting for an answer: one quiet line of text in the panel, none on the button (no dot or badge). */
    buddyRequests: number;
    /** "Show my buddy code": the buddy link and its actions. */
    buddyCode: BuddyCode;
    /** Opens the route of an accepted scanned code (a buddy link or a club invitation). */
    onScan: (link: ScannedLink) => void;
    /** "Send feedback": the panel closes with the focus on the menu button, which the dialog gives it back to. */
    onFeedback: () => void;
    onLogout: () => void;
  }
  let { user, route, buddyRequests, buddyCode, onScan, onFeedback, onLogout }: Props = $props();
  const id = $props.id();
  let open = $state(false);
  let scanning = $state(false);
  let showingCode = $state(false);
  let root = $state<HTMLElement>();
  let trigger = $state<HTMLButtonElement>();

  function close(restoreFocus: boolean) {
    open = false;
    if (restoreFocus) trigger?.focus();
  }

  $effect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!root?.contains(event.target as Node)) close(false);
    };
    const leave = () => close(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('focusin', outside);
    window.addEventListener('keydown', escape);
    window.addEventListener('hashchange', leave);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('focusin', outside);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('hashchange', leave);
    };
  });
</script>

<!-- A disclosure, not a menu role: it holds the name, the connection state when it is lost, the Account page, the language and Sign out, reached with Tab in this order. -->
<div
  class="account-menu"
  bind:this={root}>
  <button
    type="button"
    class="account-menu__button"
    bind:this={trigger}
    aria-label={$t('header.accountMenu', { values: { name: user.displayName } })}
    aria-expanded={open}
    aria-controls={open ? `${id}-panel` : undefined}
    onclick={() => (open = !open)}>
    <Avatar
      avatarId={user.avatarId}
      name={user.displayName}
      viewerId={user.id}
      size="fill" />
  </button>
  {#if open}
    <div
      class="account-menu__panel"
      id="{id}-panel">
      <p class="account-menu__name">{user.displayName}</p>
      <a
        class="account-menu__link"
        href={routeHref({ name: 'account' })}
        aria-current={route.name === 'account' ? 'page' : undefined}
        onclick={() => close(true)}>
        {$t('account.page.title')}
      </a>
      {#if buddyRequests > 0}
        <a
          class="account-menu__requests"
          href={routeHref({ name: 'account' })}
          onclick={() => close(true)}>
          {$t('buddies.requestCount', { values: { count: buddyRequests } })}
        </a>
      {/if}
      <button
        type="button"
        class="account-menu__scan"
        onclick={() => {
          // The panel closes with the focus on the menu button, which the scanner then gives it back to.
          close(true);
          scanning = true;
        }}>
        {$t('header.scan')}
      </button>
      <button
        type="button"
        class="account-menu__scan"
        onclick={() => {
          close(true);
          showingCode = true;
        }}>
        {$t('header.buddyCode')}
      </button>
      <button
        type="button"
        class="account-menu__scan"
        onclick={() => {
          close(true);
          onFeedback();
        }}>
        {$t('feedback.open')}
      </button>
      <label class="account-menu__row">
        <span>{$t('language.label')}</span>
        <LanguageSelect />
      </label>
      <button
        type="button"
        class="account-menu__sign-out"
        onclick={() => {
          close(false);
          onLogout();
        }}>
        {$t('header.signOut')}
      </button>
    </div>
  {/if}
  {#if showingCode}
    <BuddyCodeDialog
      {...buddyCode}
      onClose={() => (showingCode = false)} />
  {/if}
  {#if scanning}
    <LinkScanner
      label={$t('links.scanner.title')}
      refusal={$t('links.scanner.refused')}
      kinds={['buddy', 'invite']}
      onOpen={onScan}
      onClose={() => (scanning = false)} />
  {/if}
</div>

<style>
  .account-menu {
    position: relative;
    flex: none;
  }
  .account-menu__button {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border: 0.0625rem solid var(--control-border);
    border-radius: var(--radius-pill);
    overflow: hidden;
    background: var(--sage);
    color: var(--ink);
    font-size: var(--font-base);
    font-weight: 700;
  }
  .account-menu__panel {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: var(--z-popup);
    display: grid;
    gap: var(--space-2);
    width: max-content;
    min-width: 13rem;
    max-width: min(20rem, calc(100vw - var(--space-8)));
    margin-top: var(--space-2);
    padding: var(--space-3);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    background: var(--paper);
    box-shadow: 0 0.5rem 1.5rem var(--shadow-color);
  }
  .account-menu__name {
    margin: 0;
    overflow-wrap: anywhere;
    font-weight: 650;
  }
  .account-menu__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .account-menu__link,
  .account-menu__scan,
  .account-menu__sign-out {
    min-height: var(--touch-target);
    padding: var(--space-2) var(--space-3);
    border: 0.0625rem solid var(--control-border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--accent);
    font-weight: 600;
    text-align: start;
    text-decoration: none;
  }
  /* One line of muted text, underlined as the link it is; as tall as a touch target on touch screens. */
  .account-menu__requests {
    color: var(--muted);
    font-size: var(--font-sm);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .account-menu__link {
    display: flex;
    align-items: center;
  }
  .account-menu__link[aria-current='page'] {
    background: var(--sage);
  }
  @media (pointer: coarse) {
    .account-menu__button {
      width: var(--touch-target);
      height: var(--touch-target);
    }
    .account-menu__requests {
      display: flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

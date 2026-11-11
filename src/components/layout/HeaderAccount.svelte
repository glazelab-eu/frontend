<script lang="ts">
  import type { BuddyCode } from '../buddies/buddy-actions';
  import Icon from '../ui/Icon.svelte';
  import { tick } from 'svelte';
  import { BACK_ONLINE_MS } from '../../lib/offline/grace';
  import { t } from '../../lib/i18n';
  import { firstName } from '../../lib/layout/first-name';
  import { focusSignInAfterSignOut, type SignOutRequest } from '../../lib/layout/sign-out-focus';
  import { routeHref, type Route } from '../../lib/routing/routes';
  import Avatar from '../avatars/Avatar.svelte';
  import AccountMenu from './AccountMenu.svelte';
  import FeedBell from './FeedBell.svelte';
  import LanguageSelect from './LanguageSelect.svelte';
  import type { User } from '../../lib/api/models';
  import type { ScannedLink } from '../../lib/scan/scanned-link';
  interface Props {
    user: User | null;
    online: boolean;
    onSignIn: () => void;
    onLogout: () => void;
    installed: boolean;
    onInstall: () => void;
    /** Activating the offline icon: the app shows its offline toast. */
    onOffline: () => void;
    /** Below 720 px: the offline icon, the install icon and one account control; the language select is in the account menu (signed in) or the footer. */
    phone: boolean;
    /** The page shown: the name links to the account page and marks it as current there. */
    route: Route;
    /** Pressed by every Sign out button of the app (this header's, the phone menu's, the account page's), read once the session has ended. */
    signOutRequest: SignOutRequest;
    /**
     * Buddy requests waiting for an answer: the phone account menu's quiet line; on wide screens the bell shows them (FEED-1: the
     * bell replaced the wide header's request line, whose room it needs in the one-row header).
     */
    buddyRequests: number;
    buddyCode: BuddyCode;
    /** Opens the route of a code scanned in the phone account menu. */
    onScan: (link: ScannedLink) => void;
    /** Opens the feedback dialog: an entry of the phone account menu, an icon button before the bell on wide screens. */
    onFeedback: () => void;
  }
  let { user, online, onSignIn, onLogout, installed, onInstall, onOffline, phone, route, signOutRequest, buddyRequests, buddyCode, onScan, onFeedback }: Props =
    $props();
  let signIn = $state<HTMLButtonElement>();
  let hadUser: boolean | undefined;
  let nameBox = $state<HTMLElement>();
  let nameFull = $state<HTMLElement>();
  let clipped = $state(false);
  let name = $derived(user?.displayName ?? '');
  /** True for a few seconds after the connection returns: screen readers hear "Back online" from the status region, nothing is shown. */
  let backOnline = $state(false);
  let wasOnline = true;
  let backOnlineTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const now = online;
    const was = wasOnline;
    wasOnline = now;
    if (now === was) return;
    clearTimeout(backOnlineTimer);
    backOnline = now;
    if (now) backOnlineTimer = setTimeout(() => (backOnline = false), BACK_ONLINE_MS);
  });
  $effect(() => () => clearTimeout(backOnlineTimer));

  /** The name is shortened to its first word only while the whole name does not fit the fixed width; a name that fits stays whole. */
  $effect(() => {
    const box = nameBox;
    const full = nameFull;
    if (!box || !full) return;
    const measure = () => (clipped = Math.ceil(full.getBoundingClientRect().width) > box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(full);
    return () => observer.disconnect();
  });

  /** After Sign out the menu and its button are gone and focus would fall to the page: it goes to the Sign in button instead. */
  $effect(() => {
    const had = hadUser;
    const has = !!user;
    hadUser = has;
    if (had === has) return;
    const requested = signOutRequest.consume();
    if (had !== true || has) return;
    void tick().then(() => {
      if (focusSignInAfterSignOut(requested, had, has, document.activeElement, document.body)) signIn?.focus();
    });
  });
</script>

{#snippet installButton()}
  <button
    class={['icon-button', 'icon-button--quiet', 'header-account__install', { 'header-account__hidden': installed }]}
    inert={installed}
    aria-label={$t('install.action')}
    title={$t('install.action')}
    onclick={onInstall}>
    <Icon name="install" />
  </button>
{/snippet}
<!-- Silent while connected. A lost connection is one icon button (a shape, never colour alone) at the start of the account area, so it moves nothing
     that is there; it opens the offline toast and is the only offline indicator. The live region stays in the page so the change is announced, and
     its text is for screen readers only. -->
{#snippet connection()}
  <span
    class="header-account__connection"
    role="status">
    {#if !online}
      <span class="visually-hidden header-account__announce">{$t('header.offline')}</span>
    {:else if backOnline}
      <span class="visually-hidden header-account__announce">{$t('header.backOnline')}</span>
    {/if}
  </span>
  {#if !online}
    <button
      type="button"
      class="icon-button icon-button--quiet header-account__offline"
      data-offline-icon
      aria-label={$t('header.offline')}
      title={$t('header.offlineSaved')}
      onclick={onOffline}>
      <Icon name="offline" />
    </button>
  {/if}
{/snippet}

{#if phone}
  <div class="header-account">
    {@render connection()}
    {#if !installed}
      {@render installButton()}
    {/if}
    {#if user}
      <FeedBell
        count={user.feedUnread}
        requests={buddyRequests}
        current={route.name === 'activity'} />
      <AccountMenu
        {user}
        {route}
        {buddyRequests}
        {buddyCode}
        {onScan}
        {onFeedback}
        {onLogout} />
    {:else}
      <button
        class="header-account__button"
        bind:this={signIn}
        onclick={onSignIn}>
        {$t('common.signIn')}
      </button>
    {/if}
  </div>
{:else}
  <div class="header-account">
    {@render connection()}
    <LanguageSelect />
    {@render installButton()}
    {#if user}
      <!-- Feedback (FEEDBACK-1): in the header row, never over the page; as narrow as the bell, and left out where the one-row budget has no room (see the style). -->
      <button
        type="button"
        class="icon-button icon-button--quiet header-account__feedback"
        aria-label={$t('feedback.open')}
        title={$t('feedback.open')}
        onclick={onFeedback}>
        <Icon name="feedback" />
      </button>
      <FeedBell
        count={user.feedUnread}
        requests={buddyRequests}
        current={route.name === 'activity'} />
    {/if}
    <div class="header-account__session">
      <div
        class={['header-account__identity', { 'header-account__hidden': !user }]}
        inert={!user}>
        {#if user}
          <!-- Only where the one-row budget has room (from 80em, see the style): a hidden picture is never fetched either. -->
          <span class="header-account__picture">
            <Avatar
              avatarId={user.avatarId}
              name={user.displayName}
              viewerId={user.id}
              size="sm" />
          </span>
        {/if}
        <a
          class="header-account__name"
          href={routeHref({ name: 'account' })}
          aria-label={$t('header.accountLink', { values: { name } })}
          aria-current={route.name === 'account' ? 'page' : undefined}
          bind:this={nameBox}
          title={clipped ? name : undefined}>
          <span
            class="header-account__measure"
            bind:this={nameFull}
            aria-hidden="true">
            {name}
          </span>
          <span aria-hidden={clipped || undefined}>{clipped ? firstName(name) : name}</span>
          {#if clipped}
            <span class="visually-hidden">{name}</span>
          {/if}
        </a>
        <button
          class="header-account__button"
          onclick={onLogout}>
          {$t('header.signOut')}
        </button>
      </div>
      <div
        class={['header-account__identity', { 'header-account__hidden': !!user }]}
        inert={!!user}>
        <button
          class="header-account__button"
          bind:this={signIn}
          onclick={onSignIn}>
          {$t('common.signInOrJoin')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .header-account {
    display: flex;
    align-items: center;
    justify-content: end;
    flex: 1 1 0;
    gap: var(--space-3);
    min-width: 0;
    font-size: var(--font-sm);
  }
  .header-account > :not(.header-account__session) {
    flex: none;
  }
  .header-account__session {
    display: grid;
  }
  .header-account__identity {
    grid-area: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: end;
    gap: var(--space-3);
  }
  .header-account__identity > :not(.header-account__name) {
    flex: none;
  }
  .header-account__hidden {
    visibility: hidden;
    pointer-events: none;
  }
  /* The live region takes no room (its text is clipped), and the icon is the first item of the area, which ends at the right edge: a header
     with the icon is exactly as wide as before, so nothing that was there moves. */
  .header-account__connection {
    display: contents;
  }
  /* The header row is tight: 36 px with a fine pointer, the touch size below. */
  .header-account__install,
  .header-account__offline {
    --icon-size: 1.25rem;
    width: var(--space-9);
    height: var(--space-9);
  }
  /* 28 px with a fine pointer (the tightest one-row case, pt-PT at 1280 px with the picture, the offline icon and a request count, has
     no room for more), the touch size below. */
  .header-account__feedback {
    --icon-size: 1.25rem;
    width: 1.75rem;
    height: var(--space-9);
  }
  /* The one-row header from 70em has no room for it below 80em in de/es/pt-PT (header-still.spec.ts): there the Account page's
     Feedback section and the footer offer it; a hidden button is out of the tab order too. */
  @media (70em <= width < 80em) {
    .header-account__feedback {
      display: none;
    }
  }
  .header-account__offline {
    border-radius: var(--radius-pill);
    background: var(--warning-bg);
    color: var(--warning-ink);
  }
  @media (width < 80em) {
    .header-account {
      gap: var(--space-2);
    }
    .header-account__picture {
      display: none;
    }
  }
  .header-account__name {
    position: relative;
    flex: 0 1 6rem;
    min-width: 2.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--accent);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .header-account__name[aria-current='page'] {
    text-decoration-thickness: 0.125rem;
  }
  .header-account__measure {
    position: absolute;
    width: max-content;
    visibility: hidden;
    white-space: nowrap;
  }
  .header-account__button {
    border: 0;
    padding: var(--space-2) 0;
    color: var(--accent);
    background: none;
    font-weight: 600;
  }
  @media (width < 45em) {
    .header-account {
      gap: var(--space-2);
    }
    .header-account__button {
      white-space: nowrap;
    }
  }
  /* The narrowest phones: brand, offline icon, install icon, the activity bell and the account control share 288 px. */
  @media (width < 24em) {
    .header-account {
      gap: var(--space-1);
    }
  }
  @media (pointer: coarse) {
    .header-account__install,
    .header-account__offline,
    .header-account__feedback,
    .header-account__button {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
    .header-account__button {
      padding-inline: var(--space-2);
    }
    /* One line as tall as the target keeps the ellipsis (a flex box would lose it). */
    .header-account__name {
      min-width: var(--touch-target);
      line-height: var(--touch-target);
    }
  }
</style>

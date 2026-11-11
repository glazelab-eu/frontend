<script lang="ts">
  import { t } from '../../lib/i18n';
  import SectionNav from '../../components/ui/SectionNav.svelte';
  import AccountSection from '../../components/account/AccountSection.svelte';
  import ProfilePicture from '../../components/avatars/ProfilePicture.svelte';
  import BuddiesSection from '../../components/buddies/BuddiesSection.svelte';
  import type { BuddyActions } from '../../components/buddies/buddy-actions';
  import DiagnosticsSection from '../../components/account/DiagnosticsSection.svelte';
  import FeedSection from '../../components/account/FeedSection.svelte';
  import PhotoSuggestionsSection from '../../components/account/PhotoSuggestionsSection.svelte';
  import SimilarLooksSection from '../../components/account/SimilarLooksSection.svelte';
  import type { SimilarLooks } from '../../state/vision/similar-looks';
  import OfflineNote from '../../components/common/OfflineNote.svelte';
  import PageHead from '../../components/ui/PageHead.svelte';
  import SignInEmpty from '../../components/auth/SignInEmpty.svelte';
  import RouteStatus from '../../components/routing/RouteStatus.svelte';
  import type { AppController } from '../../state/app/app-controller';
  import type { PhotoSuggestions } from '../../state/vision/photo-suggestions';
  import { formErrorFor } from '../../state/app/app-state';
  import { isLoading, progressOf } from '../../lib/sync/lifecycle';
  import type { AccountSection as LinkedSection } from '../../lib/routing/routes';
  import { createJumpGuard, jumpToSection } from '../../components/ui/section-jump';
  import { tick } from 'svelte';

  interface Props {
    app: AppController;
    /** The optional on-device tag suggestions of this device (33-1). */
    suggestions: PhotoSuggestions;
    /** The similar looks of this device and account (33-2). */
    similar: SimilarLooks;
    /** Signs out (App presses the sign-out request first, so focus lands on Sign in afterwards). */
    onSignOut: () => void;
    /** Opens the feedback dialog (App keeps the opener for the focus). */
    onFeedback: () => void;
    /** The part the link opens at (`#/account?section=…`, the Explore intro card's steps). */
    section?: LinkedSection;
  }

  let { app, suggestions, similar, onSignOut, onFeedback, section }: Props = $props();

  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  // Primitives, so the lists are read again when the account or the connection changes, not with every store update.
  let account = $derived(user?.id);
  $effect(() => {
    if (account && online) void app.reloadBuddies();
  });
  /** The page element of each linked part and the controls that must be on the screen with its heading (the picture's under the profile). */
  const sectionIds: Record<LinkedSection, { id: string; reveal: string }> = {
    picture: { id: 'account-profile', reveal: 'account-picture' },
    diagnostics: { id: 'account-diagnostics', reveal: 'account-diagnostics' },
  };
  /** Each arrival at a linked part jumps once: a reload of the account (a new `user` object) does not move the page again. */
  const jumpGuard = createJumpGuard<LinkedSection>();
  $effect(() => {
    const target = jumpGuard(!!account, section);
    if (target) void tick().then(() => jumpToSection(sectionIds[target].id, sectionIds[target].reveal));
  });
  const buddyActions: BuddyActions = $derived({
    accept: app.acceptBuddy,
    decline: app.declineBuddy,
    cancel: app.cancelBuddyRequest,
    remove: app.removeBuddy,
    createLink: app.createBuddyLink,
    currentLink: app.buddyLink,
    copyLink: app.copyLink,
    shareLink: app.shareUrl,
  });
</script>

<PageHead
  eyebrow={$t('account.page.eyebrow')}
  title={$t('account.page.title')}
  description={$t('account.page.intro')} />
{#if user}
  <!-- One column of sections, each with its own h2: a feature adds its own here (Buddies). -->
  <div class="account-page">
    <SectionNav
      label={$t('common.onThisPage')}
      items={[
        { id: 'account-profile', label: $t('account.page.profile.title') },
        { id: 'account-security', label: $t('account.page.security') },
        { id: 'account-buddies', label: $t('buddies.title') },
        { id: 'account-feed', label: $t('account.feed.title') },
        { id: 'account-device', label: $t('account.page.device') },
        { id: 'account-session', label: $t('account.page.session.short') },
      ]} />
    <div
      id="account-profile"
      class="account-page__section">
      <AccountSection title={$t('account.page.profile.title')}>
        <dl class="account-page__profile">
          <dt>{$t('account.page.profile.name')}</dt>
          <dd>{user.displayName}</dd>
          <dt>{$t('account.page.profile.email')}</dt>
          <dd>{user.email}</dd>
        </dl>
        <p class="account-page__text">{$t('account.page.profile.note')}</p>
        <div id="account-picture">
          <ProfilePicture
            {user}
            {online}
            error={formErrorFor($appStore, 'avatar')}
            onUpload={app.uploadAvatar}
            onRemove={app.removeAvatar}
            onClearError={app.clearFormError} />
        </div>
      </AccountSection>
    </div>
    <div
      id="account-security"
      class="account-page__section">
      <AccountSection title={$t('account.page.password.title')}>
        <p class="account-page__text">{$t('account.page.password.body')}</p>
        <OfflineNote
          {online}
          message={$t('account.page.password.offline')} />
        <button
          type="button"
          class="button"
          disabled={!online}
          onclick={app.openPasswordChange}>
          {$t('account.password.title')}
        </button>
      </AccountSection>
    </div>
    <div
      id="account-buddies"
      class="account-page__section">
      <BuddiesSection
        buddies={$appStore.buddies}
        {online}
        error={formErrorFor($appStore, 'buddies')}
        linkError={formErrorFor($appStore, 'buddy-link')}
        actions={buddyActions}
        viewerId={user.id}
        reportError={formErrorFor($appStore, 'avatar-report')}
        onReportAvatar={app.reportAvatar}
        onScan={(link) => app.navigate(link)} />
    </div>
    <div
      id="account-feed"
      class="account-page__section">
      <FeedSection
        buddies={user.feedBuddies}
        clubs={user.feedClubs}
        {online}
        error={formErrorFor($appStore, 'feed-settings')}
        onChange={app.chooseFeed} />
    </div>
    <div
      id="account-device"
      class="account-page__section">
      <PhotoSuggestionsSection
        {suggestions}
        {online} />
      <SimilarLooksSection
        {similar}
        {suggestions} />
      <div
        id="account-diagnostics"
        class="account-page__section">
        <DiagnosticsSection
          enabled={user.diagnosticsOptIn}
          {online}
          error={formErrorFor($appStore, 'diagnostics')}
          onChange={app.chooseDiagnostics} />
      </div>
      <AccountSection title={$t('feedback.title')}>
        <p class="account-page__text">{$t('account.page.feedback.body')}</p>
        <button
          type="button"
          class="button"
          onclick={onFeedback}>
          {$t('feedback.open')}
        </button>
      </AccountSection>
    </div>
    <div
      id="account-session"
      class="account-page__section">
      <AccountSection title={$t('account.page.session.title')}>
        <p class="account-page__text">{$t('account.page.session.body')}</p>
        <button
          type="button"
          class="button"
          onclick={onSignOut}>
          {$t('header.signOut')}
        </button>
      </AccountSection>
      <AccountSection title={$t('account.delete.title')}>
        <p class="account-page__text">{$t('account.page.delete.body')}</p>
        <OfflineNote
          {online}
          message={$t('account.page.delete.offline')} />
        <button
          type="button"
          class="button account-page__delete"
          disabled={!online}
          onclick={app.openAccountDeletion}>
          {$t('account.delete.title')}
        </button>
      </AccountSection>
    </div>
  </div>
{:else if isLoading($appStore.sync)}
  <RouteStatus
    status="loading"
    progress={progressOf($appStore.sync)} />
{:else}
  <SignInEmpty
    title={$t('account.page.signIn')}
    onSignIn={app.openAuth} />
{/if}

<style>
  .account-page {
    max-width: 40rem;
  }
  .account-page__section {
    scroll-margin-top: calc(var(--header-height) + var(--space-4));
  }
  .account-page__text {
    margin: 0 0 var(--space-4);
    color: var(--muted);
    font-size: var(--font-base);
    line-height: 1.6;
  }
  .account-page__profile {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-2) var(--space-5);
    margin: 0 0 var(--space-4);
  }
  .account-page__profile dt {
    color: var(--muted);
  }
  .account-page__profile dd {
    margin: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  /* The opener of a destructive dialog stays an outlined button, in danger ink (as the combination page's Delete). */
  .account-page__delete {
    color: var(--danger-ink);
    border-color: var(--danger-ink);
  }
  @media (width < 45em) {
    .account-page__profile {
      grid-template-columns: 1fr;
      gap: 0;
    }
    .account-page__profile dd {
      margin-bottom: var(--space-3);
    }
  }
</style>

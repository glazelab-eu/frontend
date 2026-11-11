<svelte:options runes={true} />

<script lang="ts">
  import { t, locale, initializeLocale, errorText, onLocaleFailure } from './lib/i18n';
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { createAppController } from './state/app/app-controller';
  import DiscoverPage from './pages/catalog/DiscoverPage.svelte';
  import LeaveDialog from './components/layout/LeaveDialog.svelte';
  import TermsPage from './pages/account/TermsPage.svelte';
  import AboutPage from './pages/about/AboutPage.svelte';
  import StockPage from './pages/stock/StockPage.svelte';
  import StudioPage from './pages/studio/StudioPage.svelte';
  import ClubsPage from './pages/clubs/ClubsPage.svelte';
  import GlazePage from './pages/catalog/GlazePage.svelte';
  import CombinationPage from './pages/catalog/CombinationPage.svelte';
  import ClubPage from './pages/clubs/ClubPage.svelte';
  import AccountPage from './pages/account/AccountPage.svelte';
  import ActivityPage from './pages/activity/ActivityPage.svelte';
  import RouteStatus from './components/routing/RouteStatus.svelte';
  import { requestCount } from './lib/buddies/buddies';
  import { home, isTokenRoute, routeKey, routeSection, routeHref, type Route } from './lib/routing/routes';
  import AppNav from './components/layout/AppNav.svelte';
  import Icon from './components/ui/Icon.svelte';
  import { labels } from './components/ui/labels';
  import BottomNav from './components/layout/BottomNav.svelte';
  import LanguageSelect from './components/layout/LanguageSelect.svelte';
  import { bottomNavVisible, studioBarSticky } from './lib/layout/bottom-nav';
  import { createSignOutRequest } from './lib/layout/sign-out-focus';
  import { isPhone, phoneMedia } from './lib/layout/viewport';
  import AuthDialog from './components/auth/AuthDialog.svelte';
  import AccountLink from './components/auth/AccountLink.svelte';
  import ClubInvite from './components/clubs/ClubInvite.svelte';
  import BuddyRequest from './components/buddies/BuddyRequest.svelte';
  import InstallPrompt from './components/layout/InstallPrompt.svelte';
  import UpdateNotice from './components/layout/UpdateNotice.svelte';
  import { createOfflineToast } from './lib/offline/offline-toast';
  import { createInstallController } from './lib/pwa/install';
  import { createPhotoSuggestions } from './state/vision/photo-suggestions';
  import { createSimilarLooks } from './state/vision/similar-looks';
  import { provideSimilar } from './state/vision/similar-context';
  import { derived } from 'svelte/store';
  import { countTags, tagsOf } from './lib/tags/tags';
  import { isLoading } from './lib/sync/lifecycle';
  import { createUpdateController, registerWorker, waitingVersion } from './lib/pwa/update';
  import AdminPage from './pages/admin/AdminPage.svelte';
  import ImageDeletionsPage from './pages/admin/ImageDeletionsPage.svelte';
  import ImageReportsPage from './pages/admin/ImageReportsPage.svelte';
  import AvatarReportsPage from './pages/admin/AvatarReportsPage.svelte';
  import BansPage from './pages/admin/BansPage.svelte';
  import UsersPage from './pages/admin/UsersPage.svelte';
  import ErrorReportsPage from './pages/admin/ErrorReportsPage.svelte';
  import FeedbackAdminPage from './pages/admin/FeedbackAdminPage.svelte';
  import RemoveImageDialog from './components/images/RemoveImageDialog.svelte';
  import UploadDialog from './components/images/UploadDialog.svelte';
  import TermsDialog from './components/legal/TermsDialog.svelte';
  import { termsPending, type FormName, formErrorFor } from './state/app/app-state';
  import type { BuddyCode } from './components/buddies/buddy-actions';
  import { removalDescription } from './lib/images/pictures';
  import { uploadAudience } from './lib/images/photo-audience';
  import DeleteAccountDialog from './components/account/DeleteAccountDialog.svelte';
  import ChangePasswordDialog from './components/account/ChangePasswordDialog.svelte';
  import OperatorContact from './components/legal/OperatorContact.svelte';
  import SourceLinks from './components/legal/SourceLinks.svelte';
  import FeedbackDialog from './components/feedback/FeedbackDialog.svelte';
  import { feedbackContext } from './lib/feedback/feedback';

  const installation = createInstallController();
  /** The optional on-device tag suggestions (33-1): off until the writer agrees, on this device only. */
  const photoSuggestions = createPhotoSuggestions();
  const app = createAppController({ onSaved: installation.offer });
  const appStore = app.state;
  /** The similar looks (33-2): the second consent, the indexing of this account's photos on this device, and the searches. */
  const similarLooks = createSimilarLooks({
    photos: photoSuggestions,
    library: derived(appStore, (state) => ({
      accountId: state.user?.id ?? null,
      glazes: state.glazes,
      combinations: state.combinations,
      online: state.online,
      settled: state.sync.phase === 'idle',
    })),
  });
  provideSimilar(similarLooks);
  onDestroy(similarLooks.destroy);
  const installStore = installation.state;
  /** The toast the header's offline icon opens: only on the person's request, never by itself; it goes with the connection's return. */
  const offlineToast = createOfflineToast();
  const offlineToastOpen = offlineToast.state;
  $effect(() => {
    if ($appStore.online) offlineToast.close();
  });
  const holdOffline = () => offlineToast.hold();
  /** The toast's clock starts again once neither the pointer nor focus is on it. */
  const releaseOffline = (event: Event) => {
    const toast = event.currentTarget as HTMLElement;
    const next = (event as FocusEvent).relatedTarget;
    if (toast.matches(':hover') || (next instanceof Node && toast.contains(next))) return;
    offlineToast.release();
  };
  /** Closing it from the keyboard leaves focus on the button that vanished: it goes back to the icon, which opened it. */
  const dismissOffline = () => {
    offlineToast.close();
    document.querySelector<HTMLElement>('[data-offline-icon]')?.focus();
  };
  /** The failed-request error (26-7) is a toast too: it shows while the error stands, so a failed load never vanishes unnoticed. */
  let errorShown = $derived(!!$appStore.error && !$appStore.deletingAccount);
  /** Dismissing or retrying removes the button that had focus: focus goes to the page, not to the top of the document. */
  const keepFocus = async () => {
    await tick();
    if (document.activeElement === document.body) main?.focus({ preventScroll: true });
  };
  const dismissError = () => {
    app.dismissError();
    void keepFocus();
  };
  const retryError = async () => {
    await app.retry();
    await keepFocus();
  };
  const update = createUpdateController({
    register: registerWorker,
    hasUnsavedWork: app.hasUnsavedWork,
    online: () => get(appStore).online,
    allowUnload: app.allowUnload,
    nextVersion: () => waitingVersion(__APP_VERSION__),
  });
  const updateStore = update.state;
  $effect(() => app.setUpdatePending($updateStore.available || $updateStore.stale));
  onMount(installation.start);
  onMount(update.start);
  onMount(app.start);
  onMount(initializeLocale);
  // A language whose dictionary could not be loaded (LANG-2): the shown language stays and the error toast says why.
  onMount(() => onLocaleFailure(() => app.showError('language.loadFailed')));
  // A language shown later (a retry, another choice) ends that toast: it would name a language that is now in place.
  onDestroy(locale.subscribe(() => get(appStore).error === 'language.loadFailed' && app.dismissError()));
  // The UI library's own labels follow the language: set before any dialog renders, updated on every switch (`ui/labels.ts`).
  onDestroy(t.subscribe((format) => labels.set({ close: format('common.close') })));
  let route = $derived($appStore.route);
  /** An email link's route: its kind and the token it confirms. */
  const accountLink = $derived(route.name === 'verify' || route.name === 'reset' || route.name === 'login' ? { kind: route.name, token: route.token } : null);
  /** Below 720 px: one-row top bar, bottom navigation, the language select in the account menu or the footer. */
  let phone = $state(isPhone());
  $effect(() => phoneMedia((now) => (phone = now)));
  /** Studio reports whether its draft has input; then its sticky bar takes the foot of the screen from the bottom navigation. */
  let studioStarted = $state(false);
  let bottomNav = $derived(bottomNavVisible(phone, routeSection(route), studioStarted));
  /** With Studio's sticky bar at the foot (a phone), the toasts stand above that bar instead of over its buttons. */
  let studioBar = $derived(studioBarSticky(phone, routeSection(route), studioStarted));
  let main = $state<HTMLElement>();
  /** Every Sign out button (header, phone menu, account page) calls this, so focus moves to Sign in once the session has ended. */
  const signOutRequest = createSignOutRequest();
  const signOut = () => {
    signOutRequest.press();
    void app.logout();
  };
  const leaveLink = () => app.navigate(home, { replace: true });
  const formErrorOf = (form: FormName) => formErrorFor($appStore, form);
  const buddyCode = $derived<BuddyCode>({
    hasLink: $appStore.buddies.hasLink,
    online: $appStore.online,
    error: formErrorOf('buddy-link'),
    actions: { createLink: app.createBuddyLink, currentLink: app.buddyLink, copyLink: app.copyLink, shareLink: app.shareUrl },
  });
  const clearErrors = () => {
    app.dismissError();
    app.clearFormError();
  };
  /** The Buddies section's heading takes the focus, as its "On this page" link does. */
  const focusBuddies = () => {
    const section = document.getElementById('account-buddies');
    section?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: 'start' });
  };
  /** The route the new-request toast's Answer left: once the account page shows, its Buddies section takes the focus. */
  let answeredFrom = $state.raw<Route | null>(null);
  /** Answer (FEED-2): the account page's Buddies section, which reads the lists again when it opens (or now, when it is open already). */
  const answerRequest = () => {
    app.dismissRequestToast();
    if (route.name === 'account') {
      void app.reloadBuddies();
      focusBuddies();
    } else {
      answeredFrom = route;
      app.navigate({ name: 'account' });
    }
  };
  $effect(() => {
    if (!answeredFrom || route === answeredFrom) return;
    const arrived = route.name === 'account';
    answeredFrom = null;
    if (arrived) void tick().then(focusBuddies);
  });
  /** Where the feedback dialog was opened from: focus goes back there when it closes (the phone menu's button, the header icon, the footer). */
  let feedbackOpener: HTMLElement | null = null;
  const openFeedback = () => {
    feedbackOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    app.openFeedback();
  };
  const returnFeedbackFocus = () => {
    if (feedbackOpener?.isConnected) feedbackOpener.focus();
    else main?.focus();
  };
  /** The context a feedback carries unless the sender unticks it: the route's name only, never its link, ids or tokens. */
  const contextOfFeedback = () =>
    feedbackContext({
      route: route.name,
      build: __APP_VERSION__,
      language: $locale ?? 'en',
      phone,
      coarse: globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
    });
  const dismissRequest = () => {
    app.dismissRequestToast();
    void keepFocus();
  };
</script>

<svelte:head><title>{$t('app.title')}</title></svelte:head>
<div class={['app-shell', { 'app-shell--bottom-nav': bottomNav }]}>
  <AppNav
    {phone}
    section={routeSection(route)}
    user={$appStore.user}
    online={$appStore.online}
    onSignIn={app.openAuth}
    onLogout={signOut}
    {signOutRequest}
    buddyRequests={requestCount($appStore.buddies)}
    {buddyCode}
    onScan={(link) => app.navigate(link)}
    onFeedback={openFeedback}
    {route}
    installed={$installStore.installed}
    onInstall={installation.open}
    onOffline={offlineToast.open} />

  <main
    bind:this={main}
    class="app-shell__main"
    tabindex="-1">
    <InstallPrompt
      state={$installStore}
      onOpen={installation.open}
      onDecline={installation.decline}
      onInstall={installation.install} />
    {#if $appStore.storageWarning}
      <div
        class="app-shell__notice"
        role="status">
        {$t('app.storageUnavailable')}
        <button
          class="icon-button icon-button--quiet app-shell__dismiss"
          onclick={app.dismissStorageWarning}
          aria-label={$t('app.dismissNotice')}>
          <Icon name="close" />
        </button>
      </div>
    {/if}
    <!-- One fixed box for the toasts, stacked error, update, message, offline; its two live regions are always in the page so what appears in them is announced: the error at once (alert), the others politely (status). -->
    <div class={['app-shell__toasts', { 'app-shell__toasts--above-nav': bottomNav, 'app-shell__toasts--above-bar': studioBar }]}>
      <div
        class="app-shell__region"
        role="alert">
        {#if errorShown}
          <div
            class="app-shell__toast app-shell__toast--error"
            role="presentation"
            onkeydown={(event) => event.key === 'Escape' && dismissError()}>
            <svg
              class="app-shell__toast-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="10" />
              <path d="M12 7v6M12 17h.01" />
            </svg>
            <span class="app-shell__toast-text">{$errorText($appStore.error)}</span>
            {#if $appStore.sync.failure && $appStore.online}
              <button
                class="app-shell__retry"
                onclick={retryError}
                disabled={isLoading($appStore.sync)}>
                {$t('common.tryAgain')}
              </button>
            {/if}
            <button
              class="icon-button icon-button--quiet app-shell__dismiss"
              onclick={dismissError}
              aria-label={$t('app.dismissError')}>
              <Icon name="close" />
            </button>
          </div>
        {/if}
      </div>
      <div
        class="app-shell__region"
        role="status"
        aria-atomic="false">
        <UpdateNotice
          state={$updateStore}
          onRefresh={update.refresh}
          onDismiss={update.dismiss} />
        <!-- Only while a sign-out still finishes: the page is signed out already; the browser may hold the server's answer while it empties its cache. -->
        {#if $appStore.signingOut}
          <div class="app-shell__toast">{$t('notices.signingOut')}</div>
        {/if}
        {#if $appStore.toast}
          <div class="app-shell__toast">
            {$t($appStore.toast, { values: $appStore.toastValues })}
          </div>
        {/if}
        <!-- A new buddy request (FEED-2): quiet, never taking focus, until Answer, Dismiss or Escape; not while offline. -->
        {#if $appStore.requestToast && $appStore.user && $appStore.online}
          {@const request = $appStore.requestToast}
          <div
            class="app-shell__toast app-shell__toast--request"
            role="presentation"
            onkeydown={(event) => event.key === 'Escape' && dismissRequest()}>
            <span class="app-shell__toast-text">{$t('feed.requestToast', { values: { name: request.name, others: request.others } })}</span>
            <button
              class="app-shell__retry"
              onclick={answerRequest}>
              {$t('feed.requestToastAnswer')}
            </button>
            <button
              class="icon-button icon-button--quiet app-shell__dismiss"
              onclick={dismissRequest}
              aria-label={$t('app.dismissNotice')}>
              <Icon name="close" />
            </button>
          </div>
        {/if}
        {#if $offlineToastOpen}
          <div
            class="app-shell__toast app-shell__toast--offline"
            role="presentation"
            onpointerenter={holdOffline}
            onpointerleave={releaseOffline}
            onfocusin={holdOffline}
            onfocusout={releaseOffline}
            onkeydown={(event) => event.key === 'Escape' && dismissOffline()}>
            <span class="app-shell__toast-text">{$t('app.offlineToast')}</span>
            <button
              class="app-shell__retry"
              onclick={app.retry}
              disabled={isLoading($appStore.sync)}>
              {$t('common.tryAgain')}
            </button>
            <button
              class="icon-button icon-button--quiet app-shell__dismiss"
              onclick={dismissOffline}
              aria-label={$t('app.dismissNotice')}>
              <Icon name="close" />
            </button>
          </div>
        {/if}
      </div>
    </div>
    <div class="app-shell__content">
      <!-- A new route remounts the boundary, so a failed page never blocks navigation. -->
      {#key routeKey(route)}
        <svelte:boundary onerror={(error) => console.error(error)}>
          {#if route.name === 'discover'}
            <DiscoverPage
              {app}
              {route} />
          {:else if isTokenRoute(route)}
            <DiscoverPage
              {app}
              route={home} />
          {:else if route.name === 'glaze'}
            <GlazePage
              {app}
              id={route.id}
              photo={route.photo} />
          {:else if route.name === 'combination'}
            <CombinationPage
              {app}
              id={route.id}
              photo={route.photo} />
          {:else if route.name === 'stock'}
            <StockPage
              {app}
              barcode={route.barcode}
              glazeId={route.glaze}
              shelf={route.shelf} />
          {:else if route.name === 'studio'}
            <StudioPage
              {app}
              {route}
              onStarted={(started) => (studioStarted = started)} />
          {:else if route.name === 'admin'}
            <AdminPage {app} />
          {:else if route.name === 'image-deletions'}
            <ImageDeletionsPage {app} />
          {:else if route.name === 'image-reports'}
            <ImageReportsPage {app} />
          {:else if route.name === 'avatar-reports'}
            <AvatarReportsPage {app} />
          {:else if route.name === 'bans'}
            <BansPage {app} />
          {:else if route.name === 'users'}
            <UsersPage {app} />
          {:else if route.name === 'error-reports'}
            <ErrorReportsPage {app} />
          {:else if route.name === 'feedback'}
            <FeedbackAdminPage {app} />
          {:else if route.name === 'terms'}
            <TermsPage loadContact={app.operatorContact} />
          {:else if route.name === 'about'}
            <AboutPage sourceUrl={$appStore.authOptions?.sourceUrl} />
          {:else if route.name === 'clubs'}
            <ClubsPage {app} />
          {:else if route.name === 'account'}
            <AccountPage
              {app}
              suggestions={photoSuggestions}
              similar={similarLooks}
              onSignOut={signOut}
              onFeedback={openFeedback}
              section={route.section} />
          {:else if route.name === 'activity'}
            <ActivityPage {app} />
          {:else if route.name === 'club'}
            <ClubPage
              {app}
              id={route.id} />
          {:else}
            <RouteStatus
              headingLevel={1}
              status="missing"
              signedIn={!!$appStore.user}
              onSignIn={app.openAuth} />
          {/if}
          {#snippet failed(_error, reset)}
            <RouteStatus
              headingLevel={1}
              status="crashed"
              onRetry={reset} />
          {/snippet}
        </svelte:boundary>
      {/key}
    </div>
    <footer class="app-shell__footer">
      <OperatorContact loadContact={app.operatorContact} />
      {#if phone && !$appStore.user}
        <LanguageSelect />
      {/if}
      <a
        class="app-shell__terms"
        href={routeHref({ name: 'about' })}>
        {$t('about.link')}
      </a>
      <a
        class="app-shell__terms"
        href={routeHref({ name: 'terms' })}>
        {$t('terms.title')}
      </a>
      <span class="app-shell__terms app-shell__version">{$t('app.version', { values: { version: __APP_VERSION__ } })}</span>
      <!-- The waiting (or, in a stale tab, already active) build: tells a notice that keeps coming back for one build from a new build each time. -->
      {#if $updateStore.next}
        <span class="app-shell__terms app-shell__next-version">{$t('app.nextVersion', { values: { version: $updateStore.next } })}</span>
      {/if}
      <SourceLinks sourceUrl={$appStore.authOptions?.sourceUrl} />
      {#if $appStore.user}
        <button
          type="button"
          class="app-shell__terms app-shell__feedback"
          onclick={openFeedback}>
          {$t('feedback.open')}
        </button>
      {/if}
      {#if $appStore.user?.siteAdmin}
        <a
          class="app-shell__terms"
          href={routeHref({ name: 'admin' })}>
          {$t('admin.title')}
        </a>
      {/if}
    </footer>
  </main>
  <!-- Last in the shell: a fixed bar is read and reached after the page. -->
  {#if bottomNav}
    <BottomNav
      section={routeSection(route)}
      {route} />
  {/if}
</div>

{#if accountLink}
  {@const link = accountLink}
  {#key link.token}
    <AccountLink
      kind={link.kind}
      online={$appStore.online}
      error={formErrorOf('account-link')}
      onClose={leaveLink}
      loadContact={app.operatorContact}
      onConfirm={(input) => app.confirmAccountLink(link.kind, link.token, input)} />
  {/key}
{:else if route.name === 'buddy'}
  {#key route.token}
    <BuddyRequest
      token={route.token}
      user={$appStore.user}
      online={$appStore.online}
      authOpen={$appStore.authOpen}
      error={formErrorOf('buddy')}
      onSignIn={app.openAuth}
      onClose={leaveLink}
      onOpenBuddies={() => app.navigate({ name: 'account' }, { replace: true })}
      onPreview={app.previewBuddyLink}
      onRequest={app.requestBuddy}
      onReportAvatar={app.reportAvatar}
      reportError={formErrorOf('avatar-report')} />
  {/key}
{:else if route.name === 'invite'}
  {#key route.token}
    <ClubInvite
      token={route.token}
      user={$appStore.user}
      online={$appStore.online}
      authOpen={$appStore.authOpen}
      error={formErrorOf('invite')}
      onSignIn={app.openAuth}
      onClose={leaveLink}
      onPreview={app.previewInvite}
      onJoin={app.joinClub} />
  {/key}
{/if}

{#if $appStore.accountSetup}
  <AccountLink
    kind="setup"
    initialName={$appStore.accountSetup.displayName}
    email={$appStore.accountSetup.email}
    online={$appStore.online}
    error={formErrorOf('account-link')}
    onClose={app.closeAccountSetup}
    loadContact={app.operatorContact}
    onConfirm={app.completeAccountSetup} />
{/if}

{#if $appStore.authOpen}
  <AuthDialog
    online={$appStore.online}
    notice={$appStore.authNotice}
    options={$appStore.authOptions}
    error={formErrorOf('auth')}
    recoveryError={formErrorOf('account-mail')}
    onClose={app.closeAuth}
    loadContact={app.operatorContact}
    onSubmit={app.submitAuth}
    onRequestMail={app.requestAccountMail}
    onClearError={clearErrors} />
{/if}

{#if $appStore.removingImage && $appStore.user}
  {@const image = $appStore.removingImage}
  {@const description = removalDescription(image, $appStore.glazes, $appStore.combinations)}
  <RemoveImageDialog
    focusFallback={main}
    description={$t(description.key, { values: { title: description.title } })}
    online={$appStore.online}
    error={formErrorFor($appStore, 'image-remove')}
    onConfirm={() => app.deleteImage(image)}
    onClose={app.closeImageRemoval} />
{/if}
{#if $appStore.uploadFor}
  {@const upload = $appStore.uploadFor}
  <UploadDialog
    target={upload}
    audience={uploadAudience($appStore, $appStore.uploadFor)}
    online={$appStore.online}
    visibility={$appStore.uploadVisibility}
    onVisibilityChange={app.rememberUploadVisibility}
    onClose={app.closeUpload}
    onUpload={app.uploadImage}
    suggestions={photoSuggestions}
    similar={similarLooks}
    userId={$appStore.user?.id}
    tags={tagsOf($appStore, upload)}
    knownTags={countTags($appStore.glazes, $appStore.combinations).map(({ tag }) => tag)}
    onAddTag={(tag) => app.editTags({ type: upload.type, id: upload.id }, { add: [tag] })}
    registerLeaveGuard={app.registerLeaveGuard}
    fallbackFocus={() => {
      if (!app.returnUploadFocus()) main?.focus();
    }} />
{/if}
{#if $appStore.leaving}
  <LeaveDialog
    message={$appStore.leaving.message}
    body={$appStore.leaving.body}
    leave={$appStore.leaving.leave}
    onStay={app.stay}
    onDiscard={app.leaveAnyway} />
{/if}
{#if $updateStore.confirming}
  <LeaveDialog
    message={'update.discard'}
    onStay={update.stay}
    onDiscard={update.discard} />
{/if}
{#if $appStore.feedbackOpen && $appStore.user}
  {#key $appStore.user.id}
    <FeedbackDialog
      online={$appStore.online}
      error={formErrorFor($appStore, 'feedback')}
      context={contextOfFeedback()}
      draft={app.feedbackDraft()}
      onDraft={app.keepFeedbackDraft}
      onSend={async (draft) => {
        const sent = await app.sendFeedback(draft, contextOfFeedback());
        if (sent) void tick().then(returnFeedbackFocus);
        return sent;
      }}
      onPhotoDropped={app.feedbackPhotoDropped}
      onClose={() => {
        app.closeFeedback();
        void tick().then(returnFeedbackFocus);
      }} />
  {/key}
{/if}
{#if $appStore.changingPassword && $appStore.user}
  {#key $appStore.user.id}
    <ChangePasswordDialog
      email={$appStore.user.email}
      online={$appStore.online}
      error={formErrorFor($appStore, 'password-change')}
      onConfirm={app.changePassword}
      onClose={app.closePasswordChange} />
  {/key}
{/if}
{#if $appStore.deletingAccount && $appStore.user}
  {#key $appStore.user.id}
    <DeleteAccountDialog
      email={$appStore.user.email}
      online={$appStore.online}
      error={formErrorFor($appStore, 'account-delete')}
      onConfirm={app.deleteAccount}
      onClose={app.closeAccountDeletion} />
  {/key}
{/if}

<!-- `topmost`: the top dialog (ModalShell's keys and paint order) until the current terms are accepted, also over dialogs opened after it. -->
{#if termsPending($appStore) && !$appStore.deletingAccount}
  {#key $appStore.user?.id}
    <TermsDialog
      online={$appStore.online}
      error={formErrorFor($appStore, 'terms')}
      loadContact={app.operatorContact}
      onAccept={app.acceptTerms}
      onDeleteAccount={app.openAccountDeletion}
      onLogout={app.logout} />
  {/key}
{/if}

<style>
  .app-shell {
    min-height: 100vh;
    padding-inline: var(--safe-left) var(--safe-right);
    /* The end of the page, the footer included, stays above the gesture area (the bottom navigation, below, adds its own clearance). */
    padding-bottom: var(--safe-bottom);
  }
  /* Keeps the end of the page, the footer included, clear of the fixed bottom navigation. */
  .app-shell--bottom-nav {
    padding-bottom: var(--bottom-nav-clearance);
  }
  .app-shell__footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-4);
    text-align: center;
  }
  .app-shell__terms {
    color: var(--muted);
    font-size: var(--font-sm);
  }
  /* A quiet text button like the footer's links. */
  .app-shell__feedback {
    border: 0;
    padding: 0;
    background: none;
    text-decoration: underline;
    cursor: pointer;
  }
  .app-shell__main {
    flex: 1;
    min-width: 0;
  }
  /* Keeps the footer below the fold while any route swaps its loading state. */
  .app-shell__content {
    min-height: 100vh;
    max-width: 77.5rem;
    margin: auto;
    padding: var(--space-6) var(--space-8) var(--space-16);
  }
  .app-shell__notice {
    max-width: 73.5rem;
    margin: var(--space-4) auto 0;
    border-radius: var(--radius-sm);
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-base);
    background: var(--warning-bg);
    color: var(--warning-ink);
  }
  .app-shell__retry {
    margin-left: var(--space-3);
    border: 0.0625rem solid currentColor;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font-size: var(--font-sm);
    font-weight: 600;
  }
  /* A line of toast text stays one line high. */
  .app-shell__dismiss {
    --icon-size: 1.125rem;
    width: var(--space-6);
    height: var(--space-6);
    color: inherit;
  }
  /* The toasts stack in one fixed box (bottom right, above the bottom navigation on phones); the box takes no clicks itself. */
  .app-shell__toasts {
    position: fixed;
    z-index: var(--z-toast);
    right: max(1.5625rem, var(--safe-right));
    bottom: max(1.375rem, var(--safe-bottom));
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
    /* A notice may name a person (buddies), whose name can be one long word: it stays on screen and wraps. */
    max-width: calc(100vw - 2 * max(1.5625rem, var(--safe-right)));
    pointer-events: none;
  }
  .app-shell__toasts--above-nav {
    bottom: calc(var(--bottom-nav-clearance) + var(--space-3));
  }
  .app-shell__toasts--above-bar {
    bottom: calc(var(--sticky-bar-clearance) + var(--space-3));
  }
  .app-shell__toast {
    pointer-events: auto;
    background: var(--ink);
    color: var(--paper);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    box-shadow: 0 0.5rem 1.875rem var(--shadow-color);
    font-size: var(--font-base);
    overflow-wrap: anywhere;
  }
  /* The live regions add no box of their own: the toasts stack in the fixed box. */
  .app-shell__region {
    display: contents;
  }
  /* The offline, request and error toasts: the message, then Try again (or Answer) and the dismiss button. */
  .app-shell__toast--offline,
  .app-shell__toast--request,
  .app-shell__toast--error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }
  .app-shell__toast-text {
    flex: 1 1 14rem;
  }
  .app-shell__toast--offline .app-shell__retry,
  .app-shell__toast--request .app-shell__retry,
  .app-shell__toast--error .app-shell__retry {
    margin: 0;
    padding: var(--space-1) var(--space-3);
  }
  /* An error is no grey toast: the danger colours, a ring and an icon, so it never rests on colour alone. */
  .app-shell__toast--error {
    background: var(--danger-bg);
    color: var(--danger-ink);
    border: 0.0625rem solid var(--danger-ink);
  }
  .app-shell__toast--error .app-shell__toast-text {
    flex-basis: 12rem;
  }
  /* A short request stays on one line with its buttons (a basis above the text's own width would wrap Dismiss); a long one takes the line and the buttons go below. */
  .app-shell__toast--request .app-shell__toast-text {
    flex-basis: auto;
  }
  .app-shell__toast-icon {
    flex: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .app-shell__toast--offline,
    .app-shell__toast--request,
    .app-shell__toast--error {
      animation: toast-in 0.15s ease-out;
    }
  }
  @keyframes toast-in {
    from {
      opacity: 0;
    }
  }
  @media (width < 68.75em) {
    .app-shell__content {
      padding: var(--space-7);
    }
    .app-shell__notice {
      margin-left: var(--space-7);
      margin-right: var(--space-7);
    }
  }
  @media (width < 45em) {
    .app-shell__content {
      padding: var(--space-5) var(--space-4) var(--space-16);
    }
    .app-shell__notice {
      margin: var(--space-3) var(--space-4) 0;
    }
  }
  @media (pointer: coarse) {
    .app-shell__footer {
      gap: var(--space-2) var(--space-4);
    }
    .app-shell__terms {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
    .app-shell__retry,
    .app-shell__dismiss {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
  }
</style>

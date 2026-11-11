<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { t, locale } from '../../lib/i18n';
  import CombinationCard from '../../components/combinations/CombinationCard.svelte';
  import PagedGrid from '../../components/explore/PagedGrid.svelte';
  import ClubInvitePanel from '../../components/clubs/ClubInvitePanel.svelte';
  import ClubSettings from '../../components/clubs/ClubSettings.svelte';
  import ClubWishlist from '../../components/clubs/ClubWishlist.svelte';
  import WishlistGlazeDialog from '../../components/clubs/WishlistGlazeDialog.svelte';
  import WishlistItemDialog from '../../components/clubs/WishlistItemDialog.svelte';
  import AddGlazeDialog from '../../components/glazes/AddGlazeDialog.svelte';
  import { createAddGlazeHost } from '../../state/catalog/add-glaze-host.svelte';
  import { lifetime } from '../../state/shared/lifetime';
  import { isWished } from '../../lib/clubs/wishlist';
  import MemberBuddy from '../../components/buddies/MemberBuddy.svelte';
  import Avatar from '../../components/avatars/Avatar.svelte';
  import AvatarReport from '../../components/avatars/AvatarReport.svelte';
  import BanUserDialog from '../../components/admin/BanUserDialog.svelte';
  import { canBan } from '../../lib/admin/bans';
  import type { ClubActions } from '../../components/clubs/club-actions';
  import FormError from '../../components/common/FormError.svelte';
  import SectionNav from '../../components/ui/SectionNav.svelte';
  import PageHead from '../../components/ui/PageHead.svelte';
  import PanelTitle from '../../components/ui/PanelTitle.svelte';
  import RefreshHint from '../../components/common/RefreshHint.svelte';
  import SignInEmpty from '../../components/auth/SignInEmpty.svelte';
  import BackLink from '../../components/ui/BackLink.svelte';
  import RouteStatus from '../../components/routing/RouteStatus.svelte';
  import { buddyRelation } from '../../lib/buddies/buddies';
  import { MEMBERS_SHOWN, clubAdmins, memberCombinations, orderedMembers, rulesFold } from '../../lib/clubs/clubs';
  import { glazeMap } from '../../lib/glazes/glazes';
  import { backLabel } from '../../lib/routing/back-label';
  import { findItem, routeHref } from '../../lib/routing/routes';
  import { filterByOwner, isUsedUp, shelfToCompare } from '../../lib/stock/shelf';
  import type { AppController } from '../../state/app/app-controller';
  import { buddyMemberForm, formErrorFor, refreshing } from '../../state/app/app-state';
  import { isLoading } from '../../lib/sync/lifecycle';

  interface Props {
    app: AppController;
    id: string;
  }

  let { app, id }: Props = $props();

  let appStore = $derived(app.state);
  const fallback = { name: 'clubs' } as const;
  let previousLabel = $derived(backLabel($appStore.previousRoute, $appStore.glazes, $appStore.combinations, $t, $appStore.clubs));
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  // The member rows show how the account stands to each member: read the buddy lists again when the page opens.
  let account = $derived(user?.id);
  $effect(() => {
    if (account && online) void app.reloadBuddies();
  });
  let favorites = $derived($appStore.favorites);
  let glazes = $derived(glazeMap($appStore.glazes));
  let shelf = $derived(user ? shelfToCompare($appStore.stock) : undefined);
  // Only the clubs of the account are listed, so someone else's club is "not found" like an unknown one.
  let found = $derived(findItem($appStore.clubs, id, $appStore.sync));
  let club = $derived(found.status === 'found' ? found.item : undefined);
  let clubShown = $derived(Boolean(club));
  /** The club's wishlist as read this session (a page fetch: read on every visit while online, never saved offline). */
  let wishlist = $derived($appStore.clubWishlists[id]);
  let wishlistFailed = $state(false);
  const alive = lifetime(() => account);
  $effect(() => {
    if (!account || !clubShown || !online) return;
    const clubId = id;
    const actor = account;
    untrack(() => {
      wishlistFailed = false;
      void app.loadWishlist(clubId).then((loaded) => {
        if (alive.current(actor) && clubId === id) wishlistFailed = !loaded;
      });
    });
  });
  let wishlistStatus = $derived<'loading' | 'failed' | 'offline' | 'ready'>(wishlist ? 'ready' : !online ? 'offline' : wishlistFailed ? 'failed' : 'loading');
  /** The open add dialog of the wishlist, with its unsaved-input flag and the glaze it has chosen. */
  let wishDialog = $state<'glaze' | 'item' | null>(null);
  let wishDirty = $state(false);
  let wishGlazeId = $state('');
  $effect(() => app.registerLeaveGuard({ dirty: () => wishDirty, message: 'drafts.discardWishlist' }));
  $effect(() => {
    void account;
    void id;
    untrack(() => closeWishDialog());
  });
  function openWishDialog(kind: 'glaze' | 'item') {
    app.clearFormError();
    wishGlazeId = '';
    wishDirty = false;
    wishDialog = kind;
  }
  function closeWishDialog() {
    wishDialog = null;
    wishDirty = false;
    wishGlazeId = '';
  }
  /** A glaze not in the library yet is added through the one add-glaze dialog, above the wishlist dialog; it then selects the new glaze. */
  const add = createAddGlazeHost<{ wishlist: true }>(
    () => app,
    () => $appStore,
    () => account,
  );
  let isAdmin = $derived(club?.role === 'ADMIN');
  /** Undefined while the club's member list is not available (an older snapshot, the account just left the club). */
  let members = $derived($appStore.clubMembers[id]);
  let shelfCount = $derived(filterByOwner($appStore.stock, id).filter((item) => !isUsedUp(item)).length);
  let items = $derived(members ? memberCombinations($appStore.combinations, members) : []);
  let admins = $derived(clubAdmins(members));
  let rules = $derived(rulesFold(club?.houseRules ?? ''));
  let rulesOpen = $state(false);
  let membersOpen = $state(false);
  /** The member the ban dialog (site admins only) is about. */
  let banning = $state<{ id: string; name: string } | null>(null);
  let inviteOpen = $state(false);
  let settingsOpen = $state(false);
  let inviteTitle = $state<PanelTitle>();
  let settingsTitle = $state<PanelTitle>();
  let membersTitle = $state<PanelTitle>();
  let collator = $derived(new Intl.Collator($locale ?? 'en'));
  let listed = $derived(members ? orderedMembers(members, collator) : []);
  let visibleMembers = $derived(membersOpen ? listed : listed.slice(0, MEMBERS_SHOWN));
  let adminNames = $derived(new Intl.ListFormat($locale ?? 'en', { type: 'disjunction' }).format(admins.map((admin) => admin.displayName)));
  const actions: ClubActions = $derived({
    updateClub: app.updateClub,
    changeClubRole: app.changeClubRole,
    removeClubMember: app.removeClubMember,
    regenerateInvite: app.regenerateInvite,
    inviteLink: app.inviteLink,
    copyLink: app.copyLink,
    shareLink: app.shareUrl,
  });

  // An admin who made themselves a member loses both panels (and the buttons that open them): focus moves to the member list.
  $effect(() => {
    if (isAdmin || !(inviteOpen || settingsOpen)) return;
    inviteOpen = false;
    settingsOpen = false;
    void tick().then(() => membersTitle?.focus());
  });

  /** An opened panel takes focus at its heading (it may sit below the fold); closing returns to the button that was pressed. */
  async function toggle(panel: 'invite' | 'settings', button: HTMLElement) {
    const open = panel === 'invite' ? !inviteOpen : !settingsOpen;
    if (panel === 'invite') inviteOpen = open;
    else settingsOpen = open;
    await tick();
    if (open) (panel === 'invite' ? inviteTitle : settingsTitle)?.focus();
    else button.focus();
  }
</script>

<BackLink
  href={routeHref(previousLabel ? $appStore.previousRoute! : fallback)}
  label={previousLabel ?? $t('nav.clubs')}
  onBack={previousLabel ? () => app.back(fallback) : undefined} />
{#if !user}
  <PageHead
    eyebrow={$t('clubs.eyebrow')}
    title={$t('clubs.page.guestTitle')}
    description={$t('clubs.guestClub')} />
  <SignInEmpty
    title={$t('clubs.signIn')}
    onSignIn={app.openAuth} />
{:else if club}
  <PageHead
    eyebrow={$t('clubs.eyebrow')}
    title={club.name}
    description={[isAdmin ? $t('clubs.role.admin') : $t('clubs.role.member'), members ? $t('clubs.page.members', { values: { count: members.length } }) : '']
      .filter(Boolean)
      .join(' · ')} />
  <SectionNav
    label={$t('common.onThisPage')}
    items={[
      { id: 'club-combinations', label: $t('discover.type.combinations') },
      { id: 'club-rules', label: $t('clubs.houseRules') },
      ...(!settingsOpen ? [{ id: 'club-members', label: $t('clubs.page.membersTitleUnknown') }] : []),
      { id: 'club-wishlist', label: $t('clubs.wishlist.title') },
    ]} />
  <div class="button-row club-page__actions">
    <a
      class="button"
      href={routeHref({ name: 'stock', shelf: club.id })}>
      {$t('clubs.page.shelfLink', { values: { count: shelfCount } })}
    </a>
    {#if isAdmin}
      <button
        type="button"
        class="button"
        aria-expanded={inviteOpen}
        aria-controls="club-invite"
        onclick={(event) => toggle('invite', event.currentTarget)}>
        {$t('clubs.page.invite')}
      </button>
      <button
        type="button"
        class="button"
        aria-expanded={settingsOpen}
        aria-controls="club-settings"
        onclick={(event) => toggle('settings', event.currentTarget)}>
        {$t('clubs.settings.title')}
      </button>
    {/if}
  </div>
  {#if isAdmin && inviteOpen}
    <section
      class="panel"
      id="club-invite">
      <PanelTitle
        bind:this={inviteTitle}
        title={$t('clubs.page.invite')} />
      <ClubInvitePanel
        {club}
        {online}
        {actions}
        formError={$appStore.formError} />
    </section>
  {/if}
  {#if isAdmin && settingsOpen}
    <section
      class="panel"
      id="club-settings">
      <PanelTitle
        bind:this={settingsTitle}
        title={$t('clubs.settings.title')} />
      <ClubSettings
        {club}
        {members}
        userId={user.id}
        {online}
        {actions}
        formError={$appStore.formError} />
    </section>
  {/if}
  <div class={['club-page__info', { 'club-page__info--single': settingsOpen }]}>
    <section
      class="panel club-page__panel club-page__section"
      id="club-rules">
      <PanelTitle title={$t('clubs.houseRules')} />
      {#if club.houseRules}
        <p class="club-page__rules">{rulesOpen ? club.houseRules : rules.shown}</p>
        {#if rules.folded}
          <button
            type="button"
            class="button"
            aria-expanded={rulesOpen}
            onclick={() => (rulesOpen = !rulesOpen)}>
            {rulesOpen ? $t('clubs.page.rulesShowLess') : $t('clubs.page.rulesShowAll')}
          </button>
        {/if}
      {:else}
        <p class="club-page__message">{$t('clubs.houseRulesEmpty')}</p>
      {/if}
    </section>
    {#if !(isAdmin && settingsOpen)}
      <section
        class="panel club-page__panel club-page__section"
        id="club-members">
        <PanelTitle
          bind:this={membersTitle}
          title={members ? $t('clubs.page.membersTitle', { values: { count: members.length } }) : $t('clubs.page.membersTitleUnknown')} />
        {#if members}
          <ul class="club-page__members">
            {#each visibleMembers as member (member.id)}
              <li class="club-page__member">
                <Avatar
                  avatarId={member.avatarId}
                  name={member.displayName}
                  viewerId={user.id} />
                <span class="club-page__member-name">
                  {member.displayName}
                  {#if member.id === user.id}
                    <span class="club-page__you">{$t('clubs.page.you')}</span>
                  {/if}
                </span>
                <span class={['club-page__role', { 'club-page__role--admin': member.role === 'ADMIN' }]}>
                  {member.role === 'ADMIN' ? $t('clubs.role.admin') : $t('clubs.role.member')}
                </span>
                {#if member.id !== user.id}
                  <AvatarReport
                    avatarId={member.avatarId}
                    name={member.displayName}
                    {online}
                    error={formErrorFor($appStore, 'avatar-report')}
                    onReport={app.reportAvatar}
                    extra={canBan(user, member.id) ? [{ id: 'ban', label: $t('ban.entry'), disabled: !online, danger: true }] : []}
                    onExtra={() => (banning = { id: member.id, name: member.displayName })} />
                {/if}
                {#if member.id !== user.id}
                  <div class="club-page__buddy">
                    <MemberBuddy
                      relation={buddyRelation($appStore.buddies, member.id, user.id)}
                      name={member.displayName}
                      {online}
                      onAsk={() => app.requestBuddyInClub(id, member.id)}
                      onAccept={() => app.acceptBuddy(member, buddyMemberForm(member.id))} />
                    <FormError message={formErrorFor($appStore, buddyMemberForm(member.id))} />
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
          {#if listed.length > MEMBERS_SHOWN}
            <button
              type="button"
              class="button"
              aria-expanded={membersOpen}
              onclick={() => (membersOpen = !membersOpen)}>
              {membersOpen ? $t('clubs.page.membersShowLess') : $t('clubs.page.membersShowAll', { values: { count: listed.length } })}
            </button>
          {/if}
          {#if members.length === 1 && isAdmin}
            <p class="club-page__message">{$t('clubs.page.onlyYou')}</p>
          {/if}
        {:else}
          <p class="club-page__message">{$t('clubs.page.membersUnavailable')}</p>
        {/if}
        {#if !isAdmin}
          <p class="club-page__message">
            {admins.length ? $t('clubs.page.inviteAsk', { values: { admins: adminNames } }) : $t('clubs.page.inviteAskAny')}
          </p>
        {/if}
      </section>
    {/if}
  </div>
  <ClubWishlist
    {wishlist}
    status={wishlistStatus}
    {online}
    errors={{
      load: formErrorFor($appStore, 'wishlist-load'),
      remove: formErrorFor($appStore, 'wishlist-remove'),
      acquired: formErrorFor($appStore, 'wishlist-acquired'),
    }}
    onRetry={() => {
      wishlistFailed = false;
      const actor = account;
      void app.loadWishlist(id).then((loaded) => {
        if (alive.current(actor)) wishlistFailed = !loaded;
      });
    }}
    onAddGlaze={() => openWishDialog('glaze')}
    onAddItem={() => openWishDialog('item')}
    onRemove={(entry) => app.removeWishlistEntry(id, entry.id)}
    onAcquired={(entry, acquired) => app.setWishlistAcquired(id, entry.id, acquired)} />
  <div
    class="club-page__heading club-page__section"
    id="club-combinations">
    <h2
      class="club-page__subtitle"
      tabindex="-1">
      {$t('clubs.page.combinations')}
      <span class="club-page__count">{items.length}</span>
    </h2>
    <RefreshHint refreshing={refreshing(isLoading($appStore.sync), $appStore.clubs)} />
  </div>
  {#if items.length}
    <PagedGrid
      {items}
      itemKey={(combo) => combo.id}
      name="club:{id}"
      filterKey={id}>
      {#snippet card(combo)}
        <CombinationCard
          {combo}
          {glazes}
          {shelf}
          href={routeHref({ name: 'combination', id: combo.id })}
          {user}
          {online}
          authorAvatars={$appStore.authorAvatars}
          onAddPhoto={app.openUpload}
          favorite={favorites.combinationIds.includes(combo.id)}
          onToggleFavorite={() => app.toggleFavorite('combinations', combo.id)} />
      {/snippet}
    </PagedGrid>
  {:else if members}
    <div class="empty-state">
      <h3 class="empty-state__title">{$t('clubs.page.emptyTitle')}</h3>
      <p class="empty-state__description">{$t('clubs.page.emptyBody')}</p>
    </div>
  {/if}
{:else if found.status !== 'found'}
  <RouteStatus
    headingLevel={1}
    status={found.status}
    failure={$appStore.sync.failure}
    signedIn
    onRetry={app.retry} />
{/if}

{#if wishDialog === 'glaze' && user && club}
  <WishlistGlazeDialog
    glazes={$appStore.glazes}
    wished={(glazeId) => isWished(wishlist?.entries ?? [], glazeId)}
    {online}
    error={formErrorFor($appStore, 'wishlist-add')}
    bind:glazeId={wishGlazeId}
    bind:dirty={wishDirty}
    onAddGlaze={() => add.open({ wishlist: true })}
    onSubmit={(input) => app.addWishlistEntry(id, input)}
    onClose={closeWishDialog} />
{:else if wishDialog === 'item' && user && club}
  <WishlistItemDialog
    {online}
    error={formErrorFor($appStore, 'wishlist-add')}
    bind:dirty={wishDirty}
    onSubmit={(input) => app.addWishlistEntry(id, input)}
    onClose={closeWishDialog} />
{/if}
{#if add.target && user}
  <AddGlazeDialog
    {...add.props}
    record={false}
    onAdded={(glazeId) => (wishGlazeId = glazeId)}
    existingAction={{
      label: $t('glazeForm.useExisting'),
      run: (glaze) => {
        wishGlazeId = glaze.id;
        add.close();
      },
    }}
    bind:dirty={add.dirty} />
{/if}

{#if banning && canBan(user, banning.id)}
  {@const target = banning}
  <!-- The member's row leaves with the reload after a ban, so the dialog is the page's, not the row's. -->
  <BanUserDialog
    name={target.name}
    {online}
    error={formErrorFor($appStore, 'ban')}
    fallbackFocus={() => membersTitle?.focus()}
    onBan={(reason) => app.banUser(target.id, target.name, reason, false)}
    onClose={() => (banning = null)} />
{/if}

<style>
  .club-page__section {
    scroll-margin-top: calc(var(--header-height) + var(--space-4));
  }
  .club-page__actions {
    margin-bottom: var(--space-6);
  }
  .club-page__info {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-6);
    align-items: start;
  }
  .club-page__info--single {
    grid-template-columns: minmax(0, 1fr);
  }
  .club-page__panel {
    margin-bottom: 0;
    min-width: 0;
  }
  .club-page__rules {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin-top: 0;
  }
  .club-page__message {
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .club-page__members {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
  }
  .club-page__member {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 0.0625rem solid var(--border);
  }
  .club-page__member-name {
    flex: 1 1 6rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .club-page__you,
  .club-page__role {
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .club-page__role {
    flex: none;
  }
  /* Beside the role when there is room, else on a line of its own under the name. */
  .club-page__buddy {
    display: flex;
    flex: 0 1 100%;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .club-page__role--admin {
    color: var(--accent);
    font-weight: 600;
  }
  .club-page__heading {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-7) 0 var(--space-4);
  }
  .club-page__subtitle {
    font-size: var(--font-xl);
    font-weight: 600;
    margin: var(--space-2) 0 0;
    letter-spacing: -0.0375rem;
  }
  .club-page__count {
    font-size: var(--font-base);
    font-weight: 600;
    color: var(--accent);
    background: var(--sage);
    border-radius: var(--radius-pill);
    padding: var(--space-1) var(--space-2);
    vertical-align: middle;
    margin-left: var(--space-1);
  }
  @media (width < 45em) {
    .club-page__info {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-4);
    }
    .club-page__subtitle {
      font-size: var(--font-lg);
    }
  }
</style>

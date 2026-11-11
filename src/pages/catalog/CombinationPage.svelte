<script lang="ts">
  import { formErrorFor, isGuest } from '../../state/app/app-state';
  import { locale, t } from '../../lib/i18n';
  import RemoveCombinationDialog from '../../components/combinations/RemoveCombinationDialog.svelte';
  import RenameCombinationDialog from '../../components/combinations/RenameCombinationDialog.svelte';
  import CombinationCard from '../../components/combinations/CombinationCard.svelte';
  import RouteStatus from '../../components/routing/RouteStatus.svelte';
  import BackLink from '../../components/ui/BackLink.svelte';
  import { backLabel } from '../../lib/routing/back-label';
  import CombinationLineage from '../../components/combinations/CombinationLineage.svelte';
  import ItemTags from '../../components/tags/ItemTags.svelte';
  import { countTags } from '../../lib/tags/tags';
  import { published } from '../../lib/explore/explore';
  import { combinationTitle, glazeMap, variationSource, variationsOf } from '../../lib/glazes/glazes';
  import FormError from '../../components/common/FormError.svelte';
  import ShareButton from '../../components/sharing/ShareButton.svelte';
  import GuestInvitation from '../../components/catalog/GuestInvitation.svelte';
  import SimilarLooks from '../../components/vision/SimilarLooks.svelte';
  import type { AppController } from '../../state/app/app-controller';
  import { findItem, routeHref } from '../../lib/routing/routes';
  import { shelfToCompare } from '../../lib/stock/shelf';
  import { availabilityByGlaze } from '../../lib/stock/availability';
  import { availabilityDate, buddyHolders } from '../../lib/stock/buddy-shelf';
  import { progressOf } from '../../lib/sync/lifecycle';

  interface Props {
    app: AppController;
    id: string;
    /** The photo the carousel opens at (`?photo=` of the route). */
    photo?: string;
  }

  let { app, id, photo }: Props = $props();

  let appStore = $derived(app.state);
  const fallback = { name: 'discover', type: 'combinations' } as const;
  /** The store's fields, each through one `$derived`: a patch elsewhere (a toast) derives nothing below again. */
  let libraryGlazes = $derived($appStore.glazes);
  let libraryCombinations = $derived($appStore.combinations);
  let buddyAvailability = $derived($appStore.buddyAvailability);
  let buddies = $derived($appStore.buddies);
  let previousLabel = $derived(backLabel($appStore.previousRoute, libraryGlazes, libraryCombinations, $t, $appStore.clubs));
  let removing = $state(false);
  let publishing = $state(false);
  async function publish(id: string) {
    if (publishing) return;
    publishing = true;
    try {
      await app.publishCombination(id);
    } finally {
      publishing = false;
    }
  }
  let user = $derived($appStore.user);
  /** The title dialog (the author's Rename, a site admin's Correct title); it closes when the account changes. */
  let renaming = $state(false);
  let renameDirty = $state(false);
  let accountId = $derived(user?.id);
  $effect(() => {
    void accountId;
    renaming = renameDirty = false;
  });
  $effect(() => app.registerLeaveGuard({ dirty: () => renaming && renameDirty, message: 'combination.rename.discard' }));
  function closeRename() {
    app.clearFormError();
    renaming = renameDirty = false;
  }
  let favorites = $derived($appStore.favorites);
  let found = $derived(findItem(libraryCombinations, id, $appStore.sync));
  let tagCounts = $derived(countTags(libraryGlazes, published(libraryCombinations)));
  let glazes = $derived(glazeMap(libraryGlazes));
  let shelf = $derived(user ? shelfToCompare($appStore.stock) : undefined);
  /** The page counts every shelf of the account (personal and its clubs'); the step marks say which one has a glaze. */
  let availability = $derived(shelf ? availabilityByGlaze($appStore.stock, $appStore.clubs, { clubs: true, locale: $locale ?? 'en' }) : undefined);
  /** What buddies have of the glazes the shelf lacks (27-3); offline it is the last connection's, said so. */
  let buddyShelf = $derived(
    shelf
      ? {
          holders: buddyHolders(buddyAvailability, buddies, new Intl.Collator($locale ?? 'en')),
          asOf: $appStore.online ? undefined : availabilityDate(buddyAvailability, $locale ?? 'en'),
          onAsk: app.shareMessage,
        }
      : undefined,
  );
</script>

<BackLink
  href={routeHref(previousLabel ? $appStore.previousRoute! : fallback)}
  label={previousLabel ?? $t('combination.back')}
  onBack={previousLabel ? () => app.back(fallback) : undefined} />
{#if found.status === 'found'}
  {@const combo = found.item}
  {@const title = combinationTitle(combo, $t('combination.untitled'))}
  {#snippet tagsPart()}
    <ItemTags
      inline
      tags={combo.tags}
      suggestions={tagCounts}
      editable={!!user && $appStore.online}
      onChange={(change) => app.editTags({ type: 'combination', id: combo.id }, change)} />
  {/snippet}
  {#snippet sharePart()}
    {#if !combo.draft}
      <ShareButton onShare={() => app.share($t('share.title', { values: { title } }), { name: 'combination', id: combo.id })} />
    {/if}
  {/snippet}
  {#snippet actionsPart()}
    {#if combo.draft && combo.own}
      <p class="combination-page__draft">
        {$t('combination.draft.note')}
      </p>
      <div class="combination-page__actions">
        <button
          type="button"
          class="button button--primary"
          disabled={!$appStore.online || publishing}
          onclick={() => publish(combo.id)}>
          {$t('combination.publish')}
        </button>
        <a
          class="button"
          href={routeHref({ name: 'studio', id: combo.id })}>
          {$t('combination.draft.edit')}
        </a>
      </div>
      {#if !removing}
        <FormError message={formErrorFor($appStore, 'combination')} />
      {/if}
    {:else}
      <div class="combination-page__actions">
        {#if user}
          <a
            class="button"
            href={routeHref({ name: 'studio', from: combo.id })}>
            {$t('combination.recordVariation')}
          </a>
        {/if}

        {#if combo.own}
          <a
            class="button combination-page__edit"
            href={routeHref({ name: 'studio', id: combo.id })}>
            {$t('combination.edit')}
          </a>
        {/if}
        {#if combo.own || user?.siteAdmin}
          <button
            type="button"
            class="button"
            disabled={!$appStore.online}
            onclick={() => {
              app.clearFormError();
              renaming = true;
            }}>
            {$t(combo.own ? 'combination.rename' : 'combination.correctTitle')}
          </button>
        {/if}
      </div>
    {/if}
  {/snippet}
  {#snippet lineagePart()}
    <CombinationLineage
      source={variationSource(libraryCombinations, combo)}
      variations={variationsOf(libraryCombinations, combo.id)}
      userId={user?.id} />
  {/snippet}
  {#snippet footerPart()}
    {#if combo.own}
      <div class="combination-page__danger">
        <button
          type="button"
          class="button combination-page__delete"
          disabled={!$appStore.online}
          onclick={() => {
            app.clearFormError();
            removing = true;
          }}>
          {$t('combination.delete.confirm')}
        </button>
      </div>
    {/if}
  {/snippet}
  <div class="detail-main">
    <CombinationCard
      onRemove={app.openImageRemoval}
      onReport={app.reportImage}
      reportError={formErrorFor($appStore, 'image-report')}
      visibilityError={formErrorFor($appStore, 'image-visibility')}
      detail
      headingLevel={1}
      focusPhoto={photo}
      clubs={$appStore.clubs}
      clubMembers={$appStore.clubMembers}
      onChangeVisibility={app.changeImageVisibility}
      onChangeDetails={app.changeImageDetails}
      onChangeKind={app.changeImageKind}
      kindError={formErrorFor($appStore, 'image-kind')}
      onChangeFocus={app.changeImageFocus}
      focusError={formErrorFor($appStore, 'image-focus')}
      detailsError={formErrorFor($appStore, 'image-details')}
      {combo}
      {glazes}
      {shelf}
      {availability}
      {buddyShelf}
      {user}
      online={$appStore.online}
      authorAvatars={$appStore.authorAvatars}
      onReportAvatar={app.reportAvatar}
      avatarReportError={formErrorFor($appStore, 'avatar-report')}
      onAddPhoto={app.openUpload}
      favorite={favorites.combinationIds.includes(combo.id)}
      onToggleFavorite={() => app.toggleFavorite('combinations', combo.id)}
      tags={tagsPart}
      share={sharePart}
      actions={actionsPart}
      lineage={lineagePart}
      footer={footerPart} />
    <SimilarLooks
      type="combination"
      id={combo.id}
      userId={user?.id} />
    {#if removing && combo.own}
      <RemoveCombinationDialog
        {title}
        locked={combo.stepsLocked}
        online={$appStore.online}
        error={formErrorFor($appStore, 'combination')}
        onConfirm={() => app.removeCombination(combo.id)}
        onClose={() => {
          removing = false;
          app.clearFormError();
        }} />
    {/if}
    {#if renaming && user && !combo.draft && (combo.own || user.siteAdmin)}
      <RenameCombinationDialog
        title={combo.title}
        correcting={!combo.own}
        online={$appStore.online}
        error={formErrorFor($appStore, 'combination-title')}
        onSubmit={(next) => app.retitleCombination(combo.id, next)}
        onClose={closeRename}
        bind:dirty={renameDirty} />
    {/if}
    {#if isGuest($appStore)}
      <div class="combination-page__guest">
        <GuestInvitation
          message={$t('guest.combination')}
          onSignIn={app.openAuth} />
      </div>
    {/if}
  </div>
{:else}
  <RouteStatus
    headingLevel={1}
    status={found.status}
    progress={progressOf($appStore.sync)}
    failure={$appStore.sync.failure}
    signedIn={!!user}
    onSignIn={app.openAuth}
    onRetry={app.retry} />
{/if}

<style>
  .combination-page__actions {
    display: contents;
  }
  .combination-page__draft {
    margin: 0;
    flex-basis: 100%;
    color: var(--warning-ink);
  }
  .combination-page__danger {
    margin-top: var(--space-6);
    padding-top: var(--space-4);
    border-top: 0.0625rem solid var(--border);
  }
  .combination-page__delete {
    color: var(--danger-ink);
    border-color: var(--danger-ink);
  }
  /* The author's Edit stands at the end of the row where the recipe column holds all three buttons; narrower, it wraps like the others. */
  @media (width >= 68.75em) {
    .combination-page__edit {
      margin-inline-start: auto;
    }
  }
  /* One column on a phone, as wide as the page from 45em, where the card is two columns. */
  .detail-main {
    max-width: 40rem;
  }
  @media (width >= 45em) {
    .detail-main {
      max-width: none;
    }
    .combination-page__guest {
      max-width: 40rem;
    }
  }
</style>

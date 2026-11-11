<script lang="ts">
  import { formErrorFor, isGuest } from '../../state/app/app-state';
  import { locale, t } from '../../lib/i18n';
  import GlazeCard from '../../components/glazes/GlazeCard.svelte';
  import CombinationCard from '../../components/combinations/CombinationCard.svelte';
  import RouteStatus from '../../components/routing/RouteStatus.svelte';
  import BackLink from '../../components/ui/BackLink.svelte';
  import { backLabel } from '../../lib/routing/back-label';
  import ItemTags from '../../components/tags/ItemTags.svelte';
  import RemoveGlazeDialog from '../../components/glazes/RemoveGlazeDialog.svelte';
  import GlazeAbout from '../../components/glazes/GlazeAbout.svelte';
  import EditGlazeDialog from '../../components/glazes/EditGlazeDialog.svelte';
  import GlazeHistoryDialog from '../../components/glazes/GlazeHistoryDialog.svelte';
  import { codeEditable } from '../../lib/glazes/glaze-edit';
  import ShareButton from '../../components/sharing/ShareButton.svelte';
  import GuestInvitation from '../../components/catalog/GuestInvitation.svelte';
  import GlazeBarcodes from '../../components/glazes/GlazeBarcodes.svelte';
  import GlazeShelf from '../../components/stock/GlazeShelf.svelte';
  import SimilarLooks from '../../components/vision/SimilarLooks.svelte';
  import { glazeMap, glazeTitle } from '../../lib/glazes/glazes';
  import AskBuddy from '../../components/buddies/AskBuddy.svelte';
  import { usesGlaze } from '../../lib/glazes/steps';
  import { countTags } from '../../lib/tags/tags';
  import type { AppController } from '../../state/app/app-controller';
  import { finishedPiecesByGlaze, glazeGallery } from '../../lib/images/pictures';
  import { combinationsOfGlazeRoute, published } from '../../lib/explore/explore';
  import { findItem, routeHref } from '../../lib/routing/routes';
  import { shelfToCompare } from '../../lib/stock/shelf';
  import { availabilityDate, buddyHolders, markNames } from '../../lib/stock/buddy-shelf';
  import { progressOf } from '../../lib/sync/lifecycle';

  interface Props {
    app: AppController;
    id: string;
    /** The photo the carousel opens at (`?photo=` of the route). */
    photo?: string;
  }

  let { app, id, photo }: Props = $props();

  let appStore = $derived(app.state);
  const fallback = { name: 'discover', type: 'glazes' } as const;
  /** The store's fields, each through one `$derived`: a patch elsewhere (a toast) derives nothing below again. */
  let libraryGlazes = $derived($appStore.glazes);
  let libraryCombinations = $derived($appStore.combinations);
  let buddyAvailability = $derived($appStore.buddyAvailability);
  let buddies = $derived($appStore.buddies);
  let previousLabel = $derived(backLabel($appStore.previousRoute, libraryGlazes, libraryCombinations, $t, $appStore.clubs));
  let user = $derived($appStore.user);
  let shelf = $derived(user ? shelfToCompare($appStore.stock) : undefined);
  let online = $derived($appStore.online);
  /** The accepted buddies who have this glaze on their personal shelf (27-3), by name; offline the last connection's, said so. */
  let holders = $derived(buddyHolders(buddyAvailability, buddies, new Intl.Collator($locale ?? 'en')).get(id) ?? []);
  let buddiesAsOf = $derived(online ? undefined : availabilityDate(buddyAvailability, $locale ?? 'en'));
  let favorites = $derived($appStore.favorites);
  /** The author's own drafts belong to Studio and Mine, not to the glaze's page. */
  let combinations = $derived(published(libraryCombinations));
  let found = $derived(findItem(libraryGlazes, id, $appStore.sync));
  let tagCounts = $derived(countTags(libraryGlazes, combinations));
  let glazesById = $derived(glazeMap(libraryGlazes));
  let removing = $state(false);
  let usedIn = $derived(combinations.filter((combo) => usesGlaze(combo, id)));
  /** The edit and history dialogs; both close when the account changes. */
  let editing = $state(false);
  let editDirty = $state(false);
  let showingHistory = $state(false);
  let accountId = $derived(user?.id);
  $effect(() => {
    void accountId;
    editing = showingHistory = editDirty = false;
  });
  $effect(() => app.registerLeaveGuard({ dirty: () => editing && editDirty && found.status === 'found', message: 'glaze.edit.discard' }));

  function closeEdit() {
    app.clearFormError();
    editing = editDirty = false;
  }
</script>

<BackLink
  href={routeHref(previousLabel ? $appStore.previousRoute! : fallback)}
  label={previousLabel ?? $t('common.allGlazes')}
  onBack={previousLabel ? () => app.back(fallback) : undefined} />
{#if found.status === 'found'}
  {@const glaze = found.item}
  {#snippet sharePart()}
    <ShareButton onShare={() => app.share($t('share.title', { values: { title: glazeTitle(glaze) } }), { name: 'glaze', id: glaze.id })} />
  {/snippet}
  {#snippet actionsPart()}
    <div class="button-row glaze-page__actions">
      {#if user}
        <a
          class="button"
          href={routeHref({ name: 'studio', glaze: glaze.id })}>
          {$t('glaze.recordCombination')}
        </a>
      {/if}
    </div>
  {/snippet}
  {#snippet combinationsPart()}
    <h2 class="detail-heading">{$t('glaze.combinations.title')}</h2>
    {#if usedIn.length}
      <p class="detail-explore">
        <a
          class="detail-explore__link"
          href={routeHref(combinationsOfGlazeRoute(glaze.id))}>
          {$t('glaze.combinations.seeAll', { values: { count: usedIn.length } })}
        </a>
      </p>
      <div class="detail-grid">
        {#each usedIn.slice(0, 4) as combo (combo.id)}
          <CombinationCard
            {combo}
            glazes={glazesById}
            {shelf}
            {user}
            {online}
            authorAvatars={$appStore.authorAvatars}
            href={routeHref({ name: 'combination', id: combo.id })}
            onAddPhoto={app.openUpload}
            favorite={favorites.combinationIds.includes(combo.id)}
            onToggleFavorite={() => app.toggleFavorite('combinations', combo.id)} />
        {/each}
      </div>
    {:else}
      <p class="glaze-page__empty">{$t('glaze.combinations.empty')}</p>
    {/if}
  {/snippet}
  {#snippet footerPart()}
    <GlazeAbout
      {glaze}
      signedIn={!!user}
      {online}
      onEdit={() => {
        app.clearFormError();
        editing = true;
      }}
      onHistory={() => {
        app.clearFormError();
        showingHistory = true;
      }} />
    <ItemTags
      inline
      tags={glaze.tags}
      suggestions={tagCounts}
      editable={!!user && online}
      onChange={(change) => app.editTags({ type: 'glaze', id: glaze.id }, change)} />
    <GlazeBarcodes
      barcodes={glaze.barcodes}
      editable={!!user && online}
      onChange={(change) => app.editBarcodes(glaze.id, change)} />
  {/snippet}
  <div class="detail-main">
    <GlazeCard
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
      {glaze}
      pictures={glazeGallery(glaze, finishedPiecesByGlaze(combinations).get(glaze.id))}
      {user}
      {online}
      onAddPhoto={app.openUpload}
      favorite={favorites.glazeIds.includes(glaze.id)}
      onToggleFavorite={() => app.toggleFavorite('glazes', glaze.id)}
      share={sharePart}
      actions={actionsPart}
      combinations={combinationsPart}
      footer={footerPart}>
      {#snippet status()}
        {#if user}
          <GlazeShelf
            glazeId={glaze.id}
            title={glazeTitle(glaze)}
            stock={$appStore.stock}
            clubs={$appStore.clubs}
            {online}
            error={formErrorFor($appStore, 'stock')}
            onSave={(input) => app.saveStock(input, true)}
            onAdd={(input, quick) => app.saveStock(input, false, quick ? 'notices.shelfAdded' : undefined)}
            onRemove={app.removeStock}
            registerLeaveGuard={app.registerLeaveGuard} />
          {#if holders.length}
            <p class="glaze-page__buddies">
              {$t('buddies.shelf.glazeHolders', {
                values: { names: new Intl.ListFormat($locale ?? 'en', { type: 'conjunction' }).format(holders.map((buddy) => buddy.displayName)) },
              })}
            </p>
            {#if markNames(holders) === 'names'}
              <p class="glaze-page__asks">
                {#each holders as buddy (buddy.id)}
                  <AskBuddy
                    {buddy}
                    glaze={glazeTitle(glaze)}
                    title={null}
                    link={null}
                    onShare={app.shareMessage} />
                {/each}
              </p>
            {:else}
              <details class="glaze-page__asks-many">
                <summary>{$t('buddies.shelf.askGlazeMany')}</summary>
                <ul class="glaze-page__asks-list">
                  {#each holders as buddy (buddy.id)}
                    <li>
                      <span>{buddy.displayName}</span>
                      <AskBuddy
                        {buddy}
                        glaze={glazeTitle(glaze)}
                        title={null}
                        link={null}
                        onShare={app.shareMessage} />
                    </li>
                  {/each}
                </ul>
              </details>
            {/if}
            {#if buddiesAsOf}
              <p class="glaze-page__buddies-asof">{$t('buddies.shelf.asOf', { values: { date: buddiesAsOf } })}</p>
            {/if}
          {/if}
        {/if}
      {/snippet}
    </GlazeCard>
    {#if user?.siteAdmin}
      <div class="glaze-page__danger">
        <button
          type="button"
          class="button glaze-page__remove"
          disabled={!online}
          onclick={() => {
            app.dismissError();
            removing = true;
          }}>
          {$t('glaze.remove.action')}
        </button>
      </div>
    {/if}
    <SimilarLooks
      type="glaze"
      {id}
      userId={accountId} />
    {#if isGuest($appStore)}
      <div class="glaze-page__guest">
        <GuestInvitation
          message={$t('guest.glaze')}
          onSignIn={app.openAuth} />
      </div>
    {/if}
  </div>
  {#if removing && user?.siteAdmin}
    <RemoveGlazeDialog
      label={glazeTitle(glaze)}
      {usedIn}
      {online}
      error={formErrorFor($appStore, 'glaze-remove')}
      onConfirm={() => app.removeGlaze(glaze.id)}
      onClose={() => {
        removing = false;
        if (formErrorFor($appStore, 'glaze-remove')) app.clearFormError();
      }} />
  {/if}
  {#if editing && user}
    <EditGlazeDialog
      {glaze}
      codeEditable={codeEditable(glaze.id, user, libraryCombinations)}
      {online}
      error={formErrorFor($appStore, 'glaze-edit')}
      onSubmit={(change) => app.correctGlaze(glaze.id, change)}
      onClose={closeEdit}
      bind:dirty={editDirty} />
  {/if}
  {#if showingHistory}
    <GlazeHistoryDialog
      label={glazeTitle(glaze)}
      {online}
      error={formErrorFor($appStore, 'glaze-history')}
      onLoad={() => app.glazeHistory(glaze.id)}
      onClose={() => {
        app.clearFormError();
        showingHistory = false;
      }} />
  {/if}
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
  /* One column on a phone, as wide as the page from 45em, where the card is two columns (as the combination page). */
  .detail-main {
    max-width: 40rem;
  }
  @media (width >= 45em) {
    .detail-main {
      max-width: none;
    }
    .glaze-page__guest {
      max-width: 40rem;
    }
  }
  .glaze-page__buddies {
    margin: var(--space-2) 0 0;
    font-size: var(--font-sm);
    overflow-wrap: anywhere;
  }
  .glaze-page__asks,
  .glaze-page__asks-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-1) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--font-sm);
  }
  .glaze-page__asks-list {
    flex-direction: column;
  }
  .glaze-page__asks-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
  }
  .glaze-page__asks-many {
    margin: var(--space-1) 0 0;
    font-size: var(--font-sm);
  }
  .glaze-page__buddies-asof {
    margin: var(--space-0-5) 0 0;
    color: var(--muted);
    font-size: var(--font-xs);
  }
  /* The one action row, under the glaze and above its combinations (the combination page's rules). */
  .glaze-page__actions {
    margin: var(--space-4) 0;
    padding-top: var(--space-4);
    border-top: 0.0625rem solid var(--border);
  }
  .glaze-page__danger {
    margin-top: var(--space-6);
    padding-top: var(--space-4);
    border-top: 0.0625rem solid var(--border);
  }
  .glaze-page__remove {
    border-color: var(--danger-ink);
    color: var(--danger-ink);
  }
  .glaze-page__empty {
    margin: 0;
    color: var(--muted);
  }
  .detail-heading {
    font-size: var(--font-lg);
    font-weight: 600;
    margin: var(--space-5) 0 var(--space-2);
  }
  .detail-explore {
    margin: 0 0 var(--space-3);
  }
  .detail-explore__link {
    display: inline-block;
    padding: var(--space-2) 0;
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 600;
  }
  /* As many columns as the right half holds. */
  .detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: var(--space-4);
  }
  @media (pointer: coarse) {
    .detail-explore__link {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
      padding-block: 0;
    }
  }
</style>

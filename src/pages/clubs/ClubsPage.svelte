<script lang="ts">
  import { tick } from 'svelte';
  import { t, locale } from '../../lib/i18n';
  import ScanLinkButton from '../../components/scanning/ScanLinkButton.svelte';
  import ClubCard from '../../components/clubs/ClubCard.svelte';
  import PageHead from '../../components/ui/PageHead.svelte';
  import PanelTitle from '../../components/ui/PanelTitle.svelte';
  import SignInEmpty from '../../components/auth/SignInEmpty.svelte';
  import RouteStatus from '../../components/routing/RouteStatus.svelte';
  import type { AppController } from '../../state/app/app-controller';
  import { listStatus, refreshing, formErrorFor } from '../../state/app/app-state';
  import { isLoading, progressOf } from '../../lib/sync/lifecycle';
  import RefreshHint from '../../components/common/RefreshHint.svelte';
  import { sortedClubs } from '../../lib/clubs/clubs';
  import FormError from '../../components/common/FormError.svelte';
  import OfflineNote from '../../components/common/OfflineNote.svelte';

  interface Props {
    app: AppController;
  }

  let { app }: Props = $props();

  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  let busy = $state(false);
  let clubName = $state('');
  let startOpen = $state(false);
  let nameField = $state<HTMLInputElement>();
  let clubs = $derived($appStore.clubs);
  // The API sorts case-sensitively: sort by name in the app's language.
  let collator = $derived(new Intl.Collator($locale ?? 'en'));
  let sorted = $derived(sortedClubs(clubs, collator));
  let onSignIn = $derived(app.openAuth);
  let listElement = $state<HTMLUListElement>();
  let startTitle = $state<PanelTitle>();
  /** The club's card leaves with it, so focus goes to the list (or, without clubs, to the start panel's heading). */
  async function leaveClub(id: string) {
    const left = await app.leaveClub(id);
    if (left) {
      await tick();
      if (listElement) listElement.focus();
      else startTitle?.focus();
    }
    return left;
  }
  /** Creating a club opens its page (the controller navigates); the draft is cleared once it worked. */
  async function onCreateClub() {
    if (busy || !online) return;
    busy = true;
    try {
      if (await app.createClub(clubName)) clubName = '';
    } finally {
      busy = false;
    }
  }
  async function onStartToggle(open: boolean) {
    startOpen = open;
    if (!open) return;
    await tick();
    nameField?.focus();
  }
</script>

{#snippet startForm()}
  <form
    class="clubs-start__form"
    onsubmit={(event) => {
      event.preventDefault();
      onCreateClub();
    }}>
    <label class="form-field">
      {$t('clubs.name')}
      <input
        class="form-field__control"
        bind:this={nameField}
        bind:value={clubName}
        placeholder={$t('clubs.create.namePlaceholder')}
        required
        maxlength="120" />
    </label>
    <OfflineNote {online} />
    <FormError message={formErrorFor($appStore, 'club')} />
    <button
      class="button button--primary"
      disabled={busy || !online}>
      {$t('clubs.create.submit')}
    </button>
  </form>
{/snippet}

<PageHead
  eyebrow={$t('clubs.eyebrow')}
  title={$t('clubs.title')}
  description={$t('clubs.intro')} />
{#if user}
  <p class="clubs-scan">
    <ScanLinkButton
      label={$t('clubs.scan')}
      refusal={$t('clubs.scan.refused')}
      kinds={['invite']}
      onOpen={(link) => app.navigate(link)} />
  </p>
{/if}
{#if !user}
  <SignInEmpty
    title={$t('clubs.signIn')}
    {onSignIn} />
{:else if listStatus(isLoading($appStore.sync), clubs) === 'loading'}
  <RouteStatus
    status="loading"
    progress={progressOf($appStore.sync)} />
{:else if sorted.length}
  <RefreshHint refreshing={refreshing(isLoading($appStore.sync), clubs)} />
  <!-- One note for every "Leave club" button, which is disabled while offline. -->
  <OfflineNote {online} />
  <ul
    class="clubs-grid"
    bind:this={listElement}
    tabindex="-1"
    aria-label={$t('clubs.title')}>
    {#each sorted as club (club.id)}
      <li class="clubs-grid__item">
        <ClubCard
          {club}
          members={$appStore.clubMembers[club.id]}
          userId={user.id}
          stock={$appStore.stock}
          combinations={$appStore.combinations}
          {online}
          {leaveClub}
          formError={$appStore.formError} />
      </li>
    {/each}
  </ul>
  <details
    class="panel clubs-start"
    open={startOpen}
    ontoggle={(event) => onStartToggle(event.currentTarget.open)}>
    <summary class="clubs-start__summary">{$t('clubs.create.title')}</summary>
    {@render startForm()}
  </details>
{:else}
  <RefreshHint refreshing={refreshing(isLoading($appStore.sync), clubs)} />
  <section class="panel clubs-start">
    <p class="panel__message clubs-start__join">{$t('clubs.joinHint')}</p>
    <PanelTitle
      bind:this={startTitle}
      title={$t('clubs.create.title')} />
    {@render startForm()}
  </section>
{/if}

<style>
  .clubs-scan {
    margin: 0 0 var(--space-4);
  }
  .clubs-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-4);
    list-style: none;
    margin: 0 0 var(--space-6);
    padding: 0;
  }
  .clubs-grid:focus {
    outline: none;
  }
  .clubs-grid__item {
    min-width: 0;
  }
  .clubs-start__summary {
    color: var(--accent);
    cursor: pointer;
    font-weight: 600;
  }
  .clubs-start__form {
    max-width: 28rem;
    margin-top: var(--space-4);
  }
  .clubs-start__join {
    margin-top: 0;
    max-width: 40rem;
  }
  @media (pointer: coarse) {
    .clubs-start__summary {
      display: flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

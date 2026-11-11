<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { Club, ClubMember, Combination, StockItem } from '../../lib/api/models';
  import { clubSummary, leaveRefusal } from '../../lib/clubs/clubs';
  import { routeHref } from '../../lib/routing/routes';
  import { clubForm, formErrorFor, type FormError as FormErrorState } from '../../state/app/app-state';
  import { createConfirmation } from '../../state/shared/confirmation.svelte';
  import FormError from '../common/FormError.svelte';
  import ConfirmDialog from '../common/ConfirmDialog.svelte';
  interface Props {
    club: Club;
    /** The loaded member list, or undefined when it is not available (then the server decides alone). */
    members: ClubMember[] | undefined;
    /** The signed-in account. */
    userId: string;
    stock: StockItem[];
    combinations: Combination[];
    online: boolean;
    /** What the card asks the app to do: the account leaves the club (answers whether it worked). */
    leaveClub: (id: string) => Promise<boolean>;
    formError: FormErrorState | null;
  }
  let { club, members, userId, stock, combinations, online, leaveClub, formError }: Props = $props();
  const id = $props.id();
  /** Why the account cannot leave, mirrored from the server's last-admin guard (which stays authoritative). */
  let refusal = $derived(leaveRefusal(members, userId));
  let summary = $derived(clubSummary(club, members, stock, combinations));
  /** What the club's page holds; a count whose list is not available is left out. */
  let counts = $derived(
    [
      summary.members !== undefined && $t('clubs.page.members', { values: { count: summary.members } }),
      $t('clubs.card.glazes', { values: { count: summary.glazes } }),
      summary.combinations !== undefined && $t('clubs.card.combinations', { values: { count: summary.combinations } }),
    ].filter((item): item is string => !!item),
  );
  const leaving = createConfirmation((target: Club) => leaveClub(target.id));
</script>

<!-- The whole card opens the club's page: the name is the link, stretched over the card; "Leave club" sits above it. -->
<article class="club-card">
  <div class="club-card__head">
    <a
      class="club-card__link"
      href={routeHref({ name: 'club', id: club.id })}>
      <h2 class="club-card__name">{club.name}</h2>
    </a>
    {#if club.role === 'ADMIN'}
      <span class="club-card__badge">{$t('clubs.role.admin')}</span>
    {/if}
  </div>
  <p class="club-card__counts">
    {#each counts as item, index (index)}{#if index > 0}{' · '}{/if}
      <span class="club-card__count">{item}</span>{/each}
  </p>
  <div class="club-card__actions">
    <button
      type="button"
      class={['button club-card__leave', { 'club-card__leave--unavailable': refusal }]}
      disabled={leaving.busy || !online}
      aria-disabled={refusal ? true : undefined}
      aria-describedby={refusal ? `${id}-leave-refusal` : undefined}
      onclick={() => {
        if (!refusal) leaving.ask(club);
      }}>
      {$t('clubs.leave.open')}
    </button>
  </div>
  {#if refusal}
    <p
      class="club-card__reason"
      id="{id}-leave-refusal">
      {refusal === 'onlyMember' ? $t('clubs.leave.onlyMember') : $t('clubs.leave.lastAdmin')}
    </p>
  {/if}
  <FormError message={formErrorFor({ formError }, clubForm('leave', club.id))} />
</article>
{#if leaving.asking}
  <ConfirmDialog
    title={$t('clubs.leave.title', { values: { club: club.name } })}
    confirmLabel={$t('clubs.leave.confirm')}
    {online}
    onConfirm={() => void leaving.confirm()}
    onCancel={leaving.cancel}>
    <p>{$t('clubs.leave.body')}</p>
    <p>{$t('clubs.leave.keeps')}</p>
  </ConfirmDialog>
{/if}

<style>
  .club-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: var(--space-4) var(--space-5);
    background: var(--surface);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
  }
  .club-card:hover {
    border-color: var(--control-border);
  }
  .club-card__head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
  }
  .club-card__link {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: var(--space-1);
  }
  /* The link's box covers the card, so a press anywhere on it opens the page; the focus ring surrounds the card. */
  .club-card__link::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .club-card__link:focus-visible {
    outline: none;
  }
  .club-card__link:focus-visible::after {
    outline: 0.1875rem solid var(--focus);
    outline-offset: 0.1875rem;
  }
  .club-card__name {
    font-size: var(--font-lg);
    font-weight: 600;
    letter-spacing: -0.0375rem;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .club-card__badge {
    flex: none;
    color: var(--accent);
    background: var(--sage);
    border-radius: var(--radius-pill);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--font-sm);
    font-weight: 600;
  }
  .club-card__counts {
    color: var(--muted);
    font-size: var(--font-base);
    margin: 0;
  }
  /* Each item wraps as a unit, never between its number and noun. */
  .club-card__count {
    white-space: nowrap;
  }
  .club-card__actions {
    display: flex;
    margin-top: auto;
    padding-top: var(--space-2);
  }
  .club-card__leave {
    position: relative;
    z-index: 1;
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--font-sm);
  }
  .club-card__leave--unavailable {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .club-card__reason {
    color: var(--muted);
    font-size: var(--font-sm);
    margin: 0;
  }
  @media (pointer: coarse) {
    /* The link's own box is a touch target too, not only the stretched area around it. */
    .club-card__link {
      display: flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

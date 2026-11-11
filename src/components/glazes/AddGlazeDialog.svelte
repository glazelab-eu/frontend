<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { lifetime } from '../../state/shared/lifetime';
  import { t, formatNumber } from '../../lib/i18n';
  import type { Club, Glaze, GlazeCreated, UploadTarget } from '../../lib/api/models';
  import type { GlazeInput } from '../../lib/api/inputs';
  import type { TagCount } from '../../lib/tags/tags';
  import { glazeTitle } from '../../lib/glazes/glazes';
  import { routeHref } from '../../lib/routing/routes';
  import ModalShell from '../ui/ModalShell.svelte';
  import LeaveDialog from '../layout/LeaveDialog.svelte';
  import GlazeForm from './GlazeForm.svelte';

  interface Props {
    accountId: string;
    /** The loaded listing; it already holds the new glaze when `onSubmit` resolves. */
    glazes: Glaze[];
    /** The account's clubs, whose shelves can hold the new glaze. */
    clubs?: Club[];
    /** Whether "I have this glaze" starts on (the stock page and scans). */
    shelf?: boolean;
    /** The shelf it starts on ("personal" or a club's ID): the one the host shows or its form or scan writes to. */
    owner?: string;
    tagCounts: TagCount[];
    online: boolean;
    /** Resolves to the created glaze and shelf entry, or null when it failed (the host shows `error`). */
    onSubmit: (input: GlazeInput) => Promise<GlazeCreated | null>;
    /** Why the last submit failed. */
    error?: string;
    /** A scanned barcode for the new glaze; it becomes the dialog's heading. */
    barcode?: string;
    /**
     * The glaze was added: the asking picker selects it. Called once, before the dialog closes;
     * `shelved` says it is on a shelf already.
     */
    onAdded?: (id: string, shelved: boolean) => void;
    /**
     * Keep the dialog open with its confirmation after adding, instead of closing it. A glaze that went
     * on a shelf always gets the confirmation.
     */
    confirm?: boolean;
    /** "Add a photo" in the confirmation; the host's upload dialog opens above this one. */
    onAddPhoto?: (target: UploadTarget) => void;
    /** Whether the confirmation offers "Record a combination with it" (not on the Studio page itself). */
    record?: boolean;
    /** What a duplicate offers beside "Open it" (the host's picker selects it). */
    existingAction?: { label: string; run: (glaze: Glaze) => void };
    /** Adds the barcode this dialog was opened for to an existing glaze (see `GlazeForm.scanned`); the host closes the dialog on success. */
    onTakeBarcode?: (glaze: Glaze) => Promise<void>;
    onClose: () => void;
    /** Takes focus when the control that opened the dialog is gone afterwards. */
    fallbackFocus?: () => void;
    /** Whether the form has unsaved input (bind it for the host's leave guard). */
    dirty?: boolean;
  }

  let {
    accountId,
    glazes,
    clubs = [],
    shelf = false,
    owner,
    tagCounts,
    online,
    onSubmit,
    error = '',
    barcode: scanned = '',
    onAdded,
    confirm = false,
    onAddPhoto,
    record = true,
    existingAction,
    onTakeBarcode,
    onClose,
    fallbackFocus,
    dirty = $bindable(false),
  }: Props = $props();

  /** The heading names the barcode this dialog was opened for; the field itself stays editable. */
  const openedFor = untrack(() => scanned);
  let barcode = $state(openedFor);
  let body = $state<HTMLElement>();
  let openLink = $state<HTMLAnchorElement>();
  let created = $state<GlazeCreated | null>(null);
  let confirmingClose = $state(false);
  const life = lifetime(() => accountId);

  onMount(() => {
    // After the shell has focused its close button: the first field is the manufacturer.
    void tick().then(() => {
      if (life.mounted() && !created) body?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
    });
    return () => {
      dirty = false;
    };
  });

  async function submit(input: GlazeInput) {
    const actor = accountId;
    const added = await onSubmit(input);
    if (!added) return false;
    // Dropped when the account changed or the dialog went away meanwhile.
    if (!life.current(actor)) return true;
    // The form goes away with its last state; nothing is unsaved any more.
    dirty = false;
    onAdded?.(added.id, added.stock.length > 0);
    if (confirm || added.stock.length) {
      created = added;
      void tick().then(() => openLink?.focus());
    } else onClose();
    return true;
  }

  function requestClose() {
    if (dirty && !created) confirmingClose = true;
    else onClose();
  }

  let title = $derived(openedFor ? $t('addGlaze.titleBarcode', { values: { barcode: openedFor } }) : $t('stock.newGlaze.title'));
  // The listing holds the glaze already; the answer itself covers a list that was replaced meanwhile.
  let addedGlaze = $derived(created && (glazes.find((glaze) => glaze.id === created!.id) ?? created.glaze));
  let shelved = $derived(created?.stock[0]);
</script>

<ModalShell
  title={created ? $t('addGlaze.addedTitle') : title}
  onClose={requestClose}
  {fallbackFocus}
  sheet
  wide>
  <div
    bind:this={body}
    class="add-glaze">
    {#if created}
      <p
        class="add-glaze__added"
        role="status">
        {glazeTitle(addedGlaze!)}
        {#if shelved}
          <small class="add-glaze__shelf">
            {shelved.clubName
              ? $t('addGlaze.onClubShelf', {
                  values: { club: shelved.clubName, quantity: $formatNumber(shelved.quantityG) },
                })
              : $t('addGlaze.onShelf', { values: { quantity: $formatNumber(shelved.quantityG) } })}
          </small>
        {/if}
      </p>
      <div class="button-row">
        <a
          bind:this={openLink}
          class="button button--primary add-glaze__action"
          href={routeHref({ name: 'glaze', id: created.id })}>
          {$t('addGlaze.open')}
        </a>
        {#if onAddPhoto}
          <button
            type="button"
            class="button add-glaze__action"
            onclick={() => onAddPhoto({ type: 'glaze', id: created!.id, title: glazeTitle(addedGlaze!) })}>
            {$t('addGlaze.addPhoto')}
          </button>
        {/if}
        {#if record}
          <a
            class="button add-glaze__action"
            href={routeHref({ name: 'studio', glaze: created.id })}>
            {$t('addGlaze.record')}
          </a>
        {/if}
        <button
          type="button"
          class="button add-glaze__action"
          onclick={onClose}>
          {$t('common.close')}
        </button>
      </div>
    {:else}
      <p class="add-glaze__hint">{$t('stock.newGlaze.hint')}</p>
      <GlazeForm
        {accountId}
        {glazes}
        {clubs}
        {shelf}
        {owner}
        {tagCounts}
        {online}
        onSubmit={submit}
        {existingAction}
        scanned={openedFor && onTakeBarcode ? { barcode: openedFor, run: onTakeBarcode } : undefined}
        {error}
        bind:dirty
        bind:barcode />
    {/if}
  </div>
</ModalShell>
{#if confirmingClose}
  <LeaveDialog
    message="drafts.discardGlaze"
    onStay={() => (confirmingClose = false)}
    onDiscard={onClose} />
{/if}

<style>
  .add-glaze__hint {
    margin: 0 0 var(--space-5);
    color: var(--muted);
    font-size: var(--font-base);
  }
  .add-glaze__added {
    margin: 0 0 var(--space-5);
    font-size: var(--font-md);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .add-glaze__shelf {
    display: block;
    margin-top: var(--space-1);
    color: var(--muted);
    font-size: var(--font-sm);
    font-weight: 400;
  }
  .add-glaze__action {
    text-decoration: none;
  }
</style>

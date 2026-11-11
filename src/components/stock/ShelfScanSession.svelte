<script lang="ts">
  import { untrack } from 'svelte';
  import { t, formatNumber } from '../../lib/i18n';
  import type { StockWrite } from '../../lib/api/inputs';
  import type { Club, Glaze, StockItem } from '../../lib/api/models';
  import { glazeTitle } from '../../lib/glazes/glazes';
  import {
    lookingUp,
    newShelfScan,
    nextShelfJar,
    sheetChanged,
    sheetInput,
    sheetQuickInput,
    sheetUsedUpInput,
    withShelfGlaze,
    withShelfOwner,
    type ShelfScan,
  } from '../../lib/stock/scan-sheet';
  import { entryFor, isAddition, targetClub } from '../../lib/stock/shelf';
  import { lifetime } from '../../state/shared/lifetime';
  import type { LeaveGuard } from '../../state/app/app-state';
  import BarcodeScanner from '../scanning/BarcodeScanner.svelte';
  import LeaveDialog from '../layout/LeaveDialog.svelte';
  import ScanSheet from './ScanSheet.svelte';

  interface Props {
    stock: StockItem[];
    clubs: Club[];
    online: boolean;
    /** The primitive account ID: answers that arrive after it changed are dropped. */
    accountId: string | undefined;
    /**
     * The shelf the session starts on ("personal" or a club's ID, the one the page shows); the sheet can change it per
     * jar. Without one, the personal shelf: a club is only ever chosen on purpose, never remembered from an earlier scan.
     */
    owner?: string;
    /** The scanner's title (the Stock page's by default, which names the sheet's shelf). */
    title?: string;
    /** A button beside the typed field for a way out of scanning, such as "Add without a barcode". */
    skip?: { label: string; run: () => void };
    /** Why the last save failed. */
    error: string;
    /** The glaze that has the barcode, or null. */
    findBarcode: (barcode: string) => Promise<Glaze | null>;
    /** Saves one sheet; true when it worked. */
    saveStock: (input: StockWrite) => Promise<boolean>;
    /** Opens the host's add-glaze dialog for an unknown code, on the session's shelf ("personal" or a club's ID). */
    openAdd: (barcode: string, owner: string) => void;
    registerLeaveGuard: (guard: LeaveGuard) => () => void;
    /** The session ended (closed or discarded); the host unmounts it. */
    onClose: () => void;
  }

  let { stock, clubs, online, accountId, owner, title, skip, error, findBarcode, saveStock, openAdd, registerLeaveGuard, onClose }: Props = $props();

  const life = lifetime(() => accountId);
  let session = $state<ShelfScan>(untrack(() => newShelfScan(targetClub(owner ?? 'personal', clubs) ? owner! : 'personal')));
  /** The scanner holds a code while its lookup, sheet or add-glaze dialog is open. */
  let holding = $state(false);
  let sheetBusy = $state(false);
  let confirmingClose = $state(false);
  let dirty = $derived(!!session.sheet && sheetChanged(session.sheet));
  let club = $derived(targetClub(session.owner, clubs));

  $effect(() => registerLeaveGuard({ dirty: () => dirty, message: 'drafts.discardShelfScan' }));

  function nextJar(note = '') {
    session = nextShelfJar(session, note);
    holding = false;
  }
  function end() {
    confirmingClose = false;
    onClose();
  }
  async function onBarcode(code: string) {
    const actor = accountId;
    session = lookingUp(session, code);
    const glaze = await findBarcode(code);
    // Drop the answer when the session or the account ended meanwhile.
    if (!life.current(actor)) return;
    if (glaze) session = withShelfGlaze(session, stock, glaze);
    else {
      session = { ...session, lookup: null };
      openAdd(code, session.owner);
    }
  }
  /** Runs one save of the sheet; the next jar follows when it worked. */
  async function save(input: ReturnType<typeof sheetInput>, glaze: Glaze) {
    if (sheetBusy || !online || !input) return;
    const actor = accountId;
    sheetBusy = true;
    try {
      if ((await saveStock(input)) && life.current(actor)) {
        // An addition says the server's total, which the listing holds now.
        const listed = entryFor(stock, input.glazeId, input.clubId ?? 'personal')?.quantityG;
        const quantity = isAddition(input) ? (listed ?? input.addG) : (input.quantityG ?? listed ?? 0);
        nextJar(
          $t(quantity > 0 ? 'stock.scan.saved' : 'stock.scan.savedUsedUp', {
            values: { glaze: glazeTitle(glaze), quantity: $formatNumber(quantity) },
          }),
        );
      }
    } finally {
      sheetBusy = false;
    }
  }

  /** The host's add-glaze dialog added a glaze: a shelved one is noted for the next jar. */
  export function added(glaze: Glaze | undefined, shelved: boolean) {
    if (glaze && shelved)
      session = {
        ...session,
        note: $t('stock.scan.added', { values: { glaze: glazeTitle(glaze) } }),
      };
  }
  /** The scanned code belongs to this glaze: take its sheet instead of adding one. */
  export function useGlaze(glaze: Glaze) {
    session = withShelfGlaze(session, stock, glaze);
  }
  /** The add-glaze dialog closed: the jar that opened it is dealt with, scan the next one. */
  export function addClosed() {
    if (holding) nextJar(session.note);
  }
</script>

<BarcodeScanner
  keepOpen
  sheet
  bind:holding
  title={title ?? (club ? $t('stock.scan.titleClub', { values: { club: club.name } }) : $t('stock.scan.title'))}
  {skip}
  note={session.note}
  onClose={() => (dirty ? (confirmingClose = true) : end())}
  {onBarcode}>
  {#snippet held()}
    {#if session.sheet && session.glaze}
      {@const glaze = session.glaze}
      <ScanSheet
        title={glazeTitle(glaze)}
        bind:sheet={session.sheet}
        {clubs}
        {online}
        busy={sheetBusy}
        {error}
        onOwner={(owner) => (session = withShelfOwner(session, stock, owner))}
        onSave={() => save(sheetInput(session.sheet!), glaze)}
        onQuick={() => save(sheetQuickInput(session.sheet!), glaze)}
        onUsedUp={() => save(sheetUsedUpInput(session.sheet!), glaze)}
        onSkip={() => nextJar()} />
    {:else if session.lookup}
      <p
        class="shelf-scan__looking"
        role="status">
        {$t('stock.scan.looking', { values: { barcode: session.lookup } })}
      </p>
    {/if}
  {/snippet}
</BarcodeScanner>
{#if confirmingClose}
  <LeaveDialog
    message="drafts.discardShelfScan"
    onStay={() => (confirmingClose = false)}
    onDiscard={end} />
{/if}

<style>
  .shelf-scan__looking {
    margin: 0;
    flex: 1 1 12rem;
    font-size: var(--font-sm);
    color: var(--muted);
    overflow-wrap: anywhere;
  }
</style>

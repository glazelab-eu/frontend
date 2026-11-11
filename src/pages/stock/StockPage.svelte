<script lang="ts">
  import { t, formatNumber, locale } from '../../lib/i18n';
  import PageHead from '../../components/ui/PageHead.svelte';
  import PanelTitle from '../../components/ui/PanelTitle.svelte';
  import SignInEmpty from '../../components/auth/SignInEmpty.svelte';
  import ShelfList from '../../components/stock/ShelfList.svelte';
  import ShelfScope from '../../components/stock/ShelfScope.svelte';
  import ShelfSelect from '../../components/stock/ShelfSelect.svelte';
  import ChipRow from '../../components/ui/ChipRow.svelte';
  import FilterChip from '../../components/ui/FilterChip.svelte';
  import BackLink from '../../components/ui/BackLink.svelte';
  import { backLabel } from '../../lib/routing/back-label';
  import { routeHref } from '../../lib/routing/routes';
  import GlazePicker from '../../components/glazes/GlazePicker.svelte';
  import FormError from '../../components/common/FormError.svelte';
  import OfflineNote from '../../components/common/OfflineNote.svelte';
  import AddGlazeDialog from '../../components/glazes/AddGlazeDialog.svelte';
  import { isPhone } from '../../lib/layout/viewport';
  import RouteStatus from '../../components/routing/RouteStatus.svelte';
  import type { AppController } from '../../state/app/app-controller';
  import { listStatus, refreshing, type FormName, formErrorFor } from '../../state/app/app-state';
  import { isLoading, progressOf } from '../../lib/sync/lifecycle';
  import RefreshHint from '../../components/common/RefreshHint.svelte';
  import { tick, untrack } from 'svelte';
  import { lifetime } from '../../state/shared/lifetime';
  import { createAddGlazeHost } from '../../state/catalog/add-glaze-host.svelte';
  import type { Glaze } from '../../lib/api/models';
  import { normalizeBarcode } from '../../lib/barcodes/barcodes';
  import { glazeMap, glazeTitle } from '../../lib/glazes/glazes';
  import {
    MAX_JAR_G,
    MAX_STOCK_G,
    entryFor,
    filterByOwner,
    formOwnerFor,
    shelfChoices,
    shelfOwnerFor,
    stockDraftFor,
    stockFormDirty,
    stockFormInput,
    stockFormTotal,
    targetClub,
    type StockDraft,
  } from '../../lib/stock/shelf';
  import BarcodeScanner from '../../components/scanning/BarcodeScanner.svelte';
  import ShelfScanSession from '../../components/stock/ShelfScanSession.svelte';

  interface Props {
    app: AppController;
    /** A barcode from the route (#/stock/<barcode>), handled like a scan once the data is loaded. */
    barcode?: string;
    /** A known glaze selected by a link from another add-glaze host. */
    glazeId?: string;
    /** The owner from the route (`?shelf=`): "personal" or a club's ID; unknown clubs show all shelves. */
    shelf?: string;
  }

  let { app, barcode, glazeId, shelf }: Props = $props();

  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let accountId = $derived(user?.id);
  let online = $derived($appStore.online);
  let stock = $derived($appStore.stock);
  let glazes = $derived($appStore.glazes);
  let clubs = $derived($appStore.clubs);
  // Once the form is shown, an empty shelf refresh must not unmount its local glaze draft.
  let shown = $state(false);
  /** Nothing of the account shown yet; a derived, so an update that leaves the sync state as it is runs nothing below. */
  let loadingNow = $derived(isLoading($appStore.sync));
  $effect(() => {
    if (!loadingNow) shown = true;
  });
  let loaded = $derived([...stock, ...glazes]);
  /** The shelf shown ("personal" or a club's ID), or undefined for all shelves. */
  let shelfOwner = $derived(shelfOwnerFor(shelf, clubs));
  let shownStock = $derived(filterByOwner(stock, shelfOwner));
  let choices = $derived(shelfChoices(stock, clubs, $locale ?? undefined));
  let ownerClub = $derived(shelfOwner && shelfOwner !== 'personal' ? clubs.find((club) => club.id === shelfOwner) : undefined);
  /** The header's shelf: without a club there is only the personal one. */
  let scope = $derived<{ kind: 'personal' } | { kind: 'club'; name: string } | { kind: 'all' }>(
    ownerClub ? { kind: 'club', name: ownerClub.name } : shelfOwner === 'personal' || !clubs.length ? { kind: 'personal' } : { kind: 'all' },
  );
  /** What an empty shown part of the shelf says: the chosen shelf's own sentence, as "your shelf is empty" would deny the others. */
  let emptyShelf = $derived(
    ownerClub
      ? $t('stock.shelves.emptyClub', { values: { club: ownerClub.name } })
      : shelfOwner === 'personal'
        ? $t('stock.shelves.emptyPersonal')
        : $t('stock.empty'),
  );
  /** A chip's link: the page's own link (glaze or barcode) stays, so the page is not mounted again and keeps its draft. */
  const chipHref = (owner: string | undefined) => routeHref({ name: 'stock', barcode, glaze: glazeId, shelf: owner });
  /** The club page this one was opened from (its shelf link), as a way back. */
  let fromClub = $derived($appStore.previousRoute?.name === 'club' ? $appStore.previousRoute : null);
  let fromClubLabel = $derived(fromClub ? backLabel(fromClub, [], [], $t, clubs) : null);
  /** The open add-glaze dialog, with the barcode it was opened for and the shelf it starts on. */
  const add = createAddGlazeHost<{ barcode?: string; owner: string }>(
    () => app,
    () => $appStore,
    () => accountId,
  );
  /** The dialog starts on the shelf the form writes to (the shown one, or one chosen in it), a scan session's on its own. */
  const openAdd = (barcode?: string, owner = stockOwner) => add.open({ barcode, owner });
  function closeAdd() {
    add.close();
    shelfScan?.addClosed();
  }
  /** The message of a failed submit of one of this page's forms. */
  const formError = (form: FormName) => formErrorFor($appStore, form);
  let glazesById = $derived(glazeMap(glazes));
  let stockForm = $state<HTMLElement>();
  let shelfList = $state.raw<ReturnType<typeof ShelfList>>();
  let showAllTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Focus in the stock form, however it got there (a person scrolling to it by hand too): every shelf row now, so rows still
   * to come cannot move the form above where the browser has no scroll anchoring (Safari). In a task of its own, as focus may
   * move inside an effect, where `showAll`'s `flushSync` must not run.
   */
  function showAllSoon() {
    clearTimeout(showAllTimer);
    showAllTimer = setTimeout(() => shelfList?.showAll());
  }
  $effect(() => () => clearTimeout(showAllTimer));
  function focusStockForm() {
    shelfList?.showAll();
    stockForm?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
    stockForm?.scrollIntoView({ block: 'start' });
  }
  let busy = $state(false);
  let stockGlaze = $state('');
  let stockOwner = $state(untrack(() => formOwnerFor(shelfOwner, clubs)));
  /** The picker's text, cleared with the glaze after a save. */
  let glazeText = $state('');
  /** The form's fields; choosing a glaze or shelf starts them from what that shelf holds. */
  let draft = $state<StockDraft>(stockDraftFor(undefined));
  let onSignIn = $derived(app.openAuth);
  /** What the stock form's owner already holds of the chosen glaze. */
  let entry = $derived(entryFor(stock, stockGlaze, stockOwner));
  let mode = $derived(entry ? draft.mode : 'set');
  let total = $derived(stockFormTotal(entry, { ...draft, mode }));
  /** The club the form writes to, named on its button; undefined for the personal shelf. */
  let formClub = $derived(targetClub(stockOwner, clubs));
  /** A glaze chosen and an amount or jar size typed that the form did not start with: leaving asks first. */
  let formDirty = $derived(!!stockGlaze && stockFormDirty(draft));
  $effect(() => app.registerLeaveGuard({ dirty: () => formDirty, message: 'drafts.discardShelfScan' }));

  // The shown shelf is where a new entry goes until a glaze is chosen (all shelves: the personal one, never a club
  // left from an earlier chip); later chip changes never touch a form that is being filled in. A club the account
  // left goes back to the shown shelf, or to the personal one once a glaze is chosen. The second effect is keyed by the
  // club IDs: a refresh that lists the clubs again never undoes a shelf the person chose in the form.
  $effect(() => {
    const owner = shelfOwner;
    untrack(() => {
      if (!stockGlaze) stockOwner = formOwnerFor(owner, clubs);
    });
  });
  let clubIds = $derived(clubs.map((club) => club.id).join(' '));
  $effect(() => {
    void clubIds;
    untrack(() => {
      if (stockOwner !== 'personal' && !targetClub(stockOwner, clubs)) chooseEntry(stockGlaze, stockGlaze ? 'personal' : formOwnerFor(shelfOwner, clubs));
    });
  });

  /** Chooses the glaze and/or shelf of the form and fills the fields from the entry found there. */
  function chooseEntry(glazeId = stockGlaze, owner = stockOwner) {
    stockGlaze = glazeId;
    stockOwner = owner;
    draft = stockDraftFor(entryFor(stock, glazeId, owner));
  }

  let scanning = $state(false);
  let finding = $state(false);
  /** The last scan: its glaze, now chosen in the stock form, or none (the add-glaze dialog has it). */
  let scanned = $state<{ barcode: string; glaze: Glaze | null } | null>(null);
  let quantityInput = $state<HTMLInputElement>();
  const life = lifetime(() => $appStore.user?.id);

  async function useBarcode(code: string) {
    scanning = false;
    if (finding) return;
    const actor = user?.id;
    finding = true;
    try {
      const glaze = await app.findBarcode(code);
      // Drop the answer when the page or the account changed meanwhile.
      if (!life.current(actor)) return;
      scanned = { barcode: code, glaze };
      if (glaze) {
        chooseEntry(glaze.id);
        await tick();
        shelfList?.showAll();
        quantityInput?.focus();
      } else openAdd(code);
    } finally {
      finding = false;
    }
  }

  async function chooseStockGlaze(id: string) {
    const actor = user?.id;
    if (!actor || !glazesById.has(id)) return;
    chooseEntry(id);
    await tick();
    if (!life.current(actor)) return;
    shelfList?.showAll();
    quantityInput?.focus();
    quantityInput?.scrollIntoView({ block: 'center' });
  }

  /** The scan-first session is open (phones); `shelfScan` is its mounted component. */
  let scanSession = $state(false);
  let shelfScan = $state.raw<ReturnType<typeof ShelfScanSession> | null>(null);

  /** Below 720 px a scan opens the session; wider screens keep filling the form. */
  function startScan() {
    if (isPhone()) scanSession = true;
    else scanning = true;
  }
  function closeScan() {
    scanSession = false;
    app.clearFormError();
  }

  let routeBarcodeUsed = false;
  let routeGlazeUsed = false;
  let previousAccount = untrack(() => accountId);
  $effect(() => {
    if (accountId === previousAccount) return;
    previousAccount = accountId;
    chooseEntry('', formOwnerFor(shelfOwner, clubs));
    glazeText = '';
    scanned = null;
    scanning = false;
    if (scanSession) closeScan();
    routeBarcodeUsed = routeGlazeUsed = false;
  });
  $effect(() => {
    if (routeGlazeUsed || !glazeId || !user || loadingNow) return;
    routeGlazeUsed = true;
    void chooseStockGlaze(glazeId);
  });
  $effect(() => {
    if (routeBarcodeUsed || !barcode || !user || loadingNow) return;
    routeBarcodeUsed = true;
    const code = normalizeBarcode(barcode);
    if (code) void useBarcode(code);
  });
  async function onSaveStock() {
    const input = stockFormInput(stockGlaze, stockOwner, entry, { ...draft, mode });
    if (busy || !online || !input) return;
    busy = true;
    try {
      // The draft clears only when the save worked.
      if (await app.saveStock(input)) {
        chooseEntry('');
        glazeText = '';
        scanned = null;
      }
    } finally {
      busy = false;
    }
  }
</script>

{#if fromClub}
  <BackLink
    href={routeHref(fromClub)}
    label={fromClubLabel ?? $t('nav.clubs')}
    onBack={() => app.back(fromClub)} />
{/if}
<PageHead
  eyebrow={$t('stock.eyebrow')}
  title={$t('stock.title')}
  description={$t('stock.intro')} />
{#if user}
  <!-- Before the account's data arrives the clubs are unknown, so the header would name the wrong shelf. -->
  {#if shown}<ShelfScope {scope} />{/if}
  {#if choices.length}
    <div class="stock-shelves">
      <ChipRow
        label={$t('stock.shelves.label')}
        active={shelfOwner}>
        {#each choices as choice (choice.owner ?? 'all')}
          <FilterChip
            label={choice.owner === undefined ? $t('stock.shelves.all') : (choice.clubName ?? $t('stock.owner.me'))}
            count={choice.count}
            active={choice.owner === shelfOwner}
            href={chipHref(choice.owner)} />
        {/each}
      </ChipRow>
    </div>
  {/if}
  <div class="button-row stock-entry-actions">
    <button
      type="button"
      class="button button--primary"
      onclick={startScan}>
      {$t('stock.scan.button')}
    </button>
    <button
      type="button"
      class="button"
      disabled={!stockForm}
      onclick={focusStockForm}>
      {$t('addGlaze.action')}
    </button>
  </div>
{/if}
{#if !user}
  <SignInEmpty
    title={$t('stock.signIn')}
    description={$t('stock.list.hint')}
    {onSignIn} />
{:else if !shown && listStatus(loadingNow, loaded) === 'loading'}
  <RouteStatus
    status="loading"
    progress={progressOf($appStore.sync)} />
{:else}
  <div class="layout-columns">
    {#if stock.length}
      <section class="panel stock-list">
        <PanelTitle title={$t('stock.list.title')} />
        <RefreshHint refreshing={refreshing(loadingNow, loaded)} />
        <ShelfList
          bind:this={shelfList}
          stock={shownStock}
          empty={emptyShelf}
          {glazesById}
          clubMembers={$appStore.clubMembers}
          userId={user.id}
          {online}
          onSave={(input) => app.saveStock(input, true)}
          onRemove={async (id) => {
            const removed = await app.removeStock(id);
            if (removed && !$appStore.stock.length) {
              await tick();
              focusStockForm();
            }
            return removed;
          }}
          onKeepPrivate={app.setKeepPrivate} />
      </section>
    {/if}
    <section
      class="panel stock-form"
      bind:this={stockForm}
      onfocusin={showAllSoon}>
      <PanelTitle title={$t('stock.form.title')} />
      {#if !stock.length}<p class="panel__message">{emptyShelf}</p>{/if}
      <form
        onsubmit={(event) => {
          event.preventDefault();
          onSaveStock();
        }}>
        <div class="stock-scan">
          <button
            type="button"
            class="button stock-scan__button"
            disabled={finding}
            onclick={(event) => {
              event.preventDefault();
              startScan();
            }}>
            {$t('barcodes.scan')}
          </button>
          {#if scanned}
            <p
              class="stock-scan__result"
              role="status">
              {scanned.glaze
                ? $t('barcodes.stock.found', { values: { glaze: glazeTitle(scanned.glaze) } })
                : $t('barcodes.stock.unknown', { values: { barcode: scanned.barcode } })}
            </p>
            {#if !scanned.glaze}
              {@const code = scanned.barcode}
              <button
                type="button"
                class="button"
                onclick={() => openAdd(code)}>
                {$t('barcodes.discover.add')}
              </button>
            {/if}
          {/if}
        </div>
        <GlazePicker
          {glazes}
          selectedId={stockGlaze}
          onSelect={(id) => chooseEntry(id)}
          bind:text={glazeText}
          label={$t('common.glaze')}
          placeholder={$t('stock.form.glazePlaceholder')}
          onAdd={() => openAdd()} />
        {#if entry}
          <fieldset class="stock-mode">
            <legend class="stock-mode__legend">{$t('stock.form.mode')}</legend>
            <label class="stock-mode__option">
              <input
                type="radio"
                name="stock-mode"
                value="set"
                bind:group={draft.mode} />
              {$t('stock.form.modeSet')}
            </label>
            <label class="stock-mode__option">
              <input
                type="radio"
                name="stock-mode"
                value="jar"
                bind:group={draft.mode} />
              {$t('stock.form.modeJar')}
            </label>
          </fieldset>
        {/if}
        <ShelfSelect
          value={stockOwner}
          {clubs}
          onChange={(owner) => chooseEntry(stockGlaze, owner)} />
        <div class="stock-fields">
          {#if mode === 'set'}
            <label class="form-field">
              {$t('stock.form.quantity')}
              <input
                bind:this={quantityInput}
                class="form-field__control"
                type="number"
                inputmode="numeric"
                min="0"
                max={MAX_STOCK_G}
                step="1"
                bind:value={draft.amount}
                required />
            </label>
          {/if}
          <label class="form-field">
            {mode === 'jar' ? $t('stock.form.jarAdd') : $t('stock.form.jarSize')}
            {#if mode === 'set'}
              <span class="form-field__optional">
                ({$t('common.optional')})
              </span>
            {/if}
            <input
              class="form-field__control"
              type="number"
              inputmode="numeric"
              min="1"
              max={MAX_JAR_G}
              step="1"
              bind:value={draft.jar}
              required={mode === 'jar'} />
          </label>
        </div>
        {#if entry}
          <p
            class="stock-scan__current"
            role="status">
            {mode === 'jar' && total !== null
              ? $t('stock.form.total', { values: { quantity: $formatNumber(total) } })
              : $t('stock.form.current', { values: { quantity: $formatNumber(entry.quantityG) } })}
          </p>
        {/if}
        <OfflineNote {online} />
        <FormError message={formError('stock')} />
        <button
          class="button button--primary"
          disabled={busy || !online}>
          {#if formClub}
            {$t(entry ? 'stock.target.updateClub' : 'stock.target.addClub', { values: { club: formClub.name } })}
          {:else}
            {$t(entry ? 'stock.target.update' : 'stock.target.add')}
          {/if}
        </button>
      </form>
    </section>
  </div>
{/if}
{#if scanning && user}
  <BarcodeScanner
    title={$t('barcodes.scanner.stockTitle')}
    onClose={() => (scanning = false)}
    onBarcode={useBarcode} />
{/if}
{#if scanSession && user}
  <ShelfScanSession
    bind:this={shelfScan}
    {stock}
    {clubs}
    {online}
    {accountId}
    owner={shelfOwner}
    error={formError('stock')}
    findBarcode={app.findBarcode}
    saveStock={app.saveStock}
    {openAdd}
    registerLeaveGuard={app.registerLeaveGuard}
    onClose={closeScan} />
{/if}
{#if add.target && user}
  <AddGlazeDialog
    {...add.props}
    shelf
    owner={add.target.owner}
    barcode={add.target.barcode}
    onAdded={(id, shelved) => {
      if (shelfScan) return shelfScan.added(glazesById.get(id), shelved);
      // On the shelf already: nothing is left to fill in for it.
      if (!shelved) void chooseStockGlaze(id);
    }}
    existingAction={{
      label: $t('glazeForm.addToShelf'),
      run: (glaze) => {
        if (shelfScan) {
          // The scanned code belongs to another glaze: take its sheet instead.
          add.close();
          return shelfScan.useGlaze(glaze);
        }
        closeAdd();
        void chooseStockGlaze(glaze.id);
      },
    }}
    onClose={closeAdd}
    bind:dirty={add.dirty} />
{/if}

<style>
  .stock-list {
    /* A grid item is as wide as its widest content by default; long glaze titles wrap instead. */
    min-width: 0;
  }
  .stock-shelves {
    /* The chip row's own flex rules (a line that scrolls sideways on phones) need a flex parent. */
    display: flex;
    margin-bottom: var(--space-4);
  }
  .stock-entry-actions {
    display: none;
  }
  @media (width < 45em) {
    /* On phones scanning leads the page; the form keeps its own fields. */
    .stock-entry-actions {
      display: flex;
      width: 100%;
      margin-bottom: var(--space-4);
    }
    .stock-scan__button {
      display: none;
    }
  }
  .stock-form {
    scroll-margin-top: calc(var(--header-height) + var(--space-4));
  }
  .stock-scan {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin-bottom: var(--space-4);
  }
  .stock-scan__result {
    margin: 0;
    flex: 1 1 12rem;
    font-size: var(--font-sm);
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .stock-scan__current {
    margin: calc(-1 * var(--space-2)) 0 var(--space-4);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  .stock-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    /* A label that wraps (or carries the optional hint) must not push its input below its neighbours': inputs share the row's bottom. */
    align-items: end;
    gap: 0 var(--space-4);
  }
  .stock-mode {
    margin: 0 0 var(--space-4);
    padding: 0;
    border: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-5);
  }
  .stock-mode__legend {
    padding: 0;
    margin-bottom: var(--space-1);
    font-size: var(--font-base);
    font-weight: 550;
  }
  .stock-mode__option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target);
    font-size: var(--font-base);
  }
  @media (pointer: coarse) {
    .stock-scan__current {
      font-size: var(--font-body);
    }
  }
</style>

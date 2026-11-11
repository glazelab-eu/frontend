<script lang="ts">
  import { locale, t } from '../../lib/i18n';
  import PageHead from '../../components/ui/PageHead.svelte';
  import GlazeRow from '../../components/glazes/GlazeRow.svelte';
  import CombinationCard from '../../components/combinations/CombinationCard.svelte';
  import PagedGrid from '../../components/explore/PagedGrid.svelte';
  import type { AppController } from '../../state/app/app-controller';
  import type { Glaze } from '../../lib/api/models';
  import { isPhone, phoneMedia } from '../../lib/layout/viewport';
  import { glazeThumbnail } from '../../lib/images/pictures';
  import {
    quickLabels,
    activeSort,
    explicitSort,
    sortLabel,
    sortOptions,
    routeHref,
    type Sort,
    type DiscoverFilters,
    type DiscoverRoute,
  } from '../../lib/routing/routes';
  import { glazeMap, glazeTitle, warmSearch } from '../../lib/glazes/glazes';
  import {
    explore,
    exploreKey,
    photoBrowse,
    almostRoute,
    shelfOptionRoute,
    firingApplies,
    firingRoute,
    published,
    combinationsOfGlazeRoute,
    glazeCombinationsRoute,
    isLibraryEmpty,
    isWaiting,
    isWaitingGlaze,
    newDays,
    quickRoute,
    shelfStockRoute,
    typeRoute,
  } from '../../lib/explore/explore';
  import RouteStatus from '../../components/routing/RouteStatus.svelte';
  import { warmOrder } from '../../lib/explore/listing';
  import ChipRow from '../../components/ui/ChipRow.svelte';
  import ExploreFilters from '../../components/explore/ExploreFilters.svelte';
  import Icon from '../../components/ui/Icon.svelte';
  import ModalShell from '../../components/ui/ModalShell.svelte';
  import ExploreWelcome from '../../components/explore/ExploreWelcome.svelte';
  import { introDone, introSteps, readIntroDismissal, rememberIntroDismissal } from '../../lib/explore/audience';
  import RefreshHint from '../../components/common/RefreshHint.svelte';
  import { formErrorFor, listStatus, refreshing } from '../../state/app/app-state';
  import { isLoading, progressOf } from '../../lib/sync/lifecycle';
  import { createAddGlazeHost } from '../../state/catalog/add-glaze-host.svelte';
  import TagList from '../../components/tags/TagList.svelte';
  import QuickViews from '../../components/explore/QuickViews.svelte';
  import FilterChip from '../../components/ui/FilterChip.svelte';
  import { buildTagIndex } from '../../lib/tags/tags';
  import { atmosphereName, conesOf } from '../../lib/firing/firing';
  import { quickAddInput, shelfEntryIds, shelfScope, shelfToCompare } from '../../lib/stock/shelf';
  import { availabilityByGlaze, availabilityText } from '../../lib/stock/availability';
  import { availabilityDate, buddyHolders } from '../../lib/stock/buddy-shelf';
  import { readIncludeBuddies, readIncludeClubs, rememberIncludeBuddies, rememberIncludeClubs } from '../../lib/buddies/include';
  import { onMount, tick, untrack } from 'svelte';
  import { lifetime } from '../../state/shared/lifetime';
  import BarcodeScanner from '../../components/scanning/BarcodeScanner.svelte';
  import { addStartHere } from '../../lib/barcodes/add-flow';
  import ShelfScanSession from '../../components/stock/ShelfScanSession.svelte';
  import AddGlazeDialog from '../../components/glazes/AddGlazeDialog.svelte';

  interface Props {
    app: AppController;
    /** The type (all, combinations or glazes) and every search and filter, so each list has its own link. */
    route: DiscoverRoute;
  }

  let { app, route }: Props = $props();
  let type = $derived(route.type);
  let sort = $derived(activeSort(route.sort, type));
  let orders = $derived(sortOptions(type));

  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let accountId = $derived(user?.id);
  let online = $derived($appStore.online);
  let glazes = $derived($appStore.glazes);
  let combinations = $derived($appStore.combinations);
  let glazesById = $derived(glazeMap(glazes));
  let favorites = $derived($appStore.favorites);
  /** One lookup per card instead of a search of the favourites. */
  let favoriteGlazes = $derived(new Set(favorites.glazeIds));
  let favoriteCombinations = $derived(new Set(favorites.combinationIds));
  // Read through deriveds, like the listings and `accountId` (a load replaces the `user` object): a store update that leaves them as they are (a toast) derives nothing.
  let stock = $derived($appStore.stock);
  let buddies = $derived($appStore.buddies);
  let buddyAvailability = $derived($appStore.buddyAvailability);
  let favoriteCounts = $derived($appStore.favoriteCounts);
  /** The sync state: a new object only when the phase or failure changes (`lib/sync/lifecycle.ts`). */
  let sync = $derived($appStore.sync);
  let syncProgress = $derived(progressOf(sync));
  /** Accounts whose intro card was dismissed on this page (the device may fail to remember it). */
  let dismissedHere = $state<string[]>([]);
  // Derived, not set from an effect: the card must be there in the first render, or it would push
  // the list down after PagedGrid has restored its scroll position.
  let introDismissed = $derived(!!accountId && (dismissedHere.includes(accountId) || readIntroDismissal(accountId)));
  // Primitives of the account, so a load that replaces the `user` object does not build the steps again.
  let avatarId = $derived(user?.avatarId ?? null);
  let diagnosticsOptIn = $derived(user?.diagnosticsOptIn ?? false);
  let steps = $derived(introSteps(stock, combinations, $appStore.clubs, { avatarId, diagnosticsOptIn }));
  let introReady = $derived(!!user && sync.phase !== 'loading' && !sync.failure);
  let returning = $derived(introDismissed || introDone(steps));
  let showIntro = $derived(introReady && !returning);
  function dismissIntro() {
    if (!user) return;
    dismissedHere = [...dismissedHere, user.id];
    rememberIntroDismissal(user.id);
  }
  /** Selected tags; an item must carry all of them. */
  let tagFilter = $derived(route.tags ?? []);
  /** The glaze in the link, while it is in the loaded library (a removed one filters nothing). */
  let filterGlaze = $derived(route.glaze ? glazesById.get(route.glaze) : undefined);
  let glazeText = $state('');
  let tagText = $state('');
  let filterSheet = $state(false);
  // Known in the first render: pickers swapped for the filter button later would shift the list.
  let mobile = $state(isPhone());
  let searchInput = $state<HTMLInputElement>();
  let filtersButton = $state<HTMLButtonElement>();
  /** The final-firing filters apply to combinations, so not to the Glazes list. */
  let firingFilters = $derived(firingApplies(type));
  let coneFilter = $derived(firingFilters ? route.cone : undefined);
  let atmosphereFilter = $derived(firingFilters ? route.atmosphere : undefined);
  let cones = $derived(conesOf(published(combinations)));

  // A breakpoint change moves the same page-owned picker text to the inline controls.
  onMount(() =>
    phoneMedia((phone) => {
      mobile = phone;
      if (!phone) filterSheet = false;
    }),
  );
  $effect(() => {
    accountId;
    filterSheet = false;
    tagText = '';
    glazeText = '';
  });

  /** Committed changes (a tag, the glaze, a toggle) are history entries; typing replaces one. */
  function setFilters(changes: Partial<DiscoverFilters>, { replace = false } = {}) {
    app.navigate({ ...route, ...changes }, { replace });
  }

  let transitionNote = $state('');
  let transitionRoute = $state('');
  function changeView(next: DiscoverRoute) {
    const removed = [
      route.quick && !next.quick ? $t(quickLabels[route.quick]) : '',
      route.cone && !next.cone ? $t('firing.line.cone', { values: { cone: route.cone } }) : '',
      route.atmosphere && !next.atmosphere ? $t(atmosphereName(route.atmosphere)) : '',
      route.sort && !next.sort ? $t(sortLabel(route.sort, route.type)) : '',
    ].filter(Boolean);
    transitionNote = removed.length ? $t('discover.filters.removed', { values: { filters: new Intl.ListFormat($locale ?? 'en').format(removed) } }) : '';
    transitionRoute = routeHref(next);
    app.navigate(next);
  }
  function clearFilters() {
    clearTimeout(queryTimer);
    queryTimer = undefined;
    query = '';
    sentQuery = '';
    transitionNote = '';
    tagText = '';
    glazeText = '';
    filterSheet = false;
    app.navigate({ name: 'discover' });
    const field = searchInput;
    void tick().then(() => {
      if (field?.isConnected) field.focus();
    });
  }
  /** Where a removed chip stood, until the page shows the route without it (a pushed route arrives with `hashchange`, after any tick). */
  let removedChip: { at: number; box: Element | null; dialog: Element | null } | null = null;
  function removeChip(button: HTMLElement, remove: () => void) {
    const box = button.closest('.active-filters');
    removedChip = { at: [...(box?.querySelectorAll('.tag-list__remove') ?? [])].indexOf(button), box, dialog: button.closest('[role="dialog"]') };
    remove();
  }
  /** The removed button took focus with it: on to the chip in its place, else what is left of the summary, else the sheet's Close or the filter control. */
  $effect(() => {
    route;
    if (!removedChip) return;
    const { at, box, dialog } = removedChip;
    removedChip = null;
    const kept = box?.isConnected ? box : null;
    const chips = kept?.querySelectorAll<HTMLElement>('.tag-list__remove') ?? [];
    (chips[Math.min(at, chips.length - 1)] ?? kept?.querySelector('button') ?? dialog?.querySelector('button') ?? filtersButton ?? searchInput)?.focus();
  });
  /** Something narrows the list; an order alone does not (it hides nothing), so a sort by itself shows no summary and no Clear filters. */
  let narrowed = $derived(!!(route.type || route.quick || route.q || route.tags?.length || route.glaze || route.cone || route.atmosphere));
  /**
   * The search box follows typing at once; the link follows after a pause (or when the box loses
   * focus), replacing its entry. Back/forward and links change the route, which sets the box again.
   */
  let query = $state(untrack(() => route.q ?? ''));
  let sentQuery = untrack(() => route.q ?? '');
  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const q = route.q ?? '';
    untrack(() => {
      if (q === sentQuery) return;
      sentQuery = q;
      query = q;
    });
  });
  function sendQuery() {
    clearTimeout(queryTimer);
    queryTimer = undefined;
    const q = query.trim();
    if (q === sentQuery) return;
    sentQuery = q;
    setFilters({ q: q || undefined }, { replace: true });
  }
  function typed() {
    clearTimeout(queryTimer);
    queryTimer = setTimeout(sendQuery, 400);
  }
  // A pending update is dropped on unmount: by then the history entry belongs to the next page.
  onMount(() => () => clearTimeout(queryTimer));
  let shelf = $derived(shelfScope(stock, {}).stock);
  // The first key of a search finds every item's text ready.
  $effect(() => warmSearch(glazes, combinations, glazesById));
  // A-Z finds the listing sorted.
  $effect(() => warmOrder(glazes, combinations));
  // One per listing, whichever page instance asks; filtering intersects its lists.
  let glazeIndex = $derived(buildTagIndex(glazes));
  let combinationIndex = $derived(buildTagIndex(combinations));

  /** The glazes with an entry on the personal shelf (used up or not), built once per list: the rows without one offer the one-click add. */
  let personalEntries = $derived(shelfEntryIds(stock.filter((item) => !item.clubId)));
  /** The glaze whose one-click add failed last: its row shows the stock form's error. */
  let quickFailed = $state<string | null>(null);
  async function quickAdd(glazeId: string) {
    const input = quickAddInput(glazeId);
    if (!input) return false;
    quickFailed = null;
    const saved = await app.saveStock(input, false, 'notices.shelfAdded');
    if (!saved) quickFailed = glazeId;
    return saved;
  }
  /** Combination cards compare with it, once the account has stocked anything. */

  /**
   * The remembered choices, per account on this device, off by default, known in the first render (the list below depends on
   * them): "Include buddies" and "Include club glazes" (shared by "Available to me" and "I can make now").
   * A link's explicit value for availability wins (`route.buddies`, `route.clubs`).
   */
  let includeChoice = $state<{ account: string | undefined; buddies: boolean; clubs: boolean }>(
    untrack(() => ({ account: accountId, buddies: !!accountId && readIncludeBuddies(accountId), clubs: !!accountId && readIncludeClubs(accountId) })),
  );
  // A switch of accounts reads the new account's choices; the first render already has them.
  let remembered = $derived(
    includeChoice.account === accountId
      ? includeChoice
      : { buddies: !!accountId && readIncludeBuddies(accountId), clubs: !!accountId && readIncludeClubs(accountId) },
  );
  let includeBuddies = $derived(route.buddies ?? remembered.buddies);
  let includeClubs = $derived(route.clubs ?? remembered.clubs);
  // Sign-out removed the device flags of the account (27-7): the same account signing in again on this page starts from the defaults.
  $effect(() => {
    if (accountId) return;
    dismissedHere = [];
    includeChoice = { account: undefined, buddies: false, clubs: false };
  });
  /** A source change is a link (history entry, reload, Back) and a remembered preference. */
  function setIncludeBuddies(on: boolean) {
    if (!accountId) return;
    includeChoice = { ...remembered, account: accountId, buddies: on };
    rememberIncludeBuddies(accountId, on);
    app.navigate(shelfOptionRoute({ ...route, clubs: includeClubs }, { buddies: on }));
  }
  function setIncludeClubs(on: boolean) {
    if (!accountId) return;
    includeChoice = { ...remembered, account: accountId, clubs: on };
    rememberIncludeClubs(accountId, on);
    app.navigate(shelfOptionRoute({ ...route, buddies: includeBuddies }, { clubs: on }));
  }
  /** Who has which glaze, among the accepted buddies; the switch decides whether the availability views count them. */
  let holders = $derived(buddyHolders(buddyAvailability, buddies, new Intl.Collator($locale ?? 'en')));
  let hasBuddies = $derived(buddies.buddies.length > 0);
  let buddiesCounted = $derived(!!user && hasBuddies && includeBuddies);
  /** A club shelf has an entry: "Include club glazes" is offered. */
  let hasClubEntries = $derived(stock.some((item) => !!item.clubId));
  let clubsCounted = $derived(!!user && hasClubEntries && includeClubs);
  let result = $derived(
    explore({
      glazes,
      combinations,
      glazesById,
      glazeIndex,
      combinationIndex,
      filters: { ...route, glaze: filterGlaze?.id },
      favoriteCounts,
      favorites: accountId ? favorites : null,
      stock,
      buddyHolders: buddiesCounted ? holders : undefined,
      includeClubs: clubsCounted,
      hasSharedSources: hasBuddies || hasClubEntries,
    }),
  );
  let quick = $derived(result.quick);
  let filterCount = $derived(
    tagFilter.length +
      Number(!!filterGlaze) +
      Number(!!coneFilter) +
      Number(!!atmosphereFilter) +
      Number(!!type) +
      Number(quick !== 'all') +
      Number(!!route.q) +
      Number(result.almost) +
      Number(quick === 'shelf' && result.shelfStock !== 'stock') +
      Number((quick === 'available' || quick === 'canMake') && clubsCounted) +
      Number((quick === 'available' || quick === 'canMake') && buddiesCounted),
  );
  let cardShelf = $derived(accountId ? (quick === 'canMake' ? shelfScope(stock, { clubs: clubsCounted }).stock : shelfToCompare(stock)) : undefined);
  /** Combination cards of "I can make now" with buddies say who has the glazes the shelf lacks. */
  let cardBuddies = $derived(
    quick === 'canMake' && buddiesCounted
      ? {
          holders,
          asOf: $appStore.online ? undefined : availabilityDate(buddyAvailability, $locale ?? 'en'),
          onAsk: app.shareMessage,
        }
      : undefined,
  );
  /** The glazes of the shelf view's own scope (personal, plus the clubs'): a buddy's mark is only for glazes outside it. */
  let ownScope = $derived(shelfScope(stock, { clubs: quick === 'available' && clubsCounted }).stock);
  /** Where Available to me counts club stock, the clubs a glaze only club shelves hold is available in (a row's mark). */
  let clubAvailability = $derived(
    quick === 'available' && clubsCounted ? availabilityByGlaze(stock, $appStore.clubs, { clubs: true, locale: $locale ?? 'en' }) : undefined,
  );
  const clubMark = (glazeId: string) => {
    const availability = clubAvailability?.get(glazeId);
    return availability && !availability.personal ? availabilityText(availability, $t, $locale ?? 'en') : undefined;
  };
  /** The buddies behind a glaze of the shelf view that the account's own scope lacks, with the Ask action. */
  const buddyOf = (glazeId: string) => {
    const buddies = (quick === 'shelf' || quick === 'available') && buddiesCounted && !ownScope.has(glazeId) ? holders.get(glazeId) : undefined;
    return buddies && { buddies, onAsk: app.shareMessage };
  };
  /** The active view always explains its own scope, including saved buddy data offline. */
  let quickNote = $derived.by(() => {
    if (quick !== 'shelf' && quick !== 'available' && quick !== 'canMake') return undefined;
    const clubs = $appStore.clubs.map((club) => club.name).sort((a, b) => a.localeCompare(b, $locale ?? 'en'));
    const names = [$t('discover.quick.personalShelf'), ...(quick !== 'shelf' && clubsCounted ? clubs : [])];
    const shelves =
      quick === 'shelf'
        ? $t('discover.shelf.scope.personal')
        : $t('discover.quick.shelves', {
            values: { shelves: new Intl.ListFormat($locale ?? 'en', { type: 'conjunction' }).format(names) },
          });
    const parts = [shelves];
    if (buddiesCounted) {
      if (quick !== 'shelf') {
        parts.push(
          $t('discover.buddies.counted', {
            values: {
              names: new Intl.ListFormat($locale ?? 'en', { type: 'conjunction' }).format(buddies.buddies.map((buddy) => buddy.displayName)),
            },
          }),
        );
        if (!holders.size) parts.push($t('discover.buddies.noneYet'));
      }
      if (!$appStore.online) parts.push($t('buddies.shelf.asOf', { values: { date: availabilityDate(buddyAvailability, $locale ?? 'en') ?? '' } }));
    }
    return parts.join(' · ');
  });
  let ownCombinations = $derived(combinations.filter((combination) => combination.own));
  let hasFavorites = $derived(favorites.glazeIds.length + favorites.combinationIds.length > 0);
  let hasShelf = $derived(shelfScope(stock, { clubs: clubsCounted, buddies: buddiesCounted ? holders.keys() : undefined }).stock.size > 0);
  /** Any shelf entry, also a used up one: "On my shelf" then offers its parts. */
  let hasEntries = $derived(stock.some((item) => !item.clubId));
  const shelfStockLabels = { stock: 'discover.shelfStock.stock', used: 'discover.shelfStock.used', all: 'discover.shelfStock.all' } as const;
  let revealedPhotos = $state('');
  let revealKey = $derived(`${accountId ?? 'guest'}:${routeHref(route)}`);
  /** The history entry keeps only the route (history holds no account data); the account is part of the in-memory key. */
  let photosRevealed = $derived(revealedPhotos === revealKey || history.state?.glazelabExplorePhotos === routeHref(route));
  let browsing = $derived(photoBrowse(result.items, route, quick, photosRevealed));
  let items = $derived(browsing.items);
  function revealWithoutPhotos() {
    revealedPhotos = revealKey;
    history.replaceState({ ...history.state, glazelabExplorePhotos: routeHref(route) }, '');
  }
  let counts = $derived(result.counts);
  /** Tags of the shown items, most frequent first, so choices never end empty. */
  let tagCounts = $derived(result.tagCounts);
  let typeLinks = $derived([
    { type: undefined, label: $t('discover.type.all'), count: counts.all },
    { type: 'combinations', label: $t('discover.type.combinations'), count: counts.combinations },
    { type: 'glazes', label: $t('discover.type.glazes'), count: counts.glazes },
  ] as const);
  let heading = $derived(
    type === 'combinations' ? $t('discover.type.combinations') : type === 'glazes' ? $t('discover.type.glazes') : $t('discover.type.allTitle'),
  );
  /** One text, so a wrapped line needs no indent and no space between elements; each "·" stays with the part it introduces. */
  let summaryText = $derived(
    [
      $t('discover.filters.summary', { values: { type: heading, view: $t(quickLabels[quick]) } }),
      route.q && $t('discover.filters.search', { values: { query: route.q } }),
      route.sort && $t(sortLabel(route.sort, type)),
      quick === 'shelf' && $t(shelfStockLabels[result.shelfStock]),
      result.almost && $t('discover.quick.almost'),
    ]
      .filter(Boolean)
      .join(' ·\u00a0'),
  );
  /** Any change of search, filters or type in the link starts the list again at its first page. */
  let filterKey = $derived(routeHref(route));
  /** Either listing with items (no copy of the library): the page shows "loading" only until something is loaded, then keeps it. */
  let loaded = $derived(glazes.length ? glazes : combinations);
  let loading = $derived(listStatus(isLoading(sync), loaded) === 'loading');
  /** Nothing of the shown types exists yet, as opposed to nothing matching the filters. */
  let libraryEmpty = $derived(isLibraryEmpty(type, glazes, combinations));

  /** The add-glaze dialog, open for a glaze the library lacks; `barcode` is a scan it was opened for. */
  const add = createAddGlazeHost<{ barcode?: string; owner?: string }>(
    () => app,
    () => $appStore,
    () => accountId,
  );
  /** Explore's own buttons start on the personal shelf; the scan session passes its shelf. */
  const openAdd = (barcode?: string, owner?: string) => add.open({ barcode, owner });

  let scanning = $state(false);
  /** The scan-first session "Add a glaze" starts with (phones), the Stock page's; `shelfScan` is its mounted component. */
  let scanSession = $state(false);
  let shelfScan = $state.raw<ReturnType<typeof ShelfScanSession> | null>(null);
  /** The control that started an addition, so the focus returns to it when the dialog replaces the session. */
  let addOpener: HTMLElement | null = null;
  function closeAdd() {
    add.close();
    shelfScan?.addClosed();
  }
  // An account change (sign-out included) closes both scanners, so the camera never outlives the account it opened for.
  $effect(() => {
    accountId;
    scanSession = false;
    scanning = false;
    // The scan notice names what the previous account scanned.
    unknownBarcode = '';
    scannedGlaze = null;
  });
  let finding = $state(false);
  /** A scanned barcode no glaze has yet; signed-in users may add it as a new glaze. */
  let unknownBarcode = $state('');
  /** The glaze a scanned barcode belongs to, with the choice between opening it and its combinations. */
  let scannedGlaze = $state<Glaze | null>(null);
  let scanNotice = $state<HTMLElement>();
  const life = lifetime(() => accountId);

  /** A known barcode offers its glaze or its combinations; an unknown one offers to add the glaze. */
  async function findScanned(barcode: string) {
    scanning = false;
    if (finding) return;
    finding = true;
    unknownBarcode = '';
    scannedGlaze = null;
    const actor = accountId;
    try {
      const glaze = await app.findBarcode(barcode);
      if (!life.current(actor)) return;
      if (glaze) scannedGlaze = glaze;
      else unknownBarcode = barcode;
      await tick();
      scanNotice?.scrollIntoView({ block: 'nearest' });
    } finally {
      finding = false;
    }
  }
  function refocusOpener() {
    if (addOpener?.isConnected) addOpener.focus();
  }
  /** Both entry buttons share the addition flow; an explicit scan starts its scanner at any width. */
  function startAdd(event?: Event, scan = false) {
    addOpener = (event?.currentTarget as HTMLElement | null) ?? addOpener;
    if (scan || addStartHere() === 'scanner') scanSession = true;
    else openAdd();
  }
  async function addWithoutBarcode() {
    scanSession = false;
    await tick();
    refocusOpener();
    openAdd();
  }
  /** Adds the scanned barcode to the glaze the dialog found; success closes the dialog and opens that glaze. */
  async function takeBarcode(glaze: Glaze) {
    const barcode = add.target?.barcode;
    if (!barcode) return;
    if (await app.editBarcodes(glaze.id, { add: [barcode] }, 'glaze')) {
      add.close();
      scanSession = false;
      app.navigate({ name: 'glaze', id: glaze.id });
    }
  }
  const onNewTest = () => app.navigate({ name: 'studio' });
</script>

{#snippet filterPickers(compact: boolean)}
  <ExploreFilters
    {glazes}
    {tagCounts}
    tags={tagFilter}
    {compact}
    onTag={(tag) => {
      if (!tag) return;
      tagText = '';
      setFilters({ tags: [...tagFilter, tag] });
    }}
    onGlaze={(id) => {
      if (!id) return;
      glazeText = '';
      setFilters({ glaze: id });
    }}
    firing={firingFilters
      ? {
          cones,
          cone: coneFilter,
          atmosphere: atmosphereFilter,
          onCone: (cone) => changeView(firingRoute(route, { cone })),
          onAtmosphere: (atmosphere) => changeView(firingRoute(route, { atmosphere })),
        }
      : undefined}
    bind:tagText
    bind:glazeText />
{/snippet}
{#snippet activeFilters(inSheet = false)}
  {#if narrowed}
    <div class="active-filters">
      <div class="filter-summary">
        <p class="filter-summary__text">{summaryText}</p>
        <button
          class="button filter-summary__clear"
          onclick={clearFilters}>
          {$t('discover.filters.clear')}
        </button>
      </div>
      {#if inSheet && quickNote}
        <p class="filter-summary__text">{quickNote}</p>
      {/if}
      {#if quick === 'all'}
        <p class="filter-summary__text">{$t('discover.filters.allHint')}</p>
      {/if}
      {#if filterGlaze || tagFilter.length || coneFilter || atmosphereFilter}
        <div>
          {#if filterGlaze}
            {@const title = glazeTitle(filterGlaze)}<TagList
              tags={[title]}
              label={$t('discover.filter.selectedGlaze')}
              removeLabel={() => $t('discover.filter.removeGlaze', { values: { glaze: title } })}
              onRemove={(_, button) => removeChip(button, () => setFilters({ glaze: undefined }))} />
          {/if}
          {#if coneFilter || atmosphereFilter}
            {@const coneLabel = coneFilter ? $t('firing.line.cone', { values: { cone: coneFilter } }) : ''}<TagList
              tags={[coneLabel, atmosphereFilter ? $t(atmosphereName(atmosphereFilter)) : ''].filter(Boolean)}
              label={$t('discover.filter.selectedFiring')}
              removeLabel={(value) => $t('discover.filter.removeFiring', { values: { value } })}
              onRemove={(value, button) =>
                removeChip(button, () => app.navigate(firingRoute(route, value === coneLabel ? { cone: undefined } : { atmosphere: undefined })))} />
          {/if}
          <TagList
            tags={tagFilter}
            label={$t('discover.filter.selectedTags')}
            removeLabel={(tag) => $t('discover.filter.removeTag', { values: { tag } })}
            onRemove={(tag, button) => {
              const tags = tagFilter.filter((other) => other !== tag);
              removeChip(button, () => setFilters({ tags: tags.length ? tags : undefined }));
            }} />
        </div>
      {/if}
    </div>
  {/if}
{/snippet}
{#if mobile && filterSheet}
  <ModalShell
    title={$t('discover.filters.title')}
    onClose={() => (filterSheet = false)}
    fallbackFocus={() => searchInput?.focus()}
    sheet>
    {@render activeFilters(true)}
    {@render filterPickers(false)}
    <button
      class="button button--primary filter-sheet__done"
      onclick={() => (filterSheet = false)}>
      {$t('discover.filters.results', { values: { count: items.length } })}
    </button>
  </ModalShell>
{/if}

<PageHead
  eyebrow={$t('discover.glazes.title')}
  title={$t('nav.explore')}
  description={$t('discover.intro')}
  compact />
{#if (!isLoading(sync) && !user) || showIntro}
  <ExploreWelcome
    guest={!user}
    {steps}
    onSignIn={app.openAuth}
    onDismiss={dismissIntro} />
{/if}
<div class="filters">
  <label class="filters__search">
    <span class="filters__search-icon">⌕</span>
    <input
      bind:this={searchInput}
      class="filters__search-input filters__control"
      aria-label={$t('discover.search.label')}
      bind:value={query}
      oninput={typed}
      onblur={sendQuery}
      onkeydown={(event) => {
        if (event.key === 'Enter') sendQuery();
      }}
      placeholder={$t('discover.search.placeholder')} />
  </label>
  <button
    type="button"
    class="button filters__scan"
    disabled={finding}
    aria-label={$t('barcodes.scan')}
    title={$t('barcodes.scan')}
    onclick={(event) => {
      event.preventDefault();
      if (user) startAdd(event, true);
      else scanning = true;
    }}>
    <svg
      class="filters__scan-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2">
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 7v10M10 7v10M14 7v10M17 7v10" />
    </svg>
    <span class="filters__scan-label">{$t('barcodes.scan')}</span>
  </button>
  {#if mobile}
    <button
      type="button"
      bind:this={filtersButton}
      class="button filters__open"
      aria-haspopup="dialog"
      onclick={() => (filterSheet = true)}>
      {$t('discover.filters.open', { values: { count: filterCount } })}
    </button>
  {:else}
    {@render filterPickers(true)}
  {/if}
</div>

<div class="browse-controls">
  <ChipRow
    label={$t('discover.type.label')}
    active={type}>
    {#each typeLinks as option (option.label)}
      <FilterChip
        kind="type"
        label={option.label}
        count={option.count}
        active={type === option.type}
        href={routeHref(typeRoute(route, option.type))}
        onclick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          changeView(typeRoute(route, option.type));
        }} />
    {/each}
  </ChipRow>
</div>
<QuickViews
  chips={result.chips}
  active={quick}
  href={(view) => routeHref(quickRoute(route, view))}
  note={quickNote}
  buddies={(quick === 'canMake' || quick === 'available') && user && hasBuddies
    ? { on: includeBuddies, onChange: setIncludeBuddies, hint: $t('discover.buddies.hint') }
    : undefined}
  clubs={(quick === 'available' || quick === 'canMake') && user && hasClubEntries ? { on: includeClubs, onChange: setIncludeClubs } : undefined}
  choices={quick === 'shelf' && hasEntries
    ? result.shelfChoices.map(({ choice, count }) => ({
        label: $t(shelfStockLabels[choice]),
        count,
        active: choice === result.shelfStock,
        href: routeHref(shelfStockRoute(route, choice)),
      }))
    : undefined}
  step={quick === 'canMake' && hasShelf
    ? {
        label: $t('discover.quick.almost'),
        count: result.almost ? items.length : items.length + result.oneMissing,
        active: result.almost,
        href: routeHref(almostRoute(route, !result.almost)),
      }
    : undefined} />
{#if transitionNote && transitionRoute === routeHref(route)}
  <p
    class="filter-summary__text"
    role="status">
    {transitionNote}
  </p>
{/if}
{#if browsing.deferred}
  <p class="filter-summary__text">{$t('discover.filters.photoCounts', { values: { shown: items.length, hidden: browsing.deferred } })}</p>
{/if}
<div class="collection-heading">
  <div class="collection-heading__text">
    <h2 class="collection-heading__title">
      {heading}
      <span class="collection-heading__count">{items.length}</span>
    </h2>
    <RefreshHint refreshing={refreshing(isLoading(sync), loaded)} />
  </div>
  <label class="collection-heading__sort">
    <span class="collection-heading__sort-label">{$t('discover.sort.label')}</span>
    <select
      class="collection-heading__order"
      aria-label={$t('discover.sort.label')}
      value={sort}
      onchange={(event) => setFilters({ sort: explicitSort(event.currentTarget.value as Sort, type) })}>
      {#each orders as order (order)}
        <option value={order}>
          {$t(sortLabel(order, type))}
        </option>
      {/each}
    </select>
  </label>
  {#if user}
    <div class="button-row button-row--end collection-heading__actions">
      {#if type !== 'combinations'}
        <button
          class="button collection-heading__action"
          onclick={startAdd}>
          {$t('addGlaze.action')}
        </button>
      {/if}
      <button
        class="button button--primary collection-heading__action"
        onclick={() => onNewTest()}>
        {$t('common.recordTest')}
      </button>
    </div>
  {/if}
</div>
{@render activeFilters()}
{#if unknownBarcode}
  <div
    bind:this={scanNotice}
    class="scan-result"
    role="status">
    <p class="scan-result__text">
      {$t('barcodes.discover.unknown', { values: { barcode: unknownBarcode } })}
    </p>
    {#if user}
      <button
        type="button"
        class="button button--primary scan-result__action"
        onclick={(event) => {
          event.preventDefault();
          openAdd(unknownBarcode);
        }}>
        {$t('barcodes.discover.add')}
      </button>
    {:else}
      <button
        type="button"
        class="button scan-result__action"
        onclick={(event) => {
          event.preventDefault();
          app.openAuth();
        }}>
        {$t('barcodes.discover.signIn')}
      </button>
    {/if}
    <button
      type="button"
      class="icon-button icon-button--quiet"
      aria-label={$t('app.dismissNotice')}
      onclick={(event) => {
        event.preventDefault();
        unknownBarcode = '';
      }}>
      <Icon name="close" />
    </button>
  </div>
{:else if scannedGlaze}
  {@const found = scannedGlaze}
  <div
    bind:this={scanNotice}
    class="scan-result"
    role="status">
    <p class="scan-result__text">
      {$t('barcodes.discover.found', { values: { glaze: glazeTitle(found) } })}
    </p>
    <a
      class="button button--primary scan-result__action"
      href={routeHref({ name: 'glaze', id: found.id })}>
      {$t('barcodes.discover.open')}
    </a>
    <a
      class="button scan-result__action"
      href={routeHref(glazeCombinationsRoute(route, found.id))}
      onclick={() => (scannedGlaze = null)}>
      {$t('barcodes.discover.showCombinations')}
    </a>
    <button
      type="button"
      class="icon-button icon-button--quiet"
      aria-label={$t('app.dismissNotice')}
      onclick={(event) => {
        event.preventDefault();
        scannedGlaze = null;
      }}>
      <Icon name="close" />
    </button>
  </div>
{/if}
{#if scanning}
  <BarcodeScanner
    title={$t('barcodes.scanner.findTitle')}
    onClose={() => (scanning = false)}
    onBarcode={findScanned} />
{/if}
{#if scanSession && user}
  <ShelfScanSession
    bind:this={shelfScan}
    title={$t('addGlaze.scanTitle')}
    skip={{ label: $t('addGlaze.withoutBarcode'), run: () => void addWithoutBarcode() }}
    {stock}
    clubs={$appStore.clubs}
    {online}
    {accountId}
    error={formErrorFor($appStore, 'stock')}
    findBarcode={app.findBarcode}
    saveStock={app.saveStock}
    {openAdd}
    registerLeaveGuard={app.registerLeaveGuard}
    onClose={() => {
      scanSession = false;
      refocusOpener();
      app.clearFormError();
    }} />
{/if}

{#if loading}
  <div
    class="empty-state empty-state--loading"
    role="status">
    {syncProgress ? $t('route.loadingProgress', { values: syncProgress }) : $t('discover.loading')}
  </div>
{:else if sync.failure && !glazes.length && !combinations.length}
  <RouteStatus
    status="unavailable"
    failure={sync.failure}
    onRetry={app.retry} />
{:else if result.items.length === 0 && quick === 'favourites'}
  <div class="empty-state">
    {hasFavorites ? $t('discover.favorites.noMatch') : $t('discover.favorites.empty')}
  </div>
{:else if result.items.length === 0 && (quick === 'mine' || quick === 'waiting')}
  <div class="empty-state">
    <p class="empty-state__description">
      {#if quick === 'mine'}
        {ownCombinations.length ? $t('discover.mine.noMatch') : $t('discover.mine.empty')}
      {:else}
        {ownCombinations.some(isWaiting) || glazes.some(isWaitingGlaze) ? $t('discover.waiting.noMatch') : $t('discover.waiting.empty')}
      {/if}
    </p>
    {#if quick === 'mine' && !ownCombinations.length}
      <button
        class="button empty-state__action button--primary"
        onclick={() => onNewTest()}>
        {$t('common.recordTest')}
      </button>
    {/if}
  </div>
{:else if result.items.length === 0 && quick === 'new'}
  <div class="empty-state">
    {$t('discover.new.empty', { values: { count: newDays } })}
  </div>
{:else if result.items.length === 0 && (quick === 'shelf' || quick === 'available' || quick === 'canMake')}
  <div class="empty-state">
    {#if quick === 'shelf' ? hasEntries : hasShelf}
      <p class="empty-state__description">
        {quick === 'shelf'
          ? $t(result.shelfStock === 'used' ? 'discover.shelfStock.usedNoMatch' : 'discover.shelf.noMatch')
          : quick === 'available'
            ? $t('discover.available.noMatch')
            : result.almost
              ? $t('discover.canMake.almostNoMatch')
              : $t('discover.canMake.noMatch')}
      </p>
      {#if quick === 'canMake' && !result.almost && result.oneMissing}
        <p class="empty-state__description">
          {$t('discover.canMake.almostHint', { values: { count: result.oneMissing } })}
        </p>
        <a
          class="button empty-state__action button--primary"
          href={routeHref(almostRoute(route, true))}>
          {$t('discover.canMake.showAlmost')}
        </a>
      {/if}
    {:else}
      <p class="empty-state__description">
        {$t(quick !== 'shelf' ? 'discover.available.empty' : hasClubEntries || hasBuddies ? 'discover.shelf.personalEmpty' : 'discover.quick.needShelf')}
      </p>
      {#if quick === 'shelf' && (hasClubEntries || hasBuddies)}
        <a
          class="button empty-state__action"
          href={routeHref(quickRoute(route, 'available'))}>
          {$t('discover.quick.available')}
        </a>
      {/if}
      <a
        class="button empty-state__action button--primary"
        href={routeHref({ name: 'stock' })}>
        {$t('nav.stock')}
      </a>
    {/if}
  </div>
{:else if result.items.length === 0 && type === 'glazes'}
  <div class="empty-state">
    <p class="empty-state__description">{$t('discover.glazes.empty')}</p>
    {#if user}
      <button
        class="button empty-state__action button--primary"
        onclick={startAdd}>
        {$t('addGlaze.action')}
      </button>
    {/if}
  </div>
{:else if result.items.length === 0}
  <div class="empty-state">
    <img
      class="empty-state__illustration"
      src="/icon.svg"
      alt=""
      width="56"
      height="56" />
    <h3 class="empty-state__title">
      {libraryEmpty ? $t('discover.combinations.startTitle') : type === 'combinations' ? $t('discover.combinations.emptyTitle') : $t('discover.all.emptyTitle')}
    </h3>
    <p class="empty-state__description">
      {libraryEmpty ? $t('discover.combinations.startBody') : $t('discover.combinations.emptyBody')}
    </p>
    {#if user}
      <div class="button-row empty-actions">
        <button
          class="button empty-state__action button--primary"
          onclick={() => onNewTest()}>
          {$t('common.recordTest')}
        </button>
        {#if type !== 'combinations'}
          <button
            class="button empty-state__action"
            onclick={startAdd}>
            {$t('addGlaze.action')}
          </button>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <PagedGrid
    {items}
    itemKey={exploreKey}
    name="explore"
    {filterKey}>
    {#snippet end(revealMore)}
      {#if browsing.deferred}
        <div class="picture-free-results">
          <p class="picture-free-results__hint">
            {$t('discover.withoutPhotos.hint', { values: { count: browsing.deferred } })}
          </p>
          <button
            class="button"
            onclick={() => revealMore(revealWithoutPhotos)}>
            {$t('discover.withoutPhotos.load')}
          </button>
        </div>
      {/if}
    {/snippet}
    {#snippet card(entry)}
      {#if entry.kind === 'glaze'}
        {@const glaze = entry.item}<GlazeRow
          {glaze}
          picture={glazeThumbnail(glaze)}
          usedIn={result.usage.get(glaze.id) ?? 0}
          onShelf={shelf.has(glaze.id)}
          clubShelf={clubMark(glaze.id)}
          {user}
          {online}
          href={routeHref({ name: 'glaze', id: glaze.id })}
          combinationsHref={routeHref(combinationsOfGlazeRoute(glaze.id))}
          buddyShelf={buddyOf(glaze.id)}
          onQuickAdd={user && !personalEntries.has(glaze.id) ? () => quickAdd(glaze.id) : undefined}
          quickError={quickFailed === glaze.id ? formErrorFor($appStore, 'stock') : ''}
          favorite={favoriteGlazes.has(glaze.id)}
          onShare={() => app.share($t('share.title', { values: { title: glazeTitle(glaze) } }), { name: 'glaze', id: glaze.id })}
          onToggleFavorite={() => app.toggleFavorite('glazes', glaze.id)} />
      {:else}
        {@const combo = entry.item}<CombinationCard
          showType
          {combo}
          glazes={glazesById}
          shelf={cardShelf}
          buddyShelf={cardBuddies}
          href={routeHref({ name: 'combination', id: combo.id })}
          {user}
          {online}
          authorAvatars={$appStore.authorAvatars}
          onAddPhoto={app.openUpload}
          favorite={favoriteCombinations.has(combo.id)}
          onToggleFavorite={() => app.toggleFavorite('combinations', combo.id)} />
      {/if}
    {/snippet}
  </PagedGrid>
{/if}
{#if add.target && user}
  <AddGlazeDialog
    {...add.props}
    shelf={!!add.target.barcode}
    owner={add.target.owner}
    barcode={add.target.barcode}
    onAdded={(id, shelved) => {
      unknownBarcode = '';
      shelfScan?.added(
        glazes.find((glaze) => glaze.id === id),
        shelved,
      );
    }}
    onTakeBarcode={takeBarcode}
    existingAction={scanSession
      ? {
          label: $t('glazeForm.addToShelf'),
          run: (glaze) => {
            // The scanned code belongs to another glaze: take its sheet instead.
            add.close();
            shelfScan?.useGlaze(glaze);
          },
        }
      : undefined}
    onClose={closeAdd}
    confirm
    fallbackFocus={() => searchInput?.focus()}
    bind:dirty={add.dirty} />
{/if}

<style>
  /* What narrows the list, between the heading and the results; nothing at all while nothing does. */
  .active-filters {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  /* The text takes the row and the button stands at its end; below 10rem of text the button wraps under it, still at the end. */
  .filter-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }
  .filter-summary .filter-summary__text {
    flex: 1 1 10rem;
    margin: 0;
  }
  .filter-summary__clear {
    margin-inline-start: auto;
    padding: var(--space-1) var(--space-3);
    white-space: nowrap;
  }
  .filter-summary__text {
    margin: var(--space-2) 0;
    color: var(--muted);
    font-size: var(--font-sm);
    overflow-wrap: anywhere;
  }
  .active-filters > .filter-summary__text {
    margin: 0;
  }

  .picture-free-results {
    padding: var(--space-5) 0;
    text-align: center;
  }
  .picture-free-results__hint {
    margin: 0 0 var(--space-3);
    color: var(--muted);
  }

  .browse-controls {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-3);
    flex-wrap: wrap;
  }

  .collection-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-7) 0 var(--space-4);
    /* Room for the "Record a test" button (1.5 lines + padding + border), shown once the session is known. */
    min-height: calc(1.5 * var(--font-base) + 2 * var(--space-2-5) + 0.125rem);
  }
  .empty-actions {
    justify-content: center;
  }
  /* The heading takes the free width, so the sort and the buttons sit at the right edge; what does not fit wraps below. */
  .collection-heading__text {
    flex: 1 1 auto;
    min-width: 0;
  }
  .collection-heading__sort {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .collection-heading__order {
    min-width: 0;
    max-width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 0.0625rem solid var(--control-border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--font-base);
  }
  .collection-heading__actions {
    margin-inline-start: auto;
  }
  .collection-heading__title {
    font-size: var(--font-xl);
    font-weight: 600;
    margin: var(--space-2) 0 0;
    letter-spacing: -0.0375rem;
  }
  .collection-heading__count {
    font-size: var(--font-base);
    font-weight: 600;
    color: var(--accent);
    background: var(--sage);
    border-radius: var(--radius-pill);
    padding: var(--space-1) var(--space-2);
    vertical-align: middle;
    margin-left: var(--space-1);
  }
  /* A screen tall in every state, so the footer stays below the fold when loading
     is replaced by an empty library or a list. */
  .empty-state--loading {
    justify-content: flex-start;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-6);
  }
  .filters__search {
    min-width: 0;
    flex: 1 1 14rem;
    position: relative;
  }
  .filter-sheet__done {
    width: 100%;
    margin-top: var(--space-4);
  }
  .filters__open {
    padding-inline: var(--space-2);
  }
  .filters__scan-icon {
    display: none;
    width: var(--space-5);
    height: var(--space-5);
  }
  .filters__scan {
    height: var(--control-height);
  }
  .scan-result {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: calc(-1 * var(--space-2)) 0 var(--space-5);
    padding: var(--space-3) var(--space-4);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .scan-result__text {
    flex: 1 1 16rem;
    margin: 0;
    font-size: var(--font-base);
    overflow-wrap: anywhere;
  }
  .scan-result__action {
    text-decoration: none;
  }
  .filters__search-icon {
    position: absolute;
    top: 0.3125rem;
    left: 0.875rem;
    font-size: 1.625rem;
    color: var(--muted);
  }
  .filters__control {
    width: 100%;
    background: var(--surface);
    border: 0.0625rem solid var(--control-border);
    border-radius: var(--radius-sm);
    height: var(--control-height);
    padding: 0 var(--space-3);
    outline: none;
    color: var(--ink);
    font-size: var(--font-base);
  }
  .filters__search-input {
    padding-left: var(--space-10);
  }
  .filters__control:focus {
    border-color: var(--focus);
    box-shadow: 0 0 0 0.1875rem var(--focus-halo);
  }
  @media (width < 45em) {
    /* The heading and the sort share the first row while the heading's longest word and the select's widest option fit beside each
       other (the sort loses its visible word, the select keeps its name); else the sort wraps to a row of its own, so no option is
       ever cut (a fixed share of the row cut "Mais recentes" at 390 px, LANG-6). The buttons wrap below. */
    .collection-heading__text {
      flex-basis: 0;
      min-width: auto;
    }
    .collection-heading__count {
      white-space: nowrap;
    }
    .collection-heading__sort-label {
      display: none;
    }
    .collection-heading__actions {
      flex: 1 1 100%;
    }
    .collection-heading__action {
      flex: 1 1 auto;
    }
    .collection-heading__title {
      font-size: var(--font-lg);
    }
    .browse-controls {
      margin-top: var(--space-3);
      gap: var(--space-3);
    }
    .collection-heading {
      margin-block: var(--space-4) var(--space-3);
    }
    .filters {
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-bottom: var(--space-3);
    }
    .filters__search {
      flex: 1 1 100%;
    }
    .filters__scan {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: calc(var(--space-10) + var(--space-1));
      padding: var(--space-2);
    }
    .filters__scan-icon {
      display: block;
    }
    .filters__scan-label {
      display: inline;
    }
    .filters__scan {
      width: auto;
      gap: var(--space-2);
    }
    .filters__open {
      margin-inline-start: auto;
    }
  }
  @media (pointer: coarse) {
    .filter-summary__text {
      font-size: var(--font-body);
    }
    .collection-heading__order {
      min-height: var(--touch-target);
    }
  }
</style>

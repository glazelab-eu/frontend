<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '../ui/Icon.svelte';
  import { readable } from 'svelte/store';
  import { t } from '../../lib/i18n';
  import { imageKindKey, pictureDescription, pictureSrc, type Picture } from '../../lib/images/pictures';
  import { outsidePicture, preloadIndexes, stepIndex, swipeStep, viewerKeyTarget } from '../../lib/images/viewer';
  import { afterViewerPop, holdViewerEntry } from '../../lib/images/viewer-history';
  import { pictureFocusFallback } from '../../lib/images/picture-focus';
  import ModalShell from '../ui/ModalShell.svelte';
  import { topDialog } from '../ui/keys';
  import { isLookKind } from '../../lib/vision/library';
  import { setThemeColor } from '../../lib/pwa/theme-colour';
  import { useSimilar } from '../../state/vision/similar-context';
  import type { SimilarState } from '../../state/vision/similar-looks';
  import ImageView from './ImageView.svelte';
  import PictureMeta from './PictureMeta.svelte';
  import SimilarPanel from '../vision/SimilarPanel.svelte';

  interface Props {
    slides: Picture[];
    /** The shown photo's position (the gallery's: the viewer and the stage always show the same photo). */
    current: number;
    /** Name of the glaze or combination the photos belong to. */
    title: string;
    userId: string | null | undefined;
    /** Shows the photo at that position in the gallery. */
    onShow: (position: number) => void;
    onClose: () => void;
    /** Where the "Open" link in the info area goes (a list card's item page); the detail gallery is on that page already and has none. */
    openHref?: string;
  }

  let { slides, current, title, userId, onShow, onClose, openHref }: Props = $props();
  let shown = $derived(slides[current]);
  let many = $derived(slides.length > 1);
  /** The shown photo and its neighbours: the neighbours are in the page (hidden) so they are loaded and decoded before the step. */
  let layers = $derived([current, ...preloadIndexes(current, slides.length)].map((position) => slides[position]));
  /** The opener (a card's cover, the gallery's stage) leaves with the last photo: the focus then goes to the card. */
  const focusCard = pictureFocusFallback();

  // The installed app's status bar takes the viewer's ground while it is open; unmounting is every way out (Escape, Close, backdrop, Back, route change, sign-out).
  onMount(() => setThemeColor(getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim()));

  // The viewer is a history entry: Back closes it, and every other way it ends (Escape, Close, the ground, an unmount
  // for any reason) removes the entry again, so it leaves no extra step behind (`lib/images/viewer-history.ts`).
  // Only the viewer that pushed an entry removes it: one without (another viewer's entry is open) just closes.
  let leaveViewer: () => boolean = () => false;
  onMount(() => {
    let unmounted = false;
    leaveViewer = holdViewerEntry(() => {
      if (!unmounted) onClose();
    });
    return () => {
      unmounted = true; // a pop that is still on its way must not close a viewer opened right after this one
      leaveViewer();
    };
  });
  /** Closing asks the history first (its popstate closes the viewer); without an entry the viewer closes at once. */
  const close = () => {
    if (!leaveViewer()) onClose();
  };

  /**
   * Opens the item's page: the viewer's entry is popped first (`afterViewerPop`), so the page follows the list's own entry
   * and Back never lands on the viewer. A new tab, window or download (modifier keys, middle button) is the browser's.
   */
  function openPage(event: MouseEvent, target: string | undefined = openHref) {
    if (!target || event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const href = target;
    afterViewerPop(() => {
      location.hash = href;
    });
  }

  // "Find similar to this photo" (33-2): offered for test tiles and finished pieces to a signed-in person who has the photo model on.
  const similar = useSimilar();
  const idle = readable<SimilarState>({ status: 'off', paused: null, done: 0, total: 0, version: 0 });
  const similarStore = similar?.state ?? idle;
  const panelId = $props.id();
  let finding = $state(false);
  let findButton = $state<HTMLButtonElement>();
  /** The feature is on for this person (it keeps a row of the info area for packaging photos too, so the photo never resizes between kinds). */
  const findEnabled = $derived(!!similar && !!userId && ['ask', 'declined', 'indexing', 'paused', 'ready'].includes($similarStore.status));
  const canFind = $derived(findEnabled && isLookKind(shown.image.kind));
  const similarHits = $derived.by(() => {
    void $similarStore.version;
    return finding && similar ? similar.forPhoto(shown.image.id) : [];
  });
  const similarQuery = $derived.by(() => {
    void $similarStore.version;
    return finding && similar && !similar.indexed(shown.image.id) ? ('missing' as const) : ('ready' as const);
  });

  async function closeFinding() {
    finding = false;
    await tick();
    findButton?.focus();
  }

  const step = (delta: number) => onShow(stepIndex(current, slides.length, delta));

  let root = $state<HTMLElement>();

  /** Keys reach the viewer from anywhere in it (or with the focus on nothing), never from a dialog above it or the page beneath. */
  function forViewer(event: KeyboardEvent): boolean {
    const dialog = root?.closest('[role="dialog"]');
    if (!dialog || topDialog() !== dialog) return false;
    return !(event.target instanceof Node) || event.target === document.body || dialog.contains(event.target);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !forViewer(event)) return;
    const target = viewerKeyTarget(event.key, current, slides.length);
    if (target === null) return;
    event.preventDefault();
    onShow(target);
  }

  // A click beside the photo (on the dark ground around it) closes, like a backdrop; the photo, the buttons and the text do not.
  function clickGround(event: MouseEvent) {
    if (!(event.target instanceof Element) || event.target.closest('button')) return;
    const picture = (event.currentTarget as HTMLElement).querySelector<HTMLImageElement>('.viewer__frame:not(.viewer__frame--hidden) img');
    if (
      picture &&
      outsidePicture(picture.getBoundingClientRect(), { width: picture.naturalWidth, height: picture.naturalHeight }, event.clientX, event.clientY)
    )
      close();
  }

  // Swiping the photo. Plain touch events and no `touch-action`: the browser's own pinch-zoom stays possible, a pinch (a second finger) or a zoomed page is never a swipe.
  let swipe: { x: number; y: number } | null = null;
  let pinched = false;
  const zoomed = () => (window.visualViewport?.scale ?? 1) > 1.01;

  function touchStart(event: TouchEvent) {
    if (event.touches.length > 1) {
      pinched = true;
      swipe = null;
    } else if (!pinched) {
      swipe = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
  }

  function touchEnd(event: TouchEvent) {
    if (event.touches.length) return;
    const end = event.changedTouches[0];
    const direction = swipe && !pinched && !zoomed() && end ? swipeStep(end.clientX - swipe.x, end.clientY - swipe.y) : 0;
    swipe = null;
    pinched = false;
    if (direction) step(direction);
  }

  function touchCancel() {
    swipe = null;
    pinched = false;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<ModalShell
  ariaLabel={$t('images.viewer.label', { values: { title } })}
  onClose={close}
  fallbackFocus={focusCard}
  viewer>
  <div
    bind:this={root}
    class="viewer">
    <div class="viewer__bar">
      {#if many}
        <!-- The live region and the thumbnails' names already say the position. -->
        <p
          class="viewer__count"
          aria-hidden="true">
          {current + 1} / {slides.length}
        </p>
      {/if}
    </div>
    <!-- A swipe and a click on the ground are conveniences; the buttons and the keys (Escape) do the same. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="viewer__stage"
      role="presentation"
      onclick={clickGround}
      ontouchstart={touchStart}
      ontouchend={touchEnd}
      ontouchcancel={touchCancel}>
      {#each layers as picture (picture.image.id)}
        {@const description = pictureDescription(picture, title)}
        <div
          class={['viewer__frame', { 'viewer__frame--hidden': picture !== shown }]}
          aria-hidden={picture === shown ? undefined : 'true'}>
          <ImageView
            src={pictureSrc(picture.image, 'full')}
            {userId}
            variant="viewer"
            alt={$t(description.key, { values: { title: description.title } })} />
        </div>
      {/each}
      {#if many}
        <button
          type="button"
          class="icon-button icon-button--viewer viewer__nav viewer__nav--previous"
          aria-label={$t('images.viewer.previous')}
          onclick={() => step(-1)}>
          <Icon name="previous" />
        </button>
        <button
          type="button"
          class="icon-button icon-button--viewer viewer__nav viewer__nav--next"
          aria-label={$t('images.viewer.next')}
          onclick={() => step(1)}>
          <Icon name="next" />
        </button>
      {/if}
    </div>
    <div class={['viewer__info', { 'viewer__info--open': openHref, 'viewer__info--find': findEnabled }]}>
      <PictureMeta picture={shown} />
      {#if openHref}
        <a
          class="viewer__open"
          href={openHref}
          aria-label={$t('images.viewer.openItemFor', { values: { title } })}
          onclick={(event) => openPage(event)}>
          {$t('images.viewer.openItem')}
        </a>
      {/if}
      {#if canFind}
        <button
          type="button"
          bind:this={findButton}
          class="viewer__find"
          aria-expanded={finding}
          aria-controls={panelId}
          onclick={() => (finding = !finding)}>
          {finding ? $t('similar.hide') : $t('similar.find')}
        </button>
        {#if finding && similar}
          <div
            id={panelId}
            class="viewer__similar">
            <SimilarPanel
              {similar}
              progress={$similarStore}
              hits={similarHits}
              query={similarQuery}
              {userId}
              dark
              onOpen={openPage}
              onClose={() => void closeFinding()} />
          </div>
        {/if}
      {/if}
    </div>
    {#if many}
      <span
        class="visually-hidden"
        aria-live="polite"
        aria-atomic="true">
        {$t('images.thumbnail', { values: { current: current + 1, total: slides.length, kind: $t(imageKindKey(shown.image.kind)) } })}
      </span>
    {/if}
  </div>
</ModalShell>

<style>
  .viewer {
    height: 100%;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    padding-left: var(--safe-left);
    padding-right: var(--safe-right);
    padding-bottom: var(--safe-bottom);
  }
  /* The row Close sits in (ModalShell draws it at the top right): the count at the left, the photo below. */
  .viewer__bar {
    display: flex;
    align-items: center;
    min-height: calc(var(--touch-target) + var(--space-4));
    padding: var(--safe-top) calc(var(--touch-target) + var(--space-5)) 0 var(--space-4);
  }
  .viewer__count {
    margin: 0;
    color: var(--viewer-muted);
    font-size: var(--font-base);
  }
  .viewer__stage {
    position: relative;
    display: grid;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  /* The shown photo and its neighbours share one cell; the neighbours are only waiting. */
  .viewer__frame {
    grid-area: 1 / 1;
    min-height: 0;
    min-width: 0;
  }
  .viewer__frame--hidden {
    visibility: hidden;
  }
  .viewer__nav {
    position: absolute;
    top: 50%;
    width: 3rem;
    height: 3rem;
    margin-top: -1.5rem;
  }
  .viewer__nav--previous {
    left: var(--space-3);
  }
  .viewer__nav--next {
    right: var(--space-3);
  }
  /* Room for a caption of a few lines, so the photo does not resize from one photo to the next. */
  .viewer__info {
    --picture-meta-color: var(--viewer-muted);
    min-height: 5.5rem;
    padding: var(--space-3) var(--space-4) var(--space-4);
    text-align: center;
  }
  /* The link row is always there, so the photo does not resize from one photo to the next. */
  .viewer__info--open {
    min-height: calc(5.5rem + var(--touch-target));
  }
  .viewer__info--find {
    min-height: calc(5.5rem + var(--touch-target) + var(--space-1));
  }
  .viewer__info--find.viewer__info--open {
    min-height: calc(5.5rem + 2 * var(--touch-target) + var(--space-1));
  }
  .viewer__open {
    display: inline-flex;
    align-items: center;
    min-height: var(--touch-target);
    margin-top: var(--space-1);
    color: var(--viewer-ink);
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 0.25em;
  }
  .viewer__open:focus-visible {
    outline: 0.1875rem solid var(--viewer-ink);
    outline-offset: 0.125rem;
  }
  .viewer__find {
    display: inline-flex;
    align-items: center;
    min-height: var(--touch-target);
    margin-top: var(--space-1);
    padding: 0 var(--space-3);
    border: 0.0625rem solid var(--viewer-line);
    border-radius: var(--radius-pill);
    background: var(--viewer-control);
    color: var(--viewer-ink);
    font: inherit;
    font-weight: 700;
  }
  .viewer__find:focus-visible {
    outline: 0.1875rem solid var(--viewer-ink);
    outline-offset: 0.125rem;
  }
  /* Beside the photo, never over it: the info area grows and the photo gives way (the grid row of the stage is the free rest). */
  .viewer__similar {
    max-height: min(40vh, 20rem);
    overflow-y: auto;
  }
  /* A phone on its side (about 390 px high): above and below the photo only a third of the screen was left for it. The text moves to a column at the right, beside the photo, which then has the full height. */
  @media (orientation: landscape) and (max-height: 30em) {
    .viewer {
      grid-template-columns: minmax(0, 1fr) min(16rem, 38%);
      grid-template-rows: auto minmax(0, 1fr);
      /* The photo spans both rows, so the status bar's inset is taken here, not by the bar's own padding. */
      padding: var(--safe-top) 0 var(--safe-bottom) var(--safe-left);
    }
    .viewer__stage {
      grid-column: 1;
      grid-row: 1 / -1;
    }
    .viewer__bar {
      grid-column: 2;
      grid-row: 1;
      min-height: calc(var(--touch-target) + var(--space-3));
      padding: 0 calc(var(--touch-target) + var(--space-5)) 0 var(--space-3);
    }
    .viewer__info {
      grid-column: 2;
      grid-row: 2;
      min-height: 0;
      overflow-y: auto;
      padding: var(--space-2) max(var(--space-4), var(--safe-right)) var(--space-3) var(--space-3);
      text-align: left;
    }
    .viewer__info--find.viewer__info--open {
      min-height: 0;
    }
    .viewer__similar {
      max-height: none;
      overflow-y: visible;
    }
  }
</style>

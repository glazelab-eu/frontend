<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import Icon from '../ui/Icon.svelte';
  import { lifetime } from '../../state/shared/lifetime';
  import { t } from '../../lib/i18n';
  import { pictureSrc, stageShape, type PictureSelection } from '../../lib/images/pictures';
  import type { Club, ClubMember, ImageInfo } from '../../lib/api/models';
  import { photoAudience } from '../../lib/images/photo-audience';
  import type { ImageDetailsChange, ImageVisibilityChange } from '../../lib/api/inputs';
  import { photoMenuEntries, photoMenuLabel, type PhotoMenuAction } from '../../lib/images/photo-menu';
  import ActionMenu from '../ui/ActionMenu.svelte';
  import PictureCover from './PictureCover.svelte';
  import PictureStrip from './PictureStrip.svelte';
  import PictureMeta from './PictureMeta.svelte';
  import PhotoViewer from './PhotoViewer.svelte';
  import PictureDetailsDialog from './PictureDetailsDialog.svelte';
  import PictureKindDialog from './PictureKindDialog.svelte';
  import PhotoFocusDialog from './PhotoFocusDialog.svelte';
  import { focusOf, type Focus } from '../../lib/images/photo-focus';
  import { pictureBlob } from '../../lib/offline/offline';
  import PictureVisibilityDialog from './PictureVisibilityDialog.svelte';
  import ReportImageDialog from './ReportImageDialog.svelte';

  interface Props {
    /** A glaze's gallery: its own photos may be packaging (and never work in progress); borrowed combination photos follow their combination. */
    allowPackaging?: boolean;
    /** An image ID to show first (an admin's "Open item" link); ignored when the page has no such photo. */
    focusPhoto?: string;
    detailsError?: string;
    /** Lets the signed-in uploader edit the shown picture's caption and firing date; omitted for read-only views. */
    onChangeDetails?: (image: ImageInfo, change: ImageDetailsChange) => Promise<boolean>;
    /** Lets whoever may delete the shown picture (`canDelete`) change its kind; omitted for read-only views. */
    onChangeKind?: (image: ImageInfo, kind: ImageInfo['kind']) => Promise<boolean>;
    kindError?: string;
    /** Lets whoever may delete the shown picture (`canDelete`) set where the cards' covers centre it; omitted for read-only views. */
    onChangeFocus?: (image: ImageInfo, focus: Focus | null) => Promise<boolean>;
    focusError?: string;
    /** Asks to delete a picture for everyone (the menu offers it only with `canDelete`). */
    onRemove?: (image: ImageInfo) => void;
    /** Reports a picture of someone else; resolves true once recorded. */
    onReport?: (image: ImageInfo, reason: string | null) => Promise<boolean>;
    reportError?: string;
    visibilityError?: string;
    pictures: PictureSelection;
    /** Buttons that belong to the photos (the page's "Add finished piece"), shown under them. */
    actions?: Snippet;
    title: string;
    userId: string | null | undefined;
    online?: boolean;
    clubs?: Club[];
    /** The account's clubs' member lists, to offer only what a combination's author can see (`photoAudience`). */
    clubMembers?: Record<string, ClubMember[]>;
    /** The author of the combination these pictures belong to; a picture borrowed from a combination carries its own. */
    authorId?: string | null;
    /** Lets the signed-in uploader change who sees the shown picture; omitted for read-only views. */
    onChangeVisibility?: (image: ImageInfo, change: ImageVisibilityChange) => Promise<boolean>;
  }
  let {
    pictures,
    actions,
    title,
    userId,
    online = false,
    clubs = [],
    clubMembers = {},
    authorId,
    onChangeVisibility,
    onChangeDetails,
    onChangeKind,
    kindError = '',
    onChangeFocus,
    focusError = '',
    allowPackaging = false,
    focusPhoto,
    detailsError = '',
    onRemove,
    onReport,
    reportError = '',
    visibilityError = '',
  }: Props = $props();
  let slides = $derived(pictures.cover ? [pictures.cover, ...pictures.thumbnails] : []);
  /** One shape for every slide (the tallest photo's), so the page does not jump while swiping. */
  let shape = $derived(stageShape(slides));
  let viewport = $state<HTMLDivElement>();
  let index = $state(0);
  let current = $derived(Math.min(index, Math.max(0, slides.length - 1)));
  let shown = $derived(slides[current]?.image);
  const hintId = $props.id();
  let viewing = $state(false);

  const life = lifetime(() => userId);

  /** The dialog the photo menu opened and the picture it is about (looked up by ID: it may vanish). */
  let dialog = $state<{ action: 'details' | 'kind' | 'focus' | 'visibility' | 'report'; id: string } | null>(null);
  let dialogSlide = $derived(slides.find((picture) => picture.image.id === dialog?.id));
  let dialogImage = $derived(dialogSlide?.image);
  let dialogAudience = $derived(photoAudience(clubs, clubMembers, userId, dialogSlide?.combination ? dialogSlide.combination.authorId : authorId));
  $effect(() => {
    void userId;
    dialog = null;
    viewing = false;
  });

  const menuAvailable: Record<PhotoMenuAction, boolean> = $derived({
    details: !!onChangeDetails,
    kind: !!onChangeKind,
    focus: !!onChangeFocus,
    visibility: !!onChangeVisibility,
    delete: !!onRemove,
    report: !!onReport,
  });
  let entries = $derived(shown ? photoMenuEntries(shown, !!userId, online).filter((entry) => menuAvailable[entry.action]) : []);
  /** A viewer whose only option is to report the photo gets that one button in the picture's corner instead of a menu row. */
  let reportOnly = $derived(entries.length === 1 && entries[0].action === 'report');

  function choose(action: string) {
    if (!shown) return;
    if (action === 'delete') onRemove?.(shown);
    else if (action === 'details' || action === 'kind' || action === 'focus' || action === 'visibility' || action === 'report')
      dialog = { action, id: shown.id };
  }

  /** The new ID of a picture that left PUBLIC replaces its slide; stay on that position. */
  async function changeVisibility(image: ImageInfo, change: ImageVisibilityChange) {
    const callback = onChangeVisibility;
    if (!callback) return false;
    const position = slides.findIndex((picture) => picture.image.id === image.id);
    const saved = await callback(image, change);
    if (!life.mounted() || !saved) return saved;
    await tick();
    if (life.mounted() && position >= 0) show(position);
    return saved;
  }

  /** The photo may sort elsewhere after an edit (firing date, kind): stay on it, wherever it went. */
  async function followEdit(image: ImageInfo, save: (() => Promise<boolean>) | undefined) {
    const actor = userId;
    if (!save) return false;
    const saved = await save();
    if (!life.mounted() || !saved) return saved;
    await tick();
    if (!life.current(actor)) return saved;
    const position = slides.findIndex((picture) => picture.image.id === image.id);
    if (position >= 0) show(position);
    return saved;
  }
  const changeDetails = (image: ImageInfo, change: ImageDetailsChange) => followEdit(image, onChangeDetails && (() => onChangeDetails(image, change)));
  const changeKind = (image: ImageInfo, kind: ImageInfo['kind']) => followEdit(image, onChangeKind && (() => onChangeKind(image, kind)));
  /** The whole stored photo (its full size, from the device's copy when there is one); null offline or once it is gone. */
  async function fullPhoto(image: ImageInfo): Promise<File | null> {
    const found = await pictureBlob(pictureSrc(image, 'full'), userId);
    return found.ok ? new File([found.blob], 'photo.jpg', { type: found.blob.type || 'image/jpeg' }) : null;
  }

  function readPosition() {
    if (viewport?.clientWidth) index = Math.round(viewport.scrollLeft / viewport.clientWidth);
  }

  function show(next: number) {
    if (!viewport) return;
    viewport.scrollTo({
      left: Math.max(0, Math.min(next, slides.length - 1)) * viewport.clientWidth,
      behavior: 'instant',
    });
    readPosition();
  }

  // Once per requested photo, as soon as its slide exists; later browsing is never pulled back.
  let focused: string | undefined;
  $effect(() => {
    if (!focusPhoto || focusPhoto === focused || !viewport) return;
    const position = slides.findIndex((picture) => picture.image.id === focusPhoto);
    if (position < 0) return;
    focused = focusPhoto;
    show(position);
  });

  /** Opens the viewer on the shown photo; the stage keeps the focus first, so closing returns to it in every browser (a click may not focus a div). */
  function openViewer() {
    if (!slides.length || viewing) return;
    viewport?.focus({ preventScroll: true });
    viewing = true;
  }

  function navigate(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openViewer();
      return;
    }
    const next = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: slides.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    show(next);
  }
</script>

<section
  class="picture-carousel"
  aria-label={$t('images.gallery', { values: { title } })}>
  <div class="picture-carousel__stage">
    <!-- The stage is the one focusable region: it scrolls with the arrow keys (so it must be focusable) and Enter, Space or a click opens the full-screen viewer. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={viewport}
      class={['picture-carousel__viewport', { 'picture-carousel__viewport--openable': slides.length > 0 }]}
      role="group"
      aria-label={slides.length > 1 ? $t('images.galleryNavigation') : $t('images.viewer.open')}
      aria-describedby={slides.length > 1 ? hintId : undefined}
      tabindex={slides.length > 0 ? 0 : undefined}
      onkeydown={navigate}
      onclick={openViewer}
      onscroll={readPosition}>
      {#each slides as picture, position (picture.image.id)}
        <div
          class="picture-carousel__slide"
          role="group"
          aria-label={$t('images.position', {
            values: { current: position + 1, total: slides.length },
          })}>
          <PictureCover
            {picture}
            {title}
            {userId}
            {shape}
            size="full" />
        </div>
      {/each}
    </div>
    {#if slides.length}
      <!-- The stage is a group that scrolls with the arrow keys, which a screen reader's list of buttons does not show: this is its button (out of the tab order, the stage is the one stop; a click on the stage opens the viewer too). -->
      <button
        type="button"
        class="icon-button icon-button--overlay picture-carousel__expand"
        tabindex="-1"
        aria-label={$t('images.viewer.open')}
        onclick={openViewer}>
        <Icon name="expand" />
      </button>
    {/if}
    {#if reportOnly && shown}
      <!-- Upper left, like the expand hint upper right; over the photo, so nothing moves. Offline it stays, `aria-disabled`, and says why. -->
      <button
        type="button"
        class="icon-button icon-button--overlay picture-carousel__report"
        aria-label={$t(photoMenuLabel.report)}
        aria-disabled={online ? undefined : 'true'}
        title={online ? $t(photoMenuLabel.report) : $t('images.menu.offline')}
        onclick={() => online && (dialog = { action: 'report', id: shown!.id })}>
        <Icon name="flag" />
      </button>
    {/if}
    {#if shown && entries.length && !reportOnly}
      <!-- Upper left like the flag: the photo's options over the photo, so the meta row holds only text and nothing moves. -->
      <div class="picture-carousel__menu">
        <ActionMenu
          label={$t('images.menu.label')}
          items={entries.map(({ action, disabled }) => ({
            id: action,
            label: $t(photoMenuLabel[action]),
            disabled,
            danger: action === 'delete',
          }))}
          note={online ? undefined : $t('images.menu.offline')}
          onSelect={choose}
          overlay />
      </div>
    {/if}
    {#if shown}
      <!-- Bottom left over the photo, in the style of the other overlays: the kind, the uploader and the firing date, one line. The viewer opens from it like from the stage. -->
      <div class="picture-carousel__line">
        <PictureMeta
          picture={slides[current]}
          part="line" />
      </div>
    {/if}
    {#if slides.length > 1}
      <span
        id={hintId}
        class="visually-hidden">
        {$t('images.viewer.hint')}
      </span>
    {/if}
  </div>
  {#if shown?.caption}
    <!-- The uploader's own words (up to 200 characters) stay whole, as text under the stage. -->
    <div class="picture-carousel__meta">
      <PictureMeta
        picture={slides[current]}
        part="caption" />
    </div>
  {/if}
  {#if slides.length > 1}
    <div class="picture-carousel__strip">
      <PictureStrip
        pictures={slides}
        {current}
        {userId}
        onSelect={show} />
    </div>
    <span
      class="visually-hidden"
      aria-live="polite"
      aria-atomic="true">
      <!-- Silent while the viewer is open: its own live region names each step, once. -->
      {viewing ? '' : $t('images.position', { values: { current: current + 1, total: slides.length } })}
    </span>
  {/if}
  {@render actions?.()}
  <!-- The last photo vanishing (deleted elsewhere) takes the whole gallery, and with it the viewer, off the page. -->
  {#if viewing && slides.length}
    <PhotoViewer
      {slides}
      {current}
      {title}
      {userId}
      onShow={show}
      onClose={() => (viewing = false)} />
  {/if}
  {#if dialog?.action === 'details' && dialogImage && onChangeDetails}
    <PictureDetailsDialog
      image={dialogImage}
      {online}
      error={detailsError}
      onChange={changeDetails}
      onClose={() => (dialog = null)} />
  {:else if dialog?.action === 'kind' && dialogImage && onChangeKind}
    <PictureKindDialog
      image={dialogImage}
      glaze={allowPackaging && !dialogSlide?.combination}
      {online}
      error={kindError}
      onChange={changeKind}
      onClose={() => (dialog = null)} />
  {:else if dialog?.action === 'focus' && dialogImage && onChangeFocus}
    {@const focused = dialogImage}
    <PhotoFocusDialog
      source={() => fullPhoto(focused)}
      name={title}
      start={focusOf(focused)}
      {online}
      error={focusError}
      onSave={(focus) => onChangeFocus(focused, focus)}
      onClose={() => (dialog = null)} />
  {:else if dialog?.action === 'visibility' && dialogImage}
    <PictureVisibilityDialog
      image={dialogImage}
      {clubs}
      audience={dialogAudience}
      {online}
      error={visibilityError}
      onChange={changeVisibility}
      onClose={() => (dialog = null)} />
  {:else if dialog?.action === 'report' && dialogImage && onReport}
    {@const reported = dialogImage}<ReportImageDialog
      {online}
      error={reportError}
      onSubmit={(reason) => onReport(reported, reason)}
      onClose={() => (dialog = null)} />
  {/if}
</section>

<style>
  .picture-carousel {
    min-width: 0;
  }
  .picture-carousel__stage {
    position: relative;
  }
  .picture-carousel__viewport--openable {
    cursor: zoom-in;
  }
  /* A hint in the corner of the stage that it opens full screen; over the photo, so nothing moves. */
  .picture-carousel__expand {
    position: absolute;
    right: var(--space-2);
    top: var(--space-2);
    /* A decoration for the pointer: a click on it lands on the stage underneath, which opens the viewer. So it is no touch target and stays small. */
    width: 2rem;
    height: 2rem;
    pointer-events: none;
  }
  .picture-carousel__line {
    position: absolute;
    left: var(--space-2);
    bottom: var(--space-2);
    /* Clear of the stage's edges and as wide as its text, never wider than the stage. */
    max-width: calc(100% - 2 * var(--space-2));
    box-sizing: border-box;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--surface);
    border: 0.0625rem solid var(--border);
    color: var(--ink);
    /* A decoration for the pointer, like the expand hint: a click on it lands on the stage and opens the viewer. */
    pointer-events: none;
    --picture-meta-color: var(--ink);
  }
  .picture-carousel__menu {
    position: absolute;
    left: var(--space-2);
    top: var(--space-2);
  }
  .picture-carousel__report {
    position: absolute;
    left: var(--space-2);
    top: var(--space-2);
  }
  .picture-carousel__viewport {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
    /* Buttons, keys and touch scrolling remain; hide the classic scrollbar strip. */
    scrollbar-width: none;
  }
  .picture-carousel__viewport::-webkit-scrollbar {
    display: none;
  }
  .picture-carousel__viewport:focus-visible {
    outline: var(--space-1) solid var(--focus);
    outline-offset: calc(-1 * var(--space-1));
  }
  .picture-carousel__slide {
    flex: 0 0 100%;
    min-width: 0;
    scroll-snap-align: start;
  }
  .picture-carousel__meta {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3) 0;
  }
  /* Level with the text above (the strip's scroller pads its thumbnails for their focus ring). */
  .picture-carousel__strip {
    padding: 0 calc(var(--space-3) - var(--space-1-5));
  }
</style>

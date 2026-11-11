<script lang="ts">
  import type { Focus } from '../../lib/images/photo-focus';
  import type { Snippet } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { Club, ClubMember, Glaze, ImageInfo, UploadTarget, User } from '../../lib/api/models';
  import type { ImageDetailsChange, ImageVisibilityChange } from '../../lib/api/inputs';
  import { glazeCode, glazeTitle } from '../../lib/glazes/glazes';
  import type { PictureSelection } from '../../lib/images/pictures';
  import { watchStickyFit } from '../../lib/layout/sticky-fit';
  import FavoriteButton from '../catalog/FavoriteButton.svelte';
  import TagList from '../tags/TagList.svelte';
  import PictureCarousel from '../images/PictureCarousel.svelte';
  import PictureCover from '../images/PictureCover.svelte';
  import PictureThumbnails from '../images/PictureThumbnails.svelte';

  interface Props {
    glaze: Glaze;
    /** The glaze's own pictures and finished pieces of combinations using it, already ordered. */
    pictures: PictureSelection;
    user: User | null;
    online: boolean;
    favorite: boolean;
    onToggleFavorite: () => Promise<boolean>;
    onAddPhoto: (target: UploadTarget) => void;
    detail?: boolean;
    /** 1 on the detail page, where the title is the page's h1; lists keep 3. */
    headingLevel?: 1 | 3;
    /** The photo the detail page's carousel opens at. */
    focusPhoto?: string;
    /** The account's clubs, offered when the uploader changes who sees a picture (detail only). */
    clubs?: Club[];
    /** Their member lists, so a photo on someone else's combination is offered only what its author can see. */
    clubMembers?: Record<string, ClubMember[]>;
    /** The photo menu's actions (detail only). */
    onRemove?: (image: ImageInfo) => void;
    onReport?: (image: ImageInfo, reason: string | null) => Promise<boolean>;
    reportError?: string;
    visibilityError?: string;
    detailsError?: string;
    onChangeDetails?: (image: ImageInfo, change: ImageDetailsChange) => Promise<boolean>;
    kindError?: string;
    onChangeKind?: (image: ImageInfo, kind: ImageInfo['kind']) => Promise<boolean>;
    /** Sets where the cards' covers centre a photo (`canDelete`, like the kind); omitted for read-only views. */
    onChangeFocus?: (image: ImageInfo, focus: Focus | null) => Promise<boolean>;
    focusError?: string;
    onChangeVisibility?: (image: ImageInfo, change: ImageVisibilityChange) => Promise<boolean>;
    /** Shown under the title (the detail page's shelf line). */
    status?: Snippet;
    /** The detail page's own parts of the right column, in this order after the notes: the action row, the details (About, tags, codes), then the related-combination preview. */
    share?: Snippet;
    actions?: Snippet;
    combinations?: Snippet;
    footer?: Snippet;
  }
  let {
    glaze,
    pictures,
    user,
    online,
    favorite,
    onToggleFavorite,
    onAddPhoto,
    detail = false,
    headingLevel = 3,
    focusPhoto,
    clubs = [],
    clubMembers,
    onChangeVisibility,
    onChangeDetails,
    detailsError,
    onChangeKind,
    kindError,
    onChangeFocus,
    focusError,
    onRemove,
    onReport,
    reportError,
    visibilityError,
    status,
    share,
    actions,
    combinations,
    footer,
  }: Props = $props();
  let title = $derived(glazeTitle(glaze));
  /** The detail page's gallery follows the page only while all of it fits the window (as the combination page's). */
  let sticky = $state(false);
  const followPage = (node: HTMLElement) => watchStickyFit(node, (fits) => (sticky = fits));
</script>

<article
  class={['glaze-card', { 'glaze-card--detail': detail }]}
  data-picture-focus
  tabindex="-1">
  <div
    class={['glaze-card__media', { 'glaze-card__media--sticky': sticky }]}
    {@attach detail ? followPage : undefined}>
    {#if detail && pictures.cover}
      <PictureCarousel
        {pictures}
        {title}
        {focusPhoto}
        userId={user?.id}
        {online}
        {clubs}
        {clubMembers}
        {onChangeVisibility}
        {onChangeDetails}
        {detailsError}
        {onChangeKind}
        {kindError}
        {onChangeFocus}
        {focusError}
        allowPackaging
        {onRemove}
        {onReport}
        {reportError}
        {visibilityError} />
    {:else}
      <PictureCover
        picture={pictures.cover}
        {title}
        userId={user?.id}
        compact={!detail} />
    {/if}
    <!-- Outside the gallery, so the first photo does not replace the button the upload dialog returns focus to. -->
    {#if detail && user}
      <div class="button-row glaze-card__photo-actions">
        <button
          type="button"
          class={['button', { 'button--primary': !pictures.cover }]}
          disabled={!online}
          onclick={() => onAddPhoto({ type: 'glaze', id: glaze.id, title })}>
          {$t('catalog.addPhoto')}
        </button>
      </div>
    {/if}
  </div>
  <div class="glaze-card__body">
    <div class="glaze-card__heading">
      <div>
        <p class="glaze-card__manufacturer">
          {glazeCode(glaze)}
        </p>
        <svelte:element
          this={`h${headingLevel}`}
          class="glaze-card__name">
          {glaze.name}
        </svelte:element>
      </div>
      <div class="glaze-card__header-actions">
        <FavoriteButton
          active={favorite}
          signedIn={!!user}
          {online}
          onToggle={onToggleFavorite} />
        {@render share?.()}
      </div>
    </div>
    {@render status?.()}
    {#if glaze.notes}
      <p class="glaze-card__notes">{glaze.notes}</p>
    {/if}
    {#if !detail}
      <TagList tags={glaze.tags} />
    {/if}
    {#if !detail}
      <PictureThumbnails
        pictures={pictures.thumbnails}
        {title}
        userId={user?.id} />
    {/if}
    {#if !detail && user && online}
      <button
        class="glaze-card__add-photo"
        onclick={() => {
          onAddPhoto({ type: 'glaze', id: glaze.id, title });
        }}>
        {$t('catalog.addPhoto')}
      </button>
    {/if}
    {#if detail}
      {@render actions?.()}
      {@render footer?.()}
      {@render combinations?.()}
    {/if}
  </div>
</article>

<style>
  .glaze-card {
    background: var(--surface);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    /* Clips the cover's corners but, unlike hidden, leaves the detail page's sticky gallery free to stick. */
    overflow: clip;
  }
  .glaze-card__body {
    padding: var(--space-5);
  }
  /* From 45em the detail page is two columns, as the combination page: the gallery (it follows the page while the rest is read) and the glaze with its combinations. */
  @media (width >= 45em) {
    .glaze-card--detail {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .glaze-card--detail .glaze-card__media {
      align-self: start;
    }
    .glaze-card--detail .glaze-card__body {
      padding: var(--space-5) var(--space-6);
      border-inline-start: 0.0625rem solid var(--border);
    }
  }
  @media (width >= 68.75em) {
    .glaze-card--detail {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    }
  }
  /* Only while the whole gallery fits the window (`watchStickyFit`): a taller one would hide its lower part until the page ends. */
  @media (width >= 45em) {
    .glaze-card--detail .glaze-card__media--sticky {
      position: sticky;
      /* Under the sticky header, which `--header-offset` follows out and in (`fitsSticky` counts its height). */
      top: calc(var(--header-offset) + var(--space-4));
    }
    @media (prefers-reduced-motion: no-preference) {
      .glaze-card--detail .glaze-card__media--sticky {
        transition: top 0.2s ease;
      }
    }
  }
  .glaze-card__photo-actions {
    padding: var(--space-3) var(--space-3) 0;
  }
  .glaze-card__header-actions {
    display: flex;
    align-items: center;
    flex: none;
    gap: var(--space-2);
  }
  .glaze-card__heading {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: var(--space-3);
  }
  .glaze-card__manufacturer {
    color: var(--muted);
    font-size: var(--font-sm);
    margin: 0 0 var(--space-2);
  }
  .glaze-card__heading > div {
    min-width: 0;
  }
  .glaze-card__name {
    font-size: var(--font-xl);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .glaze-card__notes {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .glaze-card__add-photo {
    padding: var(--space-2-5) 0 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
  }
  /* The button shares the width of the gallery on a phone. */
  @media (width < 45em) {
    .glaze-card__photo-actions .button {
      flex: 1 1 auto;
    }
  }
  @media (pointer: coarse) {
    .glaze-card__add-photo {
      display: inline-flex;
      align-items: center;
      min-width: var(--touch-target);
      min-height: var(--touch-target);
      padding: 0;
    }
  }
</style>

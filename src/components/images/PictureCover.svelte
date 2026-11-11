<script lang="ts">
  import { coverPosition } from '../../lib/images/photo-focus';
  import { t } from '../../lib/i18n';
  import { imageKindKey, pictureDescription, pictureSrc, type Picture, type StageShape } from '../../lib/images/pictures';
  import ImageView from './ImageView.svelte';

  interface Props {
    picture: Picture | null;
    /** Name of the glaze or combination the card shows. */
    title: string;
    userId: string | null | undefined;
    /** Offers a first photo in the placeholder of a card without pictures, when given. */
    onAddPhoto?: () => void;
    compact?: boolean;
    /** Cards load the small card copy; the detail gallery (`PictureCarousel`) the full size. */
    size?: 'card' | 'full';
    /** The stage of the detail gallery (`stageShape`): the whole photo, never cropped. Cards keep their fixed crop. */
    shape?: StageShape;
    /** Makes the cover a button that opens the card's photo viewer (a list card; the detail gallery has its own stage). */
    onOpen?: (opener: HTMLElement) => void;
  }

  let { picture, title, userId, onAddPhoto, compact = false, size = 'card', shape = 'square', onOpen }: Props = $props();
  let description = $derived(picture ? pictureDescription(picture, title) : null);
  let stage = $derived(size === 'full' && !!picture);
</script>

<div
  class={[
    'picture-cover',
    {
      'picture-cover--empty': !picture,
      'picture-cover--compact': compact && !picture,
      'picture-cover--stage': stage,
      'picture-cover--landscape': stage && shape === 'landscape',
      'picture-cover--square': stage && shape === 'square',
      'picture-cover--portrait': stage && shape === 'portrait',
    },
  ]}>
  {#if picture && description}
    {#key picture.image.id}
      <ImageView
        src={pictureSrc(picture.image, size)}
        {userId}
        variant={size === 'full' ? 'stage' : 'cover'}
        position={coverPosition(picture.image)}
        alt={$t(description.key, { values: { title: description.title } })} />
    {/key}
  {:else}
    <div class="picture-cover__empty">
      {#if !compact}
        <img
          class="picture-cover__empty-icon"
          src="/icon.svg"
          alt=""
          width="56"
          height="56" />
      {/if}
      <small class="picture-cover__empty-label">{$t('images.noPhoto')}</small>
      {#if onAddPhoto}
        <button
          type="button"
          class="picture-cover__add"
          onclick={() => onAddPhoto()}>
          {$t('images.addTestTile')}
        </button>
      {/if}
    </div>
  {/if}
  <!-- The stage of the detail gallery has no badge: its meta line names the kind (and the combination a glaze's photo comes from). -->
  {#if picture && !stage}
    <div class="picture-cover__badge">
      {$t(imageKindKey(picture.image.kind))}
      {#if picture.combination}
        <span class="picture-cover__source">
          {$t('images.usedIn', { values: { title: picture.combination.title } })}
        </span>
      {/if}
    </div>
  {/if}
  <!-- A sibling above the picture and its badge, never a wrapper or a link: the photo keeps its text and the card keeps one link per title. -->
  {#if picture && !stage && onOpen}
    <button
      type="button"
      class="picture-cover__open"
      aria-label={$t('images.cover.open', { values: { title } })}
      onclick={(event) => onOpen(event.currentTarget)}>
    </button>
  {/if}
</div>

<style>
  .picture-cover {
    height: 15rem;
    background: var(--sage);
    position: relative;
  }
  /* The detail gallery: the whole photo on the sage tint, sized by the tallest photo's shape and capped so it fits the screen. */
  .picture-cover--stage {
    width: 100%;
    height: auto;
    max-height: min(30svh, 16rem);
  }
  .picture-cover--landscape {
    aspect-ratio: 4 / 3;
  }
  .picture-cover--square {
    aspect-ratio: 1;
  }
  .picture-cover--portrait {
    aspect-ratio: 3 / 4;
  }
  @media (width >= 45em) {
    .picture-cover--stage {
      max-height: min(72vh, 40rem);
    }
  }
  .picture-cover--empty {
    height: 6rem;
  }
  .picture-cover--compact {
    height: 4rem;
  }
  .picture-cover__empty {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2-5);
    color: var(--muted);
  }
  .picture-cover__empty-icon {
    width: var(--space-10);
    height: var(--space-10);
  }
  .picture-cover__empty-label {
    font-size: var(--font-xs);
  }
  .picture-cover__add {
    padding: var(--space-1-5) var(--space-3);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
  }
  .picture-cover__open {
    position: absolute;
    inset: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
    cursor: pointer;
  }
  /* Inside the cover: the card clips its corners, so an outer ring would be cut off. A light band inside the ring keeps it
     visible on a photo of the ring's own colour (a celadon tile); forced colours drop the shadow and keep the outline. */
  .picture-cover__open:focus-visible {
    outline-offset: -0.1875rem;
    box-shadow: inset 0 0 0 0.375rem var(--surface);
  }
  .picture-cover__badge {
    position: absolute;
    left: 0.9375rem;
    bottom: 0.875rem;
    width: fit-content;
    max-width: calc(100% - 1.875rem);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--font-xs);
    font-weight: 700;
    letter-spacing: 0.0625rem;
    padding: var(--space-1-5) var(--space-2);
  }
  .picture-cover__source {
    display: block;
    font-weight: 400;
    letter-spacing: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (pointer: coarse) {
    .picture-cover__add {
      min-height: var(--touch-target);
    }
  }
</style>

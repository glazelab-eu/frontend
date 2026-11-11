<script lang="ts">
  import { coverPosition } from '../../lib/images/photo-focus';
  import { t } from '../../lib/i18n';
  import { pictureDescription, pictureSrc, type Picture } from '../../lib/images/pictures';
  import ImageView from './ImageView.svelte';

  interface Props {
    pictures: Picture[];
    /** Name of the glaze or combination the card shows. */
    title: string;
    userId: string | null | undefined;
    /** Makes each thumbnail a button that opens the card's photo viewer on that photo. */
    onOpen?: (picture: Picture, opener: HTMLElement) => void;
    /** How many photos the viewer has in all (the thumbnails follow the cover, so the first is the second photo). */
    total?: number;
  }

  let { pictures, title, userId, onOpen, total = pictures.length + 1 }: Props = $props();
</script>

{#if pictures.length}
  <ul
    class="picture-thumbnails"
    aria-label={$t('images.morePhotos')}>
    {#each pictures as picture, position (picture.image.id)}
      {@const description = pictureDescription(picture, title)}
      <li title={$t(description.key, { values: { title: description.title } })}>
        <ImageView
          variant="thumbnail"
          src={pictureSrc(picture.image)}
          position={coverPosition(picture.image)}
          {userId}
          alt={$t(description.key, { values: { title: description.title } })} />
        {#if onOpen}
          <!-- Out of the tab order: the cover opens the same viewer and its arrows reach every photo, so a card's photos cost one Tab stop. -->
          <button
            type="button"
            class="picture-thumbnails__open"
            tabindex="-1"
            aria-label={$t('images.thumbnail.open', { values: { current: position + 2, total, title } })}
            onclick={(event) => onOpen(picture, event.currentTarget)}>
          </button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .picture-thumbnails {
    display: flex;
    gap: var(--space-1-5);
    margin: var(--space-3) 0 0;
    padding: 0;
    list-style: none;
  }
  .picture-thumbnails li {
    position: relative;
  }
  .picture-thumbnails__open {
    position: absolute;
    inset: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    cursor: pointer;
  }
</style>

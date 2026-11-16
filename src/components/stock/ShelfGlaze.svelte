<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../../lib/i18n';
  import { coverPosition } from '../../lib/images/photo-focus';
  import { pictureSrc, type Picture } from '../../lib/images/pictures';
  import ImageView from '../images/ImageView.svelte';

  interface Props {
    /** The glaze's display code and name. */
    title: string;
    /** Link to the glaze page. */
    href: string;
    picture: Picture | null;
    userId: string;
    /** A used up entry: the title in the muted colour. */
    muted?: boolean;
    /** Lines under the title. */
    children?: Snippet;
  }

  let { title, href, picture, userId, muted = false, children }: Props = $props();
</script>

<!-- A shelf row's glaze: its test tile (or a placeholder) and the title link; the own shelf's rows and a buddy's list share it. -->
<div class="shelf-glaze">
  {#if picture}
    <ImageView
      variant="thumbnail"
      src={pictureSrc(picture.image)}
      position={coverPosition(picture.image)}
      {userId}
      alt={$t('images.alt.tile', { values: { title } })} />
  {:else}
    <div
      class="shelf-glaze__icon"
      aria-hidden="true">
      ◒
    </div>
  {/if}
  <div class="shelf-glaze__text">
    <a
      class={['shelf-glaze__title', { 'shelf-glaze__title--muted': muted }]}
      {href}>
      {title}
    </a>
    {@render children?.()}
  </div>
</div>

<style>
  .shelf-glaze {
    flex: 1 1 11rem;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
  }
  .shelf-glaze__icon {
    width: 3.3125rem;
    height: 3.3125rem;
    border-radius: var(--radius-sm);
    flex: none;
    background: var(--sage);
    color: var(--accent);
    display: grid;
    place-items: center;
    font-size: 1.1875rem;
  }
  .shelf-glaze__text {
    min-width: 0;
  }
  .shelf-glaze__title {
    display: block;
    font-size: var(--font-sm);
    font-weight: 700;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .shelf-glaze__title--muted {
    color: var(--muted);
  }
  @media (pointer: coarse) {
    .shelf-glaze__title {
      display: flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

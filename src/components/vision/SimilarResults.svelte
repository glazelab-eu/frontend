<script lang="ts">
  import { coverPosition } from '../../lib/images/photo-focus';
  import { t } from '../../lib/i18n';
  import { routeHref } from '../../lib/routing/routes';
  import type { SimilarHit } from '../../lib/vision/similar';
  import ImageView from '../images/ImageView.svelte';

  interface Props {
    hits: SimilarHit[];
    userId: string | null | undefined;
    /** Opens each item in a new tab (the upload dialog: leaving would discard the photos not yet saved). */
    blank?: boolean;
    /** Lets the host take the click (the photo viewer closes its history entry first). */
    onOpen?: (event: MouseEvent, href: string) => void;
    /** On the viewer's dark ground. */
    dark?: boolean;
  }

  let { hits, userId, blank = false, onOpen, dark = false }: Props = $props();
</script>

<ul class={['similar-results', { 'similar-results--dark': dark }]}>
  {#each hits as hit (hit.photo.id)}
    {@const href = routeHref({ name: hit.photo.type, id: hit.photo.itemId })}
    <li class="similar-results__item">
      <a
        class="similar-card"
        {href}
        target={blank ? '_blank' : undefined}
        rel={blank ? 'noopener' : undefined}
        onclick={(event) => onOpen?.(event, href)}>
        <span class="similar-card__image">
          <ImageView
            src={hit.photo.image.cardUrl}
            position={coverPosition(hit.photo.image)}
            {userId} />
        </span>
        <span class="similar-card__title">{hit.photo.title}</span>
        <span class="similar-card__type">{$t(hit.photo.type === 'glaze' ? 'similar.type.glaze' : 'similar.type.combination')}</span>
      </a>
    </li>
  {/each}
</ul>

<style>
  .similar-results {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    gap: var(--space-3);
    margin: 0 0 var(--space-3);
    padding: 0;
    list-style: none;
  }
  .similar-card {
    display: grid;
    gap: var(--space-1);
    color: inherit;
    text-decoration: none;
  }
  .similar-card:hover .similar-card__title {
    text-decoration: underline;
  }
  .similar-card__image {
    display: block;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: var(--radius-sm);
  }
  .similar-card__title {
    font-size: var(--font-sm);
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .similar-card__type {
    color: var(--muted);
    font-size: var(--font-xs);
  }
  .similar-results--dark .similar-card__type {
    color: var(--viewer-muted);
  }
  .similar-results--dark .similar-card {
    color: var(--viewer-ink);
  }
  .similar-results--dark .similar-card:focus-visible {
    outline: 0.1875rem solid var(--viewer-ink);
    outline-offset: 0.125rem;
  }
  .similar-results--dark {
    grid-template-columns: repeat(auto-fill, minmax(5rem, 1fr));
  }
</style>

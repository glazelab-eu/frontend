<script lang="ts">
  import { coverPosition } from '../../lib/images/photo-focus';
  import { t } from '../../lib/i18n';
  import type { Combination } from '../../lib/api/models';
  import { routeHref } from '../../lib/routing/routes';
  import { combinationTitle } from '../../lib/glazes/glazes';
  import { combinationPictures, pictureSrc } from '../../lib/images/pictures';
  import ImageView from '../images/ImageView.svelte';

  interface Props {
    /** The combination this one is a variation of, when the viewer may see it. */
    source?: Combination;
    /** The listed variations of this combination. */
    variations: readonly Combination[];
    /** The viewer, whose private cover photos are fetched with their session (`ImageView`). */
    userId: string | null | undefined;
  }

  let { source, variations, userId }: Props = $props();
  const nameOf = (combo: Combination) => combinationTitle(combo, $t('combination.untitled'));
</script>

<!-- A chip: the cover's card copy (a neutral square without a photo), the title and who made it; only the viewer's own drafts are ever listed. -->
{#snippet chip(combo: Combination, title: string)}
  {@const cover = combinationPictures(combo).cover}
  <a
    class="lineage-chip"
    href={routeHref({ name: 'combination', id: combo.id })}>
    {#if cover}
      <ImageView
        variant="thumbnail"
        src={pictureSrc(cover.image)}
        position={coverPosition(cover.image)}
        {userId} />
    {:else}
      <span
        class="lineage-chip__placeholder"
        aria-hidden="true">
      </span>
    {/if}
    <span class="lineage-chip__text">
      <span class="lineage-chip__title">{title}</span>
      <span class="lineage-chip__by">
        {combo.draft ? $t('combination.variations.yourDraft') : $t('combination.variations.by', { values: { name: combo.author ?? $t('account.deleted') } })}
      </span>
    </span>
  </a>
{/snippet}

{#if source}
  <div class="combination-lineage__source">
    <p class="combination-lineage__label">{$t('combination.basedOn')}</p>
    {@render chip(source, nameOf(source))}
  </div>
{/if}
{#if variations.length}
  <section
    class="combination-lineage"
    aria-labelledby="variations-title">
    <h2
      id="variations-title"
      class="combination-lineage__title">
      {$t('combination.variations.title')}
    </h2>
    <ul class="combination-lineage__list">
      {#each variations as variation (variation.id)}
        <li>
          {@render chip(variation, variation.draft ? $t('combination.variations.draft', { values: { title: nameOf(variation) } }) : nameOf(variation))}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .combination-lineage__source {
    margin: var(--space-4) 0 0;
  }
  .combination-lineage__label {
    margin: 0 0 var(--space-1-5);
    color: var(--muted);
  }
  .combination-lineage {
    margin: var(--space-4) 0;
  }
  .combination-lineage__title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-md);
  }
  .combination-lineage__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* One link per chip: the thumbnail (53 px, a neutral square when the combination has no photo), the title and the author. */
  .lineage-chip {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    max-width: 100%;
    padding: var(--space-1-5);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
    text-decoration: none;
  }
  .lineage-chip:hover .lineage-chip__title {
    text-decoration: underline;
  }
  .lineage-chip__placeholder {
    flex: none;
    width: 3.3125rem;
    height: 3.3125rem;
    border-radius: var(--radius-sm);
    background: var(--sage);
  }
  .lineage-chip__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  /* A long title wraps up to two lines and then ends in an ellipsis; a long name ends in one. The whole text stays the link's name. */
  .lineage-chip__title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
    font-weight: 600;
  }
  .lineage-chip__by {
    overflow: hidden;
    color: var(--muted);
    font-size: var(--font-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

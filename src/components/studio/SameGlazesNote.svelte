<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { Combination, UploadTarget } from '../../lib/api/models';
  import { combinationTitle } from '../../lib/glazes/glazes';
  import { routeHref } from '../../lib/routing/routes';
  import Callout from '../ui/Callout.svelte';

  interface Props {
    /** The first combinations with the same glazes in the same order as the form; none hides the note. */
    items: readonly Combination[];
    /** How many there are in all, named or not. */
    total: number;
    /** Adding a photo needs the connection; the links still work offline. The form's fieldset disables the buttons while it saves. */
    online: boolean;
    onAddPhoto: (target: UploadTarget) => void;
  }

  let { items, total, online, onAddPhoto }: Props = $props();
  const nameOf = (combo: Combination) => combinationTitle(combo, $t('combination.untitled'));
  let summary = $derived(items.length ? $t('studio.sameGlazes.body', { values: { count: total } }) : '');
</script>

<!--
  Same glazes in the same order may still be a different test (coats, application, firing), so this only informs: the writer
  may add their photos to the existing combination instead. The summary is announced from a region that stays mounted; the
  box itself comes and goes with the matches, so its sentence is hidden from screen readers to avoid reading it twice.
-->
<p
  class="visually-hidden"
  role="status">
  {summary}
</p>
{#if items.length}
  <div class="same-glazes">
    <Callout
      as="section"
      id="same-glazes"
      tone="warm"
      aria-labelledby="same-glazes-title">
      <p
        id="same-glazes-title"
        class="same-glazes__title">
        {$t('studio.sameGlazes.title')}
      </p>
      <p
        class="same-glazes__body"
        aria-hidden="true">
        {summary}
      </p>
      <ul class="same-glazes__items">
        {#each items as combo (combo.id)}
          {@const title = nameOf(combo)}
          <li class="same-glazes__item">
            <span class="same-glazes__text">
              <a
                class="same-glazes__link"
                href={routeHref({ name: 'combination', id: combo.id })}>
                {title}
              </a>
              <span class="same-glazes__by">
                {combo.draft
                  ? $t('combination.variations.yourDraft')
                  : $t('combination.variations.by', { values: { name: combo.author ?? $t('account.deleted') } })}
              </span>
            </span>
            <button
              type="button"
              class="button same-glazes__add"
              disabled={!online}
              aria-label={$t('studio.sameGlazes.add', { values: { title } })}
              onclick={() => onAddPhoto({ type: 'combination', id: combo.id, title })}>
              {$t('studio.sameGlazes.addShort')}
            </button>
          </li>
        {/each}
      </ul>
      {#if total > items.length}
        <p class="same-glazes__more">{$t('studio.sameGlazes.more', { values: { count: total - items.length } })}</p>
      {/if}
    </Callout>
  </div>
{/if}

<style>
  .same-glazes {
    margin-top: var(--space-4);
  }
  .same-glazes__title {
    margin: 0;
    font-weight: 700;
  }
  .same-glazes__body {
    margin: var(--space-1) 0 var(--space-2);
  }
  .same-glazes__items {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .same-glazes__item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    min-height: var(--touch-target);
    border-top: 0.0625rem solid var(--warm-ink);
    padding: var(--space-1) 0;
  }
  .same-glazes__text {
    display: grid;
    flex: 1 1 10rem;
    min-width: 0;
  }
  .same-glazes__link {
    color: var(--accent);
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .same-glazes__by {
    font-size: var(--font-xs);
    overflow-wrap: anywhere;
  }
  .same-glazes__add {
    min-height: var(--touch-target);
  }
  .same-glazes__more {
    margin: var(--space-2) 0 0;
    font-size: var(--font-xs);
  }
  @media (pointer: coarse) {
    .same-glazes__link {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
    .same-glazes__by,
    .same-glazes__more {
      font-size: var(--font-body);
    }
  }
</style>

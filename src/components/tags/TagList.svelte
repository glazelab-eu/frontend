<script lang="ts">
  import { t } from '../../lib/i18n';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    /** User-authored tags, shown as they are (never translated). */
    tags: string[];
    /** Adds a remove button to every tag; `button` is the pressed one, which goes with the tag. */
    onRemove?: (tag: string, button: HTMLElement) => void;
    /** Names the list and its remove buttons when they mean more than the item's tags. */
    label?: string;
    removeLabel?: (tag: string) => string;
    /** No margin of its own, for a row that spaces its parts (`ItemTags` `inline`). */
    compact?: boolean;
  }

  let { tags, onRemove, label, removeLabel, compact = false }: Props = $props();
  const removeText = (tag: string) => (removeLabel ? removeLabel(tag) : $t('tags.remove', { values: { tag } }));
</script>

{#if tags.length}
  <ul
    class={['tag-list', { 'tag-list--compact': compact }]}
    aria-label={label ?? $t('tags.label')}>
    {#each tags as tag (tag)}
      <li class="tag-list__tag">
        <span class="tag-list__text">{tag}</span>
        {#if onRemove}
          <button
            class="icon-button icon-button--quiet tag-list__remove"
            type="button"
            aria-label={removeText(tag)}
            title={removeText(tag)}
            onclick={(event) => {
              event.preventDefault();
              onRemove(tag, event.currentTarget);
            }}>
            <Icon name="close" />
          </button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
    margin: var(--space-3) 0 var(--space-2);
    padding: 0;
    list-style: none;
  }
  .tag-list--compact {
    margin: 0;
  }
  .tag-list__tag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    max-width: 100%;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--blue);
    color: var(--ink);
    font-size: var(--font-sm);
    font-weight: 600;
  }
  .tag-list__text {
    overflow-wrap: anywhere;
  }
  /* Sized to the tag it sits in; the pointer query below keeps the touch size. */
  .tag-list__remove {
    --icon-size: 1rem;
    width: 1.5rem;
    height: 1.5rem;
    margin-right: calc(-1 * var(--space-1));
    border-radius: var(--radius-pill);
  }
  @media (pointer: coarse) {
    .tag-list__remove {
      width: var(--touch-target);
      height: var(--touch-target);
      margin-block: calc(-1 * var(--space-0-5));
    }
  }
</style>

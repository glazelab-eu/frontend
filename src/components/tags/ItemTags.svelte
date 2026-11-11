<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { TagChange } from '../../lib/api/inputs';
  import type { TagCount } from '../../lib/tags/tags';
  import TagEditor from './TagEditor.svelte';
  import TagList from './TagList.svelte';

  interface Props {
    tags: string[];
    suggestions: TagCount[];
    /** Signed in and online; offline the tags are read-only. */
    editable: boolean;
    /** Sends one addition or removal; resolves true when it was saved. */
    onChange: (change: TagChange) => Promise<boolean>;
    /**
     * One line inside a card (the combination page): the label, the tags as chips and the edit button side by side, no frame of its
     * own; without tags only the add button shows (its label is still the section's h2, visually hidden).
     */
    inline?: boolean;
  }

  let { tags, suggestions, editable, onChange, inline = false }: Props = $props();
  const id = $props.id();

  /** The tags are read first; the editor opens on demand and goes when editing stops being possible. */
  let open = $state(false);
  let editing = $derived(open && editable);
  let editor = $state<TagEditor>();
  let editButton = $state<HTMLButtonElement>();

  $effect(() => {
    if (!editable) open = false;
  });

  async function toggle(next: boolean) {
    open = next;
    await tick();
    if (next) editor?.focus();
    else editButton?.focus();
  }
</script>

{#if editable || tags.length}
  <section
    class={['item-tags', { 'item-tags--inline': inline, 'item-tags--editing': editing }]}
    aria-labelledby={id}>
    <div class="item-tags__head">
      <h2
        class={['item-tags__title', { 'visually-hidden': inline && !editing && !tags.length }]}
        {id}>
        {$t('tags.label')}
      </h2>
      {#if inline && !editing}
        <TagList
          {tags}
          compact />
      {/if}
      {#if editable}
        <button
          type="button"
          class="item-tags__toggle"
          bind:this={editButton}
          aria-expanded={editing}
          onclick={() => void toggle(!editing)}>
          {editing ? $t('common.done') : inline && !tags.length ? $t('tags.addFirst') : $t('tags.edit')}
        </button>
      {/if}
    </div>
    {#if editing}
      <TagEditor
        compact
        bind:this={editor}
        {tags}
        {suggestions}
        onAdd={(tag) => onChange({ add: [tag] })}
        onRemove={(tag) => onChange({ remove: [tag] })} />
    {:else if inline}
      <!-- The chips stand in the head row. -->
    {:else if tags.length}
      <TagList {tags} />
    {:else}
      <p class="item-tags__empty">{$t('tags.empty')}</p>
    {/if}
  </section>
{/if}

<style>
  .item-tags {
    margin-top: var(--space-5);
    padding: var(--space-4) var(--space-5) var(--space-1);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .item-tags__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .item-tags__title {
    margin: 0;
    font-size: var(--font-md);
    font-weight: 700;
  }
  .item-tags__toggle {
    min-height: var(--touch-target);
    padding: 0 var(--space-2);
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
  }
  .item-tags--inline {
    margin: var(--space-3) 0 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
  }
  .item-tags--inline .item-tags__head {
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: var(--space-1) var(--space-2);
  }
  .item-tags--inline .item-tags__title {
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .item-tags--inline .item-tags__toggle {
    min-height: 2rem;
    padding: 0 var(--space-1);
  }
  .item-tags--editing .item-tags__toggle {
    margin-inline-start: auto;
  }
  .item-tags__empty {
    margin: var(--space-2) 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-sm);
  }
  @media (pointer: coarse) {
    .item-tags__toggle,
    .item-tags--inline .item-tags__toggle {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
  }
</style>

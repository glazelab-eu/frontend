<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** The page's own block name beside `record-list` (the e2e suite finds the lists by it). */
    class?: string;
    busy: boolean;
    /** Takes focus (`tabindex="-1"`) when the entry that had it leaves the list. */
    focusable?: boolean;
    element?: HTMLElement;
    /** The `Record` entries. */
    children: Snippet;
  }

  let { class: block = '', busy, focusable = false, element = $bindable(), children }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (only ever -1: a focus target for scripts, not a tab stop) -->
<ul
  class={['record-list', block]}
  aria-busy={busy}
  tabindex={focusable ? -1 : undefined}
  bind:this={element}>
  {@render children()}
</ul>

<style>
  .record-list {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
</style>

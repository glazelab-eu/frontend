<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** The page's own entry class beside `record` (the e2e suite finds the entries by it). */
    class?: string;
    children: Snippet;
  }

  let { class: entry = '', children }: Props = $props();
</script>

<li class={['record', entry]}>
  {@render children()}
</li>

<style>
  .record {
    background: var(--surface);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    overflow-wrap: anywhere;
    display: grid;
    gap: var(--space-3);
  }
</style>

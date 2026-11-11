<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A record's facts: `RecordField` pairs, label beside value on wide screens, below it on phones. */
  let { children }: { children: Snippet } = $props();
</script>

<dl class="record__details">
  {@render children()}
</dl>

<style>
  .record__details {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 3fr);
    gap: var(--space-2);
    margin: 0;
    font-size: var(--font-sm);
  }
  @media (width < 45em) {
    .record__details {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>

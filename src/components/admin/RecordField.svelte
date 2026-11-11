<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    /** The value: text or inline markup (a `time`, a span with its own look). */
    children: Snippet;
  }

  let { label, children }: Props = $props();
</script>

<dt>{label}</dt>
<dd class="record__value">
  {@render children()}
</dd>

<style>
  .record__value {
    margin: 0;
  }
  @media (width < 45em) {
    .record__value {
      margin-bottom: var(--space-2);
    }
  }
</style>

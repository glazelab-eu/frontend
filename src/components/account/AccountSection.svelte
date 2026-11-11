<script lang="ts">
  import type { Snippet } from 'svelte';
  import PanelTitle from '../ui/PanelTitle.svelte';

  interface Props {
    /** The section's own h2: the account page is a list of these, so a feature adds its section by rendering another. */
    title: string;
    children: Snippet;
  }

  let { title, children }: Props = $props();
</script>

<section class="panel">
  <PanelTitle {title} />
  {@render children()}
</section>

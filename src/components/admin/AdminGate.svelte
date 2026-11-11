<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    siteAdmin: boolean;
    /** Leave it out where the page needs no connection (the landing page only links). */
    online?: boolean;
    adminOnlyText: string;
    offlineText?: string;
    /** The page itself: shown only to a site admin who is online. */
    children: Snippet;
  }

  let { siteAdmin, online = true, adminOnlyText, offlineText = '', children }: Props = $props();
</script>

<!-- Not admin first: a guest offline learns that the page is not theirs, not that it needs a connection. -->
{#if !siteAdmin}
  <p class="empty-state">{adminOnlyText}</p>
{:else if !online}
  <p class="empty-state">{offlineText}</p>
{:else}
  {@render children()}
{/if}

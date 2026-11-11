<script lang="ts">
  import { untrack } from 'svelte';
  import { viewerStart, type Picture } from '../../lib/images/pictures';
  import PhotoViewer from './PhotoViewer.svelte';

  interface Props {
    /** The card's photos (`viewerSlides`), which follow the card while the viewer is open. */
    slides: Picture[];
    /** The photo the viewer opens on (its image ID). */
    start: string;
    title: string;
    userId: string | null | undefined;
    /** The item's page, offered as "Open". */
    href?: string;
    onClose: () => void;
  }

  let { slides, start, title, userId, href, onClose }: Props = $props();
  // Mounted on a click only: a card without an open viewer costs nothing of this.
  let index = $state(untrack(() => viewerStart(slides, start)));
  let current = $derived(Math.min(index, Math.max(0, slides.length - 1)));
  // A list that loses the card's last photo while the viewer is open takes the viewer with it.
  $effect(() => {
    if (!slides.length) onClose();
  });
</script>

{#if slides.length}
  <PhotoViewer
    {slides}
    {current}
    {title}
    {userId}
    openHref={href}
    onShow={(position) => (index = position)}
    {onClose} />
{/if}

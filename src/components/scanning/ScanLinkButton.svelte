<script lang="ts">
  import type { ScanKind, ScannedLink } from '../../lib/scan/scanned-link';
  import LinkScanner from './LinkScanner.svelte';

  interface Props {
    /** The button's text and the scanner dialog's title ("Scan a buddy code"). */
    label: string;
    /** What the scanner says when the code is anything but a link of the allowed kinds. */
    refusal: string;
    /** The link routes this scan may open. */
    kinds: readonly ScanKind[];
    /** Opens the route of an accepted link (the scanner is already closed, so its camera is off). */
    onOpen: (link: ScannedLink) => void;
  }
  let { label, refusal, kinds, onOpen }: Props = $props();
  let scanning = $state(false);
</script>

<button
  type="button"
  class="button"
  onclick={() => (scanning = true)}>
  {label}
</button>
{#if scanning}
  <LinkScanner
    {label}
    {refusal}
    {kinds}
    {onOpen}
    onClose={() => (scanning = false)} />
{/if}

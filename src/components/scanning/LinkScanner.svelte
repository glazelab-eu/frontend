<script lang="ts">
  import { t } from '../../lib/i18n';
  import { scannedLink, type ScanKind, type ScannedLink } from '../../lib/scan/scanned-link';
  import BarcodeScanner from './BarcodeScanner.svelte';

  interface Props {
    /** The scanner dialog's title ("Scan a buddy code"). */
    label: string;
    /** What the scanner says when the code is anything but a link of the allowed kinds. */
    refusal: string;
    /** The link routes this scan may open. */
    kinds: readonly ScanKind[];
    /** Opens the route of an accepted link (the scanner is already closed, so its camera is off). */
    onOpen: (link: ScannedLink) => void;
    /** The scanner was closed without an accepted link, or after one (the host stops rendering it). */
    onClose: () => void;
  }
  let { label, refusal, kinds, onOpen, onClose }: Props = $props();
  let holding = $state(false);
  let note = $state('');
  let refusals = $state(0);
  const own = (text: string) => !!scannedLink(text, { origin: location.origin }, kinds);

  function scanned(text: string) {
    const link = scannedLink(text, { origin: location.origin }, kinds);
    if (link) {
      note = '';
      onClose();
      onOpen(link);
      return;
    }
    // Anything else is told and ignored; the camera goes on and the same code stays blocked until it leaves the frame.
    note = refusal;
    refusals++;
    holding = false;
  }
</script>

<BarcodeScanner
  mode="qr"
  keepOpen
  sheet
  valid={own}
  noteKey={refusals}
  bind:holding
  {note}
  title={label}
  onClose={() => {
    note = '';
    onClose();
  }}
  onBarcode={scanned} />

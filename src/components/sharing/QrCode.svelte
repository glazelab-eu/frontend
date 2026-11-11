<script lang="ts">
  import { t } from '../../lib/i18n';
  import { encodeQr, qrPath, QUIET_ZONE, QrTooLongError } from '../../lib/qr/qr';

  interface Props {
    /**
     * The link to encode. It may hold a secret token (buddy and invite links): it is encoded in the browser, never
     * stored and never sent anywhere. The consumer always shows the same link as text beside the code (copy, read
     * aloud, scanners that fail), and lazy-loads this component through `QrPanel`.
     */
    link: string;
    /** Accessible name of the image; defaults to a translated "QR code for this link". */
    label?: string;
  }

  let { link, label }: Props = $props();

  // The code and its size in modules (with the quiet zone), or null when the link does not fit a code.
  const code = $derived.by(() => {
    try {
      const matrix = encodeQr(link);
      return { path: qrPath(matrix), modules: matrix.size + 2 * QUIET_ZONE };
    } catch (error) {
      if (error instanceof QrTooLongError) return null;
      throw error;
    }
  });
</script>

{#if code}
  <svg
    class="qr-code"
    role="img"
    aria-label={label ?? $t('qr.label')}
    viewBox="0 0 {code.modules} {code.modules}"
    shape-rendering="crispEdges">
    <rect
      class="qr-code__surface"
      width={code.modules}
      height={code.modules} />
    <path
      class="qr-code__modules"
      d={code.path} />
  </svg>
{:else}
  <p class="qr-code__unavailable">{$t('qr.unavailable')}</p>
{/if}

<style>
  /* Dark modules on the light paper surface in every theme, so a phone camera reads the code. At least 240 px wide
     where the screen allows it (15rem), never wider than 20rem. */
  .qr-code {
    display: block;
    box-sizing: border-box;
    width: min(100%, 20rem);
    min-width: min(100%, 15rem);
    aspect-ratio: 1;
    color: var(--ink);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .qr-code__surface {
    fill: var(--paper);
  }
  .qr-code__modules {
    fill: currentColor;
  }
  .qr-code__unavailable {
    margin: 0;
    color: var(--muted);
    font-size: var(--font-sm);
  }
</style>

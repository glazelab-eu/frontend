<script lang="ts">
  import { t } from '../../lib/i18n';
  import { reloadApp } from '../../lib/pwa/update';

  interface Props {
    /** The link to encode; see `QrCode`. Show the same link as text beside this panel. */
    link: string;
    /** File name of the saved picture (`qrFileName`): never derived from the link. */
    fileName: string;
    /** Accessible name of the code; defaults to "QR code for this link". */
    label?: string;
  }

  let { link, fileName, label }: Props = $props();
  let status = $state<'saved' | 'failed' | ''>('');
  let busy = $state(false);

  // The picture is drawn and handed over on a click only; the drawing code loads then (the encoder chunk is shared with the code).
  async function save() {
    if (busy) return;
    busy = true;
    status = '';
    try {
      const { qrPng, saveQr } = await import('../../lib/qr/qr-png');
      const outcome = await saveQr(await qrPng(link), fileName, {
        navigator,
        document,
        url: URL,
        coarse: matchMedia('(pointer: coarse)').matches,
      });
      status = outcome === 'cancelled' ? '' : 'saved';
    } catch {
      status = 'failed';
    } finally {
      busy = false;
    }
  }
</script>

<div class="qr-panel">
  {#await Promise.all([import('./QrCode.svelte'), import('../../lib/qr/qr')]) then [{ default: QrCode }, { MAX_BYTES }]}
    <QrCode
      {link}
      {label} />
    {#if new TextEncoder().encode(link).length <= MAX_BYTES}
      <p class="qr-panel__hint">{$t('qr.hint')}</p>
      <button
        type="button"
        class="button"
        disabled={busy}
        onclick={save}>
        {$t('qr.save')}
      </button>
      <p class="qr-panel__hint">{$t('qr.saveHint')}</p>
      <p
        class="qr-panel__hint"
        role="status">
        {status === 'saved' ? $t('qr.saved') : status === 'failed' ? $t('qr.saveFailed') : ''}
      </p>
    {/if}
  {:catch}
    <!-- The chunk is precached, but a page of an older build may ask for a file the server no longer has: the newest version has it. -->
    <p
      class="qr-panel__problem"
      role="alert">
      {$t('qr.loadFailed')}
    </p>
    <button
      type="button"
      class="button"
      onclick={(event) => {
        event.preventDefault();
        void reloadApp();
      }}>
      {$t('route.reload')}
    </button>
  {/await}
</div>

<style>
  .qr-panel {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .qr-panel__hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .qr-panel__problem {
    margin: 0;
  }
  .qr-panel__hint:empty {
    display: none;
  }
</style>

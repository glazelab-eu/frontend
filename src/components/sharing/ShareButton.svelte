<script lang="ts">
  import { t } from '../../lib/i18n';
  import Icon from '../ui/Icon.svelte';
  import ModalShell from '../ui/ModalShell.svelte';

  interface Props {
    /** Shares the page; answers the link only when the user has to copy it by hand. */
    onShare: () => Promise<string | null>;
  }

  let { onShare }: Props = $props();
  let manualUrl = $state<string | null>(null);
  let busy = $state(false);

  const selectAll = (event: Event) => (event.currentTarget as HTMLInputElement).select();

  async function share() {
    if (busy) return;
    busy = true;
    try {
      manualUrl = await onShare();
    } finally {
      busy = false;
    }
  }
</script>

<button
  type="button"
  class="icon-button"
  aria-label={$t('share.action')}
  title={$t('share.action')}
  disabled={busy}
  onclick={share}>
  <Icon name="share" />
</button>
{#if manualUrl}
  <ModalShell
    title={$t('share.manual.title')}
    onClose={() => (manualUrl = null)}>
    {@render manual(manualUrl)}
  </ModalShell>
{/if}

{#snippet manual(url: string)}
  <p>{$t('share.manual.body')}</p>
  <label class="form-field">
    {$t('share.manual.label')}
    <input
      class="form-field__control"
      type="text"
      readonly
      value={url}
      onfocus={selectAll}
      onclick={selectAll} />
  </label>
  <div class="button-row button-row--end share-manual__actions">
    <button
      type="button"
      class="button"
      onclick={() => (manualUrl = null)}>
      {$t('common.close')}
    </button>
  </div>
{/snippet}

<style>
  .share-manual__actions {
    margin-top: var(--space-4);
  }
</style>

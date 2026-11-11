<script lang="ts">
  import { onMount } from 'svelte';
  import { locale, t } from '../../lib/i18n';
  import type { GlazeHistory } from '../../lib/api/models';
  import { editChange, editFieldLabel, formatEditedAt } from '../../lib/glazes/glaze-edit';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';

  interface Props {
    /** The glaze as shown elsewhere (manufacturer and code). */
    label: string;
    online: boolean;
    /** Why loading failed, shown in the dialog. */
    error?: string;
    /** Loads the change log; null offline or after a failure. */
    onLoad: () => Promise<GlazeHistory | null>;
    onClose: () => void;
  }

  let { label, online, error = '', onLoad, onClose }: Props = $props();
  let history = $state<GlazeHistory | null>(null);
  let loading = $state(false);

  onMount(() => {
    let alive = true;
    if (online) {
      loading = true;
      void onLoad().then((loaded) => {
        if (!alive) return;
        history = loaded;
        loading = false;
      });
    }
    return () => {
      alive = false;
    };
  });
</script>

<ModalShell
  title={$t('glaze.history.title')}
  {onClose}>
  <p class="glaze-history__label">{label}</p>
  {#if !history && !loading && !online}
    <p class="glaze-history__note">{$t('glaze.history.offline')}</p>
  {:else if loading}
    <p
      class="glaze-history__note"
      role="status">
      {$t('glaze.history.loading')}
    </p>
  {:else if history}
    {#if history.edits.length}
      <ol class="glaze-history__list">
        {#each history.edits as edit, index (index)}
          {@const change = editChange(edit)}
          <li class="glaze-history__entry">
            <p class="glaze-history__change">
              <span class="glaze-history__field">{$t(editFieldLabel(edit.field))}:</span>
              {$t(change.key, { values: change.values })}
            </p>
            <p class="glaze-history__by">
              {$t('glaze.history.by', {
                values: { name: edit.editor ?? $t('account.deleted'), date: formatEditedAt(edit.editedAt, $locale ?? 'en') },
              })}
            </p>
          </li>
        {/each}
      </ol>
      {#if history.more}
        <p class="glaze-history__note">{$t('glaze.history.more', { values: { count: history.edits.length } })}</p>
      {/if}
    {:else}
      <p class="glaze-history__note">{$t('glaze.history.empty')}</p>
    {/if}
  {:else}
    <FormError message={error || 'errors.generic'} />
  {/if}
  <div class="button-row button-row--end">
    <button
      type="button"
      class="button"
      onclick={onClose}>
      {$t('common.close')}
    </button>
  </div>
</ModalShell>

<style>
  .glaze-history__label {
    margin: 0 0 var(--space-4);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .glaze-history__note {
    color: var(--muted);
  }
  .glaze-history__list {
    max-height: 60vh;
    margin: 0 0 var(--space-4);
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  .glaze-history__entry {
    padding: var(--space-2) 0;
    border-bottom: 0.0625rem solid var(--border);
  }
  .glaze-history__change {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .glaze-history__field {
    margin-right: var(--space-1);
    font-weight: 700;
  }
  .glaze-history__by {
    margin: var(--space-1) 0 0;
    color: var(--muted);
    font-size: var(--font-sm);
  }
</style>

<script lang="ts">
  import { t } from '../../lib/i18n';

  interface Props {
    /** A reload runs while the shown list stays on screen (see `listStatus`). */
    refreshing: boolean;
  }

  let { refreshing }: Props = $props();
</script>

<span
  class="refresh-hint"
  role="status">
  {#if refreshing}
    {$t('lists.refreshing')}
  {/if}
</span>

<style>
  .refresh-hint {
    display: block;
    min-height: 1lh;
    color: var(--muted);
    font-size: var(--font-xs);
    font-weight: 400;
  }
</style>

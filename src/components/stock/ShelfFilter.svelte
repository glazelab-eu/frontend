<script lang="ts">
  import { t } from '../../lib/i18n';

  interface Props {
    /** The typed filter (code, manufacturer or name). */
    value: string;
  }

  let { value = $bindable() }: Props = $props();
</script>

<label class="form-field shelf-filter">
  {$t('stock.list.filter')}
  <input
    class="form-field__control"
    type="search"
    placeholder={$t('stock.list.filterPlaceholder')}
    bind:value />
</label>

<style>
  .shelf-filter {
    margin-bottom: var(--space-3);
  }
</style>

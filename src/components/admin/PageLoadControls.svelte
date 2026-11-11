<script lang="ts">
  import { errorText } from '../../lib/i18n';

  interface Props {
    busy: boolean;
    failed: boolean;
    hasMore: boolean;
    error?: string;
    retryLabel: string;
    moreLabel: string;
    onLoad: () => void;
  }

  let { busy, failed, hasMore, error = '', retryLabel, moreLabel, onLoad }: Props = $props();
</script>

{#if error}
  <p role="alert">{$errorText(error)}</p>
{/if}
{#if failed || hasMore}
  <button
    type="button"
    class="button"
    disabled={busy}
    onclick={onLoad}>
    {failed ? retryLabel : moreLabel}
  </button>
{/if}

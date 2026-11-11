<script lang="ts">
  import { t } from '../../lib/i18n';

  interface Props {
    /** How many photos would be indexed. */
    count: number;
    metered: boolean;
    /** The heading level of the question inside its page. */
    level?: 2 | 3 | 4;
    onIndex: () => void;
    /** "Later": the choice is remembered, so nothing asks again until the person asks for it. */
    onLater?: () => void;
    disabled?: boolean;
  }

  let { count, metered, level = 3, onIndex, onLater, disabled = false }: Props = $props();
  const heading = $derived(`h${level}`);
</script>

<!-- The second consent (33-2): indexing the whole library costs battery and loads every photo once. -->
<svelte:element
  this={heading}
  class="similar-consent__title">
  {$t('similar.consent.title')}
</svelte:element>
<p class="similar-consent__text">{$t('similar.consent.body', { values: { count } })}</p>
<p class="similar-consent__text">{$t('similar.consent.battery')}</p>
{#if metered}
  <p class="similar-consent__text">{$t('similar.consent.metered')}</p>
{/if}
<div class="button-row">
  <button
    type="button"
    class="button"
    {disabled}
    onclick={onIndex}>
    {$t('similar.consent.index')}
  </button>
  {#if onLater}
    <button
      type="button"
      class="button"
      onclick={onLater}>
      {$t('similar.consent.later')}
    </button>
  {/if}
</div>

<style>
  .similar-consent__title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-md);
    font-weight: 700;
  }
  .similar-consent__text {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-sm);
    line-height: 1.5;
  }
</style>

<script lang="ts">
  import { t } from '../../lib/i18n';
  import { megabytes } from '../../lib/vision/assets';

  interface Props {
    /** The download's size in bytes (the files the app fetches). */
    bytes: number;
    metered: boolean;
    /** The heading level of the question inside its page. */
    level?: 2 | 3;
    onTurnOn: () => void;
    /** "Not now" (the setting page has no such button: leaving it is the same). */
    onLater?: () => void;
    disabled?: boolean;
  }

  let { bytes, metered, level = 3, onTurnOn, onLater, disabled = false }: Props = $props();
  const heading = $derived(`h${level}`);
</script>

<!-- The whole decision in plain words: what it does, what it costs, where it runs, whether the phone is fast enough. -->
<svelte:element
  this={heading}
  class="photo-consent__title">
  {$t('vision.consent.title')}
</svelte:element>
<p class="photo-consent__text">{$t('vision.consent.body')}</p>
<p class="photo-consent__text">{$t('vision.consent.size', { values: { size: megabytes(bytes) } })}</p>
{#if metered}
  <p class="photo-consent__text">{$t('vision.consent.metered')}</p>
{/if}
<p class="photo-consent__text">{$t('vision.consent.speed')}</p>
<div class="button-row">
  <button
    type="button"
    class="button"
    {disabled}
    onclick={onTurnOn}>
    {$t('vision.consent.on')}
  </button>
  {#if onLater}
    <button
      type="button"
      class="button"
      onclick={onLater}>
      {$t('vision.consent.later')}
    </button>
  {/if}
</div>

<style>
  .photo-consent__title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-md);
    font-weight: 700;
  }
  .photo-consent__text {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-sm);
    line-height: 1.5;
  }
</style>

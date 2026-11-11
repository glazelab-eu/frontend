<script lang="ts">
  import { t } from '../../lib/i18n';
  import { meteredNow } from '../../lib/vision/preference';
  import type { PhotoSuggestions } from '../../state/vision/photo-suggestions';
  import type { SimilarLooks } from '../../state/vision/similar-looks';
  import SimilarConsent from '../vision/SimilarConsent.svelte';
  import SimilarProgress from '../vision/SimilarProgress.svelte';
  import AccountSection from './AccountSection.svelte';

  interface Props {
    similar: SimilarLooks;
    /** The photo model's controller: the similar looks use it, so they are offered only while it is switched on. */
    suggestions: PhotoSuggestions;
  }

  let { similar, suggestions }: Props = $props();
  let store = $derived(similar.state);
  let model = $derived(suggestions.state);
  const modelOn = $derived($model.preference === 'on');
  const working = $derived($store.status === 'indexing' || $store.status === 'paused');
  const asking = $derived($store.status === 'ask' || $store.status === 'declined');
</script>

<!-- The second consent's home (33-2): the page's own choice, kept per account on this device and removed at sign-out. -->
<AccountSection title={$t('similar.setting.title')}>
  <p class="similar-setting__text">{$t('similar.setting.intro')}</p>
  {#if !modelOn}
    <p class="similar-setting__text similar-setting__state">{$t('similar.setting.needsModel')}</p>
  {:else if $store.status === 'checking'}
    <p class="similar-setting__text">{$t('similar.setting.off')}</p>
  {:else if $store.status !== 'off'}
    {#if working}
      <SimilarProgress
        state={$store}
        onStop={() => void similar.stop()}
        onAllowMetered={similar.allowMetered} />
    {:else}
      <p class="similar-setting__text similar-setting__state">
        {$store.done > 0 ? $t('similar.setting.state', { values: { done: $store.done, total: $store.total } }) : $t('similar.setting.off')}
      </p>
      {#if asking}
        <SimilarConsent
          level={3}
          count={Math.max(0, $store.total - $store.done)}
          metered={meteredNow()}
          onIndex={() => void similar.start()} />
      {/if}
    {/if}
    {#if $store.done > 0}
      <button
        type="button"
        class="button"
        onclick={() => void similar.forget()}>
        {$t('similar.setting.remove')}
      </button>
    {/if}
  {/if}
</AccountSection>

<style>
  .similar-setting__text {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-base);
    line-height: 1.6;
  }
  .similar-setting__state {
    color: var(--ink);
    font-weight: 600;
  }
</style>

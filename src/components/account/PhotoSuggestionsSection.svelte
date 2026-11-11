<script lang="ts">
  import { t } from '../../lib/i18n';
  import { megabytes } from '../../lib/vision/assets';
  import { isMetered } from '../../lib/vision/preference';
  import type { PhotoSuggestions } from '../../state/vision/photo-suggestions';
  import PhotoSuggestionsConsent from '../vision/PhotoSuggestionsConsent.svelte';
  import PhotoSuggestionsNotice from '../vision/PhotoSuggestionsNotice.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import AccountSection from './AccountSection.svelte';

  interface Props {
    suggestions: PhotoSuggestions;
    online: boolean;
  }

  let { suggestions, online }: Props = $props();
  let store = $derived(suggestions.state);
  const on = $derived($store.preference === 'on');
  const metered = () => isMetered((navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }).connection);
</script>

<!-- The device's own choice (33-1): stored on this device only, never in the account. Off until the person says yes. -->
<AccountSection title={$t('vision.setting.title')}>
  <p class="photo-setting__text">{$t('vision.setting.intro')}</p>
  {#if !on}
    <p class="photo-setting__text photo-setting__state">{$t('vision.setting.off')}</p>
    <details class="photo-setting__details">
      <summary class="photo-setting__summary">{$t('vision.setting.review')}</summary>
      <PhotoSuggestionsConsent
        level={3}
        bytes={$store.bytes}
        metered={metered()}
        disabled={!online}
        onTurnOn={() => void suggestions.enable()} />
    </details>
    <OfflineNote
      {online}
      message={$t('vision.status.offline')} />
  {:else}
    <p class="photo-setting__text photo-setting__state">{$t('vision.setting.on', { values: { size: megabytes($store.bytes) } })}</p>
    <PhotoSuggestionsNotice
      state={$store}
      onConfirm={() => void suggestions.confirmDownload()}
      onRetry={() => void suggestions.resume()}
      onKeep={suggestions.keepSlow}
      onRemove={() => void suggestions.disable()} />
    <button
      type="button"
      class="button"
      onclick={() => void suggestions.disable()}>
      {$t('vision.remove')}
    </button>
  {/if}
</AccountSection>

<style>
  .photo-setting__summary {
    cursor: pointer;
    color: var(--accent);
    padding-block: var(--space-2);
    font-size: var(--font-base);
    font-weight: 600;
  }
  .photo-setting__details {
    margin-bottom: var(--space-3);
  }
  .photo-setting__text {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-base);
    line-height: 1.6;
  }
  .photo-setting__state {
    color: var(--ink);
    font-weight: 600;
  }
  @media (pointer: coarse) {
    .photo-setting__summary {
      min-height: var(--touch-target);
    }
  }
</style>

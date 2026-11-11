<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { locale, t, type Locale } from '../../lib/i18n';
  import { isMetered } from '../../lib/vision/preference';
  import { mergeScored, suggestedTags, type VisionLabels } from '../../lib/vision/labels';
  import type { Scored } from '../../lib/vision/scoring';
  import type { PhotoSuggestions } from '../../state/vision/photo-suggestions';
  import OfflineNote from '../common/OfflineNote.svelte';
  import PhotoSuggestionsConsent from './PhotoSuggestionsConsent.svelte';
  import PhotoSuggestionsNotice from './PhotoSuggestionsNotice.svelte';

  interface Props {
    suggestions: PhotoSuggestions;
    /** The finished-piece photos chosen so far (a photo of another kind, packaging above all, is never analysed). */
    files: { key: number; file: File }[];
    /** The item's tags, so a tag it has is not offered again. */
    tags: string[];
    /** Every tag of the loaded library: a label's word in another language is the existing tag, not a second one. */
    knownTags: string[];
    online: boolean;
    /** Adds the tag to the item (the tag editor's request); resolves true when it was saved. */
    onAddTag: (tag: string) => Promise<boolean>;
  }

  let { suggestions, files, tags, knownTags, online, onAddTag }: Props = $props();
  let store = $derived(suggestions.state);
  /** At most this many photos of a dialog are analysed (each costs battery). */
  const MAX_ANALYSED = 3;

  let dismissed = $state(false);
  let results = $state.raw<Record<number, Scored[] | null>>({});
  let labels = $state.raw<VisionLabels | null>(null);
  let analysing = $state(false);
  let added = $state('');
  let busy = $state(false);
  let panel = $state<HTMLElement>();
  const controller = new AbortController();
  onDestroy(() => controller.abort());

  const analysable = $derived(files.slice(0, MAX_ANALYSED));
  const ready = $derived($store.status === 'ready' || $store.status === 'slow');
  const metered = () => isMetered((navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }).connection);

  // A writer who agreed starts the model when the first photo is chosen (it is not running after a reload).
  $effect(() => {
    if (analysable.length && !dismissed && ($store.status === 'idle' || ($store.status === 'offline' && online))) void suggestions.resume();
  });

  // Each chosen photo is analysed once, one after the other.
  $effect(() => {
    if (!ready || dismissed || analysing) return;
    const next = analysable.find((item) => results[item.key] === undefined);
    if (next) void analyse(next);
  });

  async function analyse(item: { key: number; file: File }) {
    analysing = true;
    try {
      const outcome = await suggestions.analyse(item.file, controller.signal);
      if (controller.signal.aborted) return;
      untrack(() => {
        results = { ...results, [item.key]: outcome.ok ? outcome.picked : null };
        if (outcome.ok) labels = outcome.labels;
      });
    } finally {
      analysing = false;
    }
  }

  const chips = $derived.by(() => {
    if (!labels) return [];
    const picked = analysable.map((item) => results[item.key]).filter((list): list is Scored[] => Array.isArray(list));
    return suggestedTags(mergeScored(picked), labels.labels, ($locale ?? 'en') as Locale, tags, knownTags);
  });
  const pending = $derived(ready && analysable.some((item) => results[item.key] === undefined));
  const showConsent = $derived($store.preference === null && online && analysable.length > 0 && !dismissed);
  const showNotice = $derived($store.preference === 'on' && analysable.length > 0 && !dismissed);

  async function add(tag: string) {
    if (busy) return;
    busy = true;
    try {
      if (await onAddTag(tag)) {
        added = tag;
        await tick();
        (panel?.querySelector<HTMLElement>('[data-chip]') ?? panel)?.focus();
      }
    } finally {
      busy = false;
    }
  }
</script>

{#if showConsent}
  <section
    class="photo-suggestions"
    aria-label={$t('vision.consent.title')}>
    <PhotoSuggestionsConsent
      bytes={$store.bytes}
      metered={metered()}
      onTurnOn={() => void suggestions.enable()}
      onLater={suggestions.decline} />
  </section>
{:else if showNotice && !ready}
  <section
    class="photo-suggestions"
    aria-label={$t('vision.setting.title')}>
    <PhotoSuggestionsNotice
      state={$store}
      onConfirm={() => void suggestions.confirmDownload()}
      onRetry={() => void suggestions.resume()}
      onKeep={suggestions.keepSlow}
      onRemove={() => void suggestions.disable()}
      onLater={suggestions.decline} />
  </section>
{:else if showNotice && ready && ($store.status === 'slow' || pending || chips.length || added)}
  <section
    class="photo-suggestions"
    bind:this={panel}
    tabindex="-1"
    aria-label={$t('vision.suggested.title')}>
    {#if $store.status === 'slow'}
      <PhotoSuggestionsNotice
        state={$store}
        onConfirm={() => void suggestions.confirmDownload()}
        onRetry={() => void suggestions.resume()}
        onKeep={suggestions.keepSlow}
        onRemove={() => void suggestions.disable()} />
    {/if}
    {#if pending}
      <p
        class="photo-suggestions__status"
        role="status">
        {$t('vision.status.analysing')}
      </p>
    {/if}
    {#if chips.length || added}
      <h3 class="photo-suggestions__title">{$t('vision.suggested.title')}</h3>
      {#if chips.length}
        <p class="photo-suggestions__hint">{$t('vision.suggested.hint')}</p>
        <ul class="photo-suggestions__chips">
          {#each chips as chip (chip.tag)}
            <li>
              <button
                type="button"
                class="button photo-suggestions__chip"
                data-chip
                disabled={!online || busy}
                aria-label={$t('vision.suggested.add', { values: { tag: chip.tag } })}
                onclick={() => void add(chip.tag)}>
                + {chip.tag}
              </button>
            </li>
          {/each}
        </ul>
        <OfflineNote
          {online}
          message={$t('vision.suggested.offline')} />
      {/if}
      <p
        class="photo-suggestions__status"
        role="status">
        {added ? $t('vision.suggested.added', { values: { tag: added } }) : ''}
      </p>
      <button
        type="button"
        class="button photo-suggestions__dismiss"
        onclick={() => (dismissed = true)}>
        {$t('vision.suggested.dismiss')}
      </button>
    {/if}
  </section>
{/if}

<style>
  .photo-suggestions {
    margin: 0 0 var(--space-4);
    padding: var(--space-4);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .photo-suggestions:focus {
    outline: none;
  }
  .photo-suggestions__title {
    margin: 0 0 var(--space-1);
    font-size: var(--font-md);
    font-weight: 700;
  }
  .photo-suggestions__hint,
  .photo-suggestions__status {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-sm);
    line-height: 1.5;
  }
  .photo-suggestions__status:empty {
    display: none;
  }
  .photo-suggestions__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    padding: 0;
    list-style: none;
  }
  .photo-suggestions__chip {
    border-radius: var(--radius-pill);
    font-size: var(--font-sm);
  }
</style>

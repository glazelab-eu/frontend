<script lang="ts">
  import { tick } from 'svelte';
  import { readable } from 'svelte/store';
  import { t } from '../../lib/i18n';
  import type { LookKind } from '../../lib/vision/library';
  import type { PhotoSuggestions } from '../../state/vision/photo-suggestions';
  import type { SimilarLooks, SimilarState } from '../../state/vision/similar-looks';
  import SimilarPanel from './SimilarPanel.svelte';

  interface Props {
    similar: SimilarLooks;
    suggestions: PhotoSuggestions;
    /** The chosen photos of a kind that looks can be compared (test tiles and finished pieces), not yet stored. */
    files: { key: number; file: File; kind: LookKind }[];
    userId: string | null | undefined;
  }

  let { similar, suggestions, files, userId }: Props = $props();
  const idle = readable<SimilarState>({ status: 'off', paused: null, done: 0, total: 0, version: 0 });
  const store = $derived(similar.state ?? idle);
  /** The embedding of each photo the person asked about (computed on this device, kept for this dialog only). */
  let searches = $state.raw<Record<number, { status: 'looking' | 'failed' | 'done'; vector?: Float32Array }>>({});
  /** The photo whose search waits for the choice about indexing. */
  let waiting = $state<number | null>(null);
  const controller = new AbortController();
  $effect(() => () => controller.abort());

  const shown = $derived(['ask', 'declined', 'indexing', 'paused', 'ready'].includes($store.status));

  async function search(key: number) {
    const item = files.find((candidate) => candidate.key === key);
    if (!item) return;
    waiting = null;
    searches = { ...searches, [key]: { status: 'looking' } };
    await suggestions.resume();
    const outcome = await similar.embed(item.file, controller.signal);
    if (controller.signal.aborted) return;
    searches = { ...searches, [key]: outcome.ok ? { status: 'done', vector: outcome.embedding } : { status: 'failed' } };
  }

  function find(key: number) {
    // Asking for a search is not agreeing to the indexing: the choice comes first.
    if ($store.status === 'ask' || $store.status === 'declined') {
      waiting = key;
      searches = { ...searches, [key]: { status: 'looking' } };
      return;
    }
    void search(key);
  }

  /** "Later" in a panel: the photo's search goes away and the focus returns to its button. */
  async function close(key: number) {
    waiting = null;
    const { [key]: _removed, ...rest } = searches;
    searches = rest;
    await tick();
    document.querySelector<HTMLElement>(`[data-find-similar="${key}"]`)?.focus();
  }

  const hitsOf = (key: number, kind: LookKind, version: number) => {
    void version;
    const vector = searches[key]?.vector;
    return vector ? similar.forVector(vector, kind) : [];
  };
  const queryOf = (key: number) => {
    const status = searches[key]?.status;
    return status === 'failed' ? 'failed' : status === 'done' ? 'ready' : 'looking';
  };
</script>

{#if shown && files.length}
  <section
    class="similar-upload"
    aria-label={$t('similar.title')}>
    <h3 class="similar-upload__title">{$t('similar.title')}</h3>
    <ul class="similar-upload__list">
      {#each files as item (item.key)}
        <li class="similar-upload__item">
          <button
            type="button"
            class="button"
            data-find-similar={item.key}
            aria-expanded={searches[item.key] !== undefined}
            onclick={() => find(item.key)}>
            {$t('similar.upload.find', { values: { name: item.file.name } })}
          </button>
          {#if searches[item.key]}
            {#if waiting === item.key}
              <SimilarPanel
                {similar}
                progress={$store}
                hits={[]}
                query="looking"
                {userId}
                onIndexed={() => void search(item.key)}
                onClose={() => void close(item.key)} />
            {:else}
              <SimilarPanel
                {similar}
                progress={$store}
                hits={hitsOf(item.key, item.kind, $store.version)}
                query={queryOf(item.key)}
                {userId}
                blank
                onClose={() => void close(item.key)} />
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .similar-upload {
    margin: 0 0 var(--space-4);
    padding: var(--space-4);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .similar-upload__title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-md);
    font-weight: 700;
  }
  .similar-upload__list {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>

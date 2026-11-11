<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import { meteredNow } from '../../lib/vision/preference';
  import type { SimilarHit } from '../../lib/vision/similar';
  import type { SimilarLooks, SimilarState } from '../../state/vision/similar-looks';
  import SimilarConsent from './SimilarConsent.svelte';
  import SimilarProgress from './SimilarProgress.svelte';
  import SimilarResults from './SimilarResults.svelte';

  interface Props {
    similar: SimilarLooks;
    progress: SimilarState;
    /** The items that look like the photo asked about (computed by the host from the index). */
    hits: SimilarHit[];
    /** `looking`: the photo is being read; `failed`: it could not be; `missing`: it is not in the index yet; `ready`: `hits` is the answer. */
    query: 'looking' | 'failed' | 'missing' | 'ready';
    userId: string | null | undefined;
    blank?: boolean;
    onOpen?: (event: MouseEvent, href: string) => void;
    dark?: boolean;
    /** Called after "Index now" (a search that waited for the choice goes on). */
    onIndexed?: () => void;
    /** Called after "Later": the host takes the panel away. */
    onClose?: () => void;
  }

  let { similar, progress, hits, query, userId, blank = false, onOpen, dark = false, onIndexed, onClose }: Props = $props();
  let root = $state<HTMLElement>();
  const asking = $derived(progress.status === 'ask' || progress.status === 'declined');
  const working = $derived(progress.status === 'indexing' || progress.status === 'paused');

  /** The pressed button goes away with its state: focus stays inside the panel. */
  async function act(work: () => Promise<void>) {
    await work();
    await tick();
    root?.focus();
  }
</script>

<div
  bind:this={root}
  class={['similar-panel', { 'similar-panel--dark': dark }]}
  tabindex="-1">
  {#if asking}
    <SimilarConsent
      level={4}
      count={progress.total}
      metered={meteredNow()}
      onIndex={() =>
        void act(async () => {
          await similar.start();
          onIndexed?.();
        })}
      onLater={() =>
        void act(async () => {
          await similar.stop();
          onClose?.();
        })} />
  {:else}
    {#if working}
      <SimilarProgress
        state={progress}
        onStop={() => void act(() => similar.stop())}
        onAllowMetered={similar.allowMetered} />
    {/if}
    {#if query === 'looking'}
      <p
        class="similar-panel__text"
        role="status">
        {$t('similar.looking')}
      </p>
    {:else if query === 'failed'}
      <p
        class="similar-panel__text"
        role="status">
        {$t('similar.failed')}
      </p>
    {:else if hits.length}
      <p class="similar-panel__text">{$t('similar.hint')}</p>
      <SimilarResults
        {hits}
        {userId}
        {blank}
        {onOpen}
        {dark} />
    {:else if query === 'missing'}
      <p
        class="similar-panel__text"
        role="status">
        {$t('similar.notIndexed')}
      </p>
    {:else if progress.status === 'ready'}
      <p
        class="similar-panel__text"
        role="status">
        {$t('similar.none')}
      </p>
    {/if}
  {/if}
</div>

<style>
  .similar-panel {
    margin-top: var(--space-3);
    text-align: left;
  }
  .similar-panel:focus {
    outline: none;
  }
  .similar-panel__text {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-sm);
    line-height: 1.5;
  }
  .similar-panel--dark {
    --muted: var(--viewer-muted);
    --ink: var(--viewer-ink);
    --border: var(--viewer-line);
    --surface: var(--viewer-control);
    color: var(--viewer-ink);
  }
</style>

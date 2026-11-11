<script lang="ts">
  import { tick } from 'svelte';
  import { readable } from 'svelte/store';
  import { t } from '../../lib/i18n';
  import type { ItemType, LookKind } from '../../lib/vision/library';
  import type { MessageKey } from '../../lib/i18n/messages';
  import { meteredNow } from '../../lib/vision/preference';
  import { useSimilar } from '../../state/vision/similar-context';
  import type { SimilarState } from '../../state/vision/similar-looks';
  import SimilarConsent from './SimilarConsent.svelte';
  import SimilarProgress from './SimilarProgress.svelte';
  import SimilarResults from './SimilarResults.svelte';

  interface Props {
    /** The glaze or combination whose photos are compared. */
    type: ItemType;
    id: string;
    userId: string | null | undefined;
  }

  let { type, id, userId }: Props = $props();
  /** One group per kind: a photo is only ever compared with photos of its own kind. */
  const similarGroupKey: Record<LookKind, MessageKey> = {
    FINISHED: 'similar.group.finished',
    TEST_TILE: 'similar.group.tile',
    IN_PROGRESS: 'similar.group.inProgress',
  };
  // The feature is absent outside the app shell (no context) and for a guest, a device without the model and a person who said "Later".
  const similar = useSimilar();
  const idle = readable<SimilarState>({ status: 'off', paused: null, done: 0, total: 0, version: 0 });
  const store = similar?.state ?? idle;
  const headingId = $props.id();
  let section = $state<HTMLElement>();
  /** Set when the person pressed Stop here: the section then says so once instead of vanishing under the focus. */
  let stopped = $state(false);

  const own = $derived.by(() => {
    void $store.version;
    return similar?.photosOf(type, id) ?? [];
  });
  const groups = $derived.by(() => {
    void $store.version;
    return similar?.forItem(type, id) ?? [];
  });
  const working = $derived($store.status === 'indexing' || $store.status === 'paused');
  const visible = $derived(!!similar && own.length > 0 && (stopped || $store.status === 'ask' || working || ($store.status === 'ready' && groups.length > 0)));

  /** The button that was pressed goes away with its state: the focus moves to the section instead of falling to the page. */
  async function act(work: () => Promise<void>) {
    await work();
    await tick();
    section?.focus();
  }
</script>

{#if similar && visible}
  <section
    bind:this={section}
    class="similar-looks"
    tabindex="-1"
    aria-labelledby={headingId}>
    <h2
      id={headingId}
      class="similar-looks__title">
      {$t('similar.title')}
    </h2>
    {#if stopped && $store.status === 'declined'}
      <p
        class="similar-looks__text"
        role="status">
        {$t('similar.stopped')}
      </p>
    {:else if $store.status === 'ask'}
      <SimilarConsent
        count={$store.total}
        metered={meteredNow()}
        onIndex={() => void act(() => similar.start())}
        onLater={() =>
          void act(async () => {
            stopped = true;
            await similar.stop();
          })} />
    {:else}
      {#if working}
        <SimilarProgress
          state={$store}
          onStop={() =>
            void act(async () => {
              stopped = true;
              await similar.stop();
            })}
          onAllowMetered={similar.allowMetered} />
      {/if}
      {#if groups.length}
        <p class="similar-looks__text">{$t('similar.hint')}</p>
        {#each groups as group (group.kind)}
          <h3 class="similar-looks__group">{$t(similarGroupKey[group.kind])}</h3>
          <SimilarResults
            hits={group.hits}
            {userId} />
        {/each}
      {/if}
    {/if}
  </section>
{/if}

<style>
  .similar-looks {
    margin-top: var(--space-6);
    padding: var(--space-4);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .similar-looks:focus {
    outline: none;
  }
  .similar-looks__title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-lg);
    font-weight: 700;
  }
  .similar-looks__group {
    margin: var(--space-3) 0 var(--space-2);
    font-size: var(--font-md);
    font-weight: 700;
  }
  .similar-looks__text {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-sm);
    line-height: 1.5;
  }
</style>

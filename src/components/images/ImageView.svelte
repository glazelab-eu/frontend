<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '../../lib/i18n';
  import { dropCachedImages, imageUrl, networkReachable } from '../../lib/offline/offline';
  import { whenNearView } from '../../lib/paging/paging';

  interface Props {
    src: string;
    userId: string | null | undefined;
    alt?: string;
    /** `stage` shows the whole photo (`contain`) in the detail gallery and `viewer` in the full-screen viewer (on its dark ground, no tint); the others crop to fill (`cover`). */
    variant?: 'cover' | 'thumbnail' | 'stage' | 'viewer';
    /** Where a cropped variant (`cover`, `thumbnail`) centres its crop: `coverPosition` of the photo's focus; the centre by default. */
    position?: string;
  }

  let { src, userId, alt = '', variant = 'cover', position }: Props = $props();
  /** The whole-photo variants never crop, so the focus does not apply to them. */
  let cropPosition = $derived(variant === 'cover' || variant === 'thumbnail' ? position : undefined);
  /** The frame keeps its size in every state; only its content changes. */
  let status = $state<'loading' | 'ready' | 'missing'>('loading');
  let localUrl = $state('');
  let decoded = $state(false);
  let frame = $state<HTMLElement>();
  /** Fetched only once the frame comes near the view, so long lists cost few requests. */
  let near = $state(false);
  $effect(() => {
    if (frame && !near) return whenNearView(frame, () => (near = true));
  });
  /** Offline the picture may simply not be saved; online it is gone or no longer shared, which is no matter of connection. */
  let unavailable = $derived($networkReachable ? ('images.unavailable' as const) : ('images.unavailableOffline' as const));
  /** Bumped when the connection returns while the picture is missing, to ask for it again. */
  let attempt = $state(0);
  $effect(() => {
    if ($networkReachable && untrack(() => status) === 'missing') attempt++;
  });
  $effect(() => {
    if (!near) return;
    void attempt;
    let active = true;
    let objectUrl = '';
    status = 'loading';
    localUrl = '';
    decoded = false;
    imageUrl(src, userId)
      .then((url) => {
        if (active) {
          objectUrl = url || '';
          localUrl = objectUrl;
          status = url ? 'ready' : 'missing';
        } else if (url) URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (active) status = 'missing';
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  });
</script>

<div
  bind:this={frame}
  class={[
    'image-view',
    {
      'image-view--thumbnail': variant === 'thumbnail',
      'image-view--stage': variant === 'stage' || variant === 'viewer',
      'image-view--viewer': variant === 'viewer',
    },
  ]}
  aria-busy={status === 'loading' || (status === 'ready' && !decoded)}>
  {#if status === 'ready'}
    <img
      class={['image-view__image', { 'image-view__image--decoded': decoded }]}
      src={localUrl}
      {alt}
      style:object-position={cropPosition}
      onload={() => (decoded = true)}
      onerror={() => {
        // A copy that does not decode (a decoy a former version saved) never shows again: the next attempt downloads it afresh.
        void dropCachedImages(userId, [src]);
        status = 'missing';
      }} />
  {:else if status === 'missing'}
    <!-- A thumbnail is too small for the sentence in every language (pt-PT was cut off): an icon, the sentence as its name and tooltip. -->
    {#if variant === 'thumbnail'}
      <div
        class="image-view__placeholder"
        role="img"
        aria-label={$t(unavailable)}
        title={$t(unavailable)}>
        <svg
          class="image-view__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true">
          <rect
            x="3"
            y="4"
            width="18"
            height="16"
            rx="2" />
          <path d="m3 16 5-5 4 4 3-3 6 6" />
          <path d="M4 3l16 18" />
        </svg>
      </div>
    {:else}
      <div class="image-view__placeholder">{$t(unavailable)}</div>
    {/if}
  {/if}
</div>

<style>
  .image-view {
    width: 100%;
    height: 100%;
    background: var(--sage);
  }
  .image-view--viewer {
    background: none;
  }
  .image-view--viewer .image-view__placeholder {
    color: var(--viewer-muted);
  }
  .image-view--thumbnail {
    width: 3.3125rem;
    height: 3.3125rem;
    flex: none;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .image-view__image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.15s ease-out;
  }
  .image-view--stage .image-view__image {
    object-fit: contain;
  }
  .image-view__image--decoded {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .image-view__image {
      transition: none;
    }
  }
  .image-view__placeholder {
    height: 100%;
    display: grid;
    place-items: center;
    font-size: var(--font-sm);
    color: var(--muted);
  }
  .image-view__icon {
    width: 1.5rem;
    height: 1.5rem;
  }
</style>

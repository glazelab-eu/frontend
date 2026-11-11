<script lang="ts">
  import { untrack } from 'svelte';
  import { avatarIdsConfirmed, dropCachedImages, imageUrl, networkReachable } from '../../lib/offline/offline';
  import { avatarUrls, forgetKeptAvatarUrls, keepAvatarUrl, keptAvatarUrl } from '../../lib/avatars/avatar';
  import { accountInitial } from '../../lib/layout/account-initial';
  import { whenNearView } from '../../lib/paging/paging';

  interface Props {
    /** The profile picture's ID (`UserView.avatarId`); null shows the initial letter. */
    avatarId: string | null | undefined;
    /** The person's display name: the initial's letter, and the accessible name when the avatar is not decorative. */
    name: string;
    /** The account that looks (the owner of the saved copies); a picture is never shown across accounts. */
    viewerId: string | null | undefined;
    /** `xs` 1.5 rem (beside small text such as an author line), `sm` 2.25 rem (header, lists, 64 px copy), `md` 3rem, `lg` 6rem (the account page, 256 px copy), `fill` the size and look of its parent (a round control that draws its own border and ground; 64 px copy). */
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'fill';
    /** True when the name stands next to the picture (the picture then says nothing); false names the picture itself. */
    decorative?: boolean;
    /** The accessible name of a picture that is not decorative, when it is not the plain name. */
    label?: string;
  }

  let { avatarId, name, viewerId, size = 'sm', decorative = true, label }: Props = $props();
  const sourceOf = (id: string) => (size === 'lg' ? avatarUrls(id).full : avatarUrls(id).small);
  /** A picture shown before in this session is there from the first frame, so a page change does not flash the initial letter. */
  const kept = untrack(() => (avatarId ? keptAvatarUrl(viewerId, sourceOf(avatarId)) : undefined));
  let ready = $state(!!kept);
  let localUrl = $state(kept ?? '');
  let frame = $state<HTMLElement>();
  /** Fetched only once the avatar comes near the view, so a long list asks for few pictures. */
  let near = $state(false);
  $effect(() => {
    if (frame && !near) return whenNearView(frame, () => (near = true));
  });
  /** Bumped when a picture that was not shown can be asked for again: the connection returned, or the IDs of the lists were confirmed by a load. */
  let attempt = $state(0);
  $effect(() => {
    if (($networkReachable || $avatarIdsConfirmed) && untrack(() => near && !!avatarId && !localUrl)) attempt++;
  });
  $effect(() => {
    const id = avatarId;
    void attempt;
    if (!id) {
      ready = false;
      localUrl = '';
      return;
    }
    const source = sourceOf(id);
    const keptUrl = keptAvatarUrl(viewerId, source);
    if (keptUrl) {
      if (localUrl !== keptUrl) {
        localUrl = keptUrl;
        ready = true;
      }
      return;
    }
    ready = false;
    localUrl = '';
    if (!near) return;
    let active = true;
    // A failure of any kind (gone, unsaved offline, not allowed) leaves the initial letter, never a broken image.
    imageUrl(source, viewerId)
      .then((url) => {
        if (active) localUrl = url ? keepAvatarUrl(viewerId, source, url) : '';
        else if (url) URL.revokeObjectURL(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  });
</script>

<span
  bind:this={frame}
  class={['avatar', `avatar--${size}`]}
  role={decorative ? undefined : 'img'}
  aria-label={decorative ? undefined : (label ?? name)}
  aria-hidden={decorative ? true : undefined}>
  <span
    class="avatar__initial"
    aria-hidden="true">
    {accountInitial(name)}
  </span>
  {#if localUrl}
    <img
      class={['avatar__image', { 'avatar__image--ready': ready }]}
      src={localUrl}
      alt=""
      onload={() => (ready = true)}
      onerror={() => {
        forgetKeptAvatarUrls((url) => !!avatarId && url === sourceOf(avatarId));
        // A saved copy that does not decode never shows again.
        if (avatarId) void dropCachedImages(viewerId, [sourceOf(avatarId)]);
        localUrl = '';
      }} />
  {/if}
</span>

<style>
  .avatar {
    position: relative;
    display: inline-grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    border: 0.0625rem solid var(--control-border);
    border-radius: var(--radius-pill);
    background: var(--sage);
    color: var(--ink);
    font-weight: 700;
    line-height: 1;
  }
  .avatar--xs {
    width: 1.5rem;
    height: 1.5rem;
    font-size: var(--font-xs);
  }
  .avatar--sm {
    width: 2.25rem;
    height: 2.25rem;
    font-size: var(--font-base);
  }
  .avatar--md {
    width: 3rem;
    height: 3rem;
    font-size: var(--font-lg);
  }
  /* In a round control that draws the border and the ground itself (the phone account button). */
  .avatar--fill {
    width: 100%;
    height: 100%;
    border: 0;
    background: none;
    color: inherit;
    font-size: inherit;
  }
  .avatar--lg {
    width: 6rem;
    height: 6rem;
    font-size: var(--font-3xl);
  }
  .avatar__image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.15s ease-out;
  }
  .avatar__image--ready {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .avatar__image {
      transition: none;
    }
  }
</style>

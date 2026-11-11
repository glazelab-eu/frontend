<script lang="ts">
  import { coverPosition } from '../../lib/images/photo-focus';
  import { t } from '../../lib/i18n';
  import { imageKindKey, pictureSrc, type Picture } from '../../lib/images/pictures';
  import ImageView from './ImageView.svelte';

  interface Props {
    pictures: Picture[];
    /** The shown photo's position. */
    current: number;
    userId: string | null | undefined;
    /** Shows the photo at that position (the carousel scrolls its stage). */
    onSelect: (position: number) => void;
  }

  let { pictures, current, userId, onSelect }: Props = $props();
  let strip = $state<HTMLUListElement>();
  let buttons: (HTMLButtonElement | undefined)[] = [];

  // Keeps the shown thumbnail inside the strip (centred) when there are more than fit, scrolling only the strip, never the page.
  $effect(() => {
    const button = buttons[current];
    if (!strip || !button) return;
    const [start, end] = [button.offsetLeft, button.offsetLeft + button.offsetWidth];
    if (start < strip.scrollLeft || end > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: start - (strip.clientWidth - button.offsetWidth) / 2, behavior: 'instant' });
    }
  });

  // A sync or another device may remove or replace the photo whose thumbnail has the focus: the focus moves to the shown
  // thumbnail instead of falling to the page. Checked before the list re-renders, restored after it.
  let hadFocus = false;
  $effect.pre(() => {
    void pictures;
    hadFocus = !!strip?.contains(document.activeElement);
  });
  $effect(() => {
    void pictures;
    if (hadFocus && !strip?.contains(document.activeElement) && (!document.activeElement || document.activeElement === document.body)) {
      strip?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus();
    }
    hadFocus = false;
  });

  /** One tab stop (the shown thumbnail); the arrows, Home and End move it and show that photo, like the stage's keys. */
  function navigate(event: KeyboardEvent) {
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: pictures.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(next, pictures.length - 1));
    onSelect(target);
    buttons[target]?.focus();
  }
</script>

<div class="picture-strip">
  <ul
    bind:this={strip}
    class="picture-strip__list">
    {#each pictures as picture, position (picture.image.id)}
      <li>
        <button
          bind:this={buttons[position]}
          type="button"
          class={['picture-strip__button', { 'picture-strip__button--current': position === current }]}
          aria-label={$t('images.thumbnail', { values: { current: position + 1, total: pictures.length, kind: $t(imageKindKey(picture.image.kind)) } })}
          aria-current={position === current ? 'true' : undefined}
          tabindex={position === current ? 0 : -1}
          onclick={() => onSelect(position)}
          onkeydown={navigate}>
          <ImageView
            variant="thumbnail"
            src={pictureSrc(picture.image)}
            position={coverPosition(picture.image)}
            {userId} />
        </button>
      </li>
    {/each}
  </ul>
  <span
    class="picture-strip__count"
    aria-hidden="true">
    {current + 1} / {pictures.length}
  </span>
</div>

<style>
  .picture-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  /* Ten photos scroll sideways inside the strip; the padding leaves room for the focus ring, which the scroller would clip. */
  .picture-strip__list {
    position: relative;
    display: flex;
    flex: 0 1 auto;
    min-width: 0;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1-5);
    list-style: none;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .picture-strip__list::-webkit-scrollbar {
    display: none;
  }
  .picture-strip__button {
    position: relative;
    display: block;
    width: 3.3125rem;
    height: 3.3125rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
  }
  /* The accent border lies over the picture, so the button keeps its 53 px square. */
  .picture-strip__button--current::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 0.125rem solid var(--accent);
    border-radius: var(--radius-sm);
    pointer-events: none;
  }
  .picture-strip__count {
    flex: none;
    color: var(--muted);
    font-size: var(--font-sm);
    font-variant-numeric: tabular-nums;
  }
</style>

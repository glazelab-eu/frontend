<script lang="ts">
  import type { Snippet } from 'svelte';
  import { chipScrollLeft, scrollEdges } from './chip-scroll';

  interface Props {
    /** The visible word before the chips; the group's name for assistive technology. */
    label: string;
    /** Changes with the active chip (the one marked `aria-current`), which is scrolled into view; unset while the default chip is active. */
    active?: string;
    children: Snippet;
  }
  let { label, active, children }: Props = $props();

  let scroller = $state<HTMLElement>();
  let edges = $state({ start: false, end: false });

  /** Scrolls a chip clear of the fades; the scroll offset is set directly, never animated. */
  function reveal(row: HTMLElement, chip: HTMLElement) {
    row.scrollLeft = chipScrollLeft({
      chipLeft: chip.offsetLeft,
      chipRight: chip.offsetLeft + chip.offsetWidth,
      scrollLeft: row.scrollLeft,
      viewWidth: row.clientWidth,
      scrollWidth: row.scrollWidth,
      // The row's scroll padding is the fade width, so the scroll snap agrees.
      fade: parseFloat(getComputedStyle(row).scrollPaddingInlineStart) || 0,
    });
  }

  function revealActive(row: HTMLElement) {
    const chip = row.querySelector<HTMLElement>('[aria-current]');
    if (chip) reveal(row, chip);
  }

  /**
   * The row's width as last laid out, or 0: before its first layout, and on wide screens (`display: contents`, no box), where
   * nothing scrolls and nothing is read. Geometry is read only where a layout is due anyway (`measure`, the ResizeObserver), never
   * in an effect or a mutation callback: a read there forces the layout of the whole page, in the same task as its rendering.
   */
  let width = 0;
  let frame = 0;
  let revealDue = false;

  const updateEdges = (row: HTMLElement) => {
    const next = scrollEdges(row.scrollLeft, row.clientWidth, row.scrollWidth);
    if (next.start !== edges.start || next.end !== edges.end) edges = next;
  };

  /** Does what is due before the next paint, so no frame shows the old position or fades. */
  function measure() {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      const row = scroller;
      if (!row || !width) return;
      if (revealDue) revealActive(row);
      revealDue = false;
      updateEdges(row);
    });
  }

  /** Shows the active chip when it changes. The first time the row is laid out does it too, so a restored chip needs no read here. */
  $effect(() => {
    active;
    if (!width) return;
    revealDue = true;
    measure();
  });

  /**
   * Shows a chip that the keyboard focused. A pointer press focuses its chip too (before the click), but scrolling then
   * would move another chip under the pointer and the click would be lost; the press changes `active` instead.
   */
  function focused(event: FocusEvent) {
    const chip = event.target;
    if (scroller && width && chip instanceof HTMLElement && chip !== scroller && chip.matches(':focus-visible')) reveal(scroller, chip);
  }

  $effect(() => {
    const row = scroller;
    if (!row) return;
    const scrolled = () => updateEdges(row);
    row.addEventListener('scroll', scrolled, { passive: true });
    // Counts and chip sets change the content; the window changes the row. An observer's first answer follows the row's first layout.
    const resize = new ResizeObserver(() => {
      // First laid out, or from the wide layout to one line, as on turning a phone upright: show the active chip again.
      if (!width && row.clientWidth) revealActive(row);
      width = row.clientWidth;
      updateEdges(row);
    });
    resize.observe(row);
    const mutate = new MutationObserver(() => {
      if (width) measure();
    });
    mutate.observe(row, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      frame = 0;
      row.removeEventListener('scroll', scrolled);
      resize.disconnect();
      mutate.disconnect();
    };
  });
</script>

<div
  class="chip-row"
  role="group"
  aria-label={label}>
  <span
    class="chip-row__label"
    aria-hidden="true">
    {label}
  </span>
  <!-- tabindex -1: browsers make a scrolling region a tab stop of its own; the chips are the stops. -->
  <div
    bind:this={scroller}
    tabindex="-1"
    onfocusin={focused}
    class={['chip-row__chips', { 'chip-row__chips--more-start': edges.start, 'chip-row__chips--more-end': edges.end }]}>
    {@render children()}
  </div>
</div>

<style>
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1-5);
  }
  .chip-row__label {
    color: var(--muted);
    font-size: var(--font-sm);
    margin-right: var(--space-1);
  }
  /* The chips are the group's own flex items on wide screens. */
  .chip-row__chips {
    display: contents;
  }
  /* Phones: one line that scrolls sideways and snaps to a chip, a fade at each side that holds more chips. The label stays put. */
  @media (width < 45em) {
    .chip-row {
      flex: 1 1 100%;
      min-width: 0;
      flex-wrap: nowrap;
    }
    .chip-row__label {
      flex: none;
    }
    .chip-row__chips {
      --chip-fade: 1.5rem;
      position: relative;
      display: flex;
      flex: 1 1 0;
      min-width: 0;
      align-items: center;
      gap: var(--space-1-5);
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scroll-snap-type: x proximity;
      scroll-padding-inline: var(--chip-fade);
      scrollbar-width: none;
      /* Room for the focus ring (3 px + 3 px offset), which the scroll area would clip; the margin keeps the chips where they were. */
      padding: var(--space-1-5);
      margin: calc(-1 * var(--space-1-5));
    }
    .chip-row__chips::-webkit-scrollbar {
      display: none;
    }
    .chip-row__chips--more-end {
      mask-image: linear-gradient(to right, #000 calc(100% - var(--chip-fade)), transparent);
    }
    .chip-row__chips--more-start {
      mask-image: linear-gradient(to right, transparent, #000 var(--chip-fade));
    }
    .chip-row__chips--more-start.chip-row__chips--more-end {
      mask-image: linear-gradient(to right, transparent, #000 var(--chip-fade), #000 calc(100% - var(--chip-fade)), transparent);
    }
  }
  @media (pointer: coarse) {
    .chip-row {
      gap: var(--space-2);
    }
    .chip-row__chips {
      gap: var(--space-2);
    }
  }
</style>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from '../ui/Icon.svelte';
  import {
    MIN_ZOOM,
    ZOOM_STEP,
    dragBy,
    maxZoom,
    nudge,
    pinchTo,
    positionOf,
    rectOf,
    zoomTo,
    type Crop,
    type CropShape,
    type Pinch,
    type Size,
  } from '../../lib/images/crop';
  import { createAnnouncer } from '../../lib/images/crop-announce';
  import { paintFocus, paintRect, stagePixels } from '../../lib/images/crop-render';
  import { fitRect, frameFocus, moveFrame, stepFrame } from '../../lib/images/photo-focus';

  interface Props {
    /** The decoded picture (the dialog owns and closes it); undefined while it is read. */
    image: ImageBitmap | undefined;
    /** Its size (the crop's coordinates). */
    size: Size;
    shape: CropShape;
    crop: Crop;
    /** Nothing moves while the dialog sends. */
    busy: boolean;
    /** The picture cannot be read: the stage stays empty and is no longer busy. */
    failed?: boolean;
    /**
     * `round`: the profile picture's circle, the stage shows the window that is sent and the picture moves and zooms under it.
     * `focus`: a photo's focus point, the stage shows the whole photo and its card frame moves over it (no zoom; `crop` is the
     * frame at zoom 1 of `shape`).
     */
    variant: 'round' | 'focus';
    /** The stage's accessible name; `help` describes it (visible, under it). */
    label: string;
    help: string;
    /** The zoom row's names; the focus stage has no zoom. */
    zoomLabel?: string;
    zoomInLabel?: string;
    zoomOutLabel?: string;
    /** What the keys announce after a change (zoom in percent, position 0 to 100 across and down). */
    position: (values: { zoom: number; x: number; y: number }) => string;
  }

  let { image, size, shape, crop = $bindable(), busy, failed = false, variant, label, help, zoomLabel, zoomInLabel, zoomOutLabel, position }: Props = $props();
  const id = $props.id();

  const focusing = $derived(variant === 'focus');
  /** The canvas's own resolution: its size on the screen times the device pixel ratio (the sent pixels do not depend on it). */
  let pixels = $state(stagePixels(0, 1));
  /** What the polite live region says; keys change it at a throttled pace. */
  let announced = $state('');
  let canvas = $state<HTMLCanvasElement>();
  const top = $derived(maxZoom(size, shape));

  // The canvas follows its size on the screen and the device's pixel ratio, so it is sharp on a phone with a dense screen.
  $effect(() => {
    if (!canvas) return;
    const element = canvas;
    const measure = () => (pixels = stagePixels(element.clientWidth, window.devicePixelRatio));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });

  // The crop stage shows exactly what is sent: the same window of the same picture. The focus stage shows the whole photo and the frame.
  $effect(() => {
    if (!canvas || !image || !pixels) return;
    if (focusing) paintFocus(canvas, image, size, crop);
    else paintRect(canvas, image, rectOf(crop, size, shape));
  });

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { from: Pinch; crop: Crop; stage: DOMRect } | undefined;

  /** The two fingers: their distance and midpoint, the midpoint as a fraction of the stage from its centre. */
  const fingers = (stage: DOMRect): Pinch => {
    const [a, b] = [...pointers.values()];
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      u: ((a.x + b.x) / 2 - (stage.left + stage.width / 2)) / stage.width,
      v: ((a.y + b.y) / 2 - (stage.top + stage.height / 2)) / stage.height,
    };
  };

  function press(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (!image || busy) return;
    // The focus frame follows one pointer; a second finger does nothing.
    if (focusing && pointers.size) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const stage = event.currentTarget.getBoundingClientRect();
      pinch = { from: fingers(stage), crop, stage };
    } else {
      pinch = undefined;
    }
  }

  function move(event: PointerEvent) {
    const last = pointers.get(event.pointerId);
    if (!last || !image || !canvas) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (focusing) {
      // The frame moves with the pointer, scaled from the photo as drawn on the screen to its pixels.
      const drawn = fitRect(size, { width: canvas.clientWidth, height: canvas.clientHeight });
      const scale = drawn.width > 0 ? size.width / drawn.width : 0;
      crop = moveFrame(crop, size, (event.clientX - last.x) * scale, (event.clientY - last.y) * scale);
    } else if (pointers.size === 1) {
      crop = dragBy(crop, size, event.clientX - last.x, event.clientY - last.y, canvas.clientWidth, shape);
    } else if (pointers.size === 2 && pinch) {
      crop = pinchTo(pinch.crop, size, pinch.from, fingers(pinch.stage), shape);
    }
  }

  function release(event: PointerEvent) {
    pointers.delete(event.pointerId);
    pinch = undefined;
  }

  const announcer = createAnnouncer((text) => (announced = text));
  onDestroy(() => announcer.cancel());

  const zoomBy = (step: number) => (crop = zoomTo(crop, size, crop.zoom + step, shape));

  function key(event: KeyboardEvent) {
    if (!image || busy || event.ctrlKey || event.metaKey || event.altKey) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const arrow = arrows[event.key];
    if (arrow && focusing) crop = stepFrame(crop, size, arrow[0], arrow[1]);
    else if (arrow) crop = nudge(crop, size, arrow[0], arrow[1], shape);
    else if (focusing) return;
    else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
    else if (event.key === '-' || event.key === '_') zoomBy(-ZOOM_STEP);
    else return;
    event.preventDefault();
    announcer.say(position({ zoom: Math.round(crop.zoom * 100), ...(focusing ? frameFocus(crop, size) : positionOf(crop, size, shape)) }));
  }
</script>

<!-- A drag area for a pointer, arrow keys (and + / - to zoom a crop) for a keyboard (the slider and its buttons do the same for anyone): the stage is the preview. -->
<button
  type="button"
  class={['crop-stage', `crop-stage--${variant}`]}
  aria-label={label}
  aria-describedby="{id}-help"
  aria-busy={!image && !failed}
  onpointerdown={press}
  onpointermove={move}
  onpointerup={release}
  onpointercancel={release}
  onkeydown={key}>
  <canvas
    class="crop-stage__canvas"
    bind:this={canvas}
    width={pixels}
    height={Math.round(pixels / shape.aspect)}>
  </canvas>
</button>
<p
  class="crop-stage__help"
  id="{id}-help">
  {help}
</p>
<!-- The keys' feedback (zoom and position), polite and throttled; always in the dialog so that a change is announced. -->
<p
  class="visually-hidden crop-stage__live"
  role="status"
  aria-live="polite"
  aria-atomic="true">
  {announced}
</p>
{#if !focusing}
  <div class="crop-stage__zoom">
    <button
      type="button"
      class="icon-button"
      aria-label={zoomOutLabel}
      disabled={!image || busy || crop.zoom <= MIN_ZOOM}
      onclick={() => zoomBy(-ZOOM_STEP)}>
      <Icon name="minus" />
    </button>
    <input
      class="crop-stage__slider"
      type="range"
      min={MIN_ZOOM}
      max={top}
      step="0.01"
      value={crop.zoom}
      aria-label={zoomLabel}
      aria-valuetext={`${Math.round(crop.zoom * 100)}%`}
      disabled={!image || busy}
      oninput={(event) => (crop = zoomTo(crop, size, event.currentTarget.valueAsNumber, shape))} />
    <button
      type="button"
      class="icon-button"
      aria-label={zoomInLabel}
      disabled={!image || busy || crop.zoom >= top}
      onclick={() => zoomBy(ZOOM_STEP)}>
      <Icon name="plus" />
    </button>
  </div>
{/if}

<style>
  /* Touch drags move the picture, not the page. */
  .crop-stage {
    display: block;
    margin: 0 auto var(--space-3);
    padding: 0;
    border: 0;
    background: var(--sage);
    overflow: hidden;
    cursor: grab;
    touch-action: none;
    user-select: none;
    box-shadow: 0 0 0 0.125rem var(--control-border);
  }
  .crop-stage:active {
    cursor: grabbing;
  }
  /* The round preview: the largest square that fits (also in a landscape phone), cut round. */
  .crop-stage--round {
    width: min(100%, 16rem, 42vh);
    aspect-ratio: 1;
    border-radius: var(--radius-pill);
  }
  /* The focus stage (3:2 like the frame, `PHOTO_FOCUS_ASPECT`; no inline style under the CSP): the whole photo fits inside it on the
     tint, as wide as the dialog allows, within a landscape phone's height. */
  .crop-stage--focus {
    width: min(100%, 36rem, 60vh);
    aspect-ratio: 3 / 2;
    border-radius: var(--radius-sm);
  }
  .crop-stage__canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .crop-stage__help {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-sm);
    text-align: center;
  }
  .crop-stage__live {
    margin: 0;
  }
  .crop-stage__zoom {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .crop-stage__slider {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 1.5rem;
    accent-color: var(--accent);
  }
  @media (width < 45em) {
    .crop-stage--round {
      width: min(100%, 14rem, 42vh);
    }
  }
  @media (pointer: coarse) {
    .crop-stage__slider {
      min-height: var(--touch-target);
    }
  }
</style>

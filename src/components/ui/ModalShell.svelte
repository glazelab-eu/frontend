<script lang="ts">
  import Icon from './Icon.svelte';
  import { onMount, type Snippet } from 'svelte';
  import { labels } from './labels';
  import { composing, topDialog } from './keys';
  import { toBody } from './portal';

  interface Props {
    /** The dialog's heading: rendered as its `h2` and naming the dialog (`aria-labelledby`). */
    title?: string;
    /** A small line above the heading (the global `.eyebrow`), only with `title`. */
    eyebrow?: string;
    /** The dialog's name when it has no `title`: its heading changes while the name stays, or it has none. */
    ariaLabel?: string;
    /** Without it the dialog is blocking: no close button, Escape or backdrop click. */
    onClose?: () => void;
    /** A selector (`FIRST_FIELD`) for the control that takes the focus when the dialog opens, in place of Close: a form dialog starts at its first field. */
    initialFocus?: string;
    /** Used when a completed action removes the button that opened this dialog. */
    fallbackFocus?: () => void;
    /** On phones, anchor this dialog to the bottom edge. */
    sheet?: boolean;
    /** A roomier dialog for forms with two columns. */
    wide?: boolean;
    /** The full-screen photo viewer: the whole screen on its own dark ground, Close drawn over it. */
    viewer?: boolean;
    /** Stays above every dialog that opens after it (the blocking terms dialog). */
    topmost?: boolean;
    children: Snippet;
  }

  let {
    title,
    eyebrow,
    ariaLabel,
    onClose,
    initialFocus,
    fallbackFocus,
    sheet = false,
    wide = false,
    viewer = false,
    topmost = false,
    children,
  }: Props = $props();
  const id = $props.id();
  let dialog: HTMLDivElement;
  let closeButton = $state<HTMLButtonElement>();

  /** Return focus to the persistent close control after a dialog's content changes. */
  export function focusClose() {
    (closeButton ?? dialog)?.focus();
  }

  /** Set only by a pointer pressed on the backdrop itself: a text selection dragged out of the dialog ends there as a click too. */
  let pressedBackdrop = false;

  onMount(() => {
    const opener = document.activeElement;
    // A dialog that opens beneath another (the blocking terms dialog stays on top) leaves the focus where it is.
    if (topDialog() === dialog) (((initialFocus && dialog.querySelector<HTMLElement>(initialFocus)) || closeButton) ?? dialog).focus();
    const onKeydown = (event: KeyboardEvent) => {
      if (topDialog() !== dialog || composing(event)) return;
      if (event.key === 'Tab') {
        const controls = [...dialog.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]')].filter(
          (element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length,
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => {
      window.removeEventListener('keydown', onKeydown);
      queueMicrotask(() => {
        // A replacement dialog has already taken focus (for example invite -> sign in).
        if (document.activeElement?.closest('[role="dialog"]')) return;
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        else fallbackFocus?.();
      });
    };
  });
</script>

<!-- The backdrop lives at the end of <body> (`toBody`), outside every stacking context of the page; this empty element keeps its place. -->
<div
  class="modal-home"
  hidden>
  <div
    class={['modal', { 'modal--sheet': sheet, 'modal--viewer': viewer }]}
    role="presentation"
    {@attach (layer) => toBody(layer, topmost)}
    onpointerdown={(event) => {
      pressedBackdrop = event.target === event.currentTarget;
    }}
    onclick={(event) => {
      const closes = pressedBackdrop && event.target === event.currentTarget;
      pressedBackdrop = false;
      if (closes) onClose?.();
    }}>
    <div
      bind:this={dialog}
      class={['modal__dialog', { 'modal__dialog--wide': wide, 'modal__dialog--viewer': viewer }]}
      role="dialog"
      aria-modal="true"
      aria-label={title ? undefined : ariaLabel}
      aria-labelledby={title ? `${id}-title` : undefined}
      tabindex="-1">
      {#if onClose}
        <button
          bind:this={closeButton}
          class={['icon-button', viewer ? 'icon-button--viewer' : 'icon-button--quiet', 'modal__close', { 'modal__close--viewer': viewer }]}
          aria-label={$labels.close}
          onclick={onClose}>
          <Icon name="close" />
        </button>
      {/if}
      {#if title}
        {#if eyebrow}
          <div class="eyebrow modal__eyebrow">{eyebrow}</div>
        {/if}
        <h2
          class="modal__title"
          id="{id}-title">
          {title}
        </h2>
      {/if}
      {@render children()}
    </div>
  </div>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    z-index: var(--z-modal);
    display: grid;
    place-items: center;
    padding: max(var(--space-5), var(--safe-top)) max(var(--space-5), var(--safe-right)) max(var(--space-5), var(--safe-bottom))
      max(var(--space-5), var(--safe-left));
  }
  .modal__dialog {
    /* A dialog may open where its opener sits inside styled text (a card's meta line): it never inherits that look. */
    color: var(--ink);
    font-size: var(--font-body);
    font-weight: 400;
    letter-spacing: normal;
    width: min(26.875rem, 100%);
    /* Never taller than the room the backdrop's padding leaves (a phone on its side with system bars): the dialog is centred, so an overflow would cross both edges. */
    max-height: min(90vh, calc(100dvh - max(var(--space-5), var(--safe-top)) - max(var(--space-5), var(--safe-bottom))));
    overflow: auto;
    background: var(--surface);
    border-radius: var(--radius-lg);
    padding: var(--space-9);
    position: relative;
    box-shadow: 0 1.875rem 5.625rem var(--shadow-color);
  }
  .modal__dialog--wide {
    width: min(42rem, 100%);
  }
  .modal--viewer {
    padding: 0;
    background: var(--viewer-bg);
  }
  .modal__dialog--viewer {
    width: 100%;
    height: 100%;
    max-height: none;
    overflow: hidden;
    padding: 0;
    border-radius: 0;
    background: var(--viewer-bg);
    color: var(--viewer-ink);
    box-shadow: none;
  }
  @media (width < 45em) {
    .modal--sheet {
      align-items: end;
      padding: 0;
    }
    .modal--sheet .modal__dialog {
      width: 100%;
      max-height: 90dvh;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      padding: var(--space-7) var(--space-5) max(var(--space-5), var(--safe-bottom));
    }
    /* The sheet's padding is narrower, so Close reaches further into it. */
    .modal--sheet .modal__title {
      padding-inline-end: var(--space-8);
    }
  }
  .modal__eyebrow {
    margin-bottom: var(--space-3);
  }
  /* The one heading look of every dialog; it keeps clear of Close, which overlaps the padding's corner. */
  .modal__title {
    margin: 0 0 var(--space-3);
    padding-inline-end: var(--space-4);
    font-size: var(--font-lg);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .modal__close {
    position: absolute;
    right: var(--space-2);
    top: var(--space-2);
  }
  .modal__close.modal__close--viewer {
    right: max(var(--space-2), var(--safe-right));
    top: max(var(--space-2), var(--safe-top));
  }
</style>

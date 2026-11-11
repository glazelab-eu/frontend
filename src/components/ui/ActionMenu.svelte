<script
  module
  lang="ts">
  export interface ActionMenuItem {
    id: string;
    label: string;
    /** Stays focusable (`aria-disabled`) and does nothing; `note` says why. */
    disabled?: boolean;
    danger?: boolean;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    /** Names the "⋯" button, which says what the menu is for ("Options for this photo"). */
    label: string;
    items: ActionMenuItem[];
    /** Explains the disabled entries; shown at the foot of the open menu. */
    note?: string;
    /** Called after the menu closed and focus returned to its button. */
    onSelect: (id: string) => void;
    /** Where the popup opens: above its button (the default: cards clip overflow at their foot) or below it, for a button at the top of a card or dialog. */
    placement?: 'above' | 'below';
    /** A small round button for a corner of a picture (the popup opens below it, from its left edge) instead of the square one. */
    overlay?: boolean;
  }

  let { label, items, note = '', onSelect, placement = 'above', overlay = false }: Props = $props();
  const id = $props.id();

  let open = $state(false);
  let root = $state<HTMLElement>();
  let trigger = $state<HTMLButtonElement>();
  let entries = $state<HTMLButtonElement[]>([]);

  async function show(at: 'first' | 'last') {
    open = true;
    await tick();
    const available = entries.filter(Boolean);
    (at === 'first' ? available[0] : available[available.length - 1])?.focus();
  }

  function close(restoreFocus: boolean) {
    open = false;
    if (restoreFocus) trigger?.focus();
  }

  function pick(item: ActionMenuItem) {
    if (item.disabled) return;
    close(true);
    onSelect(item.id);
  }

  function triggerKeys(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    void show(event.key === 'ArrowDown' ? 'first' : 'last');
  }

  function menuKeys(event: KeyboardEvent) {
    const available = entries.filter(Boolean);
    const at = available.indexOf(document.activeElement as HTMLButtonElement);
    const next = {
      ArrowDown: (at + 1) % available.length,
      ArrowUp: (at - 1 + available.length) % available.length,
      Home: 0,
      End: available.length - 1,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      available[next]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      // Focus moves on from the button, the way it would without a menu.
      close(true);
    }
  }

  $effect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!root?.contains(event.target as Node)) close(false);
    };
    const leave = () => close(false);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('hashchange', leave);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('hashchange', leave);
    };
  });
  $effect(() => {
    if (!items.length) open = false;
  });
</script>

{#if items.length}
  <div
    class={['action-menu', { 'action-menu--overlay': overlay }]}
    bind:this={root}>
    <button
      type="button"
      class={['icon-button', { 'icon-button--overlay': overlay }]}
      bind:this={trigger}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? `${id}-menu` : undefined}
      onkeydown={triggerKeys}
      onclick={() => (open ? close(false) : void show('first'))}>
      <Icon name="more" />
    </button>
    {#if open}
      <div class={['action-menu__popup', { 'action-menu__popup--below': placement === 'below' || overlay }]}>
        <div
          class="action-menu__list"
          id="{id}-menu"
          role="menu"
          aria-label={label}
          tabindex="-1"
          onkeydown={menuKeys}>
          {#each items as item, position (item.id)}
            <button
              type="button"
              role="menuitem"
              class={['action-menu__item', { 'action-menu__item--danger': item.danger }]}
              tabindex="-1"
              aria-disabled={item.disabled ? 'true' : undefined}
              aria-describedby={item.disabled && note ? `${id}-note` : undefined}
              bind:this={entries[position]}
              onclick={() => pick(item)}>
              {item.label}
            </button>
          {/each}
        </div>
        {#if note}
          <p
            class="action-menu__note"
            id="{id}-note">
            {note}
          </p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .action-menu {
    position: relative;
    flex: none;
  }
  .action-menu__popup {
    position: absolute;
    right: 0;
    bottom: 100%;
    z-index: var(--z-popup);
    display: grid;
    min-width: 14rem;
    max-width: min(20rem, calc(100vw - var(--space-8)));
    margin-bottom: var(--space-1);
    padding: var(--space-1);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    background: var(--paper);
    box-shadow: 0 0.5rem 1.5rem var(--shadow-color);
  }
  .action-menu__popup--below {
    top: 100%;
    bottom: auto;
    margin: var(--space-1) 0 0;
  }
  .action-menu--overlay .action-menu__popup {
    right: auto;
    left: 0;
  }
  .action-menu__list {
    display: grid;
  }
  .action-menu__item {
    min-height: var(--touch-target);
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--ink);
    font-size: var(--font-base);
    font-weight: 600;
    text-align: start;
  }
  .action-menu__item:hover,
  .action-menu__item:focus-visible {
    background: var(--sage);
  }
  .action-menu__item[aria-disabled='true'] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .action-menu__item--danger {
    color: var(--danger-ink);
  }
  .action-menu__note {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  @media (pointer: coarse) {
    .action-menu__list {
      gap: var(--space-2);
    }
    .action-menu__item--danger {
      margin-top: var(--space-2);
    }
  }
</style>

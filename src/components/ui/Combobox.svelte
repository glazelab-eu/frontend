<script
  lang="ts"
  generics="T extends { id: string }">
  import { flushSync, untrack } from 'svelte';
  import { activeOption, nearListEnd, nearListStart, OPTION_PAGE, openWindow, optionWindow } from './option-pages';
  import { composing } from './keys';
  interface Props {
    /** Already loaded items (also from the offline snapshot); filtered here, never on the server. */
    items: T[];
    /** The chosen item's id, or '' while none is chosen. */
    selectedId: string;
    onSelect: (id: string) => void;
    /** The matching items for typed text, best first. */
    filter: (items: T[], query: string) => T[];
    /** What the input shows once an item is chosen. */
    itemText: (item: T) => string;
    /** An option shows a short code in front of its text. */
    optionCode: (item: T) => string;
    optionText: (item: T) => string;
    label: string;
    placeholder: string;
    /** Validation message while the typed text matches no chosen item; '' accepts free text. */
    invalidMessage: string;
    /** Shown while the list is open without matches; '' shows nothing. */
    noMatchMessage: string;
    /** A button under the no-match message, such as "Add it"; the keyboard reaches the host's own control. */
    noMatchAction?: { label: string; run: () => void };
    /** Announces the number of matches to screen readers. */
    matchesMessage: (count: number) => string;
    /** Follows what the user types, e.g. to offer it as a new item. */
    onText?: (text: string) => void;
    /**
     * Enter without an active option (e.g. with the list closed): return true when the typed text
     * was used, so the key does not submit the surrounding form.
     */
    onEnter?: (text: string) => boolean;
    /** The id of a visible explanation of the typed text. */
    describedBy?: string;
    /** The input's text; bind it to clear the input after a choice was used. */
    text?: string;
    required?: boolean;
    disabled?: boolean;
    /** For a filter bar: the label is for screen readers only and there is no space below. */
    compact?: boolean;
  }

  let {
    items,
    selectedId,
    onSelect,
    filter,
    itemText,
    optionCode,
    optionText,
    label,
    placeholder,
    invalidMessage,
    noMatchMessage,
    noMatchAction,
    matchesMessage,
    onText,
    onEnter,
    describedBy,
    text = $bindable(''),
    required = true,
    disabled = false,
    compact = false,
  }: Props = $props();
  const id = $props.id();
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;

  let input = $state<HTMLInputElement>();
  let list = $state<HTMLElement>();
  /** What the user typed; empty right after choosing, so the whole list shows again. */
  let query = $state(untrack(() => (selectedId ? '' : text)));
  let open = $state(false);
  /** The option the keys or the text made active; `active` reads it within the current matches. */
  let wanted = $state(-1);
  let selected = $derived(items.find((item) => item.id === selectedId));
  let matches = $derived(filter(items, query));
  /** Never past the end: matches that shrink under an open list (a sync delta, a removed glaze) move it to the last one. */
  let active = $derived(activeOption(wanted, matches.length));
  /**
   * The options rendered: a page again whenever the text changes or the list opens, around the active option there (a
   * chosen item far down the whole list), grown by scrolling and by the keys.
   */
  let range = $derived.by(() => {
    void query;
    void open;
    return untrack(() => openWindow(active, matches.length));
  });
  let shown = $derived(optionWindow(range, active, matches.length));
  let rendered = $derived(matches.slice(shown.start, shown.end));

  // Show the chosen item; forget a choice that left the list (e.g. another account).
  $effect(() => {
    if (selected) text = itemText(selected);
    else if (selectedId) onSelect('');
  });
  $effect(() => {
    input?.setCustomValidity(text.trim() && !selected ? invalidMessage : '');
  });
  $effect(() => {
    if (open && active >= 0) {
      list?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: 'nearest' });
    }
  });

  function show(index: number) {
    open = true;
    wanted = matches.length ? Math.max(0, Math.min(index, matches.length - 1)) : -1;
  }

  function choose(item: T) {
    query = '';
    open = false;
    wanted = -1;
    text = itemText(item);
    onSelect(item.id);
  }

  function onInput(event: Event) {
    text = query = (event.currentTarget as HTMLInputElement).value;
    onText?.(text);
    if (selectedId) onSelect('');
    // Emptying the field closes the list, so it does not cover the controls below it (such as
    // the submit button); ArrowDown or a click opens it again.
    if (text) show(0);
    else open = false;
  }

  function onKeydown(event: KeyboardEvent) {
    // An input method's Enter confirms its text and its Escape cancels the composition: neither is the picker's.
    if (composing(event)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (event.altKey) {
        if (event.key === 'ArrowDown') show(Math.max(active, 0));
        else open = false;
      } else if (!open) {
        const current = matches.findIndex((item) => item.id === selectedId);
        show(current >= 0 ? current : event.key === 'ArrowDown' ? 0 : matches.length - 1);
      } else show(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && open && matches[active]) {
      event.preventDefault();
      choose(matches[active]);
    } else if (event.key === 'Enter') {
      if (onEnter?.(text)) {
        event.preventDefault();
        query = '';
        open = false;
        wanted = -1;
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        open = false;
      } else if (text) {
        event.preventDefault();
        text = query = '';
        onText?.('');
        onSelect('');
      }
    }
  }
</script>

<div class={['form-field', 'combobox', { 'combobox--compact': compact }]}>
  <label
    class={{ 'visually-hidden': compact }}
    for={id}>
    {label}
  </label>
  <input
    bind:this={input}
    {id}
    class={['form-field__control', { 'combobox__control--compact': compact }]}
    type="text"
    role="combobox"
    autocomplete="off"
    spellcheck="false"
    aria-autocomplete="list"
    aria-expanded={open && matches.length > 0}
    aria-controls={listId}
    aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
    aria-describedby={describedBy}
    {placeholder}
    {required}
    {disabled}
    value={text}
    oninput={onInput}
    onkeydown={onKeydown}
    onclick={() => {
      if (!open) show(matches.findIndex((item) => item.id === selectedId));
    }}
    onblur={() => (open = false)} />
  <ul
    bind:this={list}
    id={listId}
    class="combobox__list"
    role="listbox"
    aria-label={label}
    hidden={!open || !matches.length}
    onscroll={() => {
      if (!list) return;
      if (shown.end < matches.length && nearListEnd(list.scrollTop, list.clientHeight, list.scrollHeight)) {
        range = { start: shown.start, end: shown.end + OPTION_PAGE };
      } else if (shown.start > 0 && nearListStart(list.scrollTop, list.clientHeight)) {
        // The page before the rendered options; the list keeps what it shows (no scroll anchoring here, see the CSS).
        const height = list.scrollHeight;
        range = { start: Math.max(0, shown.start - OPTION_PAGE), end: shown.end };
        flushSync();
        list.scrollTop += list.scrollHeight - height;
      }
    }}>
    <!-- Options stay out of the tab order; the combobox input handles the keyboard. Only some pages are rendered
         (`rendered`, from `shown.start`), so each option states its place among all matches. -->
    {#if open}
      {#each rendered as item, offset (item.id)}
        {@const index = shown.start + offset}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={optionId(index)}
          class={[
            'combobox__option',
            {
              'combobox__option--active': index === active,
              'combobox__option--chosen': item.id === selectedId,
            },
          ]}
          role="option"
          aria-selected={index === active}
          aria-setsize={matches.length}
          aria-posinset={index + 1}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => choose(item)}>
          <span class="combobox__code">{optionCode(item)}</span>
          <span>{optionText(item)}</span>
        </li>
      {/each}
    {/if}
  </ul>
  {#if open && !matches.length && noMatchMessage}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="combobox__empty"
      onmousedown={(event) => event.preventDefault()}>
      <p class="combobox__empty-text">{noMatchMessage}</p>
      {#if noMatchAction}
        <button
          type="button"
          class="combobox__empty-action"
          tabindex="-1"
          onclick={noMatchAction.run}>
          {noMatchAction.label}
        </button>
      {/if}
    </div>
  {/if}
  <div
    class="visually-hidden"
    role="status">
    {open && query ? matchesMessage(matches.length) : ''}
  </div>
</div>

<style>
  .combobox {
    position: relative;
  }
  .combobox--compact {
    margin-bottom: 0;
  }
  /* Matches the other filter bar controls. */
  .combobox__control--compact {
    margin-top: 0;
    min-height: var(--control-height);
    padding-block: var(--space-2);
    background: var(--surface);
    font-size: var(--font-base);
  }
  .combobox__list,
  .combobox__empty {
    position: absolute;
    z-index: var(--z-popup);
    left: 0;
    right: 0;
    margin: var(--space-1) 0 0;
    border: 0.0625rem solid var(--control-border);
    border-radius: var(--radius-sm);
    background: var(--paper);
    box-shadow: 0 0.5rem 1.5rem var(--shadow-color);
  }
  /* No scroll anchoring: the page added above the rendered options moves the list by its height itself, in every browser. */
  .combobox__list {
    max-height: 16rem;
    overflow-y: auto;
    overflow-anchor: none;
    padding: var(--space-1) 0;
    list-style: none;
  }
  .combobox__list[hidden] {
    display: none;
  }
  .combobox__option {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    padding: var(--space-2) var(--space-3);
    font-weight: 400;
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .combobox__option--active {
    background: var(--sage);
  }
  .combobox__option--chosen {
    font-weight: 700;
  }
  .combobox__code {
    flex: none;
    color: var(--muted);
    font-size: var(--font-xs);
    font-weight: 700;
  }
  .combobox__empty {
    padding: var(--space-2-5) var(--space-3);
    color: var(--muted);
    font-weight: 400;
  }
  .combobox__empty-text {
    margin: 0;
  }
  .combobox__empty-action {
    margin-top: var(--space-1-5);
    padding: var(--space-1) 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
  }
  @media (pointer: coarse) {
    .combobox__option {
      align-items: center;
      min-height: var(--touch-target);
    }
    .combobox__empty-action {
      min-height: var(--touch-target);
      padding-block: 0;
    }
  }
</style>

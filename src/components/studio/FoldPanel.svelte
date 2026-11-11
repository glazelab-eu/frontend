<script lang="ts">
  import type { Snippet } from 'svelte';
  import { foldExpanded, foldTitle } from '../../lib/studio/phone-fold';
  import PanelTitle from '../ui/PanelTitle.svelte';

  interface Props {
    /** Names the body for `aria-controls`; unique on the page. */
    id: string;
    /** The panel's own class, for callers and checks that look for it. */
    class: string;
    title: string;
    /** How many entries the body holds, shown on the folded heading. */
    count: number;
    /** Below 720 px the body starts folded behind its heading; wider screens always show it under a plain heading. */
    phone: boolean;
    children: Snippet;
  }

  let { id, class: className, title, count, phone, children }: Props = $props();

  let open = $state(false);
  let expanded = $derived(foldExpanded(phone, open));
  let toggle = $state<HTMLButtonElement>();
  let heading = $state<ReturnType<typeof PanelTitle>>();

  /** Takes the focus when the control that had it left with a removed entry and the body is folded away. */
  export function focus() {
    if (toggle) toggle.focus();
    else heading?.focus();
  }
</script>

<section class={['panel', 'fold', className, { 'fold--closed': !expanded }]}>
  {#if phone}
    <h2 class="fold__heading">
      <button
        type="button"
        class="fold__toggle"
        bind:this={toggle}
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        onclick={() => (open = !open)}>
        <span class="fold__title">{foldTitle(title, count)}</span>
        <span
          class="fold__chevron"
          aria-hidden="true">
          {expanded ? '▴' : '▾'}
        </span>
      </button>
    </h2>
  {:else}
    <PanelTitle
      bind:this={heading}
      {title} />
  {/if}
  {#if expanded}
    <div
      class={['fold__body', { 'fold__body--phone': phone }]}
      {id}>
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .fold {
    max-width: 56.25rem;
  }
  /* A folded phone panel is one touch row: the page's own padding and gap would put the form below the fold. */
  .fold--closed {
    padding-block: var(--space-1);
    margin-bottom: var(--space-3);
  }
  .fold__heading {
    margin: 0;
    font: inherit;
  }
  .fold__toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    min-height: var(--touch-target);
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    text-align: left;
  }
  .fold__title {
    min-width: 0;
    font-size: var(--font-lg);
    font-weight: 600;
    letter-spacing: -0.0375rem;
    overflow-wrap: anywhere;
  }
  .fold__chevron {
    color: var(--muted);
  }
  .fold__body--phone {
    margin-top: var(--space-3);
  }
</style>

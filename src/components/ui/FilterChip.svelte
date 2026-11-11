<script lang="ts">
  interface Props {
    label: string;
    kind?: 'type';
    count: number;
    href: string;
    active?: boolean;
    /** Keep unavailable views focusable so their explanation remains reachable. */
    unavailable?: boolean;
    describedBy?: string;
    current?: 'page' | 'true';
    onclick?: (event: MouseEvent) => void;
  }
  let { label, count, href, kind, active = false, unavailable = false, describedBy, onclick, current = 'page' }: Props = $props();
</script>

{#snippet content()}
  <span class="filter-chip__label">{label}</span>
  <span class="filter-chip__count">{count}</span>
{/snippet}
{#if unavailable}
  <button
    type="button"
    class="button button--compact filter-chip filter-chip--unavailable"
    aria-disabled="true"
    aria-describedby={describedBy}>
    {@render content()}
  </button>
{:else}
  <a
    class={['button', 'button--compact', 'filter-chip', { 'filter-chip--active': active, 'filter-chip--type': kind === 'type' }]}
    aria-current={active ? current : undefined}
    {href}
    {onclick}>
    {@render content()}
  </a>
{/if}

<style>
  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-pill);
    border-color: var(--border);
    font-size: var(--font-sm);
    text-decoration: none;
    /* In a scrolling row (phones) a chip keeps its width, on one line, and is a snap point. */
    flex: none;
    scroll-snap-align: start;
  }
  @media (width < 45em) {
    .filter-chip {
      white-space: nowrap;
    }
  }
  /* A name longer than the row (a club's) ends in an ellipsis inside the pill and keeps the count in view; the link's name stays whole. */
  .filter-chip__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .filter-chip__count {
    flex: none;
  }
  .filter-chip--active {
    background: var(--sage);
    border-color: var(--sage);
  }
  .filter-chip--type {
    border-radius: var(--radius-sm);
    border-color: var(--control-border);
    background: var(--surface);
  }
  .filter-chip--type.filter-chip--active {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--paper);
  }
  .filter-chip--type.filter-chip--active .filter-chip__count {
    color: var(--paper);
  }
  .filter-chip--unavailable {
    color: var(--muted);
    cursor: not-allowed;
  }
  .filter-chip__count {
    color: var(--muted);
    font-weight: 600;
  }
  .filter-chip--active .filter-chip__count {
    color: var(--ink);
  }
</style>

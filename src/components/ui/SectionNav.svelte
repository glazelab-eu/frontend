<script lang="ts">
  import { jumpToSection } from './section-jump';

  interface Props {
    /** The landmark's accessible name ("On this page"). */
    label: string;
    items: { id: string; label: string }[];
  }
  let { label, items }: Props = $props();
</script>

<nav
  class="section-nav"
  aria-label={label}>
  {#each items as item (item.id)}
    <button
      type="button"
      class="section-nav__link"
      onclick={() => jumpToSection(item.id)}>
      {item.label}
    </button>
  {/each}
</nav>

<style>
  .section-nav {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin-bottom: var(--space-5);
    padding-bottom: var(--space-3);
    border-bottom: 0.0625rem solid var(--border);
  }
  .section-nav__link {
    border: 0;
    background: none;
    color: var(--accent);
    padding: var(--space-2) 0;
    font-size: var(--font-base);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: var(--space-1);
  }
  @media (pointer: coarse) {
    .section-nav__link {
      min-height: var(--touch-target-compact);
      min-width: var(--touch-target-compact);
    }
  }
</style>

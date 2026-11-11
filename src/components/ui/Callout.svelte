<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLElement> {
    /** The tint and its line: `warm` (peach, warm ink), `sage` (sage, accent) or `neutral` (the card surface and its border). */
    tone: 'warm' | 'sage' | 'neutral';
    /** The element: a `section` when the box is a named region, a `div` otherwise. */
    as?: 'div' | 'section';
    /** A glyph before the content (the host sizes and colours it). */
    icon?: Snippet;
    children: Snippet;
  }

  let { tone, as = 'div', icon, children, ...rest }: Props = $props();
</script>

<!-- A tinted box with an even line all round: the one look of a highlighted note that is no error or warning. -->
<svelte:element
  this={as}
  {...rest}
  class={['callout', `callout--${tone}`]}>
  {#if icon}
    <span class="callout__icon">{@render icon()}</span>
  {/if}
  <div class="callout__body">{@render children()}</div>
</svelte:element>

<style>
  .callout {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
  }
  .callout--warm {
    border-color: var(--warm-ink);
    background: var(--peach);
  }
  .callout--sage {
    border-color: var(--accent);
    background: var(--sage);
  }
  .callout__icon {
    flex: none;
    display: inline-flex;
  }
  .callout__body {
    flex: 1 1 auto;
    min-width: 0;
  }
</style>

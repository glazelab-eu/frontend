<script lang="ts">
  interface Props {
    eyebrow: string;
    title: string;
    description: string;
    /** A short, one-line heading for returning readers. */
    compact?: boolean;
  }

  let { eyebrow, title, description, compact = false }: Props = $props();
</script>

<div class={['page-head', { 'page-head--compact': compact }]}>
  {#if !compact}
    <div class="eyebrow">{eyebrow}</div>
  {/if}
  <h1 class="page-head__title">{title}</h1>
  {#if !compact}
    <p class="page-head__description">{description}</p>
  {/if}
</div>

<style>
  .page-head__title {
    font-family: inherit;
    font-weight: 600;
    letter-spacing: -0.05rem;
    font-size: clamp(var(--font-2xl), 3vw, var(--font-3xl));
    line-height: 1.06;
    margin: var(--space-4) 0 var(--space-2);
    /* A club name of 120 characters without a break must not widen the page. */
    overflow-wrap: anywhere;
  }
  .page-head {
    margin: var(--space-2) 0 var(--space-7);
  }
  .page-head--compact {
    margin-bottom: var(--space-4);
  }
  .page-head--compact .page-head__title {
    font-size: var(--font-xl);
    margin: 0;
    line-height: 1.2;
  }
  .page-head__description {
    font-size: var(--font-md);
    color: var(--muted);
    line-height: 1.6;
    max-width: 42.5rem;
  }
</style>

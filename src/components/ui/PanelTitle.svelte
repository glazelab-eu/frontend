<script lang="ts">
  interface Props {
    title: string;
    description?: string;
  }

  let { title, description = '' }: Props = $props();
  let heading = $state<HTMLHeadingElement>();

  /** Takes the focus when the control that had it left with a removed item (a club the account left). */
  export function focus() {
    heading?.focus();
  }
</script>

<div class="panel-title">
  <h2
    class="panel-title__title"
    bind:this={heading}
    tabindex="-1">
    {title}
  </h2>
  {#if description}
    <p class="panel-title__description">{description}</p>
  {/if}
</div>

<style>
  .panel-title__title {
    font-family: inherit;
    font-size: var(--font-lg);
    font-weight: 600;
    margin: var(--space-2) 0 0;
    letter-spacing: -0.0375rem;
  }
  .panel-title {
    margin-bottom: var(--space-5);
  }
  .panel-title__description {
    font-size: var(--font-base);
    color: var(--muted);
    margin: var(--space-2) 0 0;
  }
</style>

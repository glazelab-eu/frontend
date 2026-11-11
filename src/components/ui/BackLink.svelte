<script lang="ts">
  interface Props {
    href: string;
    label: string;
    onBack?: () => void;
  }

  let { href, label, onBack }: Props = $props();
</script>

<a
  class="back-link"
  {href}
  onclick={(event) => {
    if (!onBack || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onBack();
  }}>
  <span aria-hidden="true">←</span>
  <span class="back-link__label">{label}</span>
</a>

<style>
  .back-link__label {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .back-link {
    display: inline-flex;
    gap: var(--space-2);
    max-width: 100%;
    margin-bottom: var(--space-4);
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
    text-decoration: none;
  }
  @media (pointer: coarse) {
    .back-link {
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

<script lang="ts">
  import { t } from '../../lib/i18n';
  import Callout from '../ui/Callout.svelte';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    /** The shelf shown: the personal one, a club's (with its name) or all of them. */
    scope: { kind: 'personal' } | { kind: 'club'; name: string } | { kind: 'all' };
  }

  let { scope }: Props = $props();
</script>

<!-- Which shelf the page works on, in words and an icon (never the colour alone); a change of chip is announced. -->
{#snippet glyph()}
  <span class={['shelf-scope__icon', { 'shelf-scope__icon--club': scope.kind === 'club' }]}>
    <Icon name={scope.kind === 'club' ? 'club' : 'person'} />
  </span>
{/snippet}

<div class="shelf-scope">
  <Callout
    as="section"
    tone={scope.kind === 'club' ? 'warm' : scope.kind === 'personal' ? 'sage' : 'neutral'}
    aria-label={$t('stock.scope.label')}
    aria-live="polite"
    icon={scope.kind === 'all' ? undefined : glyph}>
    {#if scope.kind === 'club'}
      <p class="shelf-scope__kind">{$t('stock.scope.club')}</p>
      <p class="shelf-scope__name">{scope.name}</p>
      <p class="shelf-scope__hint">{$t('stock.scope.clubHint')}</p>
    {:else if scope.kind === 'personal'}
      <p class="shelf-scope__name">{$t('stock.scope.personal')}</p>
      <p class="shelf-scope__hint">{$t('stock.scope.personalHint')}</p>
    {:else}
      <p class="shelf-scope__name">{$t('stock.scope.all')}</p>
      <p class="shelf-scope__hint">{$t('stock.scope.allHint')}</p>
    {/if}
  </Callout>
</div>

<style>
  .shelf-scope {
    margin-bottom: var(--space-4);
  }
  .shelf-scope__icon {
    --icon-size: 1.75rem;
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--accent);
  }
  .shelf-scope__icon--club {
    color: var(--warm-ink);
  }
  .shelf-scope__kind {
    margin: 0;
    font-size: var(--font-sm);
    font-weight: 700;
  }
  .shelf-scope__name {
    margin: 0;
    font-size: var(--font-lg);
    font-weight: 700;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .shelf-scope__hint {
    margin: var(--space-1) 0 0;
    font-size: var(--font-sm);
  }
  @media (pointer: coarse) {
    .shelf-scope__hint,
    .shelf-scope__kind {
      font-size: var(--font-body);
    }
  }
</style>

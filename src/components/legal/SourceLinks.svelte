<script lang="ts">
  import { t } from '../../lib/i18n';
  import { sourceHref, THIRD_PARTY_HREF } from '../../lib/legal/source-code';

  interface Props {
    /** The server's published source (`AuthOptions.sourceUrl`); the link is hidden while it is unset or unknown. */
    sourceUrl: string | null | undefined;
  }
  let { sourceUrl }: Props = $props();

  let href = $derived(sourceHref(sourceUrl));
</script>

<!-- The AGPL source offer and the third-party notices: footer links without a wrapper, so they wrap with the footer's other links. -->
{#if href}
  <a
    class="source-links__link"
    {href}
    rel="noopener noreferrer">
    {$t('app.sourceCode')}
  </a>
{/if}
<a
  class="source-links__link"
  href={THIRD_PARTY_HREF}>
  {$t('app.licences')}
</a>

<style>
  .source-links__link {
    color: var(--muted);
    font-size: var(--font-sm);
  }
  @media (pointer: coarse) {
    .source-links__link {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

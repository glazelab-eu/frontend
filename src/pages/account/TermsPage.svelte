<script lang="ts">
  import { t } from '../../lib/i18n';
  import TermsView from '../../components/legal/TermsView.svelte';
  interface Props {
    loadContact: () => Promise<string>;
  }
  let { loadContact }: Props = $props();
</script>

<section class="terms-page">
  <h1 class="terms-page__title">{$t('terms.title')}</h1>
  <TermsView {loadContact} />
</section>

<style>
  .terms-page {
    max-width: 48rem;
    margin: auto;
  }
  /* German "Nutzungsbedingungen" is one 336 px word at --font-2xl: below about 373 px the title shrinks with the screen (down to
     --font-xl) so it fits whole at 320 px; a larger text setting may still need the last-resort break. */
  .terms-page__title {
    font-size: clamp(var(--font-xl), 7.5vw, var(--font-2xl));
    overflow-wrap: break-word;
    margin-bottom: var(--space-6);
  }
</style>

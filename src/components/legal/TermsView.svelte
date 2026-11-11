<script lang="ts">
  import { locale, t } from '../../lib/i18n';
  import { termsVersion } from '../../lib/api/terms';
  import OperatorContact from './OperatorContact.svelte';
  interface Props {
    /** Fetches the operator's contact address when the reader asks for it. */
    loadContact: () => Promise<string>;
  }
  let { loadContact }: Props = $props();
</script>

<div class="terms-view">
  <p class="terms-view__version">
    {$t('terms.version', { values: { version: termsVersion } })}
  </p>
  <!-- Every translation is unreviewed and only the English text binds (LANG-1): said in every language but English. -->
  {#if $locale !== 'en'}
    <p
      class="terms-view__translation"
      data-terms-translation>
      {$t('terms.translationNote')}
    </p>
  {/if}
  <h2 class="terms-view__heading">{$t('terms.section.hobby.title')}</h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.hobby.body')}
  </p>
  <h2 class="terms-view__heading">{$t('terms.section.images.title')}</h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.images.body')}
  </p>
  <h2 class="terms-view__heading">{$t('terms.section.profilePicture.title')}</h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.profilePicture.body')}
  </p>
  <h2 class="terms-view__heading">{$t('terms.section.sharing.title')}</h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.sharing.body')}
  </p>
  <h2 class="terms-view__heading">{$t('terms.section.buddies.title')}</h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.buddies.body')}
  </p>
  <h2
    class="terms-view__heading"
    id="terms-diagnostics">
    {$t('terms.section.diagnostics.title')}
  </h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.diagnostics.body')}
  </p>
  <!-- Feedback: one sentence, added without a version bump (a product decision). -->
  <p class="terms-view__paragraph">
    {$t('terms.section.diagnostics.feedback')}
  </p>
  <h2 class="terms-view__heading">{$t('terms.section.hosting.title')}</h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.hosting.body')}
  </p>
  <h2 class="terms-view__heading">{$t('terms.section.cookies.title')}</h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.cookies.body')}
  </p>
  <h2 class="terms-view__heading">{$t('terms.section.conduct.title')}</h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.conduct.body')}
  </p>
  <h2 class="terms-view__heading">{$t('terms.section.records.title')}</h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.records.body')}
  </p>
  <h2 class="terms-view__heading">{$t('terms.section.account.title')}</h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.account.body')}
  </p>
  <OperatorContact {loadContact} />
  <h2 class="terms-view__heading">{$t('terms.section.changes.title')}</h2>
  <p class="terms-view__paragraph">
    {$t('terms.section.changes.body')}
  </p>
</div>

<style>
  .terms-view {
    font-size: var(--font-sm);
    line-height: 1.6;
  }
  .terms-view__version {
    color: var(--muted);
    margin-bottom: var(--space-4);
  }
  .terms-view__translation {
    border-inline-start: 0.25rem solid var(--accent);
    padding-inline-start: var(--space-3);
    margin-bottom: var(--space-4);
    font-weight: 600;
  }
  .terms-view__heading {
    font-size: var(--font-base);
    margin: var(--space-5) 0 var(--space-2);
  }
  .terms-view__paragraph {
    margin: 0 0 var(--space-3);
  }
</style>

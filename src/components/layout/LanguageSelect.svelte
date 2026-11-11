<script lang="ts">
  import { locale, locales, setLocale, t, type Locale } from '../../lib/i18n';

  // Each language in its own name, so a person who cannot read the current one still finds theirs.
  const names: Record<Locale, string> = { en: 'English', de: 'Deutsch', es: 'Español', it: 'Italiano', 'pt-PT': 'Português' };

  /** The page switches once the dictionary is loaded; a failed load keeps the shown language, so the select shows it again. */
  async function choose(select: HTMLSelectElement) {
    if (!(await setLocale(select.value))) select.value = $locale ?? 'en';
  }
</script>

<select
  class="language-select"
  aria-label={$t('language.label')}
  value={$locale}
  onchange={(event) => choose(event.currentTarget)}>
  {#each locales as language (language)}
    <option
      value={language}
      lang={language}>
      {names[language]}
    </option>
  {/each}
</select>

<style>
  .language-select {
    background: var(--surface);
    color: var(--ink);
    border: 0.0625rem solid var(--control-border);
    border-radius: var(--radius-sm);
    padding: var(--space-1-5) var(--space-2);
    font-size: var(--font-sm);
    max-width: 7.5rem;
  }
  @media (pointer: coarse) {
    .language-select {
      min-height: var(--touch-target);
    }
  }
</style>

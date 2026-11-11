<script lang="ts">
  import { t } from '../../lib/i18n';
  import { routeHref } from '../../lib/routing/routes';
  import { sourceHref, THIRD_PARTY_HREF } from '../../lib/legal/source-code';

  interface Props {
    /** The server's published source (`AuthOptions.sourceUrl`); its link shows only while it is a valid http(s) URL. */
    sourceUrl: string | null | undefined;
  }
  let { sourceUrl }: Props = $props();

  let sourceLink = $derived(sourceHref(sourceUrl));
  const sections = [
    { id: 'origin', title: 'about.origin.title', body: ['about.origin.body'] },
    { id: 'lab', title: 'about.lab.title', body: ['about.lab.body'] },
    { id: 'inspiration', title: 'about.inspiration.title', body: ['about.inspiration.body', 'about.inspiration.people'] },
    { id: 'privacy', title: 'about.privacy.title', body: ['about.privacy.body'] },
    { id: 'open', title: 'about.open.title', body: ['about.open.body'] },
    { id: 'free', title: 'about.free.title', body: ['about.free.body'] },
    { id: 'small', title: 'about.small.title', body: ['about.small.body'] },
  ] as const;
</script>

<!-- Static text from the bundled shell: no request, no state, so it opens offline for guests and members alike. -->
<article class="about-page">
  <div class="about-page__head">
    <img
      class="about-page__logo"
      src="/icon.svg"
      alt=""
      width="48"
      height="48" />
    <h1 class="about-page__title">{$t('about.title')}</h1>
  </div>
  <p class="about-page__lead">{$t('about.lead')}</p>
  {#each sections as section (section.id)}
    <section
      class="about-page__section"
      aria-labelledby="about-{section.id}">
      <h2
        class="about-page__heading"
        id="about-{section.id}">
        {$t(section.title)}
      </h2>
      {#each section.body as paragraph (paragraph)}
        <p class="about-page__text">{$t(paragraph)}</p>
      {/each}
      {#if section.id === 'open'}
        <ul class="about-page__links">
          {#if sourceLink}
            <li>
              <a
                class="about-page__link"
                href={sourceLink}
                rel="noopener noreferrer">
                {$t('app.sourceCode')}
              </a>
            </li>
          {/if}
          <li>
            <a
              class="about-page__link"
              href={THIRD_PARTY_HREF}>
              {$t('app.licences')}
            </a>
          </li>
          <li>
            <a
              class="about-page__link"
              href={routeHref({ name: 'terms' })}>
              {$t('terms.title')}
            </a>
          </li>
        </ul>
      {/if}
    </section>
  {/each}
</article>

<style>
  .about-page {
    max-width: 42.5rem;
    margin: auto;
  }
  .about-page__head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-4) 0 var(--space-3);
  }
  .about-page__logo {
    flex: none;
    width: 3rem;
    height: 3rem;
  }
  .about-page__title {
    margin: 0;
    min-width: 0;
    font-size: clamp(var(--font-xl), 7.5vw, var(--font-2xl));
    line-height: 1.1;
    overflow-wrap: break-word;
  }
  .about-page__lead {
    margin: 0 0 var(--space-5);
    color: var(--muted);
    font-size: var(--font-md);
    line-height: 1.6;
  }
  .about-page__section {
    margin-bottom: var(--space-5);
  }
  .about-page__heading {
    margin: 0 0 var(--space-2);
    font-size: var(--font-lg);
  }
  .about-page__text {
    margin: 0 0 var(--space-2);
    line-height: 1.6;
  }
  .about-page__links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    padding: 0;
    margin: var(--space-2) 0 0;
    list-style: none;
  }
  .about-page__link {
    color: var(--accent);
  }
  @media (pointer: coarse) {
    .about-page__link {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

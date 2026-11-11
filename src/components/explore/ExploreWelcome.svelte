<script lang="ts">
  import { t } from '../../lib/i18n';
  import { routeHref } from '../../lib/routing/routes';
  import type { IntroStep } from '../../lib/explore/audience';

  interface Props {
    guest: boolean;
    steps: IntroStep[];
    onSignIn: () => void;
    onDismiss: () => void;
  }
  let { guest, steps, onSignIn, onDismiss }: Props = $props();
  const labels = {
    shelf: 'discover.onboarding.shelf',
    combination: 'discover.onboarding.combination',
    club: 'discover.onboarding.club',
    picture: 'discover.onboarding.picture',
    diagnostics: 'discover.onboarding.diagnostics',
  } as const satisfies Record<IntroStep['kind'], string>;
</script>

{#if guest}
  <div class="explore-welcome">
    <p class="explore-welcome__explanation">{$t('discover.guest.intro')}</p>
    <button
      class="button"
      onclick={onSignIn}>
      {$t('common.signInOrJoin')}
    </button>
    <a
      class="explore-welcome__about"
      href={routeHref({ name: 'about' })}>
      {$t('about.title')}
    </a>
  </div>
{:else}
  <aside
    class="intro-card"
    aria-label={$t('discover.onboarding.title')}>
    <div class="intro-card__heading">
      <h2 class="intro-card__title">{$t('discover.onboarding.title')}</h2>
      <button
        class="intro-card__dismiss"
        onclick={onDismiss}>
        {$t('discover.onboarding.dismiss')}
      </button>
    </div>
    <ol class="intro-card__steps">
      {#each steps as step (step.kind)}
        <li class="intro-card__step">
          <a
            class="intro-card__link"
            href={routeHref(step.route)}
            aria-label={step.complete ? $t('discover.onboarding.completed', { values: { step: $t(labels[step.kind]) } }) : undefined}>
            <span
              class={['intro-card__tick', { 'intro-card__tick--complete': step.complete }]}
              aria-hidden="true">
              {step.complete ? '✓' : '○'}
            </span>
            {$t(labels[step.kind])}
          </a>
        </li>
      {/each}
    </ol>
  </aside>
{/if}

<style>
  .explore-welcome {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin-bottom: var(--space-4);
  }
  .explore-welcome__explanation {
    margin: 0;
    color: var(--muted);
    font-size: var(--font-base);
  }
  .explore-welcome__about {
    color: var(--accent);
    font-size: var(--font-sm);
  }
  .intro-card {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--blue);
    margin-bottom: var(--space-4);
  }
  .intro-card__heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .intro-card__title {
    margin: 0;
    font-size: var(--font-base);
  }
  .intro-card__dismiss {
    padding: var(--space-1) 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--font-sm);
    text-decoration: underline;
  }
  .intro-card__steps {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-5);
    padding: 0;
    margin: var(--space-2) 0 0;
    list-style: none;
  }
  .intro-card__step {
    flex: 1 1 15rem;
    min-width: 0;
  }
  .intro-card__link {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    color: var(--ink);
    font-size: var(--font-sm);
  }
  .intro-card__tick {
    flex: none;
    color: var(--muted);
  }
  .intro-card__tick--complete {
    color: var(--accent);
    font-weight: 600;
  }
  /* Touch screens: each step and Hide is a whole touch target, the rows --space-2 apart like every pair of adjacent targets. */
  @media (pointer: coarse) {
    .explore-welcome__about {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
    .intro-card__link,
    .intro-card__dismiss {
      min-height: var(--touch-target);
    }
    .intro-card__link {
      align-items: center;
    }
    .intro-card__steps {
      row-gap: var(--space-2);
    }
  }
</style>

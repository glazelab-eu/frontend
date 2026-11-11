<script lang="ts">
  import { t } from '../../lib/i18n';
  import { home, routeHref } from '../../lib/routing/routes';
  import type { LoadFailure } from '../../lib/sync/lifecycle';
  import { reloadApp } from '../../lib/pwa/update';

  interface Props {
    /**
     * missing: unknown route, or an item that does not exist or is not visible (never says which);
     * unavailable: the last load failed (see `failure`) and nothing saved matches;
     * crashed: the page failed to render (also covers a stale code chunk after a deploy).
     */
    status: 'loading' | 'missing' | 'unavailable' | 'crashed';
    /** A first load of the library in pages: how many combinations arrived of how many (`progressOf(AppState.sync)`). */
    progress?: { done: number; total: number } | null;
    /** Why the last load failed (`AppState.sync.failure`); offline when unknown. */
    failure?: LoadFailure | null;
    signedIn?: boolean;
    onSignIn?: () => void;
    onRetry?: () => void;
    /** 1 where no `PageHead` gives the page its h1 (an unknown route, a missing item), else 2 under it. */
    headingLevel?: 1 | 2;
  }

  const unavailableBody = {
    offline: 'route.unavailable.offline',
    server: 'route.unavailable.server',
    rateLimited: 'route.unavailable.rateLimited',
  } as const;

  let { status, progress = null, failure = 'offline', signedIn = true, onSignIn, onRetry, headingLevel = 2 }: Props = $props();
</script>

{#if status === 'loading'}
  <div
    class="empty-state"
    role="status">
    {progress ? $t('route.loadingProgress', { values: progress }) : $t('route.loading')}
  </div>
{:else}
  <div
    class="empty-state route-status"
    role={status === 'missing' ? undefined : 'alert'}>
    <svelte:element
      this={`h${headingLevel}`}
      class="empty-state__title">
      {status === 'missing' ? $t('route.notFound.title') : status === 'unavailable' ? $t('route.unavailable.title') : $t('route.crashed.title')}
    </svelte:element>
    <p class="empty-state__description">
      {status === 'missing'
        ? signedIn
          ? $t('route.notFound.body')
          : $t('route.notFound.signedOutBody')
        : status === 'unavailable'
          ? $t(unavailableBody[failure ?? 'offline'])
          : $t('route.crashed.body')}
    </p>
    <div class="button-row route-status__actions">
      {#if status === 'missing' && !signedIn && onSignIn}
        <button
          class="button button--primary"
          onclick={onSignIn}>
          {$t('common.signIn')}
        </button>
      {/if}
      {#if status !== 'missing' && onRetry}
        <button
          class="button button--primary"
          onclick={onRetry}>
          {$t('common.tryAgain')}
        </button>
      {/if}
      {#if status === 'crashed'}
        <button
          class="button route-status__secondary"
          onclick={() => reloadApp()}>
          {$t('route.reload')}
        </button>
      {/if}
      <a
        class="button route-status__secondary"
        href={routeHref(home)}>
        {$t('route.back')}
      </a>
    </div>
  </div>
{/if}

<style>
  .route-status__actions {
    justify-content: center;
    margin-top: var(--space-2);
  }
  .route-status__secondary {
    text-decoration: none;
  }
</style>

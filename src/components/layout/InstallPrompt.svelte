<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { InstallState } from '../../lib/pwa/install';
  import ModalShell from '../ui/ModalShell.svelte';

  interface Props {
    state: InstallState;
    onOpen: () => void;
    onDecline: () => void;
    onInstall: () => Promise<void>;
  }
  let { state, onOpen, onDecline, onInstall }: Props = $props();
</script>

{#if state.invitation && !state.installed}
  <aside
    class="install-prompt"
    aria-label={$t('install.title')}>
    <p class="install-prompt__message">{$t('install.invitation')}</p>
    <div class="install-prompt__actions">
      <button
        class="button button--primary"
        onclick={onOpen}>
        <span class="install-prompt__desktop-label">{$t('install.details')}</span>
        <span class="install-prompt__mobile-label">{$t('install.title')}</span>
      </button>
      <button
        class="install-prompt__later"
        onclick={onDecline}>
        {$t('install.notNow')}
      </button>
    </div>
  </aside>
{/if}

{#if state.open && !state.installed}
  <ModalShell
    title={$t('install.title')}
    onClose={onDecline}>
    <p>{$t('install.body')}</p>
    {#if state.failed}
      <p
        class="install-prompt__error"
        role="alert">
        {$t('install.failed')}
      </p>
    {/if}
    {#if state.canPrompt || state.busy}
      <p>{$t('install.confirmation')}</p>
    {:else}
      <p>{state.ios ? $t('install.instructions.ios') : $t('install.instructions.browser')}</p>
    {/if}
    <p>{$t('install.laterHint')}</p>
    <div class="install-prompt__actions">
      {#if state.canPrompt || state.busy}
        <button
          class="button button--primary"
          disabled={state.busy}
          onclick={onInstall}>
          {state.busy ? $t('install.waiting') : $t('install.action')}
        </button>
      {/if}
      <button
        class="button"
        disabled={state.busy}
        onclick={onDecline}>
        {$t('install.notNow')}
      </button>
    </div>
  </ModalShell>
{/if}

<style>
  .install-prompt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    max-width: 73.5rem;
    margin: var(--space-4) auto 0;
    padding: var(--space-3) var(--space-4);
    background: var(--blue);
    color: var(--ink);
    border-radius: var(--radius-sm);
    font-size: var(--font-base);
  }
  .install-prompt__mobile-label {
    display: none;
  }
  .install-prompt__message {
    margin: 0;
  }
  .install-prompt__actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    flex-shrink: 0;
    gap: var(--space-3);
  }
  .install-prompt__later {
    background: none;
    border: 0;
    padding: var(--space-2);
    color: var(--accent);
    font-weight: 600;
  }
  .install-prompt__error {
    color: var(--danger-ink);
  }
  @media (width < 68.75em) {
    .install-prompt {
      margin-inline: var(--space-7);
    }
  }
  @media (width < 45em) {
    .install-prompt {
      margin: var(--space-3) var(--space-4) 0;
      padding: var(--space-2) var(--space-3);
    }
    .install-prompt__message,
    .install-prompt__desktop-label {
      display: none;
    }
    .install-prompt__mobile-label {
      display: inline;
    }
    .install-prompt__actions {
      width: 100%;
      justify-content: space-between;
      flex-wrap: nowrap;
    }
  }
  @media (pointer: coarse) {
    .install-prompt__later {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
  }
</style>

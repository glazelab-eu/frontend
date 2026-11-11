<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import { qrFileName } from '../../lib/qr/qr-file-name';
  import FormError from '../common/FormError.svelte';
  import ConfirmDialog from '../common/ConfirmDialog.svelte';
  import QrPanel from '../sharing/QrPanel.svelte';
  import type { BuddyActions } from './buddy-actions';

  interface Props {
    /** The account has a buddy link (the API never says which: a token is answered once, when it is created). */
    hasLink: boolean;
    online: boolean;
    /** The last failed create or replace (a server message or key), shown above the link. */
    error: string;
    actions: Pick<BuddyActions, 'createLink' | 'currentLink' | 'copyLink' | 'shareLink'>;
  }
  let { hasLink, online, error, actions }: Props = $props();
  let busy = $state(false);
  let confirming = $state(false);
  let copyRefused = $state(false);
  // Counts the links created here, so the link read from the app's memory is read again after one.
  let created = $state(0);
  const link = $derived.by(() => {
    void created;
    return hasLink ? actions.currentLink() : null;
  });
  let linkField = $state<HTMLInputElement>();
  // Where the device has a share sheet; decided in the first render, the panel only reacts to clicks.
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /** One write at a time; a new link takes the focus so it can be copied at once. `replace`: the question was answered. */
  async function generate(replace: boolean) {
    if (busy || !online) return;
    busy = true;
    copyRefused = false;
    try {
      if (await actions.createLink(replace)) created++;
    } finally {
      busy = false;
    }
    if (link) {
      await tick();
      linkField?.focus();
    }
  }
  async function copy() {
    if (!link) return;
    copyRefused = !(await actions.copyLink(link));
    // Refused: the field is the fallback, selected for a manual copy.
    if (copyRefused) linkField?.select();
  }
  async function share() {
    if (link && (await actions.shareLink($t('buddies.link.shareTitle'), link))) linkField?.select();
  }
  const selectAll = (event: Event) => (event.currentTarget as HTMLInputElement).select();
</script>

<h3 class="buddy-link__title">{$t('buddies.link.title')}</h3>
<p class="buddy-link__text">{$t('buddies.link.body')}</p>
<FormError message={error} />
{#if link}
  <div class="buddy-link__link">
    <label class="form-field buddy-link__field">
      {$t('buddies.link.field')}
      <input
        class="form-field__control"
        type="text"
        readonly
        value={link}
        bind:this={linkField}
        onfocus={selectAll}
        onclick={selectAll} />
    </label>
    <button
      type="button"
      class="button button--primary"
      onclick={copy}>
      {$t('buddies.link.copy')}
    </button>
    {#if canShare}
      <button
        type="button"
        class="button"
        onclick={share}>
        {$t('buddies.link.share')}
      </button>
    {/if}
  </div>
  {#if copyRefused}
    <p role="status">{$t('buddies.link.copyManual')}</p>
  {/if}
  <QrPanel
    {link}
    fileName={qrFileName('buddy-link')} />
{:else if hasLink}
  <p class="buddy-link__text">{$t('buddies.link.hidden')}</p>
{/if}
<button
  type="button"
  class="button buddy-link__replace"
  disabled={busy || !online}
  onclick={() => (hasLink ? (confirming = true) : generate(false))}>
  {hasLink ? $t('buddies.link.replace') : $t('buddies.link.create')}
</button>
{#if hasLink}
  <p class="buddy-link__hint">{$t('buddies.link.hint')}</p>
{/if}
{#if confirming}
  <ConfirmDialog
    title={$t('buddies.link.confirmTitle')}
    confirmLabel={$t('buddies.link.confirm')}
    {online}
    offlineMessage={$t('buddies.offline')}
    confirmDisabled={busy}
    onConfirm={() => {
      confirming = false;
      void generate(true);
    }}
    onCancel={() => (confirming = false)}>
    <p>{$t('buddies.link.confirmBody')}</p>
  </ConfirmDialog>
{/if}

<style>
  .buddy-link__title {
    margin: var(--space-6) 0 var(--space-2);
    font-size: var(--font-base);
    font-weight: 650;
  }
  .buddy-link__text {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    line-height: 1.6;
  }
  .buddy-link__link {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .buddy-link__field {
    flex: 1 1 16rem;
    min-width: 0;
    margin-bottom: 0;
  }
  .buddy-link__replace {
    margin-top: var(--space-3);
  }
  .buddy-link__hint {
    margin: var(--space-2) 0 0;
    color: var(--muted);
    font-size: var(--font-sm);
  }
</style>

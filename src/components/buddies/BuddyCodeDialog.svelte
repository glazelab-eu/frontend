<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { t } from '../../lib/i18n';
  import { qrFileName } from '../../lib/qr/qr-file-name';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import QrPanel from '../sharing/QrPanel.svelte';
  import type { BuddyCode } from './buddy-actions';

  interface Props extends BuddyCode {
    onClose: () => void;
  }
  let { hasLink, online, error, actions, onClose }: Props = $props();
  /** The link made in this session, else made now: the API keeps only its hash, so an earlier link cannot be shown again. */
  let link = $state<string | null>(untrack(() => actions.currentLink()));
  let busy = $state(false);
  let copyRefused = $state(false);
  let linkField = $state<HTMLInputElement>();
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /** One write at a time. An earlier link, if there is one, is replaced without a question: this entry always shows a working code. */
  async function make() {
    if (busy || !online) return;
    busy = true;
    try {
      link = await actions.createLink(hasLink);
    } finally {
      busy = false;
    }
    if (link) {
      await tick();
      linkField?.focus();
    }
  }
  onMount(() => {
    if (!link) void make();
  });
  async function copy() {
    if (!link) return;
    copyRefused = !(await actions.copyLink(link));
    if (copyRefused) linkField?.select();
  }
  async function share() {
    if (link && (await actions.shareLink($t('buddies.link.shareTitle'), link))) linkField?.select();
  }
  const selectAll = (event: Event) => (event.currentTarget as HTMLInputElement).select();
</script>

<ModalShell
  title={$t('buddies.code.title')}
  {onClose}
  sheet>
  <p class="buddy-code__text">{$t('buddies.code.body')}</p>
  <FormError message={error} />
  {#if link}
    <QrPanel
      {link}
      fileName={qrFileName('buddy-link')} />
    <label class="form-field buddy-code__field">
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
    <div class="button-row buddy-code__actions">
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
  {:else if busy}
    <p
      class="buddy-code__text"
      role="status">
      {$t('buddies.code.creating')}
    </p>
  {:else}
    <OfflineNote
      {online}
      message={$t('buddies.code.offline')} />
    {#if online}
      <button
        type="button"
        class="button"
        onclick={make}>
        {$t('common.tryAgain')}
      </button>
    {/if}
  {/if}
</ModalShell>

<style>
  .buddy-code__text {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    line-height: 1.6;
  }
  .buddy-code__field {
    margin-top: var(--space-3);
  }
  .buddy-code__actions {
    margin-top: var(--space-3);
  }
</style>

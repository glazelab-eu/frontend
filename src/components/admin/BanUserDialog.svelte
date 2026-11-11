<script lang="ts">
  import { t } from '../../lib/i18n';
  import { MAX_BAN_REASON, banReason } from '../../lib/admin/bans';
  import { FIRST_FIELD } from '../ui/first-field';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';

  interface Props {
    /** The person's display name, as the admin sees it where they met them. */
    name: string;
    /** Offer "Also block the reported pictures": the account has profile-picture reports waiting for a decision. */
    pictureReports?: boolean;
    online: boolean;
    /** Why the last attempt failed (a server message or message key), shown at the buttons. */
    error?: string;
    /** Bans the account; resolves true once it was banned. */
    onBan: (reason: string, blockPictures: boolean) => Promise<boolean>;
    /** Where the focus goes when the control that opened the dialog is gone after the ban. */
    fallbackFocus?: () => void;
    onClose: () => void;
  }

  let { name, pictureReports = false, online, error = '', onBan, fallbackFocus, onClose }: Props = $props();
  const id = $props.id();
  let text = $state('');
  let blockPictures = $state(false);
  let busy = $state(false);
  let failed = $state(false);
  let blank = $state(false);
  const REQUIRED = 'ban.reasonRequired';
  const title = $derived($t('ban.title', { values: { name } }));

  async function submit() {
    if (busy || !online) return;
    const reason = banReason(text);
    blank = !reason;
    if (!reason) return;
    busy = true;
    failed = false;
    try {
      failed = !(await onBan(reason, pictureReports && blockPictures));
      if (!failed) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  {title}
  initialFocus={FIRST_FIELD}
  {fallbackFocus}
  onClose={() => !busy && onClose()}>
  <p>{$t('ban.intro')}</p>
  <ul class="ban-dialog__effects">
    <li>{$t('ban.effect.account')}</li>
    <li>{$t('ban.effect.address')}</li>
    <li>{$t('ban.effect.clubs')}</li>
  </ul>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <label class="form-field">
      {$t('ban.reason')}
      <textarea
        class="form-field__control form-field__control--multiline"
        bind:value={text}
        maxlength={MAX_BAN_REASON}
        rows="4"
        required
        aria-invalid={blank}
        aria-describedby="{id}-help {id}-count"
        oninput={() => (blank = false)}>
      </textarea>
    </label>
    <small
      class="ban-dialog__note"
      id="{id}-help">
      {$t('ban.reasonHelp')}
    </small>
    <small
      class="ban-dialog__note"
      id="{id}-count">
      {$t('ban.count', { values: { count: text.length, max: MAX_BAN_REASON } })}
    </small>
    {#if blank}
      <FormError message={REQUIRED} />
    {/if}
    {#if pictureReports}
      <label class="ban-dialog__check">
        <input
          type="checkbox"
          bind:checked={blockPictures} />
        {$t('ban.blockPictures')}
      </label>
    {/if}
    {#if failed}
      <FormError message={error || 'errors.generic'} />
    {/if}
    <OfflineNote {online} />
    <div class="button-row button-row--end">
      <button
        type="button"
        class="button"
        disabled={busy}
        onclick={onClose}>
        {$t('common.cancel')}
      </button>
      <button
        class="button button--danger"
        aria-busy={busy}
        disabled={busy || !online}>
        {$t('ban.submit')}
      </button>
    </div>
  </form>
</ModalShell>

<style>
  .ban-dialog__effects {
    margin: 0 0 var(--space-4);
    padding-left: var(--space-5);
    display: grid;
    gap: var(--space-1);
  }
  .ban-dialog__note {
    display: block;
    margin: 0 0 var(--space-2);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  .ban-dialog__check {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    margin: var(--space-3) 0;
  }
  @media (pointer: coarse) {
    .ban-dialog__check {
      align-items: center;
      min-height: var(--touch-target);
    }
    .ban-dialog__note {
      font-size: var(--font-body);
    }
  }
</style>

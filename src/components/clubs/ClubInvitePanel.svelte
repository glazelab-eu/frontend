<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import { qrFileName } from '../../lib/qr/qr-file-name';
  import type { Club } from '../../lib/api/models';
  import { clubForm, formErrorFor, type FormError as FormErrorState } from '../../state/app/app-state';
  import { createClubInvite } from '../../state/clubs/club-invite.svelte';
  import FormError from '../common/FormError.svelte';
  import ConfirmDialog from '../common/ConfirmDialog.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import QrPanel from '../sharing/QrPanel.svelte';
  import type { ClubActions } from './club-actions';

  interface Props {
    club: Club;
    online: boolean;
    actions: ClubActions;
    /** The last failed submit of the app; only this club's invite form shows it. */
    formError: FormErrorState | null;
  }
  let { club, online, actions, formError }: Props = $props();
  const id = $props.id();
  let busy = $state(false);
  let linkField = $state<HTMLInputElement>();
  const invite = createClubInvite(
    {
      regenerate: () => actions.regenerateInvite(club.id),
      current: () => actions.inviteLink(club.id),
      copy: (link) => actions.copyLink(link),
    },
    () => club,
  );
  // Where the device has a share sheet; decided in the first render, the panel only opens on a click.
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /** One write at a time; the button turns busy (disabled) and drops focus, so a new link takes it and can be copied at once. */
  async function invited(action: () => Promise<void>) {
    if (busy || !online) return;
    const before = invite.link;
    busy = true;
    try {
      await action();
    } finally {
      busy = false;
    }
    if (invite.link && invite.link !== before) {
      await tick();
      linkField?.focus();
    }
  }
  async function copy() {
    await invite.copy();
    // Refused: the field is the fallback, selected for a manual copy.
    if (invite.copyRefused) linkField?.select();
  }
  async function share() {
    const link = invite.link;
    if (link && (await actions.shareLink($t('clubs.settings.invites.shareTitle', { values: { club: club.name } }), link))) linkField?.select();
  }
  const selectAll = (event: Event) => (event.currentTarget as HTMLInputElement).select();
</script>

<p>{$t('clubs.settings.invites.body')}</p>
<p>
  {club.invitesEnabled ? $t('clubs.settings.invites.active') : $t('clubs.settings.invites.disabled')}
</p>
<OfflineNote {online} />
<FormError message={formErrorFor({ formError }, clubForm('invite', club.id))} />
{#if invite.link}
  <div class="club-invite-panel__link">
    <label class="form-field club-invite-panel__link-field">
      {$t('clubs.settings.invites.link')}
      <input
        class="form-field__control"
        type="text"
        readonly
        value={invite.link}
        bind:this={linkField}
        onfocus={selectAll}
        onclick={selectAll} />
    </label>
    <button
      type="button"
      class="button button--primary"
      onclick={copy}>
      {$t('clubs.settings.invites.copy')}
    </button>
    {#if canShare}
      <button
        type="button"
        class="button"
        onclick={share}>
        {$t('clubs.settings.invites.share')}
      </button>
    {/if}
  </div>
  {#if invite.copyRefused}
    <p role="status">{$t('clubs.settings.invites.copyManual')}</p>
  {/if}
  <QrPanel
    link={invite.link}
    fileName={qrFileName('club-invite', club.name)} />
{:else if invite.kind === 'off'}
  <p>{$t('clubs.settings.invites.offKnown')}</p>
{:else if invite.kind === 'replaced'}
  <p>{$t('clubs.settings.invites.replaced')}</p>
{:else if invite.kind === 'hidden'}
  <p>{$t('clubs.settings.invites.hidden')}</p>
{/if}
<button
  type="button"
  class="button club-invite-panel__replace"
  disabled={busy || !online}
  aria-describedby={invite.turnsInvitesOn ? `${id}-turns-on` : undefined}
  onclick={() => invited(invite.request)}>
  {club.hasInviteLink ? $t('clubs.settings.invites.replace') : $t('clubs.settings.invites.generate')}
</button>
{#if invite.turnsInvitesOn}
  <p id="{id}-turns-on">{$t('clubs.settings.invites.turnsOn')}</p>
{/if}
<p class="club-invite-panel__hint">{$t('clubs.settings.invites.replaceHint')}</p>
{#if invite.confirming}
  <ConfirmDialog
    title={$t('clubs.settings.invites.confirmTitle')}
    confirmLabel={$t('clubs.settings.invites.confirm')}
    {online}
    confirmDisabled={busy}
    onConfirm={() => void invited(invite.confirm)}
    onCancel={invite.cancel}>
    <p>{$t('clubs.settings.invites.confirmBody')}</p>
  </ConfirmDialog>
{/if}

<style>
  .club-invite-panel__link {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .club-invite-panel__link-field {
    flex: 1 1 16rem;
    min-width: 0;
    margin-bottom: 0;
  }
  .club-invite-panel__replace {
    margin-top: var(--space-3);
  }
  .club-invite-panel__hint {
    color: var(--muted);
    font-size: var(--font-sm);
  }
</style>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { t } from '../../lib/i18n';
  import Avatar from '../avatars/Avatar.svelte';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import type { Club, ClubMember } from '../../lib/api/models';
  import { isLastAdmin } from '../../lib/clubs/clubs';
  import { clubForm, formErrorFor, type ClubSection, type FormError as FormErrorState } from '../../state/app/app-state';
  import type { ClubActions } from './club-actions';
  import ConfirmDialog from '../common/ConfirmDialog.svelte';
  import { createConfirmation } from '../../state/shared/confirmation.svelte';

  interface Props {
    club: Club;
    /** The club's members as loaded with the clubs (the app reloads them after each change); undefined when the list is not available. */
    members: ClubMember[] | undefined;
    /** The signed-in account: its own row offers no removal (it leaves from the Clubs list). */
    userId: string;
    online: boolean;
    actions: ClubActions;
    /** The last failed submit of the app; only this club's sections show it. */
    formError: FormErrorState | null;
  }
  let { club, members, userId, online, actions, formError }: Props = $props();
  let name = $state(untrack(() => club.name));
  let houseRules = $state(untrack(() => club.houseRules));
  /**
   * The switch follows the club when its value changes (generating a link turns invites on; another admin may switch
   * them), else a later save would switch them back; a load with the same value keeps an unsaved change.
   */
  const loadedInvites = $derived(club.invitesEnabled);
  let invitesEnabled = $derived(loadedInvites);
  let busy = $state(false);
  /** The member whose role the last attempt changed, so its failure shows at that row. */
  let roleTarget = $state('');
  const id = $props.id();
  const errorFor = (section: ClubSection) => formErrorFor({ formError }, clubForm(section, club.id));
  let saved = $state(false);
  let membersHeading = $state<HTMLHeadingElement>();
  /** Removing a member asks first; the row leaves with the reload, so focus goes to the list's heading. */
  const removal = createConfirmation(async (member: ClubMember) => {
    roleTarget = member.id;
    const removed = await actions.removeClubMember(club.id, member.id);
    if (removed) {
      await tick();
      membersHeading?.focus();
    }
    return removed;
  });
  /** One write at a time; `saved` belongs to the last settings save only. */
  async function run(action: () => Promise<void>) {
    if (busy || !online) return;
    busy = true;
    saved = false;
    try {
      await action();
    } finally {
      busy = false;
    }
  }
  async function save() {
    saved = await actions.updateClub(club.id, { name, houseRules, invitesEnabled });
  }
  async function role(member: ClubMember) {
    roleTarget = member.id;
    await actions.changeClubRole(club.id, member.id, member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN');
  }
</script>

<div class="club-settings">
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void run(save);
    }}>
    <label class="form-field">
      {$t('clubs.name')}
      <input
        class="form-field__control"
        bind:value={name}
        required
        maxlength="120" />
    </label>
    <label class="form-field">
      {$t('clubs.houseRules')}
      <textarea
        class="form-field__control"
        bind:value={houseRules}
        maxlength="10000"
        rows="6">
      </textarea>
    </label>
    <label class="club-settings__toggle">
      <input
        type="checkbox"
        bind:checked={invitesEnabled} />
      {$t('clubs.settings.enableInvites')}
    </label>
    <OfflineNote {online} />
    <FormError message={errorFor('settings')} />
    <button
      class="button button--primary"
      disabled={busy || !online}>
      {$t('clubs.settings.save')}
    </button>
    {#if saved}
      <p role="status">{$t('clubs.settings.saved')}</p>
    {/if}
  </form>
  <section class="club-settings__section">
    <h3
      bind:this={membersHeading}
      tabindex="-1">
      {$t('clubs.settings.members')}
    </h3>
    <OfflineNote {online} />
    {#if !members}
      <p>{$t('clubs.page.membersUnavailable')}</p>
    {/if}
    {#if roleTarget && !members?.some((member) => member.id === roleTarget)}
      <!-- The member the last change was for has gone meanwhile (the list reloaded): the refusal shows here. -->
      <FormError message={errorFor('members')} />
    {/if}
    {#each members ?? [] as member (member.id)}
      {@const lastAdmin = isLastAdmin(members ?? [], member)}
      <div class="club-settings__member">
        <div class="club-settings__who">
          <Avatar
            size="sm"
            avatarId={member.avatarId}
            name={member.displayName}
            viewerId={userId} />
          <span class="club-settings__member-name">
            {member.displayName} · {member.role === 'ADMIN' ? $t('clubs.role.admin') : $t('clubs.role.member')}
          </span>
        </div>
        <div class="button-row">
          <button
            class={['button', { 'club-settings__role--unavailable': lastAdmin }]}
            disabled={busy || removal.busy || !online}
            aria-disabled={lastAdmin || undefined}
            aria-describedby={lastAdmin ? `${id}-last-admin-${member.id}` : undefined}
            onclick={() => {
              if (!lastAdmin) void run(() => role(member));
            }}>
            {member.role === 'ADMIN' ? $t('clubs.settings.makeMember') : $t('clubs.settings.makeAdmin')}
          </button>
          {#if member.id !== userId}
            <button
              type="button"
              class="button club-settings__remove"
              disabled={busy || removal.busy || !online}
              aria-label={$t('clubs.settings.removeFor', { values: { name: member.displayName } })}
              onclick={() => removal.ask(member)}>
              {$t('clubs.settings.remove')}
            </button>
          {/if}
        </div>
        {#if lastAdmin}
          <p
            class="club-settings__reason"
            id="{id}-last-admin-{member.id}">
            {$t('clubs.settings.lastAdmin')}
          </p>
        {/if}
        {#if roleTarget === member.id}
          <div class="club-settings__member-error">
            <FormError message={errorFor('members')} />
          </div>
        {/if}
      </div>
    {/each}
  </section>
</div>
{#if removal.asking}
  {@const member = removal.asking}
  <ConfirmDialog
    title={$t('clubs.settings.removeTitle', { values: { name: member.displayName } })}
    confirmLabel={$t('clubs.settings.removeConfirm')}
    {online}
    onConfirm={() => void removal.confirm()}
    onCancel={removal.cancel}>
    <p>{$t('clubs.settings.removeBody')}</p>
    <p>{$t('clubs.settings.removeInvite')}</p>
  </ConfirmDialog>
{/if}

<style>
  .club-settings {
    margin-top: var(--space-4);
  }
  .club-settings__toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .club-settings__section {
    border-top: 0.0625rem solid var(--border);
    margin-top: var(--space-6);
    padding-top: var(--space-4);
  }
  .club-settings__member {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin: var(--space-3) 0;
    flex-wrap: wrap;
  }
  .club-settings__who {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .club-settings__member-name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .club-settings__role--unavailable {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .club-settings__reason,
  .club-settings__member-error {
    flex-basis: 100%;
    margin: 0;
  }
  .club-settings__reason {
    color: var(--muted);
    font-size: var(--font-sm);
  }
  @media (pointer: coarse) {
    .club-settings__toggle {
      min-height: var(--touch-target);
    }
    /* Removing keeps a full touch gap from the role button. */
    .club-settings__remove {
      margin-inline-start: calc(var(--touch-gap) - var(--space-2));
    }
  }
</style>

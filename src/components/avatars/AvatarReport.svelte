<script lang="ts">
  import { t } from '../../lib/i18n';
  import ActionMenu, { type ActionMenuItem } from '../ui/ActionMenu.svelte';
  import ReportImageDialog from '../images/ReportImageDialog.svelte';

  interface Props {
    /** The picture to report; nothing is offered without one (and never for the account's own picture: the host leaves this out). */
    avatarId: string | null | undefined;
    /** The person whose picture it is, named in the menu button so a list of rows has distinct names. */
    name: string;
    online: boolean;
    /** Why the last report failed, shown in the dialog. */
    error?: string;
    /** Records the report; answers true once it was (a repeated report counts too). */
    onReport: (avatarId: string, reason: string | null) => Promise<boolean>;
    /** Entries of the host beside Report (a site admin's ban in a member row), so a row has one menu; the menu then reads "Options for {name}". */
    extra?: ActionMenuItem[];
    /** Called with the id of the chosen extra entry. */
    onExtra?: (id: string) => void;
    /** Where the menu opens: below for a button at the top of a card or dialog, above in a list. */
    placement?: 'above' | 'below';
  }

  let { avatarId, name, online, error = '', onReport, extra = [], onExtra, placement = 'above' }: Props = $props();
  let reporting = $state<string | null>(null);
  // The picture the dialog is about stays the one that was chosen, even when the lists change under it.
  $effect(() => {
    if (reporting && reporting !== avatarId) reporting = null;
  });
</script>

{#if avatarId || extra.length}
  <ActionMenu
    label={extra.length ? $t('member.menu', { values: { name } }) : $t('avatar.report.menu', { values: { name } })}
    items={[...(avatarId ? [{ id: 'report', label: $t('avatar.report.entry'), disabled: !online }] : []), ...extra]}
    note={online ? undefined : extra.length ? $t('member.offline') : $t('avatar.report.offline')}
    {placement}
    onSelect={(id) => (id === 'report' ? (reporting = avatarId ?? null) : onExtra?.(id))} />
{/if}
{#if avatarId}
  {#if reporting}
    {@const id = reporting}
    <ReportImageDialog
      {online}
      {error}
      title={$t('avatar.report.title')}
      body={$t('avatar.report.body', { values: { name } })}
      onSubmit={(reason) => onReport(id, reason)}
      onClose={() => (reporting = null)} />
  {/if}
{/if}

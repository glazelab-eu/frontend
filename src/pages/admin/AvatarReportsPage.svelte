<script lang="ts">
  import { tick } from 'svelte';
  import { formErrorFor } from '../../state/app/app-state';
  import { t, locale } from '../../lib/i18n';
  import type { AvatarReport } from '../../lib/api/models';
  import type { AppController } from '../../state/app/app-controller';
  import PageHead from '../../components/ui/PageHead.svelte';
  import AdminBackLink from '../../components/admin/AdminBackLink.svelte';
  import AdminGate from '../../components/admin/AdminGate.svelte';
  import RecordList from '../../components/admin/RecordList.svelte';
  import Record from '../../components/admin/Record.svelte';
  import RecordDetails from '../../components/admin/RecordDetails.svelte';
  import RecordField from '../../components/admin/RecordField.svelte';
  import ConfirmDialog from '../../components/common/ConfirmDialog.svelte';
  import BanUserDialog from '../../components/admin/BanUserDialog.svelte';
  import { canBan } from '../../lib/admin/bans';
  import { createPagedList } from '../../state/admin/paged-list.svelte';
  import PageLoadControls from '../../components/admin/PageLoadControls.svelte';
  import { formatServerTime, nextReportPage } from '../../lib/admin/image-reports';
  import {
    DEFAULT_REPORT_FILTER,
    canRemove,
    filterStatus,
    groupReports,
    missingPictureKey,
    pictureStateKey,
    statusKey,
    type AvatarReportFilter,
    type ReportedPicture,
  } from '../../lib/admin/avatar-reports';

  interface Props {
    app: AppController;
  }
  let { app }: Props = $props();
  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  let filter = $state<AvatarReportFilter>(DEFAULT_REPORT_FILTER);
  /** The picture whose decision is running; one at a time. */
  let deciding = $state<string | null>(null);
  /** The picture the confirmation dialog is about to remove and block. */
  let removing = $state<ReportedPicture | null>(null);
  /** The picture whose owner the ban dialog is about to ban. */
  let banning = $state<ReportedPicture | null>(null);
  /** Pictures whose evidence could not be shown (purged, or gone since the list was read). */
  let missing = $state<string[]>([]);
  let error = $derived(formErrorFor($appStore, 'avatar-reports'));
  let list = $state<HTMLElement>();
  const reportId = (report: AvatarReport) => report.id;

  const queue = createPagedList<AvatarReport>({
    request: (page) => app.loadAvatarReports(page, filterStatus(filter)),
    key: reportId,
    nextPage: nextReportPage,
  });
  let groups = $derived(groupReports(queue.rows));

  /** A decision applies to every open report of the picture: the queue is read again, since one decision changes several rows (and the status they are listed under). */
  async function decide(group: ReportedPicture, decision: () => Promise<boolean>) {
    if (deciding) return;
    const current = queue.current();
    deciding = group.avatarId;
    const done = await decision();
    if (!current()) return;
    deciding = null;
    removing = null;
    // A refusal (the other decision was made meanwhile: 409) shows its message, and the list shows what is true now.
    await queue.load(0);
    if (done || !error) {
      await tick();
      list?.focus();
    }
  }
  /** Bans the owner of a reported picture; the queue is read again either way (their reports change state, and a refusal shows what is true now). */
  async function ban(group: ReportedPicture, reason: string, blockPictures: boolean) {
    if (!group.ownerId) return false;
    const current = queue.current();
    const done = await app.banUser(group.ownerId, nameOf(group), reason, blockPictures);
    if (!current()) return done;
    await queue.load(0);
    if (done) {
      await tick();
      list?.focus();
    }
    return done;
  }
  const dismiss = (group: ReportedPicture) => group.open && decide(group, () => app.dismissAvatarReport(group.open!.id));
  const remove = (group: ReportedPicture) => {
    const way = canRemove(group);
    if (way === 'decide' && group.open) return decide(group, () => app.removeReportedAvatar(group.open!.id));
    if (way === 'delete') return decide(group, () => app.removeAvatarAsAdmin(group.avatarId));
  };

  /** Who reads the queue: a primitive, so a reload of the same account keeps the rows. */
  let actor = $derived(user?.siteAdmin && online ? user.id : null);
  $effect(() => {
    const status = filter;
    void status;
    deciding = null;
    removing = null;
    banning = null;
    missing = [];
    queue.reset();
    if (actor) void queue.load(0);
    return () => {
      queue.invalidate();
    };
  });
  const nameOf = (group: ReportedPicture) => group.owner ?? $t('account.deleted');
  const filters: AvatarReportFilter[] = ['OPEN', 'DISMISSED', 'ACTIONED', 'CLOSED', 'ALL'];
  const filterLabel = {
    OPEN: 'avatars.reports.filter.open',
    DISMISSED: 'avatars.reports.filter.dismissed',
    ACTIONED: 'avatars.reports.filter.actioned',
    CLOSED: 'avatars.reports.filter.closed',
    ALL: 'avatars.reports.filter.all',
  } as const;
</script>

<AdminBackLink siteAdmin={!!user?.siteAdmin} />
<PageHead
  eyebrow={$t('images.log.admin')}
  title={$t('avatars.reports.title')}
  description={$t('avatars.reports.body')} />
<AdminGate
  siteAdmin={!!user?.siteAdmin}
  {online}
  adminOnlyText={$t('avatars.reports.adminOnly')}
  offlineText={$t('avatars.reports.offline')}>
  <label class="avatar-reports__filter">
    {$t('avatars.reports.filter')}
    <select
      class="form-field__control"
      bind:value={filter}>
      {#each filters as value (value)}
        <option {value}>{$t(filterLabel[value])}</option>
      {/each}
    </select>
  </label>
  {#if !queue.busy && !error && !queue.loadFailed && !groups.length}
    <p class="empty-state">{filter === 'OPEN' || filter === 'ALL' ? $t('avatars.reports.empty') : $t('avatars.reports.emptyFiltered')}</p>
  {/if}
  <RecordList
    class="avatar-reports"
    busy={queue.busy}
    focusable
    bind:element={list}>
    {#each groups as group (group.avatarId)}
      {@const name = nameOf(group)}
      {@const way = canRemove(group)}
      <Record class="avatar-reports__entry">
        <div class="avatar-reports__head">
          <!-- The evidence: the admin endpoint answers the picture as reported, also after a replacement or the owner's deletion (`no-store`, so never cached here). -->
          {#if group.hasPicture && !missing.includes(group.avatarId)}
            <img
              class="avatar-reports__picture"
              src="/api/admin/avatar-reports/{group.evidenceId}/picture"
              alt={$t('avatars.reports.alt', { values: { name } })}
              loading="lazy"
              onerror={() => (missing = [...missing, group.avatarId])} />
          {:else}
            <span class="avatar-reports__picture avatar-reports__picture--gone">{$t(missingPictureKey(group))}</span>
          {/if}
          <div class="avatar-reports__who">
            <strong>{name}</strong>
            <span class="avatar-reports__note">
              {$t('avatars.reports.count', { values: { count: group.reports.length } })} · {$t(statusKey(group.status))}
            </span>
          </div>
        </div>
        <RecordDetails>
          <RecordField label={$t('avatars.reports.state')}>{$t(pictureStateKey(group.picture))}</RecordField>
          {#if group.status === 'CLOSED' && group.closedAt}
            <!-- Nobody decided (the picture went with its account, or its reports expired), so there is no admin to name. -->
            <RecordField label={$t('avatars.reports.status')}>
              {$t(statusKey(group.status))}:
              <time datetime={group.closedAt}>{formatServerTime(group.closedAt, $locale ?? 'en')}</time>
            </RecordField>
          {:else if group.status !== 'OPEN' && group.closedAt}
            <RecordField label={$t('avatars.reports.status')}>
              {$t(statusKey(group.status))}: {$t('avatars.reports.closed', {
                values: { name: group.closedBy ?? $t('account.deleted'), date: formatServerTime(group.closedAt, $locale ?? 'en') },
              })}
            </RecordField>
          {/if}
          {#if group.ownerId}
            <RecordField label={$t('avatars.reports.ownerId')}>{group.ownerId}</RecordField>
          {/if}
          <RecordField label={$t('avatars.reports.pictureId')}>{group.avatarId}</RecordField>
        </RecordDetails>
        <ul class="avatar-reports__reports">
          {#each group.reports as report (report.id)}
            <li class="avatar-reports__report">
              <span class="avatar-reports__reason">{report.reason ?? $t('avatars.reports.noReason')}</span>
              <span class="avatar-reports__note">
                {$t('avatars.reports.reporter')}
                {report.reporter ?? $t('account.deleted')} ·
                <time datetime={report.createdAt}>{formatServerTime(report.createdAt, $locale ?? 'en')}</time>
              </span>
            </li>
          {/each}
        </ul>
        <!-- Actions about the picture, then about the account: the row wraps, so nothing here is sized for a fixed count of buttons. -->
        <div class="button-row">
          {#if way}
            <button
              type="button"
              class="button button--danger"
              disabled={!!deciding}
              aria-busy={deciding === group.avatarId}
              aria-label="{group.picture === 'CURRENT' ? $t('avatars.reports.remove') : $t('avatars.reports.block')}: {name}"
              onclick={() => (removing = group)}>
              {group.picture === 'CURRENT' ? $t('avatars.reports.remove') : $t('avatars.reports.block')}
            </button>
          {/if}
          {#if group.status === 'OPEN'}
            <button
              type="button"
              class="button"
              disabled={!!deciding}
              aria-busy={deciding === group.avatarId}
              aria-label="{$t('avatars.reports.dismiss')}: {name}"
              onclick={() => void dismiss(group)}>
              {$t('avatars.reports.dismiss')}
            </button>
          {/if}
          {#if canBan(user, group.ownerId)}
            <button
              type="button"
              class="button button--danger"
              disabled={!!deciding}
              aria-label="{$t('ban.entry')}: {name}"
              onclick={() => (banning = group)}>
              {$t('ban.entry')}
            </button>
          {/if}
        </div>
      </Record>
    {/each}
  </RecordList>
  <PageLoadControls
    busy={queue.busy}
    failed={queue.loadFailed}
    hasMore={queue.hasMore}
    {error}
    retryLabel={$t('avatars.reports.retry')}
    moreLabel={$t('avatars.reports.more')}
    onLoad={() => void queue.load(queue.nextPage)} />
</AdminGate>

{#if removing && user?.siteAdmin}
  {@const group = removing}
  {@const title = group.picture === 'CURRENT' ? $t('avatars.reports.confirm.remove') : $t('avatars.reports.confirm.block')}
  <ConfirmDialog
    {title}
    confirmLabel={group.picture === 'CURRENT' ? $t('avatars.reports.remove') : $t('avatars.reports.block')}
    {online}
    busy={!!deciding}
    onConfirm={() => void remove(group)}
    onCancel={() => (removing = null)}>
    <p><strong>{nameOf(group)}</strong></p>
    <p>{$t('avatars.reports.removeHelp')}</p>
  </ConfirmDialog>
{/if}

{#if banning && canBan(user, banning.ownerId)}
  {@const group = banning}
  <BanUserDialog
    name={nameOf(group)}
    pictureReports={group.status === 'OPEN'}
    {online}
    error={formErrorFor($appStore, 'ban')}
    fallbackFocus={() => list?.focus()}
    onBan={(reason, blockPictures) => ban(group, reason, blockPictures)}
    onClose={() => (banning = null)} />
{/if}

<style>
  .avatar-reports__filter {
    display: grid;
    gap: var(--space-1);
    max-width: 16rem;
    margin-bottom: var(--space-4);
    font-weight: 600;
  }
  .avatar-reports__head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .avatar-reports__picture {
    flex: none;
    width: 8rem;
    height: 8rem;
    border-radius: var(--radius-md);
    object-fit: cover;
    background: var(--sage);
  }
  .avatar-reports__picture--gone {
    display: grid;
    place-items: center;
    padding: var(--space-2);
    border: 0.0625rem dashed var(--border);
    color: var(--muted);
    font-size: var(--font-sm);
    text-align: center;
  }
  .avatar-reports__who {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .avatar-reports__note {
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .avatar-reports__reports {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .avatar-reports__report {
    display: grid;
    gap: var(--space-0-5);
    padding-left: var(--space-3);
    border-left: 0.1875rem solid var(--border);
  }
  .avatar-reports__reason {
    white-space: pre-wrap;
  }
  @media (width < 45em) {
    .avatar-reports__picture {
      width: 6rem;
      height: 6rem;
    }
  }
</style>

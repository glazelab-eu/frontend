<script lang="ts">
  import { tick } from 'svelte';
  import { formErrorFor } from '../../state/app/app-state';
  import { t, locale } from '../../lib/i18n';
  import type { ImageReport } from '../../lib/api/models';
  import type { AppController } from '../../state/app/app-controller';
  import PageHead from '../../components/ui/PageHead.svelte';
  import AdminBackLink from '../../components/admin/AdminBackLink.svelte';
  import AdminGate from '../../components/admin/AdminGate.svelte';
  import RecordList from '../../components/admin/RecordList.svelte';
  import Record from '../../components/admin/Record.svelte';
  import RecordDetails from '../../components/admin/RecordDetails.svelte';
  import RecordField from '../../components/admin/RecordField.svelte';
  import ImageView from '../../components/images/ImageView.svelte';
  import RemoveImageDialog from '../../components/images/RemoveImageDialog.svelte';
  import BanUserDialog from '../../components/admin/BanUserDialog.svelte';
  import { canBan } from '../../lib/admin/bans';
  import { createPagedList } from '../../state/admin/paged-list.svelte';
  import PageLoadControls from '../../components/admin/PageLoadControls.svelte';
  import {
    adminVisibilityKey,
    formatServerTime,
    nextReportPage,
    reportIdOf,
    reportPhotoUrl,
    reportTarget,
    withoutPhoto,
    withoutReport,
  } from '../../lib/admin/image-reports';
  import { routeHref } from '../../lib/routing/routes';
  interface Props {
    app: AppController;
  }
  let { app }: Props = $props();
  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  /** The report whose Dismiss is running; one at a time. */
  let dismissing = $state<string | null>(null);
  /** The report whose photo the confirm dialog is about to delete. */
  let deleting = $state<ImageReport | null>(null);
  /** The report whose uploader the ban dialog is about to ban. */
  let banning = $state<ImageReport | null>(null);
  /** A failed request shows here; the app clears it with the next request, a page change or an account change. */
  let error = $derived(formErrorFor($appStore, 'image-reports'));
  let list = $state<HTMLElement>();

  const queue = createPagedList<ImageReport>({
    request: (page) => app.loadImageReports(page),
    key: reportIdOf,
    nextPage: nextReportPage,
  });

  async function dismiss(report: ImageReport) {
    if (dismissing) return;
    const current = queue.current();
    dismissing = report.id;
    const done = await app.dismissImageReport(report.id);
    if (!current()) return;
    dismissing = null;
    if (done) queue.rows = withoutReport(queue.rows, report.id);
  }

  async function deletePhoto(report: ImageReport) {
    const current = queue.current();
    const done = await app.deleteImage({
      id: report.imageId,
      url: `/api/images/${report.imageId}`,
    });
    if (done && current()) queue.rows = withoutPhoto(queue.rows, report.imageId);
    return done;
  }

  /** Bans the uploader of a reported photo: their photos go with the account, so the queue is read again (also after a refusal, to show what is true now). */
  async function ban(report: ImageReport, reason: string) {
    if (!report.uploaderId) return false;
    const current = queue.current();
    const done = await app.banUser(report.uploaderId, report.uploader ?? $t('account.deleted'), reason, false);
    if (!current()) return done;
    await queue.load(0);
    if (done) {
      await tick();
      list?.focus();
    }
    return done;
  }

  /** Who reads the queue: a primitive, so a reload of the same account keeps the rows. */
  let actor = $derived(user?.siteAdmin && online ? user.id : null);
  $effect(() => {
    dismissing = null;
    deleting = null;
    banning = null;
    queue.reset();
    if (actor) void queue.load(0);
    return () => {
      queue.invalidate();
    };
  });
</script>

<AdminBackLink siteAdmin={!!user?.siteAdmin} />
<PageHead
  eyebrow={$t('images.log.admin')}
  title={$t('images.reports.title')}
  description={$t('images.reports.body')} />
<AdminGate
  siteAdmin={!!user?.siteAdmin}
  {online}
  adminOnlyText={$t('images.reports.adminOnly')}
  offlineText={$t('images.reports.offline')}>
  {#if !queue.busy && !error && !queue.rows.length}
    <p class="empty-state">{$t('images.reports.empty')}</p>
  {/if}
  <RecordList
    class="image-reports"
    busy={queue.busy}
    focusable
    bind:element={list}>
    {#each queue.rows as row (row.id)}
      {@const photoUrl = reportPhotoUrl(row)}
      <Record class="image-reports__entry">
        <div class="image-reports__head">
          {#if photoUrl}
            <ImageView
              variant="thumbnail"
              src={photoUrl}
              userId={user?.id}
              alt={$t('images.reports.photoOf', { values: { title: row.title } })} />
          {/if}
          <div class="image-reports__item">
            <strong>{row.title}</strong>
            {#if !photoUrl}
              <span class="image-reports__note">{$t('images.reports.notShown')}</span>
            {/if}
          </div>
        </div>
        <RecordDetails>
          <RecordField label={$t('images.reports.reason')}>{row.reason ?? $t('images.reports.noReason')}</RecordField>
          <RecordField label={$t('images.reports.reporter')}>{row.reporter ?? $t('account.deleted')}</RecordField>
          <RecordField label={$t('images.reports.time')}><time datetime={row.createdAt}>{formatServerTime(row.createdAt, $locale ?? 'en')}</time></RecordField>
          <RecordField label={$t('images.reports.uploader')}>{row.uploader ?? $t('account.deleted')}</RecordField>
          <RecordField label={$t('images.log.image')}>{row.imageId}</RecordField>
          <RecordField label={$t('images.log.visibility')}>{$t(adminVisibilityKey(row.visibility))}</RecordField>
        </RecordDetails>
        <div class="button-row">
          <a
            class="button"
            href={routeHref(reportTarget(row))}>
            {$t('images.reports.open')}
          </a>
          <button
            type="button"
            class="button button--danger"
            data-picture-focus
            disabled={!!dismissing}
            onclick={() => (deleting = row)}>
            {$t('images.remove.confirm')}
          </button>
          <button
            type="button"
            class="button"
            disabled={!!dismissing}
            aria-busy={dismissing === row.id}
            onclick={() => void dismiss(row)}>
            {$t('images.reports.dismiss')}
          </button>
          {#if canBan(user, row.uploaderId)}
            <button
              type="button"
              class="button button--danger"
              disabled={!!dismissing}
              aria-label="{$t('ban.entry')}: {row.uploader}"
              onclick={() => (banning = row)}>
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
    retryLabel={$t('images.log.retry')}
    moreLabel={$t('images.log.more')}
    onLoad={() => void queue.load(queue.nextPage)} />
</AdminGate>

{#if deleting && user?.siteAdmin}
  {@const report = deleting}
  <RemoveImageDialog
    focusFallback={list}
    description={$t('images.reports.photoOf', { values: { title: report.title } })}
    {online}
    error={formErrorFor($appStore, 'image-remove')}
    onConfirm={() => deletePhoto(report)}
    onClose={() => {
      deleting = null;
      if (formErrorFor($appStore, 'image-remove')) app.clearFormError();
    }} />
{/if}

{#if banning && canBan(user, banning.uploaderId)}
  {@const report = banning}
  <BanUserDialog
    name={report.uploader ?? $t('account.deleted')}
    {online}
    error={formErrorFor($appStore, 'ban')}
    fallbackFocus={() => list?.focus()}
    onBan={(reason) => ban(report, reason)}
    onClose={() => (banning = null)} />
{/if}

<style>
  .image-reports__head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .image-reports__item {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .image-reports__note {
    color: var(--muted);
    font-size: var(--font-sm);
  }
</style>

<script lang="ts">
  import { formErrorFor } from '../../state/app/app-state';
  import { t, locale } from '../../lib/i18n';
  import type { ImageDeletion } from '../../lib/api/models';
  import type { AppController } from '../../state/app/app-controller';
  import PageHead from '../../components/ui/PageHead.svelte';
  import AdminBackLink from '../../components/admin/AdminBackLink.svelte';
  import AdminGate from '../../components/admin/AdminGate.svelte';
  import RecordList from '../../components/admin/RecordList.svelte';
  import Record from '../../components/admin/Record.svelte';
  import RecordDetails from '../../components/admin/RecordDetails.svelte';
  import RecordField from '../../components/admin/RecordField.svelte';
  import { createPagedList } from '../../state/admin/paged-list.svelte';
  import PageLoadControls from '../../components/admin/PageLoadControls.svelte';
  import { adminVisibilityKey, deletionItem, formatServerTime } from '../../lib/admin/image-reports';
  interface Props {
    app: AppController;
  }
  let { app }: Props = $props();
  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  /** A failed request shows here; the app clears it with the next request, a page change or an account change. */
  let error = $derived(formErrorFor($appStore, 'image-deletions'));
  const imageIdOf = (row: ImageDeletion) => row.imageId;

  const queue = createPagedList<ImageDeletion>({
    request: (page) => app.loadImageDeletions(page),
    key: imageIdOf,
  });

  let actor = $derived(user?.siteAdmin && online ? user.id : null);
  $effect(() => {
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
  title={$t('images.log.title')}
  description={$t('images.log.body')} />
<AdminGate
  siteAdmin={!!user?.siteAdmin}
  {online}
  adminOnlyText={$t('images.log.adminOnly')}
  offlineText={$t('images.log.offline')}>
  {#if !queue.busy && !error && !queue.rows.length}
    <p class="empty-state">{$t('images.log.empty')}</p>
  {/if}
  <RecordList busy={queue.busy}>
    {#each queue.rows as row (row.imageId)}
      {@const item = deletionItem(row)}
      <Record>
        <strong>{row.title}</strong>
        <RecordDetails>
          <RecordField label={$t('images.log.image')}>{row.imageId}</RecordField>
          {#if item}
            <RecordField label={$t(item.label)}>{item.id}</RecordField>
          {/if}
          <RecordField label={$t('images.log.visibility')}>{$t(adminVisibilityKey(row.visibility))}</RecordField>
          <RecordField label={$t('images.log.uploader')}>{row.uploaderId ?? $t('images.log.anonymous')}</RecordField>
          <RecordField label={$t('images.log.deletedBy')}>{row.deletedBy ?? $t('images.log.anonymous')}</RecordField>
          <RecordField label={$t('images.log.time')}><time datetime={row.deletedAt}>{formatServerTime(row.deletedAt, $locale ?? 'en')}</time></RecordField>
        </RecordDetails>
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

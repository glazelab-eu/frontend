<script lang="ts">
  import { tick } from 'svelte';
  import { formErrorFor } from '../../state/app/app-state';
  import { t, locale } from '../../lib/i18n';
  import type { FeedbackEntry, FeedbackPhoto } from '../../lib/api/models';
  import type { AppController } from '../../state/app/app-controller';
  import PageHead from '../../components/ui/PageHead.svelte';
  import ModalShell from '../../components/ui/ModalShell.svelte';
  import AdminBackLink from '../../components/admin/AdminBackLink.svelte';
  import AdminGate from '../../components/admin/AdminGate.svelte';
  import RecordList from '../../components/admin/RecordList.svelte';
  import Record from '../../components/admin/Record.svelte';
  import RecordDetails from '../../components/admin/RecordDetails.svelte';
  import RecordField from '../../components/admin/RecordField.svelte';
  import ConfirmDialog from '../../components/common/ConfirmDialog.svelte';
  import PageLoadControls from '../../components/admin/PageLoadControls.svelte';
  import { createPagedList } from '../../state/admin/paged-list.svelte';
  import { formatServerTime, nextReportPage } from '../../lib/admin/image-reports';
  import { deviceKey } from '../../lib/feedback/feedback';
  import { FEEDBACK_FILTERS, FEEDBACK_RETENTION_DAYS, feedbackFilterKey, feedbackPhotoUrl, filterStatus, type FeedbackFilter } from '../../lib/admin/feedback';

  interface Props {
    app: AppController;
  }
  let { app }: Props = $props();
  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  let filter = $state<FeedbackFilter>('OPEN');
  /** Every open feedback (not only the shown page's), from the last answer. */
  let openCount = $state<number | null>(null);
  let working = $state<string | null>(null);
  let deleting = $state<FeedbackEntry | null>(null);
  /** The photo shown large, with the feedback it belongs to. */
  let viewing = $state<{ entry: FeedbackEntry; photo: FeedbackPhoto; index: number } | null>(null);
  let viewOpener: HTMLElement | null = null;
  let error = $derived(formErrorFor($appStore, 'admin-feedback'));
  let changeError = $derived(formErrorFor($appStore, 'admin-feedback-change'));
  let list = $state<HTMLElement>();

  const queue = createPagedList<FeedbackEntry>({
    request: async (page) => {
      const answer = await app.loadFeedback(page, filterStatus(filter));
      if (answer) openCount = answer.open;
      return answer;
    },
    key: (entry) => entry.id,
    nextPage: nextReportPage,
  });

  /** A mark or a deletion changes what the filter shows: the list is read again from the first page, and the focus returns to it. */
  async function change(entry: FeedbackEntry, action: () => Promise<boolean>) {
    if (working) return;
    const current = queue.current();
    working = entry.id;
    await action();
    if (!current()) return;
    working = null;
    deleting = null;
    await queue.load(0);
    await tick();
    list?.focus();
  }

  function view(entry: FeedbackEntry, photo: FeedbackPhoto, index: number, event: MouseEvent) {
    viewOpener = event.currentTarget as HTMLElement;
    viewing = { entry, photo, index };
  }

  let actor = $derived(user?.siteAdmin && online ? user.id : null);
  $effect(() => {
    void filter;
    deleting = null;
    viewing = null;
    working = null;
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
  title={$t('feedbackAdmin.title')}
  description={$t('feedbackAdmin.body', { values: { days: FEEDBACK_RETENTION_DAYS } })} />
<AdminGate
  siteAdmin={!!user?.siteAdmin}
  {online}
  adminOnlyText={$t('feedbackAdmin.adminOnly')}
  offlineText={$t('feedbackAdmin.offline')}>
  <div class="feedback-admin__bar">
    <label class="feedback-admin__filter">
      {$t('feedbackAdmin.filter')}
      <select
        class="form-field__control"
        bind:value={filter}>
        {#each FEEDBACK_FILTERS as value (value)}
          <option {value}>{$t(feedbackFilterKey(value))}</option>
        {/each}
      </select>
    </label>
    {#if openCount !== null}
      <p
        class="feedback-admin__count"
        role="status">
        {$t('feedbackAdmin.openCount', { values: { count: openCount } })}
      </p>
    {/if}
  </div>
  {#if queue.loaded && !queue.busy && !error && !queue.rows.length}
    <p class="empty-state">{filter === 'OPEN' ? $t('feedbackAdmin.empty') : $t('feedbackAdmin.emptyFiltered')}</p>
  {/if}
  <RecordList
    class="feedback-admin"
    busy={queue.busy}
    focusable
    bind:element={list}>
    {#each queue.rows as entry (entry.id)}
      {@const date = formatServerTime(entry.createdAt, $locale ?? 'en')}
      <Record class="feedback-admin__entry">
        <p class="feedback-admin__message">{entry.message}</p>
        {#if entry.photos.length}
          <ul class="feedback-admin__photos">
            {#each entry.photos as photo, index (photo.id)}
              <li>
                <button
                  type="button"
                  class="feedback-admin__thumb"
                  aria-label={$t('feedbackAdmin.openPhoto', { values: { number: index + 1, name: entry.sender } })}
                  onclick={(event) => view(entry, photo, index, event)}>
                  <!-- no-store answers: no browser, Cache Storage or service-worker copy; never through the offline image cache. -->
                  <img
                    class="feedback-admin__thumb-image"
                    src={feedbackPhotoUrl(photo, 'card')}
                    alt=""
                    loading="lazy" />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        <RecordDetails>
          <RecordField label={$t('feedbackAdmin.sender')}>{entry.sender}</RecordField>
          <RecordField label={$t('feedbackAdmin.date')}><time datetime={entry.createdAt}>{date}</time></RecordField>
          <RecordField label={$t('feedbackAdmin.status')}>
            {entry.status === 'DONE' && entry.doneAt
              ? $t('feedbackAdmin.doneAt', { values: { date: formatServerTime(entry.doneAt, $locale ?? 'en') } })
              : $t('feedbackAdmin.statusOpen')}
          </RecordField>
          {#if entry.route}
            <RecordField label={$t('feedback.context.page')}>{entry.route}</RecordField>
          {/if}
          {#if entry.build}
            <RecordField label={$t('feedback.context.version')}>{entry.build}</RecordField>
          {/if}
          {#if entry.language}
            <RecordField label={$t('feedback.context.language')}>{entry.language}</RecordField>
          {/if}
          {#if entry.device}
            <RecordField label={$t('feedback.context.device')}>{$t(deviceKey(entry.device))}</RecordField>
          {/if}
          {#if !entry.route && !entry.build && !entry.language && !entry.device}
            <RecordField label={$t('feedbackAdmin.context')}>{$t('feedbackAdmin.noContext')}</RecordField>
          {/if}
        </RecordDetails>
        <div class="button-row">
          <button
            type="button"
            class="button"
            disabled={!!working}
            aria-label="{entry.status === 'DONE' ? $t('feedbackAdmin.reopen') : $t('feedbackAdmin.markDone')}: {entry.sender}, {date}"
            onclick={() => void change(entry, () => app.markFeedback(entry.id, entry.status === 'DONE' ? 'OPEN' : 'DONE'))}>
            {entry.status === 'DONE' ? $t('feedbackAdmin.reopen') : $t('feedbackAdmin.markDone')}
          </button>
          <button
            type="button"
            class="button button--danger"
            disabled={!!working}
            aria-label="{$t('feedbackAdmin.delete')}: {entry.sender}, {date}"
            onclick={() => (deleting = entry)}>
            {$t('feedbackAdmin.delete')}
          </button>
        </div>
      </Record>
    {/each}
  </RecordList>
  <PageLoadControls
    busy={queue.busy}
    failed={queue.loadFailed}
    hasMore={queue.hasMore}
    error={error || changeError}
    retryLabel={$t('feedbackAdmin.retry')}
    moreLabel={$t('feedbackAdmin.more')}
    onLoad={() => void queue.load(queue.nextPage)} />
</AdminGate>

{#if deleting && user?.siteAdmin}
  {@const entry = deleting}
  <ConfirmDialog
    title={$t('feedbackAdmin.delete.title')}
    confirmLabel={$t('feedbackAdmin.delete')}
    {online}
    busy={working === entry.id}
    fallbackFocus={() => list?.focus()}
    onConfirm={() => void change(entry, () => app.deleteFeedback(entry.id))}
    onCancel={() => (deleting = null)}>
    <p>{$t('feedbackAdmin.delete.body', { values: { name: entry.sender } })}</p>
  </ConfirmDialog>
{/if}

{#if viewing}
  {@const shown = viewing}
  <ModalShell
    ariaLabel={$t('feedbackAdmin.photoTitle', { values: { number: shown.index + 1, name: shown.entry.sender } })}
    viewer
    fallbackFocus={() => (viewOpener?.isConnected ? viewOpener.focus() : list?.focus())}
    onClose={() => (viewing = null)}>
    <img
      class="feedback-admin__full"
      src={feedbackPhotoUrl(shown.photo, 'full')}
      width={shown.photo.width}
      height={shown.photo.height}
      alt={$t('feedbackAdmin.photoTitle', { values: { number: shown.index + 1, name: shown.entry.sender } })} />
  </ModalShell>
{/if}

<style>
  .feedback-admin__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-3) var(--space-5);
    margin-bottom: var(--space-4);
  }
  .feedback-admin__filter {
    display: grid;
    gap: var(--space-1);
    font-weight: 600;
  }
  .feedback-admin__count {
    margin: 0;
    color: var(--muted);
  }
  .feedback-admin__message {
    margin: 0 0 var(--space-3);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .feedback-admin__photos {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    padding: 0;
    list-style: none;
  }
  .feedback-admin__thumb {
    display: block;
    padding: 0;
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--canvas);
    cursor: zoom-in;
  }
  .feedback-admin__thumb-image {
    display: block;
    width: 6rem;
    height: 6rem;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }
  .feedback-admin__full {
    display: block;
    max-width: 100%;
    max-height: calc(100svh - 6rem);
    width: auto;
    height: auto;
    margin: auto;
    object-fit: contain;
  }
</style>

<script lang="ts">
  import { tick } from 'svelte';
  import { formErrorFor } from '../../state/app/app-state';
  import { t, locale } from '../../lib/i18n';
  import type { ReportGroup, ReportOccurrence } from '../../lib/api/models';
  import type { AppController } from '../../state/app/app-controller';
  import PageHead from '../../components/ui/PageHead.svelte';
  import AdminBackLink from '../../components/admin/AdminBackLink.svelte';
  import AdminGate from '../../components/admin/AdminGate.svelte';
  import RecordList from '../../components/admin/RecordList.svelte';
  import Record from '../../components/admin/Record.svelte';
  import RecordDetails from '../../components/admin/RecordDetails.svelte';
  import RecordField from '../../components/admin/RecordField.svelte';
  import ConfirmDialog from '../../components/common/ConfirmDialog.svelte';
  import { createPagedList } from '../../state/admin/paged-list.svelte';
  import PageLoadControls from '../../components/admin/PageLoadControls.svelte';
  import { formatServerTime, nextReportPage } from '../../lib/admin/image-reports';
  import {
    MAX_REPORT_SEARCH,
    NO_REPORT_FILTER,
    REPORT_KINDS,
    REPORT_RETENTION_DAYS,
    deviceFacts,
    deviceName,
    excerpt,
    filterQuery,
    groupIdOf,
    isFiltered,
    kindKey,
    nextOccurrencePage,
    occurrenceIdOf,
    viewportRange,
    withoutGroup,
    withoutOccurrence,
    type ReportFilter,
  } from '../../lib/admin/error-reports';

  interface Props {
    app: AppController;
  }
  let { app }: Props = $props();
  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  /** The filters in force; the search text is typed into `search` and applied with the form. */
  let filter = $state<ReportFilter>({ ...NO_REPORT_FILTER });
  let search = $state('');
  let builds = $state<string[]>([]);
  /** The message whose reports are open (one at a time) and its reports. */
  let openGroup = $state<string | null>(null);
  /** What the confirmation dialog is about to delete. */
  let deleting = $state<{ group: ReportGroup } | { group: ReportGroup; report: ReportOccurrence } | null>(null);
  let working = $state(false);
  let error = $derived(formErrorFor($appStore, 'error-reports'));
  let deleteError = $derived(formErrorFor($appStore, 'error-report-delete'));
  let list = $state<HTMLElement>();

  let buildOptions = $derived(filter.build && !builds.includes(filter.build) ? [filter.build, ...builds] : builds);

  const messages = createPagedList<ReportGroup>({
    request: async (page) => {
      const result = await app.loadErrorReportGroups(page, filterQuery(filter));
      return result && { entries: result.groups, hasMore: result.hasMore };
    },
    key: groupIdOf,
    nextPage: nextReportPage,
  });
  const occurrences = createPagedList<ReportOccurrence>({
    request: async (page) => {
      if (!openGroup) return null;
      const result = await app.loadErrorReportOccurrences(openGroup, page);
      return result && { entries: result.occurrences, hasMore: result.hasMore };
    },
    key: occurrenceIdOf,
    nextPage: nextOccurrencePage,
  });

  function toggle(group: ReportGroup) {
    occurrences.reset();
    if (openGroup === group.fingerprint) {
      openGroup = null;
      return;
    }
    openGroup = group.fingerprint;
    void occurrences.load(0);
  }

  function applySearch(event: SubmitEvent) {
    event.preventDefault();
    filter = { ...filter, q: search };
  }

  function clear() {
    search = '';
    filter = { ...NO_REPORT_FILTER };
  }

  async function confirmDelete() {
    const target = deleting;
    if (!target || working) return;
    const current = messages.current();
    working = true;
    const single = 'report' in target ? target.report : null;
    const done = await app.deleteErrorReports(single ? { id: single.id } : { fingerprint: target.group.fingerprint });
    if (!current()) return;
    working = false;
    deleting = null;
    if (!done) {
      // Gone meanwhile (404) or failed: the lists show what is true now.
      await messages.load(0);
      if (openGroup) await occurrences.load(0);
    } else if (single) {
      occurrences.rows = withoutOccurrence(occurrences.rows, single.id);
      const left = target.group.reports - 1;
      messages.rows =
        left > 0
          ? messages.rows.map((group) =>
              group.fingerprint === target.group.fingerprint ? { ...group, reports: left, occurrences: group.occurrences - single.occurrences } : group,
            )
          : withoutGroup(messages.rows, target.group.fingerprint);
      if (left <= 0) openGroup = null;
    } else {
      messages.rows = withoutGroup(messages.rows, target.group.fingerprint);
      if (openGroup === target.group.fingerprint) openGroup = null;
    }
    await tick();
    list?.focus();
  }

  /** Who reads the reports: a primitive, so a reload of the same account keeps the rows. */
  let actor = $derived(user?.siteAdmin && online ? user.id : null);
  $effect(() => {
    if (!actor) return;
    void app.loadErrorReportBuilds().then((result) => {
      if (result) builds = result.builds;
    });
  });
  $effect(() => {
    const applied = filterQuery(filter);
    void applied.kind;
    void applied.build;
    void applied.q;
    openGroup = null;
    deleting = null;
    working = false;
    occurrences.reset();
    messages.reset();
    if (actor) void messages.load(0);
    return () => {
      messages.invalidate();
      occurrences.invalidate();
    };
  });
  const count = (group: ReportGroup) => ({ reports: group.reports });
</script>

<AdminBackLink siteAdmin={!!user?.siteAdmin} />
<PageHead
  eyebrow={$t('images.log.admin')}
  title={$t('errorReports.title')}
  description={$t('errorReports.body', { values: { days: REPORT_RETENTION_DAYS } })} />
<AdminGate
  siteAdmin={!!user?.siteAdmin}
  {online}
  adminOnlyText={$t('errorReports.adminOnly')}
  offlineText={$t('errorReports.offline')}>
  <form
    class="error-reports__filters"
    aria-label={$t('errorReports.filters')}
    onsubmit={applySearch}>
    <label class="error-reports__field">
      {$t('errorReports.filter.kind')}
      <select
        class="form-field__control"
        bind:value={filter.kind}>
        <option value="">{$t('errorReports.filter.kindAll')}</option>
        {#each REPORT_KINDS as kind (kind)}
          <option value={kind}>{$t(kindKey(kind))}</option>
        {/each}
      </select>
    </label>
    <label class="error-reports__field">
      {$t('errorReports.filter.build')}
      <select
        class="form-field__control"
        bind:value={filter.build}>
        <option value="">{$t('errorReports.filter.buildAll')}</option>
        {#each buildOptions as build (build)}
          <option value={build}>{build}</option>
        {/each}
      </select>
    </label>
    <label class="error-reports__field error-reports__field--search">
      {$t('errorReports.filter.search')}
      <input
        class="form-field__control"
        type="search"
        maxlength={MAX_REPORT_SEARCH}
        bind:value={search} />
    </label>
    <div class="button-row">
      <button
        type="submit"
        class="button">
        {$t('errorReports.filter.apply')}
      </button>
      {#if isFiltered(filter) || search}
        <button
          type="button"
          class="button"
          onclick={clear}>
          {$t('errorReports.filter.clear')}
        </button>
      {/if}
    </div>
  </form>
  {#if messages.loaded && !messages.busy && !error && !messages.rows.length}
    <p class="empty-state">{isFiltered(filter) ? $t('errorReports.emptyFiltered') : $t('errorReports.empty')}</p>
  {/if}
  <RecordList
    class="error-reports"
    busy={messages.busy}
    focusable
    bind:element={list}>
    {#each messages.rows as group (group.fingerprint)}
      {@const open = openGroup === group.fingerprint}
      {@const range = viewportRange(group)}
      {@const short = excerpt(group.message)}
      <Record class="error-reports__entry">
        <h2 class="error-reports__message">{group.message}</h2>
        <p class="error-reports__kind">{$t(kindKey(group.kind))}</p>
        <RecordDetails>
          <RecordField label={$t('errorReports.group.reports')}>{group.reports}</RecordField>
          <RecordField label={$t('errorReports.group.times')}>{group.occurrences}</RecordField>
          <RecordField label={$t('errorReports.group.last')}>
            <time datetime={group.lastSeen}>{formatServerTime(group.lastSeen, $locale ?? 'en')}</time>
          </RecordField>
          <RecordField label={$t('errorReports.group.first')}>
            <time datetime={group.firstSeen}>{formatServerTime(group.firstSeen, $locale ?? 'en')}</time>
          </RecordField>
          <RecordField label={$t('errorReports.group.builds')}>
            {#each group.builds as item, index (item.build)}{#if index};
              {/if}{$t('errorReports.group.build', {
                values: { build: item.build, count: item.reports },
              })}{/each}
          </RecordField>
          {#if group.devices.length}
            <RecordField label={$t('errorReports.group.devices')}>
              {#each group.devices as item, index (index)}
                {@const name = deviceName(item)}
                {#if index};
                {/if}{$t('errorReports.group.device', {
                  values: { browser: name.browser ?? $t('errorReports.group.unknown'), os: name.os ?? $t('errorReports.group.unknown'), count: item.reports },
                })}
              {/each}
            </RecordField>
          {/if}
          {#if range}
            <RecordField label={$t('errorReports.group.viewport')}>
              {range.min === range.max
                ? $t('errorReports.group.viewportOne', { values: { min: range.min } })
                : $t('errorReports.group.viewportRange', { values: { min: range.min, max: range.max } })}
            </RecordField>
          {/if}
        </RecordDetails>
        <div class="button-row">
          <button
            type="button"
            class="button"
            aria-expanded={open}
            aria-controls="error-reports-{group.fingerprint}"
            aria-label="{open ? $t('errorReports.details.hide') : $t('errorReports.details.show')}: {short}"
            onclick={() => toggle(group)}>
            {open ? $t('errorReports.details.hide') : $t('errorReports.details.show')}
          </button>
          <button
            type="button"
            class="button"
            disabled={working}
            aria-label="{$t('errorReports.deleteGroup')}: {short}"
            onclick={() => (deleting = { group })}>
            {$t('errorReports.deleteGroup')}
          </button>
        </div>
        {#if open}
          <section
            class="error-reports__open"
            id="error-reports-{group.fingerprint}"
            aria-busy={occurrences.busy}
            aria-labelledby="error-reports-{group.fingerprint}-title">
            <h3 id="error-reports-{group.fingerprint}-title">{$t('errorReports.details.title')}</h3>
            {#if occurrences.busy && !occurrences.rows.length}
              <p>{$t('errorReports.details.loading')}</p>
            {:else if occurrences.loaded && !occurrences.rows.length}
              <p>{$t('errorReports.details.empty')}</p>
            {/if}
            <ul class="error-reports__rows">
              {#each occurrences.rows as row (row.id)}
                {@const facts = deviceFacts(row.device)}
                <li class="error-reports__row">
                  <RecordDetails>
                    <RecordField label={$t('errorReports.details.received')}>
                      <time datetime={row.receivedAt}>{formatServerTime(row.receivedAt, $locale ?? 'en')}</time>
                    </RecordField>
                    <RecordField label={$t('errorReports.details.occurred')}>
                      <time datetime={row.occurredAt}>{formatServerTime(row.occurredAt, $locale ?? 'en')}</time>
                    </RecordField>
                    <RecordField label={$t('errorReports.details.repeats')}>{row.occurrences}</RecordField>
                    <RecordField label={$t('errorReports.details.build')}>{row.build}</RecordField>
                    {#if row.route}
                      <RecordField label={$t('errorReports.details.route')}>{row.route}</RecordField>
                    {/if}
                  </RecordDetails>
                  <h4>{$t('errorReports.details.stack')}</h4>
                  {#if row.stack}
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                    <pre
                      class="error-reports__stack"
                      tabindex="0">{row.stack}</pre>
                  {:else}
                    <p>{$t('errorReports.details.noStack')}</p>
                  {/if}
                  <h4>{$t('errorReports.details.device')}</h4>
                  {#if facts.length}
                    <RecordDetails>
                      {#each facts as fact (fact.label)}
                        <RecordField label={$t(fact.label)}>{fact.key ? $t(fact.key) : fact.text}</RecordField>
                      {/each}
                    </RecordDetails>
                  {:else}
                    <p>{$t('errorReports.details.noDevice')}</p>
                  {/if}
                  <div class="button-row">
                    <button
                      type="button"
                      class="button"
                      disabled={working}
                      aria-label="{$t('errorReports.deleteOne')}: {formatServerTime(row.receivedAt, $locale ?? 'en')}"
                      onclick={() => (deleting = { group, report: row })}>
                      {$t('errorReports.deleteOne')}
                    </button>
                  </div>
                </li>
              {/each}
            </ul>
            <PageLoadControls
              busy={occurrences.busy}
              failed={occurrences.loadFailed}
              hasMore={occurrences.hasMore}
              retryLabel={$t('errorReports.retry')}
              moreLabel={$t('errorReports.more')}
              onLoad={() => void occurrences.load(occurrences.nextPage)} />
          </section>
        {/if}
      </Record>
    {/each}
  </RecordList>
  <PageLoadControls
    busy={messages.busy}
    failed={messages.loadFailed}
    hasMore={messages.hasMore}
    error={error || deleteError}
    retryLabel={$t('errorReports.retry')}
    moreLabel={$t('errorReports.more')}
    onLoad={() => void messages.load(messages.nextPage)} />
</AdminGate>

{#if deleting && user?.siteAdmin}
  {@const target = deleting}
  {@const single = 'report' in target}
  {@const title = single ? $t('errorReports.deleteOne.title') : $t('errorReports.deleteGroup.title')}
  <ConfirmDialog
    {title}
    confirmLabel={single ? $t('errorReports.deleteOne') : $t('errorReports.deleteGroup')}
    {online}
    busy={working}
    fallbackFocus={() => list?.focus()}
    onConfirm={() => void confirmDelete()}
    onCancel={() => (deleting = null)}>
    <p class="error-reports__quote">{excerpt(target.group.message, 200)}</p>
    <p>{single ? $t('errorReports.deleteOne.body') : $t('errorReports.deleteGroup.body', { values: count(target.group) })}</p>
  </ConfirmDialog>
{/if}

<style>
  .error-reports__filters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
    gap: var(--space-3);
    align-items: end;
    margin-bottom: var(--space-4);
  }
  .error-reports__field {
    display: grid;
    gap: var(--space-1);
    font-weight: 600;
  }
  .error-reports__message {
    font-size: var(--font-md, 1rem);
    margin: 0;
    white-space: pre-wrap;
  }
  .error-reports__kind {
    margin: 0;
    font-size: var(--font-sm);
    font-weight: 600;
  }
  .error-reports__open {
    display: grid;
    gap: var(--space-3);
    border-top: 0.0625rem solid var(--border);
    padding-top: var(--space-3);
  }
  .error-reports__rows {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  .error-reports__row {
    display: grid;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: 0.0625rem solid var(--border);
  }
  .error-reports__stack {
    margin: 0;
    padding: var(--space-2);
    background: var(--surface-muted, var(--surface));
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-sm, 0.25rem);
    font-size: var(--font-sm);
    max-height: 16rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .error-reports__quote {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: var(--font-sm);
  }
</style>

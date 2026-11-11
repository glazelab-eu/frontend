<script lang="ts">
  import { tick } from 'svelte';
  import { formErrorFor } from '../../state/app/app-state';
  import { t, locale } from '../../lib/i18n';
  import type { Ban } from '../../lib/api/models';
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
  import { banIdOf, withoutBan } from '../../lib/admin/bans';
  import { formatServerTime, nextReportPage } from '../../lib/admin/image-reports';

  interface Props {
    app: AppController;
  }
  let { app }: Props = $props();
  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  /** The ban the confirmation dialog is about to lift. */
  let lifting = $state<Ban | null>(null);
  let working = $state(false);
  let error = $derived(formErrorFor($appStore, 'bans'));
  /** Why the last "Lift ban" failed; separate from the list's own error, which reading the list again would clear. */
  let liftError = $derived(formErrorFor($appStore, 'unban'));
  let list = $state<HTMLElement>();

  const queue = createPagedList<Ban>({
    request: (page) => app.loadBans(page),
    key: banIdOf,
    nextPage: nextReportPage,
  });

  async function lift(ban: Ban) {
    if (working) return;
    const current = queue.current();
    working = true;
    const done = await app.unbanUser(ban.id);
    if (!current()) return;
    working = false;
    lifting = null;
    // A ban that was lifted meanwhile (404) shows its message and the list shows what is true now.
    if (done) queue.rows = withoutBan(queue.rows, ban.id);
    else await queue.load(0);
    await tick();
    list?.focus();
  }

  /** Who reads the list: a primitive, so a reload of the same account keeps the rows. */
  let actor = $derived(user?.siteAdmin && online ? user.id : null);
  $effect(() => {
    lifting = null;
    working = false;
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
  title={$t('bans.title')}
  description={$t('bans.body')} />
<AdminGate
  siteAdmin={!!user?.siteAdmin}
  {online}
  adminOnlyText={$t('bans.adminOnly')}
  offlineText={$t('bans.offline')}>
  {#if queue.loaded && !queue.busy && !error && !liftError && !queue.rows.length}
    <p class="empty-state">{$t('bans.empty')}</p>
  {/if}
  <RecordList
    class="bans"
    busy={queue.busy}
    focusable
    bind:element={list}>
    <!-- An entry names nobody (34-7): the date and the reason are all the service keeps besides the address's pseudonymous fingerprint. -->
    {#each queue.rows as row (row.id)}
      {@const date = formatServerTime(row.bannedAt, $locale ?? 'en')}
      <Record class="bans__entry">
        <RecordDetails>
          <RecordField label={$t('bans.date')}><time datetime={row.bannedAt}>{date}</time></RecordField>
          <RecordField label={$t('bans.reason')}><span class="bans__reason">{row.reason}</span></RecordField>
        </RecordDetails>
        <div class="button-row">
          <button
            type="button"
            class="button"
            disabled={working}
            aria-label="{$t('bans.lift')}: {date}"
            onclick={() => (lifting = row)}>
            {$t('bans.lift')}
          </button>
        </div>
      </Record>
    {/each}
  </RecordList>
  <PageLoadControls
    busy={queue.busy}
    failed={queue.loadFailed}
    hasMore={queue.hasMore}
    error={error || liftError}
    retryLabel={$t('bans.retry')}
    moreLabel={$t('bans.more')}
    onLoad={() => void queue.load(queue.nextPage)} />
</AdminGate>

{#if lifting && user?.siteAdmin}
  {@const ban = lifting}
  {@const title = $t('bans.lift.title')}
  <ConfirmDialog
    {title}
    confirmLabel={$t('bans.lift')}
    danger={false}
    {online}
    busy={working}
    fallbackFocus={() => list?.focus()}
    onConfirm={() => void lift(ban)}
    onCancel={() => (lifting = null)}>
    <!-- The entry by its date and reason, the only things it keeps (one text node: no space before the colon). -->
    <p class="bans__reason">{`${formatServerTime(ban.bannedAt, $locale ?? 'en')}: ${ban.reason}`}</p>
    <p>{$t('bans.lift.body')}</p>
  </ConfirmDialog>
{/if}

<style>
  .bans__reason {
    white-space: pre-wrap;
  }
</style>

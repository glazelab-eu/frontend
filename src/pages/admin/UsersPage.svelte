<script lang="ts">
  import { formErrorFor } from '../../state/app/app-state';
  import { locale, t } from '../../lib/i18n';
  import type { AdminUser } from '../../lib/api/models';
  import type { AppController } from '../../state/app/app-controller';
  import PageHead from '../../components/ui/PageHead.svelte';
  import AdminBackLink from '../../components/admin/AdminBackLink.svelte';
  import AdminGate from '../../components/admin/AdminGate.svelte';
  import { createPagedList } from '../../state/admin/paged-list.svelte';
  import PageLoadControls from '../../components/admin/PageLoadControls.svelte';
  import { accountStatusKey, formatCreatedOn, MAX_USER_SEARCH, userIdOf, userSearchText } from '../../lib/admin/users';

  interface Props {
    app: AppController;
  }
  let { app }: Props = $props();
  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  let error = $derived(formErrorFor($appStore, 'users'));
  let lang = $derived($locale ?? 'en');
  /** The text typed into the field, and the search in force (applied with the form: no request per keystroke). */
  let typed = $state('');
  let applied = $state('');

  /** Read-only: the API answers the next page by number, and an account is never changed from here. */
  const accounts = createPagedList<AdminUser>({
    request: (page) => app.loadUsers(page, applied),
    key: userIdOf,
  });

  /** Who reads the list: a primitive, so a reload of the same account keeps the rows. */
  let actor = $derived(user?.siteAdmin && online ? user.id : null);
  $effect(() => {
    void applied;
    accounts.reset();
    if (actor) void accounts.load(0);
    return () => {
      accounts.invalidate();
    };
  });

  function search(event: SubmitEvent) {
    event.preventDefault();
    applied = userSearchText(typed);
  }

  function clear() {
    typed = '';
    applied = '';
  }
</script>

<AdminBackLink siteAdmin={!!user?.siteAdmin} />
<PageHead
  eyebrow={$t('images.log.admin')}
  title={$t('users.title')}
  description={$t('users.body')} />
<AdminGate
  siteAdmin={!!user?.siteAdmin}
  {online}
  adminOnlyText={$t('users.adminOnly')}
  offlineText={$t('users.offline')}>
  <form
    class="users__search"
    role="search"
    aria-label={$t('users.searchForm')}
    onsubmit={search}>
    <label class="users__field">
      {$t('users.search')}
      <input
        class="form-field__control"
        type="search"
        maxlength={MAX_USER_SEARCH}
        bind:value={typed} />
    </label>
    <div class="button-row">
      <button
        type="submit"
        class="button">
        {$t('users.searchButton')}
      </button>
      {#if applied || typed}
        <button
          type="button"
          class="button"
          onclick={clear}>
          {$t('users.searchClear')}
        </button>
      {/if}
    </div>
  </form>
  {#if accounts.loaded && !accounts.busy && !error && !accounts.rows.length}
    <p class="empty-state">{applied ? $t('users.emptySearch') : $t('users.empty')}</p>
  {/if}
  <ul
    class="users"
    aria-label={$t('users.list')}
    aria-busy={accounts.busy}>
    {#each accounts.rows as row (row.id)}
      <li class="users__entry">
        <span class="users__who">
          <span class="users__name">{row.displayName}</span>
          <span class="users__email">{row.email}</span>
          {#if row.createdAt}<span class="users__email users__created">
              {$t('users.created', { values: { date: formatCreatedOn(row.createdAt, lang) } })}
            </span>{/if}
        </span>
        <span class="users__facts">
          <span class="users__badge users__badge--{row.status.toLowerCase()}">{$t(accountStatusKey(row.status))}</span>
          {#if row.siteAdmin}<span class="users__badge users__badge--admin">{$t('users.admin')}</span>{/if}
        </span>
      </li>
    {/each}
  </ul>
  <PageLoadControls
    busy={accounts.busy}
    failed={accounts.loadFailed}
    hasMore={accounts.hasMore}
    {error}
    retryLabel={$t('users.retry')}
    moreLabel={$t('users.more')}
    onLoad={() => void accounts.load(accounts.nextPage)} />
</AdminGate>

<style>
  .users__search {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: end;
    margin-bottom: var(--space-4);
  }
  .users__field {
    display: grid;
    gap: var(--space-1);
    font-weight: 600;
    flex: 1 1 14rem;
    max-width: 30rem;
  }
  .users {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .users__entry {
    background: var(--surface);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    overflow-wrap: anywhere;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .users__who {
    display: grid;
    min-width: 0;
  }
  .users__name {
    font-weight: 700;
  }
  .users__email {
    font-size: var(--font-sm);
  }
  .users__facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: var(--font-sm);
  }
  .users__badge {
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    padding: 0 var(--space-2);
  }
  .users__badge--admin {
    color: var(--accent);
    border-color: currentColor;
  }
</style>

<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { MessageKey } from '../../lib/i18n/messages';
  import { routeHref, type AdminPageName } from '../../lib/routing/routes';
  import type { AppController } from '../../state/app/app-controller';
  import PageHead from '../../components/ui/PageHead.svelte';
  import AdminGate from '../../components/admin/AdminGate.svelte';

  interface Props {
    app: AppController;
  }
  let { app }: Props = $props();
  let appStore = $derived(app.state);
  let user = $derived($appStore.user);

  /** The admin pages: the title of each page and one sentence of what it is for. */
  const pages: readonly { name: AdminPageName; title: MessageKey; about: MessageKey }[] = [
    { name: 'image-reports', title: 'images.reports.title', about: 'admin.imageReports.about' },
    { name: 'avatar-reports', title: 'avatars.reports.title', about: 'admin.avatarReports.about' },
    { name: 'image-deletions', title: 'images.log.title', about: 'admin.imageDeletions.about' },
    { name: 'bans', title: 'bans.title', about: 'admin.bans.about' },
    { name: 'error-reports', title: 'errorReports.title', about: 'admin.errorReports.about' },
    { name: 'users', title: 'users.title', about: 'admin.users.about' },
    { name: 'feedback', title: 'feedbackAdmin.title', about: 'admin.feedback.about' },
  ];
</script>

<PageHead
  eyebrow={$t('images.log.admin')}
  title={$t('admin.title')}
  description={$t('admin.body')} />
<AdminGate
  siteAdmin={!!user?.siteAdmin}
  adminOnlyText={$t('admin.adminOnly')}>
  <ul class="admin-pages">
    {#each pages as page (page.name)}
      <li class="admin-pages__item">
        <a
          class="admin-pages__link"
          href={routeHref({ name: page.name })}>
          <span class="admin-pages__title">{$t(page.title)}</span>
          <span class="admin-pages__about">{$t(page.about)}</span>
        </a>
      </li>
    {/each}
  </ul>
</AdminGate>

<style>
  .admin-pages {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .admin-pages__link {
    display: grid;
    gap: var(--space-1);
    height: 100%;
    box-sizing: border-box;
    min-height: var(--touch-target);
    padding: var(--space-4);
    background: var(--surface);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    color: inherit;
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .admin-pages__title {
    color: var(--accent);
    font-weight: 700;
  }
  .admin-pages__about {
    font-size: var(--font-sm);
  }
</style>

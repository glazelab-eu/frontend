<script lang="ts">
  import { t } from '../../lib/i18n';
  import { routeHref } from '../../lib/routing/routes';
  import BackLink from '../ui/BackLink.svelte';

  /** Only site admins get the way back: the landing page is theirs, and a guest's guard text names nothing. */
  let { siteAdmin }: { siteAdmin: boolean } = $props();
</script>

{#if siteAdmin}
  <BackLink
    href={routeHref({ name: 'admin' })}
    label={$t('admin.title')} />
{/if}

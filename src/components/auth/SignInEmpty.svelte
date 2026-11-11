<script lang="ts">
  import { t } from '../../lib/i18n';

  interface Props {
    title: string;
    description?: string;
    onSignIn: () => void;
  }

  let { title, description = '', onSignIn }: Props = $props();
</script>

<div class="empty-state">
  <h2 class="empty-state__title">{title}</h2>
  {#if description}
    <p class="empty-state__description">{description}</p>
  {/if}
  <button
    class="button empty-state__action button--primary"
    onclick={onSignIn}>
    {$t('signInEmpty.action')}
  </button>
</div>

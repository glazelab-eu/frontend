<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import { routeHref } from '../../lib/routing/routes';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import AccountSection from './AccountSection.svelte';

  interface Props {
    /** The account's two sources, as the server has them. */
    buddies: boolean;
    clubs: boolean;
    online: boolean;
    error: string;
    /** Saves both sources; answers whether it worked. */
    onChange: (buddies: boolean, clubs: boolean) => Promise<boolean>;
  }

  let { buddies, clubs, online, error, onChange }: Props = $props();
  let busy = $state(false);
  let buddiesInput = $state<HTMLInputElement>();
  let clubsInput = $state<HTMLInputElement>();

  /** The switches show the server's answer: after a refusal they go back to what they were. */
  async function change() {
    if (!buddiesInput || !clubsInput) return;
    busy = true;
    try {
      await onChange(buddiesInput.checked, clubsInput.checked);
    } finally {
      busy = false;
      await tick();
      if (buddiesInput) buddiesInput.checked = buddies;
      if (clubsInput) clubsInput.checked = clubs;
    }
  }
</script>

<!-- FEED-1: what the activity page shows, per account (every device), both on by default. -->
<AccountSection title={$t('account.feed.title')}>
  <p class="feed-settings__text">{$t('account.feed.intro')}</p>
  <label class="feed-settings__switch">
    <input
      bind:this={buddiesInput}
      type="checkbox"
      role="switch"
      name="feed-buddies"
      checked={buddies}
      disabled={!online || busy}
      onchange={change} />
    <span>{$t('account.feed.buddies')}</span>
  </label>
  <label class="feed-settings__switch">
    <input
      bind:this={clubsInput}
      type="checkbox"
      role="switch"
      name="feed-clubs"
      checked={clubs}
      disabled={!online || busy}
      onchange={change} />
    <span>{$t('account.feed.clubs')}</span>
  </label>
  <OfflineNote
    {online}
    message={$t('account.feed.offline')} />
  <FormError message={error} />
  <p class="feed-settings__text"><a href={routeHref({ name: 'activity' })}>{$t('account.feed.open')}</a></p>
</AccountSection>

<style>
  .feed-settings__text {
    margin: 0 0 var(--space-4);
    color: var(--muted);
    font-size: var(--font-base);
    line-height: 1.6;
  }
  .feed-settings__text a {
    color: var(--accent);
  }
  .feed-settings__switch {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
    font-weight: 600;
    min-height: var(--touch-target);
  }
</style>

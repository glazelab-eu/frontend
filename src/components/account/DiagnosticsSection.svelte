<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import AccountSection from './AccountSection.svelte';

  interface Props {
    /** The account's choice, as the server has it. */
    enabled: boolean;
    online: boolean;
    error: string;
    /** Saves the choice; answers whether it worked. */
    onChange: (enabled: boolean) => Promise<boolean>;
  }

  let { enabled, online, error, onChange }: Props = $props();
  let busy = $state(false);

  /** The switch shows the server's answer: after a refusal it goes back to what it was. */
  async function change(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const wanted = input.checked;
    busy = true;
    try {
      await onChange(wanted);
    } finally {
      busy = false;
      await tick();
      input.checked = enabled;
    }
  }
</script>

<!-- The account's choice (32-2): off until the person turns it on here or when signing up. -->
<AccountSection title={$t('account.page.diagnostics.title')}>
  <p class="diagnostics__text">{$t('account.page.diagnostics.intro')}</p>
  <label class="diagnostics__switch">
    <input
      type="checkbox"
      role="switch"
      name="diagnostics"
      checked={enabled}
      disabled={!online || busy}
      onchange={change} />
    <span>{$t('account.page.diagnostics.switch')}</span>
  </label>
  <OfflineNote
    {online}
    message={$t('account.page.diagnostics.offline')} />
  <FormError message={error} />
  <details class="diagnostics__sent">
    <summary class="diagnostics__summary">{$t('account.page.diagnostics.sent.title')}</summary>
    <ul class="diagnostics__list">
      <li>{$t('account.page.diagnostics.sent.problem')}</li>
      <li>{$t('account.page.diagnostics.sent.device')}</li>
      <li>{$t('account.page.diagnostics.sent.state')}</li>
      <li>{$t('account.page.diagnostics.sent.never')}</li>
    </ul>
    <p class="diagnostics__text"><a href="#/terms">{$t('account.page.diagnostics.sent.terms')}</a></p>
  </details>
  <p class="diagnostics__text">{$t('account.page.diagnostics.stopNote')}</p>
</AccountSection>

<style>
  .diagnostics__text {
    margin: 0 0 var(--space-4);
    color: var(--muted);
    font-size: var(--font-base);
    line-height: 1.6;
  }
  .diagnostics__text a {
    color: var(--accent);
  }
  .diagnostics__switch {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    font-weight: 600;
    min-height: var(--touch-target);
  }
  .diagnostics__sent {
    margin-bottom: var(--space-4);
  }
  .diagnostics__summary {
    color: var(--accent);
    cursor: pointer;
    min-height: var(--touch-target);
    display: flex;
    align-items: center;
  }
  .diagnostics__list {
    margin: var(--space-2) 0 var(--space-3);
    padding-left: var(--space-5);
    color: var(--muted);
    font-size: var(--font-base);
    line-height: 1.6;
  }
</style>

<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { InvitePreview, User } from '../../lib/api/models';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  interface Props {
    /** From the invite route; nothing is joined until the user confirms with a POST. */
    token: string;
    user: User | null;
    online: boolean;
    authOpen: boolean;
    /** The failed preview or join, from the app's form error. */
    error: string;
    onSignIn: () => void;
    /** Leaves the invite route without joining. */
    onClose: () => void;
    /** What the invite offers; null after a failure. Joins nothing. */
    onPreview: (token: string) => Promise<InvitePreview | null>;
    /** Joins and replaces the route so the token leaves history; false after a failure. */
    onJoin: (token: string) => Promise<boolean>;
  }
  let { token, user, online, authOpen, error, onSignIn, onClose, onPreview, onJoin }: Props = $props();
  let preview = $state<InvitePreview | null>(null);
  let busy = $state(false);
  // Primitives, so the effect runs again only when one changes, not with every store update.
  const account = $derived(user?.id);
  const connected = $derived(online);
  $effect(() => {
    const value = token;
    let cancelled = false;
    preview = null;
    if (value && account && connected) {
      void onPreview(value).then((result) => {
        if (!cancelled) preview = result;
      });
    }
    return () => {
      cancelled = true;
    };
  });
  async function join() {
    if (busy || !online || !preview) return;
    busy = true;
    try {
      await onJoin(token);
    } finally {
      busy = false;
    }
  }
</script>

{#if !authOpen}
  <ModalShell
    title={$t('clubs.invite.title')}
    {onClose}>
    <!-- An offline note replaces the message of a failure that was the connection itself. -->
    {#if online}
      <FormError message={error} />
    {/if}
    {#if !online}
      <p>{$t('clubs.invite.offline')}</p>
    {:else if !user}
      <p>{$t('clubs.invite.signIn')}</p>
      <button
        class="button button--primary"
        onclick={onSignIn}>
        {$t('common.signInOrJoin')}
      </button>
    {:else if preview}
      <h3>{preview.name}</h3>
      <h4>{$t('clubs.houseRules')}</h4>
      <p class="club-invite__rules">{preview.houseRules || $t('clubs.houseRulesEmpty')}</p>
      <button
        class="button button--primary"
        disabled={busy}
        onclick={join}>
        {$t('clubs.invite.join')}
      </button>
    {:else if !error}
      <p>{$t('clubs.invite.loading')}</p>
    {/if}
  </ModalShell>
{/if}

<style>
  .club-invite__rules {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>

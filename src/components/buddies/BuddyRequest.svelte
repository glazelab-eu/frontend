<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { BuddyPreview, User } from '../../lib/api/models';
  import { requestOffer } from '../../lib/buddies/buddies';
  import Avatar from '../avatars/Avatar.svelte';
  import AvatarReport from '../avatars/AvatarReport.svelte';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';

  interface Props {
    /** From the buddy route; nothing is requested until the user confirms with a POST. */
    token: string;
    user: User | null;
    online: boolean;
    authOpen: boolean;
    /** The failed preview or request, from the app's form error. */
    error: string;
    onSignIn: () => void;
    /** Leaves the buddy route without asking (the token leaves the history). */
    onClose: () => void;
    /** Leaves the buddy route for the Buddies section of the account page. */
    onOpenBuddies: () => void;
    /** Who the link belongs to and how this account stands to them; null after a failure. Requests nothing. */
    onPreview: (token: string) => Promise<BuddyPreview | null>;
    /** Asks the link's owner (or accepts their request) and replaces the route; false after a failure. */
    onRequest: (token: string, name: string) => Promise<boolean>;
    /** Reports the link owner's profile picture (31-3), and why the last report failed. */
    onReportAvatar: (avatarId: string, reason: string | null) => Promise<boolean>;
    reportError: string;
  }
  let { token, user, online, authOpen, error, onSignIn, onClose, onOpenBuddies, onPreview, onRequest, onReportAvatar, reportError }: Props = $props();
  let preview = $state<BuddyPreview | null>(null);
  let busy = $state(false);
  // Primitives, so the effect runs again only when one changes, not with every store update.
  const account = $derived(user?.id);
  const connected = $derived(online);
  const offer = $derived(preview ? requestOffer(preview.relation) : null);
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
  async function send() {
    if (busy || !online || !preview) return;
    busy = true;
    try {
      await onRequest(token, preview.displayName);
    } finally {
      busy = false;
    }
  }
</script>

{#if !authOpen}
  <ModalShell
    title={preview && offer === 'ask' ? $t('buddies.request.ask', { values: { name: preview.displayName } }) : $t('buddies.request.title')}
    {onClose}>
    <!-- An offline note replaces the message of a failure that was the connection itself. -->
    {#if online}
      <FormError message={error} />
    {/if}
    {#if !online}
      <p>{$t('buddies.request.offline')}</p>
    {:else if !user}
      <p>{$t('buddies.request.signIn')}</p>
      <button
        class="button button--primary"
        onclick={onSignIn}>
        {$t('common.signInOrJoin')}
      </button>
    {:else if preview && offer}
      {@const name = preview.displayName}
      <div class="buddy-request__person">
        <Avatar
          size="md"
          avatarId={preview.avatarId}
          {name}
          viewerId={user.id} />
        <strong class="buddy-request__name">{name}</strong>
        {#if preview.relation !== 'SELF'}
          <AvatarReport
            avatarId={preview.avatarId}
            {name}
            {online}
            error={reportError}
            placement="below"
            onReport={onReportAvatar} />
        {/if}
      </div>
      {#if offer === 'ask'}
        <p>{$t('buddies.request.askBody', { values: { name } })}</p>
      {:else if offer === 'accept'}
        <p>{$t('buddies.request.incoming', { values: { name } })}</p>
      {:else if offer === 'pending'}
        <p>{$t('buddies.request.pending', { values: { name } })}</p>
      {:else if offer === 'buddies'}
        <p>{$t('buddies.request.buddies', { values: { name } })}</p>
      {:else}
        <p>{$t('buddies.request.own')}</p>
      {/if}
      <div class="button-row">
        {#if offer === 'ask' || offer === 'accept'}
          <button
            type="button"
            class="button button--primary"
            disabled={busy}
            onclick={send}>
            {offer === 'ask' ? $t('buddies.request.send') : $t('buddies.request.accept')}
          </button>
          <button
            type="button"
            class="button"
            onclick={onClose}>
            {$t('common.cancel')}
          </button>
        {:else}
          <button
            type="button"
            class="button button--primary"
            onclick={onOpenBuddies}>
            {$t('buddies.request.open')}
          </button>
          <button
            type="button"
            class="button"
            onclick={onClose}>
            {$t('common.close')}
          </button>
        {/if}
      </div>
    {:else if error}
      <div class="button-row">
        <button
          type="button"
          class="button"
          onclick={onClose}>
          {$t('common.close')}
        </button>
      </div>
    {:else}
      <p>{$t('buddies.request.loading')}</p>
    {/if}
  </ModalShell>
{/if}

<style>
  /* A display name may be one word of 100 characters: it wraps instead of being clipped by the dialog. */
  p {
    overflow-wrap: anywhere;
  }
  .buddy-request__person {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .buddy-request__name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>

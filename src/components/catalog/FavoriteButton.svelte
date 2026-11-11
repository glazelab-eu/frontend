<script lang="ts">
  import { t } from '../../lib/i18n';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    active: boolean;
    /** A guest's star is active too: it opens the sign-in dialog (`onToggle` answers false and sends nothing). */
    signedIn: boolean;
    /** Offline the star stays focusable and says why it cannot change. */
    online: boolean;
    onToggle: () => Promise<boolean>;
  }
  let { active, signedIn, online, onToggle }: Props = $props();
  let busy = $state(false);
  /** Offline only an account's star is blocked. */
  let blocked = $derived(signedIn && !online);
  let label = $derived(!signedIn ? $t('favorites.signIn') : !online ? $t('favorites.offline') : active ? $t('favorites.remove') : $t('favorites.add'));
  async function toggle() {
    if (busy || blocked) return;
    busy = true;
    try {
      await onToggle();
    } finally {
      busy = false;
    }
  }
</script>

<button
  class="icon-button"
  aria-pressed={active}
  aria-label={label}
  title={label}
  aria-disabled={blocked || undefined}
  disabled={busy}
  onclick={toggle}>
  <Icon
    name="star"
    filled={active} />
</button>

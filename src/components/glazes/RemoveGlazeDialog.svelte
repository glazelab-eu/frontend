<script lang="ts">
  import { t } from '../../lib/i18n';
  import ConfirmDialog from '../common/ConfirmDialog.svelte';
  import { routeHref } from '../../lib/routing/routes';

  interface Props {
    /** The glaze as shown elsewhere (code · manufacturer · name). */
    label: string;
    /** Combinations whose steps use the glaze; removal is refused while there are any. */
    usedIn: { id: string; title: string }[];
    online: boolean;
    /** The app's current error, shown here while the dialog covers the page. */
    error: string;
    onConfirm: () => Promise<boolean>;
    onClose: () => void;
  }

  let { label, usedIn, online, error, onConfirm, onClose }: Props = $props();
  let busy = $state(false);

  async function confirm() {
    if (busy || !online || usedIn.length) return;
    busy = true;
    try {
      if (await onConfirm()) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<ConfirmDialog
  title={$t('glaze.remove.title')}
  confirmLabel={$t('glaze.remove.confirm')}
  {online}
  {busy}
  confirmDisabled={usedIn.length > 0}
  {error}
  onConfirm={() => void confirm()}
  onCancel={onClose}>
  <p class="remove-glaze__label">{label}</p>
  {#if usedIn.length}
    <p>{$t('glaze.remove.inUse', { values: { count: usedIn.length } })}</p>
    <ul class="remove-glaze__uses">
      {#each usedIn as combo (combo.id)}
        <li>
          <a
            href={routeHref({ name: 'combination', id: combo.id })}
            onclick={onClose}>
            {combo.title}
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <p>{$t('glaze.remove.body')}</p>
  {/if}
</ConfirmDialog>

<style>
  .remove-glaze__label {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .remove-glaze__uses {
    margin: 0 0 var(--space-4);
    padding-left: var(--space-5);
    overflow-wrap: anywhere;
  }
  @media (pointer: coarse) {
    .remove-glaze__uses a {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

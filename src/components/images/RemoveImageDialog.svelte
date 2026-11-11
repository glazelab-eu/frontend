<script lang="ts">
  import { t } from '../../lib/i18n';
  import { pictureFocusFallback } from '../../lib/images/picture-focus';
  import ConfirmDialog from '../common/ConfirmDialog.svelte';
  interface Props {
    online: boolean;
    error: string;
    description: string;
    focusFallback: HTMLElement | undefined;
    onConfirm: () => Promise<boolean>;
    onClose: () => void;
  }
  let { online, error, description, focusFallback, onConfirm, onClose }: Props = $props();
  const focusCard = pictureFocusFallback();
  let busy = $state(false);
  async function confirm() {
    if (busy || !online) return;
    busy = true;
    try {
      if (await onConfirm()) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<ConfirmDialog
  title={$t('images.remove.action')}
  confirmLabel={$t('images.remove.confirm')}
  {online}
  offlineMessage={$t('images.menu.offline')}
  {busy}
  {error}
  fallbackFocus={() => {
    if (!focusCard()) focusFallback?.focus({ preventScroll: true });
  }}
  onConfirm={() => void confirm()}
  onCancel={onClose}>
  <p>{$t('images.remove.body', { values: { description } })}</p>
</ConfirmDialog>

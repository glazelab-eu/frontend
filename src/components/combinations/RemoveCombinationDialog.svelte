<script lang="ts">
  import { lifetime } from '../../state/shared/lifetime';
  import { t } from '../../lib/i18n';
  import ConfirmDialog from '../common/ConfirmDialog.svelte';
  interface Props {
    title: string;
    locked: boolean;
    online: boolean;
    error: string;
    onConfirm: () => Promise<boolean>;
    onClose: () => void;
  }
  let { title, locked, online, error, onConfirm, onClose }: Props = $props();
  let busy = $state(false);
  const life = lifetime();
  async function confirm() {
    if (busy || locked || !online) return;
    const submit = onConfirm;
    const closeAfterSave = onClose;
    busy = true;
    try {
      if ((await submit()) && life.mounted()) closeAfterSave();
    } finally {
      if (life.mounted()) busy = false;
    }
  }
</script>

<ConfirmDialog
  title={$t('combination.delete.title')}
  confirmLabel={$t('combination.delete.confirm')}
  {online}
  {busy}
  confirmDisabled={locked}
  {error}
  onConfirm={confirm}
  onCancel={onClose}>
  <p class="remove-combination__name">{title}</p>
  <p>{$t(locked ? 'errors.combinationDeleteLocked' : 'combination.delete.body')}</p>
</ConfirmDialog>

<style>
  .remove-combination__name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
</style>

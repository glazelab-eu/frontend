<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { ImageInfo } from '../../lib/api/models';
  import { imageKindKey, kindsOn } from '../../lib/images/pictures';
  import { pictureFocusFallback } from '../../lib/images/picture-focus';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';

  interface Props {
    /** A picture the signed-in user may manage (`canDelete`: uploader, an admin of its club, a site admin). */
    image: ImageInfo;
    /** A glaze's own photo (packaging, never work in progress); a combination's photo the other way round. */
    glaze: boolean;
    online: boolean;
    /** Why the last change failed, shown at the Save button. */
    error?: string;
    /** Resolves true once saved; the photo keeps its ID, the host keeps showing it wherever its new kind sorts it. */
    onChange: (image: ImageInfo, kind: ImageInfo['kind']) => Promise<boolean>;
    onClose: () => void;
  }

  let { image, glaze, online, error = '', onChange, onClose }: Props = $props();
  let kinds = $derived(kindsOn(glaze));
  let picked = $state<ImageInfo['kind'] | undefined>(undefined);
  let choice = $derived(picked ?? image.kind);
  let busy = $state(false);
  let failed = $state(false);
  const focusCard = pictureFocusFallback();

  async function submit() {
    if (busy || !online || choice === image.kind) return;
    busy = true;
    failed = false;
    try {
      failed = !(await onChange(image, choice));
      if (!failed) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={$t('images.menu.kind')}
  fallbackFocus={focusCard}
  onClose={() => !busy && onClose()}>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <label class="form-field">
      {$t('upload.kind')}
      <select
        class="form-field__control"
        bind:value={() => choice, (value) => (picked = value)}
        disabled={busy || !online}>
        {#each kinds as kind (kind)}
          <option value={kind}>{$t(imageKindKey(kind))}</option>
        {/each}
      </select>
    </label>
    {#if failed}
      <FormError message={error || 'images.kindChange.failed'} />
    {/if}
    <OfflineNote {online} />
    <div class="button-row button-row--end">
      <button
        type="button"
        class="button"
        disabled={busy}
        onclick={onClose}>
        {$t('common.cancel')}
      </button>
      <button
        class="button button--primary"
        disabled={busy || !online || choice === image.kind}>
        {$t('images.kindChange.save')}
      </button>
    </div>
  </form>
</ModalShell>

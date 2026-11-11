<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { Club, ImageInfo } from '../../lib/api/models';
  import type { ImageVisibilityChange } from '../../lib/api/inputs';
  import { visibilityChoice, visibilityChange } from '../../lib/images/pictures';
  import type { PhotoAudience } from '../../lib/images/photo-audience';
  import { pictureFocusFallback } from '../../lib/images/picture-focus';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';

  interface Props {
    /** A picture the signed-in user uploaded. */
    image: ImageInfo;
    /** The account's clubs, to tell whether the photo's club is one the owner has left. */
    clubs: Club[];
    /** The visibilities offered for this photo (`photoAudience`). */
    audience: PhotoAudience;
    online: boolean;
    /** Why the last change failed, shown at the Save button. */
    error?: string;
    /** Resolves true once saved; leaving PUBLIC gives the picture a new ID, which the host follows. */
    onChange: (image: ImageInfo, change: ImageVisibilityChange) => Promise<boolean>;
    onClose: () => void;
  }

  let { image, clubs, audience, online, error = '', onChange, onClose }: Props = $props();
  let current = $derived(visibilityChoice(image));
  let picked = $state<string | undefined>(undefined);
  let choice = $derived(picked ?? current);
  /** A club picture of a club the owner has left stays selectable as it is. */
  let formerClub = $derived(image.visibility === 'CLUB' && !clubs.some((club) => club.id === image.clubId));
  const id = $props.id();
  let busy = $state(false);
  let failed = $state(false);
  const focusCard = pictureFocusFallback();

  async function submit() {
    if (busy || !online || choice === current) return;
    busy = true;
    failed = false;
    try {
      failed = !(await onChange(image, visibilityChange(choice)));
      if (!failed) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={$t('images.menu.visibility')}
  fallbackFocus={focusCard}
  onClose={() => !busy && onClose()}>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <label class="form-field">
      {$t('images.visibility.label')}
      <select
        class="form-field__control"
        aria-describedby={audience.restricted ? `${id}-audience` : undefined}
        bind:value={() => choice, (value) => (picked = value)}
        disabled={busy || !online}>
        <option value="PUBLIC">{$t('upload.visibility.public')}</option>
        {#each audience.clubs as club (club.id)}
          <option value={`CLUB:${club.id}`}>
            {$t('images.visibility.club', { values: { name: club.name } })}
          </option>
        {/each}
        {#if formerClub}
          <option value={current}>{$t('images.visibility.formerClub')}</option>
        {/if}
        {#if audience.private}
          <option value="PRIVATE">{$t('upload.visibility.private')}</option>
        {/if}
      </select>
    </label>
    {#if audience.restricted}
      <p
        id={`${id}-audience`}
        class="picture-visibility__hint">
        {$t('images.visibility.authorRule')}
      </p>
    {/if}
    {#if failed}
      <FormError message={error || 'images.visibility.failed'} />
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
        disabled={busy || !online || choice === current}>
        {$t('images.visibility.save')}
      </button>
    </div>
  </form>
</ModalShell>

<style>
  .picture-visibility__hint {
    color: var(--muted);
    line-height: 1.5;
    margin: var(--space-2) 0 var(--space-4);
    font-size: var(--font-xs);
  }
  @media (pointer: coarse) {
    .picture-visibility__hint {
      font-size: var(--font-body);
    }
  }
</style>

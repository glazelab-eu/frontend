<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { PhotoAudience } from '../../lib/images/photo-audience';
  import type { UploadVisibility } from '../../lib/images/upload-queue';

  interface Props {
    /** The visibilities offered (`uploadAudience`, or `photoAudience` of an own combination). */
    audience: PhotoAudience;
    visibility: UploadVisibility;
    /** The club chosen for Club; empty when there is none to choose. */
    club: string;
    onVisibility: (visibility: UploadVisibility) => void;
    onClub: (club: string) => void;
    disabled?: boolean;
  }

  let { audience, visibility, club, onVisibility, onClub, disabled = false }: Props = $props();
  const id = $props.id();
</script>

<label class="form-field">
  {$t('upload.visibility.label')}
  <select
    class="form-field__control"
    aria-describedby={audience.restricted ? `${id}-audience` : undefined}
    {disabled}
    value={visibility}
    onchange={(event) => onVisibility(event.currentTarget.value as UploadVisibility)}>
    <option value="PUBLIC">{$t('upload.visibility.public')}</option>
    {#if audience.clubs.length > 0}
      <option value="CLUB">{$t('upload.visibility.club')}</option>
    {/if}
    {#if audience.private}
      <option value="PRIVATE">{$t('upload.visibility.private')}</option>
    {/if}
  </select>
</label>
{#if audience.restricted}
  <p
    id={`${id}-audience`}
    class="upload-visibility__hint">
    {$t('images.visibility.authorRule')}
  </p>
{/if}
{#if visibility === 'CLUB'}
  <label class="form-field">
    {$t('upload.club')}
    <select
      class="form-field__control"
      {disabled}
      value={club}
      onchange={(event) => onClub(event.currentTarget.value)}
      required>
      <option
        value=""
        disabled>
        {$t('upload.clubPlaceholder')}
      </option>
      {#each audience.clubs as item (item.id)}
        <option value={item.id}>{item.name}</option>
      {/each}
    </select>
  </label>
{/if}

<style>
  .upload-visibility__hint {
    color: var(--muted);
    line-height: 1.5;
    margin: var(--space-2) 0 var(--space-4);
    font-size: var(--font-xs);
  }
  @media (pointer: coarse) {
    .upload-visibility__hint {
      font-size: var(--font-body);
    }
  }
</style>

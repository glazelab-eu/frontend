<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { t, errorText } from '../../lib/i18n';
  import { EARLIEST_FIRED_ON, LATEST_FIRED_ON, MAX_CAPTION } from '../../lib/images/photo-details';
  import { imageKindKey } from '../../lib/images/pictures';
  import { coverPosition } from '../../lib/images/photo-focus';
  import { canFocus, fileSizeLabel, type UploadKind, type UploadStatus } from '../../lib/images/upload-queue';
  import type { UploadSession } from '../../state/images/upload-session.svelte';
  import PhotoFocusDialog from './PhotoFocusDialog.svelte';

  interface Props {
    session: UploadSession;
    /** The kinds a photo may be given (`kindsFor`): new kinds appear here without a change. */
    kinds: readonly UploadKind[];
    online: boolean;
    /** No field, removal or retry while the form around the list is locked (a save under way). */
    locked?: boolean;
    /** Sends one failed photo again; by default the session's own retry. */
    onRetry?: (key: number) => void;
    /** The list element, for moving focus to its first Retry after a batch. */
    list?: HTMLElement;
  }

  let { session, kinds, online, locked = false, onRetry = (key) => session.retry(key), list = $bindable() }: Props = $props();
  const id = $props.id();
  const statusLabels = {
    converting: 'upload.status.converting',
    queued: 'upload.status.queued',
    uploading: 'upload.status.uploading',
    done: 'upload.status.done',
  } as const;
  const statusText = (status: UploadStatus) => (status === 'idle' || status === 'failed' ? '' : $t(statusLabels[status]));
  const summary = $derived(session.summary);
  /** The photo whose focus dialog is open, by key (a removed or sent photo closes it). */
  let focusing = $state<number | null>(null);
  const focusItem = $derived(focusing === null ? undefined : session.items.find((item) => item.key === focusing && canFocus(item)));
</script>

{#if session.items.length}
  <ul
    class="upload-files"
    bind:this={list}
    aria-label={$t('upload.list')}>
    {#each session.items as item (item.key)}
      {@const preview = session.previewOf(item.key)}
      {@const frozen = locked || item.status === 'uploading'}
      <li class="upload-file">
        <div class="upload-file__head">
          {#if preview}
            <!-- Cropped like a card's cover, around the focus (set through the CSSOM: the CSP has no inline styles). -->
            <img
              class="upload-file__preview"
              src={preview}
              alt=""
              width="56"
              height="56"
              style:object-position={coverPosition({ focusX: item.focus?.x, focusY: item.focus?.y })} />
          {:else}
            <span
              class="upload-file__preview upload-file__preview--done"
              aria-hidden="true">
              {item.status === 'done' ? '✓' : ''}
            </span>
          {/if}
          <div class="upload-file__info">
            <span
              class="upload-file__name"
              id="{id}-name-{item.key}">
              {item.file.name}
            </span>
            <span class="upload-file__status">
              {fileSizeLabel(item.file.size)}
              {#if statusText(item.status)}
                · {statusText(item.status)}
              {/if}
              {#if canFocus(item) && item.focus}
                · {$t('upload.focus.set')}
              {/if}
            </span>
          </div>
          <button
            type="button"
            class="icon-button icon-button--quiet"
            aria-label={$t('upload.remove', { values: { name: item.file.name } })}
            disabled={frozen}
            onclick={() => session.remove(item.key)}>
            <Icon name="close" />
          </button>
        </div>
        {#if canFocus(item) && !locked}
          <!-- Optional: without a focus the cards' covers show the middle. The photo always goes whole. -->
          <div class="button-row upload-file__focus">
            <button
              type="button"
              class="button"
              aria-label={$t('upload.focus.openNamed', { values: { name: item.file.name } })}
              onclick={() => (focusing = item.key)}>
              {$t('upload.focus.open')}
            </button>
            {#if item.focus}
              <button
                type="button"
                class="button"
                aria-label={$t('upload.focus.resetNamed', { values: { name: item.file.name } })}
                onclick={() => session.focus(item.key, null)}>
                {$t('upload.focus.reset')}
              </button>
            {/if}
          </div>
        {/if}
        {#if item.status === 'failed'}
          <div class="upload-file__failure">
            <p
              class="upload-file__error"
              id="{id}-error-{item.key}"
              role="alert">
              {$errorText(item.error)}
            </p>
            <button
              type="button"
              class="button upload-file__retry"
              data-retry
              aria-label={$t('upload.retryNamed', { values: { name: item.file.name } })}
              aria-describedby="{id}-error-{item.key}"
              disabled={!online || locked}
              onclick={() => onRetry(item.key)}>
              {$t('upload.retry')}
            </button>
          </div>
        {/if}
        {#if item.status !== 'done'}
          <label class="upload-file__field">
            {$t('upload.kind')}
            <select
              class="form-field__control"
              aria-describedby="{id}-name-{item.key}"
              disabled={frozen}
              value={item.kind}
              onchange={(event) => session.edit(item.key, { kind: event.currentTarget.value as UploadKind })}>
              {#each kinds as kind (kind)}
                <option value={kind}>{$t(imageKindKey(kind))}</option>
              {/each}
            </select>
          </label>
          <details
            class="upload-file__details"
            open={summary.total === 1 || !!item.caption || !!item.firedOn}>
            <summary class="upload-file__summary">{$t('upload.details')}</summary>
            <label class="upload-file__field">
              {$t('images.details.caption')}
              <input
                class="form-field__control"
                maxlength={MAX_CAPTION}
                placeholder={$t('images.details.captionPlaceholder')}
                autocomplete="off"
                aria-describedby="{id}-name-{item.key} {id}-count-{item.key}"
                disabled={frozen}
                value={item.caption}
                oninput={(event) => session.edit(item.key, { caption: event.currentTarget.value })} />
            </label>
            <small
              class="upload-file__count"
              id="{id}-count-{item.key}">
              {$t('images.details.count', { values: { count: item.caption.length, max: MAX_CAPTION } })}
            </small>
            <label class="upload-file__field">
              {$t('images.details.firedOn')}
              <input
                class="form-field__control"
                type="date"
                min={EARLIEST_FIRED_ON}
                max={LATEST_FIRED_ON}
                aria-describedby="{id}-name-{item.key}"
                disabled={frozen}
                value={item.firedOn}
                oninput={(event) => session.edit(item.key, { firedOn: event.currentTarget.value })} />
            </label>
          </details>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
{#if focusItem}
  {@const item = focusItem}
  <PhotoFocusDialog
    source={() => Promise.resolve(item.file)}
    name={item.file.name}
    start={item.focus}
    onSave={(focus) => {
      session.focus(item.key, focus);
      return true;
    }}
    onClose={() => (focusing = null)} />
{/if}

<style>
  .upload-files {
    list-style: none;
    margin: 0 0 var(--space-4);
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  .upload-file {
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    min-inline-size: 0;
  }
  .upload-file__head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .upload-file__preview {
    flex: none;
    inline-size: 3.5rem;
    block-size: 3.5rem;
    object-fit: cover;
    border-radius: var(--radius-sm);
    background: var(--sage);
  }
  .upload-file__preview--done {
    display: grid;
    place-items: center;
    color: var(--accent);
    font-weight: 700;
  }
  .upload-file__info {
    flex: 1 1 auto;
    min-inline-size: 0;
    display: grid;
  }
  .upload-file__name {
    font-weight: 600;
    font-size: var(--font-sm);
    overflow-wrap: anywhere;
  }
  .upload-file__status {
    color: var(--muted);
    font-size: var(--font-xs);
  }
  .upload-file__focus {
    margin-bottom: var(--space-3);
  }
  .upload-file__retry {
    border-color: var(--control-border);
  }
  .upload-file__failure {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .upload-file__error {
    flex: 1 1 10rem;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--danger-bg);
    color: var(--danger-ink);
    font-size: var(--font-sm);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .upload-file__field {
    display: block;
    font-size: var(--font-sm);
    font-weight: 550;
    margin-bottom: var(--space-2);
  }
  .upload-file__details {
    font-size: var(--font-sm);
  }
  .upload-file__summary {
    cursor: pointer;
    margin-bottom: var(--space-2);
  }
  .upload-file__count {
    display: block;
    margin: calc(-1 * var(--space-1)) 0 var(--space-2);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  @media (pointer: coarse) {
    .upload-file__status,
    .upload-file__count {
      font-size: var(--font-body);
    }
    .upload-file__summary {
      display: flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

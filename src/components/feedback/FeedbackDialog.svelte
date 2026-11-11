<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t, type MessageKey } from '../../lib/i18n';
  import { routeHref } from '../../lib/routing/routes';
  import {
    MAX_FEEDBACK_LENGTH,
    deviceKey,
    MAX_FEEDBACK_PHOTOS,
    messageProblem,
    photoProblem,
    preparePhoto,
    type FeedbackContext,
    type FeedbackDraft,
  } from '../../lib/feedback/feedback';
  import { FIRST_FIELD } from '../ui/first-field';
  import ModalShell from '../ui/ModalShell.svelte';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import Callout from '../ui/Callout.svelte';

  interface Props {
    online: boolean;
    /** The failed send, from the app's form error (`feedback`). */
    error: string;
    /** What the app attaches unless the sender unticks it. */
    context: FeedbackContext;
    /** The draft kept from an earlier opening (memory only). */
    draft: FeedbackDraft;
    /** Every change of the draft, so closing, a failed send or going offline loses nothing. */
    onDraft: (draft: FeedbackDraft) => void;
    /** Sends; true when it went (the host closes the dialog and confirms). */
    onSend: (draft: FeedbackDraft) => Promise<boolean>;
    /** Closing waits for a photo being prepared; a page change closes anyway, and this says that photo was not added. */
    onPhotoDropped: () => void;
    onClose: () => void;
  }
  let { online, error: serverError, context, draft, onDraft, onSend, onPhotoDropped, onClose }: Props = $props();

  // The dialog edits its own copy, seeded once from the kept draft.
  // svelte-ignore state_referenced_locally
  let message = $state(draft.message);
  // svelte-ignore state_referenced_locally
  let photos = $state.raw<File[]>(draft.photos);
  // svelte-ignore state_referenced_locally
  let withContext = $state(draft.withContext);
  let preparing = $state(0);
  let busy = $state(false);
  let problem = $state<MessageKey | ''>('');
  let photoRefusal = $state<MessageKey | ''>('');

  /** One object URL per photo, revoked when the photo goes or the dialog closes. */
  const previews = new Map<File, string>();
  const previewOf = (file: File) => {
    let url = previews.get(file);
    if (!url) previews.set(file, (url = URL.createObjectURL(file)));
    return url;
  };
  const drop = (file: File) => {
    const url = previews.get(file);
    if (url) URL.revokeObjectURL(url);
    previews.delete(file);
  };
  onDestroy(() => {
    [...previews.keys()].forEach(drop);
    if (preparing) onPhotoDropped();
  });
  /** Cancel, Escape and the close button wait while a photo is being prepared or the feedback is being sent. */
  const close = () => {
    if (!busy && !preparing) onClose();
  };

  $effect(() => {
    onDraft({ message, photos, withContext });
  });

  let length = $derived(message.trim().length);
  let room = $derived(photos.length + preparing < MAX_FEEDBACK_PHOTOS);
  let deviceLabel = $derived($t(deviceKey(context.device)));
  let details = $derived([
    [$t('feedback.context.page'), context.route],
    [$t('feedback.context.version'), context.build],
    [$t('feedback.context.language'), context.language],
    [$t('feedback.context.device'), deviceLabel],
  ]);

  async function choose(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    photoRefusal = '';
    for (const file of files) {
      const refusal = photoProblem(file, photos.length + preparing);
      if (refusal) {
        photoRefusal = refusal;
        continue;
      }
      preparing++;
      const prepared = await preparePhoto(file);
      preparing--;
      if (prepared.ok) photos = [...photos, prepared.file];
      else photoRefusal = prepared.reason;
    }
  }

  function remove(file: File, index: number) {
    photos = photos.filter((photo) => photo !== file);
    drop(file);
    // The Remove button leaves with its photo: focus goes to the next one, else to the chooser.
    queueMicrotask(() => {
      const buttons = document.querySelectorAll<HTMLElement>('.feedback-dialog__remove');
      (buttons[Math.min(index, buttons.length - 1)] ?? document.querySelector<HTMLElement>('.feedback-dialog__input'))?.focus();
    });
  }

  async function submit() {
    if (busy || !online || preparing) return;
    problem = messageProblem(message) ?? '';
    if (problem) return;
    busy = true;
    try {
      await onSend({ message, photos, withContext });
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={$t('feedback.title')}
  initialFocus={FIRST_FIELD}
  onClose={close}>
  <form
    class="feedback-dialog"
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <p class="feedback-dialog__intro">{$t('feedback.intro')}</p>
    <label class="form-field">
      {$t('feedback.message')}
      <textarea
        class="form-field__control feedback-dialog__message"
        bind:value={message}
        maxlength={MAX_FEEDBACK_LENGTH}
        rows="5"
        required
        disabled={busy}
        aria-describedby="feedback-count">
      </textarea>
      <small
        class="feedback-dialog__count"
        id="feedback-count">
        {$t('feedback.count', { values: { count: length, max: MAX_FEEDBACK_LENGTH } })}
      </small>
    </label>
    <div class="feedback-dialog__photos">
      <label class={['button', 'feedback-dialog__pick', { 'feedback-dialog__pick--off': !room || busy }]}>
        {$t('feedback.addPhotos', { values: { max: MAX_FEEDBACK_PHOTOS } })}
        <input
          class="feedback-dialog__input"
          type="file"
          accept="image/*"
          multiple
          disabled={!room || busy}
          onchange={choose} />
      </label>
      {#if preparing}
        <p
          class="feedback-dialog__hint"
          role="status">
          {$t('feedback.preparing')}
        </p>
      {/if}
      <FormError
        message={photoRefusal}
        focus={false} />
      {#if photos.length}
        <ul class="feedback-dialog__list">
          {#each photos as photo, index (photo)}
            <li class="feedback-dialog__photo">
              <img
                class="feedback-dialog__preview"
                src={previewOf(photo)}
                alt={$t('feedback.photo', { values: { number: index + 1 } })} />
              <button
                type="button"
                class="button feedback-dialog__remove"
                disabled={busy}
                aria-label={$t('feedback.removePhoto', { values: { number: index + 1 } })}
                onclick={() => remove(photo, index)}>
                {$t('feedback.remove')}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <label class="feedback-dialog__context">
      <input
        type="checkbox"
        bind:checked={withContext}
        disabled={busy} />
      <span>{$t('feedback.withContext')}</span>
    </label>
    {#if withContext}
      <!-- Exactly what goes with the text: the page's name (never its address), the build, the language and the kind of device. -->
      <Callout tone="neutral">
        <dl class="feedback-dialog__details">
          {#each details as [label, value] (label)}
            <div class="feedback-dialog__detail">
              <dt class="feedback-dialog__term">{label}</dt>
              <dd class="feedback-dialog__value">{value}</dd>
            </div>
          {/each}
        </dl>
      </Callout>
    {/if}
    <p class="feedback-dialog__hint">
      {$t('feedback.whatIsSent')}
      <a
        href={routeHref({ name: 'terms' })}
        onclick={() => onClose()}>
        {$t('feedback.terms')}
      </a>
    </p>
    <FormError message={problem || serverError} />
    <OfflineNote
      {online}
      message={$t('feedback.offline')} />
    <div class="button-row button-row--end">
      <button
        type="button"
        class="button"
        disabled={busy || preparing > 0}
        onclick={close}>
        {$t('common.cancel')}
      </button>
      <button
        class="button button--primary"
        disabled={busy || !online || preparing > 0}>
        {busy ? $t('feedback.sending') : $t('feedback.send')}
      </button>
    </div>
  </form>
</ModalShell>

<style>
  .feedback-dialog {
    display: grid;
    gap: var(--space-3);
  }
  .feedback-dialog__intro,
  .feedback-dialog__hint {
    margin: 0;
    font-size: var(--font-sm);
    color: var(--muted);
  }
  .feedback-dialog__message {
    resize: vertical;
    min-height: 7rem;
  }
  .feedback-dialog__count {
    color: var(--muted);
  }
  .feedback-dialog__photos {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
  }
  .feedback-dialog__pick {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    white-space: normal;
  }
  .feedback-dialog__pick:focus-within {
    outline: 0.125rem solid var(--accent);
    outline-offset: 0.125rem;
  }
  .feedback-dialog__pick--off {
    opacity: 0.6;
    cursor: default;
  }
  .feedback-dialog__input {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    opacity: 0;
    cursor: pointer;
    font-size: 0;
  }
  .feedback-dialog__list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .feedback-dialog__photo {
    display: grid;
    gap: var(--space-1);
    justify-items: center;
  }
  .feedback-dialog__preview {
    width: 5rem;
    height: 5rem;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }
  .feedback-dialog__context {
    display: flex;
    align-items: start;
    gap: var(--space-2);
    font-size: var(--font-sm);
    line-height: 1.5;
  }
  .feedback-dialog__details {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--font-sm);
  }
  .feedback-dialog__detail {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-2);
  }
  .feedback-dialog__term {
    font-weight: 600;
  }
  .feedback-dialog__value {
    margin: 0;
    overflow-wrap: anywhere;
  }
  @media (pointer: coarse) {
    .feedback-dialog__context {
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

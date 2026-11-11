<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { t } from '../../lib/i18n';
  import ModalShell from '../ui/ModalShell.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import type { UploadTarget } from '../../lib/api/models';
  import type { PhotoAudience } from '../../lib/images/photo-audience';
  import type { ImageUploadInput } from '../../lib/api/inputs';
  import { kindsFor, startVisibility, uploadProgress, type UploadResult, type UploadVisibility } from '../../lib/images/upload-queue';
  import UploadPicker from './UploadPicker.svelte';
  import UploadFileList from './UploadFileList.svelte';
  import UploadVisibilityField from './UploadVisibilityField.svelte';
  import { createUploadSession } from '../../state/images/upload-session.svelte';
  import type { PhotoSuggestions as PhotoSuggestionsController } from '../../state/vision/photo-suggestions';
  import PhotoSuggestions from '../vision/PhotoSuggestions.svelte';
  import UploadSimilar from '../vision/UploadSimilar.svelte';
  import type { SimilarLooks } from '../../state/vision/similar-looks';
  import { isLookKind } from '../../lib/vision/library';
  import type { LeaveGuard } from '../../state/app/app-state';

  interface Props {
    target: UploadTarget;
    /** The visibilities offered for `target` (`uploadAudience`). */
    audience: PhotoAudience;
    online: boolean;
    /** The visibility chosen last in this session; the dialog starts with it. */
    visibility: UploadVisibility;
    onVisibilityChange: (visibility: UploadVisibility) => void;
    /** Closes the dialog; `added` photos went in while it was open (they stay). */
    onClose: (added: number) => void;
    /** Sends one photo and patches it into the listings. */
    onUpload: (input: ImageUploadInput) => Promise<UploadResult>;
    registerLeaveGuard: (guard: LeaveGuard) => () => void;
    /** Takes focus when the button that opened the dialog is gone once it closes. */
    fallbackFocus?: () => void;
    /** The optional tag suggestions for finished-piece photos (33-1) and what they need of the item. */
    suggestions: PhotoSuggestionsController;
    /** The similar looks (33-2): "Find similar" for a photo before it is saved. */
    similar: SimilarLooks;
    /** The account's ID, to load the pictures of the results. */
    userId?: string | null;
    /** The tags the glaze or combination has now, and every tag of the loaded library. */
    tags: string[];
    knownTags: string[];
    /** Adds one tag to the item; resolves true when it was saved. */
    onAddTag: (tag: string) => Promise<boolean>;
  }

  let {
    target,
    audience,
    online,
    visibility: remembered,
    onVisibilityChange,
    onClose,
    onUpload,
    registerLeaveGuard,
    fallbackFocus,
    suggestions,
    similar,
    userId,
    tags,
    knownTags,
    onAddTag,
  }: Props = $props();
  let visibility = $state<UploadVisibility>(untrack(() => startVisibility(remembered, audience)));
  let selectedClub = $state<string | undefined>(undefined);
  let club = $derived(selectedClub ?? audience.clubs[0]?.id ?? '');
  let list = $state<HTMLElement>();
  const kinds = untrack(() => kindsFor(target));

  const session = createUploadSession({
    target: untrack(() => target),
    upload: (input) => onUpload(input),
    common: () => ({ visibility, clubId: club }),
    onSettled: async ({ done, failed, allDone }) => {
      if (allDone) return onClose(done);
      if (failed === 0) return;
      await tick();
      list?.querySelector<HTMLElement>('[data-retry]')?.focus();
    },
  });
  onMount(() => session.dispose);

  const summary = $derived(session.summary);
  /** Finished-piece photos that can be looked at: a HEIC photo waits for its JPEG, and only this kind is ever analysed. */
  const finished = $derived(session.items.filter((item) => item.kind === 'FINISHED' && item.status !== 'converting' && item.status !== 'done'));
  /** Test tiles and finished pieces that can be looked up among the library's (packaging shows a label, not a look). */
  const lookable = $derived(
    session.items.flatMap((item) =>
      isLookKind(item.kind) && item.status !== 'converting' && item.status !== 'done' ? [{ key: item.key, file: item.file, kind: item.kind }] : [],
    ),
  );
  // Photos not yet stored (chosen, waiting, in flight or failed) are lost with the dialog, a navigation or a reload.
  $effect(() => registerLeaveGuard({ dirty: () => summary.total > summary.done, message: 'drafts.discardUpload' }));
  const progress = $derived(uploadProgress(summary, session.running));

  function submit() {
    if (!online) return;
    session.send();
  }
</script>

<ModalShell
  title={$t('upload.heading', { values: { title: target.title } })}
  eyebrow={$t('upload.eyebrow')}
  {fallbackFocus}
  onClose={() => onClose(summary.done)}>
  <div class="upload-dialog">
    <form
      onsubmit={(event) => {
        event.preventDefault();
        submit();
      }}>
      <UploadPicker
        onFiles={session.add}
        rejected={session.rejected} />
      <UploadFileList
        {session}
        {kinds}
        {online}
        bind:list />
      <PhotoSuggestions
        {suggestions}
        files={finished.map(({ key, file }) => ({ key, file }))}
        {tags}
        {knownTags}
        {online}
        {onAddTag} />
      <UploadSimilar
        {similar}
        {suggestions}
        files={lookable}
        {userId} />
      <UploadVisibilityField
        {audience}
        {visibility}
        {club}
        onVisibility={(value) => ((visibility = value), onVisibilityChange(value))}
        onClub={(value) => (selectedClub = value)} />
      <p class="upload-dialog__hint">{$t('upload.compressionHint')}</p>
      <OfflineNote {online} />
      <p
        class="upload-dialog__progress"
        role="status">
        {#if progress}
          {$t(progress.key, { values: progress.values })}
        {/if}
      </p>
      {#if summary.done > 0 || session.running}
        <p class="upload-dialog__hint">{$t('upload.keptHint')}</p>
      {/if}
      <div class="button-row">
        <button
          class="button upload-dialog__submit button--primary"
          disabled={!online || session.running || session.sendable === 0}>
          {$t('upload.submit', { values: { count: session.sendable } })}
        </button>
        {#if session.running}
          <button
            type="button"
            class="button"
            onclick={session.cancel}>
            {$t('upload.stop')}
          </button>
        {/if}
      </div>
    </form>
  </div>
</ModalShell>

<style>
  .upload-dialog__hint {
    color: var(--muted);
    line-height: 1.5;
    margin: var(--space-2) 0 var(--space-4);
    font-size: var(--font-xs);
  }
  .upload-dialog__progress {
    margin: 0 0 var(--space-3);
    font-size: var(--font-sm);
    font-weight: 600;
  }
  .upload-dialog__progress:empty {
    display: none;
  }
  .upload-dialog__submit {
    flex: 1 1 auto;
  }

  @media (pointer: coarse) {
    .upload-dialog__hint {
      font-size: var(--font-body);
    }
  }
</style>

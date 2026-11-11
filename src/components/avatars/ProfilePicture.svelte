<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import { avatarFileProblem, MAX_AVATAR_SOURCE_BYTES, type AvatarFileProblem } from '../../lib/avatars/avatar';
  import { routeHref } from '../../lib/routing/routes';
  import { createConfirmation } from '../../state/shared/confirmation.svelte';
  import Avatar from './Avatar.svelte';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import AvatarCropDialog from './AvatarCropDialog.svelte';
  import ConfirmDialog from '../common/ConfirmDialog.svelte';

  interface Props {
    /** The signed-in account. */
    user: { id: string; displayName: string; avatarId: string | null };
    online: boolean;
    /** The last failed write of the picture (upload or removal), from the app's form errors. */
    error: string;
    /** Sends the cut square; true when it was stored. */
    onUpload: (square: File) => Promise<boolean>;
    onRemove: () => Promise<boolean>;
    /** Forgets the last failure (a dialog was closed, so it no longer belongs to anything on the screen). */
    onClearError: () => void;
  }

  let { user, online, error, onUpload, onRemove, onClearError }: Props = $props();
  /** The file in the crop dialog. */
  let chosen = $state<File>();
  let problem = $state<AvatarFileProblem>();
  let library = $state<HTMLInputElement>();
  const removal = createConfirmation<true>(() => onRemove());

  const problems = {
    empty: 'account.avatar.problem.empty',
    notImage: 'account.avatar.problem.notImage',
    tooLarge: 'account.avatar.problem.tooLarge',
  } as const satisfies Record<AvatarFileProblem, string>;

  function choose(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // The same file may be chosen again after the dialog was closed.
    input.value = '';
    if (!file) return;
    onClearError();
    problem = avatarFileProblem(file) ?? undefined;
    if (!problem) chosen = file;
  }

  function closeCrop() {
    chosen = undefined;
    onClearError();
  }

  /** The Remove button leaves with the picture, so focus goes to the chooser, which stays. */
  async function remove() {
    if (!(await removal.confirm())) return;
    await tick();
    library?.focus({ preventScroll: true });
  }
</script>

<div class="profile-picture">
  <div class="profile-picture__row">
    <Avatar
      avatarId={user.avatarId}
      name={user.displayName}
      viewerId={user.id}
      size="lg"
      decorative={false}
      label={$t('account.avatar.label')} />
    <div class="button-row">
      <label class={['button', 'profile-picture__pick', { 'profile-picture__pick--disabled': !online }]}>
        {user.avatarId ? $t('account.avatar.change') : $t('account.avatar.choose')}
        <input
          class="profile-picture__input"
          type="file"
          accept="image/*"
          bind:this={library}
          disabled={!online}
          onchange={choose} />
      </label>
      <label class={['button', 'profile-picture__pick', 'profile-picture__pick--camera', { 'profile-picture__pick--disabled': !online }]}>
        {$t('account.avatar.camera')}
        <input
          class="profile-picture__input"
          type="file"
          accept="image/*"
          capture="user"
          disabled={!online}
          onchange={choose} />
      </label>
      {#if user.avatarId}
        <button
          type="button"
          class="button profile-picture__remove"
          disabled={!online || removal.busy}
          onclick={() => removal.ask(true)}>
          {$t('account.avatar.remove')}
        </button>
      {/if}
    </div>
  </div>
  <!-- Always on the screen, with or without a picture: who can see it, and what it may show. -->
  <p class="profile-picture__visible">{$t('account.avatar.visible')}</p>
  <p class="profile-picture__rule">{$t('account.avatar.rule')}</p>
  <p class="profile-picture__rule">
    <a
      class="profile-picture__terms"
      href={routeHref({ name: 'terms' })}>
      {$t('account.avatar.terms')}
    </a>
  </p>
  <OfflineNote
    {online}
    message={$t('account.avatar.offline')} />
  <FormError
    message={problem ? problems[problem] : ''}
    values={{ max: MAX_AVATAR_SOURCE_BYTES / 1_000_000 }} />
  {#if !chosen}
    <FormError message={error} />
  {/if}
</div>
{#if chosen}
  <AvatarCropDialog
    file={chosen}
    {online}
    {error}
    onSave={onUpload}
    onClose={closeCrop} />
{/if}
{#if removal.asking}
  <ConfirmDialog
    title={$t('account.avatar.remove.title')}
    confirmLabel={$t('account.avatar.remove.confirm')}
    {online}
    offlineMessage={$t('account.avatar.offline')}
    onConfirm={() => void remove()}
    onCancel={removal.cancel}>
    <p>{$t('account.avatar.remove.body')}</p>
  </ConfirmDialog>
{/if}

<style>
  .profile-picture {
    margin: 0 0 var(--space-5);
    padding-bottom: var(--space-4);
    border-bottom: 0.0625rem solid var(--border);
  }
  .profile-picture__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-5);
    margin-bottom: var(--space-3);
  }
  .profile-picture__pick {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    white-space: normal;
  }
  .profile-picture__pick:focus-within {
    outline: 0.125rem solid var(--accent);
    outline-offset: 0.125rem;
  }
  .profile-picture__pick--disabled {
    cursor: default;
    opacity: 0.55;
  }
  .profile-picture__pick--camera {
    display: none;
  }
  @media (width < 45em) {
    .profile-picture__pick--camera {
      display: inline-flex;
    }
  }
  .profile-picture__input {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    opacity: 0;
    cursor: pointer;
    font-size: 0;
  }
  .profile-picture__input:disabled {
    cursor: default;
  }
  .profile-picture__remove {
    color: var(--danger-ink);
    border-color: var(--danger-ink);
  }
  .profile-picture__visible {
    margin: 0 0 var(--space-1);
    font-weight: 700;
    line-height: 1.5;
  }
  .profile-picture__rule {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-base);
    line-height: 1.6;
  }
  .profile-picture__terms {
    color: var(--accent);
    font-weight: 600;
    text-underline-offset: 0.2em;
  }
  @media (pointer: coarse) {
    .profile-picture__terms {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

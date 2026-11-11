<script lang="ts">
  import { formErrorFor } from '../../state/app/app-state';
  import { tick, untrack } from 'svelte';
  import { lifetime } from '../../state/shared/lifetime';
  import { createAddGlazeHost } from '../../state/catalog/add-glaze-host.svelte';
  import { createHeldSave } from '../../state/studio/held-save.svelte';
  import { createStudioRecovery } from '../../state/studio/recovery.svelte';
  import { createStudioPhotos } from '../../state/studio/studio-photos.svelte';
  import { photoAudience } from '../../lib/images/photo-audience';
  import { MAX_UPLOAD_FILES, kindsFor, startVisibility, uploadProgress, type UploadVisibility } from '../../lib/images/upload-queue';
  import UploadPicker from '../../components/images/UploadPicker.svelte';
  import UploadFileList from '../../components/images/UploadFileList.svelte';
  import UploadVisibilityField from '../../components/images/UploadVisibilityField.svelte';
  import { restoredContent } from '../../lib/studio/recovery';
  import type { CombinationInput } from '../../lib/api/inputs';
  import { t, type MessageKey } from '../../lib/i18n';
  import { isPhone, phoneMedia } from '../../lib/layout/viewport';
  import { studioDraft, studioFingerprint, studioInput, studioSourceStatus, studioView } from '../../lib/studio/studio-draft';
  import { studioLeaveQuestion } from '../../lib/studio/held-save';
  import { draftWorthSaving, saveDraftReason } from '../../lib/studio/save-draft';
  import { waitingList } from '../../lib/studio/waiting';
  import { clayBodySuggestions, firingDraft, firingStarted } from '../../lib/firing/firing';
  import { routeHref, type Route } from '../../lib/routing/routes';
  import RouteStatus from '../../components/routing/RouteStatus.svelte';
  import PageHead from '../../components/ui/PageHead.svelte';
  import PanelTitle from '../../components/ui/PanelTitle.svelte';
  import SignInEmpty from '../../components/auth/SignInEmpty.svelte';
  import type { AppController } from '../../state/app/app-controller';
  import { glazeMap, stockedFirst } from '../../lib/glazes/glazes';
  import FormError from '../../components/common/FormError.svelte';
  import OfflineNote from '../../components/common/OfflineNote.svelte';
  import { countTags, withPendingTag, withTag } from '../../lib/tags/tags';
  import TagEditor from '../../components/tags/TagEditor.svelte';
  import AddGlazeDialog from '../../components/glazes/AddGlazeDialog.svelte';
  import StepEditor from '../../components/studio/StepEditor.svelte';
  import DraftList from '../../components/studio/DraftList.svelte';
  import WaitingList from '../../components/studio/WaitingList.svelte';
  import HeldSaveNote from '../../components/studio/HeldSaveNote.svelte';
  import FinalFiringSection from '../../components/studio/FinalFiringSection.svelte';
  import {
    addedGlazeStep,
    customStepDraft,
    draftSteps,
    initialSteps,
    movedStep,
    removedStep,
    stepsStarted,
    withStepGlaze,
    type StepDraft,
  } from '../../lib/studio/step-draft';
  import { collapsedForNewStep, isCollapsed, toggledCollapse } from '../../lib/studio/step-summary';
  import { isLoading } from '../../lib/sync/lifecycle';

  /** What a click on a save button asks for, as the form held it then; kept if the save has to wait. */
  interface SaveRequest {
    input: CombinationInput;
    /** The edited combination; none for a new one. */
    id?: string;
    draft: boolean;
    action: 'draft' | 'publish' | 'edit';
  }

  interface Props {
    app: AppController;
    route: Extract<Route, { name: 'studio' }>;
    /** Tells the shell whether the draft has input; the bottom navigation then gives way to the sticky bar. */
    onStarted?: (started: boolean) => void;
  }

  let { app, route, onStarted }: Props = $props();

  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  let busy = $state(false);
  const life = lifetime(() => accountId);
  let initialized = $state(false);
  let initialInput = $state('');
  let editSource = $derived(route.id ? $appStore.combinations.find((combo) => combo.id === route.id) : undefined);
  let sourceStatus = $derived(studioSourceStatus(route, $appStore.glazes, $appStore.combinations, $appStore.sync));
  let view = $derived(studioView(!!user, initialized, route, sourceStatus));
  let stepsLocked = $derived(!!editSource?.stepsLocked);
  /** A new combination or an own draft: saved as a draft or published; a published one keeps its state. */
  let drafting = $derived(!route.id || !!editSource?.draft);
  /** The account's own drafts, newest first (the listing's order); only its author receives them. */
  let drafts = $derived($appStore.combinations.filter((combo) => combo.own && combo.draft));
  /** Shared glazes and own published combinations without a result photo, newest first; none while offline (uploading needs the connection). */
  let waiting = $derived(waitingList($appStore.combinations, online, undefined, $appStore.glazes));
  let glazes = $derived($appStore.glazes);
  /** On your shelf or a club shelf first: what you can apply right away. */
  let offered = $derived(stockedFirst(glazes, $appStore.stock));
  let glazesById = $derived(glazeMap(glazes));
  /** Below 720 px: finished steps fold into one line and the add and save actions stay in view. */
  let phone = $state(isPhone());
  $effect(() => phoneMedia((now) => (phone = now)));
  /** Keys of the steps the writer folded into their summary line (phone only). */
  let collapsed = $state(new Set<number>());

  let comboTitle = $state('');
  let comboDescription = $state('');
  let tags = $state<string[]>([]);
  /** An edit's tags as its form opened: the save sends them so only the form's own tag changes apply (BE-9). */
  let baseTags = $state<string[]>([]);
  /** An edit's title as its form opened: a restored recovery that never touched it keeps the title stored now (a rename meanwhile). */
  let baseTitle = $state('');
  /** Typed in the tag field but not added yet; saved with the combination. */
  let tagText = $state('');
  /** Studio is where drafts live, so the writer's own drafts count here (nowhere else: see `published`). */
  let tagCounts = $derived(countTags(glazes, $appStore.combinations));
  let steps = $state(initialSteps());
  /** A publish was refused for lack of a step; the message shows in the empty steps section until a step is added. */
  let stepRequired = $state(false);
  /** The final firing; earlier or extra firings are custom steps. */
  let firing = $state(firingDraft());
  /** Clay bodies of the combinations this account can see, for the field's suggestions. */
  let clayBodies = $derived(clayBodySuggestions($appStore.combinations));
  let onSignIn = $derived(app.openAuth);
  let hasText = $derived(!!(comboTitle.trim() || comboDescription.trim() || tags.length || tagText.trim()));

  /** The photos recorded with the combination (memory only); they go once it is saved (`state/studio/studio-photos`). */
  const photos = createStudioPhotos({
    upload: (input) => app.uploadImage(input),
    common: () => ({ visibility: photoVisibility, clubId: photoClub }),
    onDone: (id) => void openSaved(id),
    onDropped: () => app.showError('studio.photos.dropped'),
  });
  $effect(() => () => photos.dispose());
  /** The kinds a combination photo may have; a kind the API adds appears here by itself. */
  const photoKinds = kindsFor({ type: 'combination' });
  /** The writer's own combination: every visibility is offered. */
  let audience = $derived(photoAudience($appStore.clubs, $appStore.clubMembers, $appStore.user?.id, $appStore.user?.id));
  let photoVisibility = $state<UploadVisibility>(untrack(() => startVisibility($appStore.uploadVisibility, audience)));
  let selectedClub = $state<string>();
  let photoClub = $derived(selectedClub ?? audience.clubs[0]?.id ?? '');
  let photoList = $state<HTMLElement>();
  /** A restored recovery had this many photos attached; they are never kept on the device, so the form says so. */
  let photosLost = $state(0);
  /** Saved, with its photos on their way or failed: the fields are done, only the photos remain. */
  let committed = $derived(photos.savedId !== null);
  /** Photos need the connection and their HEIC conversions: no held save with photos. */
  let photosBlocked = $derived(photos.attached > 0 && (!online || photos.converting > 0));
  let photoProgress = $derived(committed ? uploadProgress(photos.session.summary, photos.session.running) : null);
  $effect(() => {
    if (photos.phase !== 'failed') return;
    void tick().then(() => photoList?.querySelector<HTMLElement>('[data-retry]')?.focus());
  });

  /** Every photo went in: open the saved combination as a save without photos does. */
  async function openSaved(id: string) {
    const actor = accountId;
    await tick();
    if (life.current(actor)) app.navigate({ name: 'combination', id }, { replace: true });
  }

  /** Done after failed photos: those are dropped, the combination opens with the photos that went in. */
  async function finishPhotos() {
    const id = photos.savedId;
    if (!id) return;
    photos.discard();
    await openSaved(id);
  }

  /** Anything typed or chosen; an untouched form leaves without asking. */
  let dirty = $derived(
    !committed &&
      initialized &&
      (route.id
        ? studioFingerprint(comboTitle, comboDescription, tags, steps, firing) !== initialInput || !!tagText.trim()
        : hasText || stepsStarted(steps) || firingStarted(firing)),
  );

  /** Something a draft would keep (blank steps are left out, so they alone are not worth saving); only a new combination needs it. */
  let worthSaving = $derived(draftWorthSaving({ hasText, steps, firingStarted: firingStarted(firing) }));
  /** Why Save draft does nothing (an untouched new form); it stays focusable (`aria-disabled`) so the reason can be read. */
  let draftReason = $derived<MessageKey | undefined>(saveDraftReason({ editing: !!route.id, worthSaving }) ? 'studio.saveDraft.reason' : undefined);
  let draftBlocked = $derived(draftReason !== undefined);
  /** Unsaved input worth asking about and recovering: a new combination holding only blank steps has nothing to keep. */
  let keepable = $derived(dirty && (!!route.id || worthSaving));

  let accountId = $derived(user?.id);
  // The outlet is keyed by Studio route, but its props may change as it unmounts after a save.
  const recoveryRoute = untrack(() => routeHref(route));
  const recovery = createStudioRecovery({
    account: () => accountId,
    route: () => recoveryRoute,
    ready: () => initialized && view === 'form',
    dirty: () => keepable,
    // Text only: the photos stay in memory, the record keeps how many there were.
    content: () => ({
      title: comboTitle,
      description: comboDescription,
      tags,
      tagText,
      steps,
      firing,
      ...(route.id ? { baseTags, baseTitle } : {}),
      ...(photos.attached ? { photos: photos.attached } : {}),
    }),
  });
  function restoreRecovery() {
    const saved = recovery.take();
    if (!saved) return;
    const content = restoredContent(saved);
    if (content.baseTitle === undefined || content.title !== content.baseTitle) comboTitle = content.title;
    comboDescription = content.description;
    tags = content.tags;
    // A recovery from before the field keeps the base of this opening.
    if (content.baseTags) baseTags = content.baseTags;
    tagText = content.tagText;
    steps = content.steps;
    firing = content.firing;
    photosLost = content.photos ?? 0;
    collapsed = new Set();
    void tick().then(() => document.getElementById('studio-title')?.focus());
  }
  async function sendSave({ input, id, draft }: SaveRequest) {
    const ok = !!(await app.saveCombination(input, id, draft));
    if (ok) await recovery.clear();
    return ok;
  }
  /**
   * Offline, a save waits in memory for the connection (decision Q19): the form is locked as it was
   * clicked, the request goes out once the controller reports online and is dropped with the page,
   * on sign-out and on an account change. A failure unlocks the form and shows its error there.
   */
  const held = createHeldSave<SaveRequest>({
    account: () => accountId,
    ready: () => online && !isLoading($appStore.sync),
    send: sendSave,
  });
  /** Saving is under way or waiting, or the photos of a saved combination are: no second action, no edit. */
  let working = $derived(busy || held.active || photos.phase !== 'editing');
  /**
   * The form shows and its draft has input or a save is held: on a phone the sticky bar takes the foot of the screen and the
   * bottom navigation is hidden. Without the form (an edit gone after a reload) there is no sticky bar, so the navigation stays.
   */
  let started = $derived(view === 'form' && (dirty || held.active || photos.session.items.length > 0));
  let barSticky = $derived(phone && started);
  $effect(() => onStarted?.(started));
  $effect(() => () => onStarted?.(false));
  /** Unsaved input, a held save, or a request already out: see `studioLeaveQuestion`. */
  $effect(() => {
    // Blank steps alone leave without asking, though the form counts as started.
    // Attached photos are unsaved input; once the save is out they are on their way, after a failure they wait for Retry.
    const sending = photos.phase === 'saving' || photos.phase === 'uploading';
    const { dirty: asks, ...question } = studioLeaveQuestion({
      dirty: keepable || (photos.phase === 'editing' && photos.attached > 0),
      phase: held.phase,
      saving: busy,
      photos: sending ? 'sending' : photos.phase === 'failed' && photos.attached > 0 ? 'failed' : 'none',
    });
    return app.registerLeaveGuard({
      dirty: () => asks,
      ...question,
      discard: () => {
        if (!busy && held.phase !== 'sending') void recovery.clear();
        photos.discard();
      },
    });
  });
  /** The add-glaze dialog opened from a step's picker; the step it asked for selects the new glaze. */
  const add = createAddGlazeHost<{ step: number }>(
    () => app,
    () => $appStore,
    () => accountId,
  );
  const useGlaze = (step: number, id: string) => (steps = withStepGlaze(steps, step, id, glazes));
  let draftAccount = $state<string>();
  let sourceMissing = $state(false);
  $effect(() => {
    if (accountId !== draftAccount) {
      draftAccount = accountId;
      initialized = false;
      initialInput = '';
      busy = false;
      sourceMissing = false;
      comboTitle = '';
      comboDescription = '';
      tags = [];
      baseTags = [];
      baseTitle = '';
      tagText = '';
      steps = initialSteps();
      stepRequired = false;
      firing = firingDraft();
      collapsed = new Set();
      // Another account never gets the photos chosen before, and their files leave memory now.
      untrack(() => photos.reset());
      photosLost = 0;
      selectedClub = undefined;
      photoVisibility = untrack(() => startVisibility($appStore.uploadVisibility, audience));
    }
    if (!accountId || initialized || isLoading($appStore.sync) || sourceStatus !== 'ready') return;
    // An edit opened at the start must not take its form from the saved snapshot while the refresh that brings newer
    // text, steps or tags still runs (FE-5): online it waits for the refresh to settle; offline the snapshot is all there is.
    if (route.id && online && $appStore.sync.phase !== 'idle') return;
    const draft = studioDraft(route, $appStore.glazes, $appStore.combinations, $t('studio.variationSuffix'));
    initialInput = studioFingerprint(draft.title, draft.description, draft.tags, draft.steps, draft.firing);
    comboTitle = draft.title;
    comboDescription = draft.description;
    tags = draft.tags;
    baseTags = [...draft.tags];
    baseTitle = draft.title;
    steps = draft.steps;
    firing = draft.firing;
    sourceMissing = draft.missing;
    initialized = true;
  });
  /**
   * Publish (the form's submit) needs a title and finished steps through native validation, and at
   * least one step, which the form says before sending (the server refuses it too). A draft may lack
   * all of them: empty steps are left out, and a step with input but without its glaze or label
   * is reported at its field, since every saved step satisfies its type.
   */
  async function onSaveCombination(draft = false) {
    if (working || recovery.checking || recovery.candidate || (draft && draftBlocked) || photosBlocked) return;
    let saved = steps;
    if (!draft && !steps.length) {
      stepRequired = true;
      await tick();
      document.querySelector<HTMLElement>('#studio-steps-empty .form-error')?.focus();
      return;
    }
    if (draft) {
      const result = draftSteps(steps);
      if (result.unfinished) {
        const field = document.querySelector<HTMLInputElement>(`#step-${result.unfinished.key} input:invalid`);
        field?.focus();
        field?.reportValidity();
        return;
      }
      saved = result.steps;
      // The final firing has no required field, but a draft still saves only values the API accepts.
      const firingField = document.querySelector<HTMLInputElement>('#final-firing-fields :invalid');
      if (firingField) {
        firingField.focus();
        firingField.reportValidity();
        return;
      }
    }
    const withPending = withPendingTag(tags, tagText);
    if (!withPending) return;
    tags = withPending;
    tagText = '';
    const editId = route.id;
    const request: SaveRequest = {
      input: studioInput({
        title: comboTitle,
        description: comboDescription,
        tags,
        steps: saved,
        firing,
        // A new combination started from a combination remembers it, unless that source was unavailable.
        basedOnId: !editId && !sourceMissing ? route.from : undefined,
        baseTags: editId ? baseTags : undefined,
      }),
      id: editId,
      draft,
      action: draft ? 'draft' : drafting ? 'publish' : 'edit',
    };
    if (photos.attached > 0) return savePhotos(request);
    if (!online) {
      held.hold(request);
      return;
    }
    const actor = accountId;
    busy = true;
    try {
      await sendSave(request);
    } finally {
      if (life.current(actor)) busy = false;
    }
  }

  /** The combination (or draft) first (it stays in Studio), then its photos one at a time; never held offline. */
  async function savePhotos({ input, id, draft }: SaveRequest) {
    if (!online) return;
    const actor = accountId;
    busy = true;
    try {
      await photos.submit(async () => {
        const saved = await app.saveCombination(input, id, draft, { open: false });
        if (saved) await recovery.clear();
        return saved;
      });
    } finally {
      if (life.current(actor)) busy = false;
    }
  }

  /** Cancelling a held save unlocks the form; focus returns to the button that held it. */
  async function cancelHeld() {
    const action = held.request?.action;
    held.cancel();
    await tick();
    document.getElementById(action === 'draft' ? 'studio-save-draft' : 'studio-save')?.focus();
  }

  /** Focus follows a step that moved or went; a disabled button at the end of the list passes it on. */
  async function focusAfter(key: number | undefined, ...ids: string[]) {
    await tick();
    for (const id of ids) {
      const button = document.getElementById(key === undefined ? id : `step-${key}-${id}`);
      if (button instanceof HTMLButtonElement && !button.disabled) return button.focus();
    }
  }

  function moveStep(index: number, delta: -1 | 1) {
    if (stepsLocked || working) return;
    const key = steps[index].key;
    steps = movedStep(steps, index, delta);
    focusAfter(key, delta < 0 ? 'up' : 'down', delta < 0 ? 'down' : 'up', 'remove');
  }

  /**
   * On a phone the finished steps fold away and the new step opens at its first field. The first step
   * does the same on wide screens, since the button that was pressed leaves with the empty state.
   */
  async function addStep(step: StepDraft) {
    if (stepsLocked || working) return;
    const first = !steps.length;
    if (phone) collapsed = collapsedForNewStep(steps, collapsed);
    stepRequired = false;
    steps.push(step);
    if (!phone && !first) return;
    await tick();
    document.querySelector<HTMLElement>(`#step-${step.key} input`)?.focus();
  }
  const addGlazeStep = () => addStep(addedGlazeStep(steps));
  const addCustomStep = () => addStep(customStepDraft());

  function removeStep(index: number) {
    if (stepsLocked || working) return;
    steps = removedStep(steps, index);
    // The next step takes the place, else the previous one; with none left the empty state's first button takes the focus.
    const next = steps[Math.min(index, steps.length - 1)];
    // A folded neighbour has no remove button: its header takes the focus.
    if (next) focusAfter(next.key, 'remove', 'toggle');
    else focusAfter(undefined, 'add-glaze-step');
  }
</script>

<PageHead
  eyebrow={$t('studio.eyebrow')}
  title={$t(!route.id ? 'studio.title' : editSource?.draft ? 'combination.draft.edit' : 'studio.edit.title')}
  description={$t(user ? 'studio.steps.hint' : 'studio.guestIntro')} />
{#snippet addButtons()}
  <button
    id="add-glaze-step"
    type="button"
    class="studio-form__add-step"
    disabled={stepsLocked || working}
    onclick={addGlazeStep}>
    {$t('studio.addGlazeStep')}
  </button>
  <button
    type="button"
    class="studio-form__add-step"
    disabled={stepsLocked || working}
    onclick={addCustomStep}>
    {$t('studio.addCustomStep')}
  </button>
{/snippet}
{#snippet saveButton()}
  <div class="studio-form__save-group">
    {#if photoProgress}
      <p
        class="studio-form__progress studio-form__photo-status"
        role="status">
        {$t(photoProgress.key, { values: photoProgress.values })}
      </p>
    {/if}
    {#if committed}
      {#if photos.phase === 'failed'}
        <p class="studio-form__reason studio-form__photo-status">{$t('studio.photos.failed')}</p>
        <div class="button-row button-row--end">
          <button
            type="button"
            class="button studio-form__save studio-form__save--draft"
            disabled={!online}
            onclick={photos.retryAll}>
            {$t('studio.photos.retryAll')}
          </button>
          <button
            type="button"
            class="button button--primary studio-form__save"
            onclick={finishPhotos}>
            {$t('studio.photos.done')}
          </button>
        </div>
      {/if}
    {:else}
      <div class="button-row button-row--end">
        {#if drafting}
          <button
            id="studio-save-draft"
            type="button"
            class="button studio-form__save studio-form__save--draft"
            class:studio-form__save--blocked={draftBlocked}
            disabled={working || photosBlocked}
            aria-disabled={draftBlocked || undefined}
            aria-describedby={draftBlocked ? 'studio-save-draft-reason' : undefined}
            onclick={() => onSaveCombination(true)}>
            {online || photos.attached ? $t('studio.saveDraft') : $t('studio.saveDraftLater')}
          </button>
        {/if}
        <button
          id="studio-save"
          class="button button--primary studio-form__save"
          disabled={working || photosBlocked}>
          {#if drafting}
            {online || photos.attached ? $t('combination.publish') : $t('studio.publishLater')}
          {:else}
            {online || photos.attached ? $t('studio.edit.submit') : $t('studio.edit.submitLater')}
          {/if}
        </button>
      </div>
      {#if draftReason}
        <p
          class="studio-form__reason"
          id="studio-save-draft-reason">
          {$t(draftReason)}
        </p>
      {/if}
    {/if}
  </div>
{/snippet}
{#if view === 'sign-in'}
  <SignInEmpty
    title={$t('studio.signIn')}
    {onSignIn} />
{:else if view === 'status'}
  <RouteStatus
    status={sourceStatus === 'ready' ? 'loading' : sourceStatus}
    failure={$appStore.sync.failure}
    onRetry={app.retry} />
{:else if view === 'missing'}
  <RouteStatus status="missing" />
{:else}
  {#if recovery.candidate}
    <section
      class="studio-recovery"
      aria-label={$t('studio.recovery.title')}>
      <h2 class="studio-recovery__title">{$t('studio.recovery.title')}</h2>
      <p>{$t('studio.recovery.body')}</p>
      <div class="button-row">
        <button
          type="button"
          class="button button--primary"
          onclick={restoreRecovery}>
          {$t('studio.recovery.restore')}
        </button>
        <button
          type="button"
          class="button"
          onclick={() => recovery.discard()}>
          {$t('studio.recovery.discard')}
        </button>
      </div>
    </section>
  {/if}
  {#if recovery.failed}
    <p role="status">{$t('studio.recovery.failed')}</p>
  {/if}
  {#if sourceMissing}
    <p
      class="studio-form__source"
      role="status">
      {$t('studio.sourceMissing')}
    </p>
  {/if}
  {#if !route.id && !route.from}
    <WaitingList
      items={waiting.items}
      total={waiting.total}
      onAddPhoto={app.openUpload}
      onEmptied={() => document.getElementById('studio-title')?.focus()}
      {phone} />
  {/if}
  {#if !route.id && drafts.length}
    <DraftList
      {drafts}
      {phone} />
  {/if}
  <form
    class={['studio-form', { 'studio-form--sticky-bar': barSticky }]}
    onsubmit={(event) => {
      event.preventDefault();
      onSaveCombination();
    }}>
    <fieldset
      class="studio-form__fields"
      disabled={working || recovery.checking || !!recovery.candidate}>
      <section class="panel">
        <PanelTitle title={$t('studio.titlePlaceholder')} />
        <label class="form-field">
          {$t('studio.titleLabel')}
          <input
            id="studio-title"
            class="form-field__control"
            bind:value={comboTitle}
            placeholder={$t('studio.descriptionPlaceholder')}
            required
            maxlength="160" />
        </label>
      </section>
      <section class="panel">
        <PanelTitle title={$t('studio.steps.title')} />
        {#if stepsLocked}
          <p class="studio-form__source">
            {$t('errors.combinationStepsLocked')}
          </p>
        {/if}
        {#if route.id}
          <p class="studio-form__source">
            <a
              class="studio-form__variation"
              href={routeHref({ name: 'studio', from: route.id })}>
              {$t('combination.recordVariation')}
            </a>
          </p>
        {/if}
        {#if steps.length}
          <div class="studio-form__steps">
            {#each steps as step, index (step.key)}
              <StepEditor
                bind:step={steps[index]}
                number={index + 1}
                first={index === 0}
                last={index === steps.length - 1}
                locked={stepsLocked || working}
                glazes={offered}
                {glazesById}
                {phone}
                collapsed={phone && isCollapsed(step, collapsed)}
                onToggle={() => (collapsed = toggledCollapse(step, collapsed))}
                onMove={(delta) => moveStep(index, delta)}
                onRemove={() => removeStep(index)}
                onAddGlaze={() => add.open({ step: index })} />
            {/each}
          </div>
          <div class="button-row">{@render addButtons()}</div>
        {:else}
          <div
            id="studio-steps-empty"
            class="studio-form__empty">
            <p class="studio-form__empty-text">{$t('studio.steps.empty')}</p>
            {#if stepRequired}
              <FormError
                message="errors.combinationStepRequired"
                focus={false} />
            {/if}
            <div class="button-row">{@render addButtons()}</div>
          </div>
        {/if}
      </section>
      <section class="panel">
        <PanelTitle title={$t('studio.details.title')} />
        <label class="form-field">
          {$t('common.notes')}
          <small class="form-field__optional">{$t('common.optional')}</small>
          <textarea
            class="form-field__control form-field__control--multiline"
            bind:value={comboDescription}
            rows="3"
            placeholder={$t('studio.notesPlaceholder')}>
          </textarea>
        </label>
        <TagEditor
          {tags}
          suggestions={tagCounts}
          onAdd={(tag) => {
            tags = withTag(tags, tag);
            return true;
          }}
          onRemove={(tag) => {
            tags = tags.filter((other) => other !== tag);
            return true;
          }}
          addOnSave
          bind:text={tagText} />
      </section>
      <FinalFiringSection
        bind:firing
        {clayBodies}
        {phone} />
    </fieldset>
    <fieldset
      class="studio-form__fields"
      disabled={held.active || recovery.checking || !!recovery.candidate || (working && photos.phase !== 'failed')}>
      <section class="panel">
        <PanelTitle
          title={$t('studio.photos.title')}
          description={$t('studio.photos.hint')} />
        {#if photosLost}
          <p
            class="studio-form__lost"
            role="status">
            {$t('studio.photos.notKept', { values: { count: photosLost } })}
          </p>
        {/if}
        <UploadPicker
          onFiles={(files) => {
            photosLost = 0;
            photos.session.add(files);
          }}
          rejected={photos.session.rejected}
          disabled={committed} />
        {#if photos.session.items.length}
          <p class="studio-form__count">
            {$t('studio.photos.count', { values: { count: photos.session.items.length, max: MAX_UPLOAD_FILES } })}
          </p>
        {/if}
        <UploadFileList
          session={photos.session}
          kinds={photoKinds}
          {online}
          locked={working && photos.phase !== 'failed'}
          onRetry={photos.retry}
          bind:list={photoList} />
        {#if photos.session.items.length}
          <UploadVisibilityField
            {audience}
            visibility={photoVisibility}
            club={photoClub}
            disabled={committed}
            onVisibility={(value) => {
              photoVisibility = value;
              app.rememberUploadVisibility(value);
            }}
            onClub={(value) => (selectedClub = value)} />
          {#if !committed && photos.converting === 0}
            <p class="studio-form__count">{$t('upload.compressionHint')}</p>
          {:else if !committed}
            <p
              class="studio-form__count"
              role="status">
              {$t('upload.converting')}
            </p>
          {/if}
        {/if}
      </section>
    </fieldset>
    <OfflineNote
      {online}
      message={$t(photos.attached ? 'studio.photos.offline' : 'studio.offline')}
      onRetry={app.retry}
      checking={isLoading($appStore.sync)} />
    {#if held.request}
      <HeldSaveNote
        action={held.request.action}
        sending={held.phase === 'sending'}
        onCancel={cancelHeld} />
    {/if}
    <FormError message={formErrorFor($appStore, 'combination')} />
    {#if phone}
      {#if !committed}
        <p class="studio-form__hint">{$t(drafting ? 'studio.draftHint' : 'studio.submitHint')}</p>
      {/if}
      <div
        class={['studio-form__bar', { 'studio-form__bar--sticky': barSticky }]}
        role="group"
        aria-label={$t('studio.bar.label')}>
        {@render saveButton()}
      </div>
    {:else}
      <div class="studio-form__footer">
        <span class="studio-form__hint">
          {#if !committed}
            {$t(drafting ? 'studio.draftHint' : 'studio.submitHint')}
          {/if}
        </span>
        {@render saveButton()}
      </div>
    {/if}
  </form>
{/if}
{#if add.target && user}
  {@const step = add.target.step}<AddGlazeDialog
    {...add.props}
    record={false}
    onAdded={(id) => useGlaze(step, id)}
    existingAction={{
      label: $t('glazeForm.useExisting'),
      run: (glaze) => {
        useGlaze(step, glaze.id);
        add.close();
      },
    }}
    bind:dirty={add.dirty} />
{/if}

<style>
  .studio-recovery {
    margin-bottom: var(--space-4);
    padding: var(--space-3);
    border: 0.0625rem solid var(--control-border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .studio-recovery__title {
    margin: 0;
    font-size: var(--font-md);
  }
  /* The sticky bar covers the foot of the screen: a focused field scrolls clear of it. */
  :global(:root:has(.studio-form--sticky-bar)) {
    scroll-padding-bottom: var(--sticky-bar-clearance);
  }
  .studio-form__source {
    color: var(--muted);
    margin-bottom: var(--space-4);
  }
  .studio-form {
    max-width: 56.25rem;
  }
  .studio-form__fields {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .studio-form__add-step {
    flex: 1 1 12rem;
    border: 0.0625rem dashed var(--control-border);
    background: var(--surface);
    padding: var(--space-3);
    color: var(--accent);
    border-radius: var(--radius-sm);
    font-size: var(--font-xs);
    font-weight: 700;
  }
  .studio-form__empty {
    display: grid;
    gap: var(--space-3);
    border: 0.0625rem dashed var(--control-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }
  .studio-form__empty-text {
    margin: 0;
    color: var(--muted);
  }
  .studio-form__footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-5);
  }
  .studio-form__hint {
    font-size: var(--font-xs);
    color: var(--muted);
  }
  .studio-form__bar {
    display: grid;
    gap: var(--space-2);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    padding: var(--space-2);
    box-shadow: 0 -0.25rem 1rem var(--shadow-color);
  }
  /* Only while the bottom navigation is hidden; an untouched draft keeps the bar in the flow above it. */
  .studio-form__bar--sticky {
    position: sticky;
    bottom: 0;
    z-index: var(--z-sticky-bar);
    padding-bottom: max(var(--space-2), var(--safe-bottom));
  }
  .studio-form__save-group {
    display: grid;
    gap: var(--space-2);
    justify-items: end;
  }
  .studio-form__reason {
    margin: 0;
    font-size: var(--font-xs);
    color: var(--muted);
  }
  .studio-form__save--blocked {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .studio-form__save {
    flex: 1 0 auto;
    min-height: var(--touch-target);
  }
  .studio-form__save--draft {
    border: 0.0625rem solid var(--control-border);
  }
  .studio-form__photo-status {
    justify-self: stretch;
  }
  .studio-form__progress {
    margin: 0;
    font-size: var(--font-sm);
    font-weight: 600;
  }
  .studio-form__count {
    margin: 0 0 var(--space-3);
    font-size: var(--font-xs);
    color: var(--muted);
  }
  .studio-form__lost {
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    border: 0.0625rem solid var(--control-border);
  }
  @media (pointer: coarse) {
    .studio-form__hint,
    .studio-form__reason,
    .studio-form__count {
      font-size: var(--font-body);
    }
    .studio-form__add-step {
      min-height: var(--touch-target);
      font-size: var(--font-body);
    }
    .studio-form__variation {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

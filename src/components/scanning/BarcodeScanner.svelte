<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { t } from '../../lib/i18n';
  import ModalShell from '../ui/ModalShell.svelte';
  import Callout from '../ui/Callout.svelte';
  import { normalizeBarcode } from '../../lib/barcodes/barcodes';
  import { reloadApp } from '../../lib/pwa/update';
  import {
    CameraError,
    ScannerLoadError,
    ScannerUnsupportedError,
    lockdownModeLikely,
    scanningImpossible,
    loadDetector,
    SCAN_INTERVAL_MS,
    pickQr,
    qrFormats,
    repeatBarcode,
    type RepeatBarcode,
    watchForBarcode,
    type CameraProblem,
  } from '../../lib/barcodes/scanner';
  import { createCameraSession, type CameraPause } from '../../lib/barcodes/camera-session';

  interface Props {
    /** What the scan is for, e.g. "Find a glaze by barcode". */
    title: string;
    /** Receives the normalized barcode, scanned or typed; the camera is already stopped. */
    onBarcode: (barcode: string) => void;
    onClose: () => void;
    /**
     * Scan several codes in a row: after a code the camera stays open (it stops on close, unmount and every
     * pause: see `createCameraSession`) and scanning waits while `holding` is true. The host sets `holding` to false
     * to scan the next one.
     */
    keepOpen?: boolean;
    holding?: boolean;
    /** Shown instead of the hint and the typed field while a scanned code is held. */
    held?: Snippet;
    /** A short result of the last code (for example what was saved), shown above the hint. */
    note?: string;
    /** On phones, anchor the dialog to the bottom edge. */
    sheet?: boolean;
    /**
     * 'qr' reads the text of a QR code (the invite and buddy links) instead of a retail barcode: `onBarcode` then gets the
     * raw text, which the host must check before it opens anything, there is no typed field and the texts name the code.
     */
    mode?: 'barcode' | 'qr';
    /** QR mode: whether a text is worth handing over; with several codes in a frame the first valid one wins. */
    valid?: (text: string) => boolean;
    /** QR mode: changes with each refusal so the note is announced again, even when its text is the same. */
    noteKey?: number;
    /** A button beside the typed field for those who do not want to scan (barcode mode); the host closes the scanner and goes on. */
    skip?: { label: string; run: () => void };
  }

  let {
    title,
    onBarcode,
    onClose,
    keepOpen = false,
    holding = $bindable(false),
    held,
    note = '',
    sheet = false,
    mode = 'barcode',
    valid,
    noteKey = 0,
    skip,
  }: Props = $props();
  const id = $props.id();

  let video = $state<HTMLVideoElement>();
  /** The camera's state, or why it cannot be used ('load': the scanner code could not be loaded; 'paused': off until Resume). */
  let status = $state<'starting' | 'scanning' | 'paused' | 'load' | 'nowasm' | CameraProblem>('starting');
  let paused = $state<CameraPause>('away');
  let resumeButton = $state<HTMLButtonElement>();
  let typed = $state('');
  let typedInvalid = $state(false);
  const qr = $derived(mode === 'qr');
  let finished = false;
  /** The running scan; aborted by a pause, a handed-over code and unmount. */
  let scan: AbortController | null = null;
  let detecting: ReturnType<typeof loadDetector> | null = null;
  const camera = createCameraSession({
    onPause: (reason) => {
      scan?.abort();
      if (video) video.srcObject = null;
      paused = reason;
      status = 'paused';
    },
  });
  /** The resolver of the wait for `holding` to end. */
  let release: (() => void) | null = null;
  let modal: ModalShell;
  let wasHolding = false;
  let repeat: RepeatBarcode = { code: '', absentSince: null };

  function finish(barcode: string) {
    if (keepOpen) {
      if (holding) return;
      repeat = { code: barcode, absentSince: null };
      camera.activity();
      holding = true;
      typed = '';
      onBarcode(barcode);
      return;
    }
    if (finished) return;
    finished = true;
    scan?.abort();
    camera.stop();
    onBarcode(barcode);
  }

  $effect(() => {
    // A held code is the person reading or typing: the idle limit waits until it is released.
    camera.hold(holding);
    if (!holding) {
      release?.();
      release = null;
      if (wasHolding) void tick().then(() => modal?.focusClose());
    }
    wasHolding = holding;
  });

  // The camera runs only while the page is visible and this dialog mounted (`createCameraSession`): closing it,
  // leaving the route or unmounting the page aborts the scan and stops every track; a pause waits for Resume.
  async function run() {
    scan?.abort();
    const current = new AbortController();
    scan = current;
    if (scanningImpossible()) {
      status = 'nowasm';
      return;
    }
    status = 'starting';
    detecting ??= qr ? loadDetector(undefined, undefined, qrFormats) : loadDetector();
    detecting.catch(() => {});
    try {
      const stream = await camera.start();
      if (!stream) return;
      await tick();
      if (current.signal.aborted || !video) return camera.stop();
      video.srcObject = stream;
      await video.play().catch(() => {});
      const detector = await detecting;
      if (current.signal.aborted) return;
      status = 'scanning';
      while (!current.signal.aborted) {
        const barcode = await watchForBarcode(
          detector,
          video,
          current.signal,
          SCAN_INTERVAL_MS,
          (code) => {
            if (holding) return false;
            if (!keepOpen) return !!code;
            const blocked = repeat.code;
            repeat = repeatBarcode(repeat, code, Date.now());
            return !!code && code !== blocked;
          },
          () => released(current.signal),
          qr ? (codes) => pickQr(codes, valid) : undefined,
        );
        if (!barcode) break;
        finish(barcode);
        if (!keepOpen) return;
      }
    } catch (error) {
      if (current.signal.aborted) return;
      camera.stop();
      status =
        error instanceof CameraError
          ? error.problem
          : error instanceof ScannerUnsupportedError
            ? 'nowasm'
            : error instanceof ScannerLoadError
              ? 'load'
              : 'failed';
    }
  }

  onMount(() => {
    void run();
    return () => {
      scan?.abort();
      camera.dispose();
    };
  });

  /** The person's explicit restart after a pause; the focus stays in the dialog when the button goes. */
  async function resume() {
    const focused = document.activeElement === resumeButton;
    void run();
    await tick();
    if (focused) modal?.focusClose();
  }

  /** Resolves when the host lets scanning go on (`holding` false) or the scan is aborted. */
  function released(signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (!holding || signal.aborted) return resolve();
      const done = () => {
        signal.removeEventListener('abort', done);
        if (release === done) release = null;
        resolve();
      };
      release = done;
      signal.addEventListener('abort', done, { once: true });
    });
  }

  function submitTyped() {
    const barcode = normalizeBarcode(typed);
    typedInvalid = !barcode;
    if (barcode) finish(barcode);
  }

  const lockdown = lockdownModeLikely();
  const problems = $derived(
    qr
      ? ({
          insecure: 'links.scanner.insecure',
          unsupported: 'links.scanner.unsupported',
          denied: 'links.scanner.denied',
          missing: 'links.scanner.missing',
          failed: 'links.scanner.failed',
          load: 'links.scanner.loadFailed',
          nowasm: lockdown ? 'links.scanner.noWasmLockdown' : 'links.scanner.noWasm',
        } as const)
      : ({
          insecure: 'barcodes.scanner.insecure',
          unsupported: 'barcodes.scanner.unsupported',
          denied: 'barcodes.scanner.denied',
          missing: 'barcodes.scanner.missing',
          failed: 'barcodes.scanner.failed',
          load: 'barcodes.scanner.loadFailed',
          nowasm: lockdown ? 'barcodes.scanner.noWasmLockdown' : 'barcodes.scanner.noWasm',
        } as const),
  );
</script>

<ModalShell
  bind:this={modal}
  {title}
  {onClose}
  {sheet}>
  <div class="barcode-scanner">
    {#if status === 'starting' || status === 'scanning'}
      <!-- The compact strip suits a row of jars; a QR code is square and would be cut off in it. -->
      <div class={['barcode-scanner__camera', { 'barcode-scanner__camera--compact': keepOpen && !qr }]}>
        <video
          bind:this={video}
          class="barcode-scanner__video"
          muted
          playsinline
          aria-label={$t('barcodes.scanner.camera')}>
        </video>
        <!-- The line guides a row of bars; across a square QR code it only gets in the way. -->
        {#if !qr}
          <span
            class="barcode-scanner__guide"
            aria-hidden="true">
          </span>
        {/if}
      </div>
      {#if !(holding && held)}
        <p
          class="barcode-scanner__status"
          role="status">
          {#if note}
            {#key noteKey}
              <b class="barcode-scanner__note">{note}</b>
            {/key}
          {/if}
          {status === 'starting' ? $t('barcodes.scanner.starting') : $t(qr ? 'links.scanner.hint' : 'barcodes.scanner.hint')}
        </p>
      {/if}
    {:else if status === 'paused'}
      <div class="barcode-scanner__paused">
        <Callout tone="sage">
          <p
            class="barcode-scanner__paused-text"
            role="status">
            {$t(paused === 'idle' ? 'barcodes.scanner.pausedIdle' : 'barcodes.scanner.pausedAway')}
          </p>
          <button
            bind:this={resumeButton}
            type="button"
            class="button button--primary"
            onclick={(event) => {
              event.preventDefault();
              void resume();
            }}>
            {$t('barcodes.scanner.resume')}
          </button>
        </Callout>
      </div>
    {:else}
      <div
        class="barcode-scanner__problem"
        role="alert">
        <p class="barcode-scanner__problem-text">{$t(problems[status])}</p>
        {#if status === 'load'}
          <button
            type="button"
            class="button button--primary"
            onclick={(event) => {
              event.preventDefault();
              void reloadApp();
            }}>
            {$t('barcodes.scanner.reload')}
          </button>
        {/if}
      </div>
    {/if}
    {#if holding && held}
      {@render held()}
    {:else if !qr}
      <form
        class="barcode-scanner__manual"
        novalidate
        onsubmit={(event) => {
          event.preventDefault();
          submitTyped();
        }}>
        <label
          class="barcode-scanner__field"
          for="{id}-typed">
          {$t('barcodes.scanner.typeLabel')}
        </label>
        <div class="barcode-scanner__row">
          <input
            id="{id}-typed"
            class="form-field__control barcode-scanner__input"
            bind:value={typed}
            oninput={() => (typedInvalid = false)}
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
            maxlength="32"
            placeholder={$t('barcodes.placeholder')}
            aria-invalid={typedInvalid}
            aria-describedby="{id}-typed-hint" />
          <button
            class="button button--primary"
            disabled={!typed.trim()}>
            {$t('barcodes.scanner.use')}
          </button>
        </div>
        <small
          class={['barcode-scanner__hint', { 'barcode-scanner__hint--invalid': typedInvalid }]}
          id="{id}-typed-hint">
          {typedInvalid ? $t('barcodes.invalid') : $t('barcodes.hint')}
        </small>
      </form>
      {#if skip}
        <button
          type="button"
          class="button barcode-scanner__skip"
          onclick={skip.run}>
          {skip.label}
        </button>
      {/if}
    {/if}
  </div>
</ModalShell>

<style>
  .barcode-scanner__camera {
    position: relative;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--ink);
  }
  .barcode-scanner__camera--compact {
    aspect-ratio: 16 / 7;
  }
  .barcode-scanner__video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .barcode-scanner__guide {
    position: absolute;
    left: 10%;
    right: 10%;
    top: 50%;
    border-top: 0.125rem solid var(--danger-bg);
  }
  .barcode-scanner__status {
    margin: var(--space-2) 0 var(--space-4);
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .barcode-scanner__note {
    display: block;
    color: var(--ink);
  }
  .barcode-scanner__problem {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--warning-bg);
    color: var(--warning-ink);
  }
  .barcode-scanner__problem-text {
    margin: 0;
  }
  .barcode-scanner__paused {
    margin-bottom: var(--space-4);
  }
  .barcode-scanner__paused-text {
    margin: 0 0 var(--space-2);
  }
  .barcode-scanner__field {
    display: block;
    font-size: var(--font-base);
    font-weight: 550;
  }
  /* The field keeps room for a whole code and its example; a long button label wraps below it instead of squeezing it. */
  .barcode-scanner__row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .barcode-scanner__input {
    min-width: 0;
    flex: 1 1 13rem;
  }
  .barcode-scanner__skip {
    margin-top: var(--space-3);
  }
  .barcode-scanner__hint {
    display: block;
    margin-top: var(--space-1);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  .barcode-scanner__hint--invalid {
    color: var(--danger-ink);
  }
  @media (pointer: coarse) {
    .barcode-scanner__hint {
      font-size: var(--font-body);
    }
  }
</style>

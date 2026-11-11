import type { AppController } from '../app/app-controller';
import { formErrorFor, type AppState } from '../app/app-state';
import { published } from '../../lib/explore/explore';
import { countTags } from '../../lib/tags/tags';

type HostApp = Pick<AppController, 'clearFormError' | 'registerLeaveGuard' | 'openUpload' | 'addGlaze'>;

/**
 * Call while a page initializes. The page hosting `AddGlazeDialog` (Discover, Stock, Studio) keeps
 * what it opened the dialog for in `target` (null: closed; `open` takes the host's own details, such
 * as a scanned barcode or the Studio step) and renders the dialog outside every loading branch:
 *
 *     {#if add.target && user}
 *       <AddGlazeDialog {...add.props} … bind:dirty={add.dirty} />
 *     {/if}
 *
 * `dirty` is the dialog's unsaved-input flag (bound), guarded for leaving the page. The dialog closes
 * when the account changes (`account` is the primitive ID, never the user object). The page passes
 * getters (`() => app`, `() => $appStore`, `() => accountId`), so props that change are read lazily.
 */
export function createAddGlazeHost<T extends object>(host: () => HostApp, state: () => AppState, account: () => string | undefined) {
  let target = $state<T | null>(null);
  let dirty = $state(false);
  // Each field through one `$derived`: a store patch elsewhere (a toast) counts nothing again.
  let glazes = $derived(state().glazes);
  let combinations = $derived(state().combinations);
  let tagCounts = $derived(countTags(glazes, published(combinations)));

  $effect(() => host().registerLeaveGuard({ dirty: () => dirty, message: 'drafts.discardGlaze' }));
  $effect(() => {
    account();
    target = null;
    dirty = false;
  });

  function open(next: T) {
    host().clearFormError();
    target = next;
  }
  function close() {
    host().clearFormError();
    target = null;
    dirty = false;
  }

  return {
    get target() {
      return target;
    },
    get dirty() {
      return dirty;
    },
    set dirty(value: boolean) {
      dirty = value;
    },
    open,
    close,
    /** The dialog props every host shares; the host adds its own after the spread. */
    get props() {
      const current = state();
      return {
        accountId: current.user?.id ?? '',
        glazes: current.glazes,
        clubs: current.clubs,
        tagCounts,
        online: current.online,
        error: formErrorFor(current, 'glaze'),
        onSubmit: host().addGlaze,
        onAddPhoto: host().openUpload,
        onClose: close,
      };
    },
  };
}

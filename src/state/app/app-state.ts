import { writable } from 'svelte/store';
import { DEFAULT_UPLOAD_VISIBILITY, type UploadVisibility } from '../../lib/images/upload-queue';
import type {
  AuthOptions,
  Buddies,
  BuddyAvailability,
  Favorites,
  Club,
  ClubMember,
  ClubWishlist,
  Combination,
  Glaze,
  GlazeCreated,
  ImageInfo,
  StockItem,
  UploadTarget,
  User,
} from '../../lib/api/models';
import type { MessageKey } from '../../lib/i18n';
import type { LeaveQuestion } from '../../lib/studio/held-save';
import { parseRoute, type Route } from '../../lib/routing/routes';
import { termsVersion } from '../../lib/api/terms';
import { emptyBuddies } from '../../lib/buddies/buddies';
import { emptyAvailability } from '../../lib/stock/buddy-shelf';
import type { RequestToast } from '../../lib/feed/request-toast';
import { glazeOrder, withGlazeNames } from '../../lib/sync/sync';
import { INITIAL_SYNC, isLoading, type LoadFailure, type SyncState } from '../../lib/sync/lifecycle';

/** Forms whose failed submit shows its error inside the form, next to the submit button. */
export type FormName =
  | 'glaze'
  | 'stock'
  | 'club'
  | 'combination'
  | 'combination-title'
  | 'upload'
  | 'image-details'
  | 'image-kind'
  | 'image-focus'
  | 'image-visibility'
  | 'image-report'
  | 'image-remove'
  | 'glaze-edit'
  | 'glaze-history'
  | 'glaze-remove'
  | 'invite'
  | 'buddy'
  | 'buddies'
  | 'buddy-link'
  | 'auth'
  | 'account-mail'
  | 'account-link'
  | 'password-change'
  | 'terms'
  | 'account-delete'
  | 'avatar'
  | 'diagnostics'
  | 'feed'
  | 'feed-settings'
  | 'image-deletions'
  | 'image-reports'
  | 'avatar-reports'
  | 'avatar-report'
  | 'ban'
  | 'bans'
  | 'unban'
  | 'users'
  | 'error-reports'
  | 'error-report-delete'
  | 'feedback'
  | 'admin-feedback'
  | 'admin-feedback-change'
  | 'wishlist-load'
  | 'wishlist-add'
  | 'wishlist-remove'
  | 'wishlist-acquired'
  | ClubFormName
  | BuddyMemberFormName;

/** Sections of one club's settings; each club names its own, so open panels never share an error. */
export type ClubSection = 'settings' | 'invite' | 'members' | 'leave';
export type ClubFormName = `club-${ClubSection}:${string}`;
export const clubForm = (section: ClubSection, clubId: string): ClubFormName => `club-${section}:${clubId}`;

/** A club member's "Ask to be buddies": the failure shows at that member's row. */
export type BuddyMemberFormName = `buddy-member:${string}`;
export const buddyMemberForm = (userId: string): BuddyMemberFormName => `buddy-member:${userId}`;

/** A mail-free registration waiting for its first password. */
export interface AccountSetup {
  email: string;
  displayName: string;
}

/** A page with unsaved input: `dirty` reports it; `message` asks whether to discard it (`body` and `leave` word a question that is not about a discard). */
export interface LeaveGuard extends LeaveQuestion {
  dirty: () => boolean;
  /** Explicitly discarding a form also removes its local recovery. */
  discard?: () => void;
}

/** A failed form submit: the message (`errorText` translates it) belongs to that form, not the banner. */
export interface FormError {
  form: FormName;
  message: string;
}

/** The message of the last failed submit of `form`, or '' when another form (or none) failed. */
export function formErrorFor(state: Pick<AppState, 'formError'>, form: FormName): string {
  return state.formError?.form === form ? state.formError.message : '';
}

/** Unreachable (status 0) is offline, 429 is rate limited, anything else (5xx, unexpected) is a server error. */
export function loadFailureOf(error: unknown): LoadFailure {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 429) return 'rateLimited';
  if (status === 0) return 'offline';
  return 'server';
}

export interface AppState {
  /**
   * The sync lifecycle (`lib/sync/lifecycle.ts`: loading with progress, refreshing, idle, each with the last failure), read through
   * its selectors; written only by the controller's dispatcher (`step`), never by a `patch`. `online` is separate.
   */
  sync: SyncState;
  /** Mirrors the URL hash; only the controller's navigate() and hashchange listener set it. */
  route: Route;
  /** Previous entry recorded during this controller session; never an account-token route. */
  previousRoute: Route | null;
  user: User | null;
  online: boolean;
  glazes: Glaze[];
  combinations: Combination[];
  stock: StockItem[];
  clubs: Club[];
  /** The member list of each of the account's clubs, by club ID (readable by every member; saved offline). */
  clubMembers: Record<string, ClubMember[]>;
  /**
   * The wishlist of each club whose page was opened this session, by club ID: a page fetch (online), patched by the wishlist
   * writes; memory only, never in the snapshot, so offline a club page shows only what this session read.
   */
  clubWishlists: Record<string, ClubWishlist>;
  /** Accepted buddies and the pending requests both ways, with whether a buddy link exists (saved offline, like the member lists). */
  buddies: Buddies;
  /** Which accepted buddies have which glaze and when it was read (27-3): a full fetch with the listings, saved offline, never part of the synced views. */
  buddyAvailability: BuddyAvailability;
  /** The profile picture of each author of a published combination, by account ID (31-3; a full fetch with the lists, saved offline, never part of the synced views). */
  authorAvatars: Record<string, string>;
  favorites: Favorites;
  favoriteCounts?: import('../../lib/api/models').FavoriteCounts;
  /** A message key set by the app, or a server message; `errorText` translates both. */
  error: string;
  /** The last failed form submit; the form shows it and the banner does not. */
  formError: FormError | null;
  /** Navigation waiting for "Discard" because the page has unsaved input (see LeaveGuard). */
  leaving: ({ route: Route; replace: boolean } & LeaveQuestion) | null;
  storageWarning: boolean;
  /**
   * A sign-out of this device is still finishing (LOGOUT-1): its local clean-up, or the request that ends the server session. The
   * cache clearing that follows it (`Clear-Site-Data`, which the browser may hold for seconds, LOGOUT-2) is not part of it. The account
   * is already gone from the state.
   */
  signingOut: boolean;
  toast: MessageKey | '';
  /** The numbers a notice names (`{count}`), if any. */
  toastValues: Record<string, number | string>;
  /** A new buddy request the badge poll found (FEED-2, `lib/feed/request-toast.ts`): shown until dismissed or answered; reset by an account change. */
  requestToast: RequestToast | null;
  authOpen: boolean;
  /**
   * Why the sign-in dialog opened by itself (23-72b): the server ended the session (`sessionEnded`), or ended it while a page holds
   * unsaved input that stays until the writer signs in again (`sessionEndedKept`). Null otherwise; cleared with the dialog.
   */
  authNotice: 'sessionEnded' | 'sessionEndedKept' | null;
  /**
   * The password step of a mail-free registration (email and the name typed at sign-up). Its setup token stays
   * in the controller's memory, never in this store, a route, history or storage; reset by an account change.
   */
  accountSetup: AccountSetup | null;
  uploadFor: UploadTarget | null;
  /** The last visibility chosen in an upload dialog this session; a new account starts at the default again. */
  uploadVisibility: UploadVisibility;
  removingImage: ImageInfo | null;
  /** The delete-account dialog is open. */
  deletingAccount: boolean;
  /** The change-password dialog is open (closed by a page change and an account change). */
  changingPassword: boolean;
  /** The feedback dialog is open (closed by a page change and an account change; its draft stays in the controller's memory). */
  feedbackOpen: boolean;
  /** The public sign-in options and operator contact: `undefined` until requested, `null` when they could not be loaded. */
  authOptions: AuthOptions | null | undefined;
  /** The API refused a write (428) because the account must accept the current terms first. */
  termsRequired: boolean;
}

/**
 * Everything one account owns and the listings show. Sign-out, an account change and a failed
 * session check reset it all, so none of them can forget a private listing.
 */
export function emptyAccountData(): Pick<
  AppState,
  | 'glazes'
  | 'combinations'
  | 'stock'
  | 'clubs'
  | 'clubMembers'
  | 'clubWishlists'
  | 'buddies'
  | 'buddyAvailability'
  | 'authorAvatars'
  | 'favorites'
  | 'favoriteCounts'
> {
  return {
    glazes: [],
    combinations: [],
    stock: [],
    clubs: [],
    clubMembers: {},
    clubWishlists: {},
    buddies: emptyBuddies(),
    buddyAvailability: emptyAvailability(),
    authorAvatars: {},
    favorites: { glazeIds: [], combinationIds: [] },
    favoriteCounts: { glazes: [], combinations: [] },
  };
}

function initialState(): AppState {
  return {
    route: parseRoute(globalThis.location?.hash ?? ''),
    previousRoute: null,
    user: null,
    online: true,
    sync: INITIAL_SYNC,
    ...emptyAccountData(),
    error: '',
    formError: null,
    leaving: null,
    storageWarning: false,
    signingOut: false,
    toast: '',
    toastValues: {},
    requestToast: null,
    authOpen: false,
    authNotice: null,
    accountSetup: null,
    uploadFor: null,
    uploadVisibility: DEFAULT_UPLOAD_VISIBILITY,
    removingImage: null,
    deletingAccount: false,
    changingPassword: false,
    feedbackOpen: false,
    termsRequired: false,
    authOptions: undefined,
  };
}

/** What `patch` may change: everything but the sync state, which only the sync dispatcher writes. */
export type AppPatch = Partial<Omit<AppState, 'sync'>>;

export function createAppState() {
  return writable(initialState());
}

/**
 * What an account page shows: until a load has finished, an empty list only means
 * the current account's data has not arrived yet, so it shows loading, not "empty".
 */
export function listStatus(loading: boolean, items: readonly unknown[]): 'loading' | 'empty' | 'items' {
  if (items.length) return 'items';
  return loading ? 'loading' : 'empty';
}

/** A reload (e.g. after a write) while a list is shown: it stays on screen with a small hint. */
export function refreshing(loading: boolean, items: readonly unknown[]): boolean {
  return loading && items.length > 0;
}

/**
 * Whether the signed-in account must accept the current terms before writing: it accepted none
 * (accounts from before terms were recorded) or an older version, or the API refused a write
 * for that reason. Offline mode is read-only, so the dialog waits until the API is reachable.
 * A user saved on this device before the version was exposed has none (undefined): unknown, so
 * only the server's answer, or its 428 refusal, asks for acceptance.
 */
export function termsPending(state: Pick<AppState, 'user' | 'online' | 'termsRequired'>): boolean {
  return (
    !!state.user && state.online && (state.termsRequired || (state.user.acceptedTermsVersion !== undefined && state.user.acceptedTermsVersion !== termsVersion))
  );
}

/** Nobody is signed in and the session is settled, so a detail page may invite the visitor to sign in. */
export function isGuest(state: Pick<AppState, 'user' | 'sync'>): boolean {
  return !state.user && !isLoading(state.sync);
}

/** The listings after a glaze was removed: its stock rows and favorite go with it. */
export function withoutGlaze(state: Pick<AppState, 'glazes' | 'stock' | 'favorites'>, id: string): Pick<AppState, 'glazes' | 'stock' | 'favorites'> {
  return {
    glazes: state.glazes.filter((glaze) => glaze.id !== id),
    stock: state.stock.filter((entry) => entry.glazeId !== id),
    favorites: {
      ...state.favorites,
      glazeIds: state.favorites.glazeIds.filter((glazeId) => glazeId !== id),
    },
  };
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * The listings after a glaze was added, in the API's order (manufacturer, then name): the created glaze
 * and the shelf entry saved with it. Other items keep their identity, so open lists do not rebuild.
 */
export function withNewGlaze(state: Pick<AppState, 'glazes' | 'stock'>, created: GlazeCreated): Pick<AppState, 'glazes' | 'stock'> {
  const { glaze } = created;
  const added = new Set(created.stock.map((entry) => entry.id));
  return {
    glazes: [...state.glazes.filter((item) => item.id !== glaze.id), glaze].sort(glazeOrder),
    stock: [...state.stock.filter((entry) => !added.has(entry.id)), ...created.stock].sort(
      (a, b) => byName(a.manufacturer, b.manufacturer) || byName(a.name, b.name),
    ),
  };
}

/**
 * The listings after a glaze was corrected: the answered glaze in its place, in the API's order (a new name
 * may move it), and the name its steps and shelf entries carry. Items of other glazes keep their identity.
 */
export function withCorrectedGlaze(
  state: Pick<AppState, 'glazes' | 'combinations' | 'stock'>,
  glaze: Glaze,
): Pick<AppState, 'glazes' | 'combinations' | 'stock'> {
  if (!state.glazes.some((item) => item.id === glaze.id)) return state;
  const renamed = (item: StockItem): StockItem => (item.glazeId === glaze.id && item.name !== glaze.name ? { ...item, name: glaze.name } : item);
  return {
    glazes: state.glazes.map((item) => (item.id === glaze.id ? glaze : item)).sort(glazeOrder),
    combinations: withGlazeNames(state.combinations, [glaze]),
    stock: state.stock.map(renamed),
  };
}

/**
 * The listings after a combination's title was corrected: the new title on that combination only (listings are ordered by
 * time, so nothing moves); other items keep their identity. A combination no longer listed changes nothing.
 */
export function withCombinationTitle(state: Pick<AppState, 'combinations'>, id: string, title: string): Pick<AppState, 'combinations'> {
  if (!state.combinations.some((combo) => combo.id === id && combo.title !== title)) return state;
  return { combinations: state.combinations.map((combo) => (combo.id === id ? { ...combo, title } : combo)) };
}

/**
 * The listings after a picture was uploaded: the returned picture goes first on its glaze or combination
 * (listings are newest first). A target no longer listed (removed meanwhile) changes nothing.
 */
export function withNewImage(
  state: Pick<AppState, 'glazes' | 'combinations'>,
  target: Pick<UploadTarget, 'type' | 'id'>,
  image: ImageInfo,
): Pick<AppState, 'glazes' | 'combinations'> {
  const added = <T extends { id: string; images: ImageInfo[] }>(item: T): T =>
    item.id === target.id && !item.images.some((current) => current.id === image.id) ? { ...item, images: [image, ...item.images] } : item;
  return target.type === 'glaze'
    ? { glazes: state.glazes.map(added), combinations: state.combinations }
    : { glazes: state.glazes, combinations: state.combinations.map(added) };
}

/** The listings with one picture replaced, e.g. after its visibility changed (maybe under a new ID). */
export function withImage(state: Pick<AppState, 'glazes' | 'combinations'>, id: string, image: ImageInfo): Pick<AppState, 'glazes' | 'combinations'> {
  const replaced = <T extends { images: ImageInfo[] }>(item: T): T =>
    item.images.some((current) => current.id === id) ? { ...item, images: item.images.map((current) => (current.id === id ? image : current)) } : item;
  return { glazes: state.glazes.map(replaced), combinations: state.combinations.map(replaced) };
}

/** Every picture URL the listings show; saved copies of other pictures are dropped. */
export function shownImageUrls(state: Pick<AppState, 'glazes' | 'combinations'>): string[] {
  return [...state.glazes, ...state.combinations].flatMap((item) => item.images.map((image) => image.url));
}

/** Remove a picture wherever it occurs, including a combination shown on a glaze card. */
export function withoutImage(state: Pick<AppState, 'glazes' | 'combinations'>, id: string) {
  const removed = <T extends { images: ImageInfo[] }>(item: T): T => ({
    ...item,
    images: item.images.filter((image) => image.id !== id),
  });
  return { glazes: state.glazes.map(removed), combinations: state.combinations.map(removed) };
}

/**
 * The listings after the account left a club: the club, its member list and wishlist, its shelf and the photos shared with that
 * club only go at once (the API shows club photos to members only, the account's own included), so neither the page,
 * the snapshot nor the picture cache keeps them until the next load.
 */
export function withoutClub(
  state: Pick<AppState, 'glazes' | 'combinations' | 'stock' | 'clubs' | 'clubMembers' | 'clubWishlists'>,
  clubId: string,
): Pick<AppState, 'glazes' | 'combinations' | 'stock' | 'clubs' | 'clubMembers' | 'clubWishlists'> {
  const hidden = (image: ImageInfo) => image.visibility === 'CLUB' && image.clubId === clubId;
  const visible = <T extends { images: ImageInfo[] }>(item: T): T =>
    item.images.some(hidden) ? { ...item, images: item.images.filter((image) => !hidden(image)) } : item;
  return {
    glazes: state.glazes.map(visible),
    combinations: state.combinations.map(visible),
    stock: state.stock.filter((entry) => entry.clubId !== clubId),
    clubs: state.clubs.filter((club) => club.id !== clubId),
    clubMembers: Object.fromEntries(Object.entries(state.clubMembers).filter(([id]) => id !== clubId)),
    clubWishlists: Object.fromEntries(Object.entries(state.clubWishlists).filter(([id]) => id !== clubId)),
  };
}

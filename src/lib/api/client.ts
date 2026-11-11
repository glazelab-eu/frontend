import { client } from '../generated/client.gen';
import * as sdk from '../generated/sdk.gen';
import type {
  GlazeInput,
  GlazeChange,
  StockInput,
  StockAddInput,
  CombinationInput,
  ImageUploadInput,
  TagChange,
  BarcodeChange,
  ImageVisibilityChange,
  ImageDetailsChange,
  WishlistInput,
} from './inputs';
import type { AvatarReport, ImageInfo, UploadTarget } from './models';
import { termsVersion } from './terms';
import type { FeedbackContext } from '../feedback/feedback';
import type { ClubSettings, RoleInput, Register, ReportBatch } from '../generated/types.gen';
import { hasArrays, isAccount, isJsonType, isList, isSyncAnswer } from './answers';

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    /** A 429's `Retry-After` in milliseconds (whole seconds only), when the answer named one. */
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** What a failed request shows: the API's (or the client's) message, else the generic message key. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'errors.generic';
}

/** The API's 403 to a write whose CSRF token it no longer knows (also to a refused permission, which a repeat cannot change). */
export const ACCESS_DENIED = 'Access denied. Refresh your session and try again.';
const CSRF_HEADER = 'X-XSRF-TOKEN';
const isSafe = (method: string) => ['GET', 'HEAD', 'OPTIONS'].includes(method);

let csrfToken: Promise<string> | undefined;
export function resetCsrf() {
  csrfToken = undefined;
}

/** The page's CSRF token: fetched once and shared until `resetCsrf` (a failed fetch is forgotten at once). */
function currentToken(): Promise<string> {
  const token: Promise<string> = (csrfToken ??= sdk
    .csrf({ throwOnError: true })
    .then(({ data }) => data.token)
    .catch((error) => {
      if (csrfToken === token) resetCsrf();
      throw error;
    }));
  return token;
}

const refusesToken = async (response: Response) =>
  response.status === 403 &&
  (await response
    .clone()
    .json()
    .then((body: unknown) => !!body && typeof body === 'object' && 'error' in body && body.error === ACCESS_DENIED)
    .catch(() => false));

/**
 * Sends a request; a write the API refuses with its CSRF answer goes once more with a fresh token (FE-4): another tab's sign-in,
 * sign-out or link confirmation replaced the cookie this page's token matched. Never a second repeat: a refusal of the fresh token
 * (or a failed token fetch) is the answer. Writes refused together share one fresh token.
 */
async function send(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // The generated client always passes one Request.
  const request = input instanceof Request && !init ? input : new Request(input, init);
  if (isSafe(request.method)) return globalThis.fetch(request);
  // The body is read once into bytes: a cloned Request would send a stream (no Content-Length), and the repeat needs the same body.
  // Never test `request.body`: Firefox has no such getter, and its writes would go out empty.
  const bytes = await request.arrayBuffer();
  const body = bytes.byteLength ? bytes : undefined;
  const copy = (headers: Headers) =>
    new Request(request.url, { method: request.method, headers, body, credentials: request.credentials, signal: request.signal, cache: request.cache });
  const response = await globalThis.fetch(copy(new Headers(request.headers)));
  if (!(await refusesToken(response))) return response;
  const cached = csrfToken;
  if (cached && (await cached.catch(() => undefined)) === request.headers.get(CSRF_HEADER) && csrfToken === cached) resetCsrf();
  const headers = new Headers(request.headers);
  try {
    headers.set(CSRF_HEADER, await currentToken());
  } catch {
    return response;
  }
  return globalThis.fetch(copy(headers));
}

client.setConfig({
  baseUrl: globalThis.location?.origin ?? 'http://localhost',
  credentials: 'same-origin',
  fetch: send,
});

client.interceptors.request.use(async (request) => {
  if (!isSafe(request.method)) request.headers.set(CSRF_HEADER, await currentToken());
  return request;
});

/** The API's rate-limit message (429); also used when a proxy answers 429 without one. */
/** The API's 429 for a sign-in delayed by repeated failures (`SignInDelays.DELAYED`): the only 429 text the client keeps. */
export const SIGN_IN_DELAYED = 'Too many failed sign-ins for this address. Please wait a few minutes or sign in with an email link.';
export const TOO_MANY_REQUESTS = 'Too many requests. Please wait a moment and try again.';
const UNREACHABLE = 'The server is unreachable. Showing saved data when available.';

/** A 2xx answer that is not the API's data (a proxy's page, a captive portal, the tarpit decoy): a failed request, status 0. */
export const unexpectedAnswer = () => new ApiError(UNREACHABLE, 0);

/** A 2xx answer with a body that is not JSON never reaches the parser, except where a picture's bytes are asked for (`parseAs: 'stream'`). */
client.interceptors.response.use((response, _request, options) => {
  const type = response.headers.get('Content-Type');
  if (response.ok && type && options.parseAs !== 'stream' && !isJsonType(type)) throw unexpectedAnswer();
  return response;
});

client.interceptors.error.use((error, response) => {
  if (error instanceof ApiError) return error;
  const status = response?.status ?? 0;
  const message = error && typeof error === 'object' && 'error' in error && typeof error.error === 'string' ? error.error : undefined;
  // Every 429 reads as the rate limit, except the sign-in delay's own text (a proxy's or a stub's wording is not a known message).
  if (status === 429) {
    const seconds = Number(response?.headers.get('Retry-After') ?? NaN);
    return new ApiError(message === SIGN_IN_DELAYED ? message : TOO_MANY_REQUESTS, 429, Number.isInteger(seconds) && seconds > 0 ? seconds * 1000 : undefined);
  }
  if (!response || (status >= 500 && !message)) {
    return new ApiError(UNREACHABLE);
  }
  return new ApiError(message ?? (status === 401 ? 'Please sign in.' : 'Request failed.'), status);
});

const data = <T>(result: { data: T }) => result.data;
/** The answer's data when `valid` accepts its shape, else an unexpected answer (a failed request: nothing applied or saved). */
const checked =
  (valid: (value: unknown) => boolean) =>
  <T>(result: { data: T }): T => {
    if (!valid(result.data)) throw unexpectedAnswer();
    return result.data;
  };
const list = checked(isList);
const options = { throwOnError: true } as const;

// All paths, serializers, payloads, and response types come from the generated SDK.
export const ACTIVATION_REQUIRED = 'Set a fresh password and your display name to activate this account.';
/** What activates a pending account: the mailbox owner's first password and name, the terms this app shows and the error-report choice. */
export interface ActivationSetup {
  password: string;
  displayName: string;
  termsAccepted: boolean;
  diagnosticsOptIn: boolean;
}
const activation = (setup?: ActivationSetup) => (setup ? { ...setup, termsVersion } : {});

export const api = {
  requestMagicLink: (email: string) => sdk.requestMagicLink({ ...options, body: { email } }).then(data),
  confirmMagicLink: (token: string, setup?: ActivationSetup) => sdk.confirmMagicLink({ ...options, body: { token, ...activation(setup) } }).then(data),
  authOptions: () => sdk.options(options).then(data),
  operatorContact: () => sdk.operatorContact(options).then(data),
  requestPassword: (email: string) => sdk.requestPassword({ ...options, body: { email } }).then(data),
  requestVerification: (email: string) => sdk.requestVerification({ ...options, body: { email } }).then(data),
  /** A reset of an active account sends the password only; a pending one's activation sends the whole setup. */
  resetPassword: (token: string, password: string, setup?: ActivationSetup) =>
    sdk.resetPassword({ ...options, body: { token, password, ...activation(setup) } }).then(data),
  verifyEmail: (token: string, setup?: ActivationSetup) => sdk.verifyEmail({ ...options, body: { token, ...activation(setup) } }).then(data),
  me: () => sdk.me(options).then(checked(isAccount)),
  acceptTerms: () => sdk.acceptTerms({ ...options, body: { termsVersion } }).then(data),
  glazes: () => sdk.glazes(options).then(list),
  /** The glaze and combination changes since `point` (a delta), or a resync answer with a fresh start point when `point` is absent. */
  sync: (point?: { cursor: string; epoch: string; format: number }) =>
    sdk.sync({ ...options, query: point ? { since: point.cursor, epoch: point.epoch, format: point.format } : {} }).then(checked(isSyncAnswer)),
  /** One page of the combination listing by ID after `after` (null: the first page), for a paged full load. */
  combinationPage: (after: string | null, limit: number) =>
    sdk.combinationPage({ ...options, query: { ...(after ? { after } : {}), limit } }).then(checked(hasArrays('combinations'))),
  stock: () => sdk.stock(options).then(list),
  clubs: () => sdk.clubs(options).then(list),
  favorites: () => sdk.favorites(options).then(checked(hasArrays('glazeIds', 'combinationIds'))),
  favoriteCounts: () => sdk.favoriteCounts(options).then(checked(hasArrays('glazes', 'combinations'))),
  setFavorite: (kind: 'glazes' | 'combinations', id: string, active: boolean) => {
    const action = kind === 'glazes' ? (active ? sdk.favoriteGlaze : sdk.unfavoriteGlaze) : active ? sdk.favoriteCombination : sdk.unfavoriteCombination;
    return action({ ...options, path: { id } }).then(data);
  },
  health: () => sdk.health(options).then(data),
  /** The full size (detail gallery) or the card size (covers and thumbnails) of a picture. */
  image: (id: string, size: 'full' | 'card' = 'full', signal?: AbortSignal) =>
    (size === 'card' ? sdk.viewCard : sdk.view)({ ...options, path: { id }, parseAs: 'stream', signal }).then(({ response }) => response),
  /** A profile picture's 256 px size (the account page) or its 64 px size (header and lists). */
  avatar: (id: string, size: 'full' | 'small' = 'full', signal?: AbortSignal) =>
    (size === 'small' ? sdk.smallAvatar : sdk.avatar)({ ...options, path: { id }, parseAs: 'stream', signal }).then(({ response }) => response),
  /** The profile picture of each author of a published combination (`[{userId, avatarId}]`). */
  authorAvatars: () => sdk.authorAvatars(options).then(list),
  /** Reports someone else's picture (once per reporter; the reason is optional). */
  reportAvatar: (id: string, reason: string | null) => sdk.reportAvatar({ ...options, path: { id }, body: { reason } }).then(data),
  /** One page of the profile-picture report queue (site admins), newest first; the status narrows it. */
  avatarReports: (page = 0, status?: AvatarReport['status']) => sdk.avatarReports({ ...options, query: { page, ...(status ? { status } : {}) } }).then(data),
  /** Bans an account (site admins): the account is removed like an own deletion and its address blocked; `blockPictures` also blocks its reported profile pictures. */
  ban: (id: string, reason: string, blockPictures: boolean) => sdk.ban({ ...options, path: { id }, body: { reason, blockPictures } }).then(data),
  /** One page of the bans (site admins), newest first; never an address. */
  bans: (page = 0) => sdk.bans({ ...options, query: { page } }).then(data),
  /** The error reports grouped by message (site admins), most recently received first; the filters narrow the rows before they are grouped. */
  errorReportGroups: (page = 0, filter: { kind?: 'ERROR' | 'WARNING' | 'UNHANDLED_REJECTION'; build?: string; q?: string } = {}) =>
    sdk.errorReportGroups({ ...options, query: { page, ...filter } }).then(data),
  errorReportBuilds: () => sdk.errorReportBuilds(options).then(data),
  /** One message's reports with stack and device facts, newest first. */
  errorReportOccurrences: (fingerprint: string, page = 0) => sdk.errorReportOccurrences({ ...options, path: { fingerprint }, query: { page } }).then(data),
  deleteErrorReportGroup: (fingerprint: string) => sdk.deleteErrorReportGroup({ ...options, path: { fingerprint } }).then(data),
  deleteErrorReport: (id: string) => sdk.deleteErrorReport({ ...options, path: { id } }).then(data),
  /** One page of the account list (site admins), by display name; `q` keeps the accounts whose name or email contains it. */
  adminUsers: (page = 0, q = '') => sdk.adminUsers({ ...options, query: { page, ...(q ? { q } : {}) } }).then(data),
  /** Lifts a ban: the address may register again (the removed account does not come back). */
  unban: (id: string) => sdk.unban({ ...options, path: { id } }).then(data),
  dismissAvatarReport: (id: string) => sdk.dismissAvatarReport({ ...options, path: { id } }).then(data),
  /** Removes the reported picture (when still current) and blocks it, for every open report of that picture. */
  removeReportedAvatar: (id: string) => sdk.removeReportedAvatar({ ...options, path: { id } }).then(data),
  /** Stores the account's picture (a square the client cut); answers its new ID. The previous picture is gone with it. */
  uploadAvatar: (file: File) => sdk.uploadAvatar({ ...options, body: { file } }).then(data),
  removeAvatar: (id: string) => sdk.removeAvatar({ ...options, path: { id } }).then(data),
  /** Turns the account's error reports on or off (off also deletes the reports already stored). */
  chooseDiagnostics: (enabled: boolean) => sdk.chooseDiagnostics({ ...options, body: { enabled } }).then(data),
  /** One page of the activity feed, newest first; `before` is the previous page's `next`. */
  feed: (before?: string) => sdk.feed({ ...options, query: before ? { before } : {} }).then(data),
  /** The badge alone (count and newest unread entry), for the light poll while the app is open. */
  feedBadge: () => sdk.feedBadge(options).then(data),
  /** The account saw the feed up to `through` (an entry's time): later entries stay new. */
  markFeedSeen: (through: string) => sdk.markFeedSeen({ ...options, body: { through } }).then(data),
  chooseFeed: (buddies: boolean, clubs: boolean) => sdk.chooseFeed({ ...options, body: { buddies, clubs } }).then(data),
  /** Sends one batch of error reports; answers the status (0: unreachable) and a 429's Retry-After seconds, never throws. */
  sendReports: async (batch: ReportBatch): Promise<{ status: number; retryAfter?: number }> => {
    try {
      const { response } = await sdk.sendReports({ body: batch });
      const wait = Number(response?.headers.get('Retry-After'));
      return { status: response?.status ?? 0, ...(Number.isFinite(wait) && wait > 0 ? { retryAfter: wait } : {}) };
    } catch {
      return { status: 0 };
    }
  },
  /** Sends a feedback (signed in): the text, the context unless left out, and up to three photos already shrunk on the device. */
  sendFeedback: (input: { message: string; context: FeedbackContext | null; photos: File[] }) =>
    sdk.sendFeedback({ ...options, body: { message: input.message, ...(input.context ?? {}), files: input.photos } }).then(data),
  /** One page of the feedback (site admins), newest first; the status narrows it. */
  adminFeedback: (page = 0, status?: 'OPEN' | 'DONE') => sdk.feedbackList({ ...options, query: { page, ...(status ? { status } : {}) } }).then(data),
  markFeedback: (id: string, status: 'OPEN' | 'DONE') => sdk.markFeedback({ ...options, path: { id }, body: { status } }).then(data),
  deleteFeedback: (id: string) => sdk.deleteFeedback({ ...options, path: { id } }).then(data),
  register: (body: Register) => sdk.register({ ...options, body }).then(data),
  login: (email: string, password: string) => sdk.login({ ...options, body: { email, password } }).then(data),
  logout: () => sdk.logout(options).then(data),
  /**
   * Asks the browser to empty its HTTP cache of this origin (`Clear-Site-Data: "cache"`, LOGOUT-2), after a sign-out or an account
   * deletion. The browser may hold the answer for seconds while it does: callers never await it. Best effort, never throws.
   */
  clearBrowserCache: (): Promise<void> =>
    sdk.clearBrowserCache(options).then(
      () => undefined,
      () => undefined,
    ),
  deleteAccount: (password: string) => sdk.deleteAccount({ ...options, body: { password } }).then(data),
  changePassword: (currentPassword: string, newPassword: string) => sdk.changePassword({ ...options, body: { currentPassword, newPassword } }).then(data),
  addGlaze: (body: GlazeInput) => sdk.addGlaze({ ...options, body }).then(data),
  glazeByBarcode: (barcode: string) => sdk.glazeByBarcode({ ...options, path: { barcode } }).then(data),
  correctGlaze: (id: string, body: GlazeChange) => sdk.correctGlaze({ ...options, path: { id }, body }).then(data),
  glazeHistory: (id: string) => sdk.glazeHistory({ ...options, path: { id } }).then(data),
  editBarcodes: (id: string, body: BarcodeChange) => sdk.editGlazeBarcodes({ ...options, path: { id }, body }).then(data),
  imageDeletions: (page = 0) => sdk.imageDeletions({ ...options, query: { page } }).then(data),
  imageReports: (page = 0) => sdk.imageReports({ ...options, query: { page } }).then(data),
  dismissImageReport: (id: string) => sdk.dismissImageReport({ ...options, path: { id } }).then(data),
  deleteImage: (id: string) => sdk.deleteImage({ ...options, path: { id } }).then(data),
  reportImage: (id: string, reason: string | null) => sdk.reportImage({ ...options, path: { id }, body: { reason } }).then(data),
  removeGlaze: (id: string) => sdk.removeGlaze({ ...options, path: { id } }).then(data),
  saveStock: (body: StockInput) => sdk.saveStock({ ...options, body }).then(data),
  addStock: (body: StockAddInput) => sdk.addStock({ ...options, body }).then(data),
  removeStock: (id: string) => sdk.removeStock({ ...options, path: { id } }).then(data),
  createClub: (name: string) => sdk.createClub({ ...options, body: { name } }).then(data),
  updateClub: (id: string, body: ClubSettings) => sdk.updateClub({ ...options, path: { id }, body }).then(data),
  clubMembers: (id: string) => sdk.clubMembers({ ...options, path: { id } }).then(list),
  changeClubRole: (id: string, userId: string, body: RoleInput) => sdk.changeClubRole({ ...options, path: { id, userId }, body }).then(data),
  removeClubMember: (id: string, userId: string) => sdk.removeClubMember({ ...options, path: { id, userId } }).then(data),
  regenerateInvite: (id: string) => sdk.regenerateInvite({ ...options, path: { id } }).then(data),
  previewInvite: (token: string) => sdk.previewInvite({ ...options, body: { token } }).then(data),
  joinClub: (token: string) => sdk.joinClub({ ...options, body: { token } }).then(data),
  clubWishlist: (id: string) => sdk.clubWishlist({ ...options, path: { id } }).then(checked(hasArrays('entries'))),
  addWishlistEntry: (id: string, body: WishlistInput) => sdk.addWishlistEntry({ ...options, path: { id }, body }).then(data),
  removeWishlistEntry: (id: string, entryId: string) => sdk.removeWishlistEntry({ ...options, path: { id, entryId } }).then(data),
  setWishlistAcquired: (id: string, entryId: string, acquired: boolean) =>
    sdk.setWishlistAcquired({ ...options, path: { id, entryId }, body: { acquired } }).then(data),
  buddyAvailability: () => sdk.buddyAvailability(options).then(list),
  /** Hides a personal shelf entry from the account's buddies, or shows it to them again. */
  setKeepPrivate: (id: string, keepPrivate: boolean) => sdk.editStockPrivacy({ ...options, path: { id }, body: { keepPrivate } }).then(data),
  buddies: () => sdk.buddies(options).then(checked(hasArrays('buddies', 'incoming', 'outgoing'))),
  replaceBuddyLink: () => sdk.replaceBuddyLink(options).then(data),
  previewBuddyLink: (token: string) => sdk.previewBuddyLink({ ...options, body: { token } }).then(data),
  requestBuddyByLink: (token: string) => sdk.requestBuddyByLink({ ...options, body: { token } }).then(data),
  requestBuddyInClub: (clubId: string, userId: string) => sdk.requestBuddyInClub({ ...options, body: { clubId, userId } }).then(data),
  acceptBuddy: (userId: string) => sdk.acceptBuddy({ ...options, path: { userId } }).then(data),
  declineBuddy: (userId: string) => sdk.declineBuddy({ ...options, path: { userId } }).then(data),
  cancelBuddyRequest: (userId: string) => sdk.cancelBuddyRequest({ ...options, path: { userId } }).then(data),
  removeBuddy: (userId: string) => sdk.removeBuddy({ ...options, path: { userId } }).then(data),
  saveCombination: (body: CombinationInput) => sdk.create({ ...options, body }).then(data),
  updateCombination: (id: string, body: CombinationInput) => sdk.updateCombination({ ...options, path: { id }, body }).then(data),
  retitleCombination: (id: string, title: string) => sdk.retitleCombination({ ...options, path: { id }, body: { title } }).then(data),
  publishCombination: (id: string) => sdk.publishCombination({ ...options, path: { id } }).then(data),
  removeCombination: (id: string) => sdk.removeCombination({ ...options, path: { id } }).then(data),
  editTags: (target: Pick<UploadTarget, 'type' | 'id'>, body: TagChange) =>
    (target.type === 'glaze' ? sdk.editGlazeTags : sdk.editCombinationTags)({
      ...options,
      path: { id: target.id },
      body,
    }).then(data),
  changeImageDetails: (id: string, body: ImageDetailsChange) => sdk.editImageDetails({ ...options, path: { id }, body }).then(data),
  changeImageKind: (id: string, kind: ImageInfo['kind']) => sdk.changeImageKind({ ...options, path: { id }, body: { kind } }).then(data),
  changeImageFocus: (id: string, focus: { x: number; y: number } | null) =>
    sdk.changeImageFocus({ ...options, path: { id }, body: { focusX: focus?.x ?? null, focusY: focus?.y ?? null } }).then(data),
  changeImageVisibility: (id: string, body: ImageVisibilityChange) => sdk.changeVisibility({ ...options, path: { id }, body }).then(data),
  uploadImage: ({ target, file, visibility, kind, clubId, caption, firedOn, focus }: ImageUploadInput) => {
    const request = {
      ...options,
      path: { id: target.id },
      query: {
        visibility,
        ...(visibility === 'CLUB' ? { clubId } : {}),
        ...(caption?.trim() ? { caption: caption.trim() } : {}),
        ...(firedOn ? { firedOn } : {}),
        ...(focus ? { focusX: focus.x, focusY: focus.y } : {}),
      },
      body: { file },
    };
    if (target.type === 'glaze') {
      if (kind === 'IN_PROGRESS') throw new ApiError('Work-in-progress photos can only belong to combinations', 400);
      return sdk.uploadGlazeImage({ ...request, query: { ...request.query, kind } }).then(data);
    }
    if (kind === 'PACKAGING') throw new ApiError('Packaging photos can only belong to glazes', 400);
    return sdk.upload({ ...request, query: { ...request.query, kind } }).then(data);
  },
};

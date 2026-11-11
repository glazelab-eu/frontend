import type { APIRequestContext } from '@playwright/test';
import { withEncoder } from './encoder-lock';
import { termsVersion } from '../../src/lib/api/terms';
import type {
  AuthorAvatarView,
  AvatarReportPageView,
  AvatarReportView,
  BanPageView,
  BuddiesView,
  CombinationView,
  BuddyGlazeView,
  BuddyLinkPreviewView,
  BuddyLinkView,
  BuddyRequestView,
  ClubView,
  CsrfView,
  GlazeCreatedView,
  IdView,
  ImageView,
  InviteView,
  NewCombination,
  NewGlaze,
  RegistrationView,
  ReportGroupPageView,
  StockAddition,
  StockInput,
  StockView,
  UserView,
  NewWishlistEntry,
  WishlistEntryView,
} from '../../src/lib/generated/types.gen';

/** Every account of the suite has this password. */
export const PASSWORD = 'correct horse battery staple';

/** A step that needs no glaze, for combinations whose steps a test does not look at. */
export const BISQUE_STEP = { type: 'CUSTOM', label: 'Bisque firing' } as const;

export interface Account {
  email: string;
  displayName: string;
  password: string;
}

export interface Upload {
  file: { name: string; mimeType: string; buffer: Buffer };
  kind?: ImageView['kind'];
  visibility?: ImageView['visibility'];
  caption?: string;
  firedOn?: string;
  /** The club of a CLUB photo. */
  clubId?: string;
}

/**
 * Seeds data through the real API with the cookies of a browser context (`page.request`), so what it signs in is signed in
 * in the page too. Writes fetch a fresh CSRF token, as the session changes on sign-in.
 */
export class Api {
  constructor(private readonly request: APIRequestContext) {}

  private async send<T>(method: string, path: string, options: { data?: unknown; form?: Record<string, string>; multipart?: FormData } = {}) {
    const headers: Record<string, string> = {};
    if (method !== 'GET') {
      const csrf = await this.request.get('/api/auth/csrf');
      headers['X-XSRF-TOKEN'] = ((await csrf.json()) as CsrfView).token;
    }
    const response = await this.request.fetch(path, { method, headers, ...options, failOnStatusCode: false });
    if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** The status of a GET that may fail (a photo the person may not see answers 404). */
  async status(path: string): Promise<number> {
    return (await this.request.get(path, { failOnStatusCode: false })).status();
  }

  /** The answer to a registration (on the mail-free server it carries the setup token, unless the address is taken or banned). */
  registration(account: Account): Promise<RegistrationView> {
    return this.send<RegistrationView>('POST', '/api/auth/register', { data: { email: account.email, displayName: account.displayName } });
  }

  /**
   * Registers on the mail-free server and activates with the answer's setup token: the password, the current terms and
   * the error-report choice (off unless asked for); the account is not signed in.
   */
  async register(account: Account, { diagnostics = false }: { diagnostics?: boolean } = {}): Promise<void> {
    const registration = await this.registration(account);
    if (!registration.setupToken) throw new Error('The API sends mail: the suite needs the mail-free dev profile');
    await this.send('POST', '/api/auth/verification/confirm', {
      data: {
        token: registration.setupToken,
        password: account.password,
        displayName: account.displayName,
        termsAccepted: true,
        termsVersion,
        diagnosticsOptIn: diagnostics,
      },
    });
  }

  async signUp(account: Account): Promise<void> {
    await this.register(account);
    await this.signIn(account);
  }

  signIn(account: Account): Promise<void> {
    return this.send('POST', '/api/auth/login', { form: { email: account.email, password: account.password } });
  }

  addGlaze(glaze: NewGlaze): Promise<GlazeCreatedView> {
    return this.send('POST', '/api/glazes', { data: glaze });
  }

  /** A combination; published unless `draft` is set. */
  async addCombination(combination: NewCombination): Promise<string> {
    return (await this.send<IdView>('POST', '/api/combinations', { data: combination })).id;
  }

  /** Replaces a combination's content (title, steps and the rest), as Studio's Save does. */
  updateCombination(id: string, combination: NewCombination): Promise<void> {
    return this.send('PUT', `/api/combinations/${id}`, { data: combination });
  }

  removeCombination(id: string): Promise<void> {
    return this.send('DELETE', `/api/combinations/${id}`);
  }

  addStock(stock: StockInput): Promise<void> {
    return this.send('POST', '/api/stock', { data: stock });
  }

  /** Adds grams to what the server holds ("+1 jar" of another device or member), and answers the entry. */
  addToStock(addition: StockAddition): Promise<StockView> {
    return this.send('POST', '/api/stock/add', { data: addition });
  }

  /** Removes a shelf entry (another device's Remove). */
  removeStock(id: string): Promise<void> {
    return this.send('DELETE', `/api/stock/${id}`);
  }

  /** The combinations the account sees (published ones and its own drafts), as the API lists them. */
  combinations(): Promise<CombinationView[]> {
    return this.send('GET', '/api/combinations');
  }

  /** The account's own shelf entries, as the API lists them. */
  stock(): Promise<StockView[]> {
    return this.send('GET', '/api/stock');
  }

  /** Marks a combination or glaze as a favourite of the signed-in account. */
  favourite(kind: 'combinations' | 'glazes', id: string): Promise<void> {
    return this.send('PUT', `/api/favorites/${kind}/${id}`);
  }

  /** Corrects a glaze's name, code or notes (listed in its history). */
  correctGlaze(id: string, correction: { name?: string; code?: string; notes?: string }): Promise<void> {
    return this.send('PATCH', `/api/glazes/${id}`, { data: correction });
  }

  /** Adds tags to a glaze or a combination. */
  addTags(kind: 'glazes' | 'combinations', id: string, tags: string[]): Promise<void> {
    return this.send('PATCH', `/api/${kind}/${id}/tags`, { data: { add: tags } });
  }

  /** Hides a personal shelf entry from the account's buddies, or shows it to them again. */
  setKeepPrivate(stockId: string, keepPrivate: boolean): Promise<void> {
    return this.send('PATCH', `/api/stock/${stockId}`, { data: { keepPrivate } });
  }

  /** Which of the account's accepted buddies have which glaze on their personal shelf, as the API tells them. */
  buddyAvailability(): Promise<BuddyGlazeView[]> {
    return this.send('GET', '/api/buddies/availability');
  }

  /** Deletes a photo for everyone (as another device of its uploader would). */
  removeImage(imageId: string): Promise<void> {
    return this.send('DELETE', `/api/images/${imageId}`);
  }

  /** What a photo shows (`PUT /api/images/{id}/kind`): its uploader, an admin of its club or a site admin. */
  changeImageKind(imageId: string, kind: ImageView['kind']): Promise<void> {
    return this.send('PUT', `/api/images/${imageId}/kind`, { data: { kind } });
  }

  /** Where the cards' covers centre a photo, in percent; nulls reset it to the centre. */
  changeImageFocus(imageId: string, focusX: number | null, focusY: number | null): Promise<ImageView> {
    return this.send('PUT', `/api/images/${imageId}/focus`, { data: { focusX, focusY } });
  }

  /** Who may see a photo; leaving PUBLIC gives it a new ID. */
  changeVisibility(imageId: string, visibility: ImageView['visibility'], clubId?: string): Promise<ImageView> {
    return this.send('PUT', `/api/images/${imageId}/visibility`, { data: { visibility, clubId } });
  }

  /** A new club (invite links off, no link yet). */
  createClub(name: string): Promise<IdView> {
    return this.send('POST', '/api/clubs', { data: { name } });
  }

  /** Puts a glaze or an item on a club's wishlist as the signed-in member. */
  addWishlistEntry(clubId: string, entry: NewWishlistEntry): Promise<WishlistEntryView> {
    return this.send('POST', `/api/clubs/${clubId}/wishlist`, { data: entry });
  }

  /** Marks a wishlist entry acquired, or wanted again (its adder or a club admin). */
  setWishlistAcquired(clubId: string, entryId: string, acquired: boolean): Promise<WishlistEntryView> {
    return this.send('PUT', `/api/clubs/${clubId}/wishlist/${entryId}/acquired`, { data: { acquired } });
  }

  /** The signed-in account's clubs as the API reports them. */
  clubs(): Promise<ClubView[]> {
    return this.send('GET', '/api/clubs');
  }

  /** A new club and its invite token (generating a link turns invites on). */
  async clubWithInvite(name: string): Promise<{ club: ClubView; token: string }> {
    const club = await this.send<ClubView>('POST', '/api/clubs', { data: { name } });
    const { token } = await this.send<InviteView>('POST', `/api/clubs/${club.id}/invite`);
    return { club, token };
  }

  /** The signed-in account's two activity-feed sources (FEED-1). */
  chooseFeed(buddies: boolean, clubs: boolean): Promise<void> {
    return this.send('PUT', '/api/account/feed', { data: { buddies, clubs } });
  }

  /** Turns the signed-in account's error reports on or off (32-2). */
  setDiagnostics(enabled: boolean): Promise<void> {
    return this.send('PUT', '/api/account/diagnostics', { data: { enabled } });
  }

  /** The signed-in account. */
  me(): Promise<UserView> {
    return this.send('GET', '/api/auth/me');
  }

  /** Changes the signed-in account's password; the server ends every other session of the account. */
  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.send('POST', '/api/auth/password/change', { data: { currentPassword, newPassword } });
  }

  /** Deletes the signed-in account (its published combinations stay, without an author). */
  async deleteAccount(password: string): Promise<void> {
    await this.send('POST', '/api/auth/delete', { data: { password } });
  }

  /** Joins the club of an invite token as the signed-in account. */
  async joinClub(token: string): Promise<void> {
    await this.send('POST', '/api/clubs/join', { data: { token } });
  }

  /** Replaces the club's invite link (turning invite links on) and answers the new token and version. */
  replaceInvite(clubId: string): Promise<InviteView> {
    return this.send('POST', `/api/clubs/${clubId}/invite`);
  }

  setClubRole(clubId: string, memberId: string, role: 'ADMIN' | 'MEMBER'): Promise<void> {
    return this.send('PUT', `/api/clubs/${clubId}/members/${memberId}`, { data: { role } });
  }

  /** Leaves the club (one's own ID) or, as its admin, removes another member. */
  removeMember(clubId: string, userId: string): Promise<void> {
    return this.send('DELETE', `/api/clubs/${clubId}/members/${userId}`);
  }

  updateClub(clubId: string, settings: { name: string; houseRules: string; invitesEnabled: boolean }): Promise<void> {
    return this.send('PUT', `/api/clubs/${clubId}`, { data: settings });
  }

  /** The signed-in account's buddies and requests, as the API reports them. */
  buddies(): Promise<BuddiesView> {
    return this.send('GET', '/api/buddies');
  }

  /** Creates or replaces the buddy link and answers its token (the only time the API does). */
  async replaceBuddyLink(): Promise<string> {
    return (await this.send<BuddyLinkView>('POST', '/api/buddies/link')).token;
  }

  /** Whose link it is and how the signed-in account stands to them. */
  previewBuddyLink(token: string): Promise<BuddyLinkPreviewView> {
    return this.send('POST', '/api/buddies/link/preview', { data: { token } });
  }

  /** Asks the owner of a buddy link to be buddies (accepts their request to this account if there is one). */
  requestBuddyByLink(token: string): Promise<BuddyRequestView> {
    return this.send('POST', '/api/buddies/link/request', { data: { token } });
  }

  /** Asks a member of one of the account's clubs. */
  requestBuddyInClub(clubId: string, userId: string): Promise<BuddyRequestView> {
    return this.send('POST', '/api/buddies/requests', { data: { clubId, userId } });
  }

  /** Ends the buddy relation with a person. */
  removeBuddy(userId: string): Promise<void> {
    return this.send('DELETE', `/api/buddies/${userId}`);
  }

  acceptBuddy(userId: string): Promise<void> {
    return this.send('POST', `/api/buddies/${userId}/accept`);
  }

  /** Declines another account's request to this account. */
  declineBuddy(userId: string): Promise<void> {
    return this.send('POST', `/api/buddies/${userId}/decline`);
  }

  /** Withdraws the account's request to another account. */
  cancelBuddyRequest(userId: string): Promise<void> {
    return this.send('POST', `/api/buddies/${userId}/cancel`);
  }

  uploadToCombination(id: string, upload: Upload): Promise<ImageView> {
    return this.upload(`/api/combinations/${id}/images`, upload);
  }

  /** A glaze's own photo; a kind of PACKAGING is only for glazes. */
  uploadToGlaze(id: string, upload: Upload): Promise<ImageView> {
    return this.upload(`/api/glazes/${id}/images`, upload);
  }

  /** Sets the signed-in account's profile picture (the server cuts the centre square); answers the new picture's ID. */
  uploadAvatar(file: Upload['file']): Promise<string> {
    const multipart = new FormData();
    multipart.set('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.name);
    return withEncoder(() => this.send<IdView>('POST', '/api/avatars', { multipart })).then((view) => view.id);
  }

  /** Sends a feedback with an optional route name as its context (no photos: those go through the page). */
  sendFeedback(message: string, route?: string): Promise<string> {
    const multipart = new FormData();
    multipart.set('message', message);
    if (route) multipart.set('route', route);
    return this.send<IdView>('POST', '/api/feedback', { multipart }).then((view) => view.id);
  }

  /** Removes a profile picture by its ID (its owner, or a site admin: then the picture is blocked too). */
  removeAvatar(id: string): Promise<void> {
    return this.send('DELETE', `/api/avatars/${id}`);
  }

  /** Reports another account's profile picture (once per reporter; the reason is optional). */
  reportAvatar(id: string, reason: string | null = null): Promise<void> {
    return this.send('POST', `/api/avatars/${id}/reports`, { data: { reason } });
  }

  /** The profile picture of each author of a published combination, as the API lists them. */
  authorAvatars(): Promise<AuthorAvatarView[]> {
    return this.send('GET', '/api/combinations/author-avatars');
  }

  /** The profile-picture report queue (site admins), one page. */
  avatarReports(status?: AvatarReportView['status']): Promise<AvatarReportPageView> {
    return this.send('GET', `/api/admin/avatar-reports?page=0${status ? `&status=${status}` : ''}`);
  }

  /** Bans an account (site admins). */
  ban(userId: string, reason: string, blockPictures = false): Promise<void> {
    return this.send('POST', `/api/admin/users/${userId}/ban`, { data: { reason, blockPictures } });
  }

  /** One page of the bans (site admins). */
  bans(page = 0): Promise<BanPageView> {
    return this.send('GET', `/api/admin/bans?page=${page}`);
  }

  /** Turns error reports on or off for the account (32-1). */
  chooseDiagnostics(enabled: boolean): Promise<void> {
    return this.send('PUT', '/api/account/diagnostics', { data: { enabled } });
  }

  /** Sends error reports as the app would (the account must have opted in): a phone's device facts and the events. */
  sendReports(
    events: { kind?: 'ERROR' | 'WARNING' | 'UNHANDLED_REJECTION'; message: string; stack?: string; count?: number; build?: string; route?: string }[],
  ): Promise<void> {
    return this.send('POST', '/api/reports', {
      data: {
        device: {
          browser: 'Chrome',
          browserVersion: '142.0.7444.59',
          os: 'Android',
          osVersion: '16',
          screenWidth: 412,
          screenHeight: 915,
          viewportWidth: 412,
          viewportHeight: 780,
          pixelRatio: 2.625,
          pointer: 'COARSE',
          language: 'pt-PT',
          standalone: true,
          online: true,
          colorScheme: 'DARK',
          timezoneOffsetMinutes: -60,
        },
        events: events.map((event) => ({
          kind: 'ERROR',
          occurredAt: new Date().toISOString(),
          build: '0.1.0 (e2e)',
          route: 'glaze',
          ...event,
        })),
      },
    });
  }

  /** The error report messages (site admins), one page, optionally narrowed by a search text. */
  errorReportGroups(q = ''): Promise<ReportGroupPageView> {
    return this.send('GET', `/api/admin/error-reports?page=0${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  }

  /** Reports a photo of someone else (the reason is optional). */
  reportImage(id: string, reason: string | null = null): Promise<void> {
    return this.send('POST', `/api/images/${id}/reports`, { data: { reason } });
  }

  private upload(path: string, upload: Upload): Promise<ImageView> {
    const multipart = new FormData();
    multipart.set('file', new Blob([new Uint8Array(upload.file.buffer)], { type: upload.file.mimeType }), upload.file.name);
    const query = new URLSearchParams({
      kind: upload.kind ?? 'TEST_TILE',
      visibility: upload.visibility ?? 'PUBLIC',
      ...(upload.clubId ? { clubId: upload.clubId } : {}),
    });
    if (upload.caption) query.set('caption', upload.caption);
    if (upload.firedOn) query.set('firedOn', upload.firedOn);
    return withEncoder(() => this.send('POST', `${path}?${query}`, { multipart }));
  }
}

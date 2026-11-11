import { ACTIVATION_REQUIRED, ApiError, api, resetCsrf, type ActivationSetup } from '../../lib/api/client';
import type { AccountLinkInput, AuthInput } from '../../lib/api/inputs';
import { registrationBody, registrationNext } from '../../lib/api/registration';
import { avatarUrls } from '../../lib/avatars/avatar';
import { dropCachedImages, saveLastUser } from '../../lib/offline/offline';
import { home } from '../../lib/routing/routes';
import type { AppContext } from '../app/context';
import { ifGone } from '../app/gone';

/**
 * The account's own actions: sign-in and registration, the mail-free password step, email links, the public sign-in options, the
 * operator contact, terms, password, error-report choice and profile picture. Owns the setup token (dropped on an account change through
 * `onAccountChange`) and the sign-in options' loading flag; `signingIn` (the pending sign-out ordering) is the session module's.
 * `loadAuthOptions` is also handed to the load module.
 */
export function createAccountActions(
  ctx: Pick<AppContext, 'read' | 'patch' | 'stale' | 'notify' | 'mutate' | 'storage' | 'load' | 'go' | 'onAccountChange'>,
  { signingIn }: { signingIn: <T>(request: () => Promise<T>) => Promise<T> },
) {
  /** The token of `AppState.accountSetup`: memory only, used once, dropped on close and on an account change. */
  let setupToken: string | null = null;
  ctx.onAccountChange(() => {
    setupToken = null;
  });

  /**
   * Signs in, or registers. A registration answers 'mail' when the server emails the link (the dialog says so);
   * a mail-free server's setup token for a new address goes straight to the password step (`accountSetup`).
   * Failures show at the dialog's form.
   */
  async function submitAuth(input: AuthInput): Promise<'done' | 'mail' | 'failed'> {
    let mail = false;
    const done = await ctx.mutate({
      request: async () => {
        if (input.mode === 'register') {
          const next = registrationNext(await api.register(registrationBody(input)), ctx.read().authOptions?.emailEnabled ?? false);
          if (next.step === 'taken') throw new Error('auth.register.unavailable');
          if (next.step === 'mail') mail = true;
          else {
            setupToken = next.token;
            ctx.patch({ authOpen: false, accountSetup: { email: input.email, displayName: input.displayName } });
          }
          return;
        }
        await signingIn(() => api.login(input.email, input.password));
        resetCsrf();
        ctx.patch({ authOpen: false });
        await ctx.load();
        ctx.notify('notices.welcome');
      },
      form: 'auth',
    });
    return !done ? 'failed' : mail ? 'mail' : 'done';
  }

  /**
   * The mail-free password step: answers the activation challenge with the setup token (once), then signs in
   * with the new password. If only the sign-in fails, the account is active and the sign-in dialog opens.
   */
  async function completeAccountSetup(input?: AccountLinkInput): Promise<'used' | 'activation' | 'failed'> {
    const setup = ctx.read().accountSetup;
    const token = setupToken;
    const credentials = activationOf(input);
    if (!setup || !token || !credentials) return 'failed';
    const done = await ctx.mutate({
      request: async () => {
        await api.verifyEmail(token, credentials);
        setupToken = null;
        ctx.patch({ accountSetup: null });
        try {
          await signingIn(() => api.login(setup.email, credentials.password));
        } catch {
          ctx.patch({ authOpen: true });
          ctx.notify('notices.emailVerified');
          return;
        }
        resetCsrf();
        await ctx.load();
        ctx.notify('notices.welcome');
      },
      form: 'account-link',
    });
    return done ? 'used' : 'failed';
  }

  /** The activation a link form sent (it has a display name), with the terms and the error-report choice as ticked (off unless ticked). */
  function activationOf(input?: AccountLinkInput): ActivationSetup | undefined {
    if (input?.displayName === undefined) return undefined;
    return {
      password: input.password,
      displayName: input.displayName,
      termsAccepted: input.termsAccepted === true,
      diagnosticsOptIn: input.diagnosticsOptIn === true,
    };
  }

  /** Leaves the password step; the token is gone with it (the address stays reserved until the pending account expires). */
  function closeAccountSetup() {
    setupToken = null;
    ctx.patch({ accountSetup: null, formError: null });
  }

  /** Asks for an email link (sign-in, password reset or verification); the answer never says whether the address exists. */
  function requestAccountMail(kind: 'login' | 'reset' | 'verify', email: string) {
    return ctx.mutate({
      request: async () => {
        if (kind === 'login') await api.requestMagicLink(email);
        else if (kind === 'reset') await api.requestPassword(email);
        else await api.requestVerification(email);
      },
      form: 'account-mail',
    });
  }

  /**
   * Confirms an email link with its single-use token (never on load). A reset always sends the new
   * password; `displayName` is set once the API asked for activation. 'activation' means the API
   * wants a fresh password and name first (nothing is shown as an error); on 'used' the route is
   * replaced so the token leaves the history, the session is reloaded and the next step continues.
   */
  async function confirmAccountLink(kind: 'login' | 'reset' | 'verify', token: string, input?: AccountLinkInput): Promise<'used' | 'activation' | 'failed'> {
    const setup = activationOf(input);
    let activation = false;
    const done = await ctx.mutate({
      request: async () => {
        try {
          if (kind === 'login') await signingIn(() => api.confirmMagicLink(token, setup));
          else if (kind === 'reset') await signingIn(() => api.resetPassword(token, input?.password ?? '', setup));
          else await api.verifyEmail(token, setup);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409 || error.message !== ACTIVATION_REQUIRED) throw error;
          activation = true;
          return false;
        }
        // The token is used and the session changed: continue even if the account changed meanwhile.
        if (kind !== 'verify') resetCsrf();
        await accountLinkUsed(kind);
      },
      form: 'account-link',
    });
    return done ? 'used' : activation ? 'activation' : 'failed';
  }

  /** The public sign-in options, once: `null` marks a failed attempt that openAuth and the next load retry. */
  let loadingAuthOptions = false;
  async function loadAuthOptions() {
    if (loadingAuthOptions || ctx.read().authOptions) return;
    loadingAuthOptions = true;
    try {
      ctx.patch({ authOptions: await api.authOptions() });
    } catch {
      ctx.patch({ authOptions: null });
    } finally {
      loadingAuthOptions = false;
    }
  }

  /**
   * The operator's contact address, fetched only when a person asks for it. It is returned to that one caller and never kept here:
   * not in the state, the offline snapshot or the options. A failure (offline, 404 while unset, 429) throws for the caller to word.
   */
  async function operatorContact(): Promise<string> {
    return (await api.operatorContact()).email;
  }

  function openAuth() {
    ctx.patch({ authOpen: true, formError: null });
    void loadAuthOptions();
  }

  /** Records that the signed-in account accepts the current terms; writes are refused until then. */
  function acceptTerms() {
    return ctx.mutate({
      request: () => api.acceptTerms(),
      apply: async (user) => {
        // A form refused for the outdated terms can be sent again now.
        ctx.patch({ user, termsRequired: false, formError: null });
        await ctx.storage(() => saveLastUser(user));
      },
      notice: 'notices.termsAccepted',
      // The dialog shows only its own refusal: the banner's error (a failed load) would take its focus.
      form: 'terms',
      requireOnline: true,
      busy: 'accepting-terms',
    });
  }

  /**
   * Changes the signed-in account's password (the current one confirms it). The server signs this session in again with
   * a new session ID and CSRF token and ends every other session, so the next write fetches a fresh token. Failures show
   * at the dialog's form.
   */
  function changePassword(currentPassword: string, newPassword: string) {
    return ctx.mutate({
      request: async () => {
        await api.changePassword(currentPassword, newPassword);
        // The session was renewed whatever happens next: drop the old token even if the account changed meanwhile.
        resetCsrf();
      },
      apply: async () => ctx.patch({ changingPassword: false }),
      notice: 'notices.passwordChangedHere',
      // A refusal after the dialog closed (a page change) goes to the banner, where it can still be read.
      form: () => (ctx.read().changingPassword ? 'password-change' : undefined),
      requireOnline: true,
      busy: 'changing-password',
    });
  }

  /**
   * The signed-in account's profile picture (31-2; the client cuts the square, the server stores it and answers its ID, which is new for every
   * picture, so a replacement also moves the URL and the saved copies of the old one go). Only the account itself changes: no listing reloads.
   * Failures show at the picture's form.
   */
  function setUserAvatar(avatarId: string | null, actor: string | undefined) {
    const user = ctx.read().user;
    if (!user || ctx.stale(actor)) return;
    const previous = user.avatarId;
    const updated = { ...user, avatarId };
    ctx.patch({ user: updated });
    return Promise.all([
      ctx.storage(() => saveLastUser(updated)),
      previous && previous !== avatarId ? ctx.storage(() => dropCachedImages(actor, Object.values(avatarUrls(previous)))) : undefined,
    ]);
  }

  /** Turns the account's error reports on or off. Off deletes the reports already sent (the notice says so); on needs the current terms. */
  function chooseDiagnostics(enabled: boolean) {
    return ctx.mutate({
      request: () => api.chooseDiagnostics(enabled),
      apply: async (_, actor) => {
        const user = ctx.read().user;
        if (!user || ctx.stale(actor)) return;
        const updated = { ...user, diagnosticsOptIn: enabled };
        ctx.patch({ user: updated });
        await ctx.storage(() => saveLastUser(updated));
      },
      notice: enabled ? 'notices.diagnosticsOn' : 'notices.diagnosticsOff',
      form: 'diagnostics',
      requireOnline: true,
      busy: 'diagnostics',
    });
  }

  function uploadAvatar(file: File) {
    return ctx.mutate({
      request: () => api.uploadAvatar(file),
      apply: async ({ id }, actor) => void (await setUserAvatar(id, actor)),
      notice: 'notices.avatarSaved',
      form: 'avatar',
      requireOnline: true,
      busy: 'avatar',
    });
  }

  /** Removes the picture; one that is already gone (404: a site admin removed it) counts as removed. */
  function removeAvatar() {
    const id = ctx.read().user?.avatarId;
    if (!id) return Promise.resolve(false);
    return ctx.mutate({
      request: () => ifGone(() => api.removeAvatar(id)),
      apply: async (_, actor) => void (await setUserAvatar(null, actor)),
      notice: 'notices.avatarRemoved',
      form: 'avatar',
      requireOnline: true,
      busy: 'avatar',
    });
  }

  /** After a confirmed email link: drop the token from history, reload and continue. */
  async function accountLinkUsed(kind: 'verify' | 'reset' | 'login') {
    ctx.go(home, { replace: true });
    await ctx.load();
    if (kind === 'login') ctx.notify('notices.signedIn');
    else {
      ctx.notify(kind === 'reset' ? 'notices.passwordChanged' : 'notices.emailVerified');
      ctx.patch({ authOpen: true });
    }
  }

  return {
    loadAuthOptions,
    submitAuth,
    completeAccountSetup,
    closeAccountSetup,
    requestAccountMail,
    confirmAccountLink,
    operatorContact,
    openAuth,
    acceptTerms,
    changePassword,
    chooseDiagnostics,
    uploadAvatar,
    removeAvatar,
  };
}

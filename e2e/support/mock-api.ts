import type { Page, Route } from '@playwright/test';
import { termsVersion } from '../../src/lib/api/terms';
import type { AuthOptionsView, BuddiesView, CombinationPageView, FavoritesView, SyncView, UserView } from '../../src/lib/generated/types.gen';

export const MOCK_USER: UserView = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Ana',
  email: 'ana@example.test',
  siteAdmin: false,
  acceptedTermsVersion: termsVersion,
  avatarId: null,
  diagnosticsOptIn: false,
  feedUnread: 0,
  feedBuddies: true,
  feedClubs: true,
};

/** An answer of the mocked API: a JSON body with a status, or a handler that takes the request itself. */
export type MockAnswer = { status?: number; json: unknown } | ((route: Route) => Promise<void>);

export interface MockOptions {
  /** The signed-in account; null for a guest. */
  user?: UserView | null;
  /** Answers by "METHOD /api/path" (no query), before the defaults. */
  answers?: Record<string, MockAnswer>;
}

/**
 * Answers every `/api` request of the page from memory, for states and failures the real API cannot produce on demand. An empty
 * library by default; a write the test did not answer fails with 500, so it shows up.
 */
export async function mockApi(page: Page, options: MockOptions = {}): Promise<void> {
  let user = options.user === undefined ? MOCK_USER : options.user;
  const favourites: FavoritesView = { glazeIds: [], combinationIds: [] };
  const authOptions: AuthOptionsView = { emailEnabled: false, termsVersion, sourceUrl: null };
  const defaults: Record<string, MockAnswer> = {
    'GET /api/auth/me': async (route) => (user ? route.fulfill({ json: user }) : route.fulfill({ status: 401, json: { error: 'Please sign in.' } })),
    'GET /api/auth/options': { json: authOptions },
    'GET /api/auth/csrf': { json: { token: 'mock-csrf' } },
    'GET /api/health': { json: { ok: true, build: 'mock' } },
    'GET /api/favorites/counts': { json: { glazes: [], combinations: [] } },
    'GET /api/favorites': { json: favourites },
    'GET /api/buddies': { json: { buddies: [], incoming: [], outgoing: [], hasLink: false } satisfies BuddiesView },
    // Every sync asks for a full load (a mocked library has no change log); the paged listing is empty like the others.
    'GET /api/sync': {
      json: {
        format: 1,
        cursor: '1.0',
        epoch: 'mock',
        resync: 'CURSOR',
        glazes: [],
        combinations: [],
        removedGlazeIds: [],
        removedCombinationIds: [],
        visibleGlazes: 0,
        visibleCombinations: 0,
      } satisfies SyncView,
    },
    'GET /api/sync/combinations': { json: { combinations: [], next: null } satisfies CombinationPageView },
    'POST /api/auth/terms': async (route) => {
      if (user) user = { ...user, acceptedTermsVersion: termsVersion };
      await route.fulfill({ json: user });
    },
    'POST /api/auth/logout': async (route) => {
      user = null;
      await route.fulfill({ status: 200 });
    },
    'GET /api/auth/clear-cache': (route) => route.fulfill({ status: 204 }),
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    const answer = options.answers?.[key] ?? defaults[key];
    if (typeof answer === 'function') return answer(route);
    if (answer) return route.fulfill({ status: answer.status ?? 200, json: answer.json });
    if (request.method() === 'GET') return route.fulfill({ json: [] });
    return route.fulfill({ status: 500, json: { error: `Not mocked: ${key}` } });
  });
}

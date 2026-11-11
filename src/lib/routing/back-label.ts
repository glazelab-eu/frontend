import type { Club, Glaze, Combination } from '../api/models';
import type { translate } from '../i18n';
import { combinationTitle, glazeTitle } from '../glazes/glazes';
import type { Route } from './routes';

/** Names a recorded origin using the current authorised listings and current locale. */
export function backLabel(
  route: Route | null,
  glazes: readonly Glaze[],
  combinations: readonly Combination[],
  t: typeof translate,
  clubs: readonly Club[] = [],
): string | null {
  if (!route) return null;
  switch (route.name) {
    case 'discover':
      if (route.q) return t('routing.back.search', { values: { query: route.q } });
      if (route.type === 'glazes') return t('common.allGlazes');
      return route.type === 'combinations' ? t('combination.back') : t('nav.explore');
    case 'glaze': {
      const glaze = glazes.find((glaze) => glaze.id === route.id);
      return glaze ? glazeTitle(glaze) : t('common.glaze');
    }
    case 'combination': {
      const combination = combinations.find((combination) => combination.id === route.id);
      return combination ? combinationTitle(combination, t('combination.untitled')) : t('routing.back.combination');
    }
    case 'stock':
      return t('nav.stock');
    case 'studio':
      return t('studio.title');
    case 'clubs':
      return t('nav.clubs');
    case 'club':
      return clubs.find((club) => club.id === route.id)?.name ?? t('nav.clubs');
    case 'terms':
      return t('terms.title');
    case 'about':
      return t('about.title');
    case 'account':
      return t('account.page.title');
    case 'admin':
      return t('admin.title');
    case 'image-deletions':
      return t('images.log.title');
    case 'image-reports':
      return t('images.reports.title');
    case 'avatar-reports':
      return t('avatars.reports.title');
    case 'bans':
      return t('bans.title');
    case 'error-reports':
      return t('errorReports.title');
    case 'users':
      return t('users.title');
    case 'feedback':
      return t('feedbackAdmin.title');
    case 'activity':
      return t('feed.title');
    default:
      return null;
  }
}

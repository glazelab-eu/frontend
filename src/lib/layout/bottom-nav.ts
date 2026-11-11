import { home, type Route, type Section } from '../routing/routes';
import type { MessageKey } from '../i18n';

export interface NavTab {
  id: Section;
  route: Route;
  /** The full name, in the top bar and as the accessible name everywhere. */
  label: MessageKey;
  /** The short word under the icon of the phone bottom navigation. */
  shortLabel: MessageKey;
}

/** The four entries of the top bar (wide screens) and of the bottom navigation (phones), in this order. */
export const navTabs: NavTab[] = [
  { id: 'discover', route: home, label: 'nav.explore', shortLabel: 'nav.explore' },
  { id: 'stock', route: { name: 'stock' }, label: 'nav.stock', shortLabel: 'nav.shelf' },
  { id: 'studio', route: { name: 'studio' }, label: 'common.recordTest', shortLabel: 'nav.record' },
  { id: 'clubs', route: { name: 'clubs' }, label: 'nav.clubs', shortLabel: 'nav.clubs' },
];

/** Whether Studio's own sticky bar (add step, save) takes the foot of a phone's screen: its draft has input. */
export function studioBarSticky(phone: boolean, section: Section | null, studioStarted: boolean): boolean {
  return phone && section === 'studio' && studioStarted;
}

/** Whether the fixed bottom navigation shows: on phones only, and not while Studio's sticky bar takes its place, so the two never stack. */
export function bottomNavVisible(phone: boolean, section: Section | null, studioStarted: boolean): boolean {
  return phone && !studioBarSticky(phone, section, studioStarted);
}

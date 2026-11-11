import type { Club, ClubMember, Combination, Glaze, ImageInfo, Manufacturer, Step, StockItem, WishlistEntry } from '../lib/api/models';
import type { GlazeStep } from '../lib/glazes/steps';

/**
 * Test-only builders of the API models. Each takes `Partial<>` overrides over a complete default,
 * so a change to a generated model is a type error here and nowhere else. A test that depends on a
 * value (ids, codes, names, tags, step positions) passes it; never import this from production code.
 */

export const amaco: Manufacturer = { id: 'm1', shortId: 'AMACO', name: 'Amaco' };

/** A test tile; the URL follows the `id` unless overridden. */
export function imageInfo(overrides: Partial<ImageInfo> = {}): ImageInfo {
  const id = overrides.id ?? 'i1';
  return {
    id,
    visibility: 'PUBLIC',
    kind: 'TEST_TILE',
    url: `/api/images/${id}`,
    cardUrl: `/api/images/${id}/card`,
    width: 24,
    height: 24,
    clubId: null,
    own: true,
    uploader: 'Ana',
    canDelete: true,
    caption: null,
    firedOn: null,
    focusX: null,
    focusY: null,
    ...overrides,
  };
}

export function glaze(overrides: Partial<Glaze> = {}): Glaze {
  return {
    id: 'g1',
    manufacturer: amaco,
    name: 'Blue',
    code: 'PC-20',
    notes: null,
    images: [],
    tags: [],
    barcodes: [],
    createdAt: '2026-10-28T12:00:00Z',
    addedBy: null,
    lastEditedAt: null,
    lastEditedBy: null,
    ...overrides,
  };
}

/** A glaze application. */
export function glazeStep(overrides: Partial<GlazeStep> = {}): GlazeStep {
  return {
    position: 1,
    type: 'GLAZE',
    glazeId: 'g1',
    coats: 1,
    label: null,
    method: null,
    notes: null,
    manufacturer: 'Amaco',
    name: 'Blue',
    ...overrides,
  };
}

/** A custom step such as a firing. */
export function customStep(overrides: Partial<Step> = {}): Step {
  return {
    position: 1,
    type: 'CUSTOM',
    glazeId: null,
    coats: null,
    label: 'Bisque firing',
    method: null,
    notes: null,
    manufacturer: null,
    name: null,
    ...overrides,
  };
}

/** A published combination of someone else's, without steps. */
export function combination(overrides: Partial<Combination> = {}): Combination {
  return {
    id: 'c1',
    title: 'Blue over Green',
    description: null,
    author: null,
    authorId: null,
    own: false,
    stepsLocked: false,
    draft: false,
    publishedAt: null,
    basedOnId: null,
    cone: null,
    temperatureC: null,
    atmosphere: null,
    clayBody: null,
    kiln: null,
    firedOn: null,
    createdAt: '2026-10-28T12:00:00Z',
    tags: [],
    steps: [],
    images: [],
    ...overrides,
  };
}

/** A personal shelf entry of 100 g. */
export function stockItem(overrides: Partial<StockItem> = {}): StockItem {
  return {
    id: 's1',
    glazeId: 'g1',
    userId: 'u1',
    clubId: null,
    quantityG: 100,
    jarSizeG: null,
    manufacturer: 'Amaco',
    name: 'Blue',
    clubName: null,
    addedById: null,
    canRemove: true,
    keepPrivate: false,
    ...overrides,
  };
}

/** A club of the account (an ordinary member's unless the role says otherwise). */
export function club(overrides: Partial<Club> = {}): Club {
  return {
    id: 'c1',
    name: 'Kiln',
    houseRules: '',
    invitesEnabled: false,
    hasInviteLink: false,
    inviteVersion: null,
    ownerId: null,
    role: 'MEMBER',
    ...overrides,
  };
}

/** A club member (an ordinary one unless the role says otherwise). */
export function clubMember(overrides: Partial<ClubMember> = {}): ClubMember {
  return { id: 'u1', displayName: 'Ana', role: 'MEMBER', avatarId: null, ...overrides };
}

/** A club wishlist entry: an item with a link the signed-in member added and may manage, unless overridden. */
export function wishlistEntry(overrides: Partial<WishlistEntry> = {}): WishlistEntry {
  return {
    id: 'w1',
    type: 'ITEM',
    glazeId: null,
    manufacturer: null,
    code: null,
    name: 'Kiln shelf',
    link: 'https://shop.example.test/shelf',
    note: null,
    addedById: 'u1',
    addedBy: 'Ana',
    addedAt: '2026-11-01T10:00:00Z',
    acquiredAt: null,
    canManage: true,
    ...overrides,
  };
}

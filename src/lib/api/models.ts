export type {
  FavoritesView as Favorites,
  FavoriteCountsView as FavoriteCounts,
  UserView as User,
  GlazeView as Glaze,
  ManufacturerView as Manufacturer,
  ClubView as Club,
  StockView as StockItem,
  StepView as Step,
  ImageView as ImageInfo,
  GlazeCreatedView as GlazeCreated,
  GlazeHistoryView as GlazeHistory,
  GlazeEditView as GlazeEdit,
  CombinationView as Combination,
  AuthOptionsView as AuthOptions,
  MemberView as ClubMember,
  BuddiesView as Buddies,
  BuddyView as Buddy,
  BuddyNameView as BuddyName,
  BuddyGlazeView as BuddyGlaze,
  BuddyLinkPreviewView as BuddyPreview,
  InvitePreviewView as InvitePreview,
  ImageDeletionPageView as ImageDeletionPage,
  ImageDeletionView as ImageDeletion,
  ImageReportPageView as ImageReportPage,
  ImageReportView as ImageReport,
  AvatarReportPageView as AvatarReportPage,
  AvatarReportView as AvatarReport,
  BanPageView as BanPage,
  FeedbackPageView as FeedbackPage,
  FeedbackView as FeedbackEntry,
  FeedbackPhotoView as FeedbackPhoto,
  BanView as Ban,
  AdminUserPageView as AdminUserPage,
  AdminUserView as AdminUser,
  ReportGroupPageView as ReportGroupPage,
  ReportGroupView as ReportGroup,
  ReportOccurrencePageView as ReportOccurrencePage,
  ReportOccurrenceView as ReportOccurrence,
  ReportBuildsView as ReportBuilds,
  DeviceInfo as ReportDevice,
  FeedEntryView as FeedEntry,
  FeedPageView as FeedPage,
  FeedBadgeView as FeedBadge,
  WishlistView as ClubWishlist,
  WishlistEntryView as WishlistEntry,
} from '../generated/types.gen';
import type {
  FavoritesView as Favorites,
  GlazeView as Glaze,
  CombinationView as Combination,
  StockView as StockItem,
  ClubView as Club,
  MemberView as ClubMember,
} from '../generated/types.gen';

import type { BuddiesView as Buddies, BuddyGlazeView as BuddyGlaze } from '../generated/types.gen';

/**
 * Which accepted buddies have which glaze (`GET /api/buddies/availability`) and when this device read it (milliseconds). It is
 * not part of the synced listings: it is read in full with the other private data and kept in the snapshot for offline use.
 */
export interface BuddyAvailability {
  glazes: BuddyGlaze[];
  /** Null while nothing was read (a guest, an older snapshot). */
  asOf: number | null;
}

export interface Snapshot {
  favorites: Favorites;
  glazes: Glaze[];
  combinations: Combination[];
  stock: StockItem[];
  clubs: Club[];
  clubMembers: Record<string, ClubMember[]>;
  /** The glaze buddies, requests and whether a buddy link exists (names of other people, kept like the member lists). */
  buddies: Buddies;
  /** Which buddies have which glaze, as of the last connection. */
  buddyAvailability: BuddyAvailability;
  /** The profile picture of each author of a published combination, by account ID (31-3): IDs only, kept like the member lists. */
  authorAvatars?: Record<string, string>;
  /** Last fetched public popularity totals; absent in older offline copies. */
  favoriteCounts?: import('../generated/types.gen').FavoriteCountsView;
}

/** What a new picture belongs to; the title is only shown in the upload dialog, `kind` is the one it starts with. */
export interface UploadTarget {
  type: 'glaze' | 'combination';
  id: string;
  title: string;
  kind?: 'TEST_TILE' | 'FINISHED' | 'PACKAGING' | 'IN_PROGRESS';
}

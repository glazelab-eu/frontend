import type { ImageInfo, UploadTarget } from './models';
import type { StockAddition, StockInput } from '../generated/types.gen';
/**
 * Sign-in, or registration (no password and no consent: the password, the terms and the error-report choice come with the
 * activation, after the email confirmation or in the mail-free setup step).
 */
export type AuthInput = { mode: 'login'; email: string; password: string } | { mode: 'register'; email: string; displayName: string };

/** What an account link's form sends: a reset's new password, or (`displayName` set) the whole activation of a pending account. */
export interface AccountLinkInput {
  password: string;
  displayName?: string;
  termsAccepted?: boolean;
  diagnosticsOptIn?: boolean;
}

export type {
  ClubSettings as ClubSettingsInput,
  NewGlaze as GlazeInput,
  GlazeCorrection as GlazeChange,
  StockInput,
  StockAddition as StockAddInput,
  NewCombination as CombinationInput,
  TagEdit as TagChange,
  BarcodeEdit as BarcodeChange,
  ImageVisibilityEdit as ImageVisibilityChange,
  ImageDetailsEdit as ImageDetailsChange,
  NewWishlistEntry as WishlistInput,
} from '../generated/types.gen';

/**
 * A shelf write: a `StockInput` sets the amount (last write wins: a typed amount, "Used up"), a `StockAddInput` adds grams
 * to what the server holds ("+1 jar", one-click adds), so a stale device never loses another device's jar.
 */
export type StockWrite = StockInput | StockAddition;

export interface ImageUploadInput {
  target: Pick<UploadTarget, 'type' | 'id'>;
  file: File;
  visibility: ImageInfo['visibility'];
  kind: ImageInfo['kind'];
  clubId: string;
  /** Optional details of the new photo; blank text and an empty date mean none. */
  caption?: string;
  firedOn?: string;
  /** Where covers centre the photo, in percent; none is the centre. */
  focus?: { x: number; y: number } | null;
}

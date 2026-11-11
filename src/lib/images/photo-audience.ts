import type { Club, ClubMember, Combination, UploadTarget } from '../api/models';

/** Who a photo may be shown to, as the upload and 'Who can see this' dialogs offer it. Everyone is always offered. */
export interface PhotoAudience {
  /** Only me is offered. */
  private: boolean;
  /** The clubs offered. */
  clubs: Club[];
  /** The photo is on someone else's combination, so the choice is narrowed to what its author can see (the dialogs say why). */
  restricted: boolean;
}

/**
 * A photo on someone else's combination must stay visible to its author (the API refuses anything else with
 * `errors.photoAuthorMustSee`): Everyone or a club both belong to, never Only me. `authorId` is the author of the
 * photo's combination: undefined for a glaze photo, null after the author deleted their account (no one to show it
 * to), the user's own ID on their own combination; those keep every option. A club whose member list is not loaded
 * is left out (the server decides).
 */
export function photoAudience(
  clubs: Club[],
  clubMembers: Record<string, readonly Pick<ClubMember, 'id'>[]>,
  userId: string | null | undefined,
  authorId: string | null | undefined,
): PhotoAudience {
  if (!authorId || authorId === userId) return { private: true, clubs, restricted: false };
  const shared = clubs.filter((club) => clubMembers[club.id]?.some((member) => member.id === authorId));
  return { private: false, clubs: shared, restricted: true };
}

/** The audience of a new photo for `target`, from the loaded listings. */
export function uploadAudience(
  state: {
    clubs: Club[];
    clubMembers: Record<string, readonly Pick<ClubMember, 'id'>[]>;
    user: { id: string } | null;
    combinations: readonly Pick<Combination, 'id' | 'authorId'>[];
  },
  target: Pick<UploadTarget, 'type' | 'id'>,
): PhotoAudience {
  const authorId = target.type === 'combination' ? state.combinations.find((item) => item.id === target.id)?.authorId : undefined;
  return photoAudience(state.clubs, state.clubMembers, state.user?.id, authorId);
}

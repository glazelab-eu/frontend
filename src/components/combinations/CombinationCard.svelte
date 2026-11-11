<script lang="ts">
  import type { Focus } from '../../lib/images/photo-focus';
  import type { Snippet } from 'svelte';
  import { locale, t } from '../../lib/i18n';
  import type { Club, ClubMember, Combination, Glaze, ImageInfo, UploadTarget, User } from '../../lib/api/models';
  import type { ImageDetailsChange, ImageVisibilityChange } from '../../lib/api/inputs';
  import { combinationPictures, viewerSlides, type Picture } from '../../lib/images/pictures';
  import { routeHref } from '../../lib/routing/routes';
  import { combinationTitle, stepTitle } from '../../lib/glazes/glazes';
  import { isGlazeStep, type GlazeStep } from '../../lib/glazes/steps';
  import { missingSummary, shelfMatch } from '../../lib/stock/shelf';
  import { availabilityText, type GlazeAvailability } from '../../lib/stock/availability';
  import { askLink, buddyCover, groupCover, summaryNames, type BuddyHolders } from '../../lib/stock/buddy-shelf';
  import { canonicalUrl } from '../../lib/share/share';
  import { firingLine, formatFiredOn } from '../../lib/firing/firing';
  import { watchStickyFit } from '../../lib/layout/sticky-fit';
  import FavoriteButton from '../catalog/FavoriteButton.svelte';
  import BuddyMark from '../buddies/BuddyMark.svelte';
  import TagList from '../tags/TagList.svelte';
  import CardViewer from '../images/CardViewer.svelte';
  import PictureCarousel from '../images/PictureCarousel.svelte';
  import PictureCover from '../images/PictureCover.svelte';
  import PictureThumbnails from '../images/PictureThumbnails.svelte';
  import Avatar from '../avatars/Avatar.svelte';
  import AvatarReport from '../avatars/AvatarReport.svelte';

  /** What the account's buddies have of the glazes it lacks (27-3), for the detail page and Explore's "I can make now" with buddies. */
  interface BuddyShelf {
    holders: BuddyHolders;
    /** The day the availability was read, when it is offline data (shown as "as of"); omitted while online. */
    asOf?: string;
    /** "Ask Ada": shares the message; answers it only when the user has to copy it by hand. */
    onAsk: (text: string) => Promise<string | null>;
  }

  interface Props {
    combo: Combination;
    /** The loaded glazes by ID, so each glaze step shows its glaze's code (`glazeMap`). */
    glazes: ReadonlyMap<string, Glaze>;
    user: User | null;
    online: boolean;
    favorite?: boolean;
    onToggleFavorite?: () => Promise<boolean>;
    /** `returnFocus` places focus once the upload dialog closed and its opener is gone (`app.openUpload`). */
    onAddPhoto: (target: UploadTarget, returnFocus?: () => boolean) => void;
    /** Shareable link to the combination page; omitted on that page itself. */
    href?: string;
    detail?: boolean;
    /** 1 on the detail page, where the title is the page's h1; lists keep 3. */
    headingLevel?: 1 | 3;
    /** The photo the detail page's carousel opens at. */
    focusPhoto?: string;
    /** Names the item type, for lists that mix combinations and glazes. */
    showType?: boolean;
    /**
     * The glazes on the account's and its clubs' shelves (`shelfGlazeIds`); omitted for guests and
     * accounts without stock, which get no shelf line and no marks.
     */
    shelf?: ReadonlySet<string>;
    /**
     * Where each glaze of `shelf` is available (`availabilityByGlaze`): the detail page's step marks then say "Available in
     * <club>" for a glaze only club shelves hold; without it every glaze of `shelf` is "On your shelf".
     */
    availability?: ReadonlyMap<string, GlazeAvailability>;
    /** The buddies' glazes, matched with the glazes the shelf lacks; needs `shelf`. */
    buddyShelf?: BuddyShelf;
    /** The account's clubs, offered when the uploader changes who sees a picture (detail only). */
    clubs?: Club[];
    /** Their member lists, so a photo on someone else's combination is offered only what its author can see. */
    clubMembers?: Record<string, ClubMember[]>;
    /** The profile picture of each author, by account ID (`AppState.authorAvatars`); omitted for guests, who never see pictures. */
    authorAvatars?: Record<string, string>;
    /** Reports the author's picture (detail only; signed in, never the account's own picture). */
    onReportAvatar?: (avatarId: string, reason: string | null) => Promise<boolean>;
    avatarReportError?: string;
    /** The photo menu's actions (detail only). */
    onRemove?: (image: ImageInfo) => void;
    onReport?: (image: ImageInfo, reason: string | null) => Promise<boolean>;
    reportError?: string;
    visibilityError?: string;
    detailsError?: string;
    onChangeDetails?: (image: ImageInfo, change: ImageDetailsChange) => Promise<boolean>;
    kindError?: string;
    onChangeKind?: (image: ImageInfo, kind: ImageInfo['kind']) => Promise<boolean>;
    /** Sets where the cards' covers centre a photo (`canDelete`, like the kind); omitted for read-only views. */
    onChangeFocus?: (image: ImageInfo, focus: Focus | null) => Promise<boolean>;
    focusError?: string;
    onChangeVisibility?: (image: ImageInfo, change: ImageVisibilityChange) => Promise<boolean>;
    /** The detail page's own parts of the recipe column, in this order: tags after the description, the actions after the steps, then lineage and the closing part (Delete). */
    tags?: Snippet;
    share?: Snippet;
    actions?: Snippet;
    lineage?: Snippet;
    footer?: Snippet;
  }

  let {
    combo,
    glazes,
    user,
    online,
    onAddPhoto,
    favorite = false,
    onToggleFavorite,
    href,
    detail = false,
    headingLevel = 3,
    focusPhoto,
    showType = false,
    shelf,
    availability,
    buddyShelf,
    clubs = [],
    clubMembers,
    authorAvatars,
    onReportAvatar,
    avatarReportError,
    onChangeVisibility,
    onChangeDetails,
    detailsError,
    onChangeKind,
    kindError,
    onChangeFocus,
    focusError,
    onRemove,
    onReport,
    reportError,
    visibilityError,
    tags,
    share,
    actions,
    lineage,
    footer,
  }: Props = $props();
  let pictures = $derived(combinationPictures(combo, detail ? Infinity : undefined));
  /** Signed-in members see the author's picture (or the initial) beside the name; guests see the name only. */
  let byAuthor = $derived(user && combo.authorId && combo.author ? { id: combo.authorId, name: combo.author } : null);
  let authorAvatarId = $derived(byAuthor ? (authorAvatars?.[byAuthor.id] ?? null) : null);
  let title = $derived(combinationTitle(combo, $t('combination.untitled')));
  /** List cards offer no photo actions on a draft (it is never waiting); the combination page (`detail`) has its own photo buttons. */
  let photos = $derived(!!user && online && !combo.draft && !detail);
  /** The photo whose viewer is open (a list card; the detail page's gallery has its own). */
  let viewing = $state<string | null>(null);
  /**
   * A click does not focus a button in every browser: the viewer hands focus back to what had it, so the opener takes it first.
   * The photos are collected here, on the click, not while the card renders.
   */
  function openPhoto(picture: Picture | null, opener: HTMLElement) {
    if (!picture) return;
    opener.focus();
    viewing = picture.image.id;
  }
  const addPhoto = () => onAddPhoto({ type: 'combination', id: combo.id, title });
  let match = $derived(shelf ? shelfMatch(combo, shelf) : undefined);
  /** The shelf line: how many of the glazes you have, and which (the first two) you lack. */
  let shelfLine = $derived.by(() => {
    if (!match?.total) return '';
    if (!match.missing.length) return $t('combination.shelf.all', { values: { total: match.total } });
    // The detail page's marks on the steps name the missing glazes.
    if (detail) return $t('combination.shelf.some', { values: { have: match.have, total: match.total } });
    const { names, more } = missingSummary(match.missing, glazes);
    // "A and B", or "A, B and 1 more" where the translation adds the last "and".
    const list = new Intl.ListFormat($locale ?? 'en', {
      type: more > 0 ? 'unit' : 'conjunction',
    }).format(names);
    return [
      $t('combination.shelf.some', { values: { have: match.have, total: match.total } }),
      more > 0 ? $t('combination.shelf.missingMore', { values: { glazes: list, count: more } }) : $t('combination.shelf.missing', { values: { glazes: list } }),
    ].join(' · ');
  });
  /** The glazes the shelf lacks that buddies have, with who. */
  let cover = $derived(match && buddyShelf ? buddyCover(match.missing, buddyShelf.holders) : []);
  let coverByGlaze = $derived(new Map(cover.map((entry) => [entry.step.glazeId, entry.buddies])));
  /** "Buddies have the rest: Ada has Mayco SW-155; Ben and Cy have Amaco PC-20". */
  let buddyLine = $derived.by(() => {
    if (!match || !cover.length) return '';
    const listFormat = (type: Intl.ListFormatType) => new Intl.ListFormat($locale ?? 'en', { type });
    const groups = groupCover(cover).map((group) => {
      const { names, more } = summaryNames(group.buddies);
      return $t('buddies.shelf.group', {
        values: {
          count: group.buddies.length,
          names:
            more > 0
              ? $t('buddies.shelf.namesMore', { values: { names: listFormat('unit').format(names), count: more } })
              : listFormat('conjunction').format(names),
          glazes: listFormat('conjunction').format(missingSummary(group.steps, glazes, group.steps.length).names),
        },
      });
    });
    return $t(cover.length === match.missing.length ? 'buddies.shelf.restAll' : 'buddies.shelf.restSome', { values: { groups: groups.join('; ') } });
  });
  /** The link an "Ask" message carries; none for a draft, which only its author can open. */
  let askUrl = $derived(askLink(combo, canonicalUrl({ name: 'combination', id: combo.id }, location)));
  /** "Cone 6 · Ox · Speckled stoneware": only what was recorded, nothing without a final firing. */
  let firing = $derived(firingLine(combo, $t));
  /** The page adds what the line leaves out: kiln, date, and the temperature next to a cone. */
  let firingDetails = $derived(
    detail
      ? [
          ...(combo.cone && combo.temperatureC != null
            ? [
                {
                  label: $t('firing.detail.temperature'),
                  value: $t('firing.line.temperature', {
                    values: { temperature: combo.temperatureC },
                  }),
                },
              ]
            : []),
          ...(combo.kiln ? [{ label: $t('firing.kiln'), value: combo.kiln }] : []),
          ...(combo.firedOn
            ? [
                {
                  label: $t('firing.firedOn'),
                  value: formatFiredOn(combo.firedOn, $locale ?? 'en'),
                },
              ]
            : []),
        ]
      : [],
  );
  let missingIds = $derived(new Set(match?.missing.map((step) => step.glazeId)));
  /** The placeholder of an own combination without a photo offers the first test tile photo. */
  let waiting = $derived(photos && !pictures.cover && combo.own);
  /**
   * The detail page's photo buttons, for every signed-in viewer (a draft's viewer is its author): in the recipe action group below the
   * description. On a draft Publish is the page's one primary.
   */
  let photoButtons = $derived(detail && !!user);
  let card = $state<HTMLElement>();
  /** The detail page's gallery follows the page only while all of it fits the window (measured: captions and labels vary). */
  let sticky = $state(false);
  const followPage = (node: HTMLElement) => watchStickyFit(node, (fits) => (sticky = fits));
  /**
   * Keep upload focus on the matching recipe action even if a listing refresh replaced its opener.
   */
  function addPagePhoto(kind: 'TEST_TILE' | 'FINISHED') {
    const returnFocus = () => {
      const button = card?.querySelector<HTMLElement>(`[data-photo-add="${kind}"]`);
      button?.focus();
      return !!button;
    };
    onAddPhoto({ type: 'combination', id: combo.id, title, kind }, returnFocus);
  }
</script>

{#snippet photoActions()}
  <div class="combination-card__photo-actions">
    <button
      type="button"
      class={['button', { 'button--primary': !pictures.cover && !combo.draft }]}
      disabled={!online}
      data-photo-add="TEST_TILE"
      onclick={() => addPagePhoto('TEST_TILE')}>
      {$t('images.addTestTile')}
    </button>
    <button
      type="button"
      class="button"
      disabled={!online}
      aria-label={$t('images.addFinishedFor', { values: { title } })}
      data-photo-add="FINISHED"
      onclick={() => addPagePhoto('FINISHED')}>
      {$t('images.addFinished')}
    </button>
  </div>
{/snippet}

<article
  bind:this={card}
  class={['combination-card', { 'combination-card--detail': detail }]}
  data-picture-focus
  tabindex="-1">
  <div
    class={['combination-card__media', { 'combination-card__media--sticky': sticky }]}
    {@attach detail ? followPage : undefined}>
    {#if detail && pictures.cover}
      <PictureCarousel
        {pictures}
        {title}
        {focusPhoto}
        userId={user?.id}
        {online}
        {clubs}
        {clubMembers}
        authorId={combo.authorId}
        {onChangeVisibility}
        {onChangeDetails}
        {detailsError}
        {onChangeKind}
        {kindError}
        {onChangeFocus}
        {focusError}
        {onRemove}
        {onReport}
        {reportError}
        {visibilityError} />
    {:else}
      <PictureCover
        picture={pictures.cover}
        {title}
        userId={user?.id}
        onAddPhoto={waiting ? addPhoto : undefined}
        onOpen={detail ? undefined : (opener) => openPhoto(pictures.cover, opener)} />
    {/if}
  </div>
  <div class="combination-card__body">
    <div class="combination-card__heading">
      <div class="combination-card__headline">
        <div class="combination-card__meta">
          {#if showType}
            <span class="combination-card__type">
              {$t('explore.type.combination')}
            </span>
          {/if}
          {#if combo.draft}
            <span class="combination-card__draft">
              {$t('combination.draft.badge')}
            </span>
          {/if}
          {#if byAuthor && user}
            <Avatar
              size="xs"
              avatarId={authorAvatarId}
              name={byAuthor.name}
              viewerId={user.id} />
          {/if}
          {#if detail && combo.author}
            <a
              class="combination-card__author"
              href={routeHref({ name: 'discover', type: 'combinations', q: combo.author })}>
              {combo.author}
            </a>
          {:else}
            <span>{combo.author ?? $t('account.deleted')}</span>
          {/if}
          <span>·</span>
          <span>
            {$t('combination.stepCount', {
              values: { count: combo.steps.length },
            })}
          </span>
          {#if detail && byAuthor && user && byAuthor.id !== user.id && onReportAvatar}
            <AvatarReport
              avatarId={authorAvatarId}
              name={byAuthor.name}
              {online}
              error={avatarReportError}
              placement="below"
              onReport={onReportAvatar} />
          {/if}
        </div>
        <svelte:element
          this={`h${headingLevel}`}
          class="combination-card__title">
          {#if href}
            <a
              class="combination-card__link"
              {href}>
              {title}
            </a>
          {:else}
            {title}
          {/if}
        </svelte:element>
      </div>
      {#if onToggleFavorite || share}
        <div class="combination-card__header-actions">
          {#if onToggleFavorite}
            <FavoriteButton
              active={favorite}
              signedIn={!!user}
              {online}
              onToggle={onToggleFavorite} />
          {/if}
          {@render share?.()}
        </div>
      {/if}
    </div>
    {#if firing}
      <p class="combination-card__firing">{firing}</p>
    {/if}
    {#if firingDetails.length}
      <dl class="combination-card__firing-details">
        {#each firingDetails as detail (detail.label)}
          <div class="combination-card__firing-detail">
            <dt class="combination-card__firing-label">{detail.label}</dt>
            <dd class="combination-card__firing-value">{detail.value}</dd>
          </div>
        {/each}
      </dl>
    {/if}
    {#if combo.description}
      <p class="combination-card__description">{combo.description}</p>
    {/if}
    {#if detail && user}
      <div
        class="button-row combination-card__actions"
        role="group"
        aria-label={$t('combination.actions')}>
        {#if photoButtons}
          {@render photoActions()}
        {/if}
        {@render actions?.()}
      </div>
    {/if}
    {#if detail}
      {@render tags?.()}
    {/if}
    {#if shelfLine}
      <p class={['combination-card__shelf', { 'combination-card__shelf--complete': !match?.missing.length }]}>
        {shelfLine}
      </p>
    {/if}
    {#if buddyLine}
      <p class="combination-card__buddies">{buddyLine}</p>
      {#if buddyShelf?.asOf}
        <p class="combination-card__buddies-asof">{$t('buddies.shelf.asOf', { values: { date: buddyShelf.asOf } })}</p>
      {/if}
    {/if}
    <div class="combination-card__steps">
      {#each combo.steps as step (step.position)}
        <div class="combination-card__step">
          <span class="step-number">{step.position}</span>
          <div class="combination-card__application">
            {#if isGlazeStep(step)}
              <a
                class="combination-card__glaze combination-card__link"
                href={routeHref({ name: 'glaze', id: step.glazeId! })}>
                {stepTitle(glazes, step)}
              </a>
              <span class="combination-card__aside">
                <small class="combination-card__coats">
                  {$t('combination.coatCount', {
                    values: { count: step.coats ?? 1 },
                  })}{step.method ? ' · ' + step.method : ''}
                </small>
                {#if detail && match?.total}
                  {@const missing = missingIds.has(step.glazeId!)}
                  {@const mark = missing
                    ? { text: $t('combination.shelf.off'), full: '' }
                    : availability
                      ? availabilityText(availability.get(step.glazeId!), $t, $locale ?? 'en')
                      : { text: $t('combination.shelf.on'), full: '' }}
                  <span
                    class={['combination-card__shelf-mark', { 'combination-card__shelf-mark--missing': missing }]}
                    title={mark.full || undefined}>
                    <span
                      class="combination-card__dot"
                      aria-hidden="true">
                    </span>
                    <span class="combination-card__shelf-text">{mark.text}</span>
                  </span>
                  {@const buddies = coverByGlaze.get(step.glazeId!)}
                  {#if missing && buddies && buddyShelf}
                    <BuddyMark
                      {buddies}
                      glaze={missingSummary([step as GlazeStep], glazes, 1).names[0]}
                      {title}
                      link={askUrl}
                      onShare={buddyShelf.onAsk} />
                  {/if}
                {/if}
              </span>
            {:else}
              <span class="combination-card__glaze">{step.label}</span>
            {/if}
          </div>
          {#if step.notes}
            <em class="combination-card__notes">{step.notes}</em>
          {/if}
        </div>
      {/each}
    </div>
    {#if !detail}
      <TagList tags={combo.tags} />
    {/if}
    {#if !detail}
      <PictureThumbnails
        pictures={pictures.thumbnails}
        {title}
        userId={user?.id}
        total={combo.images.length}
        onOpen={openPhoto} />
    {/if}
    {#if photos && !waiting}
      <button
        class="combination-card__add-photo"
        onclick={addPhoto}>
        {$t('catalog.addPhoto')}
      </button>
    {/if}
    {#if detail}
      {@render lineage?.()}
      {@render footer?.()}
    {/if}
  </div>
  {#if viewing}
    <CardViewer
      slides={viewerSlides(combinationPictures(combo, Infinity))}
      start={viewing}
      {title}
      userId={user?.id}
      {href}
      onClose={() => (viewing = null)} />
  {/if}
</article>

<style>
  .combination-card {
    background: var(--surface);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    /* Clips the cover's corners but, unlike hidden, leaves the detail page's sticky gallery free to stick. */
    overflow: clip;
  }
  .combination-card__body {
    padding: var(--space-5);
  }
  /* From 45em the detail page is two columns: the gallery (it follows the page while the recipe is read) and the recipe. */
  @media (width >= 45em) {
    .combination-card--detail {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .combination-card--detail .combination-card__media {
      align-self: start;
    }
    .combination-card--detail .combination-card__body {
      padding: var(--space-5) var(--space-6);
      border-inline-start: 0.0625rem solid var(--border);
    }
  }
  @media (width >= 68.75em) {
    .combination-card--detail {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    }
  }
  /* Only while the whole gallery fits the window (`watchStickyFit`): a taller one would hide its lower part until the page ends. */
  @media (width >= 45em) {
    .combination-card--detail .combination-card__media--sticky {
      position: sticky;
      /* Under the sticky header, which `--header-offset` follows out and in (`fitsSticky` counts its height). */
      top: calc(var(--header-offset) + var(--space-4));
    }
    @media (prefers-reduced-motion: no-preference) {
      .combination-card--detail .combination-card__media--sticky {
        transition: top 0.2s ease;
      }
    }
  }
  .combination-card__actions {
    align-items: center;
    margin: var(--space-4) 0;
    padding: var(--space-3) 0;
    border-block: 0.0625rem solid var(--border);
  }
  .combination-card__photo-actions {
    display: contents;
  }
  .combination-card__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    color: var(--warm-ink);
    font-size: var(--font-base);
    font-weight: 700;
    letter-spacing: 0.0375rem;
  }
  /* A long name without spaces (the API allows 100 characters) wraps inside the card instead of widening the page. */
  .combination-card__meta > span,
  .combination-card__meta > a {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .combination-card__type {
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--blue);
    color: var(--ink);
    font-size: var(--font-xs);
    letter-spacing: 0;
  }
  .combination-card__draft {
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--warning-bg);
    color: var(--warning-ink);
    font-size: var(--font-xs);
    letter-spacing: 0;
  }
  .combination-card__header-actions {
    display: flex;
    align-items: center;
    flex: none;
    gap: var(--space-2);
  }
  .combination-card__heading {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .combination-card__headline {
    min-width: 0;
  }
  .combination-card__title {
    font-family: inherit;
    font-size: var(--font-xl);
    font-weight: 600;
    line-height: 1.3;
    margin: var(--space-1) 0 0;
    overflow-wrap: anywhere;
  }
  .combination-card__firing {
    margin: var(--space-2) 0 0;
    color: var(--ink);
    font-size: var(--font-sm);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .combination-card__firing-details {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-1) 0 0;
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .combination-card__firing-detail {
    display: flex;
    gap: var(--space-1);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .combination-card__firing-label::after {
    content: ':';
  }
  .combination-card__firing-value {
    margin: 0;
  }
  .combination-card__description {
    font-size: var(--font-base);
    color: var(--muted);
    line-height: 1.5;
    margin: var(--space-2) 0 0;
  }
  .combination-card__shelf {
    margin: var(--space-2) 0 0;
    color: var(--warm-ink);
    font-size: var(--font-sm);
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .combination-card__shelf--complete {
    color: var(--accent);
  }
  .combination-card__buddies {
    margin: var(--space-1) 0 0;
    color: var(--ink);
    font-size: var(--font-sm);
    overflow-wrap: anywhere;
  }
  .combination-card__buddies-asof {
    margin: var(--space-0-5) 0 0;
    color: var(--muted);
    font-size: var(--font-xs);
  }
  .combination-card__shelf-mark {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    min-width: 0;
    color: var(--accent);
    font-size: var(--font-xs);
  }
  /* A club name without spaces still wraps inside the column (names are cut at `CLUB_NAME_MAX`, but a phone is narrow). */
  .combination-card__shelf-text {
    min-width: 0;
    overflow-wrap: break-word;
  }
  .combination-card__shelf-mark--missing {
    color: var(--warm-ink);
  }
  .combination-card__dot {
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--accent);
  }
  .combination-card__shelf-mark--missing .combination-card__dot {
    background: transparent;
    box-shadow: inset 0 0 0 0.125rem var(--warm-ink);
  }
  .combination-card__steps {
    border-top: 0.0625rem solid var(--border);
    margin-top: var(--space-3);
    padding-top: var(--space-1);
  }
  .combination-card__step {
    display: grid;
    grid-template-columns: 1.5rem minmax(0, 1fr);
    align-items: start;
    column-gap: var(--space-2);
    padding: var(--space-1) 0;
    font-size: var(--font-sm);
  }
  /* Glaze and coats share a line when there is room; the coats wrap below otherwise. */
  .combination-card__application {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    align-content: center;
    column-gap: var(--space-3);
    min-width: 0;
    min-height: 1.5rem;
  }
  /* Glaze, then coats and the shelf mark at the end of the row; they wrap below the name where the column is narrow. */
  .combination-card__aside {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: flex-end;
    gap: var(--space-0-5) var(--space-3);
    min-width: 0;
  }
  .combination-card__glaze {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .combination-card__link {
    color: inherit;
    text-decoration: none;
  }
  .combination-card__author {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
  /* The glaze names are links: visible underline, like the author. */
  .combination-card__glaze.combination-card__link {
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
  .combination-card__link:hover {
    text-decoration: underline;
  }
  .combination-card__coats {
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .combination-card__notes {
    grid-column: 2;
    color: var(--muted);
    font-style: normal;
    overflow-wrap: anywhere;
  }
  .combination-card__add-photo {
    padding: var(--space-2-5) 0 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
  }
  @media (width < 45em) {
    .combination-card--detail .combination-card__headline {
      display: flex;
      flex-direction: column;
    }
    .combination-card--detail .combination-card__title {
      order: -1;
      margin-bottom: var(--space-2);
    }
    /* Whatever wraps onto a row of its own fills it (the page's buttons are slotted in, hence :global); the photo buttons below keep sharing theirs. */
    .combination-card__actions :global(.button) {
      flex: 1 1 auto;
    }
    .combination-card__photo-actions {
      display: flex;
      flex: 1 1 100%;
      gap: var(--space-2);
    }
    .combination-card__photo-actions .button {
      flex: 1 1 0;
      padding-inline: var(--space-1-5);
    }
  }
  @media (pointer: coarse) {
    .combination-card__author,
    .combination-card__link {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
    .combination-card__author {
      min-width: var(--touch-target);
      justify-content: center;
    }
    .combination-card__step {
      align-items: center;
    }
    .combination-card__coats {
      font-size: 1em;
    }
    .combination-card__shelf-mark {
      font-size: var(--font-body);
    }
    .combination-card__add-photo {
      display: inline-flex;
      align-items: center;
      min-width: var(--touch-target);
      min-height: var(--touch-target);
      padding: 0;
    }
  }
</style>

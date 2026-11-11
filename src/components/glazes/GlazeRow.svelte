<script lang="ts">
  import { coverPosition } from '../../lib/images/photo-focus';
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { BuddyName, Glaze, User } from '../../lib/api/models';
  import { DEFAULT_JAR_G } from '../../lib/stock/shelf';
  import FormError from '../common/FormError.svelte';
  import { glazeCode, glazeTitle } from '../../lib/glazes/glazes';
  import { glazeGallery, pictureSrc, viewerSlides, type Picture } from '../../lib/images/pictures';
  import BuddyMark from '../buddies/BuddyMark.svelte';
  import ShareButton from '../sharing/ShareButton.svelte';
  import FavoriteButton from '../catalog/FavoriteButton.svelte';
  import Icon from '../ui/Icon.svelte';
  import CardViewer from '../images/CardViewer.svelte';
  import ImageView from '../images/ImageView.svelte';

  interface Props {
    glaze: Glaze;
    /** The glaze's own photo for the thumbnail, if it has one. */
    picture: Picture | null;
    /** Combinations that use the glaze. */
    usedIn: number;
    /** More than 0 g of it on the personal shelf. */
    onShelf: boolean;
    /** "Available in <club>": a glaze only club shelves hold, while the active view counts club stock (`availabilityText`); `full` is the tooltip of a cut name. */
    clubShelf?: { text: string; full: string };
    user: User | null;
    online: boolean;
    favorite: boolean;
    onShare?: () => Promise<string | null>;
    onToggleFavorite: () => Promise<boolean>;
    /** Link to the glaze page. */
    href: string;
    /** Link to Explore filtered by this glaze. */
    combinationsHref: string;
    /** "On my shelf" with "Include buddies" (27-13): the accepted buddies who have this glaze when the shelf does not, named by the mark. */
    /** One-click add of a default jar to the personal shelf (a "+" beside the star); absent where the glaze has a personal entry or for a guest. Answers whether it worked. */
    onQuickAdd?: () => Promise<boolean>;
    /** Why the last one-click add of this row failed. */
    quickError?: string;
    buddyShelf?: { buddies: BuddyName[]; asOf?: string; onAsk: (text: string) => Promise<string | null> };
  }

  let {
    glaze,
    picture,
    usedIn,
    onShelf,
    clubShelf,
    user,
    online,
    favorite,
    onShare,
    onToggleFavorite,
    href,
    combinationsHref,
    buddyShelf,
    onQuickAdd,
    quickError = '',
  }: Props = $props();
  let title = $derived(glazeTitle(glaze));
  let widthInRem = $state(0);
  let showShare = $derived(!!onShare && widthInRem >= (onQuickAdd && online ? 25 : 22));
  // Avoid CSS containment: this card also owns dialogs that must cover the viewport.
  const measureShareSpace = (node: HTMLElement) => {
    const observer = new ResizeObserver(([entry]) => {
      widthInRem = entry.contentRect.width / parseFloat(getComputedStyle(document.documentElement).fontSize);
    });
    observer.observe(node);
    return () => observer.disconnect();
  };
  /** The image ID of the photo whose viewer is open; the viewer steps through the glaze's own photos. */
  let viewing = $state<string | null>(null);
  /** A click does not focus a button in every browser: the viewer hands focus back to what had it, so the button takes it first. */
  let adding = $state(false);
  let nameLink = $state<HTMLAnchorElement>();
  let quickButton = $state<HTMLButtonElement>();
  async function quickAdd() {
    if (adding || !onQuickAdd) return;
    adding = true;
    try {
      // The button goes with the entry: focus moves to the glaze's link, which stays.
      if (await onQuickAdd()) {
        await tick();
        nameLink?.focus();
      } else {
        // A disabled button drops focus: after a failure the person retries from the same button.
        adding = false;
        await tick();
        quickButton?.focus();
      }
    } finally {
      adding = false;
    }
  }
  function openPhoto(opener: HTMLElement) {
    if (!picture) return;
    opener.focus();
    viewing = picture.image.id;
  }
</script>

<article
  class="glaze-row"
  {@attach measureShareSpace}
  data-picture-focus
  tabindex="-1">
  <div class="glaze-row__main">
    {#if picture}
      <div class="glaze-row__photo">
        {#key picture.image.id}
          <ImageView
            variant="thumbnail"
            src={pictureSrc(picture.image)}
            position={coverPosition(picture.image)}
            userId={user?.id}
            alt={$t(picture.image.kind === 'TEST_TILE' ? 'images.alt.tile' : 'images.alt.finished', {
              values: { title },
            })} />
        {/key}
        <button
          type="button"
          class="glaze-row__open"
          aria-label={$t('images.cover.open', { values: { title } })}
          onclick={(event) => openPhoto(event.currentTarget)}>
        </button>
      </div>
    {:else}
      <div
        class="glaze-row__no-photo"
        aria-hidden="true">
      </div>
    {/if}
    <div class="glaze-row__text">
      <p class="glaze-row__meta">
        <span class="glaze-row__type">{$t('explore.type.glaze')}</span>
        <span class="glaze-row__code">{glazeCode(glaze)}</span>
      </p>
      <h3 class="glaze-row__name">
        <a
          bind:this={nameLink}
          class="glaze-row__link"
          {href}>
          {glaze.name}
        </a>
      </h3>
      <p class="glaze-row__usage">
        {$t('explore.glazeRow.usedIn', { values: { count: usedIn } })}
        {#if onShelf}
          <span class="glaze-row__shelf">
            <span
              class="glaze-row__dot"
              aria-hidden="true">
            </span>
            {$t('explore.glazeRow.onShelf')}
          </span>
        {:else if clubShelf}
          <span
            class="glaze-row__shelf glaze-row__shelf--club"
            title={clubShelf.full || undefined}>
            <span
              class="glaze-row__dot"
              aria-hidden="true">
            </span>
            <span class="glaze-row__shelf-text">{clubShelf.text}</span>
          </span>
        {/if}
      </p>
      {#if buddyShelf}
        <p class="glaze-row__buddies">
          <BuddyMark
            buddies={buddyShelf.buddies}
            glaze={title}
            title={null}
            link={null}
            onShare={buddyShelf.onAsk} />
        </p>
      {/if}
    </div>
    <div class="glaze-row__buttons">
      {#if onQuickAdd && online}
        <button
          bind:this={quickButton}
          type="button"
          class="icon-button glaze-row__quick"
          disabled={adding}
          aria-label={$t('glaze.shelf.quickAddFor', { values: { size: DEFAULT_JAR_G, glaze: title } })}
          title={$t('glaze.shelf.quickAdd')}
          onclick={quickAdd}>
          <Icon name="plus" />
        </button>
      {/if}
      <FavoriteButton
        active={favorite}
        signedIn={!!user}
        {online}
        onToggle={onToggleFavorite} />
      {#if showShare && onShare}
        <div class="glaze-row__share"><ShareButton {onShare} /></div>
      {/if}
    </div>
  </div>
  {#if usedIn > 0}
    <a
      class="glaze-row__combinations"
      href={combinationsHref}
      aria-label={$t('explore.glazeRow.showCombinationsFor', { values: { glaze: title } })}>
      {$t('explore.glazeRow.showCombinations')}
    </a>
  {/if}
  {#if quickError}
    <FormError message={quickError} />
  {/if}
  {#if viewing}
    <CardViewer
      slides={viewerSlides(glazeGallery(glaze))}
      start={viewing}
      {title}
      userId={user?.id}
      {href}
      onClose={() => (viewing = null)} />
  {/if}
</article>

<style>
  .glaze-row__buddies {
    margin: var(--space-1) 0 0;
  }
  .glaze-row {
    background: var(--surface);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
  }
  .glaze-row__main {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .glaze-row__photo {
    position: relative;
    flex: none;
  }
  .glaze-row__open {
    position: absolute;
    inset: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    cursor: pointer;
  }
  .glaze-row__buttons {
    display: flex;
    gap: var(--space-1-5);
    flex: none;
  }
  .glaze-row__no-photo {
    width: 3.3125rem;
    height: 3.3125rem;
    flex: none;
    border-radius: var(--radius-sm);
    background: var(--sage);
  }
  .glaze-row__text {
    flex: 1;
    min-width: 0;
  }
  .glaze-row__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
    margin: 0;
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .glaze-row__type {
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--peach);
    color: var(--ink);
    font-size: var(--font-xs);
    font-weight: 700;
  }
  .glaze-row__code {
    overflow-wrap: anywhere;
  }
  .glaze-row__name {
    margin: var(--space-1) 0 0;
    font-size: var(--font-md);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .glaze-row__link {
    color: inherit;
    text-decoration: none;
  }
  .glaze-row__link:hover {
    text-decoration: underline;
  }
  .glaze-row__usage {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    margin: var(--space-1) 0 0;
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .glaze-row__shelf {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    min-width: 0;
  }
  .glaze-row__shelf-text {
    min-width: 0;
    overflow-wrap: break-word;
  }
  /* Club names make the mark long: it takes a line of its own and wraps around the dot, which a narrow column needs (320 px). */
  .glaze-row__shelf--club {
    display: block;
    flex: 1 1 100%;
  }
  .glaze-row__shelf--club .glaze-row__dot {
    display: inline-block;
    margin-inline-end: var(--space-1-5);
    vertical-align: middle;
  }
  .glaze-row__dot {
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--accent);
  }
  .glaze-row__combinations {
    display: inline-block;
    margin-top: var(--space-2);
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
  }
  @media (pointer: coarse) {
    .glaze-row__link,
    .glaze-row__combinations {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>

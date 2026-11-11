<script lang="ts">
  import { locale, t } from '../../lib/i18n';
  import { imageKindKey, type Picture } from '../../lib/images/pictures';
  import { formatFiredOn } from '../../lib/firing/firing';

  interface Props {
    picture: Picture;
    /** The detail stage shows the line over the photo (`line`) and the caption under it (`caption`); the viewer shows both. */
    part?: 'all' | 'line' | 'caption';
  }
  let { picture, part = 'all' }: Props = $props();
  let image = $derived(picture.image);
  let parts = $derived([
    $t(imageKindKey(image.kind)),
    ...(picture.combination ? [$t('images.usedIn', { values: { title: picture.combination.title } })] : []),
    ...(image.own
      ? [$t('images.uploader.own')]
      : // `undefined`: saved offline before uploaders were named (the next load replaces it); `null`: a deleted account.
        image.uploader === undefined
        ? []
        : [$t('images.uploader', { values: { name: image.uploader ?? $t('account.deleted') } })]),
    ...(image.firedOn ? [$t('images.firedOn', { values: { date: formatFiredOn(image.firedOn, $locale ?? 'en') } })] : []),
  ]);
</script>

<!-- The shown photo's caption, then ONE line: the kind (the stage carries no badge), where a glaze's borrowed photo comes from, who took it, when it was fired.
     The gallery under the stage and the full-screen viewer show the same text. -->
{#if image.caption && part !== 'line'}
  <p class="picture-meta__caption">{image.caption}</p>
{/if}
{#if part !== 'caption'}
  <p
    class={['picture-meta__line', { 'picture-meta__line--over': part === 'line' }]}
    title={part === 'line' ? parts.join(' · ') : undefined}>
    <!-- Each dot stays with the part before it (no-break space), so a wrapped line may end with a dot but never starts with one; no formatter whitespace inside a part. -->
    {#each parts as part, position (position)}
      {#if position > 0}{' '}{/if}
      <!-- prettier-ignore -->
      <span class="picture-meta__part">{part}{#if position < parts.length - 1}&nbsp;<span aria-hidden="true">·</span>{/if}</span>
    {/each}
  </p>
{/if}

<style>
  .picture-meta__caption {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .picture-meta__line {
    margin: 0;
    min-width: 0;
    /* The viewer sets a lighter colour on its dark ground. */
    color: var(--picture-meta-color, var(--muted));
    font-size: var(--font-sm);
    overflow-wrap: anywhere;
  }
  /* Where the line wraps, it breaks between its parts, not inside a date. */
  .picture-meta__part {
    display: inline-block;
  }
  /* Over the photo: one line, cut with an ellipsis; the whole text is the title and stays in the page for a screen reader. */
  .picture-meta__line--over {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow-wrap: normal;
  }
  .picture-meta__line--over .picture-meta__part {
    display: inline;
  }
</style>

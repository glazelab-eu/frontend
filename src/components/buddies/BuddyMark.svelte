<script lang="ts">
  import { locale, t } from '../../lib/i18n';
  import type { BuddyName } from '../../lib/api/models';
  import { markNames } from '../../lib/stock/buddy-shelf';
  import AskBuddy from './AskBuddy.svelte';

  interface Props {
    /** The accepted buddies who have this glaze (at least one), ordered by name. */
    buddies: BuddyName[];
    /** The glaze's display code and name. */
    glaze: string;
    /** The combination being asked about, or null on a glaze (the message then names the glaze alone). */
    title: string | null;
    /** Its link, or null where the buddy could not open it (a draft). */
    link: string | null;
    onShare: (text: string) => Promise<string | null>;
  }

  let { buddies, glaze, title, link, onShare }: Props = $props();
  let named = $derived(markNames(buddies) === 'names');
  /** "At Ada's", "At Ada's and Ben's" (the translation words the possessive and the place). */
  let label = $derived(
    named
      ? $t('buddies.shelf.atNames', {
          values: {
            names: new Intl.ListFormat($locale ?? 'en', { type: 'conjunction' }).format(
              buddies.map((buddy) => $t('buddies.shelf.atName', { values: { name: buddy.displayName } })),
            ),
          },
        })
      : $t('buddies.shelf.atCount', { values: { count: buddies.length } }),
  );
</script>

{#snippet shape()}
  <span
    class="buddy-mark__shape"
    aria-hidden="true">
  </span>
{/snippet}

{#if named}
  <span class="buddy-mark">
    <span class="buddy-mark__label">
      {@render shape()}
      {label}
    </span>
    {#each buddies as buddy (buddy.id)}
      <AskBuddy
        {buddy}
        {glaze}
        {title}
        {link}
        {onShare} />
    {/each}
  </span>
{:else}
  <details class="buddy-mark buddy-mark--many">
    <summary class="buddy-mark__label">
      {@render shape()}
      {label}
    </summary>
    <ul class="buddy-mark__list">
      {#each buddies as buddy (buddy.id)}
        <li class="buddy-mark__item">
          <span class="buddy-mark__name">{buddy.displayName}</span>
          <AskBuddy
            {buddy}
            {glaze}
            {title}
            {link}
            {onShare} />
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .buddy-mark {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-0-5) var(--space-2);
    min-width: 0;
    color: var(--ink);
    font-size: var(--font-xs);
  }
  .buddy-mark__label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-weight: 400;
    overflow-wrap: anywhere;
  }
  /* A diamond: neither the filled dot of "On your shelf" nor its hollow ring, so the three marks differ by shape as well as by text. */
  .buddy-mark__shape {
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    background: var(--ink);
    transform: rotate(45deg);
  }
  .buddy-mark--many {
    display: block;
  }
  .buddy-mark--many > summary {
    cursor: pointer;
  }
  /* The summary shows no native marker (it is a flex row), so a chevron says that it opens. */
  .buddy-mark--many > summary::after {
    content: '▾';
    margin-inline-start: var(--space-1);
  }
  .buddy-mark--many[open] > summary::after {
    content: '▴';
  }
  .buddy-mark__list {
    margin: var(--space-1) 0 0;
    padding: 0;
    list-style: none;
  }
  .buddy-mark__item {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-0-5) var(--space-3);
  }
  .buddy-mark__name {
    overflow-wrap: anywhere;
  }
  @media (pointer: coarse) {
    .buddy-mark {
      font-size: var(--font-body);
    }
    .buddy-mark--many > summary {
      min-height: var(--touch-target);
    }
    .buddy-mark__item {
      min-height: var(--touch-target);
      align-items: center;
    }
  }
</style>

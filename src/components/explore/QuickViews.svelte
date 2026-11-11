<script lang="ts">
  import { t } from '../../lib/i18n';
  import ChipRow from '../ui/ChipRow.svelte';
  import FilterChip from '../ui/FilterChip.svelte';
  import type { QuickChip } from '../../lib/explore/explore';
  import { quickLabels, type QuickView } from '../../lib/routing/routes';

  interface Props {
    chips: QuickChip[];
    /** The view in effect. */
    active: QuickView;
    /** The link of a view: search, tags, glaze and type stay. */
    href: (view: QuickView) => string;
    /** Explains an unusable chip or names the shelves a view counts; shown under the chips. */
    note?: string;
    /** A narrowing or widening step of the active view, shown on its own line under the chips. */
    step?: { label: string; count: number; active: boolean; href: string };
    /** The parts of the shelf "On my shelf" can list (in stock, used up, all), as a chip row of its own under the chips. */
    choices?: { label: string; count: number; active: boolean; href: string }[];
    /** "Include buddies" shared by the availability views: shown once the account has buddies; remembered by the page. The hint names what it does in the view. */
    buddies?: { on: boolean; onChange: (on: boolean) => void; hint: string };
    /** "Include club glazes": shown with availability views when a club shelf has an entry. */
    clubs?: { on: boolean; onChange: (on: boolean) => void };
  }

  let { chips, active, href, note, step, choices, buddies, clubs }: Props = $props();
  const noteId = 'quick-views-note';
</script>

{#if chips.length}
  <div class="quick-views">
    <ChipRow
      label={$t('discover.quick.label')}
      {active}>
      {#each chips as chip (chip.view)}
        <FilterChip
          label={$t(quickLabels[chip.view])}
          count={chip.count}
          active={chip.view === active}
          href={href(chip.view)}
          unavailable={!!chip.reason}
          describedBy={chip.reason ? 'quick-views-refusal' : undefined} />
      {/each}
    </ChipRow>
    {#if chips.some((chip) => chip.reason)}
      <p
        id="quick-views-refusal"
        class="quick-views__note">
        {$t('discover.quick.needShelf')}
      </p>
    {/if}
    {#if step}
      <div class="quick-views__step">
        <FilterChip
          label={step.label}
          count={step.count}
          active={step.active}
          href={step.href}
          current="true" />
      </div>
    {/if}
    {#if choices?.length}
      <div class="quick-views__step">
        <ChipRow
          label={$t('discover.shelfStock.label')}
          active={choices.find((choice) => choice.active)?.label}>
          {#each choices as choice (choice.href)}
            <FilterChip
              label={choice.label}
              count={choice.count}
              active={choice.active}
              href={choice.href}
              current="true" />
          {/each}
        </ChipRow>
      </div>
    {/if}
    {#if clubs}
      <label class="quick-views__buddies">
        <input
          type="checkbox"
          checked={clubs.on}
          onchange={(event) => clubs.onChange(event.currentTarget.checked)} />
        <span>
          {$t('discover.shelf.clubs.include')}
          <small class="quick-views__hint">{$t('discover.shelf.clubs.hint')}</small>
        </span>
      </label>
    {/if}
    {#if buddies}
      <label class="quick-views__buddies">
        <input
          type="checkbox"
          checked={buddies.on}
          onchange={(event) => buddies.onChange(event.currentTarget.checked)} />
        <span>
          {$t('discover.buddies.include')}
          <small class="quick-views__hint">{buddies.hint}</small>
        </span>
      </label>
    {/if}
    {#if note}
      <p
        id={noteId}
        class="quick-views__note">
        {note}
      </p>
    {/if}
  </div>
{/if}

<style>
  .quick-views {
    margin-top: var(--space-4);
  }
  .quick-views__step {
    margin-top: var(--space-2);
  }
  .quick-views__buddies {
    display: flex;
    width: fit-content;
    align-items: flex-start;
    gap: var(--space-2);
    margin-top: var(--space-2);
    font-size: var(--font-sm);
    font-weight: 700;
  }
  .quick-views__buddies input {
    margin-top: var(--space-0-5);
  }
  .quick-views__hint {
    display: block;
    color: var(--muted);
    font-size: var(--font-xs);
    font-weight: 400;
  }
  /* The note names the clubs: a long name without a space wraps instead of widening the page. */
  .quick-views__note {
    margin: var(--space-2) 0 0;
    color: var(--muted);
    font-size: var(--font-sm);
    overflow-wrap: break-word;
  }
  @media (width < 45em) {
    .quick-views {
      margin-top: var(--space-2);
    }
  }
  @media (pointer: coarse) {
    .quick-views__buddies {
      align-items: center;
      min-height: var(--touch-target);
      font-size: var(--font-body);
    }
    .quick-views__hint {
      font-size: var(--font-body);
    }
  }
</style>

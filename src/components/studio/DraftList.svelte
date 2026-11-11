<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { Combination } from '../../lib/api/models';
  import { combinationTitle } from '../../lib/glazes/glazes';
  import { routeHref } from '../../lib/routing/routes';
  import FoldPanel from './FoldPanel.svelte';

  interface Props {
    /** The account's own drafts, newest first; nobody else can see them. */
    drafts: Pick<Combination, 'id' | 'title' | 'steps' | 'images'>[];
    /** Below 720 px the list is folded behind its heading with the count. */
    phone: boolean;
  }

  let { drafts, phone }: Props = $props();
  /** Steps, and the photos when there are any (only the author sees a draft's photos). */
  const meta = (draft: Props['drafts'][number]) =>
    [
      $t('combination.stepCount', { values: { count: draft.steps.length } }),
      ...(draft.images.length ? [$t('studio.drafts.photos', { values: { count: draft.images.length } })] : []),
    ].join(' · ');
</script>

<FoldPanel
  class="draft-list"
  id="draft-list-body"
  title={$t('studio.drafts.title')}
  count={drafts.length}
  {phone}>
  <ul
    class="draft-list__items"
    aria-label={$t('studio.drafts.title')}>
    {#each drafts as draft (draft.id)}
      <li class="draft-list__item">
        <a
          class="draft-list__link"
          href={routeHref({ name: 'studio', id: draft.id })}>
          {combinationTitle(draft, $t('combination.untitled'))}
        </a>
        <span class="draft-list__meta">
          {meta(draft)}
        </span>
      </li>
    {/each}
  </ul>
</FoldPanel>

<style>
  .draft-list__items {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .draft-list__item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    min-height: var(--touch-target);
    border-top: 0.0625rem solid var(--border);
    padding: var(--space-1) 0;
  }
  .draft-list__link {
    color: var(--accent);
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .draft-list__meta {
    color: var(--muted);
    font-size: var(--font-xs);
  }
  @media (pointer: coarse) {
    .draft-list__link {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
    .draft-list__meta {
      font-size: var(--font-body);
    }
  }
</style>

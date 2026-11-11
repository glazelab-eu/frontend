<script lang="ts">
  import { locale, t } from '../../lib/i18n';
  import type { Glaze } from '../../lib/api/models';
  import { formatEditedOn } from '../../lib/glazes/glaze-edit';

  interface Props {
    glaze: Glaze;
    /** Signed in: the Edit control shows (disabled offline). */
    signedIn: boolean;
    online: boolean;
    onEdit: () => void;
    onHistory: () => void;
  }

  let { glaze, signedIn, online, onEdit, onHistory }: Props = $props();
  const id = $props.id();
  let lang = $derived($locale ?? 'en');
  let added = $derived(formatEditedOn(glaze.createdAt, lang));
  let addedBy = $derived(glaze.addedBy ?? $t('account.deleted'));
</script>

<section
  class="glaze-about"
  aria-labelledby={id}>
  <h2
    class="glaze-about__title"
    {id}>
    {$t('glaze.details.title')}
  </h2>
  <p class="glaze-about__line">
    {added ? $t('glaze.details.addedBy', { values: { name: addedBy, date: added } }) : $t('glaze.details.addedByUndated', { values: { name: addedBy } })}
  </p>
  {#if glaze.lastEditedAt}
    <p class="glaze-about__line">
      {$t('glaze.details.lastEdited', {
        values: { name: glaze.lastEditedBy ?? $t('account.deleted'), date: formatEditedOn(glaze.lastEditedAt, lang) },
      })}
    </p>
  {/if}
  <div class="button-row glaze-about__actions">
    {#if signedIn}
      <button
        type="button"
        class="button"
        disabled={!online}
        aria-label={$t('glaze.details.editLabel')}
        onclick={onEdit}>
        {$t('glaze.details.edit')}
      </button>
    {/if}
    <button
      type="button"
      class="button"
      onclick={onHistory}>
      {$t('glaze.details.history')}
    </button>
  </div>
</section>

<style>
  /* Stands in the glaze card's right column, below the combinations, set off by a rule. */
  .glaze-about {
    margin-top: var(--space-6);
    padding-top: var(--space-4);
    border-top: 0.0625rem solid var(--border);
  }
  .glaze-about__title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-md);
    font-weight: 700;
  }
  .glaze-about__line {
    margin: 0 0 var(--space-1);
    color: var(--muted);
    font-size: var(--font-sm);
    overflow-wrap: anywhere;
  }
  .glaze-about__actions {
    margin-top: var(--space-3);
  }
</style>

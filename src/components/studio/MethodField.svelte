<script lang="ts">
  import { t } from '../../lib/i18n';
  import { METHOD_CHIPS, isMethodChoice, methodAfterChoice } from '../../lib/studio/step-draft';

  interface Props {
    /** Free text: the quick picks fill it with their label as shown, and it can be typed over. */
    value: string;
  }

  let { value = $bindable() }: Props = $props();
</script>

<div class="method">
  <label class="form-field method__field">
    {$t('studio.step.method')}
    <input
      class="form-field__control"
      bind:value
      maxlength="80"
      placeholder={$t('studio.step.methodPlaceholder')} />
  </label>
  <div
    class="method__chips"
    role="group"
    aria-label={$t('studio.step.methods')}>
    {#each METHOD_CHIPS as key (key)}
      {@const label = $t(key)}
      <button
        class={['method__chip', { 'method__chip--chosen': isMethodChoice(value, label) }]}
        type="button"
        aria-pressed={isMethodChoice(value, label)}
        onclick={() => (value = methodAfterChoice(value, label))}>
        {label}
      </button>
    {/each}
  </div>
</div>

<style>
  .method__field {
    margin-bottom: var(--space-2);
  }
  .method__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .method__chip {
    border: 0.0625rem solid transparent;
    border-radius: var(--radius-pill);
    background: var(--sage);
    min-height: var(--touch-target);
    padding: var(--space-1-5) var(--space-4);
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
  }
  .method__chip--chosen {
    background: var(--accent);
    color: var(--paper);
  }
</style>

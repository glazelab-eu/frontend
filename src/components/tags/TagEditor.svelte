<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import { maxTagsPerItem, pendingTag, tagOptions, type TagCount } from '../../lib/tags/tags';
  import Combobox from '../ui/Combobox.svelte';
  import TagList from './TagList.svelte';

  interface Props {
    tags: string[];
    /** Live item editing: hide the repeated label and normalisation hint; validation still shows. */
    compact?: boolean;
    /** Tags of the loaded listings (also offline), most used first, offered while typing. */
    suggestions: TagCount[];
    /** Resolve true once the tag was added or removed; the typed text is kept otherwise. */
    onAdd: (tag: string) => boolean | Promise<boolean>;
    onRemove: (tag: string) => boolean | Promise<boolean>;
    /**
     * In a form that saves its tags with the item: a valid typed tag is added on save
     * (`withPendingTag`), so it says so; only text that cannot become a tag blocks the form.
     */
    addOnSave?: boolean;
    /** The typed, not yet added text; bind it to save it with the form. */
    text?: string;
  }

  let { tags, suggestions, onAdd, onRemove, compact = false, addOnSave = false, text = $bindable('') }: Props = $props();
  const id = $props.id();

  interface TagOption {
    id: string;
    count: number;
    isNew: boolean;
  }

  let editor = $state<HTMLElement>();
  let busy = $state(false);
  let pending = $derived(pendingTag(text, tags));

  /** Puts the cursor in the field that adds a tag. */
  export function focus() {
    editor?.querySelector('input')?.focus();
  }

  const options = (_: TagOption[], query: string): TagOption[] =>
    tagOptions(suggestions, query, tags).map(({ tag, count, isNew }) => ({
      id: tag,
      count,
      isNew,
    }));

  /** Shown in the empty suggestion list; typed text is explained below the field instead. */
  let noTags = $derived($t('tags.none'));
  /** Why the typed text cannot become a tag; it blocks the form until changed or cleared. */
  let problem = $derived(
    pending.kind !== 'invalid'
      ? ''
      : pending.problem === 'tooMany'
        ? $t('errors.tagTooMany')
        : pending.problem === 'tooLong'
          ? $t('errors.tagTooLong')
          : $t('errors.tagEmpty'),
  );
  let status = $derived(
    problem ||
      (pending.kind === 'present' ? $t('tags.present') : pending.kind === 'add' && addOnSave ? $t('tags.pending', { values: { tag: pending.tag } }) : ''),
  );

  /** Enter without a chosen suggestion adds the typed tag; text that cannot become one stays. */
  function enter(): boolean {
    if (pending.kind === 'add') add(pending.tag);
    else if (pending.kind === 'present') text = '';
    else return false;
    return true;
  }

  async function change(action: () => boolean | Promise<boolean>): Promise<boolean> {
    if (busy) return false;
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  }

  async function add(tag: string) {
    if (await change(() => onAdd(tag))) text = '';
  }

  /** Keeps keyboard focus in place: on the next tag's remove button, else on the input. */
  async function remove(tag: string) {
    const index = tags.indexOf(tag);
    if (!(await change(() => onRemove(tag)))) return;
    await tick();
    const buttons = editor?.querySelectorAll<HTMLElement>('.tag-list__remove') ?? [];
    (buttons[Math.min(index, buttons.length - 1)] ?? editor?.querySelector('input'))?.focus();
  }
</script>

<div
  class="tag-editor"
  bind:this={editor}>
  <Combobox
    {compact}
    items={[]}
    selectedId=""
    onSelect={(tag) => {
      if (tag) add(tag);
    }}
    filter={options}
    itemText={(option) => option.id}
    optionCode={(option) => (option.isNew ? $t('tags.new') : $t('tags.uses', { values: { count: option.count } }))}
    optionText={(option) => option.id}
    label={$t('tags.add')}
    placeholder={$t('tags.placeholder')}
    invalidMessage={problem}
    noMatchMessage={text.trim() ? '' : noTags}
    matchesMessage={(count) => $t('tags.matches', { values: { count } })}
    required={false}
    onEnter={enter}
    describedBy={status ? `${id}-status` : undefined}
    bind:text />
  {#if !compact}
    <p class="tag-editor__hint">
      {$t('tags.hint', { values: { count: tags.length, max: maxTagsPerItem } })}
    </p>
  {/if}
  {#if status}
    <p
      class={['tag-editor__status', { 'tag-editor__status--problem': problem }]}
      class:tag-editor__status--compact={compact}
      id="{id}-status">
      {status}
    </p>
  {/if}
  <TagList
    {tags}
    onRemove={remove} />
</div>

<style>
  .tag-editor__status {
    margin: calc(-1 * var(--space-2)) 0 var(--space-3);
    font-size: var(--font-xs);
    font-weight: 700;
  }
  .tag-editor__status--compact {
    margin-top: var(--space-2);
  }
  .tag-editor__status--problem {
    color: var(--danger-ink);
  }
  .tag-editor__hint {
    margin: calc(-1 * var(--space-2)) 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  @media (pointer: coarse) {
    .tag-editor__status,
    .tag-editor__hint {
      font-size: var(--font-body);
    }
  }
</style>

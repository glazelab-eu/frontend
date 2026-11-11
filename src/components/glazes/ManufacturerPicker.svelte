<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { Manufacturer } from '../../lib/api/models';
  import { filterManufacturers, manufacturerLabel } from '../../lib/glazes/glazes';
  import Combobox from '../ui/Combobox.svelte';

  interface Props {
    manufacturers: Manufacturer[];
    /** The chosen manufacturer id, or '' while none is chosen. */
    selectedId: string;
    onSelect: (id: string) => void;
    /** Follows the typed text, so a missing manufacturer can be added under that name. */
    onText: (text: string) => void;
  }

  let { manufacturers, selectedId, onSelect, onText }: Props = $props();
</script>

<Combobox
  items={manufacturers}
  {selectedId}
  {onSelect}
  {onText}
  filter={filterManufacturers}
  itemText={manufacturerLabel}
  optionCode={(manufacturer) => manufacturer.shortId}
  optionText={(manufacturer) => manufacturer.name}
  label={$t('glazeForm.manufacturer')}
  placeholder={$t('glazeForm.manufacturerPlaceholder')}
  invalidMessage={$t('glazeForm.manufacturerInvalid')}
  noMatchMessage={$t('glazeForm.manufacturerNoMatch')}
  matchesMessage={(count) => $t('glazeForm.manufacturerMatches', { values: { count } })} />

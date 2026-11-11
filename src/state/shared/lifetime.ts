import { onDestroy } from 'svelte';

/**
 * Call while a component initializes. After an `await` the component may be gone, or the account
 * may have changed: `mounted()` answers the first, `current(actor)` both (`actor` is the account
 * ID read before the await).
 */
export function lifetime(account: () => string | null | undefined = () => undefined) {
  let alive = true;
  onDestroy(() => {
    alive = false;
  });
  return {
    mounted: () => alive,
    current: (actor: string | null | undefined) => alive && account() === actor,
  };
}

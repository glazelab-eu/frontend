/**
 * The operator's contact address on request: it is fetched by `show` (a click) and held only while the
 * component that owns this object lives. `clear` (called on unmount) forgets it, and an answer that arrives
 * after `clear` is dropped. Nothing is stored: not in the app state, the snapshot, localStorage or the DOM
 * before the click.
 */
export function createOperatorContact(load: () => Promise<string>) {
  let status = $state<'idle' | 'loading' | 'shown' | 'failed'>('idle');
  let email = $state('');
  let request = 0;

  async function show() {
    if (status === 'loading' || status === 'shown') return;
    const mine = ++request;
    status = 'loading';
    try {
      const address = await load();
      if (mine !== request) return;
      email = address;
      status = 'shown';
    } catch {
      if (mine === request) status = 'failed';
    }
  }

  function clear() {
    request++;
    email = '';
    status = 'idle';
  }

  return {
    get status() {
      return status;
    },
    get email() {
      return email;
    },
    show,
    clear,
  };
}

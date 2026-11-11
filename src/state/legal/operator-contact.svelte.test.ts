import { describe, expect, it, vi } from 'vitest';
import { createOperatorContact } from './operator-contact.svelte';

const address = 'op@example.test';

function setup() {
  const pending: { resolve: (email: string) => void; reject: (cause: unknown) => void }[] = [];
  const load = vi.fn(() => new Promise<string>((resolve, reject) => pending.push({ resolve, reject })));
  return { contact: createOperatorContact(load), load, pending };
}

describe('createOperatorContact', () => {
  it('holds no address and makes no request until show is called', () => {
    const { contact, load } = setup();
    expect(contact.status).toBe('idle');
    expect(contact.email).toBe('');
    expect(load).not.toHaveBeenCalled();
  });

  it('fetches once per click and shows the address when the answer arrives', async () => {
    const { contact, load, pending } = setup();
    const shown = contact.show();
    void contact.show();
    expect(contact.status).toBe('loading');
    expect(contact.email).toBe('');
    pending[0].resolve(address);
    await shown;
    expect(contact).toMatchObject({ status: 'shown', email: address });
    await contact.show();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports a failure, shows no address and asks again on the next click', async () => {
    const { contact, load, pending } = setup();
    const first = contact.show();
    pending[0].reject(new Error('The server is unreachable.'));
    await first;
    expect(contact).toMatchObject({ status: 'failed', email: '' });
    const second = contact.show();
    expect(contact.status).toBe('loading');
    pending[1].resolve(address);
    await second;
    expect(contact).toMatchObject({ status: 'shown', email: address });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('forgets the address when cleared and drops an answer that arrives afterwards', async () => {
    const { contact, pending } = setup();
    const shown = contact.show();
    pending[0].resolve(address);
    await shown;
    contact.clear();
    expect(contact).toMatchObject({ status: 'idle', email: '' });

    const late = contact.show();
    contact.clear();
    pending[1].resolve(address);
    await late;
    expect(contact).toMatchObject({ status: 'idle', email: '' });
    const failing = contact.show();
    contact.clear();
    pending[2].reject(new Error('late'));
    await failing;
    expect(contact.status).toBe('idle');
  });
});

<script lang="ts">
  // A page of its own for the QR code component (no app, no API): the consumer's job is shown here as the tests rely on it,
  // the panel (code and Save button) beside the same link as text. `#link=` and `#lang=` choose (the hash, so a link never reaches the server) what it shows.
  import { setLocale } from '../../../src/lib/i18n';
  import QrPanel from '../../../src/components/sharing/QrPanel.svelte';

  const params = new URLSearchParams(location.hash.slice(1));
  const link = params.get('link') ?? 'https://glazelab.eu/#/buddy/Zk3-_Q0aB9xT7mWvY1rLcE5uHnJdPoS2gIiKfA6hMqU';
  setLocale(params.get('lang') ?? 'en');
</script>

<main>
  <h1>Your link</h1>
  <p data-testid="link">{link}</p>
  <QrPanel
    {link}
    fileName="glazelab-buddy-link.png" />
</main>

<style>
  main {
    padding: var(--space-4);
  }
  [data-testid='link'] {
    overflow-wrap: anywhere;
  }
</style>

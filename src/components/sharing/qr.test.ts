import { beforeAll, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { setLocale } from '../../lib/i18n';
import { encodeQr, MAX_BYTES, qrPath, QUIET_ZONE } from '../../lib/qr/qr';
import QrCode from './QrCode.svelte';
import QrPanel from './QrPanel.svelte';

const link = `https://glazelab.eu/#/buddy/${'Zk3-_Q0aB9xT7mWvY1rLcE5uHnJdPoS2gIiKfA6hMqU'}`;

beforeAll(() => setLocale('en'));

describe('QrCode', () => {
  const body = render(QrCode, { props: { link } }).body;

  it('draws an inline SVG image with a name, the quiet zone and no inline style', async () => {
    const matrix = encodeQr(link);
    const modules = matrix.size + 2 * QUIET_ZONE;
    expect(body).toContain('role="img"');
    expect(body).toContain('aria-label="QR code for this link"');
    expect(body).toContain(`viewBox="0 0 ${modules} ${modules}"`);
    expect(body).toContain(`d="${qrPath(matrix)}"`);
    expect(body).not.toMatch(/\sstyle=/);
    expect(body).not.toContain('<image');
  });

  it('colours the modules with currentColor on a surface class, not with attributes or styles', async () => {
    expect(body).toMatch(/class="qr-code__surface[^"]*"/);
    expect(body).toMatch(/class="qr-code__modules[^"]*"/);
    expect(body).not.toMatch(/fill=/);
  });

  it('does not put the link into the markup as text', async () => {
    expect(body).not.toContain('glazelab.eu');
  });

  it('takes the accessible name from a prop', async () => {
    expect(render(QrCode, { props: { link, label: 'Buddy code' } }).body).toContain('aria-label="Buddy code"');
  });

  it('names the image in German, Portuguese, Italian and Spanish', async () => {
    await setLocale('de');
    expect(render(QrCode, { props: { link } }).body).toContain('aria-label="QR-Code für diesen Link"');
    await setLocale('pt-PT');
    expect(render(QrCode, { props: { link } }).body).toContain('aria-label="Código QR para esta ligação"');
    await setLocale('it');
    expect(render(QrCode, { props: { link } }).body).toContain('aria-label="Codice QR per questo link"');
    await setLocale('es');
    expect(render(QrCode, { props: { link } }).body).toContain('aria-label="Código QR de este enlace"');
    await setLocale('en');
  });

  it('says so, without an image, when the link is too long', async () => {
    const long = render(QrCode, { props: { link: 'https://glazelab.eu/#/' + 'x'.repeat(MAX_BYTES) } }).body;
    expect(long).not.toContain('<svg');
    expect(long).toContain('too long for a QR code');
  });
});

describe('QrPanel', () => {
  const body = render(QrPanel, { props: { link, fileName: 'glazelab-buddy-link.png' } }).body;

  it('renders no link or file name into the markup and carries no download attribute before a click', async () => {
    expect(body).not.toContain('glazelab.eu');
    expect(body).not.toContain('<details');
    expect(body).not.toContain('download=');
  });
});

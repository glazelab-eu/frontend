/**
 * The installed app's status bar follows the `theme-color` meta tag. A full-screen dark surface (the photo viewer) paints it with its own
 * colour while it is open: `setThemeColor` returns the function that takes that colour back. The original content is remembered by the
 * first user and restored by the last one out, whatever the order, so overlapping users and a second call of a restore are harmless.
 */
const users: Array<{ color: string }> = [];
let original: string | null = null;

function meta(): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
}

export function setThemeColor(color: string): () => void {
  const tag = meta();
  if (!tag || !color) return () => {};
  if (users.length === 0) original = tag.content;
  const user = { color };
  users.push(user);
  tag.content = color;
  return () => {
    const index = users.indexOf(user);
    if (index < 0) return;
    users.splice(index, 1);
    const current = meta();
    if (!current) return;
    current.content = users.length ? users[users.length - 1].color : (original ?? current.content);
  };
}

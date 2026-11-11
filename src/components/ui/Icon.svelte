<script
  module
  lang="ts">
  /** The stroke glyphs of the icon buttons (`.icon-button` in `style.css`), one path each on a 24 × 24 grid. */
  const paths = {
    bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 21h4',
    close: 'M6 6l12 12M18 6 6 18',
    club: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M15.5 4.3a3.5 3.5 0 0 1 0 6.4M18 14a6.5 6.5 0 0 1 3.5 6',
    down: 'M12 5v14m-6-6 6 6 6-6',
    expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
    feedback: 'M4 5h16v11H9l-5 4V5ZM8 9h8M8 12h5',
    flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
    install: 'M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5',
    minus: 'M5 12h14',
    more: 'M6 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm7 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm7 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
    next: 'm9 5 7 7-7 7',
    offline: 'M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M3 3l18 18M13 19.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
    person: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5 20a7 7 0 0 1 14 0',
    plus: 'M12 5v14M5 12h14',
    previous: 'm15 5-7 7 7 7',
    share: 'm21 3-7 18-4-7-7-4L21 3ZM10 14l6-6',
    star: 'm12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z',
    up: 'M12 19V5m-6 6 6-6 6 6',
  };
  export type IconName = keyof typeof paths;
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    /** Filled instead of outlined: the selected star. */
    filled?: boolean;
  }

  let { name, filled = false }: Props = $props();
</script>

<svg
  class="icon-button__glyph"
  viewBox="0 0 24 24"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false">
  <path d={paths[name]} />
</svg>

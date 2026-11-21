import './boot';
import { mount } from 'svelte';
import App from './App.svelte';
import { startLocale } from './lib/i18n';
import { watchStuckViewport } from './lib/layout/stuck-viewport';
import './style.css';

// For the page's lifetime: puts fixed bars back where iOS left them mid-screen (`lib/layout/stuck-viewport.ts`).
watchStuckViewport();
const target = document.getElementById('app');
if (!target) throw new Error('Missing application mount point');
// The saved language's dictionary first (LANG-2), so the first frame is already in it; English needs no wait.
void startLocale().then(() => mount(App, { target }));

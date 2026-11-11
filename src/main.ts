import './boot';
import { mount } from 'svelte';
import App from './App.svelte';
import { startLocale } from './lib/i18n';
import './style.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing application mount point');
// The saved language's dictionary first (LANG-2), so the first frame is already in it; English needs no wait.
void startLocale().then(() => mount(App, { target }));

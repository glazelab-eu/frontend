/// <reference types="svelte" />
/// <reference types="vite/client" />
import { mount } from 'svelte';
import '../../../src/style.css';
import Harness from './Harness.svelte';

mount(Harness, { target: document.getElementById('app')! });

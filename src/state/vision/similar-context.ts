import { getContext, setContext } from 'svelte';
import type { SimilarLooks } from './similar-looks';

/**
 * The similar looks reach the photo viewer and the item pages through context, set once in `App.svelte`: the viewer is mounted by
 * five different hosts (the gallery of each detail page and the cards of every list), and threading one controller through all
 * of them would touch each. Outside the app (a component test) there is none, and the feature is simply absent.
 */
const key = Symbol('similar-looks');

export const provideSimilar = (similar: SimilarLooks) => setContext(key, similar);
export const useSimilar = () => getContext<SimilarLooks | undefined>(key);

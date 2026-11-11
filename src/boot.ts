import { redirectPathToHash } from './lib/routing/path-to-hash';

// First import of main.ts, so it runs before any module reads `location.hash`.
redirectPathToHash();

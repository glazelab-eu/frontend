# Glazelab web app

The web app of Glazelab, a ceramic glaze library, stock tracker and glaze-combination notebook: a Svelte 5 and TypeScript
progressive web app built with Vite. It works offline from the device's saved library and talks to the Glazelab API (a
Spring Boot server in its own repository) under `/api/`.

## Run, test and build

Requirements: Node 22 or later. Install the dependencies with `npm ci`.

- Development server: `npm run dev` (port 5173; it proxies `/api` to the API on port 8080).
- Format: `npm run format` (Prettier is authoritative).
- Checks: `npm run check` (TypeScript and svelte-check) and `npm run test` (Vitest).
- Production build: `npm run build` runs the format check, the checks, Vitest and the Vite build into `dist/`.
- Browser tests (Playwright): `npm run e2e` (all), `npm run e2e:smoke`, or `npm run e2e -- <spec file>`. They start the
  packaged API from a `backend/` checkout next to this repository (`mvn -DskipTests package` there) or from
  `GLAZELAB_E2E_JAR`, with the system Chromium (`CHROME_BINARY` overrides it) or Playwright's own.
- API client: `openapi.json` and `src/lib/generated/` are generated from the API's OpenAPI document
  (`npm run api:generate` reads `openapi.json`); never edit them by hand.
- Container: `Dockerfile` builds the app and serves it with Nginx (`nginx.conf.template`).

The architecture, code rules and topic guides are in `AGENTS.md` and `docs/guide/`; the source folders in `src/README.md`.

## Source code link

The footer links to the source code of the running server (AGPL section 13) when the API is configured with
`GLAZELAB_SOURCE_URL` (an absolute http(s) URL; the link stays hidden while it is unset), and always to the third-party
licences of the build (`/THIRD-PARTY-LICENSES.txt`).

## Licence

Copyright (C) 2026 The Glazelab authors.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public
License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
version (SPDX: `AGPL-3.0-or-later`). It is distributed WITHOUT ANY WARRANTY; see `LICENSE` for the full text.

Third-party notices:

- Every build writes `THIRD-PARTY-LICENSES.txt` into `dist/` (served at `/THIRD-PARTY-LICENSES.txt`): the licences of the
  bundled npm packages, the Workbox runtime of the service worker, and the code compiled into WebAssembly (zxing-cpp,
  ONNX Runtime and its third-party notices, Tesseract and Leptonica), from `scripts/third-party-licenses.ts` and
  `scripts/notices/`.
- The optional label reader and photo suggestions ship their own notices next to their files (`scripts/ocr-NOTICE.txt`,
  `scripts/vision-NOTICE.txt`).
- Third-party files in this repository: the photo-suggestion model `models/vision/model.onnx` (TinyCLIP, MIT, Microsoft),
  the generated API client runtime in `src/lib/generated/client/` and `core/` (MIT, Hey API) and the fixture photos in
  `e2e/fixtures/` (CC0, sources in `e2e/fixtures/README.md`). Per-file licence information follows the
  [REUSE](https://reuse.software) specification (`REUSE.toml`, `LICENSES/`).
- Icons and the logo are this project's own work; the app uses the system fonts.

Contributions: see `CONTRIBUTING.md`. Security issues: see `SECURITY.md`.

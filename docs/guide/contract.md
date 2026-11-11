# Contract with the other repository

The API is the separate backend repository (Spring Boot). This file lists what the frontend expects from it and what changes on both sides together; the backend guide's topic "Contract with the other repository" states the server side of each rule.

## Layout and the generated client

- Check out `frontend` and `backend` as siblings (`<dir>/frontend`, `<dir>/backend`): the client generation, the e2e suite (`../backend/target/*.jar`) and the backend's contract tests (they read `../frontend`) rely on it. Without the sibling, the backend skips those tests.
- `openapi.json` is the backend's OpenAPI document (dev profile, `GET /api/openapi`), keys sorted, two-space indent; `src/lib/generated/` comes from it through `npm run api:generate` (`openapi-ts.config.ts`). Never edit either by hand; commit them together.
- Regenerate after every API change (the backend's `mvn test` fails on drift). From the folder that holds both checkouts, with Java 21, Maven, Node 22, Python 3 and curl, and a throw-away data folder (never your development or deployment data):

```sh
set -euo pipefail
work=$(mktemp -d); port=18080   # any free port
mvn -f backend/pom.xml -B -ntp package -DskipTests
PORT=$port SPRING_PROFILES_ACTIVE=dev GLAZELAB_DATA="$work/data" GLAZELAB_IMAGES="$work/images" \
  java -jar backend/target/glazelab-0.1.0.jar >"$work/server.log" 2>&1 & api=$!
trap 'kill $api; rm -rf "$work"' EXIT
for _ in $(seq 90); do curl -fsS "http://localhost:$port/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://localhost:$port/api/openapi" -o "$work/openapi.json"
python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), indent=2, sort_keys=True))' "$work/openapi.json" >frontend/openapi.json
npm --prefix frontend run api:generate && npm --prefix frontend run format
```

- Then restart Vite. Read `openapi.json` for API shapes; fix the backend contract rather than weakening frontend types.
- Errors are typed: each operation lists the statuses it can answer with `ErrorView` `{error}`. A nullable `$ref` cannot be expressed, hence `GlazeCreatedView.stock` is a list of 0 or 1.

## Rules both sides keep

- Times: every API time is an instant with `Z`; a date without a time is `YYYY-MM-DD`. Parse times with `instantTime` (topic "Incremental sync"), never in the device's zone.
- Normalizers with shared test vectors: tags `lib/tags/tags.ts`, barcodes `lib/barcodes/barcodes.ts`, glaze codes `normalizeCode` in `lib/glazes/glaze-form.ts` with the vectors `lib/glazes/code-cases.json` (the backend's `GlazeCodeTest` reads them), wishlist links `isWishlistLink` in `lib/clubs/wishlist.ts` with `lib/clubs/wishlist-links.json` (the backend's `WishlistLinksTest`). A change applies to both sides.
- Terms: `lib/api/terms.ts` holds the version the backend states (its `AuthApiTest` compares them). A change to what a buddy sees, what an error report carries, feedback or profile-picture rules changes the terms text in every language and the version on both sides.
- Error texts: the API answers English messages; `lib/i18n/server-messages.ts` translates every known one and changes with each wording (the backend's `ServerMessagesContractTest` fails on an answered message without a key). Of the 429 texts only the sign-in delay's is kept; every other 429 reads as the rate limit.
- Tarpit decoy: the API may answer an unknown picture with a `200 application/octet-stream` decoy; never apply, save or show a 2xx that is not JSON (or not `image/*` for a picture).
- String enums: the hand-written lists and unions mirror the API's values (`lib/api/enums.test.ts` fails on a new value).
- Sync: `cursor`, `epoch` and `format` go back unchanged; upserts and tombstones apply idempotently; a `resync` answer or a count mismatch loads in full (topic "Incremental sync"). A glaze rename re-sends only the glaze: copy the name into the steps that use it.
- Stale writes: send only what the person changed (size-only `POST /api/stock`, `requestId` on a resent addition, `baseTags` on a combination PUT).
- Account and invite links are the hash routes `#/verify|reset|login|invite/<token>` the backend's mails build.
- Proxies: the app's `nginx.conf.template` and the deployment's Nginx config stay in step; both answer an oversized `/api/` body with `{"error":"This request is too large."}` (`lib/api/too-large.test.ts`).

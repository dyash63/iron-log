# Iron Log production integration checklist

## Included in this package
- Workout templates with exercise grouping for supersets.
- Per-set weight, reps, RPE and RIR capture in an additional training log, without rewriting legacy workout records.
- Barcode lookup against Open Food Facts and browser BarcodeDetector scanning where supported. Manual barcode entry remains available.
- Progress photo journal using IndexedDB, optional Firebase Storage backup only after explicit opt-in, and owner-scoped metadata.
- JSON health-record import bridge.
- Optional AI coach client plus Node server proxy. The proxy verifies Firebase ID tokens, rate-limits by IP, limits request size and keeps provider credentials server-side.
- Existing nutrition/recovery/body modules and deterministic coaching remain usable without third-party integrations.

## Required operator setup (cannot be completed from this repository ZIP)
1. Deploy Firestore and Storage rules after reviewing existing rules.
2. Enable Firebase Storage in the Firebase project and verify billing/quota/retention settings.
3. Deploy `server/coach-api.mjs` on a Node 20+ host. Install dependencies, configure Application Default Credentials for Firebase Admin, set environment variables from `.env.example`, and set `ALLOWED_ORIGIN` to the exact hosted PWA origin. Start with `node --env-file=.env coach-api.mjs` or your secret manager.
4. Configure provider billing, safety controls and a server-side API key. Do not commit `.env`.
5. Configure the coach endpoint in Iron Log. The browser sends a Firebase ID token; server verifies it.
6. Test barcode lookup on the target network and camera scanning on HTTPS. BarcodeDetector is not supported in every browser.
7. Test photo upload/download/delete with two signed-in devices and verify owner-only access.
8. Perform native HealthKit and Health Connect work in separate iOS/Android companion apps. The web PWA cannot replace those native permissioned APIs.

## Explicit boundaries
- HealthKit / Health Connect live native connectors are not included. Only a normalized JSON import bridge is provided.
- Food facts come from a community-maintained database and may be incomplete or wrong. Verify package labels.
- Cloud photo backup is opt-in. Existing local photos are not automatically uploaded.
- The AI coach is not active until the backend is deployed and configured. API credentials must remain server-side.
- This build adds a separate Training Lab rather than migrating the original workout engine to a new framework. That avoids a risky rewrite of existing workout history and interactions.
- No live Firebase project, provider account, Apple developer entitlement or Android native app was available for end-to-end validation in this environment.

## Verification notes
- Automated source checks cover the CORS bearer-header preflight, timeout, local date handling, invalid set validation, incomplete barcode nutrition handling, and local/cloud record merging.
- A live Firebase project, deployed Storage rules, external food API, and configured AI provider are not available in this source-only validation environment. Those integrations still require staging verification.

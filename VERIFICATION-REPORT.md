# Iron Log source verification report

Date: 2026-11-11
Build: verification hardening / service-worker cache v1.4.1

## Checks completed

- Automated Node test suite: **24 passed, 0 failed**.
- `node --check` passed for every standalone `.js` and `.mjs` source file.
- Extracted inline application JavaScript from `index.html`: syntax check passed.
- `manifest.json` and `server/package.json`: valid JSON.
- Every local script, icon, manifest asset and service-worker precache entry exists in the package.
- HTML IDs are unique; all statically referenced platform-module element IDs exist.
- ZIP archive integrity checked after packaging.
- AI API CORS preflight exercised over HTTP with mocked Firebase Admin: allowed origin returned 204 and disallowed origin returned 403. The preflight explicitly allows `Authorization`.

## Bugs found and fixed during recheck

- AI coach CORS preflight omitted the `Authorization` request header.
- AI provider requests had no timeout and upstream error bodies were returned to clients.
- Oversized API request handling destroyed the connection before a useful response could be sent.
- Advanced training used UTC dates rather than local calendar dates.
- Invalid set values could still allow the rest of a session to save.
- Incomplete barcode nutrition records could be interpreted as zero-valued nutrients.
- Cloud restore could overwrite local-only fitness records; fresh Firestore collections also did not reliably receive existing local records.
- Service-worker cache version was bumped to v1.4.1 to ensure deployed clients fetch the updated scripts.

## Not verified in this environment

- Live Google sign-in, Firestore reads/writes, Firestore security rules, migration against your actual database, and two-device conflict behavior.
- Firebase Storage upload/download/delete with your actual bucket and deployed Storage rules.
- Live Open Food Facts network responses and camera scanning on a physical phone/browser.
- AI provider calls with a real provider key, billing account and deployed server.
- iOS HealthKit or Android Health Connect native integrations. The package contains an import bridge and integration notes, not native apps.
- Full end-to-end browser/device acceptance testing. Static checks and source-level automated tests are not proof that every workflow works in production.

## Deployment safety

Back up Firestore before deploying. Merge the supplied Firestore and Storage rule snippets into existing rules; do not replace existing rules blindly. Deploy to staging first and verify existing workout history before production rollout. Do not commit a real `.env` file or provider key.

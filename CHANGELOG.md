# Iron Log — platform expansion

## Latest implementation batch
- Added Training Lab: reusable workout templates, exercise superset groups, and per-set weight/reps/RPE/RIR capture.
- Added Open Food Facts barcode lookup and camera scanning where the browser supports `BarcodeDetector`; manual barcode entry is the fallback.
- Added progress photo journal with local IndexedDB storage and optional, explicit-consent Firebase Storage backup plus per-user metadata.
- Added health-export JSON import bridge and documented the native HealthKit / Health Connect boundary.
- Added optional AI coach client and Node 20+ backend proxy. The proxy verifies Firebase ID tokens, rate-limits requests, restricts origins, bounds request size, and keeps provider credentials on the server.
- Moved nutrition, recovery and body measurement time-series writes to per-day Firestore documents; targets/templates remain small documents. Added backward-compatible legacy document import before cleanup.
- Moved advanced training history to per-day Firestore documents and templates to a separate settings document.
- Advanced training records now contribute to the deterministic training-frequency summary.
- Bumped the service-worker cache and precached the new advanced module.
- Added regression tests for the new modules and integrations.

## Existing platform foundation retained
- PWA path and service-worker hardening.
- Exercise knowledge base dependency.
- Nutrition, recovery, body measurements and deterministic Iron Intelligence modules.
- Offline local persistence, queued Firestore module sync and JSON export.
- Existing legacy workout UI/history and original intelligence engine.

## Integration boundaries
- Live Apple HealthKit / Android Health Connect native connectors are not included in a browser-only PWA. JSON import and a native bridge contract are provided.
- Food product data is community-maintained and must be checked against packaging.
- AI coach is inactive until its server is deployed and configured with provider credentials.
- Firebase Storage cloud photo backup requires Storage to be enabled and rules deployed; local photo storage works without cloud backup.
- Full replacement of the original monolithic workout application with a new framework is intentionally not attempted in this batch. The new modules are separated into standalone scripts to reduce regression risk.
- No live Firebase project, mobile device, native app, or external provider account was available for end-to-end testing.

## Verification hardening — 2026-11-11
- Fixed AI coach CORS preflight to allow the Firebase `Authorization` header and added a 30-second upstream timeout.
- Avoided returning provider response bodies to browsers on upstream errors.
- Corrected advanced training and barcode meal dates to use the device's local calendar date.
- Made invalid RPE/RIR/reps/weight input abort the entire save instead of saving the remaining fields.
- Barcode lookup now refuses incomplete macro records instead of silently recording absent values as zero; kJ-only energy values are converted to kcal.
- Cloud restore now merges device-only nutrition, recovery and body records with cloud records rather than replacing the local dataset.
- Bumped the service-worker cache to v1.4.1 so installed clients fetch the hardened scripts.

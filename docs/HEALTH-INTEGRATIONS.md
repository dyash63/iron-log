# Native health integrations: implementation boundary

Iron Log remains a browser PWA. A browser page cannot directly query Apple HealthKit or Android Health Connect. These systems require a native app, OS permission prompts, entitlements, platform-specific SDKs, privacy disclosures and app-store review.

The current build includes a JSON import path and a normalized record contract:

```json
{"date":"2026-11-11","type":"steps|sleep|heart_rate|weight|workout","value":7200,"unit":"count|hours|bpm|kg","source":"HealthKit|Health Connect"}
```

A future Capacitor/native wrapper should:
1. Request only the health data types the user enables, with granular read permissions.
2. Normalize provider records to the contract above and pass them to `window.IronLogAdvanced.importHealthRecords(records)`.
3. Store provider record IDs and sync timestamps to prevent duplicate imports.
4. Never treat missing permissions/data as zero or as evidence of good health.
5. Keep health data private, allow disconnect/revoke and delete imported records on request.

No live HealthKit/Health Connect connector is claimed in this web-only package.

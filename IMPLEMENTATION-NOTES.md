# Iron Log implementation package

## Application modules
- Existing workout tracker and `iron-intelligence-engine.js` retained.
- `exercise-knowledge-base.js` supplies the knowledge-base interface referenced by the existing app.
- `iron-log-platform.js` supplies nutrition, recovery, body measurement and deterministic intelligence modules.
- `iron-log-advanced.js` supplies Training Lab, barcode/food lookup, progress photos, health JSON import and optional AI coach client.

## Data storage
- Legacy workout sync uses `users/{uid}/workoutDays/{YYYY-MM-DD}`.
- Hydration/reminder sync uses `hydrationDays` and `notificationDays` date documents.
- Nutrition, recovery and body measurements use `nutritionDays`, `recoveryDays` and `bodyMeasurementDays` date documents.
- Training Lab uses `advancedTrainingDays/{YYYY-MM-DD}` plus `fitnessModules/advancedTemplates`.
- Nutrition targets use `fitnessModules/targets`.
- Progress photo metadata uses `progressPhotos/{photoId}`. Image bytes are stored in Firebase Storage under `users/{uid}/progress-photos/` only after the user enables cloud backup.
- Local photo copies use IndexedDB. They are not included in the JSON localStorage export.
- Local module writes remain queued and are retried when connectivity returns. Legacy aggregate module docs are removed only after date documents are written successfully.

## Setup required before deployment
1. Back up the Firestore database.
2. Review and merge `FIRESTORE-RULES-SNIPPET.md` with current Firestore rules.
3. Review and merge `FIREBASE-STORAGE-RULES-SNIPPET.md` with current Storage rules.
4. Enable Firebase Storage in the project if photo cloud backup is desired.
5. Upload all application files and deploy over HTTPS.
6. For AI coach, deploy `server/coach-api.mjs` on Node 20+, install its package dependencies, configure Firebase Admin Application Default Credentials, set server environment variables from `server/.env.example`, and set the exact allowed PWA origin. Never commit `.env` or provider API keys.
7. Configure the deployed `/api/coach` endpoint in the app. Firebase sign-in is required; the server verifies the Firebase ID token.
8. Test a fresh login and a legacy-data account, workout history, module writes, offline retry, cross-device sync, photo upload/download/delete, barcode lookup and coach API.

## Important limits
- Apple HealthKit and Android Health Connect require native iOS/Android app code, platform permissions and signing entitlements. This PWA includes JSON import and a documented bridge contract only.
- BarcodeDetector is not available in every browser; manual entry is provided.
- Open Food Facts records can be incomplete or inaccurate; verify labels and serving sizes.
- The AI coach requires a separately deployed server and provider account; it is not active by default.
- No live Firebase/provider credentials or mobile test devices were available. Automated tests validate syntax, local references and integration wiring, not real cloud behavior.

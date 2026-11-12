# Firestore rules required by the normalized Iron Log data model

The application writes the signed-in user's data to:

- `users/{uid}` (existing profile/settings document)
- `users/{uid}/workoutDays/{YYYY-MM-DD}` (one workout-history document per date)
- `users/{uid}/hydrationDays/{YYYY-MM-DD}` (one hydration/reminder-state document per date)
- `users/{uid}/notificationDays/{YYYY-MM-DD}` (one notification-state document per date)
- `users/{uid}/fitnessModules/{targets|advancedTemplates}` (small settings/template documents)
- `users/{uid}/nutritionDays/{YYYY-MM-DD}`, `recoveryDays/{YYYY-MM-DD}`, `bodyMeasurementDays/{YYYY-MM-DD}`
- `users/{uid}/advancedTrainingDays/{YYYY-MM-DD}` (training-lab session history)
- `users/{uid}/progressPhotos/{photoId}` (private photo metadata only; image bytes are in Firebase Storage)

Your deployed Firestore rules must authorize only the authenticated owner. If your existing rules already use a recursive wildcard for all documents beneath `users/{uid}`, verify that it covers these new subcollections. Otherwise, merge the following match into your existing rules; **do not blindly replace your current rules**, because they may contain other required paths.

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

This is an example owner-only policy. If your app has public profiles or other sharing features, retain their existing narrowly scoped rules and merge these paths without broadening access.

The first successful sync migrates legacy `logs` entries to `workoutDays` and deletes the old `logs` field only after every date write succeeds. Keep a Firestore export/backup before deploying the migration.

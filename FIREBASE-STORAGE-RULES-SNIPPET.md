# Firebase Storage rules for private progress photos

Merge this path into your existing Firebase Storage rules. Do not replace other application rules blindly.

```text
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/progress-photos/{fileName} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow create, update: if request.auth != null
        && request.auth.uid == userId
        && request.resource.size < 12 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
      allow delete: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

For stricter deployments, use separate create/update/delete rules and validate image formats more narrowly. The application defaults to local-only storage; cloud upload occurs only when the user checks the explicit consent box.

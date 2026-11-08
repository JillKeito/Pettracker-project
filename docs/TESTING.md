# Test plan

## Automated
```
npm test -- --watch=false   # unit tests: workflow, validation, password policy, file sniffing, CSV safety, screens
npm run build               # type-check and production build
```

## Manual test cases (run after finishing docs/FIREBASE-SETUP.md)
Use three accounts: an owner (self sign-up), a second owner, and a staff account made by the admin.

| ID | Steps | Expected |
|---|---|---|
| TC-01 | Sign in with valid credentials | Dashboard for the user's role; `login_succeeded` in the audit log |
| TC-02 | Wrong password; unknown email | Same message for both |
| TC-03 | Fail sign-in many times in a row | Firebase eventually answers "too many attempts"; app shows a lockout message |
| TC-06 | Owner opens the Accounts, Reports or Audit screens (or changes the URL/state) | Not shown; direct Firestore reads are denied (Rules Playground: read `/users/<someone else>` as owner = denied) |
| TC-07 | Change password to a weak one / the same one | Rejected with a clear message; a strong one succeeds |
| TC-08 | Admin creates a staff account; staff signs in | Forced to set a new password first |
| TC-09 | Owner B tries to open owner A's pet/request (Rules Playground: get `/requests/<A's id>` as B) | Denied |
| TC-10 | Staff sees only unassigned requests and requests assigned to them | Verified in the Requests screen |
| TC-11 | Owner tries to change status or assignment (Playground: update `status` as owner to `completed`) | Denied |
| TC-12 | Signed-out Playground read of any collection | Denied |
| TC-13 | Deactivate the only admin | Refused |
| TC-14 | Pet with future birth date, weight 0, weight 9999 | Each rejected |
| TC-15 | Vaccination expiry before the given date | Rejected |
| TC-16 | Submit a request | Reference `PTR-YYMMDD-XXXXXX`, checklist rows, first history row |
| TC-17 | Staff tries `request_confirmed -> documents_verified` | Rejected |
| TC-18 | Upload a PDF under 650 KB; a `.exe` renamed `.pdf`; a 2 MB PDF | First works and downloads intact; the others are rejected |
| TC-19 | Staff requests corrections, owner re-uploads | Status goes back to under review |
| TC-20 | Schedule a pickup before documents are verified | Refused |
| TC-21 | Status changes create notifications for the owner | Visible and markable as read |
| TC-22 | Admin exports CSV for a name beginning with `=` | Formula is neutralised |
| TC-24 | `curl -I` your hosted site | Security headers present |
| TC-26 | In the Firebase console try to edit `audit_logs` through the app | Rules allow create only (no update/delete) |
| TC-27 | Sign up with a new email and a strong password | Account created, signed in as owner; user appears in Authentication → Users and Firestore → users with role `owner` |
| TC-28 | Sign up with an existing email / mismatched passwords / weak password | Clear errors, no new account |
| TC-29 | In the browser console call the Firestore SDK to write your own `users` doc with `role: 'admin'` | Denied by rules |

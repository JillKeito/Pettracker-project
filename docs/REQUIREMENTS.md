# Requirements and traceability

| ID | Requirement | Where | Verified by |
|---|---|---|---|
| FR-01 | Pet owners create their own account (owner role only) and sign in; staff/admin accounts are created by an administrator | `api.ts` register/createUser, `users` rules | TC-01, TC-02, TC-27..29 |
| FR-02 | Three roles with different permissions | `firestore.rules` | TC-06..TC-12 |
| FR-03 | Admins create/edit/deactivate accounts and send password resets; last active admin cannot be removed | `api.ts` | TC-13 |
| FR-04 | Owners manage pet profiles, photo, vaccinations | `api.ts` pets | TC-14, TC-15; `rules.spec.ts` |
| FR-05 | Owners submit relocation requests with a reference number and a checklist snapshot | `createRequest` | TC-16 |
| FR-06 | Requests follow a defined status life cycle with history | `rules.ts`, `firestore.rules` | `rules.spec.ts`, TC-17 |
| FR-07 | Owners upload PDF/JPG/PNG documents; staff verify or request corrections | `upload`, `review` | TC-18, TC-19 |
| FR-08 | Pickups can be scheduled only after required documents are verified | `createSchedule` | TC-20 |
| FR-09 | In-app notifications | `notify` | TC-21 |
| FR-10 | Reports, CSV export, audit log for admins | `reportStats`, `exportReportCsv` | TC-22 |
| NFR-01 | Strong passwords | `passwordProblem` + console password policy | `rules.spec.ts` |
| NFR-02 | Throttling of repeated login failures | Firebase Authentication | TC-03 |
| NFR-03 | Users cannot read or change other users' data | `firestore.rules` | TC-09..TC-12 |
| NFR-04 | Uploads are checked by real file type and size | `sniffMime`, rules | `rules.spec.ts`, TC-18 |
| NFR-05 | Security events are audited | `audit_logs` | TC-06, TC-22 |
| NFR-06 | Security headers and HTTPS on hosting | `firebase.json` | TC-24 |

# Security documentation (Firebase edition)

## How protection works
There is no PetTrack server, so security is built from three layers:
1. **Firebase Authentication** proves who the user is (salted password hashes, built-in throttling of repeated failures, optional password policy enforced by Google).
2. **`firestore.rules`** decides, on Google's servers, what each signed-in user may read or write. Anyone can edit the website code in their browser, but they cannot change these rules.
3. **`api.ts` / `rules.ts`** validate input and give friendly errors. They are a convenience, not a security boundary.

## Threat model (STRIDE)
| Threat | Example | Mitigation | Residual risk |
|---|---|---|---|
| Spoofing | Guessing passwords | Firebase Auth throttling; password policy (12+ chars, mixed classes) in the app and optionally enforced in the console; same message for wrong password and unknown email | No MFA |
| Tampering | Owner edits another owner's pet, or sets their own role to admin | Rules: owners can only touch documents whose `owner_id` is their uid; `role`/`active` can only be changed by an admin; a self-created profile must be `owner` | Admin guard "last administrator" is enforced in the client only |
| Repudiation | "I never verified that document" | `history`, document review fields and `audit_logs` (rules force `actor_user_id` to be the caller's uid; no update/delete) | Audit entries are written by the browser, so a user could skip writing one for their own action; there is no server to guarantee it |
| Information disclosure | Reading someone else's certificate | Rules limit every read to owner / assigned-or-unassigned staff / admin; the default rule denies everything else | Documents are not encrypted by the app (Google encrypts data at rest and in transit); file bytes are readable by anyone allowed to see the request |
| Denial of service | Flooding writes | Free-plan quotas cap the damage; size limits in rules | No per-user rate limiting beyond Firebase's own |
| Elevation of privilege | Calling Firestore directly with a modified app | Same rules apply regardless of the client | Staff can verify documents without the "all required documents verified" check being enforced server-side (client check only) |

## OWASP Top 10 (2021) mapping
| Risk | Status |
|---|---|
| A01 Broken access control | Rules per collection; owner/staff/admin scoping; default deny. Test with the Rules Playground and TC-06..TC-12 |
| A02 Cryptographic failures | Password hashing and TLS handled by Firebase; Hosting serves HTTPS with HSTS |
| A03 Injection | No SQL and no string-built queries; Angular escapes all output; CSV formula-injection guard; real file-type sniffing |
| A04 Insecure design | Status state machine in both `rules.ts` and `firestore.rules`; checklist snapshot; least-privilege roles |
| A05 Security misconfiguration | Production-mode Firestore, explicit default-deny rule, security headers and CSP in `firebase.json` |
| A06 Vulnerable components | `npm audit --omit=dev` in CI |
| A07 Authentication failures | Password policy, throttling by Firebase, deactivated accounts are locked out by rules, forced change for admin-issued passwords |
| A08 Integrity failures | SRI on CDN scripts; rules validate shape and size of every write |
| A09 Logging failures | `audit_logs` for sign-in, denied actions, downloads and administrative actions; Firebase console keeps its own logs |
| A10 SSRF | Not applicable (no server making requests) |

## Known limitations (state these in your report)
- Failed sign-in attempts cannot be logged by the app (the user is not authenticated yet); Firebase throttles them but does not give you a per-attempt log on the free plan.
- Administrators reset passwords by sending the user a reset email, not by choosing a password for them (this is better practice, but needs email delivery to work).
- A sign-in email cannot be changed from the app.
- Deactivating an account blocks all data access through the rules, but the Firebase Authentication login itself remains until you disable it in the console.
- Duplicate emails are reported at sign-up (enumeration trade-off), and there is no email verification step.
- The firestore.rules file and the Firebase flows were **not tested against a live Firebase project** where this was written. Run the manual cases in `TESTING.md` and the Rules Playground before relying on them.

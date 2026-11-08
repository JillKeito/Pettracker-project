# PetTrack (Firebase edition)

Pet relocation tracker for the Philippines. Pet owners sign up and submit relocation requests; staff review documents and schedule pickups; administrators manage accounts, requirements and reports.

**Stack:** Angular (website) + Firebase Authentication (logins) + Cloud Firestore (database) + Firestore security rules (access control). Runs on the free Firebase Spark plan. No server, XAMPP, PHP or MySQL needed.

## Get started
Follow **[docs/FIREBASE-SETUP.md](docs/FIREBASE-SETUP.md)** step by step (about 20 minutes).

## Project map
| Path | What it is |
|---|---|
| `src/app/app.ts`, `app.html` | Screens |
| `src/app/api.ts` | All Firebase calls and validation |
| `src/app/rules.ts` | Pure business rules (tested) |
| `src/environments/firebase.config.ts` | Where you paste your Firebase project settings |
| `firestore.rules` | Server-side security rules |
| `firebase.json` | Hosting settings and security headers |
| `docs/` | Setup guide, architecture, security, requirements, test plan |

## Commands
```
npm install
npm start                   # http://localhost:4200
npm test -- --watch=false
npm run build
```

## Roles
- **Owner:** signs up on the sign-in page; manages own pets, requests and documents.
- **Staff:** created by an admin; sees requests assigned to them or unassigned; reviews documents; schedules pickups.
- **Admin:** the first admin is promoted in the Firebase console (see the setup guide); manages accounts, requirements, assignments, reports and the audit log.

## Limits of the free plan
Documents are stored inside the database (about 650 KB each), and there are no automatic scheduled reminders. See the setup guide for details.

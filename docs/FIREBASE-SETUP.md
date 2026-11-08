# PetTrack + Firebase: step-by-step setup (free Spark plan)

You need: a Google account, Node.js 20.19 or newer, VS Code. No credit card, no XAMPP, no PHP, no MySQL.

## Part 1. Create the Firebase project (browser)

1. Go to **https://console.firebase.google.com** and sign in with your Google account.
2. Click **Create a project** (or **Add project**). Name it `pettrack` (Firebase may add numbers to make the ID unique). Click **Continue**.
3. When asked about **Google Analytics**, switch it **off**, then click **Create project**. Wait, then click **Continue**.

## Part 2. Turn on sign-in (this is where user logins are saved)

4. In the left menu click **Build → Authentication**, then **Get started**.
5. On the **Sign-in method** tab click **Email/Password**. Switch **Enable** on (leave "Email link" off) and click **Save**.
6. Optional but recommended for your Information Security course: open **Authentication → Settings → Password policy**, tick **Require uppercase, lowercase, numeric and non-alphanumeric characters**, set **minimum length 12**, choose **Enforcement: Require**, and save. (The app already enforces the same rules in the browser.)

Every account created through the app now appears in **Authentication → Users**. That is your saved list of logins. Passwords are stored by Google as salted hashes and are never visible to you or the app.

## Part 3. Create the database

7. Click **Build → Firestore Database → Create database**.
8. Choose a location close to your users, for example **asia-southeast1 (Singapore)**. You cannot change it later. Click **Next**.
9. Choose **Start in production mode** (this blocks everything until we add our rules) and click **Create**.

## Part 4. Add the security rules

10. In Firestore click the **Rules** tab.
11. In VS Code open the file `firestore.rules` in the project, press **Ctrl+A**, **Ctrl+C**.
12. Back in the browser, click inside the rules editor, press **Ctrl+A** and **Ctrl+V** to replace everything, then click **Publish**.
    - If the editor shows a red error, copy the message and send it to me.
    - Optional check: use the **Rules Playground** button in the editor to try a read as a signed-out user. It must be **denied**.

## Part 5. Connect the app to your project

13. Click the gear icon next to **Project Overview → Project settings**.
14. Under **Your apps** click the web icon **`</>`**. Give it a nickname such as `pettrack-web`. Leave **Firebase Hosting** unticked and click **Register app**.
15. You will see a block of code containing `firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ... }`. Copy those six values.
16. In VS Code open **`src/environments/firebase.config.ts`** and replace each `PASTE_...` value with yours. Keep the quotes. Save.
    - These values are not secrets. They only tell the app which project to talk to. Your data is protected by the rules from Part 4.

## Part 6. Run it on your computer

17. Open the project folder in VS Code (the folder that contains `package.json`) and open a terminal (**Terminal → New Terminal**).
18. Run:
    ```
    npm install
    npm start
    ```
    The first command takes a minute or two. Wait for **Local: http://localhost:4200/**.
19. Open **http://localhost:4200** in your browser.

## Part 7. Create your first administrator

20. On the sign-in page click **Create an account** and register with your own email and a strong password. You are signed in as a pet owner.
21. In the Firebase console open **Firestore Database → Data → users**. Click the document whose `email` matches yours.
22. Find the field **role**, click the pencil, change `owner` to `admin`, and click **Update**. (Changing roles from the console is allowed because only you can open your console; the app itself can never do this.)
23. In the app click **Sign out**, then sign in again. You now see the administrator menu.
24. As admin, open **Accounts** to create staff accounts. Open **Route requirements** and add some requirements (checklist items). Pet owners then sign up on their own from the sign-in page.

## Part 8. Optional: put it online with Firebase Hosting (free)

25. In the terminal run:
    ```
    npm run build
    npx firebase-tools login
    npx firebase-tools use --add
    ```
    Pick your project when asked and give it the alias `default`.
26. Deploy the website and the rules:
    ```
    npx firebase-tools deploy --only hosting,firestore:rules
    ```
    The terminal prints your live address, which looks like `https://your-project.web.app`.

## Free plan limits to know about

| Limit | What it means for PetTrack |
|---|---|
| No Cloud Storage | Uploaded documents are stored inside Firestore. The file limit is about **650 KB** per document (PDF, JPG or PNG). Pet photos are shrunk automatically. |
| No Cloud Functions | No automatic scheduled reminders. Upcoming pickups and expiring documents show on the dashboards instead. |
| Daily quotas (about 50,000 reads and 20,000 writes per day) | More than enough for a school project. If you reach it, the app tells you to try again tomorrow. |

## Troubleshooting

| What you see | Fix |
|---|---|
| "Firebase is not set up yet" on the sign-in page | Part 5 is incomplete: paste your config into `src/environments/firebase.config.ts`, save, and refresh |
| "Email/password sign-in is not enabled" | Do step 5 |
| "You do not have permission to perform this action" everywhere | The rules were not published (Part 4), or your account's `role` or `active` field is missing in the `users` document |
| Sign-up works but you can't see anything after signing in | Open Firestore → `users` and check your document exists and has `active: true` |
| `npm start` fails | Run `npm install` first, and check `node -v` is 20.19 or newer |

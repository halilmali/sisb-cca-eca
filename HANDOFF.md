# ClubBoard — Session Handoff

> Read this first when resuming work. It captures decisions, current state, and
> pending items that the conversation history would otherwise carry.

## Project at a glance

- Vanilla HTML/CSS/JS web app (no build step) + Firebase (Auth + Firestore).
- Single page shell: `index.html` → `js/app.js` (boot + routing) → `js/admin.js`
  (admin dashboard), `js/student.js` (student picker), `js/store.js` (data layer),
  `js/ui.js` (modals/toasts/helpers), `js/access.js` (student access window),
  `js/auth.js`, `js/firebase-init.js`,
  `js/config.js` (🔧 Firebase config), `css/styles.css`, `firestore.rules`.
- GitHub (public): https://github.com/halilmali/sisb-cca-eca — branch `main`.
- Local dev: `npm start` serves the folder on port 3000 (`npx serve . -l 3000`).
  The server the user has been testing against is on **localhost:4173**.
- Syntax check: `npm run check`.

## Current feature set (all working)

- **Admins** (Google sign-in; `admins/{lowercase-email}` doc = admin):
  manage activities (CCA/ECA, days, time, venue, quota, ECA
  category), **bulk-upload activities from CSV**, manage students (add by
  email/bulk, view choices, **edit choices**, reset, delete).
- **Students**: pick **at least 2 activities in any mix** (max 2 ECAs);
  day-clash protection; **Athletics rule** (2 ECAs must include one Athletics
  ECA); quota "full" states; spots-left display; picker lists activities
  **by day**; save. **Timed access**: the student picker (and `saveChoices`)
  is gated to **Aug 24, 10:20 – 10:30 (Bangkok time)** — before/after, students
  see a "registration closed" countdown screen (admins are never gated).
  Config: `js/access.js`.
- **Quotas**: `capacity` and `seatCount` live on each activity (0 capacity =
  unlimited). Enforced in the UI and **atomically** in a Firestore transaction.
  `setStudentChoices` (admin edit) keeps counters in sync and
  rejects assigning to a full club.
- **Choice limits**: at least 2 activities total in any mix; CCAs unlimited;
  ECAs capped at 2, and 2 ECAs must include an **Athletics** ECA (category
  field on ECA activities). UI blocks a 3rd ECA / non-Athletics pair / <2
  total; `saveChoices` / `setStudentChoices` validate; `firestore.rules`
  enforces min 2 total / max 2 ECAs + the Athletics rule for student saves
  (with `is list` type guards).
- **Roster privacy**: only admins can list `students`; a student reads only
  their own doc. Activity documents include the count needed for "spots left."
- **Existing-data migration**: after deploying the matching app and rules in a
  maintenance window, an admin must click **Migrate seat counts** once. It
  recomputes activity counts from saved student choices; student saves remain
  disabled until every activity has a valid nonnegative `seatCount`.
- **Demo mode**: replace the `js/config.js` values with `YOUR_...` placeholders
  to preview with localStorage data (key `clubboard_demo_v1`). The user's real
  Firebase config is currently in place → the app runs in **Firebase mode**.

## Firebase setup status — ⚠️ confirm before assuming it's live

The user has a real Firebase project (`sisb-cca-eca`) and config is in
`js/config.js`. **Not confirmed done** (user may or may not have completed):
1. Firestore database created (Production mode).
2. **`firestore.rules` deployed** (console Rules tab, or
   `firebase deploy --only firestore:rules`). The app had "Missing or
   insufficient permissions" errors on the login page — expected pre-sign-in,
   but the deployed rules state is unknown.
3. `admins/{admin-email}` document created in the console (rules forbid
   app-side admin creation).
4. Google Sign-In enabled in Firebase Auth.

## Known limitations / intentional trade-offs

- **Day-clash rule is client-side only.** The Firestore rules language can't
  iterate the chosen club list and is capped at 10 document reads per request,
  so it can't be expressed in rules. Honest students are blocked; a malicious
  student editing JS (or calling `saveChoices` from the console) could save
  same-day clubs. **Full fix = Cloud Function** (declined by user for now).
- **Activity `seatCount` ±1 updates must match an add/remove in the signed-in
  student's own choices** via `getAfter()`. Rules still cannot prove every
  arbitrary list change updated all corresponding counters, so complete
  hostile-client protection still requires a trusted backend.
- README's "🔒 Security note" section documents both of these.

## Verified in browser tests (playwright-cli)

- Admin add/edit/delete activity; add/remove students; reset choices.
- Student save, day-clash banner, quota-full blocking, 2-ECA cap + toast,
  capped-card dimming, Athletics-rule banner, by-day picker view (only view).
- Admin "Edit choices" modal: cap, full-club disabled, clash warning,
  Athletics-rule warning, seat-counter sync, quota rejection on full club.
- Admin bulk activity upload (template download, CSV parse, duplicate skip).
- Session persistence across reload (demo auth restore).

## How to resume in a new session

1. Open the project folder `C:\Users\mali\Documents\cca` (or clone the repo).
2. Read `README.md` **and this `HANDOFF.md`**.
3. Ask the user which part they want to continue (see next steps).

## Reasonable next steps (offer these)

- Deploy `firestore.rules` if not done; verify live app works as admin.
- Add the **Cloud Function** (callable `saveChoices`) for server-side
  day-clash + seat-counter enforcement (needs Firebase Blaze plan).
- Enable **Firebase Hosting** or **GitHub Pages** for a public URL.
- Add unit tests for `store.js` (transactions, limits, quota logic).
- `output/` contains test screenshots + `modal-test.html` (gitignored).

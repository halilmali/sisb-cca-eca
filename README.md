# ClubBoard — School CCA & ECA Choice System

A simple, self-hosted club choice portal for schools. Built with plain **HTML, CSS & JavaScript**
(no build tools) and **Firebase** (Auth + Firestore).

- **Students** sign in with their Google account and pick **1–2 CCAs and 1–2 ECAs**.
- The system **blocks any CCA/ECA pair that runs on the same day** (day-clash rule).
- **Admins** (Google sign-in, identified by email) manage activities and the student roster — including **editing any student's CCA/ECA choices directly** (with quota-safe seat bookkeeping).
- **Quotas**: each activity has a max-student quota set by the admin. When a club is full, students **cannot** choose it — enforced live in the UI **and** atomically in Firestore (race-free).

---

## ✨ Quick preview (no Firebase needed)

The app ships with a **demo mode**: until you paste a real Firebase config into
`js/config.js`, it stores everything in browser localStorage so you can click
through the whole flow instantly.

```bash
# from the project folder
npx serve .
# or: python -m http.server 3000
# then open http://localhost:3000
```

On the login screen choose **"Preview as Admin"** or **"Preview as Student"**.
Demo data resets when you clear the site's localStorage.

> Note: Google Sign-In needs the app served over `http://localhost` (or `https`)
> — opening `index.html` directly via `file://` won't work for OAuth.

---

## 🔥 Connect your own Firebase project

### 1. Create a project & enable Google Sign-In

1. Go to the [Firebase Console](https://console.firebase.google.com) → **Add project**.
2. In **Build → Authentication → Sign-in method**, enable **Google**.
3. Add the email domain(s) of your students/admins to the **Authorized domains**
   (e.g. `localhost` is allowed by default; add your hosted domain when deployed).

### 2. Add a web app & copy the config

1. In Project settings (⚙️) → **Your apps → Web app** (`</>`), register an app.
2. Copy the `firebaseConfig` object it displays.
3. Paste it into **`js/config.js`**, replacing the `YOUR_...` placeholders.

Once the placeholders are replaced, the app automatically switches from demo mode
to Firebase mode (live Firestore data, real Google OAuth).

### 3. Create the Firestore database

1. **Build → Firestore Database → Create database**.
2. Choose production mode and a region close to you.

### 4. Deploy the security rules

1. **Build → Firestore Database → Rules**.
2. Paste the contents of **`firestore.rules`** (in this repo) and publish.

### 5. Make yourself admin

Admins are documents in the `admins` collection whose **document ID is the
user's email address** (lowercase).

1. In **Firestore Database → Data**, add a document to the `admins` collection.
2. Document ID = your email, e.g. `principal@school.edu` — value can be anything, e.g. `{ "addedAt": <timestamp> }`.

Sign in with that Google account and you'll see the admin dashboard.

### 6. Add your students

In the admin **Students** tab, add students by email (one or many at a time). Each row also offers **View** (see their choices), **Edit choices** (set their CCAs/ECAs for them, respecting the 1–2 limit and quotas), **Reset** (clear their choices and release seats), and **Delete**.
Students sign in with their school Google account; the app matches them by email
and pulls their display name from Google automatically.

---

## 🗂 How it works

### Data model (Firestore)

| Collection  | Document ID        | Shape                                                                    |
| ----------- | ------------------ | ------------------------------------------------------------------------ |
| `activities`| auto               | `{ name, type: "CCA"\|"ECA", days: ["Mon",...], time, venue, capacity (quota), description }` |
| `students`  | student email      | `{ email, name, className, cca: [actId...], eca: [actId...], submittedAt }` |
| `seats`     | activity id        | `{ count }` — live quota counter per activity (kept by the save transaction) |
| `admins`    | admin email        | `{ addedAt }` — presence means admin                                     |

### Quota (capacity) rule

Every activity has a **quota** (`capacity` in the data; `0` = unlimited). The admin sets it when adding/editing an activity. When the number of students who picked a club reaches its quota:

- the club's card is **disabled** for other students ("Quota full"), and
- saving is **rejected** — in demo mode by checking the live roster, and in Firebase mode by a **Firestore transaction** that reads the `seats/{activityId}` counters and the activity quota, then updates the student doc and counters atomically. This makes the quota race-free: two students can't both grab the last spot at the same instant.

The `seats` counters are adjusted automatically whenever a student saves/changes choices and whenever an admin resets or deletes a student (seats are released). Deleting an activity removes its counter.

> **Security note:** the quota is enforced by the app (client-side checks + a Firestore transaction), not by the security rules — the rules allow a signed-in user to move a seat counter by ±1 because the rule language can't verify the accompanying enrollment write. This is fine for students using the app normally; if you need hard enforcement against a hostile client, add a Cloud Function / Admin SDK endpoint for saving choices.

### The day-clash rule

Each activity has one or more **days of the week**. A student's chosen CCAs are
combined into a set of days, and their chosen ECAs into another set. If the two
sets overlap, the app refuses to save and shows exactly which days clash and
which clubs cause it.

### Roles

- **Admin** — email exists in `admins/{email}`. Manages activities & students,
  views/resets/deletes any student's choices.
- **Student** — email exists in `students/{email}`. Picks **1–2 CCAs and 1–2 ECAs**.
- **Anyone else** — sees a "not on the list" screen.

---

## 🚀 Deploying (Firebase Hosting)

```bash
npm i -g firebase-tools
firebase login
firebase init hosting        # choose this folder as public dir, single-page app: yes
firebase deploy
```

Then add your hosting domain to the Google Sign-In **Authorized domains** list.

---

## 🧰 Project structure

```
index.html         # single page shell + Firebase CDN import map
css/styles.css     # design system
js/config.js       # 🔧 paste your Firebase config here
js/firebase-init.js# lazy Firebase initializer
js/store.js        # data layer (Firestore or demo localStorage)
js/auth.js         # Google sign-in / demo login
js/ui.js           # toasts, modals, day chips, helpers
js/app.js          # boot + role routing
js/admin.js        # admin dashboard
js/student.js      # student club picker with clash validation
firestore.rules    # deploy these rules to Firestore
```

## 🔒 Security note

What the shipped `firestore.rules` enforce:

- **Admins only** can create/edit/delete activities, add/remove students, and
  reset choices. The `admins` collection is console-only (`allow write: false`).
- **Roster privacy** — only admins can list the `students` collection; each
  student can read **only their own document**. The student view shows "spots
  left" from the `seats` collection, not from other students' docs.
- **Choice limits** — a student's save is rejected server-side unless they keep
  **1–2 CCAs and 1–2 ECAs** whenever the choice fields change.
- **Quotas** — enforced atomically by the app's Firestore transaction
  (reads `seats/{activityId}` counters against `capacity`), so two students
  can't grab the last spot at once.

Known limitations (client-side app code, not rules):

- **Day-clash protection runs in the app**, not in the rules — the rules
  language can't iterate the chosen club list and is capped at 10 document
  reads per request, so the pairwise check can't be expressed there. Honest
  students are always blocked; a malicious one who edits the JS could save
  same-day clubs. Full server-side enforcement needs a Cloud Function.
- **Seat counters** (`seats/{activityId}`) accept ±1 updates from any signed-in
  user because rules can't verify the enrollment in the same transaction — a
  hostile client could corrupt quota bookkeeping. The quota transaction still
  prevents taking a seat when the counter reports full.

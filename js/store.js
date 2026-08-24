// ============================================================================
// ClubBoard — data layer (store)
// ============================================================================
// One API, two backends:
//   - Firebase mode : Firestore collections (activities, students, admins),
//                     live updates via onSnapshot.
//   - Demo mode     : browser localStorage, so the app is fully previewable
//                     before a Firebase project is configured.
//
// Firestore layout
//   activities/{autoId}   { name, type: "CCA"|"ECA", days: ["Mon",...],
//                           time, venue, capacity, seatCount, createdAt,
//                           genderRestriction?: "F"|"M"|null,
//                           category?: "Athletics"|"Non-Athletics"|null (ECAs only) }
//   students/{email}      { email, name, nickname, className, gender: "M"|"F",
//                           cca: [actId...], eca: [actId...], submittedAt }
//   admins/{email}        { addedAt }   // doc exists  => user is admin
// ============================================================================
import { isConfigured } from "./config.js";
import { normDays } from "./ui.js";
import { isStudentWindowOpen } from "./access.js";

export const MODE = isConfigured ? "firebase" : "demo";

// ---------------------------------------------------------------------------
// Shared reactive state
// ---------------------------------------------------------------------------
let activities = [];
let activitiesLoaded = MODE === "demo";
let students = []; // firebase mode: full roster — only populated for admins
let myStudent = null; // firebase mode: the signed-in user's own doc
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

/** Subscribe to data changes. Returns an unsubscribe function. */
export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getActivities() {
  // In demo mode mutations may replace the array (filter/delete), so read
  // from the live demoDb rather than a possibly-stale module-level reference.
  const list = MODE === "demo" ? (demoDb ? demoDb.activities : []) : activities;
  // Normalize day names to full names ("Mon" -> "Monday") so activities
  // stored under either format display and match consistently.
  return list.map((a) => ({ ...a, days: normDays(a.days) }));
}

export function getStudents() {
  return MODE === "demo" ? (demoDb ? demoDb.students : []) : students;
}

export function getActivity(id) {
  return getActivities().find((a) => a.id === id);
}

export function getStudent(email) {
  const key = String(email).toLowerCase();
  if (MODE === "demo") return getStudents().find((s) => s.email === key);
  // Students only have read access to their own doc (roster is private).
  if (myStudent && myStudent.email === key) return myStudent;
  return students.find((s) => s.email === key); // admin fallback
}

/**
 * Seat counts per activity (activityId -> number of students in it).
 * Firebase stores the count on each activity document, so loading activity
 * details also loads availability without a second collection query.
 */
export function getSeats() {
  if (MODE === "demo") {
    const map = new Map();
    for (const s of demoDb ? demoDb.students : []) {
      for (const id of [...(s.cca || []), ...(s.eca || [])]) {
        map.set(id, (map.get(id) || 0) + 1);
      }
    }
    return map;
  }
  return new Map(activities.map((activity) => [activity.id, activity.seatCount || 0]));
}

export function areSeatCountsReady() {
  return MODE === "demo" || (
    activitiesLoaded &&
    activities.every((activity) => Number.isInteger(activity.seatCount) && activity.seatCount >= 0)
  );
}

// ---------------------------------------------------------------------------
// Demo backend (localStorage)
// ---------------------------------------------------------------------------
const DEMO_KEY = "clubboard_demo_v1";

const DEMO_ACTIVITIES = [
  {
    name: "Basketball",
    type: "CCA",
    days: ["Mon", "Wed"],
    time: "3:00 PM – 4:30 PM",
    venue: "Main Gym",
    capacity: 20,
    genderRestriction: null,
  },
  {
    name: "Robotics Club",
    type: "CCA",
    days: ["Tue", "Thu"],
    time: "3:30 PM – 5:00 PM",
    venue: "Maker Lab",
    capacity: 16,
    genderRestriction: null,
  },
  {
    name: "Debate Team",
    type: "CCA",
    days: ["Mon", "Fri"],
    time: "4:00 PM – 5:30 PM",
    venue: "Room 204",
    capacity: 24,
    genderRestriction: null,
  },
  {
    name: "Girls' Netball",
    type: "CCA",
    days: ["Tue", "Thu"],
    time: "3:30 PM – 5:00 PM",
    venue: "Sports Hall",
    capacity: 18,
    genderRestriction: "F",
  },
  {
    name: "Chess Club",
    type: "ECA",
    days: ["Tue"],
    time: "3:00 PM – 4:00 PM",
    venue: "Library",
    capacity: 20,
    genderRestriction: null,
    category: "Non-Athletics",
  },
  {
    name: "Art Studio",
    type: "ECA",
    days: ["Wed"],
    time: "3:00 PM – 5:00 PM",
    venue: "Art Room",
    capacity: 18,
    genderRestriction: null,
    category: "Non-Athletics",
  },
  {
    name: "Coding Club",
    type: "ECA",
    days: ["Fri"],
    time: "3:00 PM – 4:30 PM",
    venue: "Computer Lab",
    capacity: 15,
    genderRestriction: null,
    category: "Non-Athletics",
  },
  {
    name: "Track & Field",
    type: "ECA",
    days: ["Tue", "Thu"],
    time: "3:00 PM – 4:30 PM",
    venue: "Stadium",
    capacity: 30,
    genderRestriction: null,
    category: "Athletics",
  },
];

const DEMO_ADMINS = ["admin@demo.school"];

function demoSeed() {
  return {
    activities: DEMO_ACTIVITIES.map((a, i) => ({
      id: `demo-act-${i + 1}`,
      createdAt: Date.now(),
      ...a,
    })),
    students: [
      {
        email: "alex@demo.school",
        name: "Alex Chen",
        nickname: "Alex",
        className: "7A",
        gender: "M",
        cca: ["demo-act-1"],
        eca: ["demo-act-5"],
        submittedAt: Date.now() - 86400000,
      },
      {
        email: "mia@demo.school",
        name: "Mia Patel",
        nickname: "Mia",
        className: "7B",
        gender: "F",
        cca: [],
        eca: [],
        submittedAt: null,
      },
    ],
    admins: DEMO_ADMINS,
  };
}

let demoDb = null;

function loadDemo() {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    demoDb = raw ? JSON.parse(raw) : demoSeed();
    if (!demoDb.admins) demoDb.admins = [...DEMO_ADMINS];
  } catch {
    demoDb = demoSeed();
  }
  activities = demoDb.activities;
  activitiesLoaded = true;
  students = demoDb.students;
}

function saveDemo() {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(demoDb));
  } catch {
    /* storage full or unavailable — keep in memory */
  }
  emit();
}

// ---------------------------------------------------------------------------
// Firebase backend
// ---------------------------------------------------------------------------
let db = null;
let unsubscribes = [];
let roleUnsubscribes = [];
let accessVersion = 0;

async function initFirebase() {
  const { getDb } = await import("./firebase-init.js");
  db = await getDb();
}

/**
 * Subscribe to the data this role is allowed to see, and stop any previous
 * role-scoped subscriptions. Admins get the full students roster; students
 * get only their own doc. Call whenever the signed-in role changes.
 */
export async function configureAccess(role, email) {
  if (MODE !== "firebase") return;
  const version = ++accessVersion;
  // Drop role-scoped state from any previous session before re-subscribing,
  // so a later user never sees (or reads via the console) stale roster data.
  students = [];
  myStudent = null;
  activities = [];
  activitiesLoaded = false;
  for (const unsub of unsubscribes) unsub();
  unsubscribes = [];
  for (const unsub of roleUnsubscribes) unsub();
  roleUnsubscribes = [];
  if (!db) return;

  const { collection, doc, getDocs, onSnapshot } = await import("firebase/firestore");

  // Shared data is loaded after auth to avoid "missing permissions" errors
  // when the user isn't signed in yet.
  const setupListener = (colName, callback) => {
    let retryTimeout = null;
    let hasReceivedData = false;
    let activeUnsubscribe = null;
    let cancelled = false;
    const listen = () => {
      if (cancelled) return;
      activeUnsubscribe = onSnapshot(
        collection(db, colName),
        (snap) => {
          hasReceivedData = true;
          callback(snap);
        },
        (err) => {
          // On first login, there's a brief window where auth hasn't fully propagated
          // Retry after a short delay if permission-denied, but don't log the error
          if (err.code === "permission-denied") {
            if (!retryTimeout && !hasReceivedData) {
              retryTimeout = setTimeout(() => {
                retryTimeout = null;
                listen();
              }, 500);
            }
          } else {
            console.error(`${colName} listener failed:`, err);
          }
        }
      );
    };
    listen();
    // Always cancel the currently active retry/listener. The previous code
    // returned only the first unsubscribe function, so a retried listener
    // survived sign-out and could be removed by a later login race.
    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      if (activeUnsubscribe) activeUnsubscribe();
    };
  };

  if (role === "admin") {
    unsubscribes.push(
      setupListener("activities", (snap) => {
        activities = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        activitiesLoaded = true;
        emit();
      })
    );
    roleUnsubscribes.push(
      onSnapshot(
        collection(db, "students"),
        (snap) => {
          students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          emit();
        },
        (err) => {
          // Suppress permission-denied errors on first login for students
          if (err.code === "permission-denied") return;
          console.error("students listener failed:", err);
        }
      )
    );
  } else if (role === "student") {
    // Student availability is a snapshot. The save transaction performs the
    // authoritative quota check, so live activity updates would only recreate
    // read fan-out when other students take seats.
    try {
      const snap = await getDocs(collection(db, "activities"));
      if (version !== accessVersion) return;
      activities = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      activitiesLoaded = true;
      emit();
    } catch (err) {
      console.error("activities load failed:", err);
    }
    if (version !== accessVersion) return;

    const key = String(email).toLowerCase();
    roleUnsubscribes.push(
      onSnapshot(
        doc(db, "students", key),
        (snap) => {
          myStudent = snap.exists() ? { id: snap.id, ...snap.data() } : null;
          emit();
        },
        (err) => {
          // Suppress permission-denied errors on first login for students
          if (err.code === "permission-denied") return;
          console.error("own-student listener failed:", err);
        }
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Shared API
// ---------------------------------------------------------------------------

/** Initialize the store. Call once before using the app. */
export async function initStore() {
  if (MODE === "firebase") {
    await initFirebase();
  } else {
    loadDemo();
  }
}

/** Add a new CCA or ECA activity. */
export async function addActivity(data) {
  if (MODE === "demo") {
    const id = `demo-act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    demoDb.activities.push({ id, createdAt: Date.now(), ...data });
    saveDemo();
    return id;
  }
  const { collection, addDoc } = await import("firebase/firestore");
  const ref = await addDoc(collection(db, "activities"), {
    createdAt: Date.now(),
    ...data,
    seatCount: 0,
  });
  return ref.id;
}

/** Update an activity. */
export async function updateActivity(id, data) {
  if (MODE === "demo") {
    const idx = demoDb.activities.findIndex((a) => a.id === id);
    if (idx !== -1) demoDb.activities[idx] = { ...demoDb.activities[idx], ...data };
    saveDemo();
    return;
  }
  const { doc, updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, "activities", id), data);
}

/** Delete an activity and remove it from every student's choices. */
export async function deleteActivity(id) {
  if (MODE === "demo") {
    demoDb.activities = demoDb.activities.filter((a) => a.id !== id);
    for (const s of demoDb.students) {
      s.cca = (s.cca || []).filter((x) => x !== id);
      s.eca = (s.eca || []).filter((x) => x !== id);
    }
    saveDemo();
    return;
  }
  const { doc, deleteDoc, writeBatch } = await import("firebase/firestore");
  await deleteDoc(doc(db, "activities", id));
  // Remove a legacy counter if this activity predates embedded seat counts.
  await deleteDoc(doc(db, "seats", id));
  // Clean up any student's choices that referenced the deleted activity
  const affected = students.filter(
    (s) => (s.cca || []).includes(id) || (s.eca || []).includes(id)
  );
  if (affected.length) {
    const batch = writeBatch(db);
    for (const s of affected) {
      batch.update(doc(db, "students", s.id), {
        cca: (s.cca || []).filter((x) => x !== id),
        eca: (s.eca || []).filter((x) => x !== id),
      });
    }
    await batch.commit();
  }
}

/** Add a student (by email). Returns false if the email is already on the list. */
export async function addStudent(email, name = "", className = "", nickname = "", gender = "") {
  const key = String(email).toLowerCase().trim();
  if (MODE === "demo") {
    if (demoDb.students.some((s) => s.email === key)) return false;
    demoDb.students.push({
      email: key,
      name,
      nickname,
      className,
      gender,
      cca: [],
      eca: [],
      submittedAt: null,
    });
    saveDemo();
    return true;
  }
  const { doc, getDoc, setDoc } = await import("firebase/firestore");
  const ref = doc(db, "students", key);
  const existing = await getDoc(ref);
  if (existing.exists()) return false;
  await setDoc(ref, {
    email: key,
    name,
    nickname,
    className,
    gender,
    cca: [],
    eca: [],
    submittedAt: null,
  });
  return true;
}

const SEAT_MIGRATION_ERROR =
  "Activity seat counts have not been migrated yet. Ask an administrator to migrate them first.";

function assertSeatCountsReady() {
  if (!areSeatCountsReady()) throw new Error(SEAT_MIGRATION_ERROR);
}

async function readActivitySeatChanges(tx, docFn, addedIds = [], removedIds = []) {
  const deltas = new Map();
  for (const id of addedIds) deltas.set(id, 1);
  for (const id of removedIds) deltas.set(id, -1);

  const changes = [];
  for (const [id, delta] of deltas) {
    const ref = docFn(db, "activities", id);
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      if (delta > 0) throw new Error("One of the chosen clubs no longer exists.");
      continue;
    }

    const activity = snap.data();
    if (!Number.isInteger(activity.seatCount) || activity.seatCount < 0) {
      throw new Error(SEAT_MIGRATION_ERROR);
    }
    if (delta > 0 && (activity.capacity || 0) > 0 && activity.seatCount >= activity.capacity) {
      throw new Error(`"${activity.name}" is full — its quota has been reached.`);
    }
    changes.push({ ref, seatCount: activity.seatCount, delta });
  }
  return changes;
}

function writeActivitySeatChanges(tx, changes) {
  for (const { ref, seatCount, delta } of changes) {
    if (delta < 0 && seatCount === 0) continue;
    tx.update(ref, { seatCount: Math.max(0, seatCount + delta) });
  }
}

/** One-time admin migration that derives activity counts from saved choices. */
export async function migrateLegacySeatCounts() {
  if (MODE === "demo") return 0;
  const { collection, doc, getDocs, runTransaction, Timestamp, writeBatch } =
    await import("firebase/firestore");
  const lockRef = doc(db, "system", "seatCountMigration");
  const owner = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const leaseUntil = () => Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
  await runTransaction(db, async (tx) => {
    const lock = await tx.get(lockRef);
    const expiresAt = lock.exists() ? lock.data().expiresAt : null;
    if (expiresAt?.toMillis?.() > Date.now()) {
      throw new Error("Another administrator is already migrating seat counts.");
    }
    tx.set(lockRef, {
      owner,
      expiresAt: leaseUntil(),
    });
  });

  const renewLock = () => runTransaction(db, async (tx) => {
    const lock = await tx.get(lockRef);
    if (!lock.exists() || lock.data().owner !== owner) {
      throw new Error("The seat-count migration lease was lost. Run the migration again.");
    }
    tx.update(lockRef, { expiresAt: leaseUntil() });
  });

  try {
    const [activitySnap, studentSnap] = await Promise.all([
      getDocs(collection(db, "activities")),
      getDocs(collection(db, "students")),
    ]);
    const savedCounts = new Map();
    for (const item of studentSnap.docs) {
      const student = item.data();
      for (const id of new Set([...(student.cca || []), ...(student.eca || [])])) {
        savedCounts.set(id, (savedCounts.get(id) || 0) + 1);
      }
    }
    const activityDocs = activitySnap.docs;

    for (let offset = 0; offset < activityDocs.length; offset += 450) {
      await renewLock();
      const batch = writeBatch(db);
      for (const item of activityDocs.slice(offset, offset + 450)) {
        batch.update(doc(db, "activities", item.id), {
          seatCount: savedCounts.get(item.id) || 0,
        });
      }
      await batch.commit();
    }
    return activityDocs.length;
  } finally {
    await runTransaction(db, async (tx) => {
      const lock = await tx.get(lockRef);
      if (lock.exists() && lock.data().owner === owner) tx.delete(lockRef);
    }).catch((err) => console.error("migration lock cleanup failed:", err));
  }
}

/** Remove a student (and release their seats). */
export async function deleteStudent(email) {
  const key = String(email).toLowerCase();
  if (MODE === "demo") {
    demoDb.students = demoDb.students.filter((s) => s.email !== key);
    saveDemo();
    return;
  }
  assertSeatCountsReady();
  const { doc, runTransaction } = await import("firebase/firestore");
  const studentRef = doc(db, "students", key);
  await runTransaction(db, async (tx) => {
    // Phase 1 — ALL reads (Firestore forbids reads after the first write).
    const studentSnap = await tx.get(studentRef);
    let activityChanges = [];
    if (studentSnap.exists()) {
      const prev = studentSnap.data();
      const ids = new Set([...(prev.cca || []), ...(prev.eca || [])]);
      activityChanges = await readActivitySeatChanges(tx, doc, [], ids);
    }
    // Phase 2 — ALL writes.
    writeActivitySeatChanges(tx, activityChanges);
    tx.delete(studentRef);
  });
}

/**
 * Save a student's choices.
 *
 * Quota enforcement: each activity has a `capacity` (0 = unlimited). In
 * Firebase mode a Firestore transaction reads the affected activity docs,
 * checks their embedded `seatCount`, and only then writes the student and
 * activity counters — all
 * atomically, so two students can't grab the last spot at the same time.
 * In demo mode the quota is checked against the in-memory roster.
 */
export async function saveChoices(email, ccaIds, ecaIds) {
  const key = String(email).toLowerCase();
  // Hard boundary for the student registration window: saves outside the
  // window are refused even if the UI is bypassed (e.g. via the console).
  if (!isStudentWindowOpen()) {
    throw new Error(
      "Club choice is currently closed. It is open to students from 10:20 to 10:30 (Bangkok time) on August 24."
    );
  }
  assertChoiceLimits(ccaIds, ecaIds);
  assertEcaAthleticsRule(ecaIds);
  if (MODE === "demo") {
    const s = demoDb.students.find((x) => x.email === key);
    if (!s) throw new Error("You're not on the club list yet.");
    assertQuotaFree(ccaIds, ecaIds, key);
    s.cca = ccaIds;
    s.eca = ecaIds;
    s.submittedAt = Date.now();
    saveDemo();
    return;
  }
  assertSeatCountsReady();

  const { doc, runTransaction } = await import("firebase/firestore");
  const studentRef = doc(db, "students", key);

  const changes = await runTransaction(db, async (tx) => {
    // Phase 1 — ALL reads (Firestore forbids reads after the first write).
    const studentSnap = await tx.get(studentRef);
    if (!studentSnap.exists()) throw new Error("You're not on the club list yet.");
    const prev = studentSnap.data();
    const prevIds = new Set([...(prev.cca || []), ...(prev.eca || [])]);
    const nextIds = new Set([...ccaIds, ...ecaIds]);
    const added = [...nextIds].filter((id) => !prevIds.has(id));
    const removed = [...prevIds].filter((id) => !nextIds.has(id));

    const activityChanges = await readActivitySeatChanges(tx, doc, added, removed);

    // Phase 2 — ALL writes.
    writeActivitySeatChanges(tx, activityChanges);
    tx.update(studentRef, {
      cca: ccaIds,
      eca: ecaIds,
      submittedAt: Date.now(),
    });
    return { added, removed };
  });

  // Keep this student's one-time activity snapshot current after its save.
  activities = activities.map((activity) => {
    if (changes.added.includes(activity.id)) {
      return { ...activity, seatCount: (activity.seatCount || 0) + 1 };
    }
    if (changes.removed.includes(activity.id)) {
      return { ...activity, seatCount: Math.max(0, (activity.seatCount || 0) - 1) };
    }
    return activity;
  });
  emit();
}

/**
 * Admin-only: set a student's choices directly (at least 2 activities total,
 * unlimited CCAs, max 2 ECAs). Keeps the seat counters and quotas in sync —
 * assigning a student to a club that is already at capacity is rejected,
 * exactly like a student save.
 */
export async function setStudentChoices(email, ccaIds, ecaIds) {
  const key = String(email).toLowerCase();
  if (ccaIds.length + ecaIds.length < 2) throw new Error("A student must pick at least 2 activities.");
  if (ecaIds.length > 2) throw new Error("A student can have at most 2 ECAs.");
  assertEcaAthleticsRule(ecaIds);

  if (MODE === "demo") {
    const s = demoDb.students.find((x) => x.email === key);
    if (!s) throw new Error("That student isn't on the roster.");
    assertQuotaFree(ccaIds, ecaIds, key);
    s.cca = ccaIds;
    s.eca = ecaIds;
    s.submittedAt = Date.now();
    saveDemo();
    return;
  }
  assertSeatCountsReady();

  const { doc, runTransaction } = await import("firebase/firestore");
  const studentRef = doc(db, "students", key);

  await runTransaction(db, async (tx) => {
    // Phase 1 — ALL reads (Firestore forbids reads after the first write).
    const studentSnap = await tx.get(studentRef);
    if (!studentSnap.exists()) throw new Error("That student isn't on the roster.");
    const prev = studentSnap.data();
    const prevIds = new Set([...(prev.cca || []), ...(prev.eca || [])]);
    const nextIds = new Set([...ccaIds, ...ecaIds]);
    const added = [...nextIds].filter((id) => !prevIds.has(id));
    const removed = [...prevIds].filter((id) => !nextIds.has(id));

    const activityChanges = await readActivitySeatChanges(tx, doc, added, removed);

    // Phase 2 — ALL writes.
    writeActivitySeatChanges(tx, activityChanges);
    tx.update(studentRef, {
      cca: ccaIds,
      eca: ecaIds,
      submittedAt: Date.now(),
    });
  });
}

/** Clear a student's choices (admin reset). Releases their seats. */
export async function clearChoices(email) {
  const key = String(email).toLowerCase();
  if (MODE === "demo") {
    const s = demoDb.students.find((x) => x.email === key);
    if (s) {
      s.cca = [];
      s.eca = [];
      s.submittedAt = null;
    }
    saveDemo();
    return;
  }
  assertSeatCountsReady();
  const { doc, runTransaction } = await import("firebase/firestore");
  const studentRef = doc(db, "students", key);
  await runTransaction(db, async (tx) => {
    // Phase 1 — ALL reads (Firestore forbids reads after the first write).
    const studentSnap = await tx.get(studentRef);
    if (!studentSnap.exists()) return;
    const prev = studentSnap.data();
    const ids = new Set([...(prev.cca || []), ...(prev.eca || [])]);
    const activityChanges = await readActivitySeatChanges(tx, doc, [], ids);
    // Phase 2 — ALL writes.
    writeActivitySeatChanges(tx, activityChanges);
    tx.update(studentRef, { cca: [], eca: [], submittedAt: null });
  });
}

/** Sync the student's display name from their Google account. */
export async function updateStudentName(email, name) {
  const key = String(email).toLowerCase();
  if (!name) return;
  if (MODE === "demo") {
    const s = demoDb.students.find((x) => x.email === key);
    if (s && s.name !== name) {
      s.name = name;
      saveDemo();
    }
    return;
  }
  const { doc, updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, "students", key), { name });
}

/** Is this email an admin? */
export async function isAdmin(email) {
  const key = String(email).toLowerCase();
  if (MODE === "demo") {
    return (demoDb.admins || []).includes(key);
  }
  const { doc, getDoc } = await import("firebase/firestore");
  return (await getDoc(doc(db, "admins", key))).exists();
}

/** Is this email a registered student? */
export async function isStudent(email) {
  const key = String(email).toLowerCase();
  if (MODE === "demo") {
    return demoDb.students.some((s) => s.email === key);
  }
  const { doc, getDoc } = await import("firebase/firestore");
  return (await getDoc(doc(db, "students", key))).exists();
}

/** Resolve the role for a signed-in email: "admin" | "student" | "none". */
export async function getRole(email) {
  if (await isAdmin(email)) return "admin";
  if (await isStudent(email)) return "student";
  return "none";
}

/** Reset demo data to the seed state (demo mode only). */
export function resetDemoData() {
  if (MODE !== "demo") return;
  localStorage.removeItem(DEMO_KEY);
  loadDemo();
  emit();
}

// ---------------------------------------------------------------------------
// Choice-limit helpers
// ---------------------------------------------------------------------------

/**
 * Each student must pick at least 2 activities in total (any mix of CCAs and
 * ECAs), with at most 2 ECAs. Mirrors the firestore.rules check; gives users
 * a clean message instead of a rules-denied error, and guards the demo-mode
 * path too.
 */
function assertChoiceLimits(ccaIds, ecaIds) {
  if (ccaIds.length + ecaIds.length < 2) throw new Error("Pick at least 2 activities.");
  if (ecaIds.length > 2) throw new Error("You can pick at most 2 ECAs.");
}

/**
 * ECA Athletics rule: when a student picks exactly 2 ECAs, at least one of
 * them must be an "Athletics" activity. Mirrors the firestore.rules check.
 */
function assertEcaAthleticsRule(ecaIds) {
  if (ecaIds.length !== 2) return;
  const acts = ecaIds.map((id) => getActivity(id)).filter(Boolean);
  const hasAthletics = acts.some((a) => (a.category || "").toLowerCase() === "athletics");
  if (!hasAthletics) {
    throw new Error("When you pick 2 ECAs, at least one must be an Athletics activity.");
  }
}

// ---------------------------------------------------------------------------
// Quota helpers (demo mode)
// ---------------------------------------------------------------------------

/** Count how many students are currently in an activity (demo mode). */
function demoTakeCount(actId) {
  return demoDb.students.filter(
    (s) => (s.cca || []).includes(actId) || (s.eca || []).includes(actId)
  ).length;
}

/**
 * Throws if adding these choices would exceed any activity quota.
 * Activities already chosen by this student are ignored (re-saving keeps them).
 */
function assertQuotaFree(ccaIds, ecaIds, studentEmail) {
  const actById = new Map(demoDb.activities.map((a) => [a.id, a]));
  const ids = new Set([...ccaIds, ...ecaIds]);
  const mine = new Set([
    ...((demoDb.students.find((s) => s.email === studentEmail)?.cca) || []),
    ...((demoDb.students.find((s) => s.email === studentEmail)?.eca) || []),
  ]);
  for (const actId of ids) {
    const act = actById.get(actId);
    if (!act || !act.capacity) continue;
    const newlyAdded = !mine.has(actId);
    const taken = demoTakeCount(actId);
    if (newlyAdded && taken >= act.capacity) {
      throw new Error(`"${act.name}" is full — its quota has been reached.`);
    }
  }
}

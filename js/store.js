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
//                           time, venue, capacity, description, createdAt }
//   students/{email}      { email, name, className, cca: [actId...],
//                           eca: [actId...], submittedAt }
//   admins/{email}        { addedAt }   // doc exists  => user is admin
// ============================================================================
import { isConfigured } from "./config.js";

export const MODE = isConfigured ? "firebase" : "demo";

// ---------------------------------------------------------------------------
// Shared reactive state
// ---------------------------------------------------------------------------
let activities = [];
let students = []; // firebase mode: full roster — only populated for admins
let seats = new Map(); // firebase mode: activityId -> live seat count
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
  return MODE === "demo" ? (demoDb ? demoDb.activities : []) : activities;
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
 * Live seat counts per activity (activityId -> number of students in it).
 * In firebase mode this comes from the `seats` collection, which every
 * signed-in user may read — so the student view can show "spots left"
 * without exposing the rest of the roster.
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
  return seats;
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
    description: "Shoot hoops, build teamwork, stay fit.",
  },
  {
    name: "Robotics Club",
    type: "CCA",
    days: ["Tue", "Thu"],
    time: "3:30 PM – 5:00 PM",
    venue: "Maker Lab",
    capacity: 16,
    description: "Build and program your own robot.",
  },
  {
    name: "Debate Team",
    type: "CCA",
    days: ["Mon", "Fri"],
    time: "4:00 PM – 5:30 PM",
    venue: "Room 204",
    capacity: 24,
    description: "Argue with style. Win with evidence.",
  },
  {
    name: "Chess Club",
    type: "ECA",
    days: ["Tue"],
    time: "3:00 PM – 4:00 PM",
    venue: "Library",
    capacity: 20,
    description: "From pawn to grandmaster.",
  },
  {
    name: "Art Studio",
    type: "ECA",
    days: ["Wed"],
    time: "3:00 PM – 5:00 PM",
    venue: "Art Room",
    capacity: 18,
    description: "Painting, sketching, and sculpture.",
  },
  {
    name: "Coding Club",
    type: "ECA",
    days: ["Fri"],
    time: "3:00 PM – 4:30 PM",
    venue: "Computer Lab",
    capacity: 15,
    description: "Learn to build things with code.",
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
        className: "7A",
        cca: ["demo-act-1"],
        eca: ["demo-act-4"],
        submittedAt: Date.now() - 86400000,
      },
      {
        email: "mia@demo.school",
        name: "Mia Patel",
        className: "7B",
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

async function initFirebase() {
  const { getDb } = await import("./firebase-init.js");
  const { collection, onSnapshot } = await import("firebase/firestore");
  db = await getDb();

  // activities + seats are readable by every signed-in user. The students
  // roster is role-scoped (see configureAccess) because it's private.
  unsubscribes.push(
    onSnapshot(
      collection(db, "activities"),
      (snap) => {
        activities = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        emit();
      },
      (err) => console.error("activities listener failed:", err)
    ),
    onSnapshot(
      collection(db, "seats"),
      (snap) => {
        seats = new Map(snap.docs.map((d) => [d.id, d.data().count || 0]));
        emit();
      },
      (err) => console.error("seats listener failed:", err)
    )
  );
}

/**
 * Subscribe to the data this role is allowed to see, and stop any previous
 * role-scoped subscriptions. Admins get the full students roster; students
 * get only their own doc. Call whenever the signed-in role changes.
 */
export async function configureAccess(role, email) {
  if (MODE !== "firebase") return;
  // Drop role-scoped state from any previous session before re-subscribing,
  // so a later user never sees (or reads via the console) stale roster data.
  students = [];
  myStudent = null;
  for (const unsub of roleUnsubscribes) unsub();
  roleUnsubscribes = [];
  if (!db) return;

  const { collection, doc, onSnapshot } = await import("firebase/firestore");

  if (role === "admin") {
    roleUnsubscribes.push(
      onSnapshot(
        collection(db, "students"),
        (snap) => {
          students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          emit();
        },
        (err) => console.error("students listener failed:", err)
      )
    );
  } else if (role === "student") {
    const key = String(email).toLowerCase();
    roleUnsubscribes.push(
      onSnapshot(
        doc(db, "students", key),
        (snap) => {
          myStudent = snap.exists() ? { id: snap.id, ...snap.data() } : null;
          emit();
        },
        (err) => console.error("own-student listener failed:", err)
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
    const id = `demo-act-${Date.now()}`;
    demoDb.activities.push({ id, createdAt: Date.now(), ...data });
    saveDemo();
    return id;
  }
  const { collection, addDoc } = await import("firebase/firestore");
  const ref = await addDoc(collection(db, "activities"), {
    createdAt: Date.now(),
    ...data,
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
  // Remove the seat counter for this activity (no-op if it never existed)
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
export async function addStudent(email, name = "", className = "") {
  const key = String(email).toLowerCase().trim();
  if (MODE === "demo") {
    if (demoDb.students.some((s) => s.email === key)) return false;
    demoDb.students.push({
      email: key,
      name,
      className,
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
    className,
    cca: [],
    eca: [],
    submittedAt: null,
  });
  return true;
}

/** Remove a student (and release their seats). */
export async function deleteStudent(email) {
  const key = String(email).toLowerCase();
  if (MODE === "demo") {
    demoDb.students = demoDb.students.filter((s) => s.email !== key);
    saveDemo();
    return;
  }
  const { doc, deleteDoc, runTransaction } = await import("firebase/firestore");
  const studentRef = doc(db, "students", key);
  await runTransaction(db, async (tx) => {
    // Phase 1 — ALL reads (Firestore forbids reads after the first write).
    const studentSnap = await tx.get(studentRef);
    const seatRefs = [];
    if (studentSnap.exists()) {
      const prev = studentSnap.data();
      const ids = [...(prev.cca || []), ...(prev.eca || [])];
      for (const actId of ids) {
        const seatRef = doc(db, "seats", actId);
        const seatSnap = await tx.get(seatRef);
        seatRefs.push({
          seatRef,
          taken: seatSnap.exists() ? seatSnap.data().count || 0 : 0,
        });
      }
    }
    // Phase 2 — ALL writes.
    for (const { seatRef, taken } of seatRefs) {
      tx.set(seatRef, { count: Math.max(0, taken - 1) }, { merge: true });
    }
    tx.delete(studentRef);
  });
}

/**
 * Save a student's choices.
 *
 * Quota enforcement: each activity has a `capacity` (0 = unlimited). In
 * Firebase mode a Firestore transaction reads the `seats/{activityId}`
 * counter docs and the activity docs, checks the quota for every activity
 * being newly added, and only then writes the student + seat counters — all
 * atomically, so two students can't grab the last spot at the same time.
 * In demo mode the quota is checked against the in-memory roster.
 */
export async function saveChoices(email, ccaIds, ecaIds) {
  const key = String(email).toLowerCase();
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

  const { doc, runTransaction } = await import("firebase/firestore");
  const studentRef = doc(db, "students", key);

  await runTransaction(db, async (tx) => {
    // Phase 1 — ALL reads (Firestore forbids reads after the first write).
    const studentSnap = await tx.get(studentRef);
    if (!studentSnap.exists()) throw new Error("You're not on the club list yet.");
    const prev = studentSnap.data();
    const prevIds = new Set([...(prev.cca || []), ...(prev.eca || [])]);
    const nextIds = new Set([...ccaIds, ...ecaIds]);
    const added = [...nextIds].filter((id) => !prevIds.has(id));
    const removed = [...prevIds].filter((id) => !nextIds.has(id));

    const addInfo = [];
    for (const actId of added) {
      const actSnap = await tx.get(doc(db, "activities", actId));
      if (!actSnap.exists()) throw new Error("One of the chosen clubs no longer exists.");
      const act = actSnap.data();
      const seatRef = doc(db, "seats", actId);
      const seatSnap = await tx.get(seatRef);
      addInfo.push({
        act,
        seatRef,
        taken: seatSnap.exists() ? seatSnap.data().count || 0 : 0,
      });
    }
    const removeInfo = [];
    for (const actId of removed) {
      const seatRef = doc(db, "seats", actId);
      const seatSnap = await tx.get(seatRef);
      removeInfo.push({
        seatRef,
        taken: seatSnap.exists() ? seatSnap.data().count || 0 : 0,
      });
    }

    // Validate quotas once all reads are done.
    for (const { act, taken } of addInfo) {
      if ((act.capacity || 0) > 0 && taken >= act.capacity) {
        throw new Error(`"${act.name}" is full — its quota has been reached.`);
      }
    }

    // Phase 2 — ALL writes.
    for (const { seatRef, taken } of addInfo) {
      tx.set(seatRef, { count: taken + 1 }, { merge: true });
    }
    for (const { seatRef, taken } of removeInfo) {
      tx.set(seatRef, { count: Math.max(0, taken - 1) }, { merge: true });
    }
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
  const { doc, runTransaction } = await import("firebase/firestore");
  const studentRef = doc(db, "students", key);
  await runTransaction(db, async (tx) => {
    // Phase 1 — ALL reads (Firestore forbids reads after the first write).
    const studentSnap = await tx.get(studentRef);
    if (!studentSnap.exists()) return;
    const prev = studentSnap.data();
    const ids = [...(prev.cca || []), ...(prev.eca || [])];
    const seatRefs = [];
    for (const actId of ids) {
      const seatRef = doc(db, "seats", actId);
      const seatSnap = await tx.get(seatRef);
      seatRefs.push({
        seatRef,
        taken: seatSnap.exists() ? seatSnap.data().count || 0 : 0,
      });
    }
    // Phase 2 — ALL writes.
    for (const { seatRef, taken } of seatRefs) {
      tx.set(seatRef, { count: Math.max(0, taken - 1) }, { merge: true });
    }
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

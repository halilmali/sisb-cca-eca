// ============================================================================
// ClubBoard — auth layer
// ============================================================================
// Firebase mode : Google Sign-In via popup. The signed-in user is observed
//                 with onAuthStateChanged so a page reload keeps the session.
// Demo mode     : a fake "Google user" persisted in localStorage so the whole
//                 flow can be previewed before Firebase is configured.
// ============================================================================
import { MODE } from "./store.js";

const DEMO_USER_KEY = "clubboard_demo_user";

let currentUser = null; // { email, name, photoURL }
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener(currentUser);
}

/** Subscribe to auth changes. Returns an unsubscribe function. */
export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getUser() {
  return currentUser;
}

function setUser(user) {
  currentUser = user;
  if (MODE === "demo") {
    try {
      if (user) localStorage.setItem(DEMO_USER_KEY, JSON.stringify(user));
      else localStorage.removeItem(DEMO_USER_KEY);
    } catch {
      /* ignore */
    }
  }
  emit();
}

// ---------------------------------------------------------------------------
// Firebase mode
// ---------------------------------------------------------------------------

/** Sign in with Google (popup). */
export async function loginWithGoogle() {
  const { getAuth, GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const { getApp } = await import("./firebase-init.js");
  const auth = getAuth(await getApp());
  const provider = new GoogleAuthProvider();
  // onAuthStateChanged below is the single source of truth.  Emitting here as
  // well used to start two overlapping store initialisations, one of which
  // could tear down the other's Firestore listeners during student login.
  await signInWithPopup(auth, provider);
}

export async function logout() {
  if (MODE === "demo") {
    setUser(null);
    return;
  }
  const { getAuth, signOut } = await import("firebase/auth");
  const { getApp } = await import("./firebase-init.js");
  await signOut(getAuth(await getApp()));
  setUser(null);
}

/** Observe the Firebase auth state (persisted sessions across reloads). */
export async function initAuth() {
  if (MODE !== "firebase") {
    // restore a persisted demo user
    try {
      const raw = localStorage.getItem(DEMO_USER_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    return;
  }
  const { getAuth, onAuthStateChanged } = await import("firebase/auth");
  const { getApp } = await import("./firebase-init.js");
  const auth = getAuth(await getApp());
  onAuthStateChanged(auth, async (u) => {
    if (u) {
      // Make sure the ID token is available before role checks and Firestore
      // listeners begin. This is especially important immediately after the
      // Google popup completes.
      await u.getIdToken();
      setUser({
        email: (u.email || "").toLowerCase(),
        name: u.displayName || "",
        photoURL: u.photoURL || "",
      });
    } else {
      setUser(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Demo mode helpers
// ---------------------------------------------------------------------------

/** Pretend a Google user signed in (demo mode only). */
export function demoLogin(email, name) {
  setUser({
    email: String(email).toLowerCase(),
    name,
    photoURL: "",
  });
}

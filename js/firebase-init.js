// ============================================================================
// Lazy Firebase initializer.
// Firebase modules are only fetched from the CDN once the app is configured,
// so demo mode never needs a network request to Google.
// ============================================================================
import { firebaseConfig } from "./config.js";

let appPromise = null;
let dbPromise = null;

export function getApp() {
  if (!appPromise) {
    appPromise = import("firebase/app").then(({ initializeApp }) =>
      initializeApp(firebaseConfig)
    );
  }
  return appPromise;
}

export async function getDb() {
  if (!dbPromise) {
    dbPromise = getApp().then(async (app) => {
      const { getFirestore } = await import("firebase/firestore");
      return getFirestore(app);
    });
  }
  return dbPromise;
}

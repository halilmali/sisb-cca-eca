// ============================================================================
// ClubBoard — Firebase configuration
// ============================================================================
// 1) Go to https://console.firebase.google.com and create a project.
// 2) Add a Web app (the </> icon) and copy the config object it shows.
// 3) Paste those values below, replacing the YOUR_... placeholders.
//
// As long as the values below still contain placeholders, the app runs in
// DEMO MODE (data is kept in browser localStorage) so you can preview the
// whole flow without touching Firebase.
// ============================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBnMrHldBxXJ6Bz0pdGyOSXESusluBN_iI",
  authDomain: "sisb-cca-eca.firebaseapp.com",
  projectId: "sisb-cca-eca",
  storageBucket: "sisb-cca-eca.firebasestorage.app",
  messagingSenderId: "580010444552",
  appId: "1:580010444552:web:17ac1faa96757ae3a54ebd"
};



// True once the placeholders have been replaced with a real config.
export const isConfigured = !Object.values(firebaseConfig).some(
  (v) => typeof v === "string" && v.startsWith("YOUR_")
);

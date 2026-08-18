// ============================================================================
// ClubBoard — app entry: boot, auth routing, view switching
// ============================================================================
import { MODE, initStore, subscribe as subscribeStore, getRole, updateStudentName, configureAccess } from "./store.js";
import * as auth from "./auth.js";
import { $, esc } from "./ui.js";
import { mountAdminView } from "./admin.js";
import { mountStudentView } from "./student.js";

let currentUser = null;
let currentRole = null; // "admin" | "student" | "none"

async function boot() {
  await initStore();

  // Re-render whenever the data changes (live updates)
  subscribeStore(() => render());

  // Re-render and re-resolve the role whenever auth changes. Subscribe
  // BEFORE initAuth() so a persisted session (demo mode / page reload)
  // isn't missed when it restores the user.
  auth.subscribe(async (user) => {
    currentUser = user;
    currentRole = null;
    if (user) {
      currentRole = await getRole(user.email);
      // Subscribe to exactly the data this role may read (private roster).
      await configureAccess(currentRole, user.email);
      if (currentRole === "student") {
        // keep the student's display name in sync with their Google account
        updateStudentName(user.email, user.name).catch(() => {});
      }
    } else {
      // Signed out — stop role-scoped listeners and drop their cached data.
      await configureAccess(null, null);
    }
    render();
  });

  await auth.initAuth();
  render();
}

function render() {
  if (!currentUser) return renderLogin();
  if (currentRole === "admin") return mountAdminView();
  if (currentRole === "student") return mountStudentView();
  return renderNotRegistered();
}

// ---------------------------------------------------------------------------
// Login screen
// ---------------------------------------------------------------------------
function renderLogin() {
  const app = $("#app");
  app.innerHTML = `
    <div class="login">
      <section class="login__hero">
        <div class="brand">
          <span class="brand__mark" aria-hidden="true"></span>
          <span class="brand__name">ClubBoard</span>
        </div>
        <h1>Pick your club.<br />Own your week.</h1>
        <p class="login__lede">
          Choose at least two clubs for the new term — any mix of CCAs and
          ECAs, no two clubs on the same day, guaranteed.
        </p>
        <ul class="login__points">
          <li><span class="tick"></span>At least two activities, any mix</li>
          <li><span class="tick"></span>Automatic day-clash protection</li>
          <li><span class="tick"></span>Managed by your school admin</li>
        </ul>
        <div class="login__sample">
          <span class="login__sample-label">How it looks</span>
          <div class="sample-card">
            <span class="type-badge type-badge--cca">CCA</span>
            <strong>Basketball</strong>
            <div class="sample-days"><span class="day-chip day-chip--on">Mon</span><span class="day-chip day-chip--on">Wed</span></div>
          </div>
          <div class="sample-card">
            <span class="type-badge type-badge--eca">ECA</span>
            <strong>Chess Club</strong>
            <div class="sample-days"><span class="day-chip day-chip--on">Tue</span></div>
          </div>
          <p class="sample-ok">✓ No day overlap — both fit in your week.</p>
        </div>
      </section>
      <section class="login__panel">
        <div class="login__card">
          <h2>Sign in to continue</h2>
          <p class="login__hint">
            ${
              MODE === "firebase"
                ? "Use the Google account your school gave you."
                : "Demo mode is on — no Firebase connected yet. Try it with a demo account."
            }
          </p>
          ${
            MODE === "firebase"
              ? `<button class="btn btn--primary btn--google" id="btn-google">
                   <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.97 10.97 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84Z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z"/></svg>
                   Continue with Google
                 </button>`
              : `
                 <div class="demo-buttons">
                   <button class="btn btn--primary" id="btn-demo-admin">Preview as Admin</button>
                   <button class="btn btn--outline" id="btn-demo-student">Preview as Student</button>
                 </div>
                 <p class="demo-note">
                   Demo data lives in this browser. To go live, add your
                   Firebase config in <code>js/config.js</code>.
                 </p>`
          }
        </div>
      </section>
    </div>
  `;

  if (MODE === "firebase") {
    $("#btn-google").addEventListener("click", async () => {
      try {
        await auth.loginWithGoogle();
      } catch (err) {
        alert("Sign-in failed: " + err.message);
      }
    });
  } else {
    $("#btn-demo-admin").addEventListener("click", () =>
      auth.demoLogin("admin@demo.school", "Demo Admin")
    );
    $("#btn-demo-student").addEventListener("click", () =>
      auth.demoLogin("alex@demo.school", "Alex Chen")
    );
  }
}

// ---------------------------------------------------------------------------
// Not-registered screen
// ---------------------------------------------------------------------------
function renderNotRegistered() {
  const app = $("#app");
  app.innerHTML = `
    <div class="unauth">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__name">ClubBoard</span>
      </div>
      <div class="unauth__card">
        <div class="unauth__icon" aria-hidden="true">🔒</div>
        <h1>You're not on the list yet</h1>
        <p>
          Your account <strong>${esc(currentUser.email)}</strong> isn't registered
          for club choice. Ask your school admin to add you — it takes them a minute.
        </p>
        <button class="btn btn--outline" id="btn-signout">Sign out</button>
      </div>
    </div>
  `;
  $("#btn-signout").addEventListener("click", () => auth.logout());
}

boot();

// ============================================================================
// ClubBoard — app entry: boot, auth routing, view switching
// ============================================================================
import { MODE, initStore, subscribe as subscribeStore, getRole, updateStudentName, configureAccess } from "./store.js";
import * as auth from "./auth.js";
import {
  isStudentWindowOpen,
  STUDENT_WINDOW_START_MS,
  STUDENT_WINDOW_END_MS,
} from "./access.js";
import { $, esc } from "./ui.js";
import { mountAdminView } from "./admin.js";
import { mountStudentView } from "./student.js";

let currentUser = null;
let currentRole = null; // "admin" | "student" | "none"
let currentWindowState = null; // "open" | "closed" | non-student placeholder

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

  // Flip the student view when the access window opens or closes. The window
  // is a short fixed slot, so a lightweight poll is enough; within ~10s of a
  // boundary the correct view (picker vs "closed") renders. Admins are never
  // affected. The store-level guard in saveChoices is the hard boundary.
  setInterval(() => {
    if (currentRole !== "student") return;
    const open = isStudentWindowOpen();
    const state = open ? "open" : "closed";
    if (state !== currentWindowState) render();
  }, 10000);
}

function render() {
  if (!currentUser) return renderLogin();
  if (currentRole === "admin") {
    currentWindowState = "admin";
    return mountAdminView();
  }
  if (currentRole === "student") {
    const open = isStudentWindowOpen();
    currentWindowState = open ? "open" : "closed";
    return open ? mountStudentView() : renderClosed();
  }
  currentWindowState = "none";
  return renderNotRegistered();
}

// ---------------------------------------------------------------------------
// Login screen
// ---------------------------------------------------------------------------
function renderLogin() {
  const app = $("#app");
  const hasPersistedUser = MODE === "demo" && localStorage.getItem("clubboard_demo_user");
  app.innerHTML = `
    <div class="login">
      <section class="login__hero">
        <div class="brand">
          <span class="brand__mark" aria-hidden="true"></span>
          <span class="brand__name">ClubBoard</span>
        </div>
        <h1>Pick your CCA/ECA<br />Plan your week</h1>
        <ul class="login__points">
          <li><span class="tick"></span>Your account is created already</li>
          <li><span class="tick"></span>Sign in with your school email</li>
          <li><span class="tick"></span>Choose at least 2 activities</li>
        </ul>
      </section>
      <section class="login__panel">
        <div class="login__card">
          <h2>Sign in to continue</h2>
          <p class="login__hint">
            ${
              MODE === "firebase"
                ? "Sign in with your school email."
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
                 ${hasPersistedUser ? `<p class="demo-note">Already signed in? <a href="#" id="btn-clear-session">Clear saved session</a></p>` : ""}
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
    if (hasPersistedUser) {
      $("#btn-clear-session").addEventListener("click", (e) => {
        e.preventDefault();
        localStorage.removeItem("clubboard_demo_user");
        location.reload();
      });
    }
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

// ---------------------------------------------------------------------------
// Student window closed screen
// ---------------------------------------------------------------------------
// Shown to students when the registration window is not open. It covers both
// cases -- before the window opens (with a live countdown) and after it ends.
// Admins never see this; render() routes only the student role here.
function renderClosed() {
  const app = $("#app");
  const opensAt = STUDENT_WINDOW_START_MS;
  const closesAt = STUDENT_WINDOW_END_MS;

  app.innerHTML = `
    <div class="unauth">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__name">ClubBoard</span>
      </div>
      <div class="unauth__card">
        <div class="unauth__icon" aria-hidden="true">🕒</div>
        <h1>Registration is closed right now</h1>
        <p>
          Club choice is available to students only from
          <strong>10:20 to 10:30</strong> (Bangkok time) on
          <strong>August 24</strong>.
        </p>
        <p class="unauth__timer" id="closed-countdown"></p>
        <button class="btn btn--outline" id="btn-signout">Sign out</button>
      </div>
    </div>
  `;

  const update = () => {
    const el = document.getElementById("closed-countdown");
    if (!el) return;
    const nowMs = Date.now();
    if (nowMs >= closesAt) {
      el.textContent = "This registration window has closed.";
      return;
    }
    if (nowMs < opensAt) {
      const diff = opensAt - nowMs;
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = `Opens in ${m}m ${s}s`;
    } else {
      el.textContent = "Registration is open now — refresh to begin.";
    }
  };
  update();
  setInterval(update, 1000);

  $("#btn-signout").addEventListener("click", () => auth.logout());
}

boot();

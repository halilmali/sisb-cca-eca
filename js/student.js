// ============================================================================
// ClubBoard — student dashboard
// ============================================================================
// A student picks at least one CCA and one ECA. The app blocks any selection
// where a chosen CCA and a chosen ECA run on the same day of the week, and
// live-validates capacity and the 1+1 minimum before saving.
// ============================================================================
import {
  getActivities,
  getSeats,
  getStudent,
  saveChoices,
} from "./store.js";
import * as auth from "./auth.js";
import { $, $$, esc, toast, dayChips, weekStrip, fmtDateTime } from "./ui.js";

export function mountStudentView() {
  const app = $("#app");
  const user = auth.getUser();
  const activities = getActivities();
  const me = getStudent(user.email);
  const savedCca = me?.cca || [];
  const savedEca = me?.eca || [];

  // Working selection — starts from the student's saved choices
  const selectedCca = new Set(savedCca);
  const selectedEca = new Set(savedEca);
  
  // Get student's gender for restriction checks
  const studentGender = me?.gender || null;

  const ccaList = activities.filter((a) => a.type === "CCA");
  const ecaList = activities.filter((a) => a.type === "ECA");

  // capacity: live seat counts per activity (from the `seats` collection in
  // firebase mode — reading the whole roster is admin-only for privacy)
  const takeCount = getSeats();

  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__name">ClubBoard</span>
      </div>
      <div class="topbar__user">
        <span class="avatar" ${user.photoURL ? `style="background-image:url('${esc(user.photoURL)}')"` : ""}>${
          user.photoURL ? "" : esc((user.name || user.email)[0]?.toUpperCase() || "?")
        }</span>
        <div class="topbar__who">
          <strong>${esc(user.name || me?.name || user.email)}</strong>
          <small>${esc(me?.className ? `Class ${me.className} · ` : "")}${esc(user.email)}</small>
        </div>
        <button class="btn btn--ghost btn--sm" id="btn-signout">Sign out</button>
      </div>
    </header>

    <main class="shell student-shell">
      <section class="student-head">
        <div>
          <h1>Pick your clubs${me?.name ? `, ${esc(me.name.split(" ")[0])}` : ""} 🎒</h1>
          <p>
            Choose <b>1–2 CCAs</b> and <b>1–2 ECAs</b>.
            You can't pick a CCA and an ECA that run on the same day.
          </p>
        </div>
        <div class="student-head__status">
          ${me?.submittedAt ? `<span class="status-pill status-pill--ok">✓ Saved ${fmtDateTime(me.submittedAt)}</span>` : '<span class="status-pill">Not saved yet</span>'}
        </div>
      </section>

      <section class="week-card" aria-label="Your week at a glance">
        <div class="week-card__head">
          <span class="week-card__title">Your week</span>
          <span class="week-card__legend"><i class="dot dot--cca"></i>CCA <i class="dot dot--eca"></i>ECA</span>
        </div>
        <div id="week-strip"></div>
        <p class="week-card__note" id="week-note">Select clubs below to preview your week.</p>
      </section>

      <div id="validation-banner"></div>

      <div class="pick-cols">
        <section class="pick-col">
          <div class="pick-col__head">
            <span class="type-badge type-badge--cca">CCA</span>
            <h2>Co-curricular <span class="muted">— pick 1 to 2</span></h2>
            <span class="count-pill" id="cca-count">0 chosen</span>
          </div>
          ${renderPickList(ccaList, selectedCca, selectedEca, takeCount, "cca", studentGender)}
        </section>
        <section class="pick-col">
          <div class="pick-col__head">
            <span class="type-badge type-badge--eca">ECA</span>
            <h2>Extra-curricular <span class="muted">— pick 1 to 2</span></h2>
            <span class="count-pill" id="eca-count">0 chosen</span>
          </div>
          ${renderPickList(ecaList, selectedCca, selectedEca, takeCount, "eca", studentGender)}
        </section>
      </div>
    </main>

    <footer class="savebar">
      <div class="savebar__status" id="save-status">…</div>
      <button class="btn btn--primary btn--lg" id="btn-save" disabled>Save choices</button>
    </footer>
  `;

  $("#btn-signout").addEventListener("click", () => auth.logout());

  // ---- selection logic ----
  const refresh = () => {
    const { clashDays, clashNames, ccaCount, ecaCount, full, ccaSameDayClash, ecaSameDayClash, genderViolations } = validate(
      selectedCca,
      selectedEca,
      activities,
      takeCount,
      studentGender
    );

    // week strip
    const chosenDays = new Set();
    [...selectedCca].forEach((id) => activities.find((a) => a.id === id)?.days.forEach((d) => chosenDays.add(d)));
    [...selectedEca].forEach((id) => activities.find((a) => a.id === id)?.days.forEach((d) => chosenDays.add(d)));
    const strip = $("#week-strip");
    if (strip) strip.innerHTML = weekStrip([...chosenDays]);

    // counts
    const ccaEl = $("#cca-count");
    const ecaEl = $("#eca-count");
    if (ccaEl) ccaEl.textContent = `${ccaCount} chosen`;
    if (ecaEl) ecaEl.textContent = `${ecaCount} chosen`;
    ccaEl && ccaEl.classList.toggle("count-pill--ok", ccaCount >= 1);
    ecaEl && ecaEl.classList.toggle("count-pill--ok", ecaCount >= 1);

    // validation banner
    const banner = $("#validation-banner");
    if (banner) {
      if (genderViolations.length) {
        banner.innerHTML = `
          <div class="alert alert--danger" role="alert">
            <strong>Gender restriction!</strong>
            You cannot join ${esc(genderViolations.join(", "))} because ${genderViolations.length > 1 ? "they are" : "it is"} restricted to ${genderViolations.every(v => activities.find(a => a.id === v)?.genderRestriction === "F") ? "girls" : "boys"}.
          </div>`;
      } else if (ccaSameDayClash || ecaSameDayClash) {
        const clashInfo = ccaSameDayClash || ecaSameDayClash;
        banner.innerHTML = `
          <div class="alert alert--danger" role="alert">
            <strong>Same-day conflict!</strong>
            You have selected multiple ${esc(clashInfo.type)}s that run on the same day${clashInfo.clashDays.length > 1 ? "s" : ""} (<b>${esc(clashInfo.clashDays.join(", "))}</b>): ${esc(clashInfo.clashNames)}. Please choose different ones.
          </div>`;
      } else if (clashDays.length) {
        banner.innerHTML = `
          <div class="alert alert--danger" role="alert">
            <strong>Day clash!</strong>
            ${esc(clashNames)} run on the same day${clashDays.length > 1 ? "s" : ""}
            (<b>${esc(clashDays.join(", "))}</b>). Pick a different club for one of them.
          </div>`;
      } else if (full.length) {
        banner.innerHTML = `
          <div class="alert alert--warn" role="alert">
            <strong>Heads up:</strong> ${esc(full.join(", "))} ${full.length > 1 ? "are" : "is"} full.
          </div>`;
      } else if (ccaCount >= 1 && ecaCount >= 1) {
        banner.innerHTML = `
          <div class="alert alert--ok" role="status">✓ Looks good — your clubs don't clash.</div>`;
      } else {
        banner.innerHTML = "";
      }
    }

    // savebar
    const status = $("#save-status");
    const saveBtn = $("#btn-save");
    if (genderViolations.length || ccaSameDayClash || ecaSameDayClash || clashDays.length) {
      status.textContent = "Fix the conflicts to save.";
      saveBtn.disabled = true;
    } else if (ccaCount > 2 || ecaCount > 2) {
      const over = [];
      if (ccaCount > 2) over.push("2 CCAs");
      if (ecaCount > 2) over.push("2 ECAs");
      status.textContent = `You can pick at most ${over.join(" and ")}.`;
      saveBtn.disabled = true;
    } else if (ccaCount < 1 || ecaCount < 1) {
      const missing = [];
      if (ccaCount < 1) missing.push("at least 1 CCA");
      if (ecaCount < 1) missing.push("at least 1 ECA");
      status.textContent = `Pick ${missing.join(" and ")} to save.`;
      saveBtn.disabled = true;
    } else {
      status.textContent = `${ccaCount} CCA · ${ecaCount} ECA — ready to save.`;
      saveBtn.disabled = false;
    }
  };

  // Card click handlers are delegated to the fresh .pick-cols container so
  // they die with it on re-render (no listener accumulation on #app).
  const pickCols = $(".pick-cols", app);
  pickCols.addEventListener("click", (e) => {
    const card = e.target.closest(".pick-card");
    if (!card) return;
    const id = card.dataset.id;
    const type = card.dataset.type;
    if (card.classList.contains("is-full") && !(type === "cca" ? selectedCca : selectedEca).has(id)) return;
    const set = type === "cca" ? selectedCca : selectedEca;
    if (set.has(id)) {
      set.delete(id);
    } else {
      if (set.size >= 2) {
        toast(`You can pick at most 2 ${type === "cca" ? "CCAs" : "ECAs"}.`, "error");
        return;
      }
      set.add(id);
    }
    updateCardStates();
    refresh();
  });

  const updateCardStates = () => {
    $$(".pick-card").forEach((card) => {
      const set = card.dataset.type === "cca" ? selectedCca : selectedEca;
      card.classList.toggle("is-selected", set.has(card.dataset.id));
      // Once 2 of a type are picked, dim the remaining unselected cards so
      // the 1–2 cap is obvious (they still show the toast if clicked).
      card.classList.toggle("is-capped", set.size >= 2 && !set.has(card.dataset.id));
    });
  };

  // save
  $("#btn-save").addEventListener("click", async () => {
    const { clashDays, ccaCount, ecaCount, genderViolations, ccaSameDayClash, ecaSameDayClash } = validate(selectedCca, selectedEca, activities, takeCount, studentGender);
    if (clashDays.length || ccaCount < 1 || ecaCount < 1 || genderViolations.length || ccaSameDayClash || ecaSameDayClash) {
      toast("Can't save — check the conflicts or minimum picks.", "error");
      return;
    }
    try {
      await saveChoices(user.email, [...selectedCca], [...selectedEca]);
      toast("Choices saved! 🎉");
    } catch (err) {
      toast(err.message || "Couldn't save your choices.", "error");
    }
  });

  refresh();
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
function renderPickList(list, selectedCca, selectedEca, takeCount, type, studentGender) {
  if (!list.length) {
    return `
      <div class="empty empty--sm">
        <div class="empty__icon" aria-hidden="true">🫥</div>
        <h3>No ${type === "cca" ? "CCAs" : "ECAs"} yet</h3>
        <p>Check back later — the admin hasn't added any.</p>
      </div>`;
  }

  const set = type === "cca" ? selectedCca : selectedEca;

  return `
    <div class="pick-grid">
      ${list
        .map((a) => {
          const chosen = takeCount.get(a.id) || 0;
          const isSelected = set.has(a.id);
          const full = a.capacity > 0 && chosen >= a.capacity && !isSelected;
          const spotsLeft = a.capacity > 0 ? a.capacity - chosen : null;
          // Check gender restriction
          const genderRestricted = studentGender && a.genderRestriction && a.genderRestriction !== studentGender;
          const isWrongGender = genderRestricted && !isSelected;
          return `
            <button class="pick-card pick-card--${type} ${isSelected ? "is-selected" : ""} ${full ? "is-full" : ""} ${isWrongGender ? "is-gender-restricted" : ""}"
              data-id="${esc(a.id)}" data-type="${type}" type="button"
              ${full || isWrongGender ? "disabled" : ""}>
              <span class="pick-card__check" aria-hidden="true">✓</span>
              <div class="pick-card__top">
                <strong>${esc(a.name)}</strong>
                ${full ? '<span class="full-pill">Full</span>' : ""}
                ${a.genderRestriction ? `<span class="type-badge type-badge--${a.genderRestriction === "F" ? "cca" : "eca"}" style="margin-left:6px;">${a.genderRestriction === "F" ? "Girls" : "Boys"}</span>` : ""}
              </div>
              ${a.description ? `<p class="pick-card__desc">${esc(a.description)}</p>` : ""}
              <div class="day-chips">${dayChips(a.days)}</div>
              <div class="pick-card__meta">
                <span>🕒 ${esc(a.time || "—")}</span>
                <span>📍 ${esc(a.venue || "—")}</span>
              </div>
              <div class="pick-card__spots ${full ? "spots--full" : ""}" style="font-size:1.05em;font-weight:700;">
                ${
                  full
                    ? "Quota full — no spots left"
                    : isWrongGender
                    ? `Not available for your gender`
                    : a.capacity > 0
                    ? `<b style="font-size:1.2em">${spotsLeft}</b> of ${a.capacity} spots left`
                    : "No quota limit"
                }
              </div>
            </button>`;
        })
        .join("")}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Validation — the heart of the day-clash rule
// ---------------------------------------------------------------------------
function validate(selectedCca, selectedEca, activities, takeCount, studentGender) {
  const acts = new Map(activities.map((a) => [a.id, a]));

  const ccaActs = [...selectedCca].map((id) => acts.get(id)).filter(Boolean);
  const ecaActs = [...selectedEca].map((id) => acts.get(id)).filter(Boolean);

  const ccaDays = new Set(ccaActs.flatMap((a) => a.days));
  const ecaDays = new Set(ecaActs.flatMap((a) => a.days));
  const clashDays = [...ccaDays].filter((d) => ecaDays.has(d));

  const clashNames = [
    ...new Set(
      [...ccaActs.filter((a) => a.days.some((d) => clashDays.includes(d))).map((a) => a.name),
      ...ecaActs.filter((a) => a.days.some((d) => clashDays.includes(d))).map((a) => a.name)]
    ),
  ].join(", ");

  // Check for same-day conflicts within CCAs
  const ccaSameDayClash = checkSameTypeClash(ccaActs, "CCA");
  // Check for same-day conflicts within ECAs
  const ecaSameDayClash = checkSameTypeClash(ecaActs, "ECA");
  
  // Check gender restrictions
  const genderViolations = [];
  if (studentGender) {
    [...selectedCca, ...selectedEca].forEach((id) => {
      const a = acts.get(id);
      if (a && a.genderRestriction && a.genderRestriction !== studentGender) {
        genderViolations.push(a.name);
      }
    });
  }

  const full = [];
  [...selectedCca, ...selectedEca].forEach((id) => {
    const a = acts.get(id);
    if (a && a.capacity > 0 && (takeCount.get(id) || 0) >= a.capacity) full.push(a.name);
  });

  return {
    clashDays,
    clashNames,
    ccaCount: ccaActs.length,
    ecaCount: ecaActs.length,
    full,
    ccaSameDayClash,
    ecaSameDayClash,
    genderViolations,
  };
}

/**
 * Check if multiple activities of the same type (CCA or ECA) run on the same day.
 * Returns an object with clash info if found, null otherwise.
 */
function checkSameTypeClash(acts, type) {
  if (acts.length <= 1) return null;
  
  const dayMap = new Map();
  for (const act of acts) {
    for (const day of act.days) {
      if (!dayMap.has(day)) {
        dayMap.set(day, []);
      }
      dayMap.get(day).push(act.name);
    }
  }
  
  const clashDays = [];
  const clashNames = [];
  for (const [day, names] of dayMap.entries()) {
    if (names.length > 1) {
      clashDays.push(day);
      clashNames.push(...names);
    }
  }
  
  if (clashDays.length > 0) {
    return {
      clashDays,
      clashNames: [...new Set(clashNames)].join(", "),
      type,
    };
  }
  
  return null;
}

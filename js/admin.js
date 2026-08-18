// ============================================================================
// ClubBoard — admin dashboard
// ============================================================================
// The admin manages CCA/ECA activities (name, type, days, time, venue,
// capacity) and the student roster (by email). They can also view and reset
// any student's choices.
// ============================================================================
import {
  getActivities,
  getStudents,
  getSeats,
  addActivity,
  updateActivity,
  deleteActivity,
  addStudent,
  deleteStudent,
  clearChoices,
  setStudentChoices,
} from "./store.js";
import * as auth from "./auth.js";
import { $, $$, esc, toast, openModal, closeModal, confirmDialog, dayChips, DAYS, fmtDate, numOrZero, normDay } from "./ui.js";

let activeTab = "activities";
let searchQuery = "";

export function mountAdminView() {
  const app = $("#app");
  const user = auth.getUser();
  const activities = getActivities();
  const students = getStudents();

  const ccaCount = activities.filter((a) => a.type === "CCA").length;
  const ecaCount = activities.filter((a) => a.type === "ECA").length;
  const submitted = students.filter((s) => s.submittedAt).length;

  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__name">ClubBoard</span>
        <span class="brand__role">Admin</span>
      </div>
      <div class="topbar__user">
        <span class="avatar" ${user.photoURL ? `style="background-image:url('${esc(user.photoURL)}')"` : ""}>${
          user.photoURL ? "" : esc((user.name || user.email)[0]?.toUpperCase() || "?")
        }</span>
        <div class="topbar__who">
          <strong>${esc(user.name || user.email)}</strong>
          <small>${esc(user.email)}</small>
        </div>
        <button class="btn btn--ghost btn--sm" id="btn-signout">Sign out</button>
      </div>
    </header>

    <main class="shell">
      <section class="admin-head">
        <div>
          <h1>Club management</h1>
          <p>Add activities and register students. Students pick their CCA &amp; ECA here.</p>
        </div>
        <div class="stat-row">
          <div class="stat"><b>${activities.length}</b><span>activities</span></div>
          <div class="stat"><b>${students.length}</b><span>students</span></div>
          <div class="stat"><b>${submitted}</b><span>submitted</span></div>
        </div>
      </section>

      <nav class="tabs" role="tablist">
        <button class="tab ${activeTab === "activities" ? "is-active" : ""}" data-tab="activities" role="tab">Activities</button>
        <button class="tab ${activeTab === "students" ? "is-active" : ""}" data-tab="students" role="tab">Students</button>
        <button class="tab ${activeTab === "reports" ? "is-active" : ""}" data-tab="reports" role="tab">Reports</button>
      </nav>

      <section class="panel ${activeTab === "activities" ? "" : "is-hidden"}" data-panel="activities">
        <div class="panel__toolbar">
          <h2>Activities <span class="muted">(${ccaCount} CCA · ${ecaCount} ECA)</span></h2>
          <button class="btn btn--secondary" id="btn-bulk-activities">⬆ Bulk upload</button>
          <button class="btn btn--primary" id="btn-add-activity">+ Add activity</button>
        </div>
        ${renderActivityGrid(activities, students)}
      </section>

      <section class="panel ${activeTab === "students" ? "" : "is-hidden"}" data-panel="students">
        <div class="panel__toolbar">
          <h2>Students</h2>
          <div class="toolbar__right">
            <input class="search" id="stu-search" type="search" placeholder="Search name or email…" value="${esc(searchQuery)}">
            <button class="btn btn--primary" id="btn-add-student">+ Add students</button>
          </div>
        </div>
        ${renderStudents(students, activities)}
      </section>

      <section class="panel ${activeTab === "reports" ? "" : "is-hidden"}" data-panel="reports">
        <div class="panel__toolbar">
          <h2>Reports</h2>
        </div>
        ${renderReports(activities, students)}
      </section>
    </main>
  `;

  // tabs
  $$(".tab", app).forEach((tab) =>
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab;
      mountAdminView();
    })
  );

  // Delegated handlers are bound to the freshly rendered shell element so
  // they die with it on re-render (no listener accumulation on #app).
  const shell = $(".shell", app);
  bindActivityActions(shell);
  bindStudentRowActions(shell);

  $("#btn-signout").addEventListener("click", () => auth.logout());
  $("#btn-add-activity").addEventListener("click", () => openActivityModal());
  $("#btn-bulk-activities").addEventListener("click", () => openBulkActivitiesModal());
  const emptyAddActivity = $("#empty-add-activity");
  if (emptyAddActivity) emptyAddActivity.addEventListener("click", () => openActivityModal());
  $("#btn-add-student").addEventListener("click", () => openStudentsModal());
  const emptyAddStudent = $("#empty-add-student");
  if (emptyAddStudent) emptyAddStudent.addEventListener("click", () => openStudentsModal());

  const search = $("#stu-search");
  if (search) {
    search.addEventListener("input", () => {
      searchQuery = search.value.trim().toLowerCase();
      const tbody = $("#stu-tbody");
      if (tbody) tbody.innerHTML = renderStudentRows(filterStudents(students), activities);
    });
  }

  // Bind report actions
  bindReportActions(shell);
}

// ---------------------------------------------------------------------------
// Activities panel
// ---------------------------------------------------------------------------
function renderActivityGrid(activities, students) {
  if (!activities.length) {
    return `
      <div class="empty">
        <div class="empty__icon" aria-hidden="true">🎯</div>
        <h3>No activities yet</h3>
        <p>Add your first CCA or ECA so students have something to choose from.</p>
        <button class="btn btn--primary" id="empty-add-activity">+ Add activity</button>
      </div>
    `;
  }

  const counts = new Map(); // activityId -> students who chose it
  students.forEach((s) => {
    [...(s.cca || []), ...(s.eca || [])].forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
  });

  const cards = activities.map((a) => {
    const chosen = counts.get(a.id) || 0;
    const quota = a.capacity > 0 ? a.capacity : null;
    const full = quota !== null && chosen >= quota;
    const status = quota === null
      ? "No quota"
      : full
      ? "Full"
      : `${Math.max(0, quota - chosen)} spot${quota - chosen === 1 ? "" : "s"} left`;
    const genderBadge = a.genderRestriction
      ? `<span class="type-badge type-badge--${a.genderRestriction === "F" ? "cca" : "eca"}">${a.genderRestriction === "F" ? "Girls only" : "Boys only"}</span>`
      : "";
    return `
      <article class="act-card act-card--${a.type.toLowerCase()}">
        <div class="act-card__top">
          <span class="type-badge type-badge--${a.type.toLowerCase()}" style="display:flex;align-items:center;gap:6px;">
            ${a.type}
            ${a.category === "Athletics" ? '<span style="opacity:0.6">·</span>Athletics' : ""}
            ${genderBadge ? `<span style="opacity:0.6">·</span>${genderBadge}` : ""}
          </span>
          <div class="act-card__actions">
            <button class="icon-btn" data-edit="${esc(a.id)}" aria-label="Edit ${esc(a.name)}">✏️</button>
            <button class="icon-btn icon-btn--danger" data-del="${esc(a.id)}" aria-label="Delete ${esc(a.name)}">🗑</button>
          </div>
        </div>
        <h3>${esc(a.name)}</h3>
        <p class="act-card__desc">${esc(a.description || "No description yet.")}</p>
        <div class="day-chips">${dayChips(a.days)}</div>
        <dl class="act-card__meta">
          <div><dt>Time</dt><dd>${esc(a.time || "—")}</dd></div>
          <div><dt>Venue</dt><dd>${esc(a.venue || "—")}</dd></div>
          <div><dt>Quota</dt><dd>${quota === null ? "Unlimited" : `<b style="font-size:1.05em">${chosen}/${quota} filled</b>`} · <b class="${full ? "quota-full-text" : ""}" style="font-weight:700">${status}</b></dd></div>
        </dl>
      </article>
    `;
  }).join("");

  return `<div class="card-grid">${cards}</div>`;
}

function openActivityModal(activity = null) {
  const editing = Boolean(activity);
  const a = activity || {};
  const bodyHtml = `
    <form id="activity-form">
      <label class="field">
        <span>Name</span>
        <input name="name" required maxlength="60" value="${esc(a.name || "")}" placeholder="e.g. Basketball">
      </label>
      <div class="field">
        <span>Type</span>
        <div class="seg" id="type-seg">
          <button type="button" class="seg__opt ${(a.type || "CCA") === "CCA" ? "is-on" : ""}" data-type="CCA">CCA</button>
          <button type="button" class="seg__opt ${a.type === "ECA" ? "is-on" : ""}" data-type="ECA">ECA</button>
        </div>
      </div>
      <div class="field is-hidden" id="category-field">
        <span>Category <em class="muted">(ECAs only — 2 ECAs must include one Athletics)</em></span>
        <div class="seg" id="category-seg">
          <button type="button" class="seg__opt ${(a.category || "Non-Athletics") === "Athletics" ? "is-on" : ""}" data-category="Athletics">Athletics</button>
          <button type="button" class="seg__opt ${(a.category || "Non-Athletics") !== "Athletics" ? "is-on" : ""}" data-category="Non-Athletics">Non-Athletics</button>
        </div>
      </div>
      <div class="field">
        <span>Days it runs</span>
        <div class="day-picker" id="day-picker">
          ${DAYS.map((d) => `<button type="button" class="day-opt ${(a.days || []).includes(d) ? "is-on" : ""}" data-day="${d}">${d}</button>`).join("")}
        </div>
      </div>
      <div class="field-row">
        <label class="field"><span>Time</span><input name="time" value="${esc(a.time || "")}" placeholder="3:00 PM – 4:30 PM"></label>
        <label class="field"><span>Venue</span><input name="venue" value="${esc(a.venue || "")}" placeholder="Main Gym"></label>
      </div>
      <label class="field">
        <span>Quota <em class="muted">(max students; 0 = unlimited)</em></span>
        <input name="capacity" type="number" min="0" max="500" value="${a.capacity ?? 0}">
      </label>
      <label class="field">
        <span>Gender restriction <em class="muted">(optional; for CCAs/ECAs that are single-gender)</em></span>
        <div class="seg" id="gender-restriction-seg">
          <button type="button" class="seg__opt ${(a.genderRestriction || "") === "" ? "is-on" : ""}" data-gender="">None (co-ed)</button>
          <button type="button" class="seg__opt ${a.genderRestriction === "F" ? "is-on" : ""}" data-gender="F">Girls only (F)</button>
          <button type="button" class="seg__opt ${a.genderRestriction === "M" ? "is-on" : ""}" data-gender="M">Boys only (M)</button>
        </div>
      </label>
      <label class="field">
        <span>Description <em class="muted">(optional)</em></span>
        <textarea name="description" rows="2" maxlength="200" placeholder="Short blurb for students">${esc(a.description || "")}</textarea>
      </label>
    </form>
  `;

  openModal({
    title: editing ? "Edit activity" : "Add activity",
    bodyHtml,
    actions: [
      { label: "Cancel", variant: "ghost" },
      { label: editing ? "Save changes" : "Add activity", variant: "primary", submit: true, form: "activity-form", onClick: () => false },
    ],
    onMount: (overlay) => {
      let type = a.type || "CCA";
      let genderRestriction = a.genderRestriction || "";
      let category = a.category || "Non-Athletics";
      const syncSeg = (opt) => {
        opt.closest(".seg").querySelectorAll(".seg__opt").forEach((o) => o.classList.toggle("is-on", o === opt));
      };
      const categoryField = $("#category-field", overlay);
      const showCategoryField = () => {
        if (categoryField) categoryField.classList.toggle("is-hidden", type !== "ECA");
      };
      showCategoryField();
      $("#type-seg", overlay).addEventListener("click", (e) => {
        const opt = e.target.closest(".seg__opt");
        if (!opt) return;
        type = opt.dataset.type;
        syncSeg(opt);
        showCategoryField();
      });
      $("#gender-restriction-seg", overlay).addEventListener("click", (e) => {
        const opt = e.target.closest(".seg__opt");
        if (!opt) return;
        genderRestriction = opt.dataset.gender;
        syncSeg(opt);
      });
      $("#category-seg", overlay).addEventListener("click", (e) => {
        const opt = e.target.closest(".seg__opt");
        if (!opt) return;
        category = opt.dataset.category;
        syncSeg(opt);
      });
      $$(".day-opt", overlay).forEach((btn) =>
        btn.addEventListener("click", () => btn.classList.toggle("is-on"))
      );
      const form = $("#activity-form", overlay);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const days = $$(".day-opt.is-on", overlay).map((b) => b.dataset.day);
        if (!days.length) {
          toast("Pick at least one day for this activity.", "error");
          return;
        }
        const data = {
          name: fd.get("name").trim(),
          type,
          days,
          time: fd.get("time").trim(),
          venue: fd.get("venue").trim(),
          capacity: numOrZero(fd.get("capacity")),
          genderRestriction: genderRestriction || null,
          description: fd.get("description").trim(),
          category: type === "ECA" ? category : null,
        };
        try {
          if (editing) await updateActivity(a.id, data);
          else await addActivity(data);
          toast(editing ? "Activity updated." : "Activity added.");
          closeModal();
        } catch (err) {
          toast("Couldn't save: " + err.message, "error");
        }
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Bulk activity upload
// ---------------------------------------------------------------------------
function openBulkActivitiesModal() {
  const bodyHtml = `
    <div class="modal__toolbar">
      <button type="button" class="btn btn--secondary btn--sm" id="btn-download-template">⬇ Download template (CSV)</button>
      <label class="btn btn--ghost btn--sm" style="cursor:pointer;">📄 Load from file<input type="file" id="bulk-file" accept=".csv,.txt,text/csv" hidden></label>
    </div>
    <div class="field">
      <span>Spreadsheet paste — columns: name, type (CCA/ECA), days ("Mon,Wed"), time, venue, capacity (0 = unlimited), description (optional), category (Athletics/Non-Athletics — ECAs only), gender (blank/F/M)</span>
      <textarea name="bulk" id="bulk-activities" rows="10" placeholder="Basketball,CCA,&quot;Mon,Wed&quot;,3:00 PM – 4:30 PM,Main Gym,20,Shoot hoops and build teamwork,,&#10;Track &amp; Field,ECA,&quot;Tue,Thu&quot;,3:00 PM – 4:30 PM,Stadium,30,Run fast — all levels welcome,Athletics,"></textarea>
    </div>
    <p class="field__note">Every row adds a new activity. Rows with a name that already exists, or a missing/invalid required field, are skipped and reported.</p>
  `;

  openModal({
    title: "Bulk upload activities",
    bodyHtml,
    actions: [
      { label: "Cancel", variant: "ghost" },
      { label: "Add activities", variant: "primary", submit: true, form: "bulk-activities-form", onClick: () => false },
    ],
    onMount: (overlay) => {
      overlay.querySelector("#btn-download-template").addEventListener("click", downloadActivityTemplate);
      const fileInput = overlay.querySelector("#bulk-file");
      fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          overlay.querySelector("#bulk-activities").value = reader.result;
          toast("File loaded — review it, then submit.");
        };
        reader.readAsText(file);
      });

      const form = document.createElement("form");
      form.id = "bulk-activities-form";
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const rows = parseCsv(overlay.querySelector("#bulk-activities").value);
        if (!rows.length) {
          toast("Paste at least one activity row first.", "error");
          return;
        }
        const existing = new Set(getActivities().map((a) => a.name.toLowerCase()));
        let added = 0;
        let skipped = 0;
        for (const row of rows) {
          const parsed = parseActivityRow(row);
          if (parsed.error) {
            skipped++;
            continue;
          }
          const nameKey = parsed.data.name.toLowerCase();
          if (existing.has(nameKey)) {
            skipped++;
            continue;
          }
          existing.add(nameKey);
          try {
            await addActivity(parsed.data);
            added++;
          } catch (err) {
            skipped++;
          }
        }
        if (added) {
          toast(
            `Added ${added} activit${added === 1 ? "y" : "ies"}.${skipped ? ` ${skipped} row${skipped === 1 ? "" : "s"} skipped (duplicate or invalid).` : ""}`,
            skipped ? "info" : "success"
          );
          closeModal();
        } else {
          toast(`Nothing added — ${skipped} row${skipped === 1 ? "" : "s"} skipped (duplicate or invalid).`, "error");
        }
      });
      overlay.querySelector(".modal__body").appendChild(form);
    },
  });
}

/** Build a template CSV and download it. */
function downloadActivityTemplate() {
  const rows = [
    "name,type,days,time,venue,capacity,description,category,gender",
    'Basketball,CCA,"Mon,Wed",3:00 PM – 4:30 PM,Main Gym,20,Shoot hoops and build teamwork,,',
    'Track & Field,ECA,"Tue,Thu",3:00 PM – 4:30 PM,Stadium,30,Run fast — all levels welcome,Athletics,',
    'Chess Club,ECA,Tue,3:00 PM – 4:00 PM,Library,20,From pawn to grandmaster,Non-Athletics,',
  ];
  const blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "clubboard_activities_template.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast("Template downloaded — fill it in and upload it back.");
}

/** Parse CSV text into rows of fields (handles quoted fields). */
function parseCsv(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
  // Drop a header row if the first cell looks like the template header.
  if (rows.length && (rows[0][0] || "").toLowerCase() === "name") rows.shift();
  return rows;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/** Turn one CSV row into an activity payload, or { error } explaining why not. */
function parseActivityRow(row) {
  const [name, type, days, time, venue, capacity, description, category, gender] = row;
  const fail = (msg) => ({ error: msg });
  if (!name) return fail("row with no name");
  const t = (type || "CCA").trim().toUpperCase();
  if (t !== "CCA" && t !== "ECA") return fail(`"${name}": type must be CCA or ECA`);
  const dayList = (days || "").split(",").map((d) => d.trim()).filter(Boolean);
  if (!dayList.length) return fail(`"${name}": missing days`);
  // Accept short ("Mon") or full ("Monday") names; store the full names.
  const canonicalDays = dayList.map(normDay);
  if (canonicalDays.some((d) => !DAYS.includes(d))) return fail(`"${name}": unknown day`);
  const cap = capacity === undefined || capacity === "" ? 0 : Number(capacity);
  if (Number.isNaN(cap) || cap < 0) return fail(`"${name}": invalid capacity`);
  const cat = (category || "").trim().toLowerCase();
  const g = (gender || "").trim().toUpperCase();
  return {
    data: {
      name: name.trim(),
      type: t,
      days: canonicalDays,
      time: (time || "").trim(),
      venue: (venue || "").trim(),
      capacity: cap,
      description: (description || "").trim(),
      category: t === "ECA" ? (cat === "athletics" ? "Athletics" : "Non-Athletics") : null,
      genderRestriction: g === "F" || g === "M" ? g : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Students panel
// ---------------------------------------------------------------------------
function filterStudents(students) {
  if (!searchQuery) return students;
  return students.filter(
    (s) =>
      (s.name || "").toLowerCase().includes(searchQuery) ||
      (s.email || "").toLowerCase().includes(searchQuery) ||
      (s.className || "").toLowerCase().includes(searchQuery)
  );
}

function renderStudents(students, activities) {
  const rows = renderStudentRows(filterStudents(students), activities);
  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Class</th>
            <th>CCA</th>
            <th>ECA</th>
            <th>Submitted</th>
            <th class="ta-right">Actions</th>
          </tr>
        </thead>
        <tbody id="stu-tbody">${rows}</tbody>
      </table>
    </div>
    ${!filterStudents(students).length ? `
      <div class="empty">
        <div class="empty__icon" aria-hidden="true">🧑‍🎓</div>
        <h3>${students.length ? "No matches" : "No students yet"}</h3>
        <p>${students.length ? "Try a different search." : "Add students by email so they can sign in and pick their clubs."}</p>
        ${students.length ? "" : '<button class="btn btn--primary" id="empty-add-student">+ Add students</button>'}
      </div>` : ""}
  `;
}

function renderStudentRows(students, activities) {
  const nameOf = (id) => activities.find((a) => a.id === id)?.name || "?";
  return students
    .map((s) => {
      const sCca = s.cca || [];
      const sEca = s.eca || [];
      const ccaChips = sCca.length
        ? sCca.map((id) => `<span class="mini-chip mini-chip--cca" title="${esc(nameOf(id))}">${esc(nameOf(id))}</span>`).join("")
        : '<span class="muted">—</span>';
      const ecaChips = sEca.length
        ? sEca.map((id) => `<span class="mini-chip mini-chip--eca" title="${esc(nameOf(id))}">${esc(nameOf(id))}</span>`).join("")
        : '<span class="muted">—</span>';
      const displayName = s.nickname ? `${esc(s.nickname)} (${esc(s.name || "—")})` : esc(s.name || "—");
      return `
        <tr>
          <td>
            <div class="stu-id">
              <span class="avatar avatar--sm">${esc((s.name || s.email)[0]?.toUpperCase() || "?")}</span>
              <div>
                <strong>${displayName}</strong>
                <small>${esc(s.email)}${s.gender ? ` · ${esc(s.gender)}` : ""}</small>
              </div>
            </div>
          </td>
          <td>${esc(s.className || "—")}</td>
          <td>${ccaChips}</td>
          <td>${ecaChips}</td>
          <td>${s.submittedAt ? fmtDate(s.submittedAt) : '<span class="muted">Not yet</span>'}</td>
          <td class="ta-right">
            <button class="btn btn--ghost btn--sm" data-view="${esc(s.email)}">View</button>
            <button class="btn btn--ghost btn--sm" data-editstu="${esc(s.email)}">Edit choices</button>
            <button class="btn btn--ghost btn--sm" data-reset="${esc(s.email)}">Reset</button>
            <button class="btn btn--ghost btn--sm btn--danger-text" data-delstu="${esc(s.email)}">Delete</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function openStudentsModal() {
  const bodyHtml = `
    <form id="students-form">
      <label class="field">
        <span>Student email</span>
        <input name="email" type="email" placeholder="student@school.edu">
      </label>
      <div class="field-row">
        <label class="field"><span>Nickname <em class="muted">(optional)</em></span><input name="nickname" placeholder="e.g. Alex"></label>
        <label class="field"><span>Full name <em class="muted">(optional)</em></span><input name="fullName" placeholder="e.g. Alexander Chen"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Class <em class="muted">(optional)</em></span><input name="className" placeholder="e.g. 7A"></label>
        <label class="field"><span>Gender</span>
          <div class="seg" id="gender-seg">
            <button type="button" class="seg__opt is-on" data-gender="">Not specified</button>
            <button type="button" class="seg__opt" data-gender="M">Male</button>
            <button type="button" class="seg__opt" data-gender="F">Female</button>
          </div>
        </label>
      </div>
      <div class="field">
        <span>Or add many at once via spreadsheet paste — columns: email, nickname, full name, class, gender</span>
        <textarea name="bulk" rows="6" placeholder="alex@school.edu,Alex,Alexander Chen,7A,M&#10;mia@school.edu,Mia,Mia Patel,7B,F"></textarea>
      </div>
      <p class="field__note">Students sign in with Google and are matched by this email. Their name appears automatically.</p>
    </form>
  `;
  openModal({
    title: "Add students",
    bodyHtml,
    actions: [
      { label: "Cancel", variant: "ghost" },
      { label: "Add to roster", variant: "primary", submit: true, form: "students-form", onClick: () => false },
    ],
    onMount: (overlay) => {
      let gender = "";
      $("#gender-seg", overlay).addEventListener("click", (e) => {
        const opt = e.target.closest(".seg__opt");
        if (!opt) return;
        gender = opt.dataset.gender;
        $$(".seg__opt", overlay).forEach((o) => o.classList.toggle("is-on", o === opt));
      });
      const form = $("#students-form", overlay);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const singleEmail = fd.get("email").trim().toLowerCase();
        const singleNickname = fd.get("nickname").trim();
        const singleFullName = fd.get("fullName").trim();
        const singleClass = fd.get("className").trim();
        const bulkText = fd.get("bulk") || "";
        
        const emails = [];
        const nicknames = [];
        const names = [];
        const classes = [];
        const genders = [];
        
        // Parse bulk spreadsheet data
        if (bulkText.trim()) {
          const lines = bulkText.split(/\n/).filter(line => line.trim());
          for (const line of lines) {
            const parts = line.split(/,/).map(p => p.trim()).filter(Boolean);
            if (parts.length >= 1) {
              emails.push(parts[0].toLowerCase());
              nicknames.push(parts[1] || "");
              names.push(parts[2] || "");
              classes.push(parts[3] || "");
              genders.push(parts[4] || "");
            }
          }
        }
        
        // Add single student
        if (singleEmail) {
          emails.unshift(singleEmail);
          nicknames.unshift(singleNickname);
          names.unshift(singleFullName);
          classes.unshift(singleClass);
          genders.unshift(gender);
        }
        
        if (!emails.length) {
          toast("Enter at least one email.", "error");
          return;
        }
        
        let added = 0;
        let skipped = 0;
        for (let i = 0; i < emails.length; i++) {
          const ok = await addStudent(emails[i], names[i] || "", classes[i] || "", nicknames[i] || "", genders[i] || "");
          if (ok) added++;
          else skipped++;
        }
        const msg = `Added ${added} student${added === 1 ? "" : "s"}.`;
        toast(skipped ? `${msg} ${skipped} already on the roster.` : msg, added ? "success" : "info");
        closeModal();
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Row actions (delegated from the table)
// ---------------------------------------------------------------------------
function bindStudentRowActions(container) {
  const onView = (email) => viewStudent(email);
  const onReset = async (email) => {
    const ok = await confirmDialog({
      title: "Reset choices?",
      message: `Clear ${email}'s CCA/ECA choices so they can pick again?`,
      confirmText: "Reset choices",
    });
    if (ok) {
      await clearChoices(email);
      toast("Choices cleared.");
    }
  };
  const onDelete = async (email) => {
    const ok = await confirmDialog({
      title: "Remove student?",
      message: `${email} will be removed from the roster and can no longer sign in.`,
      confirmText: "Remove",
    });
    if (ok) {
      await deleteStudent(email);
      toast("Student removed.");
    }
  };

  container.addEventListener("click", (e) => {
    const viewBtn = e.target.closest("[data-view]");
    const editBtn = e.target.closest("[data-editstu]");
    const resetBtn = e.target.closest("[data-reset]");
    const delBtn = e.target.closest("[data-delstu]");
    if (viewBtn) onView(viewBtn.dataset.view);
    else if (editBtn) openEditChoicesModal(editBtn.dataset.editstu);
    else if (resetBtn) onReset(resetBtn.dataset.reset);
    else if (delBtn) onDelete(delBtn.dataset.delstu);
  });
}

/**
 * Modal for admins to set a student's CCA/ECA choices directly. Mirrors the
 * student's own picker: at least 2 activities in any mix, up to 2 ECAs (one
 * must be Athletics when 2 are picked), full clubs are disabled, and the save
 * keeps seat counters / quotas in sync (see setStudentChoices).
 */
function openEditChoicesModal(email) {
  const s = getStudents().find((x) => x.email === email);
  if (!s) return;
  const activities = getActivities();
  const seats = getSeats();
  const ccaList = activities.filter((a) => a.type === "CCA");
  const ecaList = activities.filter((a) => a.type === "ECA");

  const selectedCca = new Set(s.cca || []);
  const selectedEca = new Set(s.eca || []);

  const renderPicks = (list, set, type) =>
    list
      .map((a) => {
        const taken = seats.get(a.id) || 0;
        const isSelected = set.has(a.id);
        const full = a.capacity > 0 && taken >= a.capacity && !isSelected;
        const capped = type === "eca" && set.size >= 2 && !isSelected;
        return `
          <button type="button" class="admin-pick admin-pick--${type} ${isSelected ? "is-on" : ""} ${full ? "is-full" : ""} ${capped ? "is-capped" : ""}" data-id="${esc(a.id)}" data-type="${type}" ${full ? "disabled" : ""}>
            <span class="admin-pick__name">${esc(a.name)}${a.category === "Athletics" ? ' <span class="cat-pill cat-pill--athletics">Athletics</span>' : ""}</span>
            <span class="admin-pick__days">${a.days.map((d) => `<span>${d}</span>`).join("")}</span>
          </button>`;
      })
      .join("");

  const clashNote = () => {
    const ccaDays = new Set(
      [...selectedCca].map((id) => activities.find((a) => a.id === id)).filter(Boolean).flatMap((a) => a.days)
    );
    const ecaDays = new Set(
      [...selectedEca].map((id) => activities.find((a) => a.id === id)).filter(Boolean).flatMap((a) => a.days)
    );
    const clash = [...ccaDays].filter((d) => ecaDays.has(d));
    return clash.length
      ? `<div class="alert alert--warn">Heads up: a CCA and an ECA both run on <b>${esc(clash.join(", "))}</b> — the student won't be able to save this combination themselves.</div>`
      : "";
  };

  const ecaNote = () => {
    const ecaActs = [...selectedEca].map((id) => activities.find((a) => a.id === id)).filter(Boolean);
    if (selectedEca.size === 2 && !ecaActs.some((a) => (a.category || "").toLowerCase() === "athletics")) {
      return `<div class="alert alert--warn">⚠ Two ECAs picked but neither is <b>Athletics</b> — at least one must be Athletics for the student to save this.</div>`;
    }
    return "";
  };

  const totalNote = () => {
    if (selectedCca.size + selectedEca.size < 2) {
      return `<div class="alert alert--warn">⚠ Pick at least 2 activities in total — any mix of CCAs and ECAs (e.g. 2 ECAs, or 2 CCAs, or 1 of each).</div>`;
    }
    return "";
  };

  const bodyHtml = `
    <p class="modal__message">
      <strong>${esc(s.email)}</strong>${s.className ? ` · Class ${esc(s.className)}` : ""} — set the clubs this student should have (at least 2 activities in any mix; up to 2 ECAs, one of them Athletics if 2; use Reset to clear all choices).
    </p>
    <div class="modal__section">
      <h4>CCA <span class="muted" id="edit-cca-count">${selectedCca.size} chosen</span></h4>
      <div class="admin-pick-grid" id="edit-cca-grid"></div>
    </div>
    <div class="modal__section">
      <h4>ECA <span class="muted" id="edit-eca-count">${selectedEca.size} of 2</span></h4>
      <div class="admin-pick-grid" id="edit-eca-grid"></div>
    </div>
    <div id="edit-clash-note"></div>
    <div id="edit-eca-note"></div>
    <div id="edit-total-note"></div>
  `;

  openModal({
    title: `Edit choices — ${esc(s.name || email)}`,
    bodyHtml,
    actions: [
      { label: "Cancel", variant: "ghost" },
      { label: "Save choices", variant: "primary", submit: true, form: "edit-choices-form", onClick: () => false },
    ],
    onMount: (overlay) => {
      const render = () => {
        const ccaGrid = overlay.querySelector("#edit-cca-grid");
        const ecaGrid = overlay.querySelector("#edit-eca-grid");
        if (ccaGrid) ccaGrid.innerHTML = renderPicks(ccaList, selectedCca, "cca");
        if (ecaGrid) ecaGrid.innerHTML = renderPicks(ecaList, selectedEca, "eca");
        const ccaCount = overlay.querySelector("#edit-cca-count");
        const ecaCount = overlay.querySelector("#edit-eca-count");
        if (ccaCount) ccaCount.textContent = `${selectedCca.size} chosen`;
        if (ecaCount) ecaCount.textContent = `${selectedEca.size} of 2`;
        const note = overlay.querySelector("#edit-clash-note");
        if (note) note.innerHTML = clashNote();
        const ecaNoteEl = overlay.querySelector("#edit-eca-note");
        if (ecaNoteEl) ecaNoteEl.innerHTML = ecaNote();
        const totalNoteEl = overlay.querySelector("#edit-total-note");
        if (totalNoteEl) totalNoteEl.innerHTML = totalNote();
      };

      overlay.addEventListener("click", (e) => {
        const btn = e.target.closest(".admin-pick");
        if (!btn || btn.disabled) return;
        const set = btn.dataset.type === "cca" ? selectedCca : selectedEca;
        const id = btn.dataset.id;
        if (set.has(id)) set.delete(id);
        else if (btn.dataset.type === "eca" && set.size >= 2) {
          toast("At most 2 ECAs per student.", "error");
          return;
        } else set.add(id);
        render();
      });

      const form = document.createElement("form");
      form.id = "edit-choices-form";
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (selectedCca.size + selectedEca.size < 2) {
          toast("Pick at least 2 activities in total (any mix of CCAs and ECAs).", "error");
          return;
        }
        const ecaActs = [...selectedEca].map((id) => activities.find((a) => a.id === id)).filter(Boolean);
        if (selectedEca.size === 2 && !ecaActs.some((a) => (a.category || "").toLowerCase() === "athletics")) {
          toast("One of the 2 ECAs must be an Athletics activity.", "error");
          return;
        }
        try {
          await setStudentChoices(email, [...selectedCca], [...selectedEca]);
          toast("Choices updated.");
          closeModal();
        } catch (err) {
          toast(err.message, "error");
        }
      });
      overlay.querySelector(".modal__body").appendChild(form);
      render();
    },
  });
}

async function viewStudent(email) {
  const students = getStudents();
  const activities = getActivities();
  const s = students.find((x) => x.email === email);
  if (!s) return;

  const act = (id) => activities.find((a) => a.id === id);
  const line = (id, type) => {
    const a = act(id);
    if (!a) return "";
    return `
      <div class="choice-line">
        <span class="type-badge type-badge--${type.toLowerCase()}">${type}</span>
        <div><strong>${esc(a.name)}</strong><small>${esc(a.days.join(", "))} · ${esc(a.time || "—")} · ${esc(a.venue || "—")}</small></div>
      </div>`;
  };

  openModal({
    title: `Choices — ${esc(s.name || email)}`,
    bodyHtml: `
      <p class="modal__message">
        <strong>${esc(s.email)}</strong>${s.className ? ` · Class ${esc(s.className)}` : ""} ·
        submitted ${fmtDate(s.submittedAt)}
      </p>
      ${(s.cca || []).length || (s.eca || []).length ? `
        <div class="modal__section"><h4>CCA</h4>${(s.cca || []).map((id) => line(id, "CCA")).join("") || '<p class="muted">None chosen</p>'}</div>
        <div class="modal__section"><h4>ECA</h4>${(s.eca || []).map((id) => line(id, "ECA")).join("") || '<p class="muted">None chosen</p>'}</div>
      ` : '<p class="muted">This student hasn\'t picked any clubs yet.</p>'}
    `,
    actions: [{ label: "Close", variant: "primary" }],
  });
}

// ---------------------------------------------------------------------------
// Reports panel
// ---------------------------------------------------------------------------
function renderReports(activities, students) {
  const ccaList = activities.filter((a) => a.type === "CCA");
  const ecaList = activities.filter((a) => a.type === "ECA");
  
  // Build per-activity reports
  const activityReport = (actList, type) => {
    if (!actList.length) return `<div class="empty"><p>No ${type} activities defined.</p></div>`;
    
    return actList.map((act) => {
      const enrolled = students.filter((s) => (type === "CCA" ? s.cca : s.eca).includes(act.id));
      return `
        <div class="report-card">
          <h3>${esc(act.name)} <span class="type-badge type-badge--${type.toLowerCase()}">${type}</span></h3>
          <p class="report-meta">${esc(act.days.join(", "))} · ${esc(act.time || "—")} · ${esc(act.venue || "—")}${act.genderRestriction ? ` · ${act.genderRestriction === "F" ? "Girls only" : "Boys only"}` : ""}</p>
          ${enrolled.length > 0 ? `
            <table class="table table--compact">
              <thead><tr><th>Nickname</th><th>Full Name</th><th>Class</th></tr></thead>
              <tbody>
                ${enrolled.map((s) => `
                  <tr>
                    <td>${esc(s.nickname || "—")}</td>
                    <td>${esc(s.name || "—")}</td>
                    <td>${esc(s.className || "—")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
            <p class="report-count"><b>${enrolled.length}</b> of ${act.capacity || "∞"} spots filled</p>
          ` : '<p class="muted">No students enrolled yet.</p>'}
        </div>
      `;
    }).join("");
  };

  // Build per-class report
  const classes = [...new Set(students.map((s) => s.className).filter(Boolean))].sort();
  const classReport = () => {
    if (!classes.length) return `<div class="empty"><p>No students with class information yet.</p></div>`;
    
    return classes.map((cls) => {
      const classStudents = students.filter((s) => s.className === cls);
      const nameOf = (id) => activities.find((a) => a.id === id);
      
      return `
        <div class="report-card">
          <h3>Class ${esc(cls)}</h3>
          <table class="table table--compact">
            <thead><tr><th>Nickname</th><th>Full Name</th><th>CCA + Location</th><th>ECA + Location</th></tr></thead>
            <tbody>
              ${classStudents.map((s) => {
                const ccaNames = (s.cca || []).map((id) => {
                  const a = nameOf(id);
                  return a ? `${esc(a.name)} (${esc(a.venue || "—")})` : "?";
                }).join(", ") || "—";
                const ecaNames = (s.eca || []).map((id) => {
                  const a = nameOf(id);
                  return a ? `${esc(a.name)} (${esc(a.venue || "—")})` : "?";
                }).join(", ") || "—";
                return `
                  <tr>
                    <td>${esc(s.nickname || "—")}</td>
                    <td>${esc(s.name || "—")}</td>
                    <td>${esc(ccaNames)}</td>
                    <td>${esc(ecaNames)}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
          <p class="report-count"><b>${classStudents.length}</b> student${classStudents.length === 1 ? "" : "s"}</p>
        </div>
      `;
    }).join("");
  };

  return `
    <div class="reports-section">
      <h2>Per Activity Reports</h2>
      <div class="report-group">
        <h3>CCA Reports</h3>
        ${activityReport(ccaList, "CCA")}
      </div>
      <div class="report-group">
        <h3>ECA Reports</h3>
        ${activityReport(ecaList, "ECA")}
      </div>
    </div>
    <div class="reports-section">
      <h2>Per Class Reports</h2>
      ${classReport()}
    </div>
    <div class="panel__toolbar" style="margin-top:1rem; gap:0.5rem;">
      <button class="btn btn--primary" id="btn-export-csv">Export All to CSV</button>
      <button class="btn btn--secondary" id="btn-export-xls">Export All to XLS</button>
    </div>
  `;
}

function bindReportActions(container) {
  container.addEventListener("click", async (e) => {
    const exportBtn = e.target.closest("#btn-export-csv");
    const exportXlsBtn = e.target.closest("#btn-export-xls");
    if (exportBtn) {
      await exportAllReportsToCSV();
    } else if (exportXlsBtn) {
      await exportAllReportsToXLS();
    }
  });
}

async function exportAllReportsToCSV() {
  const activities = getActivities();
  const students = getStudents();
  
  let csvContent = "data:text/csv;charset=utf-8,";
  
  // Per-activity reports
  csvContent += "=== PER ACTIVITY REPORTS ===\n\n";
  
  for (const act of activities) {
    const type = act.type;
    const enrolled = students.filter((s) => (type === "CCA" ? s.cca : s.eca).includes(act.id));
    csvContent += `Activity: ${act.name} (${type})\n`;
    csvContent += `Days: ${act.days.join(", ")} | Time: ${act.time || "N/A"} | Venue: ${act.venue || "N/A"}\n`;
    csvContent += `Enrolled: ${enrolled.length} / ${act.capacity || "Unlimited"}\n`;
    csvContent += "Nickname,Full Name,Class\n";
    for (const s of enrolled) {
      csvContent += `"${s.nickname || ""}","${s.name || ""}","${s.className || ""}"\n`;
    }
    csvContent += "\n";
  }
  
  // Per-class reports
  csvContent += "=== PER CLASS REPORTS ===\n\n";
  const classes = [...new Set(students.map((s) => s.className).filter(Boolean))].sort();
  
  for (const cls of classes) {
    const classStudents = students.filter((s) => s.className === cls);
    csvContent += `Class: ${cls}\n`;
    csvContent += "Nickname,Full Name,CCA with Location,ECA with Location\n";
    for (const s of classStudents) {
      const ccaLocs = (s.cca || []).map((id) => {
        const a = activities.find((x) => x.id === id);
        return a ? `${a.name} (${a.venue || "N/A"})` : "?";
      }).join(", ") || "None";
      const ecaLocs = (s.eca || []).map((id) => {
        const a = activities.find((x) => x.id === id);
        return a ? `${a.name} (${a.venue || "N/A"})` : "?";
      }).join(", ") || "None";
      csvContent += `"${s.nickname || ""}","${s.name || ""}","${ccaLocs}","${ecaLocs}"\n`;
    }
    csvContent += "\n";
  }
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `clubboard_report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast("Report exported to CSV.");
}

async function exportAllReportsToXLS() {
  const activities = getActivities();
  const students = getStudents();
  
  // Build HTML table content that Excel can interpret as XLS
  let xlsContent = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" 
          xmlns:x="urn:schemas-microsoft-com:office:excel" 
          xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="UTF-8">
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>ClubBoard Report</x:Name>
              <x:WorksheetOptions>
                <x:DisplayGridlines/>
              </x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <style>
        table { border-collapse: collapse; }
        th, td { border: 1px solid #000; padding: 6px 10px; text-align: left; }
        th { background-color: #f0f0f0; font-weight: bold; }
        h2 { font-size: 16pt; margin-top: 20px; }
        h3 { font-size: 12pt; margin-top: 15px; }
        .section-break { height: 20px; }
      </style>
    </head>
    <body>
  `;
  
  // Per-activity reports
  xlsContent += `<h2>PER ACTIVITY REPORTS</h2>`;
  
  for (const act of activities) {
    const type = act.type;
    const enrolled = students.filter((s) => (type === "CCA" ? s.cca : s.eca).includes(act.id));
    
    xlsContent += `<h3>${act.name} (${type})</h3>`;
    xlsContent += `<p><strong>Days:</strong> ${act.days.join(", ")} | <strong>Time:</strong> ${act.time || "N/A"} | <strong>Venue:</strong> ${act.venue || "N/A"}${act.genderRestriction ? ` | <strong>Gender:</strong> ${act.genderRestriction === "F" ? "Girls only" : "Boys only"}` : ""}</p>`;
    xlsContent += `<p><strong>Enrolled:</strong> ${enrolled.length} / ${act.capacity || "Unlimited"}</p>`;
    
    if (enrolled.length > 0) {
      xlsContent += `<table><thead><tr><th>Nickname</th><th>Full Name</th><th>Class</th></tr></thead><tbody>`;
      for (const s of enrolled) {
        xlsContent += `<tr><td>${s.nickname || ""}</td><td>${s.name || ""}</td><td>${s.className || ""}</td></tr>`;
      }
      xlsContent += `</tbody></table>`;
    } else {
      xlsContent += `<p><em>No students enrolled yet.</em></p>`;
    }
    
    xlsContent += `<div class="section-break"></div>`;
  }
  
  // Per-class reports
  xlsContent += `<h2>PER CLASS REPORTS</h2>`;
  const classes = [...new Set(students.map((s) => s.className).filter(Boolean))].sort();
  
  for (const cls of classes) {
    const classStudents = students.filter((s) => s.className === cls);
    
    xlsContent += `<h3>Class ${cls}</h3>`;
    xlsContent += `<table><thead><tr><th>Nickname</th><th>Full Name</th><th>CCA with Location</th><th>ECA with Location</th></tr></thead><tbody>`;
    
    for (const s of classStudents) {
      const ccaLocs = (s.cca || []).map((id) => {
        const a = activities.find((x) => x.id === id);
        return a ? `${a.name} (${a.venue || "N/A"})` : "?";
      }).join(", ") || "None";
      const ecaLocs = (s.eca || []).map((id) => {
        const a = activities.find((x) => x.id === id);
        return a ? `${a.name} (${a.venue || "N/A"})` : "?";
      }).join(", ") || "None";
      
      xlsContent += `<tr><td>${s.nickname || ""}</td><td>${s.name || ""}</td><td>${ccaLocs}</td><td>${ecaLocs}</td></tr>`;
    }
    
    xlsContent += `</tbody></table>`;
    xlsContent += `<div class="section-break"></div>`;
  }
  
  xlsContent += `</body></html>`;
  
  const blob = new Blob([xlsContent], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `clubboard_report_${new Date().toISOString().slice(0, 10)}.xls`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast("Report exported to XLS.");
}

// The activity grid buttons are bound by event delegation too.
function bindActivityActions(container) {
  container.addEventListener("click", async (e) => {
    const editBtn = e.target.closest("[data-edit]");
    const delBtn = e.target.closest("[data-del]");
    if (editBtn) {
      const a = getActivities().find((x) => x.id === editBtn.dataset.edit);
      if (a) openActivityModal(a);
    } else if (delBtn) {
      const a = getActivities().find((x) => x.id === delBtn.dataset.del);
      if (!a) return;
      const ok = await confirmDialog({
        title: "Delete activity?",
        message: `"${a.name}" will be removed and un-chosen for every student. This can't be undone.`,
        confirmText: "Delete",
      });
      if (ok) {
        await deleteActivity(a.id);
        toast("Activity deleted.");
      }
    }
  });
}

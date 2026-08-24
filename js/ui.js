// ============================================================================
// ClubBoard — UI helpers: toasts, modals, confirms, day chips, small utils
// ============================================================================

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

// Activities may store short ("Mon") or full ("Monday") day names depending
// on when/how they were created. Normalize everything to the full names used
// by DAYS so both formats display and match consistently.
const DAY_ALIAS = {
  Mon: "Monday", "Mon.": "Monday", Monday: "Monday",
  Tue: "Tuesday", Tues: "Tuesday", Tuesday: "Tuesday",
  Wed: "Wednesday", Wednesday: "Wednesday",
  Thu: "Thursday", Thur: "Thursday", Thurs: "Thursday", Thursday: "Thursday",
  Fri: "Friday", Friday: "Friday",
  Sat: "Saturday", Saturday: "Saturday",
  Sun: "Sunday", Sunday: "Sunday",
};

export function normDay(day) {
  const key = String(day ?? "").trim();
  return DAY_ALIAS[key] || key;
}

export function normDays(days) {
  return (days || []).map(normDay);
}

export function $ (selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/** Escape HTML so user/admin content can be injected safely. */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toast(message, type = "success") {
  const root = $("#toast-root");
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast--show"));
  setTimeout(() => {
    el.classList.remove("toast--show");
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
let currentOverlay = null;

/**
 * Open a modal dialog.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.bodyHtml]
 * @param {Array<{label:string, variant?:string, onClick?:Function, submit?:boolean, form?:string}>} [opts.actions]
 * @param {Function} [opts.onMount]   receives the overlay element after insert
 * @param {Function} [opts.onClose]
 */
export function openModal({ title, bodyHtml = "", actions = [], onMount, onClose }) {
  closeModal();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal__head">
        <h2>${esc(title)}</h2>
        <button class="modal__close" type="button" aria-label="Close">&times;</button>
      </header>
      <div class="modal__body">${bodyHtml}</div>
      ${
        actions.length
          ? `<footer class="modal__foot">${actions
              .map(
                (a, i) =>
                  `<button class="btn btn--${a.variant || "primary"} ${
                    a.submit ? "js-modal-submit" : ""
                  }" type="${a.submit ? "submit" : "button"}" ${
                    a.form ? `form="${a.form}"` : ""
                  } data-action="${i}">${esc(a.label)}</button>`
              )
              .join("")}</footer>`
          : ""
      }
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.classList.add("modal-open");
  currentOverlay = overlay;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.querySelector(".modal__close").addEventListener("click", closeModal);
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      return;
    }
    // Pressing Enter inside a text input would implicitly submit the
    // modal's form and close it mid-fill, saving half-finished data.
    // Only an explicit click on the submit button (or Enter on it) saves.
    // Note: textareas are intentionally excluded — Enter there inserts a
    // newline (e.g. the bulk-email field) and never triggers submission.
    if (e.key === "Enter" && e.target instanceof HTMLElement && e.target.matches("input")) {
      e.preventDefault();
    }
  });

  actions.forEach((a, i) => {
    const btn = overlay.querySelector(`[data-action="${i}"]`);
    if (btn) {
      btn.addEventListener("click", () => {
        if (a.onClick) {
          const keepOpen = a.onClick();
          if (keepOpen === false) return;
        }
        closeModal();
      });
    }
  });

  onMount?.(overlay);
  return overlay;

  function closeModal() {
    if (currentOverlay) {
      currentOverlay.remove();
      document.body.classList.remove("modal-open");
      currentOverlay = null;
      onClose?.();
    }
  }
}

export function closeModal() {
  if (currentOverlay) {
    currentOverlay.remove();
    document.body.classList.remove("modal-open");
    currentOverlay = null;
  }
}

/** Promise-based confirmation dialog. */
export function confirmDialog({
  title,
  message,
  confirmText = "Confirm",
  variant = "danger",
}) {
  return new Promise((resolve) => {
    openModal({
      title,
      bodyHtml: `<p class="modal__message">${message}</p>`,
      actions: [
        { label: "Cancel", variant: "ghost", onClick: () => resolve(false) },
        { label: confirmText, variant, onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

// ---------------------------------------------------------------------------
// Day-related render helpers
// ---------------------------------------------------------------------------

/** Render a row of day chips for an activity. */
export function dayChips(days = []) {
  const norm = normDays(days);
  return DAYS.map(
    (d) =>
      `<span class="day-chip ${norm.includes(d) ? "day-chip--on" : ""}">${d}</span>`
  ).join("");
}

/** Render a mini "week strip" for the student header showing chosen days. */
export function weekStrip(activityDays) {
  // activityDays: array of day names chosen (flattened from selections)
  const chosen = new Set(normDays(activityDays));
  return `
    <div class="week-strip" role="img" aria-label="Days your CCA/ECA meet">
      ${DAYS.map(
        (d) =>
          `<span class="week-strip__day ${chosen.has(d) ? "is-on" : ""}">${
            chosen.has(d) ? "●" : ""
          }${d}</span>`
      ).join("")}
    </div>
  `;
}

/** Format a timestamp as a friendly date. */
export function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function fmtDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Parse a FormData value as a number (0 if empty/invalid). */
export function numOrZero(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* Sandesh · snackbars
 *
 * One bar at the bottom of the screen, used instead of the browser's alert / confirm / prompt:
 *   sandesUI.toast("Saved")                                  -> short note, goes away by itself
 *   await sandesUI.confirm("Delete this?", { ok: "Delete", danger: true })  -> true / false
 *   await sandesUI.prompt("Page name", "Page 1", { ok: "Rename" })         -> text / null
 * Enter confirms, Escape cancels. A new snackbar replaces the one on screen (which then
 * counts as cancelled).
 */
(() => {
  "use strict";

  const bar = document.createElement("div");
  bar.className = "snack";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.hidden = true;
  document.body.append(bar);

  let current = null; // { resolve, timer, before }

  function finish(value) {
    if (!current) return;
    const c = current;
    current = null;
    clearTimeout(c.timer);
    bar.classList.remove("in");
    bar.classList.add("out");
    setTimeout(() => { if (!current) { bar.hidden = true; bar.classList.remove("out"); } }, 180);
    document.removeEventListener("keydown", c.onKey, true);
    if (c.before && document.contains(c.before) && c.interactive) c.before.focus({ preventScroll: true });
    c.resolve(value);
  }

  function show({ message, sub, icon, actions = [], input = null, timeout = 0, tone = "" }) {
    if (current) finish(current.cancelValue);
    return new Promise((resolve) => {
      const mk = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
      };
      bar.replaceChildren();
      bar.className = "snack" + (tone ? " " + tone : "");
      const body = mk("div", "snack-body");
      if (icon) body.append(mk("span", "snack-ic", icon));
      const txt = mk("div", "snack-txt");
      txt.append(mk("div", "snack-msg", message));
      if (sub) txt.append(mk("div", "snack-sub", sub));
      body.append(txt);
      bar.append(body);

      let field = null;
      if (input) {
        field = mk("input", "snack-input");
        field.type = "text";
        field.value = input.value || "";
        field.maxLength = input.maxLength || 200;
        field.placeholder = input.placeholder || "";
        bar.append(field);
      }

      const btns = mk("div", "snack-btns");
      const buttons = actions.map((a) => {
        const b = mk("button", "snack-btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : ""), a.label);
        b.type = "button";
        b.onclick = () => finish(typeof a.value === "function" ? a.value(field) : a.value);
        btns.append(b);
        return b;
      });
      if (actions.length) bar.append(btns);

      const cancelValue = input ? null : false;
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(cancelValue); }
        else if (e.key === "Enter" && actions.length && (document.activeElement === field || bar.contains(document.activeElement))) {
          const primary = actions.find((a) => a.primary);
          if (primary && document.activeElement !== buttons[actions.indexOf(actions.find((a) => !a.primary))]) {
            e.preventDefault();
            e.stopPropagation();
            finish(typeof primary.value === "function" ? primary.value(field) : primary.value);
          }
        }
      };
      current = {
        resolve, cancelValue, onKey, interactive: actions.length > 0,
        before: document.activeElement, timer: timeout ? setTimeout(() => finish(undefined), timeout) : 0,
      };
      if (actions.length) document.addEventListener("keydown", onKey, true);

      bar.hidden = false;
      bar.classList.remove("out");
      void bar.offsetWidth;
      bar.classList.add("in");
      if (field) { field.focus(); field.select(); }
      else if (actions.length) {
        const primary = buttons[actions.findIndex((a) => a.primary)];
        (primary || buttons[0]).focus({ preventScroll: true });
      }
    });
  }

  const sandesUI = {
    toast(message, opts = {}) {
      const bad = opts === true || opts.bad;
      show({ message, icon: bad ? "!" : opts.icon || null, tone: bad ? "bad" : "", timeout: opts.timeout || 3200 });
    },
    confirm(message, { ok = "OK", cancel = "Cancel", danger = false, sub = null, icon = null } = {}) {
      return show({
        message, sub, icon: icon || (danger ? "!" : "?"), tone: danger ? "warn" : "",
        actions: [{ label: cancel, value: false }, { label: ok, value: true, primary: true, danger }],
      });
    },
    prompt(message, value = "", { ok = "OK", cancel = "Cancel", placeholder = "", maxLength = 200 } = {}) {
      return show({
        message, input: { value, placeholder, maxLength },
        actions: [{ label: cancel, value: null }, { label: ok, primary: true, value: (f) => (f ? f.value : null) }],
      });
    },
    dismiss() { if (current) finish(current.cancelValue); },
  };

  window.sandesUI = sandesUI;
})();

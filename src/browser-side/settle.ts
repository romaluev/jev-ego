export const SETTLE_FN = `(action) => new Promise((resolve) => {
  const read = () => {
    try { return __JEV_READ_STATE__; } catch { return null; }
  };
  const finishRead = (attempts) => {
    const state = read();
    if (state) { resolve(state); return; }
    if (attempts >= 9) { resolve(null); return; }
    setTimeout(() => finishRead(attempts + 1), 20);
  };
  if (!action) { finishRead(0); return; }
  const field = window.__jevFast && window.__jevFast.nodes.get(action.node);
  const autocomplete = action.kind === "fill" && field && field.getAttribute("role") === "combobox";
  let frames = 0;
  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    finishRead(0);
  };
  setTimeout(finish, autocomplete ? 200 : 50);
  const ready = () => {
    if (stopped) return;
    const ids = ((field && (field.getAttribute("aria-controls") || field.getAttribute("aria-owns"))) || "")
      .split(/\\s+/).filter(Boolean);
    const roots = ids.length ? ids.map((id) => document.getElementById(id)).filter(Boolean) : [document];
    const options = roots.flatMap((root) => Array.from(root.querySelectorAll('[role="option"]')));
    if (++frames >= 2 && (!autocomplete || options.some((e) => {
      const r = e.getBoundingClientRect();
      return r.width && r.height && r.bottom > 0 && r.top < innerHeight &&
        e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }))) finish();
    else requestAnimationFrame(ready);
  };
  requestAnimationFrame(ready);
})`;

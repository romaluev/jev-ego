export const GUARD_FN = `(payload) => {
  const action = payload.action;
  const expected = payload.expected;
  const cache = window.__jevFast;
  if (!cache) return { status: "stale" };
  const isFresh = () => {
    if (action.kind === "click" || action.kind === "select") {
      if (typeof action.node !== "number") return false;
      const current = [cache.pageKey(), cache.guard(cache.nodes.get(action.node))];
      return JSON.stringify(current) === JSON.stringify([expected.pageKey, expected.guards[String(action.node)]]);
    }
    let state;
    try { state = __JEV_READ_STATE__; } catch { return false; }
    return JSON.stringify(state && state.marker) === JSON.stringify(expected.marker);
  };
  if (!isFresh()) return { status: "stale" };
  if (action.kind === "wait") return { status: "ok" };
  if (action.kind === "scroll") {
    window.scrollBy(0, action.delta || 0);
    return { status: "ok" };
  }
  if (typeof action.node !== "number") return { status: "stale" };
  const e = cache.nodes.get(action.node);
  if (!e || !e.isConnected || e.matches(":disabled") || e.closest('[aria-disabled="true"],[inert]') ||
      !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
    return { status: "blocked" };
  }
  if (action.kind === "fill" && (e.readOnly || e.getAttribute("aria-readonly") === "true")) {
    return { status: "blocked" };
  }
  const r = e.getBoundingClientRect();
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  if (!r.width || !r.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
    return { status: "blocked" };
  }
  if (!e.contains(document.elementFromPoint(x, y))) return { status: "blocked" };
  if (action.kind === "select") {
    if (e.tagName !== "SELECT" || !Array.from(e.options).some((o) => o.value === action.value &&
        !o.disabled && !o.closest("optgroup[disabled]"))) {
      return { status: "blocked" };
    }
    e.value = action.value;
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
    return { status: "ok", x, y, selected: true };
  }
  const down = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  };
  e.focus({ preventScroll: true });
  e.dispatchEvent(new PointerEvent("pointerdown", down));
  e.dispatchEvent(new MouseEvent("mousedown", down));
  const up = { ...down, buttons: 0 };
  e.dispatchEvent(new PointerEvent("pointerup", up));
  e.dispatchEvent(new MouseEvent("mouseup", up));
  e.dispatchEvent(new MouseEvent("click", up));
  return { status: "ok", x, y };
}`;

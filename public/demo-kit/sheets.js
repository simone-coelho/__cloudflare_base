// public/demo-kit/sheets.js: the sheet mechanics, one sheet at a time.
//
// A sheet is the side drawer a demo opens for a quick look, a plan's starter or
// perk, or a compare of storage and camera. The vertical renders what is in it
// (its renderers); the kit owns the drawer: one sheet at a time (opening one
// replaces what was in it), closed by its own button, by the dim ground beside
// it, or by Escape (the director's keyboard), never while a beat is running.
// When a sheet closes, the vertical may react (config.sheetClosed(was)): on a
// phone page Vantage asks again, as the SDK refreshes after an acknowledged
// interaction. A navigation dismisses it with no reaction, since the page
// under it is replaced.
//
// createSheets(kit) reads config.view() (where the sheet was opened from) and config.sheetClosed(was).
// The markup is the page's: #sheetBack (the dim ground), #sheetBody, #sheetClose.
// No DOM or window access at import time.

export function createSheets(k) {
  const cfg = k.config, state = k.state;
  const el = k.els(['sheetBack', 'sheetBody', 'sheetClose']);

  function open(kind, html) {
    state.sheet = { kind, from: cfg.view ? cfg.view() : null };
    el.sheetBody.innerHTML = html;
    el.sheetBack.hidden = false;
  }
  /** Closed by a hand or a beat: the vertical may react to where it was opened from. */
  async function close() {
    if (el.sheetBack.hidden) return;
    const was = state.sheet;
    el.sheetBack.hidden = true;
    state.sheet = null;
    if (cfg.sheetClosed) await cfg.sheetClosed(was);
  }
  /** Put away by a navigation: the page under it is replaced, so nothing reacts. */
  function dismiss() { if (state.sheet) { el.sheetBack.hidden = true; state.sheet = null; } }
  const isOpen = () => Boolean(el.sheetBack && !el.sheetBack.hidden);

  el.sheetBack.addEventListener('click', (e) => { if (e.target === el.sheetBack && !state.busy) void close(); });
  el.sheetClose.addEventListener('click', () => { if (!state.busy) void close(); });
  return { open, close, dismiss, isOpen };
}

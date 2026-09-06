// public/console/views-explore.js
// ---------------------------------------------------------------------------
// The last two screens that lived only on /learning.html, both against routes
// that page on the SERVER (doc 28 §4), so neither reads a whole snapshot.
//
//   EXPLORING   GET /v1/:tenant/learn/exploring?slot=&brand=&limit=&cursor=
//               The pieces under the slot's observation floor, least observed
//               first: what the engine has not seen enough of to judge.
//
//   WHY         GET /v1/:tenant/visitors/:id/receipts?limit=&cursor=
//               What one shopper was served and the sentences that say why.
//               Authenticated, and an erased shopper answers 410, which is a
//               thing to SAY rather than an error to show.
// ---------------------------------------------------------------------------
(() => {
  const C = window.Console;
  const { h, fmt, dec, when } = C;
  const S = C.state;
  const card = (title, why, ...body) => h('section', { class: 'card' },
    title ? h('h2', {}, title) : null, why ? h('div', { class: 'why' }, why) : null, ...body);
  const needSlot = () => h('div', { class: 'empty' }, 'Choose a slot in the rail on the left.');

  // ══════════════════════════════════════════════════════ Exploring ══════════
  const ex = { st: C.pageState(), meta: null };

  async function loadExploring(cursor) {
    const st = ex.st;
    if (!S.slot) { st.data = null; return; }
    st.loading = true; C.render();
    const res = await C.v1('/learn/exploring', { slot: S.slot, limit: 50, cursor: cursor || undefined });
    st.loading = false;
    if (res.status === 409) { st.cursors = [null]; st.at = 0; return loadExploring(null); }
    if (!res.ok || res.data.ok === false) {
      st.error = res.status === 401 || res.status === 403
        ? 'Sign in at the top right to see what is exploring.'
        : res.data.error || 'Could not read the exploring list.';
      st.data = null; C.render(); return;
    }
    st.error = ''; st.data = res.data; ex.meta = res.data; C.render();
  }

  C.view({
    id: 'exploring', group: 'This slot', title: 'What is exploring', heading: 'What it has not seen enough of',
    hint: 'A piece under the slot’s observation floor has too little evidence to be judged. Exploration is how it gets some: the slot spends a share of its impressions on these rather than always serving what already looks best.',
    async enter() { ex.st = C.pageState(); await loadExploring(null); },
    render(host) {
      if (!S.slot) { host.append(needSlot()); return; }
      if (ex.st.error) { host.append(h('div', { class: 'msg note' }, ex.st.error)); return; }
      const m = ex.meta || {};
      const d = ex.st.data;

      const words = m.mode === 'off' || !m.mode
        ? 'Exploration is off on this slot, so nothing here will gain evidence except by being served on merit.'
        : `Exploring by ${m.mode}, ${Math.round((m.share || 0) * 100)}% of this slot’s impressions, until a piece reaches ${fmt(m.floor || 0)} observations.`;
      host.append(h('div', { class: 'sub', style: 'margin-bottom:10px' },
        m.published === false ? 'No snapshot published for this slot yet, so nothing has been observed.' : words));

      if (!d) { host.append(h('div', { class: 'empty' }, ex.st.loading ? 'Reading…' : 'Nothing to show yet.')); return; }
      if (!d.rows || !d.rows.length) {
        host.append(card(null, null, h('div', { class: 'empty' },
          `Nothing is under the floor. Every piece in this slot has at least ${fmt(m.floor || 0)} observations, so the engine is judging them all on evidence.`)));
        return;
      }
      const rows = d.rows.map((r) => h('tr', {},
        h('td', {}, h('div', { class: 'itemname' }, r.title || r.item), h('div', { class: 'itemid' }, r.customer_item_id || r.item)),
        h('td', { class: 'num' }, dec(r.n, 1)),
        h('td', { class: 'num' }, dec(r.to_floor, 1)),
      ));
      host.append(card(null, null,
        C.table([
          { key: 'piece', label: 'Piece' },
          { key: 'n', label: 'Observed', sym: 'n', num: true, title: 'Decayed observations at the pooled level' },
          { key: 'to', label: 'Short of the floor', num: true, title: 'How many more observations before the engine will judge it' },
        ], rows),
        C.pager(ex.st, 'piece', loadExploring)));
    },
  });

  // ═══════════════════════════════════════════════════════════ Why ═══════════
  const rc = { st: C.pageState(), id: '', erased: false, asked: '' };

  async function loadReceipts(cursor) {
    const st = rc.st;
    const id = (S.params.visitor || '').trim();
    if (!id) { st.data = null; return; }
    st.loading = true; rc.erased = false; C.render();
    const res = await C.v1(`/visitors/${encodeURIComponent(id)}/receipts`, { limit: 50, cursor: cursor || undefined });
    st.loading = false;
    rc.asked = id;
    if (res.status === 410) {
      // Not an error. The shopper asked to be forgotten and the platform did.
      rc.erased = true; st.data = null; st.error = ''; C.render(); return;
    }
    if (!res.ok || res.data.ok === false) {
      st.error = res.status === 401 || res.status === 403
        ? 'Sign in at the top right to look up a shopper.'
        : res.status === 404 ? 'No shopper by that id.'
          : res.data.error || 'Could not read the receipts.';
      st.data = null; C.render(); return;
    }
    st.error = ''; st.data = { ...res.data, rows: res.data.receipts || [] }; C.render();
  }

  C.view({
    id: 'why', group: 'This brand', title: 'Why a shopper saw this', heading: 'What one shopper was served, and why',
    hint: 'Her own record, newest first, with one sentence per reason in the order the engine applied them. This is the answer to “why did she see that”, and it is the platform’s own account rather than a reconstruction.',
    async enter() { rc.st = C.pageState(); if ((S.params.visitor || '').trim()) await loadReceipts(null); },
    render(host) {
      const box = h('input', { class: 'small', style: 'width:320px', placeholder: 'A visitor id, or a shopper id beginning sh_', value: rc.id || S.params.visitor || '', 'data-focus-key': 'visitor-id' });
      const look = () => { rc.id = box.value.trim(); C.go('why', { visitor: rc.id || undefined }); };
      host.append(card(null, 'A visitor id is what the browser carries; a shopper id is the person behind however many browsers.',
        h('div', { class: 'body' }, h('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); look(); } },
          h('label', {}, 'Shopper'), box, h('button', { class: 'small', type: 'submit' }, 'Look her up')))));

      if (!(S.params.visitor || '').trim()) {
        host.append(h('div', { class: 'empty' }, 'Enter a shopper’s id above. Erasures and the work queue both link straight here.'));
        return;
      }
      if (rc.erased) {
        host.append(h('div', { class: 'msg note' },
          `${rc.asked} asked to be forgotten, and was. Nothing is kept about her, so there is nothing to show. The erasure itself is on the Erasures screen.`));
        return;
      }
      if (rc.st.error) { host.append(h('div', { class: 'msg note' }, rc.st.error)); return; }
      const d = rc.st.data;
      if (!d) { host.append(h('div', { class: 'empty' }, rc.st.loading ? 'Reading her record…' : 'Nothing yet.')); return; }
      if (!d.rows.length) {
        host.append(h('div', { class: 'empty' }, 'Nothing served to her yet, or her record has rolled over. The ring keeps the most recent decisions, not all of them.'));
        return;
      }
      for (const r of d.rows) {
        host.append(card(null, null, h('div', { class: 'body' },
          h('div', { class: 'kv' },
            h('span', { class: 'k' }, 'Served'), h('span', { class: 'v' }, `${r.title || r.item} · position ${fmt(r.position + 1)} in ${r.slot} on ${r.page}`),
            h('span', { class: 'k' }, 'When'), h('span', { class: 'v' }, when(r.at)),
            h('span', { class: 'k' }, 'Her context'), h('span', { class: 'v' }, r.context || 'nothing known yet'),
            h('span', { class: 'k' }, 'Arm'), h('span', { class: 'v' }, `${r.arm}${r.explored ? ', and this one was an exploration' : ''}${r.authority ? ` · ${r.authority}` : ''}`),
            h('span', { class: 'k' }, 'Score'), h('span', { class: 'v' }, `${dec(r.score_final)} final, from ${dec(r.score_base)} base`),
          ),
          h('div', { class: 'why', style: 'margin-top:8px' }, 'Why she saw it'),
          h('ul', {}, ...(r.why || []).map((w) => h('li', {}, w))),
        )));
      }
      host.append(C.pager(rc.st, 'decision', loadReceipts));
    },
  });
})();

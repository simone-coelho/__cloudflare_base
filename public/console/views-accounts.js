// public/console/views-accounts.js
// ---------------------------------------------------------------------------
// ACCOUNTS. Who may sign in here, and what has been done to those accounts.
//
// This is the last screen that lived only on /learning.html. It is an admin's
// screen: an operator signing in sees why it is empty rather than a refusal,
// because "you are not an admin" is an answer and a 403 is not.
//
// Nothing here is invented. It is the old page's Accounts section, on the
// application's own rail, against the same routes (doc 30): GET /auth/users,
// GET /auth/audit, POST /auth/users, POST /auth/users/:id/reset,
// PATCH /auth/users/:id, DELETE /auth/users/:id.
//
// THE ONE THING TO BE CAREFUL WITH. A temporary password is shown ONCE, and the
// platform keeps only its hash. If it is lost, the account is reset, not
// recovered. It is therefore rendered as text in its own message and never
// written to a log, a URL or a document title.
// ---------------------------------------------------------------------------
(() => {
  const C = window.Console;
  const { h, when } = C;
  const S = C.state;
  const card = (title, why, ...body) => h('section', { class: 'card' },
    title ? h('h2', {}, title) : null, why ? h('div', { class: 'why' }, why) : null, ...body);

  const isAdmin = () => Boolean(window.OperatorSession && OperatorSession.isAdmin && OperatorSession.isAdmin());
  const me = () => (window.OperatorSession && OperatorSession.user && OperatorSession.user()) || {};

  const ac = { users: undefined, audit: undefined, note: '', error: '', busy: '' };

  const ACTION_WORDS = {
    sign_in: 'signed in', sign_in_failed: 'failed to sign in',
    sign_in_locked: 'was locked out for ten minutes', sign_out: 'signed out',
    password_changed: 'changed the password of', account_created: 'created the account',
    account_reset: 'reset the password of', account_disabled: 'disabled',
    account_enabled: 'enabled', account_changed: 'changed', account_removed: 'removed',
    account_migrated: 'moved to the accounts database',
  };

  async function load() {
    if (!isAdmin()) { ac.users = null; ac.audit = null; return; }
    const [users, audit] = await Promise.all([C.call('/auth/users'), C.call('/auth/audit?limit=30')]);
    // undefined means not loaded, null means the read failed, [] means empty.
    ac.users = users.ok ? users.data.users || [] : null;
    ac.audit = audit.ok ? audit.data.entries || [] : null;
    ac.error = users.ok ? '' : (users.data.error || 'Could not read the accounts.');
  }

  /** Any write, then a reload, so the table never shows a state the platform does not hold. */
  async function act(label, run) {
    ac.busy = label; ac.error = ''; C.render();
    try {
      await run();
    } catch (err) {
      ac.error = `${label} did not go through. ${err && err.message ? err.message : ''}`.trim();
    }
    ac.busy = '';
    await load();
    C.render();
  }
  async function send(method, path, body) {
    const r = await C.call(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!r.ok) throw new Error(r.data.error || `The platform answered ${r.status}.`);
    return r.data;
  }

  const handover = (email, temporary) =>
    `Temporary password for ${email}: ${temporary}  ·  Give it to them in person. It is shown once and the platform keeps only its hash, so a lost one is reset, never recovered. They choose their own at their first sign-in.`;

  C.view({
    id: 'accounts', group: 'This platform', title: 'Accounts', heading: 'Who may sign in here',
    hint: 'A new account gets a temporary password, shown to you once. Resetting hands over a new one and ends that person’s sessions. Disabling keeps the account and refuses the sign-in.',
    async enter() { await load(); },
    render(host) {
      if (!C.canEdit()) {
        host.append(h('div', { class: 'msg note' }, 'Sign in at the top right to see the accounts.'));
        return;
      }
      if (!isAdmin()) {
        host.append(h('div', { class: 'msg note' },
          `You are signed in as ${me().email || 'an operator'}, which is an operator account. Accounts are managed by an admin. Everything else in this console is yours to use; ask an admin for a change here.`));
        return;
      }
      if (ac.note) host.append(h('div', { class: 'msg ok' }, ac.note));
      if (ac.error) host.append(h('div', { class: 'msg err' }, ac.error));

      // ── Add one ────────────────────────────────────────────────────────────
      const email = h('input', { class: 'small', type: 'email', required: true, placeholder: 'name@brand.com', style: 'width:240px', 'data-focus-key': 'acct-email' });
      const name = h('input', { class: 'small', type: 'text', required: true, minlength: 2, placeholder: 'Their name', style: 'width:180px', 'data-focus-key': 'acct-name' });
      const role = h('select', {}, h('option', { value: 'operator' }, 'operator'), h('option', { value: 'admin' }, 'admin'));
      const add = h('button', { class: 'small', type: 'submit', disabled: Boolean(ac.busy) }, ac.busy === 'Add' ? 'Adding…' : 'Add account');
      const form = h('form', { class: 'toolbar', autocomplete: 'off', onsubmit: (e) => {
        e.preventDefault();
        const e1 = email.value.trim(), n1 = name.value.trim(), r1 = role.value;
        if (!e1 || n1.length < 2) { ac.error = 'An account needs an email and a name.'; C.render(); return; }
        act('Add', async () => {
          const d = await send('POST', '/auth/users', { email: e1, name: n1, roles: [r1] });
          ac.note = handover(d.user ? d.user.email : e1, d.temporaryPassword);
        });
      } },
        h('label', {}, 'Email'), email, h('label', {}, 'Name'), name, h('label', {}, 'Role'), role, add);
      host.append(card('Add an account', 'They sign in with a temporary password and choose their own before anything else.', h('div', { class: 'body' }, form)));

      // ── The accounts ───────────────────────────────────────────────────────
      const mine = me();
      const rows = (ac.users || []).map((a) => {
        const self = a.id === mine.id;
        const state = a.disabled ? 'disabled' : a.mustChangePassword ? 'temporary password, not yet changed' : 'active';
        return h('tr', {},
          h('td', {}, h('div', { class: 'itemname' }, a.email), h('div', { class: 'itemid' }, a.name)),
          h('td', {}, (a.roles || []).join(', ')),
          h('td', {}, state),
          h('td', {}, a.lastSignInAt ? when(a.lastSignInAt) : 'never'),
          h('td', {},
            h('button', { class: 'small', disabled: Boolean(ac.busy), title: 'A new temporary password, shown once; ends their sessions', onclick: () => act('Reset', async () => {
              const d = await send('POST', `/auth/users/${encodeURIComponent(a.id)}/reset`);
              ac.note = handover(a.email, d.temporaryPassword);
            }) }, 'Reset password'), ' ',
            self ? null : h('button', { class: 'small', disabled: Boolean(ac.busy), onclick: () => act(a.disabled ? 'Enable' : 'Disable', async () => {
              await send('PATCH', `/auth/users/${encodeURIComponent(a.id)}`, { disabled: !a.disabled });
              ac.note = '';
            }) }, a.disabled ? 'Enable' : 'Disable'), ' ',
            // Removal is the one irreversible action here, so it asks first and
            // the person signed in can never remove themselves by accident.
            self ? h('span', { class: 'sub' }, 'this is you') : h('button', { class: 'small warn', disabled: Boolean(ac.busy), onclick: () => {
              if (!window.confirm(`Remove the account ${a.email}? This cannot be undone.`)) return;
              act('Remove', async () => { await send('DELETE', `/auth/users/${encodeURIComponent(a.id)}`); ac.note = ''; });
            } }, 'Remove'),
          ),
        );
      });
      host.append(card(null, null,
        ac.users === undefined ? h('div', { class: 'empty' }, 'Reading the accounts…')
          : ac.users === null ? h('div', { class: 'msg err' }, 'The accounts could not be read.')
            : rows.length ? C.table([
              { key: 'account', label: 'Account' }, { key: 'role', label: 'Role' },
              { key: 'state', label: 'State' }, { key: 'last', label: 'Last sign-in' },
              { key: 'do', label: '' },
            ], rows) : h('div', { class: 'empty' }, 'No accounts yet.')));

      // ── What has been done ─────────────────────────────────────────────────
      const audit = (ac.audit || []).map((e) => h('tr', {},
        h('td', {}, when(e.at)),
        h('td', {}, e.actorEmail || (String(e.action).startsWith('sign_in') ? e.targetEmail || '' : 'the platform')),
        h('td', {}, ACTION_WORDS[e.action] || e.action),
        h('td', {}, e.action === 'sign_in' || e.action === 'sign_out' ? '' : (e.targetEmail || '')),
      ));
      host.append(card('Recent activity',
        'Who did what to which account, newest first: sign-ins and failed sign-ins, lockouts, passwords changed, accounts created, reset, disabled, enabled and removed. Kept, and read from the platform’s own record.',
        ac.audit === undefined ? h('div', { class: 'empty' }, 'Reading the activity…')
          : ac.audit === null ? h('div', { class: 'msg err' }, 'The activity could not be read.')
            : audit.length ? C.table([
              { key: 'when', label: 'When' }, { key: 'who', label: 'Who' },
              { key: 'what', label: 'Did what' }, { key: 'acct', label: 'Account' },
            ], audit) : h('div', { class: 'empty' }, 'Nothing yet.')));
    },
  });
})();

# 30 · Operator credentials: where they live, and how a person gets theirs

Written 2026-09-05 after Simone's question, "where exactly are these credentials being stored?", and the
instruction that the handover of a first password may not be what a customer wants. Internal. This is the
note that says what is built, what is not, and the decision a customer will make for us.

## 1 · Where everything lives

| What | Where | Shape | Lifetime |
|---|---|---|---|
| An account | D1, the environment's database (staging: `coach-demo-db-staging`; production: its own), table `operator_accounts` (original migration0010; forward0013 adds auth_mode and nullable password). *Moved from KV the same day after Simone's review: KV had no backup, no restore, no record of who changed a key, and eventual consistency.* | One row: `id`, `email` (unique), `name`, `roles` (`operator`, `admin`), `permissions`, `password_hash` (absent in oidc mode), `auth_mode` (password/dual/oidc), `must_change_password`, `disabled`, `created_at`, `updated_at`, `last_sign_in_at` | Until an admin removes it; thirty days of point-in-time restore behind that |
| The password | inside the record, as `password_hash` | PBKDF2 with SHA-256, 100,000 rounds, a random 16-byte salt, base64url: `pbkdf2$100000$<salt>$<hash>`. Nothing in the platform can turn it back into the password | Until changed |
| A record provisioning wrote to KV before the move | KV, `user:<email>`, with `password` in the clear | Verified once at its owner's next sign-in, written to D1 as a hash in the same request, and the KV keys deleted; the audit records the move | Until that sign-in |
| A session's refresh token | D1, table `operator_sessions` | one row per session: the token's random id, the account, the SHA-256 of the token (never the token), created and expiry times | Password sessions: seven days; OIDC additionally bounded by provider token/auth_time and explicit configured lifetime; original expiry never renews |
| Who did what | D1, table `operator_audit` | sign-ins and failed sign-ins, lockouts, sign-outs, passwords changed, accounts created, reset, disabled, enabled, changed, removed, moved; the actor, the account, the time, a detail. Read by an admin at `GET /auth/audit` and in the console's Accounts section | Kept |
| Sign-in admission | Fixed bounded stamp/source authority |100 requests per stamp and10 per source per60s before credentials/stores; historical email-lockout audit remains history | Original fixed window |
| An access token | nowhere | A JWT signed with `JWT_SECRET` (a worker secret), HS256, fifteen minutes; bound to a live `sub`/`sid` and immutable method/provenance; current account and selected membership remain authoritative | Fifteen minutes |
| In the browser | the page's `localStorage` under `operator-session` (and a mirror of the access token in `sessionStorage` under `tuning-token` for the tuning page) | the two tokens, the expiry, the person's name and roles | Until sign-out, or seven days without renewal |

One thing a security team will ask about. The account records are per environment, so staging and
production never share one, and D1 is encrypted at rest by Cloudflare. Tokens in `localStorage`
are readable by any script running on the console's origin; the stricter option, an `HttpOnly` cookie the
page cannot read, is a contained change to the session module and the auth routes and is listed in §4.

## 2 · How a person gets their first password today (built)

An admin creates the account in the console's Accounts section. The platform generates a sixteen-character
temporary password, shows it to the admin once, and stores only its hash. The admin hands it to the person,
in person or over whatever channel their company allows. The person signs in with it and is stopped by
"You signed in with a temporary password. Choose your own to continue." until they set one. Reset works the
same way: a new temporary password, shown once, the person's sessions ended.

This needs no email service and no third party, which is why it exists first. It is how many internal
tools work. It is not how every customer will want to work.

## 3 · The two other ways a customer may want, and what each needs

**Invitation and reset by email.** The admin enters an email and the person receives a link; "Forgot your
password?" on the sign-in form sends one too. What it needs from us: a single-use token per invitation or
reset (stored like a refresh token, 48 hours), two routes (`POST /auth/invite`, `POST /auth/reset-request`,
and the page that consumes the link and sets the password), and an outbound email seam. Cloudflare Workers
do not send email on their own: the seam is a provider with an API key held as a worker secret (Resend,
Postmark, SendGrid, SES all fit; the customer's own provider is the usual answer, so the mail comes from
their domain). The account record and the sign-in flow do not change: the invitation state is the same
`must_change_password` flag the temporary password sets today, so the two ways coexist, and an admin can
choose per account. About one working day once the provider and the sending domain are named.

**Single sign-on (locally implemented, disabled by default).** The configured OIDC authorization-code adapter uses PKCE/nonce and exact issuer+subject links to existing shared identities. Current tenant memberships alone grant roles: no JIT account, email/group linking or IdP-role import. Password, dual and true password-absent oidc modes coexist. Browser completion is same-origin and one-use; original transaction/session/config/link/restore-epoch authority is rechecked. Local logout is not IdP-wide deprovision.

An owner must approve the real provider/application, protected material, exact links/memberships, modes, lifetimes/reauth/deprovision and activation. No issuer/customer SSO acceptance is implied by local fixtures. Ordinary password UI cannot resurrect OIDC-only access; separate exact stamp-owner recovery deliberately changes mode and revokes sessions. The transaction cookie is not a migration of browser access/refresh tokens out of localStorage. Email invitations above remain unbuilt/separately configured.

## 4 · The decisions, and who makes them

| Decision | Ours or theirs | Default until decided |
|---|---|---|
| Temporary password handed over, or email invitation, or both | the customer's, per account | handed over (built) |
| Which email provider and sending domain | the customer's | none; invitations are off |
| Single sign-on, exact links/account modes and provider/security policy | customer and accountable owner | adapter off until explicit configuration and activation; password mode available |
| Tokens in local storage or in a cookie the page cannot read | ours, after their security review | local storage |
| Password rules beyond ten characters (length, rotation, lockout after failed attempts) | theirs, from their policy | ten characters, not the email, not one character repeated; no lockout yet |

Current source/stamp admission replaces the historical per-email lockout. Browser token-storage policy and email invitations remain separate decisions; local configurable OIDC does not approve a customer issuer or activation.

# 30 · Operator credentials: where they live, and how a person gets theirs

Written 2026-09-05 after Simone's question, "where exactly are these credentials being stored?", and the
instruction that the handover of a first password may not be what a customer wants. Internal. This is the
note that says what is built, what is not, and the decision a customer will make for us.

## 1 · Where everything lives

| What | Where | Shape | Lifetime |
|---|---|---|---|
| An account | D1, the environment's database (staging: `coach-demo-db-staging`; production: its own), table `operator_accounts` (migration 0010). *Moved from KV the same day after Simone's review: KV had no backup, no restore, no record of who changed a key, and eventual consistency.* | One row: `id`, `email` (unique), `name`, `roles` (`operator`, `admin`), `permissions`, `password_hash`, `must_change_password`, `disabled`, `created_at`, `updated_at`, `last_sign_in_at` | Until an admin removes it; thirty days of point-in-time restore behind that |
| The password | inside the record, as `password_hash` | PBKDF2 with SHA-256, 100,000 rounds, a random 16-byte salt, base64url: `pbkdf2$100000$<salt>$<hash>`. Nothing in the platform can turn it back into the password | Until changed |
| A record provisioning wrote to KV before the move | KV, `user:<email>`, with `password` in the clear | Verified once at its owner's next sign-in, written to D1 as a hash in the same request, and the KV keys deleted; the audit records the move | Until that sign-in |
| A session's refresh token | D1, table `operator_sessions` | one row per session: the token's random id, the account, the SHA-256 of the token (never the token), created and expiry times | Seven days; deleted by sign-out, reset, disable, removal |
| Who did what | D1, table `operator_audit` | sign-ins and failed sign-ins, lockouts, sign-outs, passwords changed, accounts created, reset, disabled, enabled, changed, removed, moved; the actor, the account, the time, a detail. Read by an admin at `GET /auth/audit` and in the console's Accounts section | Kept |
| A lockout | derived from the audit | ten failed sign-ins against an email inside ten minutes refuse the eleventh for ten minutes, and are recorded | Ten minutes |
| An access token | nowhere | A JWT signed with `JWT_SECRET` (a worker secret), HS256, fifteen minutes; carries `sub`, `email`, `name`, `roles` | Fifteen minutes |
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

**Single sign-on.** Enterprise customers usually ask for it: their people sign in with the company's
identity provider (Okta, Entra, Google Workspace) and there is no password in our platform at all. What it
needs: OIDC against their provider (a client id and secret as worker secrets, a redirect route, a session
minted from the provider's identity), a rule for which of their users get which role (a group claim, or
an allow-list an admin keeps), and the email-and-password path kept for the people outside their directory.
About two working days plus their identity team's time. The account record stays the same shape with the
password absent.

## 4 · The decisions, and who makes them

| Decision | Ours or theirs | Default until decided |
|---|---|---|
| Temporary password handed over, or email invitation, or both | the customer's, per account | handed over (built) |
| Which email provider and sending domain | the customer's | none; invitations are off |
| Single sign-on, and which provider | the customer's | none; email and password |
| Tokens in local storage or in a cookie the page cannot read | ours, after their security review | local storage |
| Password rules beyond ten characters (length, rotation, lockout after failed attempts) | theirs, from their policy | ten characters, not the email, not one character repeated; no lockout yet |

The lockout is built (ten failures in ten minutes). The cookie option is the one small thing still worth
doing before any customer asks. The email
path is built when a customer names a provider; single sign-on when a customer names theirs. Nothing built
today has to be undone for either.

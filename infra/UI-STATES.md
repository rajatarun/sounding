# The login UI, as a state contract

For whoever builds the surface in Tantu. This is the identity side's half of
the interface: every state the flow can be in, what put it there, what has to
be drawable, and what the player can do next. A login screen is mostly its
unhappy paths, so they are the bulk of this document.

Nothing here prescribes copy or layout beyond what correctness requires. Where
a rule *is* load-bearing it says so and says why.

---

## The flow has one field and one button

There is no "sign up" and no "sign in", and no choice between them. The player
types an email address and presses one control. The client behind it:

1. calls `SignUp`;
2. if that comes back `UsernameExistsException`, silently calls `InitiateAuth`
   instead;
3. either way ends on the same screen asking for a six-digit code.

Which branch was taken is remembered internally so the code goes to the right
API. **It is never surfaced.** Two reasons, and both matter:

- A "that address is already registered" message is an oracle: type an address,
  learn whether that person plays this game. This product asks people to sit
  alone in a dark room with headphones on, and who does that is not something
  the sign-in form should be willing to confirm to a stranger.
- It also removes an entire branch of the UI. There is no account-vs-sign-in
  toggle, no "already have an account?" link, no second form.

**There are no passwords anywhere in this flow.** The pool is configured with
`EMAIL_OTP` as the only accepted first factor, so there is no password field,
no strength meter, no policy text, no confirmation field, no "forgot password",
and no reset flow. If a state below looks like it is missing, that is why.

---

## States

Every state has an id. The client returns the id; the UI decides what it looks
like. `state` is the only thing that crosses the boundary — never a raw AWS
error string, which is written for developers and in several cases names
whether an account exists.

### Resting states

| id | reached by | must be drawable |
|---|---|---|
| `signed-out` | first visit, sign-out, account deletion | the address field, the single control, and a plain statement that an account is optional |
| `awaiting-code` | address accepted, code emailed | code field (6 digits, numeric keyboard on mobile), the **masked** destination, "send another code" |
| `signed-in` | code accepted | the address, sync status, sign out, sign out everywhere, delete account |

### Pending states

Each is a distinct id because each has a different thing to say and a different
thing to leave enabled. **None may last forever**: every one is bounded by a
15-second client timeout that resolves to `offline`.

| id | during | rules |
|---|---|---|
| `submitting-address` | `SignUp` / `InitiateAuth` | the control is busy, the field keeps its text and stays readable |
| `submitting-code` | `ConfirmSignUp` / `RespondToAuthChallenge` | the control is busy; the code stays visible so a mistyped digit can be seen |
| `resending` | `ResendConfirmationCode` | only the resend control is busy; the code field stays usable |
| `signing-out` | `GlobalSignOut` | brief; nothing else needs disabling |
| `deleting` | `DELETE /progress` then `DeleteUser` | **two calls in order.** The dialog must be `persistent` — dismissing it between the two leaves progress erased and the account alive |
| `syncing` | `GET`/`PUT /progress` | **silent.** Never a spinner over the game. See § Sync is quiet |

> **Gap in the design system.** `TantuButton` has no busy/pending prop and sets
> no `aria-busy`. A pending control in an auth flow is not decoration — it is
> the only thing standing between a slow network and a player pressing "send"
> four times, which is also how you get rate-limited. Either `TantuButton`
> grows a `busy` prop that keeps the label, disables activation and sets
> `aria-busy="true"`, or every call site pairs a `disabled` button with a
> `TantuSpindle` and an `aria-live` region. The first is better; this is the
> one component change this feature actually needs.

### Failure states

Every one of these must have its own copy. Collapsing two of them into "Something
went wrong" is how a player ends up retyping a correct address six times.

| id | what happened | what the player must be able to do |
|---|---|---|
| `address-rejected` | not a well-formed address | fix it in place — the field keeps focus and its text |
| `code-rejected` | wrong six digits | try again; the field clears, focus returns to it |
| `code-expired` | the code timed out, or too many wrong attempts killed the session | **request a new code** — the retry control must be present and enabled, because there is no way forward without it |
| `rate-limited` | Cognito refused: too many attempts | wait. The control is disabled and the copy says roughly how long. Do not offer a retry that will also fail |
| `delivery-failed` | Cognito could not send the email | **go back and change the address.** Distinct from `rate-limited`: waiting will not help |
| `offline` | `fetch` rejected — no network, DNS, or a CORS misconfiguration | retry, with the typed address preserved |
| `service-down` | a 5xx from Cognito or the progress API | retry later; not the player's fault and the copy should say so |
| `session-expired` | the progress API answered 401/403; the refresh token is gone or revoked | sign in again. **Local progress is untouched and the game keeps working** — this is not an error screen, it is a notice |
| `sync-failed` | the progress API was unreachable | nothing. See below |
| `unknown` | anything unmapped | retry once, then offer to continue without an account |

Two ids exist in the client and should **not** get a UI state:

- `already-registered` — swallowed by the single-field flow above.
- `password-rejected` — unreachable on a passwordless pool. It is mapped
  defensively so that if a password factor is ever added, the failure has
  somewhere to land instead of falling into `unknown`.

### The unconfirmed account is not a state, but it is a path

A player who asks for a code and closes the tab leaves an unconfirmed account
behind. When they come back they type the same address, the client takes the
`UsernameExistsException` branch, gets `UserNotConfirmedException`, resends the
sign-up code, and lands on `awaiting-code`. **So the code screen must be
reachable from a cold start with nothing but an address typed** — it cannot
assume it was arrived at from a submission in the same session.

---

## Rules that are not negotiable

**Mask the destination.** `awaiting-code` shows where the code went, and the
API hands back a masked form (`a***@e***.com`). Show that, not the address the
player typed. Re-displaying the full address turns a shoulder-surf into a
disclosure, and on a phone in a public place that is the realistic threat.

**Never render a raw error.** The client returns an id. If a screen ever puts
an AWS message on the glass, an address's registration status will eventually
appear on it.

**Sync is quiet.** Progress writes happen at trial boundaries — exactly where
this game is at its quietest. A toast, a spinner or a checkmark there is a
reward stinger by another name and lands in the same place as the presence
marks CLAUDE.md protects. `syncing` draws nothing. `sync-failed` draws nothing
during play; it is surfaced only on the account screen, as a resting fact
("this device has changes that aren't synced"), and it never blocks anything.

**The game continues without any of it.** Every failure above leaves
`localStorage` authoritative and the game playable. There is no state in which
a network problem stops somebody finishing a trial.

**Copy is SOUNDING's, not the design system's.** Per CLAUDE.md, login copy is
the game's own content, so it takes nothing from Tantu's textile vocabulary —
no threads, no weaving, no dye. It should also stay out of the in-world
register: this is the one screen in the game that is plumbing, and "Seeker"
belongs in a briefing, not on a form that has to be unambiguous about what
pressing a button will do.

---

## Component notes

- `TantuInput` — `error` for the field message, `hint` for the masked
  destination. Set `inputMode="numeric"` and `autoComplete="one-time-code"` on
  the code field, and `type="email"` / `autoComplete="email"` on the address.
  Note `TantuInput` voices a click per keystroke by default (`audio`); on the
  code field, in a game about near-inaudible sound, pass `audio={false}`.
- `TantuNotice` — `critical` for `offline` / `service-down` / `delivery-failed`,
  `caution` for `rate-limited`, `info` for `session-expired` and the resting
  "an account is optional" line. `critical` renders `role="alert"`, which is
  what makes a failure announce itself; the others are `role="status"`.
- `TantuDialog` — the delete confirmation, with `persistent` set, for the reason
  in the `deleting` row.
- `TantuSeal` — if the signed-in state wants an identity mark, **do not pass the
  email address as `name`.** `TantuSeal` puts `name` in a `title` attribute and
  derives visible initials from it, so an address ends up in a hover tooltip and
  two letters of it on screen. Pass a fixed label.
- `TantuButton` — see the gap above.
- Not `TantuTraceSearch`, and not `TantuPanchang`, anywhere near this. Both are
  called out in CLAUDE.md and neither has business on an account screen.

---

## What the client hands the UI

```js
// every call, without exception
{ ok: true,  state: 'awaiting-code', destination: 'a***@e***.com' }
{ ok: false, state: 'code-expired', code: 'ExpiredCodeException' }
```

`code` is the raw Cognito exception name. It is there for a bug report and for
a console log during development. **It is not for the screen.**

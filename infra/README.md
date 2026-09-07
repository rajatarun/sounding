# Player login for SOUNDING — the design

**Status: proposal. Nothing here has been applied.** It was written without AWS
credentials, against an account that already serves three other live
deliverables from one bucket and one deploy role. Everything is checked-in
infrastructure as code plus exact steps for a human to run; see
[APPLY.md](APPLY.md).

> **Both blockers this design named are answered.** `aiweave.org` serves HTTPS
> via CloudFront, so TLS is not in the way. And the shared-origin problem — that
> `/sounding/` sat on the same browser origin as Storybook, which renders
> arbitrary component stories and could therefore read a refresh token out of
> `localStorage` — is solved rather than accepted: the owner chose a dedicated
> hostname, `sounding.aiweave.org`. [HOSTING.md](HOSTING.md) is that stack and
> its runbook, `sounding-hosting.yaml` the template.
>
> The move has its own cost, and it is paid in `../legacy-origin/` and
> `../src/engine/handoff.js`: browser storage is scoped to the origin, so every
> Seeker who played before the move holds their only save under `aiweave.org`.
> That work carries it across and is needed whether or not accounts are ever
> built.

| file | what it is |
|---|---|
| `sounding-identity.yaml` | the whole stack — CloudFormation, 14 resources, self-contained |
| `lambda/index.js` | the entire server side, 102 lines, inlined verbatim into the template |
| `check-inline.mjs` | fails if those two drift apart |
| `reference-client/cognito.js` | zero-dependency Cognito client, 2.4 KB gzipped |
| `reference-client/progress-codec.js` | a Seeker's whole progress as 40 fixed bytes |
| `reference-client/sync.js` | the three calls that move it |
| `UI-STATES.md` | the contract for whoever builds the surface in Tantu |
| `APPLY.md` | preconditions, apply, smoke test, teardown |

**The shape in one paragraph.** A Cognito user pool that is passwordless to
the player — email address, six-digit code, no password ever chosen, shown or
typed. (`PASSWORD` is listed among the pool's first auth factors because
Cognito refuses to create one without it; sign-up sends a random password that
is discarded immediately and never known to anyone, so `EMAIL_OTP` is the only
factor that can authenticate. See the SignInPolicy comment in
`sounding-identity.yaml`.) The client is hand-written
`fetch`, because the unauthenticated user-pool operations are plain unsigned
JSON and the libraries that wrap them cost 27–58 KB gzipped to do it. Progress
syncs to a DynamoDB table through an HTTP API with a JWT authorizer, as one
54-character fixed-width blob keyed on an opaque subject id, and the fixed width
is what makes a timestamp impossible to store rather than merely absent. Login
is **optional**: `localStorage` stays authoritative, an account only mirrors it.
Nothing about the existing bucket, deploy role or workflow changes.

---

## Two things to settle before anything else

### The TLS precondition — this is a blocker

`deploy.yaml` publishes to an S3 **website** endpoint, which serves plain HTTP.
Its own closing line describes `https://aiweave.org` as the "custom domain
(after DNS)". I could not check whether TLS is actually in front of that: the
environment this was written in blocks outbound requests to `aiweave.org`.

If the answer is no, login cannot ship. Tokens over HTTP are readable by
anything on the path, and `localStorage` on an `http://` origin is shared with
every other `http://` page on that host. Fixing it means CloudFront + ACM in
front of the bucket — a DNS cutover for a domain serving four deliverables, with
a blast radius of its own, and it is deliberately **not** in this stack.
[APPLY.md § 0a](APPLY.md) has the one-line check.

### The origin is shared with Storybook and the playground

`aiweave.org` serves the site at `/`, Storybook at `/storybook/`, the playground
at `/playground/` and the game at `/sounding/`. Browser storage is scoped to the
**origin**, not the path. So a refresh token in `localStorage` under
`https://aiweave.org` is readable by script running in Storybook or in the
playground.

That is not a hypothetical: Storybook renders arbitrary component stories and
is a far larger script surface than a 300 KB game. Today it is harmless, because
`/sounding/` stores nothing worth stealing. The moment it stores a credential,
an existing deliverable can reach it.

**Recommendation: serve the game from `sounding.aiweave.org`**, so it gets its
own origin and its own storage partition. This costs a DNS record and a
CloudFront distribution — which is the same work item as the TLS precondition
above, so both are solved by one change rather than two. Until then, the
`AllowedOrigin` parameter should be set to whatever origin is actually used, and
the risk should be on the record.

---

## 1. Which client-side auth path, and what it costs in bytes

Measured, not remembered. Each entry is a realistic import list for this
feature, bundled with esbuild 0.28.2 (`--bundle --minify --format=esm
--platform=browser`, `NODE_ENV=production`) and gzipped at level 9. The game's
current JS is **94,184 bytes gzipped**, so the last column is what each option
does to the thing the player waits for.

| option | version | minified | gzipped | added to bundle |
|---|---|---|---|---|
| **hand-written `fetch` (this proposal)** | — | 5,782 | **2,437** | **+2.6 %** |
| `amazon-cognito-identity-js` | 6.3.20 | 92,186 | 27,205 | +28.9 % |
| `aws-amplify` (auth category only) | 6.20.0 | 146,376 | 42,707 | +45.3 % |
| `@aws-sdk/client-cognito-identity-provider` | 3.1127.0 | 161,566 | 51,378 | +54.6 % |
| …plus `@aws-sdk/client-dynamodb` | 3.1127.0 | 167,619 | 54,858 | +58.2 % |
| …plus `@aws-sdk/client-cognito-identity` | 3.1127.0 | 181,194 | 57,828 | +61.4 % |

**Picked: hand-written.** Not out of taste. The reason the numbers are so far
apart is that this design has no password, and almost everything those libraries
weigh is machinery this flow does not use.

- **SRP** is the bulk of `amazon-cognito-identity-js`: a bignum implementation,
  a hash chain, a padded-hex layer. This flow runs no SRP: nobody ever proves
  knowledge of a password, because nobody knows one.
- **SigV4 and the credential chain** are the bulk of the AWS SDK clients. The
  Cognito operations this flow makes are *unauthenticated* — `SignUp`,
  `InitiateAuth`, `RespondToAuthChallenge` — and the authenticated ones
  (`GetUser`, `DeleteUser`, `GlobalSignOut`) take the access token in the request
  body. None of them is signed. The progress API takes a bearer JWT. **Nothing
  in this design ever signs a request**, so a signer is 50 KB of dead weight.
- What the hand-written client is: five `fetch` calls to one endpoint with an
  `x-amz-target` header, plus one `switch` mapping Cognito's error names onto the
  states in [UI-STATES.md](UI-STATES.md). That mapping is not a cost — it is
  work this project has to do by hand anyway, because Cognito's messages are
  written for developers and several of them disclose whether an address is
  registered.

**Rejecting Amplify explicitly**, since it is the default answer everywhere. It
is the right default when a team wants an auth story rather than a design: it
ships a configuration singleton, an event Hub, federated and passkey paths,
device tracking, TOTP, and its own token storage with its own key names and its
own opinion about `localStorage`. This project uses three of those calls and
wants to make its own decisions about the other three. 42.7 KB gzipped — 45 % on
top of the entire game — for that trade, on a product whose whole delivery is a
phone loading a page in a quiet room, is not close.

**The honest cost of hand-writing it.** Wire formats we now own: if Cognito adds
an error code, it lands in `unknown` until someone maps it. If the `USER_AUTH`
challenge sequence changes, we notice at runtime. That is a real maintenance
tail. It is bounded — 200 lines against a public API with a decade of backward
compatibility — and it buys back a quarter of the bundle. If the tail ever looks
too long, `amazon-cognito-identity-js` is the fallback and it is a drop-in for
the same flows, at +27 KB.

## 2. Auth flow, tokens, refresh

### Neither SRP nor `USER_PASSWORD_AUTH`. `USER_AUTH` with `EMAIL_OTP`.

The question as asked has a good answer — **SRP**, because `USER_PASSWORD_AUTH`
puts the plaintext password in a request body, where it exists in process memory,
in any error reporter's captured request, and in cleartext behind a
TLS-terminating corporate proxy; TLS protects it on the wire and nowhere else.
SRP proves knowledge of the password without transmitting it, and that is worth
having.

But the password is also the source of the 27 KB, the password-policy UI states,
the reset flow, the reuse risk and the "I forgot it" support case. **Deleting the
password deletes all of them at once.** So: the pool accepts exactly one first
factor, `EMAIL_OTP`. A player types an address, receives six digits, and is in.
There is no password to choose, forget, reset, reuse, or leak, and nothing to
attack with a credential-stuffing list.

Costs of that choice, stated plainly:

- It requires the **Essentials** feature plan (Lite cannot do choice-based
  auth). Same 10,000 MAU free tier — see § 5.
- It makes email delivery a hard dependency of signing in. Cognito's built-in
  sender caps at ~50 messages/day account-wide, so anything past a private pilot
  needs SES out of the sandbox. That is a manual request with a lead time.
  [APPLY.md § 0b](APPLY.md).
- Losing access to the email address means losing the account. With a password
  pool the same is true, since the reset code goes to the same inbox.

### Token storage

| token | where | why |
|---|---|---|
| id token (1 h) | memory only | it is the bearer for the progress API; it should not outlive the tab |
| access token (1 h) | memory only | used for `DeleteUser` / `GlobalSignOut` only |
| refresh token (30 d) | `localStorage` | the only thing that has to survive a reload, and the only thing worth stealing |

**The XSS exposure, honestly.** A refresh token in `localStorage` is readable by
any script on the origin. If someone gets script execution on
`https://aiweave.org`, they can hold the account for up to 30 days: read the
email address via `GetUser`, read and overwrite the 40-byte progress record,
delete the account.

What I would accept and why: the game already keeps progress in `localStorage`,
so XSS was already game over for the thing being protected. The new asset is the
**email address**, and that is the part worth being uncomfortable about — it is
the only personal data this product has ever held. The mitigations are the ones
in the stack: access and id tokens live an hour and never persist; the refresh
token can be killed everywhere from the account screen (`EnableTokenRevocation`
with `GlobalSignOut`); no OAuth flows and no Hosted UI domain exist on this pool,
so there is no redirect surface at all. The mitigation *not* in the stack is the
subdomain, above, and it is the one that matters most, because today the largest
script surface on this origin belongs to Storybook rather than to the game.

An `httpOnly` cookie would be strictly better and is not available: it needs a
same-origin server to set it, and this is a bucket. Nothing short of CloudFront
plus an edge function provides one, which is more machinery than the asset
justifies.

### Refresh handling

Refresh proactively at ~50 minutes on an in-memory timer, and lazily on a 401
from the progress API. The response to a `REFRESH_TOKEN_AUTH` call carries no
new refresh token — rotation is deliberately off, because Cognito disables
`REFRESH_TOKEN_AUTH` entirely when rotation is on, and a rotated token inherits
the *remaining* validity of the original rather than resetting it, so it buys
less than it looks like it does at a 30-day window. When the refresh finally
fails, the state is `session-expired`, which is a notice and not an error: local
progress is untouched and the game keeps working.

## 3. The data constraint — dates

### First, plainly: no, you cannot turn Cognito's dates off.

`UserCreateDate` and `UserLastModifiedDate` are fields the service sets on every
user record and returns from `AdminGetUser` and `ListUsers`. There is no pool
setting, no schema option and no API to suppress them. Anything built on Cognito
has them. (I could not reach `docs.aws.amazon.com` from this environment to cite
the page — see § Could not verify — but this is not in doubt.)

So the question is not whether dates exist. It is **which** dates exist, what
they mean, and which of them a design chooses to create on top of the ones it
cannot avoid.

### Does login mean progress moves server-side? Yes.

An account that does not carry your place is not a feature. So progress moves,
and the whole design of where it moves is driven by keeping dates out of it.

### The obvious answer, and why it is rejected

The tempting design removes two thirds of this stack: put the progress blob in a
**Cognito custom attribute**, `custom:progress`. No table, no API, no function —
Cognito is already storing a record per player, so use it.

Reject it. Writing a user attribute modifies the user record, and modifying the
user record moves `UserLastModifiedDate`. Every Seeker's Cognito record would
become a **last-played timestamp, updated at every trial boundary, visible in the
console**, arriving for free and unannounced — precisely the failure mode the
charter names. And it would be the worst kind, because nobody chose it: it would
be a side effect of picking the simpler store.

Keeping progress *out* of Cognito is what keeps Cognito's own
`UserLastModifiedDate` frozen at sign-up, where it is a creation date rather
than an activity log.

### What is stored instead

DynamoDB, one table, one item per player:

```
{ sub: "e4c9…-opaque-uuid", p: "8AAQAAAA…" }   // two attributes, always
```

`p` is a **fixed-width bitfield** — see `reference-client/progress-codec.js`.
Every bit is spoken for: 300 bits for the trials, 7 for the resume level, 2 for
the resume trial, 5 for the named Disciplines, 1 for `everPlayed`, and 5 held at
zero. 320 bits, 40 bytes, 54 base64url characters, for every Seeker at every
point in the game.

This is the mechanism that makes the forbidden fields **impossible rather than
absent**:

- A JSON document with a `done` array has room for a `lastPlayedAt` beside it and
  no reason to refuse one. A 54-character blob has nowhere to put one.
- The Lambda validates `^[A-Za-z0-9_-]{54}$` before writing. An ISO 8601 date is
  the wrong length and the wrong alphabet. A blob one byte longer is refused.
- It writes with `PutItem` and a literal two-attribute map, so no attribute
  survives from an earlier write and none can be introduced by one.
- Adding a date later means widening the format in three files at once — client,
  Lambda and template — which is a visible change in a review, not a quiet one.

It also has a side effect worth naming: the blob a player who has finished
nothing sends is byte-identical in length to the blob a player who has finished
everything sends, so even the stored object's size discloses nothing.

Everything else about the table is off on purpose, and each item is a date that
would otherwise exist: **no point-in-time recovery** (a rolling 35-day history of
every write is a record of exactly when each Seeker played), **no stream** (a
timestamped feed of who just played, and the thing analytics attaches to), **no
TTL** (an expiry date stored on the record). The function's IAM role has
`GetItem`, `PutItem` and `DeleteItem` on one table ARN and **no `Scan` and no
`Query`** — a "how many people are playing" feature cannot be built on this role
without changing it.

Because there is no clock anywhere in the store, cross-device reconciliation
**cannot** be last-write-wins. It is a union: both devices keep every trial
either finished, and the resume point is whichever is further along. That
constraint turns out to produce the rule this game would have wanted anyway —
nothing a Seeker has actually done is lost to the order two tabs happened to
sync in.

### The residue

The honest answer is that you cannot fully, and here is exactly what is left.

1. **`UserCreateDate`.** The date an account was made. Unavoidable, per-player,
   permanent while the account exists. It is a *sign-up* date, not an activity
   date, so nothing can build a streak from it — but it does say when somebody
   started.
2. **`UserLastModifiedDate`.** Set at sign-up and moved by changes to the user
   record. This design changes nothing about the record after confirmation, so it
   should stay frozen. **Whether a plain sign-in moves it is not documented
   anywhere I could reach, and it is the one measurement that decides whether
   this claim holds.** [APPLY.md § 5](APPLY.md) is the two-command test; if it
   moves, the residue is a genuine last-seen timestamp and the owner should hear
   that before launch.
3. **CloudTrail. This is the big one, and it is not optional.** Cognito user-pool
   API calls are management events, and CloudTrail Event history records them
   account-wide, for 90 days, with no way to turn it off and no charge. That
   means this AWS account will contain a rolling 90-day, timestamped record of
   sign-in and sign-up calls — which is a play history, of a kind, for anyone
   with console access. Nothing in this design creates it and nothing in this
   design can suppress it. If the account also has a **CloudTrail trail**
   delivering to S3, that history is not 90 days, it is forever; I have no
   credentials to check whether one exists, and somebody should.
4. **Lambda's own log lines.** The function logs nothing per request, but the
   runtime writes `START`/`END`/`REPORT` per invocation. Those carry a request id
   rather than a subject, and the log group is set to CloudWatch's minimum
   one-day retention. API Gateway access logging — which would carry the subject
   and the path — is deliberately not enabled.
5. **The player's own inbox.** A sign-in code is an email with a date on it, in a
   mailbox we do not control. Normal, and outside the boundary, but it is the
   most legible record of all and worth saying out loud.

None of 1–4 is visible to the player, and none of them can reach the game: there
is no code path by which a date leaves AWS and arrives in a briefing screen. The
guarantee this design can actually make is that one — **the game will never be
able to tell you that you came back late** — and it is the one the docstring in
`progress.js` is really about.

## 4. Is anonymous-first still possible? Yes, and it should stay that way.

**Login should be optional.** `localStorage` remains authoritative; an account is
a mirror of it, not a replacement. A player who never signs in sees no change
whatsoever, and every failure state in [UI-STATES.md](UI-STATES.md) leaves the
game playable.

Architecturally this is the cheap option precisely because the game already works
without it. It needs three things and nothing else: the union merge above, one
"link this device" moment, and a rule that sync never blocks play. Sync writes at
trial boundaries and draws nothing while it does — a toast or a checkmark there
is a reward stinger in the place this game is at its quietest, which is the same
objection CLAUDE.md makes to putting a chime on a presence mark.

**Required login costs, for comparison:**

- The first minute of this game is the whole pitch — a quiet room, headphones,
  the calibration tone. An email form and a wait for a six-digit code is the
  worst imaginable thing to put in front of it.
- The privacy surface goes from "the people who chose to" to "everyone". Right
  now this product holds no personal data at all. Optional login means it holds
  an email address for the subset who opted in; required login means it holds
  one for every player who ever loads the page.
- Offline play stops working, on a game designed to be played on a phone in a
  quiet place.
- An SES delivery problem becomes a total outage rather than a degraded feature.

There is no upside to trade against those. Optional.

## 5. Cost

Cognito's pricing model did change: user pools are now billed by feature plan —
**Lite**, **Essentials**, **Plus** — rather than one MAU rate.

**I could not verify these figures at the source.** `aws.amazon.com` and
`docs.aws.amazon.com` are both blocked by the network egress proxy in this
environment, as were the two independent pricing sites I tried. The numbers below
come from a search-result summary of the AWS pricing page and should be confirmed
against the live page before anyone commits to them.

| plan | free tier | after |
|---|---|---|
| Lite | 10,000 MAU/month, per account, non-expiring | $0.0055/MAU, tapering to $0.0025 at volume |
| **Essentials** (required here) | 10,000 MAU/month, per account, non-expiring | **$0.015/MAU, flat** |
| Plus | none | $0.02/MAU |

Federated SAML/OIDC users get 50 free MAU regardless of plan; irrelevant here,
since this pool federates with nothing.

**Monthly, at the three sizes asked for** (MAU = players who signed in or
refreshed a token that month; a player who never makes an account is not an MAU
at all):

| | 100 players | 1,000 | 10,000 |
|---|---|---|---|
| Cognito (Essentials) | $0 | $0 | **$0** — exactly at the free-tier edge |
| SES codes (~2/player/month, $0.10 per 1,000) | ~$0.02 | ~$0.20 | ~$2 |
| API Gateway HTTP API ($1.00/M) | ~$0 | ~$0.10 | ~$1.00 |
| Lambda | $0 (free tier) | $0 | ~$0 |
| DynamoDB on-demand (~100 writes/player/month) | ~$0.01 | ~$0.13 | ~$1.30 |
| CloudWatch Logs ingest | ~$0 | ~$0.02 | ~$0.15 |
| **total** | **~$0** | **under $1** | **~$5** |

**The number the owner should hear now, before it arrives.** The free tier is
10,000 MAU and then Essentials is a flat $0.015 for every MAU above it. So:

- 10,000 monthly players — **$0**
- 20,000 — **$150/month**
- 50,000 — **$600/month**

That is a cliff, not a curve, and it is Cognito's line item rather than
anything else in this stack; every other service here stays in single dollars at
those volumes. If the game gets popular, identity is the bill.

Two caveats on the free tier. It is **per AWS account**, and this account already
serves three other deliverables — if anything else in it ever uses Cognito, they
share the 10,000. And Cognito's built-in email sender is capped account-wide at
~50 messages/day, which is a shared limit in the same way. I have no credentials
to check current usage of either.

## 6. Deletion

Self-service, from the account screen, finishing in one screen and needing
nobody's help. No support ticket, no email confirmation, no waiting period.

**The flow, and the order is not negotiable:**

1. A `TantuDialog` with `persistent` set, naming exactly what goes and what
   stays.
2. `DELETE /progress` — the Lambda removes the DynamoDB item.
3. `DeleteUser` with the player's own access token — Cognito removes the user
   record and every refresh token with it.
4. Local state: **the game's own `localStorage` progress is kept by default**,
   and clearing it is a separate, clearly-labelled choice. Deleting an account
   should not delete the game. Somebody who signed up, disliked having an
   account, and deleted it should still be on level 7.

Progress-first is the part that matters. The DynamoDB item is keyed on the
Cognito `sub`; delete the user first and that key resolves to nobody, leaving a
row nothing can ever reach, read or erase — an orphan created by the deletion
flow itself. `reference-client/cognito.js` says so at the call site.

**What is gone immediately:** the email address, the user record, every refresh
token, and the progress row. Access tokens already issued stay cryptographically
valid until they expire (at most one hour) but there is no longer a row for them
to touch.

**What remains, and the player should be told in plain words:** the CloudTrail
Event history entries for their sign-in calls, for up to 90 days. Those are AWS's
account-level audit log, they are not ours to delete, and they exist because the
account exists. Everything else is gone at the moment they press the button.

**There is nothing to export.** The entirety of what this system holds about a
player is one email address and 40 bytes, and the 40 bytes are already on their
device. A data-export feature would be a form that emails somebody a copy of a
file they already have.

## 7. Blast radius

**On the existing account, this changes nothing.** Stated item by item, because
that is the question:

| thing | change |
|---|---|
| `aiweave.org` bucket, its policy, its website config | **none.** The stack does not know the bucket's name |
| `teamweave-github-actions-sam-deployer` | **none.** Not referenced, not assumed, no new permissions. It is trusted for three deliverables and this proposal does not touch its trust policy or its inline policy |
| `.github/workflows/deploy.yaml` | **none required.** See below |
| GitHub Actions secrets | **none added** |
| Storybook, the playground, the site | **unaffected** |

The stack is applied **once, by hand, with the owner's own credentials**
([APPLY.md § 1](APPLY.md)) and is not in the CI path. It creates 14 resources,
all new, all in one stack, all deletable together. Extending the deployer role to
provision Cognito, IAM, Lambda and API Gateway would have been the convenient
route and would have put three shipping deliverables behind an identity change
to publish a game that already publishes fine.

**Why the workflow needs no change.** The three stack outputs are public
identifiers — a user pool id, an app client id created with
`GenerateSecret: false`, and an API URL where every route demands a token. They
are designed to be read out of a browser bundle. So they are committed to the
game's source rather than injected at build time, and the `sounding` job in
`deploy.yaml` stays exactly as it is.

If the owner would rather have them injected anyway — to keep a staging pool
separate, say — the diff to `rajatarun/aiweave` is additive and confined to the
`Build for /sounding/` step of the `sounding` job:

```diff
       - name: Build for /sounding/
         env:
           SOUNDING_BASE_PATH: /sounding/
+          # Public client identifiers, not secrets: a user pool id and an app
+          # client id with no client secret are meant to ship in the bundle.
+          # Repository *variables*, deliberately — not secrets — so that what
+          # is public stays legible as public.
+          SOUNDING_USER_POOL_ID: ${{ vars.SOUNDING_USER_POOL_ID }}
+          SOUNDING_CLIENT_ID: ${{ vars.SOUNDING_CLIENT_ID }}
+          SOUNDING_PROGRESS_API: ${{ vars.SOUNDING_PROGRESS_API }}
         run: npm run build
         working-directory: sounding
```

I have not made that change; `/home/user/aiweave` is not mine to edit.

**What this proposal does consume that is shared:** the account-wide Cognito free
tier (10,000 MAU), the account-wide Cognito default-email cap (~50/day), and — if
SES is configured — the account's SES sending reputation and quota in
`us-east-1`. Those are the three places where a change here could be felt
somewhere else in the account.

**And the blast radius pointing the other way**, which is the one nobody asks
about: because `/sounding/` shares an origin with `/storybook/` and
`/playground/`, script running in either of those existing deliverables can read
the game's tokens out of `localStorage`. The subdomain recommendation at the top
of this document is the fix.

---

## Should this be built at all?

The owner has asked for it and it will be built; this is on the record because I
am the one who sees the privacy and cost surface first, and I would rather say it
now.

**My reservation is not that it is dangerous. It is that the account is a much
bigger thing than what it carries.**

What is being protected is 40 bytes that a player can regenerate in a few hours
of play. What is being introduced to protect it: an email address for every
player who signs up — the first personal data this product has ever held; a
90-day timestamped record of sign-ins in the account that nothing can suppress; a
permanent dependency on email delivery, including an SES sandbox exit and a
sending reputation to maintain; a login screen adjacent to the quietest opening
in the game; and a bill that is $0 at ten thousand players and $150 a month at
twenty thousand.

And there is a specific irony worth naming. The reason this game stores so little
is a design decision about *how returning should feel* — a gap of a day and a gap
of a year read identically, so coming back is never something the game can tell
you that you did late. An account is the single most natural place for that
promise to leak, not through the progress record, which this design nails shut,
but through everything that surrounds one: a welcome-back email, a "we noticed
you haven't played" nudge, a console column somebody sorts by. None of those is
in this proposal. All of them are one product conversation away, and the account
is what makes them possible.

**The one honest justification is a phone that is lost, destroyed or replaced.**
That is real and it happens, and there is no other answer to it.

But if that is the actual goal, there is a lighter answer worth putting on the
table before this one is built: **a transfer code**. The progress blob is 54
characters — call it 40 in a human-typable alphabet, or a QR code on screen. One
device shows it, the other accepts it. No account, no email address, no server,
no AWS resources, no monthly bill, no login screen, and nothing to delete because
nothing was ever stored. It is worse in exactly one case — a phone destroyed
without warning rather than replaced deliberately — and better in every other
respect, including that it needs neither the TLS work nor the subdomain.

If the answer is that people lose phones without warning, then this design is the
right one and the stack is ready to apply. I would want that to be the stated
reason rather than the default one.

---

## Could not verify from here

No AWS credentials, and the network egress proxy blocks `aws.amazon.com`,
`docs.aws.amazon.com` and `aiweave.org`. Each of these needs a human with access:

1. **Whether `aiweave.org` serves HTTPS**, and what is in front of the bucket.
   Blocking. [APPLY.md § 0a](APPLY.md).
2. **Current Cognito and SES usage in account 239571291755** — whether the
   10,000 MAU free tier and the ~50/day email cap are already partly consumed by
   another deliverable.
3. **Whether `SignUp` accepts an omitted `Password`** on a pool whose only first
   factor is `EMAIL_OTP`. The fallback is one line and it is written down in
   `reference-client/cognito.js`. [APPLY.md § 4](APPLY.md).
4. **Whether `UserLastModifiedDate` moves on a plain sign-in.** The single
   measurement this design's central claim rests on. [APPLY.md § 5](APPLY.md).
5. **Whether a `REFRESH_TOKEN_AUTH` call counts as an MAU.** It changes the cost
   table for players who open the game rarely.
6. **Current Cognito prices.** § 5's figures come from a search summary of the
   AWS pricing page, not the page.
7. **Whether `UserPoolTier` and `Policies.SignInPolicy.AllowedFirstAuthFactors`
   are in the current CloudFormation resource specification.** Both are recent.
   `validate-template` will say.
8. **Whether `nodejs22.x` still bundles AWS SDK v3.** It has; AWS has signalled
   they may stop. If it does not, the function needs packaging and this stops
   being a single self-contained template.
9. **Whether a CloudTrail trail exists in the account.** It decides whether the
   sign-in record in § 3's residue is 90 days or permanent.
10. **The site's real production origin(s)**, for the `AllowedOrigin` parameter
    and the CORS policy.

## Sources

- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/) (via search
  summary — the page itself is blocked from this environment)
- [Essentials plan features](https://docs.aws.amazon.com/cognito/latest/developerguide/feature-plans-features-essentials.html)
- [Authentication flows](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html)
- [Amazon Cognito now supports passwordless authentication](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-cognito-passwordless-authentication-low-friction-secure-logins)
- [Email settings for Amazon Cognito user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html)
- [Request production access (moving out of the SES sandbox)](https://docs.aws.amazon.com/console/ses/sandbox)
- [Refresh tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html)

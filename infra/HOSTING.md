# Giving SOUNDING its own origin

**Proposal. Nothing here has been applied.** `sounding-hosting.yaml` is the
stack; this is how to decide on it, apply it, cut over, and undo it.

The game shipped at `https://aiweave.org/sounding/`, sharing one browser origin
with the site, Storybook and the playground. Storage is scoped to the origin,
not the path, so anything that runs script on `aiweave.org` can read the game's
storage — and Storybook, which renders arbitrary component stories, is the
largest script surface on it. The owner chose a dedicated hostname.

---

## The account, as it actually is

Answered on 2026-09-07 by running the three checks below against the live
account. Recorded here so the next reader does not have to re-derive them, with
the one thing still open marked as open.

| | |
|---|---|
| Existing distribution | `E3EYLE59E156CK`, alias `aiweave.org` |
| Its origin | `aiweave.org.s3-website-us-east-1.amazonaws.com` — a **website endpoint** |
| Its cache config | legacy `ForwardedValues`, no cache policy. DefaultTTL 86400s, MaxTTL 1y. **MinTTL not yet read — see below** |
| Wildcard certificate | `arn:aws:acm:us-east-1:239571291755:certificate/0a47510f-ad86-4e42-b079-64379ad14dbe` (`*.aiweave.org`, ISSUED, unused) |
| Apex certificate | `arn:aws:acm:us-east-1:239571291755:certificate/12028150-7b57-456a-9f4b-24cd370a924b` (`aiweave.org`, ISSUED, in use) |
| Hosted zone | `Z08177421DQ2ZF8VY74UQ` |

So `OriginShape=Website` (the default), and *The REST origin trap* below does
not apply.

**Use the wildcard certificate, not the apex one.** `*.aiweave.org` covers
`sounding.aiweave.org` by construction — one label, one wildcard — and that is
the only alias this distribution has, so the wildcard is provably sufficient on
its own. The apex certificate *may* carry `*.aiweave.org` as a subject
alternative name, in which case it would work too, but its SANs have not been
read and a certificate that does not cover an alias fails at
`CreateDistribution` with an error that does not name the certificate. If you
want to use the in-use one anyway, read its SANs first:

```bash
aws acm describe-certificate --region us-east-1 \
  --certificate-arn arn:aws:acm:us-east-1:239571291755:certificate/12028150-7b57-456a-9f4b-24cd370a924b \
  --query "Certificate.SubjectAlternativeNames"
```

There is no cost to using two certificates, and ACM renews both.

**The one thing still open, and it matters for the bridge, not the game.** The
existing distribution predates cache policies and uses legacy `ForwardedValues`
with a 24-hour DefaultTTL. That distribution keeps serving the old
`/sounding/` path, which after cutover holds the bridge page that carries
players' saved progress across. A DefaultTTL only applies when the origin sends
no `Cache-Control` at all, and the deploy uploads the bridge `no-store` and
reads the header back — but a **MinTTL above zero would override that**, and
MinTTL has not been read:

```bash
aws cloudfront get-distribution-config --id E3EYLE59E156CK \
  --query "DistributionConfig.DefaultCacheBehavior.MinTTL"
```

Zero is the answer to hope for and almost certainly the answer. If it is not
zero, the bridge would be cached for that long, and a player arriving in that
window gets a stale page — which for the bridge means being handed a stale copy
of their own progress. Fix it there rather than working around it here.

The game's own distribution is unaffected either way: it is created by this
stack with `Managed-CachingOptimized`, which respects the origin's headers.

---

## What to check first

Three things are unknown from outside the account and every one of them changes
what you run. Answer these before anything else.

**1. What shape is the existing origin?**

```bash
aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(Aliases.Items, 'aiweave.org')].{Id:Id,Origins:Origins.Items[].DomainName,Cache:DefaultCacheBehavior.CachePolicyId}"
```

If the origin domain ends `s3-website-us-east-1.amazonaws.com`, the existing
setup is a **website endpoint** → `OriginShape=Website` (the default). If it
ends `s3.us-east-1.amazonaws.com`, it is a **REST origin** →
`OriginShape=RestOac`, and read *The REST origin trap* below before applying.

**2. Does a certificate already cover the subdomain?**

```bash
aws acm list-certificates --region us-east-1 \
  --query "CertificateSummaryList[].{Arn:CertificateArn,Domain:DomainName}"
```

CloudFront only reads certificates from **us-east-1**, whatever region the rest
of the account is in. A `*.aiweave.org` wildcard already covers
`sounding.aiweave.org`: pass its ARN as `CertificateArn` and the stack creates
nothing. A cert for the bare apex does **not** cover a subdomain. Leave
`CertificateArn` empty and the stack requests one — which will sit in
`PENDING_VALIDATION` until the DNS validation record exists, so if DNS is not in
Route 53 in this account, expect the stack to wait there.

**3. Where does DNS live?**

```bash
aws route53 list-hosted-zones-by-name --dns-name aiweave.org
```

In Route 53 in this account → pass `HostedZoneId` and the stack writes the
records. Anywhere else → leave it empty, apply the stack, and create the record
by hand from the `DistributionDomainName` output. Everything else is identical.

---

## New distribution, or a second alias on the existing one?

A second alias is fewer resources and the wrong answer.

The existing distribution is the request path for `aiweave.org`, `/storybook/`
and `/playground/`. Adding the game to it means every change to the game's
caching, headers or origin is a change to a distribution three live things
depend on, and a bad deploy takes all four down rather than one. A separate
distribution costs nothing extra — CloudFront bills per request and per byte,
not per distribution — and gives the game its own blast radius, which is the
entire reason for the move.

It also keeps the undo trivial: delete one distribution and nothing else in the
account has been touched.

---

## Applying it

**This stack is applied by GitHub Actions, not by hand.** The
`sounding-hosting` job in `rajatarun/aiweave/.github/workflows/deploy.yaml`
runs `cloudformation deploy` against it using the same OIDC role the site
already deploys with — `teamweave-github-actions-sam-deployer`, which
`rajatarun/ContextWeave` has been deploying CloudFormation with for some time.
No capability flag is needed: this template creates a certificate, an origin
access control, a response headers policy, a distribution and a DNS record, and
no IAM resource of any kind.

The job is guarded two ways, and both matter:

- `if: vars.SOUNDING_OWN_ORIGIN == 'true'` — it does not exist until you ask
  for it.
- `needs: sounding` — it runs only *after* the publish job, never beside it.
  The stack creates the distribution **and** the DNS record, so the moment it
  finishes the hostname resolves; a hostname resolving to an empty origin
  prefix serves an error to whoever reaches it. The dependency is what
  guarantees a build is already sitting in `sounding-app/`.

It then asks the distribution for the document and fails if the answer is not
the game — a certificate that does not cover the alias, or an empty prefix,
both produce a stack that reports success and a hostname that does not work.

Running it by hand is still possible and is the same command:

```bash
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name sounding-hosting \
  --template-file infra/sounding-hosting.yaml \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
      OriginShape=Website \
      CertificateArn=arn:aws:acm:us-east-1:239571291755:certificate/0a47510f-ad86-4e42-b079-64379ad14dbe \
      HostedZoneId=Z08177421DQ2ZF8VY74UQ
```

The certificate and zone are repository variables in aiweave —
`SOUNDING_CERT_ARN` and `SOUNDING_HOSTED_ZONE_ID` — defaulting to those values,
so they can move without a code change.

---

## Cutover, in the order that cannot strand anyone

Two repository variables in `rajatarun/aiweave`, set one at a time. The gap
between them is the whole safety property.

**Phase 1 — `SOUNDING_OWN_ORIGIN=true`, then run the deploy.**

The game is built for `/`, published to `sounding-app/`, and the stack creates
the distribution, the DNS record and nothing else. `aiweave.org/sounding/` is
untouched and still serves the previous build, so **nobody is affected yet if
this goes wrong.** The job proves the new hostname serves the game before it
reports success.

Then open `https://sounding.aiweave.org/` yourself and play a trial. On a
phone, with headphones — everything this project says about testing still
applies.

**Phase 2 — `SOUNDING_BRIDGE_LIVE=true`, then run the deploy again.**

Only now does `legacy-origin/index.html` replace the old path. Until this is
set, that path keeps serving the old game, which is a perfectly good state to
sit in for as long as you like.

The order is not fussiness. The bridge's entire purpose is to send players to
the new hostname carrying their saved progress in the URL fragment; publish it
before that hostname resolves and it sends them somewhere that does not answer
while holding the only copy of their place in the game.

Rolling back is unsetting the variables and re-running: phase 2 unset restores
the old game to the old path, phase 1 unset republishes it to `sounding/` as
well. Neither deletes anything a player is holding — the bridge never removes
the copy it reads.

---

## Does a deploy need an invalidation?

**No, and this is a property of the cache policy rather than luck.** The
distribution uses `Managed-CachingOptimized`, which respects the origin's
`Cache-Control`. The asset filenames are content-hashed, and the deploy
workflow uploads `index.html` with `no-cache, no-store, must-revalidate` and
reads that header back to prove it. So a new deploy is visible on the next
request.

Two things would break that, and both are worth knowing:

- **Changing the cache policy to one with a `MinTTL` above zero.** A MinTTL
  overrides the origin's headers, and every deploy becomes invisible for the
  TTL — green in the workflow, stale in the browser.
- **Dropping the `no-store` on `index.html`.** It is the only file that names
  the hashed bundles.

If an invalidation is ever genuinely needed, note that the deploy role does
**not** have `cloudfront:CreateInvalidation` today, and adding it means editing
a role trusted by three other deliverables.

---

## SPA routing

The stack deliberately sets no `CustomErrorResponses`. SOUNDING has no
client-side router, no history manipulation and no deep links — `App.jsx` is a
`useState` screen machine, and the handoff travels in the URL fragment, which
never reaches a server. A `403/404 → 200 /index.html` catch-all would only turn
genuinely missing files into a silently blank game.

If routing is ever added, this is the block:

```yaml
        CustomErrorResponses:
          - ErrorCode: 403
            ResponseCode: 200
            ResponsePagePath: /index.html
            ErrorCachingMinTTL: 0
          - ErrorCode: 404
            ResponseCode: 200
            ResponsePagePath: /index.html
            ErrorCachingMinTTL: 0
```

`403` matters for a REST origin, where a missing key is an `AccessDenied`
rather than a `NoSuchKey`.

---

## The REST origin trap

Only if `OriginShape=RestOac`.

An OAC origin needs a bucket policy statement allowing that distribution to
read the prefix. The stack emits it as the `BucketPolicyStatementIfRestOac`
output and **deliberately does not write it**, because the `deploy` job in
`rajatarun/aiweave` runs `put-bucket-policy` on **every** run with a policy
document it builds from scratch — which replaces the whole policy and would
silently delete the statement, taking the game offline on the next unrelated
push to that repo.

So on a REST origin, the statement has to be added to the workflow's policy
document, not to the bucket by hand. On a website origin none of this applies:
the bucket is already public-read.

---

## The deploy workflow

The `sounding` job in `rajatarun/aiweave/.github/workflows/deploy.yaml`
publishes the game; `sounding-hosting`, which `needs` it, provisions the
hostname. Both are inert until the variables are set, so all of it merges
safely ahead of any decision.

| | before | after cutover |
|---|---|---|
| base path | `/sounding/` | `/` |
| destination | `s3://aiweave.org/sounding/` | `s3://aiweave.org/sounding-app/` |
| old prefix | the game | `legacy-origin/index.html`, once phase 2 is set |

| variable | effect |
|---|---|
| `SOUNDING_OWN_ORIGIN` | publish to the new prefix and provision the hostname |
| `SOUNDING_BRIDGE_LIVE` | put the bridge over the old path |
| `SOUNDING_CERT_ARN` | override the certificate (defaults to the wildcard) |
| `SOUNDING_HOSTED_ZONE_ID` | override the zone (defaults to `Z08177421DQ2ZF8VY74UQ`) |

---

## Undo

```bash
# DNS first, so nothing is being sent to a distribution that is going away.
# Then:
aws cloudformation delete-stack --region us-east-1 --stack-name sounding-hosting
```

Unset `SOUNDING_OWN_ORIGIN` and re-run the deploy to put the game back under
`aiweave.org/sounding/`. Nothing outside the stack changed state.

The one thing a delete does not recall is **HSTS**, which lives in browsers
that have already visited. That is why `HstsMaxAgeSeconds` defaults low; raise
it once the hostname is settled, not before.

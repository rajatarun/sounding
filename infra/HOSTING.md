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

## Apply

Run with the owner's own credentials. Nothing below is in CI.

```bash
# 1. Answer the three questions above, then create the stack.
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name sounding-hosting \
  --template-file infra/sounding-hosting.yaml \
  --parameter-overrides \
      OriginShape=Website \
      CertificateArn=arn:aws:acm:us-east-1:239571291755:certificate/0a47510f-ad86-4e42-b079-64379ad14dbe \
      HostedZoneId=Z08177421DQ2ZF8VY74UQ \
  --no-execute-changeset   # drop this once the change set reads correctly

# 2. Read the outputs. DistributionDomainName is what you test against.
aws cloudformation describe-stacks --region us-east-1 \
  --stack-name sounding-hosting --query "Stacks[0].Outputs"
```

**Publish before pointing DNS.** The distribution serves nothing until the
origin prefix has a build in it. Push a root-based build to
`s3://aiweave.org/sounding-app/` first — see *The deploy workflow* below —
then:

```bash
# 3. Prove the whole thing on the CloudFront name, with nothing pointing at it.
curl -sI https://<DistributionDomainName>/ | head -20
```

Expect `200`, `content-type: text/html`, and a `cache-control` containing
`no-store`. Open it in a browser and play a trial. Only when that works:

```bash
# 4. DNS. Skip if HostedZoneId was passed — the stack already did it.
#    Otherwise create sounding.aiweave.org as an ALIAS/CNAME to
#    <DistributionDomainName>.
```

DNS propagation and CloudFront deployment are both minutes, not seconds.

---

## Cutover, in the order that cannot strand anyone

The order matters because the bridge page at the old path sends players to the
new hostname. Publish the bridge before that hostname works and you have sent
someone to an address that does not resolve.

1. Publish the root-based build to `sounding-app/`.
2. Verify on `DistributionDomainName`.
3. Create DNS, verify `https://sounding.aiweave.org/` in a browser.
4. **Only then** publish `legacy-origin/index.html` over the old `sounding/`
   prefix.

Step 4 is the irreversible-feeling one and it is not: the bridge reads the old
origin's storage and hands it over in the URL fragment without deleting it, so
a player who is interrupted still has their save on the old origin and simply
repeats the handoff next time. See `src/engine/handoff.js`.

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

The `sounding` job in `rajatarun/aiweave/.github/workflows/deploy.yaml` needs
three changes, and they are written to be safe to merge **before** the stack
exists — the cutover is a repository variable, not a merge.

| | before | after |
|---|---|---|
| base path | `/sounding/` | `/` |
| destination | `s3://aiweave.org/sounding/` | `s3://aiweave.org/sounding-app/` |
| old prefix | the game | `legacy-origin/index.html` |

Set the repository **variable** `SOUNDING_OWN_ORIGIN` to `true` in
`rajatarun/aiweave` to cut over, and unset it to fall back. Until it is set the
job behaves exactly as it does today.

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

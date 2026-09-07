# Applying the stack

**Nothing in this directory has been applied.** It was written without AWS
credentials, against an account that already serves three live deliverables.
Every command below is for a human with the account owner's own credentials to
run, in order, reading the output.

> **Read [HOSTING.md](HOSTING.md) first.** The game is moving to its own
> hostname, and the order matters: the bridge page that carries old players'
> saved progress must not be published until `sounding.aiweave.org` actually
> resolves, or it sends people to an address that does not answer. This file
> covers the identity stack only.

---

## 0. Preconditions, in the order they will bite

### 0a. The site must be served over TLS. This is a blocker.

`.github/workflows/deploy.yaml` in `rajatarun/aiweave` publishes to an S3
**website** endpoint (`aiweave.org.s3-website-us-east-1.amazonaws.com`). S3
website endpoints serve plain HTTP only; the workflow's own closing line calls
`https://aiweave.org` a "custom domain (after DNS)". Whether TLS is actually in
front of that today could not be checked from the environment this was written
in — outbound requests to `aiweave.org` are blocked there.

Check it, from anywhere with a browser:

```
curl -sSI https://aiweave.org/sounding/ | head -1
```

- **200/3xx** — good, and note the `server:` header so the CORS origin below is
  right.
- **anything else** — stop. Sign-in tokens over plain HTTP are readable by
  anything on the path, and `localStorage` on an `http://` origin is shared
  with every other `http://` page on that host. Login cannot ship until this is
  fixed, and fixing it means CloudFront + ACM in front of the bucket, which is
  a DNS cutover for a domain serving four things. That is a separate change
  with a real blast radius and it is not in this stack.

### 0b. Decide the email sender before you create the pool

Cognito's built-in sender is capped at roughly **50 messages per day for the
whole AWS account**. Every sign-in on a new device costs one message, so that
ceiling is a private-pilot ceiling and nothing more. Past that it needs Amazon
SES with a verified identity, and the account must be **out of the SES sandbox
in `us-east-1`** — a support request with a lead time measured in days, not
minutes.

Leave `SesSourceArn` empty for a pilot; the parameter can be set later with a
stack update that does not replace the pool.

### 0c. Confirm two template properties still exist

Both are recent and neither could be checked against the CloudFormation
resource specification from here (AWS documentation domains are blocked in that
environment):

- `AWS::Cognito::UserPool` → `UserPoolTier: ESSENTIALS`
- `AWS::Cognito::UserPool` → `Policies.SignInPolicy.AllowedFirstAuthFactors`

Step 1 will fail loudly and harmlessly if either is wrong.

---

## 1. Validate, and see exactly what would change

From the root of the game's repository:

```bash
node infra/check-inline.mjs          # the inlined Lambda matches infra/lambda/index.js

aws cloudformation validate-template \
  --template-body file://infra/sounding-identity.yaml \
  --region us-east-1
```

Then a change set rather than a direct deploy, so the first thing anyone sees
is a list of what is about to be created:

```bash
aws cloudformation deploy \
  --template-file infra/sounding-identity.yaml \
  --stack-name sounding-identity \
  --region us-east-1 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides AllowedOrigin=https://aiweave.org \
  --no-execute-changeset
```

That prints a `describe-change-set` command. Run it. It should show **14
resources, all `Action: Add`**, and nothing at all outside this stack. If any
line mentions the bucket, the deployer role, or a resource you did not expect,
stop and ask.

**Credentials this needs:** the account owner's own identity, with permission to
create Cognito user pools, a DynamoDB table, an IAM role, a Lambda function, a
CloudWatch log group and an API Gateway v2 API. It explicitly does **not** use
`teamweave-github-actions-sam-deployer`, and that role needs no new permissions
— see README.md § 7.

## 2. Apply

```bash
aws cloudformation deploy \
  --template-file infra/sounding-identity.yaml \
  --stack-name sounding-identity \
  --region us-east-1 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides AllowedOrigin=https://aiweave.org

aws cloudformation describe-stacks \
  --stack-name sounding-identity --region us-east-1 \
  --query 'Stacks[0].Outputs' --output table
```

## 3. Put the identifiers in the game

Three outputs: `UserPoolId`, `UserPoolClientId`, `ProgressApiUrl`. All three are
**public identifiers, not secrets** — a user pool id and a client id generated
with `GenerateSecret: false` are designed to be read out of a browser bundle,
and the API URL is useless without a token. Commit them, replacing the
`REPLACE_ME` constants in `infra/reference-client/cognito.js` and
`infra/reference-client/sync.js` when that code moves into `src/engine/`.

This is why the deploy workflow in `rajatarun/aiweave` needs no change: nothing
has to be injected at build time and no GitHub Actions secret is added.

## 4. Smoke test, before any UI exists

```bash
POOL_CLIENT=<UserPoolClientId>
API=<ProgressApiUrl>
EMAIL=<an address you can read>

# create the account — a code arrives by email
aws cognito-idp sign-up --client-id "$POOL_CLIENT" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" --region us-east-1
```

If that fails with `InvalidParameterException` naming `Password`, the
passwordless sign-up assumption in `cognito.js` is wrong; use the documented
fallback in that file's `signUp()` comment (a random password, discarded) and
**say so in the report**, because it changes nothing about the design but does
change one line of the client.

```bash
aws cognito-idp confirm-sign-up --client-id "$POOL_CLIENT" \
  --username "$EMAIL" --confirmation-code <code> --region us-east-1

# sign in, passwordless
aws cognito-idp initiate-auth --client-id "$POOL_CLIENT" \
  --auth-flow USER_AUTH \
  --auth-parameters USERNAME="$EMAIL",PREFERRED_CHALLENGE=EMAIL_OTP \
  --region us-east-1
# -> Session

aws cognito-idp respond-to-auth-challenge --client-id "$POOL_CLIENT" \
  --challenge-name EMAIL_OTP --session "<Session>" \
  --challenge-responses USERNAME="$EMAIL",EMAIL_OTP_CODE=<code> \
  --region us-east-1
# -> AuthenticationResult.IdToken

ID=<IdToken>
curl -sS "$API/progress" -H "authorization: $ID"                       # {"p":null}
curl -sS -X PUT "$API/progress" -H "authorization: $ID" \
  -H 'content-type: application/json' \
  -d '{"p":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAA"}'  # 204
curl -sS "$API/progress" -H "authorization: $ID"                       # the blob back

# the width check really refuses a date
curl -sS -X PUT "$API/progress" -H "authorization: $ID" \
  -H 'content-type: application/json' \
  -d '{"p":"2026-09-07T00:00:00Z"}'                                    # 400 bad-blob

# no token, no entry
curl -sS -o /dev/null -w '%{http_code}\n' "$API/progress"              # 401
```

## 5. Settle the one open question about dates

This is the measurement that decides whether the design's central claim holds.
Read the user record, sync progress, read it again:

```bash
aws cognito-idp admin-get-user --user-pool-id <UserPoolId> \
  --username "$EMAIL" --region us-east-1 \
  --query '{created:UserCreateDate,modified:UserLastModifiedDate}'

# ... sign in again and PUT a different blob ...

aws cognito-idp admin-get-user --user-pool-id <UserPoolId> \
  --username "$EMAIL" --region us-east-1 \
  --query '{created:UserCreateDate,modified:UserLastModifiedDate}'
```

`UserLastModifiedDate` **must not have moved.** If it has, sign-in itself
touches the user record, and README.md § 3 needs correcting — the residue would
then be a genuine last-played timestamp rather than a sign-up date, and the
owner should hear about it before launch, not after.

## 6. Teardown, if the answer turns out to be no

Two protections are on deliberately, so a teardown is three commands rather
than one — an accidental `delete-stack` cannot take every player account with
it:

```bash
aws cognito-idp update-user-pool --user-pool-id <UserPoolId> \
  --deletion-protection INACTIVE --region us-east-1
aws dynamodb update-table --table-name sounding-identity-progress \
  --no-deletion-protection-enabled --region us-east-1
aws cloudformation delete-stack --stack-name sounding-identity --region us-east-1
```

The pool and the table carry `DeletionPolicy: Retain`, so `delete-stack` will
leave both behind on purpose; delete them explicitly once you are sure. Nothing
outside the stack is touched by any of this — the bucket, the site, Storybook,
the playground and the deployer role are all unaffected, before and after.

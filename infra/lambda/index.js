/**
 * index.js — the entire server side of SOUNDING's account sync.
 *
 * CommonJS, not ESM, because this file is inlined verbatim into
 * infra/sounding-identity.yaml as Lambda `Code.ZipFile`, which lands on disk as
 * index.js in a package with no package.json — so `export` would not parse.
 * `node infra/check-inline.mjs` fails if the template and this file diverge.
 *
 * The AWS SDK v3 is provided by the nodejs22.x runtime; nothing is bundled and
 * there is no build step. AWS documents the bundled SDK as a convenience whose
 * minor version they may move, which for GetItem/PutItem/DeleteItem is a risk
 * worth taking to keep this a template and not a pipeline.
 *
 * WHAT THIS FUNCTION IS NOT ALLOWED TO DO, and structurally cannot:
 *
 *  - It never reads the request body's idea of who the caller is. The
 *    partition key comes from requestContext.authorizer.jwt.claims.sub, which
 *    API Gateway's JWT authorizer set only after verifying the token's
 *    signature against the pool's JWKS, its issuer, its audience and its
 *    expiry. A client cannot address another Seeker's row.
 *  - It never writes a timestamp. There is no updatedAt, no TTL attribute, no
 *    stream on the table and no point-in-time recovery, so DynamoDB stamps
 *    nothing of its own. An item is exactly { sub, p }.
 *  - It never sees an email address. `sub` is an opaque UUID; the token's
 *    `email` claim is present in the event and deliberately unread.
 *  - It logs nothing per request. The runtime's own START/END/REPORT lines are
 *    a timestamped record that *some* account was active, and they carry a
 *    request id rather than a subject. Retention is one day. See
 *    infra/README.md § The residue.
 */

const {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME;

/**
 * 54 base64url characters and nothing else — the fixed width of the bitfield in
 * infra/reference-client/progress-codec.js. This is the check that makes the
 * "no dates" rule enforceable rather than merely intended: an ISO 8601 date is
 * the wrong alphabet and the wrong length, a JSON object is the wrong alphabet,
 * and a blob one byte longer than the fixed width is rejected outright. There
 * is no field to add one to and no room to append one.
 */
const BLOB = /^[A-Za-z0-9_-]{54}$/;

const reply = (statusCode, body) => ({
  statusCode,
  headers: body ? { 'content-type': 'application/json' } : {},
  body: body ? JSON.stringify(body) : '',
});

exports.handler = async (event) => {
  const claims = event && event.requestContext && event.requestContext.authorizer
    && event.requestContext.authorizer.jwt && event.requestContext.authorizer.jwt.claims;
  const sub = claims && claims.sub;
  if (typeof sub !== 'string' || sub.length === 0) return reply(401, { error: 'no-subject' });

  const key = { sub: { S: sub } };
  const method = event.requestContext.http.method;

  try {
    if (method === 'GET') {
      const out = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: key }));
      return reply(200, { p: (out.Item && out.Item.p && out.Item.p.S) || null });
    }

    if (method === 'PUT') {
      let blob;
      try {
        blob = JSON.parse(event.body || '{}').p;
      } catch (e) {
        return reply(400, { error: 'bad-json' });
      }
      if (!BLOB.test(String(blob))) return reply(400, { error: 'bad-blob' });
      // PutItem, not UpdateItem: the item is replaced wholesale by a literal
      // two-attribute map, so no attribute can survive from an earlier write
      // and none can be introduced by one.
      await ddb.send(new PutItemCommand({
        TableName: TABLE,
        Item: { sub: { S: sub }, p: { S: blob } },
      }));
      return reply(204, null);
    }

    if (method === 'DELETE') {
      await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: key }));
      return reply(204, null);
    }

    return reply(405, { error: 'method' });
  } catch (e) {
    // Deliberately not echoed: a DynamoDB error message names the table and
    // the account id.
    return reply(500, { error: 'store' });
  }
};

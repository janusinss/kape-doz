import Fastify, { type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { HubDatabase } from './database.js';
import { Identity, digest, type Session } from './identity.js';
import { ApiError, conflict, forbidden, notFound } from './errors.js';
import { ADMIN_ROLES, identifier, STAFF_ROLES, staffLoginSchema, adminLoginSchema, provisionAccountSchema, provisionDeviceSchema, revokeSchema, type Role } from './validation.js';
import { registerBusinessRoutes } from './business_routes.js';
import { executeCommand, getCommandStatus } from './command_outcomes.js';

const emptyQuerySchema = z.strictObject({});

function isPrivateLanHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower.endsWith('.local')) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (!ipv4) return false;
  const octets = [Number(ipv4[1]), Number(ipv4[2]), Number(ipv4[3]), Number(ipv4[4])];
  if (octets.some(o => o < 0 || o > 255)) return false;
  return octets[0] === 10 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31);
}

type Options = { databasePath: string; now?: () => number; sessionLifetimeMs?: number; allowedOrigins?:string[]; allowPrivateLanHttp?: boolean; logger?: boolean; https?: { key: Buffer; cert: Buffer } };
export async function createHub(options: Options) {
  const allowPrivateLanHttp = options.allowPrivateLanHttp ?? false;
  const allowedOrigins=new Set((options.allowedOrigins??[]).map(origin=>{
    const parsed=new URL(origin);
    const loopback=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
    const lanHttp=allowPrivateLanHttp&&parsed.protocol==='http:'&&isPrivateLanHost(parsed.hostname);
    if(parsed.origin!==origin||parsed.username||parsed.password||!(parsed.protocol==='https:'||(parsed.protocol==='http:'&&loopback)||lanHttp))throw new Error('Web origins must be exact HTTPS origins or explicit local development origins.');
    return origin;
  }));
  const sessionLifetimeMs = z.number().int().min(60_000).max(24 * 60 * 60 * 1000).default(8 * 60 * 60 * 1000).parse(options.sessionLifetimeMs);
  const store = new HubDatabase(options.databasePath);
  const now = options.now ?? Date.now;
  const identity = new Identity(store, now, sessionLifetimeMs);
  const db = store.connection;
  const querySchemas = new Map<string, z.ZodType>();
  const app = Fastify({
    ...(options.https ? { https: options.https } : {}),
    logger: options.logger ? { redact: ['req.headers.authorization','req.body.pin','req.body.password','req.body.deviceSecret','req.body.secret'] } : false,
    bodyLimit: 32 * 1024,
    requestTimeout: 15_000,
    connectionTimeout: 15_000,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
  });
  let closed = false;
  app.addHook('onClose', async () => { if (!closed) { closed = true; store.close(); } });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (options.https) reply.header('Strict-Transport-Security', 'max-age=31536000');
  });
  app.addHook('preValidation', async (request) => {
    const schema = request.method === 'GET' && request.routeOptions.url ? querySchemas.get(request.routeOptions.url) : undefined;
    request.query = (schema ?? emptyQuerySchema).parse(request.query);
  });
  app.setErrorHandler((error, request, reply) => {
    const frameworkStatus = (error as { statusCode?: number }).statusCode;
    const status = error instanceof ApiError ? error.status : error instanceof z.ZodError ? 400 : frameworkStatus && frameworkStatus < 500 ? frameworkStatus : 500;
    const code = error instanceof ApiError ? error.code : status === 400 ? 'invalid_request' : status === 413 ? 'payload_too_large' : 'request_failed';
    const message = error instanceof ApiError ? error.message : status < 500 ? 'The request is invalid.' : 'The request could not be completed.';
    if (status >= 500) request.log.error({ err: error }, 'Hub request failed');
    if (status === 429) reply.header('Retry-After', '900');
    reply.code(status).send({ error: { code, message }, requestId: request.id });
  });
  const missingResource = notFound();
  app.setNotFoundHandler((request, reply) => reply.code(missingResource.status).send({ error: { code: missingResource.code, message: missingResource.message }, requestId: request.id }));
  app.addHook('onRequest',async(request,reply)=>{
    const origin=request.headers.origin;
    if(origin) {
      if(!allowedOrigins.has(origin))throw forbidden();
      reply.header('Access-Control-Allow-Origin',origin);
      reply.header('Vary','Origin');
    }
    if(request.method==='OPTIONS') {
      const method=request.headers['access-control-request-method'];
      const headers=String(request.headers['access-control-request-headers']??'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
      if(!origin||!['GET','POST'].includes(String(method))||headers.some(header=>!['content-type','authorization','x-kape-doz-authority'].includes(header)))throw forbidden();
      reply.header('Access-Control-Allow-Methods','GET, POST');
      reply.header('Access-Control-Allow-Headers','Authorization, Content-Type, X-Kape-Doz-Authority');
      return reply.code(204).send();
    }
  });
  app.options('/*',async(_request,reply)=>reply.code(204).send());

  const authorize = (request: FastifyRequest, roles?: readonly Role[]): Session => {
    const session = identity.authenticate(request.headers.authorization);
    if (roles && !roles.includes(session.actor.role)) throw forbidden();
    const expectedAuthority = request.headers['x-kape-doz-authority'];
    if (expectedAuthority !== undefined) {
      const authorityId = z.uuid().parse(expectedAuthority);
      if (authorityId !== store.authorityId) throw new ApiError(409, 'authority_mismatch', 'The connected hub does not match the saved operation.');
    }
    if(request.method==='POST') store.transaction(()=>{
      for(const [scope,subject] of [['mutation:ip',digest(request.ip)],['mutation:actor',digest(session.actor.id)]]) {
        const row=db.prepare('SELECT window_start,used FROM request_limits WHERE scope=? AND subject=?').get(scope!,subject!);
        const active=row&&Number(row.window_start)+60_000>now();
        if(active&&Number(row.used)>=60) throw new ApiError(429,'rate_limited','Too many requests. Try again later.');
        db.prepare(`INSERT INTO request_limits(scope,subject,window_start,used) VALUES(?,?,?,1)
          ON CONFLICT(scope,subject) DO UPDATE SET window_start=excluded.window_start,used=?`).run(scope!,subject!,active?Number(row.window_start):now(),active?Number(row.used)+1:1);
      }
    });
    return session;
  };

  app.get('/health', async () => {
    db.prepare('SELECT 1 AS ready').get();
    return { status: 'ready' };
  });
  app.post('/api/v1/auth/staff', async (request) => {
    const input = staffLoginSchema.parse(request.body);
    return identity.login({ accountId: input.accountId, secret: input.pin, deviceId: input.deviceId, deviceSecret: input.deviceSecret }, 'staff', request.ip);
  });
  app.post('/api/v1/auth/admin', async (request) => {
    const input = adminLoginSchema.parse(request.body);
    return identity.login({ accountId: input.accountId, secret: input.password }, 'admin', request.ip);
  });
  app.get('/api/v1/me', async (request) => {
    const session = authorize(request);
    return { actor: session.actor, expiresAt: session.expiresAt };
  });
  app.get('/api/v1/authority', async (request) => {
    const { actor } = authorize(request, ADMIN_ROLES);
    return { authorityId: store.authorityId, branchId: actor.branchId };
  });
  app.get('/api/v1/commands/:commandId', async (request) => {
    const { actor, deviceId } = authorize(request);
    const { commandId } = z.strictObject({ commandId: z.uuid() }).parse(request.params);
    return getCommandStatus(db, actor, deviceId, commandId);
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const session = authorize(request);
    z.strictObject({}).parse(request.body ?? {});
    db.prepare('UPDATE sessions SET revoked=1 WHERE token_hash=?').run(session.tokenHash);
    return reply.code(204).send();
  });
  app.get('/api/v1/staff/context', async (request) => {
    const { actor } = authorize(request, STAFF_ROLES);
    return { actor, branchId: actor.branchId, modules: actor.role === 'cashier' ? ['cashier'] : ['station','waste'] };
  });
  app.get('/api/v1/admin/context', async (request) => {
    const { actor } = authorize(request, ADMIN_ROLES);
    return { actor, branchId: actor.branchId, modules: ['sales','recipes','inventory','customers','settings','approvals'] };
  });
  app.get('/api/v1/devices', async (request) => {
    const { actor } = authorize(request, ['owner']);
    const devices = db.prepare('SELECT id,branch_id,version,revoked FROM devices WHERE branch_id=? ORDER BY id').all(actor.branchId);
    return { devices: devices.map((device) => ({ id: device.id, branchId: device.branch_id, version: device.version, revoked: !!device.revoked })) };
  });
  app.post('/api/v1/devices/:id/revoke', async (request) => {
    const { actor } = authorize(request, ['owner']);
    const { id } = z.strictObject({ id: identifier }).parse(request.params);
    const input = revokeSchema.parse(request.body);
    const fingerprint = digest(JSON.stringify({ action: 'device.revoke', id, expectedVersion: input.expectedVersion }));
    return executeCommand(store, now, {
      actor, deviceId: null, commandId: input.commandId, action: 'device.revoke', target: id, fingerprint,
      acceptedEvent: () => ({ deviceId: id, version: input.expectedVersion + 1, revoked: true }),
      acceptedOutboxType: 'device.revoked',
    }, () => {
      const device = db.prepare('SELECT id,branch_id,version,revoked FROM devices WHERE id=? AND branch_id=?').get(id, actor.branchId);
      if (!device) throw notFound();
      if (device.version !== input.expectedVersion || device.revoked) throw conflict();
      const version = input.expectedVersion + 1;
      db.prepare('UPDATE devices SET revoked=1,version=? WHERE id=? AND branch_id=?').run(version, id, actor.branchId);
      db.prepare('UPDATE sessions SET revoked=1 WHERE device_id=?').run(id);
      return { device: { id, branchId: actor.branchId, version, revoked: true } };
    });
  });

  async function provisionAccount(value: z.input<typeof provisionAccountSchema>) {
    const input = provisionAccountSchema.parse(value);
    const credential = await hash(input.secret, 12);
    store.transaction(() => {
      db.prepare('INSERT INTO branches(id) VALUES(?) ON CONFLICT(id) DO NOTHING').run(input.branchId);
      db.prepare('INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,?,?,?,?)').run(input.id, input.branchId, input.displayName, input.role, credential);
    });
  }
  async function provisionDevice(value: z.input<typeof provisionDeviceSchema>) {
    const input = provisionDeviceSchema.parse(value);
    store.transaction(() => {
      db.prepare('INSERT INTO branches(id) VALUES(?) ON CONFLICT(id) DO NOTHING').run(input.branchId);
      db.prepare('INSERT INTO devices(id,branch_id,secret_hash) VALUES(?,?,?)').run(input.id, input.branchId, digest(input.secret));
    });
  }
  registerBusinessRoutes(app,store,authorize,now,querySchemas);
  return { app, close: () => app.close(), provisionAccount, provisionDevice };
}

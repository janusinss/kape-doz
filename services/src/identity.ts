import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import type { HubDatabase } from './database.js';
import { ApiError, unauthorized } from './errors.js';
import { isAdminRole, isStaffRole, type Role } from './validation.js';

export { isAdminRole, isStaffRole };

const windowMs = 15 * 60 * 1000;
const sessionMs = 8 * 60 * 60 * 1000;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const dummyCredential = hash(randomBytes(32).toString('hex'), 12);
type AccountRow = { id: string; display_name: string; role: Role; branch_id: string; credential_hash: string; disabled: number };
export type Actor = { id: string; displayName: string; role: Role; branchId: string };
export type Session = { actor: Actor; expiresAt: number; tokenHash: string; deviceId:string|null };
type AttemptReservation = { scope: string; subject: string; startedAt: number };
const actor = (row: AccountRow): Actor => ({ id: row.id, displayName: row.display_name, role: row.role, branchId: row.branch_id });

export class Identity {
  constructor(private store: HubDatabase, private now: () => number, private sessionLifetimeMs = sessionMs) {}

  private reserveAttempt(scope: string, subject: string): AttemptReservation {
    const db = this.store.connection;
    const time = this.now();
    const row = db.prepare('SELECT started_at,attempts,in_flight FROM auth_attempts WHERE scope=? AND subject=?').get(scope, subject);
    const active = row && Number(row.started_at) + windowMs > time;
    if (active && Number(row.attempts) + Number(row.in_flight) >= 5) {
      throw new ApiError(429, 'rate_limited', 'Too many attempts. Try again later.');
    }
    const startedAt = active ? Number(row.started_at) : time;
    db.prepare(`INSERT INTO auth_attempts(scope,subject,started_at,attempts,in_flight) VALUES(?,?,?,0,1)
      ON CONFLICT(scope,subject) DO UPDATE SET started_at=excluded.started_at,attempts=?,in_flight=?`).run(
      scope, subject, startedAt, active ? Number(row.attempts) : 0, active ? Number(row.in_flight) + 1 : 1,
    );
    return { scope, subject, startedAt };
  }

  private finishAttempts(reservations: AttemptReservation[], successful: boolean) {
    for (const item of reservations) {
      this.store.connection.prepare(`UPDATE auth_attempts SET in_flight=MAX(0,in_flight-1),
        attempts=CASE WHEN ? THEN 0 ELSE attempts + ? END WHERE scope=? AND subject=? AND started_at=?`).run(
        successful && item.scope.endsWith(':account') ? 1 : 0, successful ? 0 : 1, item.scope, item.subject, item.startedAt,
      );
    }
  }

  async login(input: { accountId: string; secret: string; deviceId?: string; deviceSecret?: string }, channel: 'staff' | 'admin', ip: string) {
    // Reserve before the bcrypt await so simultaneous attempts cannot bypass the limit.
    const subject = digest(input.accountId);
    const reservations = this.store.transaction(() => [
      this.reserveAttempt(channel + ':ip', digest(ip)), this.reserveAttempt(channel + ':account', subject),
    ]);
    let finalized = false;
    try {
    const account = this.store.connection.prepare('SELECT id,display_name,role,branch_id,credential_hash,disabled FROM accounts WHERE id=?').get(input.accountId) as AccountRow | undefined;
    const validSecret = await compare(input.secret, account?.credential_hash ?? await dummyCredential);
    const correctChannel = account && (channel === 'staff' ? isStaffRole(account.role) : isAdminRole(account.role));
    let validDevice = channel === 'admin';
    if (channel === 'staff') {
      const device = this.store.connection.prepare('SELECT branch_id,secret_hash,revoked FROM devices WHERE id=?').get(input.deviceId ?? '');
      const actual = Buffer.from(digest(input.deviceSecret ?? ''), 'hex');
      const expected = Buffer.from(device ? String(device.secret_hash) : digest('absent-device'), 'hex');
      validDevice = timingSafeEqual(actual, expected) && !!device && !device.revoked && device.branch_id === account?.branch_id;
    }
    if (!account || account.disabled || !correctChannel || !validSecret || !validDevice) throw unauthorized();
    // Re-read current identity/device state after hashing; revocation during verification must win.
    const result = this.store.transaction(() => {
      const current = this.store.connection.prepare('SELECT disabled,role FROM accounts WHERE id=?').get(account.id);
      const device = channel === 'staff' ? this.store.connection.prepare('SELECT revoked FROM devices WHERE id=?').get(input.deviceId!) : undefined;
      if (!current || current.disabled || current.role !== account.role || (channel === 'staff' && (!device || device.revoked))) throw unauthorized();
      this.finishAttempts(reservations, true);
      const token = randomBytes(32).toString('base64url');
      const expiresAt = this.now() + this.sessionLifetimeMs;
      this.store.connection.prepare('INSERT INTO sessions(token_hash,account_id,device_id,expires_at) VALUES(?,?,?,?)').run(digest(token), account.id, input.deviceId ?? null, expiresAt);
      return { token, expiresAt, actor: actor(account) };
    });
    finalized = true;
    return result;
    } finally {
      if (!finalized) this.store.transaction(() => this.finishAttempts(reservations, false));
    }
  }

  authenticate(authorization: string | undefined): Session {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '')?.[1];
    if (!token) throw unauthorized();
    const tokenHash = digest(token);
    const row = this.store.connection.prepare(`SELECT a.id,a.display_name,a.role,a.branch_id,a.credential_hash,a.disabled,
        s.expires_at,s.revoked,s.device_id,d.revoked AS device_revoked,d.branch_id AS device_branch
      FROM sessions s JOIN accounts a ON a.id=s.account_id LEFT JOIN devices d ON d.id=s.device_id
      WHERE s.token_hash=?`).get(tokenHash);
    if (!row || row.disabled || row.revoked || Number(row.expires_at) <= this.now()) throw unauthorized();
    const staff = isStaffRole(String(row.role));
    if (staff && (!row.device_id || row.device_revoked !== 0 || row.device_branch !== row.branch_id)) throw unauthorized();
    if (!staff && row.device_id !== null) throw unauthorized();
    return { actor: actor(row as AccountRow), expiresAt: Number(row.expires_at), tokenHash, deviceId: row.device_id===null?null:String(row.device_id) };
  }
}

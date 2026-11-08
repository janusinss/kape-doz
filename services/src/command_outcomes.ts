import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { HubDatabase } from './database.js';
import type { Actor } from './identity.js';
import { ApiError, conflict, notFound } from './errors.js';

type Context<T> = {
  actor: Actor;
  deviceId: string | null;
  commandId: string;
  action: string;
  target: string;
  fingerprint: string;
  acceptedEvent?: (result: T & { commandId: string }) => Record<string, unknown>;
  acceptedOutboxType?: string;
};

/** One serialized identity fences accepted and rejected outcomes alike. */
export function executeCommand<T extends Record<string, unknown>>(
  store: HubDatabase, now: () => number, context: Context<T>, perform: () => T,
): T & { commandId: string } {
  const db = store.connection;
  const { actor, deviceId, commandId, action, target, fingerprint } = context;
  const outcome = store.transaction(() => {
    const previous = db.prepare('SELECT actor_id,branch_id,device_id,action,fingerprint,response_json,outcome,rejection_status FROM command_receipts WHERE id=?').get(commandId);
    if (previous) {
      if (previous.actor_id !== actor.id || previous.branch_id !== actor.branchId || previous.device_id !== deviceId || previous.action !== action || previous.fingerprint !== fingerprint) throw conflict();
      const response = JSON.parse(String(previous.response_json)) as Record<string, unknown>;
      if (previous.outcome === 'rejected') {
        const error = response.error as { code: string; message: string };
        return { response, rejection: new ApiError(Number(previous.rejection_status), error.code, error.message) };
      }
      return { response, rejection: null };
    }
    let response: Record<string, unknown>;
    let rejection: ApiError | null = null;
    db.exec('SAVEPOINT command_business');
    try {
      response = { ...perform(), commandId };
      db.exec('RELEASE SAVEPOINT command_business');
    } catch (error) {
      db.exec('ROLLBACK TO SAVEPOINT command_business');
      db.exec('RELEASE SAVEPOINT command_business');
      // Transport/schema/auth failures and unexpected errors are not final.
      if (!(error instanceof ApiError) || ![400, 404, 409, 413].includes(error.status)) throw error;
      rejection = error;
      response = { error: { code: error.code, message: error.message } };
    }
    const time = now();
    db.prepare('INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at,device_id,outcome,rejection_status) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(commandId, actor.id, actor.branchId, action, fingerprint, JSON.stringify(response), time, deviceId, rejection ? 'rejected' : 'accepted', rejection?.status ?? null);
    const branch = db.prepare('SELECT business_id FROM branches WHERE id=?').get(actor.branchId);
    if (!branch) throw notFound();
    const eventAction = rejection ? action + '.rejected' : action;
    const event = JSON.stringify(!rejection && context.acceptedEvent
      ? context.acceptedEvent(response as T & { commandId: string })
      : { schemaVersion: 1, businessId: String(branch.business_id), branchId: actor.branchId, actorId: actor.id, deviceId, acceptedAt: time, action, target,
        ...(rejection ? { outcome: 'rejected', errorCode: rejection.code } : {}) });
    db.prepare('INSERT INTO audit_events(id,command_id,actor_id,branch_id,action,payload_json,accepted_at,device_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), commandId, actor.id, actor.branchId, eventAction, event, time, deviceId);
    db.prepare('INSERT INTO outbox(id,command_id,branch_id,event_type,payload_json,created_at,device_id) VALUES(?,?,?,?,?,?,?)')
      .run(randomUUID(), commandId, actor.branchId, rejection ? eventAction : context.acceptedOutboxType ?? action, event, time, deviceId);
    return { response, rejection };
  });
  // The outer transaction must commit the rejection before HTTP exposes it.
  if (outcome.rejection) throw outcome.rejection;
  return outcome.response as T & { commandId: string };
}

export function getCommandStatus(db: DatabaseSync, actor: Actor, deviceId: string | null, commandId: string) {
  const receipt = db.prepare(`
    SELECT action, accepted_at, outcome, response_json FROM command_receipts
    WHERE id = ? AND branch_id = ? AND actor_id = ? AND device_id IS ?
  `).get(commandId, actor.branchId, actor.id, deviceId);
  if (!receipt) return { commandId, status: 'unrecorded' as const };
  if (receipt.outcome === 'rejected') {
    const response = JSON.parse(String(receipt.response_json)) as { error: { code: string; message: string } };
    return { commandId, status: 'rejected' as const, action: receipt.action, rejectedAt: receipt.accepted_at, error: response.error };
  }
  return { commandId, status: 'accepted' as const, action: receipt.action, acceptedAt: receipt.accepted_at };
}

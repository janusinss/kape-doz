import { HubError, validateCommandStatus, type Mutation, type Session } from './api';
import type { AdminRecoveryScope, AdminRecoveryStore, PendingAdminCommand } from './admin_recovery';
import { parseHubOrigin } from './origin';
import { canonicalJson, isAdminRole, isUuid, matchesScope } from './primitives';

export type RecoveryDependencies = {
  isCurrent: () => boolean;
  status: (session: Session, command: Mutation) => Promise<unknown>;
  mutate: (session: Session, command: Mutation) => Promise<void>;
  refresh: (session: Session, command: Mutation) => Promise<void>;
};

export type DurableRecoveryDependencies = RecoveryDependencies & {
  store: Pick<AdminRecoveryStore, 'load' | 'savePending' | 'clearPending'>;
};

export function recoveryScope(session: Session): AdminRecoveryScope {
  try {
    if (parseHubOrigin(session.hubOrigin) !== session.hubOrigin || !isUuid(session.authorityId) ||
      !isAdminRole(session.actor.role)) throw new Error();
  } catch { throw new HubError('Sign in again to confirm the connected hub.'); }
  return { hubOrigin: session.hubOrigin, authorityId: session.authorityId, actorId: session.actor.id,
    branchId: session.actor.branchId, role: session.actor.role };
}

export function pendingMatchesSession(command: PendingAdminCommand, session: Session): boolean {
  return matchesScope(command, recoveryScope(session));
}

function assertDurableCurrent(session: Session, command: PendingAdminCommand, dependencies: DurableRecoveryDependencies): void {
  if (!dependencies.isCurrent() || session.expiresAt <= Date.now() || !pendingMatchesSession(command, session)) {
    throw new HubError('Sign in with the original account and hub to confirm the saved command.');
  }
}

function guardedDependencies(session: Session, command: PendingAdminCommand, dependencies: DurableRecoveryDependencies): RecoveryDependencies {
  return { ...dependencies, isCurrent: () => { assertDurableCurrent(session, command, dependencies); return true; } };
}

async function clearTerminal(session: Session, command: PendingAdminCommand, dependencies: DurableRecoveryDependencies): Promise<void> {
  assertDurableCurrent(session, command, dependencies);
  const cleared = await dependencies.store.clearPending(command.id, recoveryScope(session));
  assertDurableCurrent(session, command, dependencies);
  if (cleared.pending !== null) throw new HubError('The saved command changed. Reload its state before continuing.');
}

/** Save-before-send is required even when the page closes before the response. */
export async function submitDurableCommand(
  session: Session, command: PendingAdminCommand, dependencies: DurableRecoveryDependencies,
): Promise<'accepted' | 'rejected' | 'unrecorded'> {
  assertDurableCurrent(session, command, dependencies);
  const saved = await dependencies.store.savePending(command);
  assertDurableCurrent(session, command, dependencies);
  if (!saved.pending || canonicalJson(saved.pending) !== canonicalJson(command)) throw new HubError('The saved command changed. Reload its state before continuing.');
  try {
    await dependencies.mutate(session, command);
  } catch (error) {
    assertDurableCurrent(session, command, dependencies);
    if (!(error instanceof HubError) || error.unknown || error.status === undefined || ![400, 404, 409, 413].includes(error.status)) throw error;
    const result = await recoverCommand(session, command, guardedDependencies(session, command, dependencies), false);
    if (result !== 'unrecorded') await clearTerminal(session, command, dependencies);
    return result;
  }
  assertDurableCurrent(session, command, dependencies);
  await dependencies.refresh(session, command);
  await clearTerminal(session, command, dependencies);
  return 'accepted';
}

/** Recovery reads the current durable descriptor before any status or retry. */
export async function recoverDurableCommand(
  session: Session, command: PendingAdminCommand, dependencies: DurableRecoveryDependencies, retryUnrecorded = true,
): Promise<'accepted' | 'rejected' | 'unrecorded'> {
  assertDurableCurrent(session, command, dependencies);
  const current = await dependencies.store.load();
  assertDurableCurrent(session, command, dependencies);
  if (!current.pending || canonicalJson(current.pending) !== canonicalJson(command)) throw new HubError('The saved command changed. Reload its state before continuing.');
  const result = await recoverCommand(session, command, guardedDependencies(session, command, dependencies), retryUnrecorded);
  if (result !== 'unrecorded') await clearTerminal(session, command, dependencies);
  return result;
}

/** A point-in-time missing receipt never authorizes dropping or replacing an ID. */
export async function recoverCommand(
  session: Session, command: Mutation, dependencies: RecoveryDependencies, retryUnrecorded = true,
): Promise<'accepted' | 'rejected' | 'unrecorded'> {
  function assertCurrent() {
    if (!dependencies.isCurrent() || session.actor.id !== command.actorId || session.actor.branchId !== command.branchId) {
      throw new HubError('Sign in with the original account to confirm this saved command.');
    }
  }
  assertCurrent();
  let status = validateCommandStatus(await dependencies.status(session, command), command);
  assertCurrent();
  if (status.status === 'unrecorded' && retryUnrecorded) {
    let retryAccepted = false;
    try {
      await dependencies.mutate(session, command);
      assertCurrent();
      retryAccepted = true;
    } catch (error) {
      assertCurrent();
      status = validateCommandStatus(await dependencies.status(session, command), command);
      assertCurrent();
      if (status.status === 'unrecorded') throw error;
    }
    if (retryAccepted) {
      await dependencies.refresh(session, command);
      assertCurrent();
      return 'accepted';
    }
  }
  if (status.status === 'unrecorded') return 'unrecorded';
  await dependencies.refresh(session, command);
  assertCurrent();
  return status.status;
}

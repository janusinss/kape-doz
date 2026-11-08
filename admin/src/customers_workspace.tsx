import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ActionModal } from './action_modal';
import {
  api, type CustomerPolicy, type CustomerRecord, type LoyaltyCloudState,
  type LoyaltyRedemption, type LoyaltyRefundCase, type Session,
} from './api';
import { idRouteSegment } from './primitives';
import { Cell, DataState, Heading, Rows, dateTime, field, fixedPoint, money, useData, type SubmitCommand, type WorkspaceProps } from './workspaces';

const activityNames = { active: 'Active', inactive: 'Inactive', no_purchases: 'No purchases' } as const;
type Segment = 'all' | keyof typeof activityNames | 'vip';
type ActionProps = { submit: SubmitCommand; disabled: boolean; busy: boolean; onBack: () => void };
type CustomerDialog =
  | { kind: 'add' }
  | { kind: 'profile'; id: string }
  | { kind: 'policy'; policy: CustomerPolicy }
  | { kind: 'cloud'; cloud: LoyaltyCloudState }
  | { kind: 'redemptions'; entries: LoyaltyRedemption[] }
  | { kind: 'refunds'; entries: LoyaltyRefundCase[] };

const displayStatus = (value: string) => value.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
const points = (value: number) => `${value.toLocaleString('en-PH')} pts`;
const cloudModes = { online: 'Online', offline: 'Offline', timeout: 'Timeout' };

function Summary({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="settings-summary customer-summary">
    {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>;
}

function ActionFooter({ busy, disabled, onBack, label, backLabel = 'Cancel', danger = false }: Pick<ActionProps, 'busy' | 'disabled' | 'onBack'> & {
  label: string; backLabel?: string; danger?: boolean;
}) {
  return <div className="accounts-modal-footer">
    <button type="button" onClick={onBack} disabled={busy}>{backLabel}</button>
    <button type="submit" className={danger ? 'devices-danger-solid' : 'primary'} disabled={disabled || busy}>
      {busy ? 'Saving…' : label}
    </button>
  </div>;
}

function Done({ onClose }: { onClose: () => void }) {
  return <div className="accounts-modal-footer"><button type="button" onClick={onClose}>Done</button></div>;
}

function CustomerForm({ customer, ...action }: ActionProps & { customer?: CustomerRecord }) {
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.disabled || action.busy) return;
    const data = new FormData(event.currentTarget);
    const displayName = field(data, 'displayName');
    if (!displayName) { setError('Enter the customer’s name.'); return; }
    const customerId = field(data, 'customerId');
    const details = { displayName, phone: field(data, 'phone'), notes: field(data, 'notes') };
    await action.submit(
      customer ? `/api/v1/customers/${encodeURIComponent(customer.id)}` : '/api/v1/customers',
      customer ? { ...details, expectedVersion: customer.version } : { ...details, ...(customerId ? { customerId } : {}) },
      customer ? 'Customer profile updated.' : 'Customer added.',
    );
  }
  return <form onSubmit={e => void save(e)} onChange={() => setError('')}>
    <p className="quiet">{customer ? `Editing the profile for ${customer.displayName}.` : 'Enter a name to add a customer. Contact details and notes are optional.'}</p>
    <fieldset disabled={action.disabled || action.busy} className="settings-fields">
      <legend>Contact details</legend>
      <div className="settings-form-grid">
        <label>Customer name<input name="displayName" defaultValue={customer?.displayName} maxLength={120} required /></label>
        <label>Phone (optional)<input type="tel" name="phone" defaultValue={customer?.phone} maxLength={40} /></label>
      </div>
      <label>Notes (optional)<textarea name="notes" defaultValue={customer?.notes} rows={3} maxLength={500} /></label>
      {!customer && <label>Customer ID (optional)
        <input name="customerId" maxLength={100} pattern={idRouteSegment} autoCapitalize="none" spellCheck={false} />
        <span className="accounts-help">Leave blank to generate an ID. Custom IDs start with a letter or number.</span>
      </label>}
    </fieldset>
    {error && <p className="notice error" role="alert">{error}</p>}
    <ActionFooter {...action} label={customer ? 'Save profile' : 'Add customer'} backLabel={customer ? 'Back to profile' : 'Cancel'} />
  </form>;
}

function PolicyForm({ policy, isOwner, ...action }: ActionProps & { policy: CustomerPolicy; isOwner: boolean }) {
  const [vipRule, setVipRule] = useState(policy.vipRule);
  const [error, setError] = useState('');
  if (!isOwner) return <>
    <p className="quiet">An owner can change these settings.</p>
    <Summary rows={[
      ['Inactive after', `${policy.inactivityDays} days`],
      ['VIP qualification', policy.vipRule === 'lifetime_spend' ? `${money(policy.vipThreshold)} lifetime net spend` : policy.vipRule === 'purchase_count' ? `${policy.vipThreshold} qualifying purchases` : 'Not configured'],
      ['Points expire after', policy.pointsExpiryDays === null ? 'No expiry' : `${policy.pointsExpiryDays} days`],
    ]} />
    <Done onClose={action.onBack} />
  </>;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.disabled || action.busy) return;
    const data = new FormData(event.currentTarget);
    const inactivityDays = fixedPoint(field(data, 'inactivityDays'), 0, 3650);
    const threshold = field(data, 'vipThreshold');
    const vipThreshold = vipRule === 'unconfigured' ? null : fixedPoint(threshold, vipRule === 'lifetime_spend' ? 2 : 0, vipRule === 'lifetime_spend' ? 100_000_000_000 : 1_000_000);
    const expiry = field(data, 'pointsExpiryDays');
    const pointsExpiryDays = expiry ? fixedPoint(expiry, 0, 3650) : null;
    if (!inactivityDays) { setError('Enter 1–3,650 days for inactivity.'); return; }
    if (vipRule !== 'unconfigured' && !vipThreshold) { setError('Enter a positive VIP threshold for the selected rule.'); return; }
    if (expiry && !pointsExpiryDays) { setError('Enter 1–3,650 days for expiry or leave it blank.'); return; }
    await action.submit('/api/v1/customers/policy', { expectedVersion: policy.version, inactivityDays, vipRule, vipThreshold, pointsExpiryDays }, 'Customer settings saved.');
  }
  return <form onSubmit={e => void save(e)} onChange={() => setError('')}>
    <fieldset className="settings-fields" disabled={action.disabled || action.busy}>
      <legend>Customer activity</legend>
      <label>Inactive after (days)<input type="number" name="inactivityDays" min={1} max={3650} defaultValue={policy.inactivityDays} required />
        <span className="accounts-help">Customers with purchases become inactive when their last qualifying purchase falls outside this window.</span>
      </label>
    </fieldset>
    <fieldset className="settings-fields settings-fields-divider" disabled={action.disabled || action.busy}>
      <legend>VIP & points</legend>
      <label>VIP qualification<select value={vipRule} onChange={e => setVipRule(e.target.value as CustomerPolicy['vipRule'])}>
        <option value="unconfigured">No VIP rule</option><option value="lifetime_spend">Lifetime net spend</option><option value="purchase_count">Qualifying purchases</option>
      </select></label>
      {vipRule !== 'unconfigured' && <label key={vipRule}>{vipRule === 'lifetime_spend' ? 'Minimum net spend (PHP)' : 'Minimum qualifying purchases'}
        <input name="vipThreshold" inputMode={vipRule === 'lifetime_spend' ? 'decimal' : 'numeric'} required
          defaultValue={vipRule !== policy.vipRule || policy.vipThreshold === null ? '' : vipRule === 'lifetime_spend' ? (policy.vipThreshold / 100).toFixed(2) : policy.vipThreshold} />
      </label>}
      <label>Points expire after (days, optional)<input type="number" name="pointsExpiryDays" min={1} max={3650} defaultValue={policy.pointsExpiryDays ?? ''} />
        <span className="accounts-help">Leave blank for no expiry.</span>
      </label>
    </fieldset>
    {error && <p className="notice error" role="alert">{error}</p>}
    <ActionFooter {...action} label="Save settings" />
  </form>;
}

function CustomerProfile({ id, workspace, ...action }: ActionProps & { id: string; workspace: WorkspaceProps }) {
  const [view, setView] = useState<'overview' | 'orders' | 'points'>('overview');
  const [edit, setEdit] = useState<CustomerRecord | null>(null);
  const load = useCallback((session: Session) => api.customerProfile(session, id), [id]);
  const data = useData(workspace, load);
  if (edit) return <CustomerForm {...action} customer={edit} onBack={() => setEdit(null)} />;
  const profile = data.value;
  return <>
    <DataState state={data}>{profile && <>
      <div className="settings-section-header customer-profile-heading">
        <div><h3>{profile.customer.displayName}</h3><p>{activityNames[profile.customer.activityStatus]}{profile.customer.isVip ? ' · VIP' : ''}</p></div>
        <button type="button" disabled={action.disabled} onClick={() => setEdit(profile.customer)}>Edit profile</button>
      </div>
      <div className="customer-profile-nav" role="group" aria-label="Profile section">
        <button type="button" aria-pressed={view === 'overview'} onClick={() => setView('overview')}>Overview</button>
        <button type="button" aria-pressed={view === 'orders'} onClick={() => setView('orders')}>Orders ({profile.orders.length})</button>
        <button type="button" aria-pressed={view === 'points'} onClick={() => setView('points')}>Points history ({profile.ledger.length})</button>
      </div>
      {view === 'overview' && <>
        <Summary rows={[
          ['Available points', points(profile.customer.availablePoints)], ['Pending points', points(profile.customer.pendingPoints)],
          ['Lifetime net spend', money(profile.customer.lifetimeNetSpendCentavos)], ['Qualifying purchases', profile.customer.qualifyingPurchaseCount],
          ['Last purchase', profile.customer.lastPurchaseDate ?? 'No purchases'], ['Phone', profile.customer.phone || 'Not provided'],
          ['Customer ID', profile.customer.id], ['Notes', profile.customer.notes || 'No notes'],
        ]} />
        <p className="settings-note">Pending points become spendable after loyalty sync.</p>
      </>}
      {view === 'orders' && (!profile.orders.length ? <p className="empty">No orders linked to this customer.</p> :
        <Rows columns={['Order', 'Amount', 'Points']}>{profile.orders.map(order => <tr key={order.orderId}>
          <Cell label="Order"><div><strong>#{order.orderNo}</strong><span className="record-id">{order.businessDate ?? 'Unsettled'}{order.cancelled ? ' · Cancelled' : ''}</span></div></Cell>
          <Cell label="Amount"><div>{money(order.totalCentavos)}{order.refundedCentavos > 0 && <span className="record-id">Refunded {money(order.refundedCentavos)}</span>}</div></Cell>
          <Cell label="Points"><div>+{order.earnedPoints} earned<span className="record-id">{order.redeemedPoints} redeemed</span></div></Cell>
        </tr>)}</Rows>)}
      {view === 'points' && (!profile.ledger.length ? <p className="empty">No points activity yet.</p> :
        <Rows columns={['Activity', 'Points', 'Status']}>{profile.ledger.map(entry => <tr key={entry.id}>
          <Cell label="Activity"><div><strong>{displayStatus(entry.kind)}</strong><span className="record-id">{dateTime(entry.createdAt)}</span></div></Cell>
          <Cell label="Points">{entry.pointsDelta > 0 ? '+' : ''}{points(entry.pointsDelta)}</Cell>
          <Cell label="Status">{displayStatus(entry.status)}</Cell>
        </tr>)}</Rows>)}
    </>}</DataState>
    <Done onClose={action.onBack} />
  </>;
}

function CloudReview({ cloud, ...action }: ActionProps & { cloud: LoyaltyCloudState }) {
  const [view, setView] = useState<'summary' | 'sync' | 'mode'>('summary');
  const [mode, setMode] = useState(cloud.loyaltyCloudMode);
  const canSync = cloud.loyaltyCloudMode === 'online' && cloud.pendingEntriesCount > 0;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.disabled || action.busy) return;
    if (view === 'sync' && canSync) await action.submit('/api/v1/loyalty/sync', {}, 'Pending loyalty points synced.');
    if (view === 'mode' && mode !== cloud.loyaltyCloudMode) await action.submit('/api/v1/loyalty/cloud-mode', { mode }, 'Loyalty mode updated.');
  }
  if (view === 'summary') return <>
    <p className="quiet">Review points waiting to sync and the branch’s loyalty service mode.</p>
    <Summary rows={[
      ['Current mode', cloudModes[cloud.loyaltyCloudMode]],
      ['Waiting to sync', `${points(cloud.pendingPointsTotal)} across ${cloud.pendingEntriesCount} entries`],
      ['Last sync', cloud.lastSyncedAt === null ? 'No sync yet' : dateTime(cloud.lastSyncedAt)],
    ]} />
    <p className="settings-note">{cloud.loyaltyCloudMode !== 'online' ? 'Switch the mode to Online before syncing points.' : !canSync ? 'There are no pending entries to sync.' : 'Syncing moves pending points into available balances.'}</p>
    <div className="accounts-modal-footer customer-actions">
      <button type="button" onClick={action.onBack}>Done</button>
      <button type="button" disabled={action.disabled} onClick={() => setView('mode')}>Change mode</button>
      <button type="button" className="primary" disabled={action.disabled || !canSync} onClick={() => setView('sync')}>Review sync</button>
    </div>
  </>;
  return <form onSubmit={e => void save(e)}>
    <h3>{view === 'sync' ? 'Sync pending points' : 'Change loyalty mode'}</h3>
    {view === 'sync' ? <p>Sync {cloud.pendingEntriesCount} pending entries ({points(cloud.pendingPointsTotal)}) so customers can use those points.</p> : <>
      <p className="quiet">Offline and Timeout simulate a service interruption for loyalty transactions.</p>
      <label>Service mode<select aria-label="Service mode" disabled={action.disabled} value={mode} onChange={e => setMode(e.target.value as LoyaltyCloudState['loyaltyCloudMode'])}>
        {Object.entries(cloudModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </>}
    <ActionFooter {...action} onBack={() => setView('summary')} backLabel="Back" label={view === 'sync' ? 'Sync points' : 'Save mode'} disabled={action.disabled || (view === 'sync' ? !canSync : mode === cloud.loyaltyCloudMode)} />
  </form>;
}


type RedemptionAction = 'approve' | 'deny' | 'validate' | 'authorized' | 'not_debited';
const redemptionLabels: Record<RedemptionAction, string> = {
  approve: 'Approve request', deny: 'Deny request', validate: 'Validate redemption',
  authorized: 'Record verified authorization', not_debited: 'Record no debit',
};
const redemptionHelp: Record<RedemptionAction, string> = {
  approve: 'Approval moves the request to loyalty validation. The discount is applied only after authorization.',
  deny: 'This ends the request without applying the discount.',
  validate: 'Check authorization for this request. If the service times out, the outcome will need reconciliation.',
  authorized: 'Use this only after verifying that the points were debited. Record the reference from the verified authorization.',
  not_debited: 'Use this only after verifying that the points were not debited. The discount will not be applied.',
};

function redemptionActions(item: LoyaltyRedemption): RedemptionAction[] {
  if (item.status === 'pending' && item.cloudStatus === 'pending_approval') return ['approve', 'deny'];
  if (item.status === 'approved' && item.cloudStatus === 'awaiting_cloud') return ['validate'];
  if (item.cloudStatus === 'cloud_unknown') return ['authorized', 'not_debited'];
  return [];
}

function redemptionStatus(item: LoyaltyRedemption) {
  if (item.status === 'pending' && item.cloudStatus === 'pending_approval') return 'Needs approval';
  if (item.status === 'approved' && item.cloudStatus === 'awaiting_cloud') return 'Needs validation';
  if (item.status === 'cloud_unknown') return 'Authorization unknown';
  return displayStatus(item.status);
}

function RedemptionReview({ entries, ...action }: ActionProps & { entries: LoyaltyRedemption[] }) {
  const [selected, setSelected] = useState<LoyaltyRedemption | null>(null);
  const [choice, setChoice] = useState<RedemptionAction | null>(null);
  const [error, setError] = useState('');
  const activeCount = entries.filter(item => redemptionActions(item).length).length;
  if (!selected) return <>
    <p className="quiet">{activeCount} awaiting action. Open a request to review the discount, points and authorization status.</p>
    <Queue entries={entries} empty="No redemption requests yet." onSelect={setSelected}
      describe={item => `${points(item.requestedPoints)} · ${money(item.discountCentavos)} discount`}
      status={redemptionStatus} />
    <Done onClose={action.onBack} />
  </>;
  const item = selected;
  const actions = redemptionActions(item);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choice || action.disabled || action.busy || !actions.includes(choice)) return;
    const data = new FormData(event.currentTarget);
    const reason = field(data, 'reason');
    const reference = field(data, 'reference');
    const path = `/api/v1/loyalty/redemptions/${encodeURIComponent(item.id)}`;
    if (choice !== 'validate' && !reason) { setError('Enter a reason or verification note.'); return; }
    if (choice === 'authorized' && !reference) { setError('Enter the verified authorization reference.'); return; }
    if (choice === 'approve' || choice === 'deny') {
      await action.submit(`${path}/decision`, { decision: choice, reason },
        choice === 'approve' ? 'Redemption approved for validation.' : 'Redemption denied.');
    } else if (choice === 'validate') {
      await action.submit(`${path}/validate-cloud`, { expectedVersion: item.version }, 'Redemption check recorded.');
    } else {
      await action.submit(`${path}/reconcile-cloud`, {
        expectedVersion: item.version, note: reason,
        ...(choice === 'authorized' ? { outcome: 'confirm_authorized', cloudReference: reference } : { outcome: 'confirm_not_debited' }),
      }, 'Redemption reconciliation saved.');
    }
  }
  return <>
    <h3>Order #{item.orderNo} · {item.customerName}</h3>
    <Summary rows={[
      ['Requested points', points(item.requestedPoints)], ['Discount', money(item.discountCentavos)],
    ]} />
    {choice ? <form key={choice} className="customer-review-form" onSubmit={e => void save(e)} onChange={() => setError('')}>
      <h4>{redemptionLabels[choice]}</h4>
      <p className="quiet">{redemptionHelp[choice]}</p>
      <fieldset className="settings-fields" disabled={action.disabled || action.busy}>
        {choice === 'authorized' && <label>Verified authorization reference<input name="reference" maxLength={120} required /></label>}
        {choice !== 'validate' && <label>{choice === 'approve' || choice === 'deny' ? 'Decision reason' : 'Verification note'}
          <textarea name="reason" rows={3} maxLength={300} required />
        </label>}
      </fieldset>
      {error && <p className="notice error" role="alert">{error}</p>}
      <ActionFooter {...action} onBack={() => { setChoice(null); setError(''); }} backLabel="Back to request" label={redemptionLabels[choice]} danger={choice === 'deny'} />
    </form> : <>
      <Summary rows={[
        ['Status', redemptionStatus(item)], ['Authorization status', displayStatus(item.cloudStatus)],
        ['Requested by', item.requesterName], ['Request reason', item.reason],
        ...(item.decisionReason ? [['Decision reason', item.decisionReason] as [string, string]] : []),
        ...(item.cloudReference ? [['Authorization reference', item.cloudReference] as [string, string]] : []),
      ]} />
      <div className="accounts-modal-footer customer-actions">
        <button type="button" onClick={() => setSelected(null)}>Back to requests</button>
        {actions.map((option, index) => <button type="button" key={option} className={index === 0 ? 'primary' : undefined}
          disabled={action.disabled} onClick={() => setChoice(option)}>{redemptionLabels[option]}</button>)}
      </div>
    </>}
  </>;
}

function Queue<T extends { id: string; orderNo: number; customerName: string }>({ entries, empty, onSelect, describe, status }: {
  entries: T[]; empty: string; onSelect: (item: T) => void; describe: (item: T) => string; status: (item: T) => string;
}) {
  if (!entries.length) return <p className="empty">{empty}</p>;
  return <ul className="list customer-queue">{entries.map(item => <li key={item.id}>
    <div><strong>Order #{item.orderNo} · {item.customerName}</strong><p className="quiet">{describe(item)}</p></div>
    <span className="customer-status">{status(item)}</span>
    <button type="button" aria-label={`Review order #${item.orderNo} for ${item.customerName}`} onClick={() => onSelect(item)}>Review</button>
  </li>)}</ul>;
}

function RefundReview({ entries, ...action }: ActionProps & { entries: LoyaltyRefundCase[] }) {
  const [item, setItem] = useState<LoyaltyRefundCase | null>(null);
  const [error, setError] = useState('');
  if (!item) return <>
    <p className="quiet">Review points that may need to be reversed or restored after a refund.</p>
    <Queue entries={entries} empty="No refund adjustments yet." onSelect={setItem}
      describe={entry => `${money(entry.refundAmountCentavos)} refunded`}
      status={entry => entry.status === 'insufficient_balance_review' ? 'Balance review' : displayStatus(entry.status)} />
    <Done onClose={action.onBack} />
  </>;
  const exception = item.status === 'insufficient_balance_review';
  const resolved = item.status === 'resolved';
  const path = `/api/v1/loyalty/refund-cases/${encodeURIComponent(item.id)}`;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || action.disabled || action.busy || resolved) return;
    const data = new FormData(event.currentTarget);
    const reason = field(data, 'reason');
    if (!reason) { setError('Enter the reason for this adjustment.'); return; }
    if (exception) {
      const appliedReversalPoints = fixedPoint(field(data, 'appliedReversalPoints'), 0, item.requestedReversalPoints ?? 0);
      if (appliedReversalPoints === null) { setError('Enter whole points within the requested reversal.'); return; }
      await action.submit(`${path}/resolve-exception`, {
        expectedVersion: item.version, action: 'apply_available_and_waive', appliedReversalPoints, resolutionNote: reason,
      }, 'Loyalty balance exception resolved.');
    } else {
      const reverseEarnedPoints = fixedPoint(field(data, 'reverseEarnedPoints'), 0, item.remainingReversibleEarnedPoints);
      const restoreRedeemedPoints = fixedPoint(field(data, 'restoreRedeemedPoints'), 0, item.remainingRestorableRedeemedPoints);
      if (reverseEarnedPoints === null || restoreRedeemedPoints === null) { setError('Enter whole points within the remaining limits.'); return; }
      await action.submit(`${path}/decision`, { expectedVersion: item.version, reverseEarnedPoints, restoreRedeemedPoints, reason }, 'Loyalty refund decision saved.');
    }
  }
  return <>
    <h3>Order #{item.orderNo} · {item.customerName}</h3>
    <Summary rows={[
      ['Refund amount', money(item.refundAmountCentavos)],
      ['Available points', points(item.customerAvailablePoints)], ['Pending points', points(item.customerPendingPoints)],
      ...(resolved ? [['Earned points reversed', points(item.reversedEarnedPoints ?? 0)], ['Redeemed points restored', points(item.restoredRedeemedPoints ?? 0)], ['Reason', item.reason ?? 'Not recorded']] as [string, string][] : []),
    ]} />
    {resolved ? <>
      {item.resolutionNote && <p className="settings-note">{item.resolutionNote}</p>}
      <div className="accounts-modal-footer"><button type="button" onClick={() => setItem(null)}>Back to adjustments</button></div>
    </> : <form className="customer-review-form" onSubmit={e => void save(e)} onChange={() => setError('')}>
      <fieldset disabled={action.disabled || action.busy} className="settings-fields">
        <legend>{exception ? 'Resolve the points balance' : 'Adjust points'}</legend>
        {exception ? <>
          <p className="notice">The requested reversal of {points(item.requestedReversalPoints ?? 0)} could not be applied in full. Enter the points to reverse. Saving waives the remainder.</p>
          <label>Points to reverse<input name="appliedReversalPoints" inputMode="numeric" required />
            <span className="accounts-help">Use the balance eligible for reversal, up to {points(item.requestedReversalPoints ?? 0)}.</span>
          </label>
        </> : <div className="settings-form-grid">
          <label>Take back earned points<input name="reverseEarnedPoints" inputMode="numeric" defaultValue={item.remainingReversibleEarnedPoints} required />
            <span className="accounts-help">Up to {points(item.remainingReversibleEarnedPoints)} remaining.</span>
          </label>
          <label>Return redeemed points<input name="restoreRedeemedPoints" inputMode="numeric" defaultValue={item.remainingRestorableRedeemedPoints} required />
            <span className="accounts-help">Up to {points(item.remainingRestorableRedeemedPoints)} remaining.</span>
          </label>
        </div>}
        {!exception && <p className="accounts-help">If there are too few points to take back, the decision moves to balance review.</p>}
        <label>{exception ? 'Resolution note' : 'Adjustment reason'}<textarea name="reason" rows={3} maxLength={300} required /></label>
      </fieldset>
      {error && <p className="notice error" role="alert">{error}</p>}
      <ActionFooter {...action} onBack={() => { setItem(null); setError(''); }} backLabel="Back to adjustments" label={exception ? 'Save resolution' : 'Record adjustment'} />
    </form>}
  </>;
}

const dialogTitles: Record<CustomerDialog['kind'], string> = {
  add: 'Add customer', profile: 'Customer profile', policy: 'Customer & VIP settings',
  cloud: 'Loyalty sync', redemptions: 'Redemption requests', refunds: 'Refund point adjustments',
};

export function Customers(props: WorkspaceProps) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [dialog, setDialog] = useState<CustomerDialog | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const load = useCallback(async (session: Session) => {
    const [directory, redemptions, refunds] = await Promise.all([
      api.customers(session, { q: query, segment }), api.loyaltyRedemptions(session), api.loyaltyRefundCases(session),
    ]);
    return { ...directory, redemptions: redemptions.redemptions, refundCases: refunds.cases };
  }, [query, segment]);
  const data = useData(props, load);
  const dashboard = data.value;
  const filtersChanging = search.trim() !== query;
  const disabled = props.disabled || data.loading || filtersChanging || !!data.error;
  const close = () => setDialog(null);
  const submit: SubmitCommand = async (path, payload, success) => {
    setBusy(true);
    try {
      const ok = await props.submit(path, payload, success);
      if (ok) close();
      return ok;
    } finally { setBusy(false); }
  };
  const action = { submit, disabled, busy, onBack: close };
  const redemptionCount = dashboard?.redemptions.filter(item => redemptionActions(item).length).length ?? 0;
  const refundCount = dashboard?.refundCases.filter(item => item.status !== 'resolved').length ?? 0;
  return <>
    <Heading title="Customers" detail="Manage customer profiles and loyalty." {...data} />
    <div className="customer-workspace">
      <section className="panel customer-card" aria-labelledby="customer-directory-heading">
        <div className="accounts-directory-header">
          <div><h2 id="customer-directory-heading">Customer directory</h2><p className="quiet">Find profiles, order history and loyalty balances.</p></div>
          <button type="button" className="primary" disabled={disabled} onClick={() => setDialog({ kind: 'add' })}>Add customer</button>
        </div>
        <div className="customer-filters">
          <label>Search customers<input type="search" value={search} onChange={e => setSearch(e.target.value)} maxLength={120} placeholder="Search name, phone or customer ID" /></label>
          <label>Customer group<select value={segment} onChange={e => setSegment(e.target.value as Segment)} aria-label="Customer group">
            <option value="all">All customers</option><option value="active">Active</option><option value="inactive">Inactive</option>
            <option value="no_purchases">No purchases</option><option value="vip">VIP</option>
          </select></label>
        </div>
        <DataState state={data}>{dashboard && <>
          <div className="customer-list-meta">
            <p role="status">{dashboard.customers.length} of {dashboard.counters.totalCount} customers</p>
            <p>Active {dashboard.counters.activeCount} · Inactive {dashboard.counters.inactiveCount} · No purchases {dashboard.counters.noPurchasesCount} · VIP {dashboard.counters.vipCount ?? 'not configured'}</p>
          </div>
          {dashboard.customers.length === 0 ? <div className="accounts-empty">
            <h3>{dashboard.counters.totalCount === 0 ? 'No customers yet' : 'No matching customers'}</h3>
            <p className="quiet">{dashboard.counters.totalCount === 0 ? 'Add a customer to start tracking purchases and points.' : segment === 'vip' && !dashboard.policy.vipConfigured ? 'Set a VIP rule in Customer & VIP settings to use this group.' : 'Try another search or customer group.'}</p>
            {(search || segment !== 'all') && <button type="button" onClick={() => { setSearch(''); setQuery(''); setSegment('all'); }}>Clear filters</button>}
          </div> : <Rows columns={['Customer', 'Status', 'Points', 'Lifetime net spend', 'Profile']}>
            {dashboard.customers.map(customer => <tr key={customer.id}>
              <Cell label="Customer"><div className="customer-identity"><strong>{customer.displayName}</strong><small className="record-id">{customer.phone || customer.id}</small></div></Cell>
              <Cell label="Status"><span className={`customer-status${customer.activityStatus === 'active' ? ' is-active' : ''}`}>{activityNames[customer.activityStatus]}{customer.isVip ? ' · VIP' : ''}</span></Cell>
              <Cell label="Points"><div><strong>{points(customer.availablePoints)}</strong>{customer.pendingPoints !== 0 && <span className="record-id">{points(customer.pendingPoints)} pending</span>}</div></Cell>
              <Cell label="Lifetime net spend">{money(customer.lifetimeNetSpendCentavos)}</Cell>
              <Cell label="Profile"><button type="button" disabled={filtersChanging} aria-label={`View profile for ${customer.displayName}`} onClick={() => setDialog({ kind: 'profile', id: customer.id })}>View profile</button></Cell>
            </tr>)}
          </Rows>}
        </>}</DataState>
      </section>
      {dashboard && <section className="panel customer-card" aria-labelledby="customer-loyalty-heading">
        <div className="accounts-directory-header">
          <div><h2 id="customer-loyalty-heading">Loyalty tools</h2><p className="quiet">Review requests, refund adjustments and points waiting to sync.</p></div>
          <button type="button" onClick={() => setDialog({ kind: 'policy', policy: dashboard.policy })}>Customer &amp; VIP settings</button>
        </div>
        <ul className="list customer-tools">
          <li><div><strong>Redemption requests</strong><p className="quiet">{redemptionCount} awaiting action</p></div><button type="button" onClick={() => setDialog({ kind: 'redemptions', entries: dashboard.redemptions })}>View requests</button></li>
          <li><div><strong>Refund point adjustments</strong><p className="quiet">{refundCount} awaiting action</p></div><button type="button" onClick={() => setDialog({ kind: 'refunds', entries: dashboard.refundCases })}>View adjustments</button></li>
          <li><div><strong>Loyalty sync</strong><p className="quiet">{cloudModes[dashboard.cloudState.loyaltyCloudMode]} · {points(dashboard.cloudState.pendingPointsTotal)} waiting to sync</p></div><button type="button" onClick={() => setDialog({ kind: 'cloud', cloud: dashboard.cloudState })}>Manage sync</button></li>
        </ul>
      </section>}
    </div>
    {dialog && <ActionModal title={dialogTitles[dialog.kind]} dismissDisabled={busy} onClose={close}>
      <div className="customer-modal">
        {dialog.kind === 'add' && <CustomerForm {...action} />}
        {dialog.kind === 'profile' && <CustomerProfile {...action} id={dialog.id} workspace={props} />}
        {dialog.kind === 'policy' && <PolicyForm {...action} policy={dialog.policy} isOwner={props.session.actor.role === 'owner'} />}
        {dialog.kind === 'cloud' && <CloudReview {...action} cloud={dialog.cloud} />}
        {dialog.kind === 'redemptions' && <RedemptionReview {...action} entries={dialog.entries} />}
        {dialog.kind === 'refunds' && <RefundReview {...action} entries={dialog.entries} />}
      </div>
    </ActionModal>}
  </>;
}


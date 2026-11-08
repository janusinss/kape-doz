import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ActionModal } from './action_modal';
import { useToast } from './toast';
import { api, HubError, type AccountRecord, type Amendment, type AmendmentLine, type Approval, type Device, type DevicePairingBundle, type ExpensePeriod, type Ingredient, type Product, type SalesReport, type Session, type Shift } from './api';
import { maxCountCostCentavos, maxCountMilli, maxCountText, stockCountsPath, type StockCount } from './stock_count_contract';
import { inventoryAlertsPath, inventoryThresholdsPath, maxAlertNote, maxThresholdMilli, type InventoryAlerts, type StockAlert, type Threshold, type ThresholdHistory } from './inventory_alert_contract';
import { idRouteSegment, validDatePeriod } from './primitives';

export type SubmitCommand = (path: string, data: Record<string, unknown>, success: string) => Promise<boolean>;
export type WorkspaceProps = { session: Session; revision: number; disabled: boolean; onError: (error: unknown, session: Session) => void; submit: SubmitCommand };
type LoadState<T> = { value: T | null; loading: boolean; error: string | null };

export function useData<T>({ session, revision, onError }: WorkspaceProps, load: (session: Session) => Promise<T>) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<LoadState<T>>({ value: null, loading: true, error: null });
  useEffect(() => {
    let current = true;
    setState({ value: null, loading: true, error: null });
    void load(session).then(value => {
      if (current) setState({ value, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!current) return;
      onError(error, session);
      setState({ value: null, loading: false, error: error instanceof HubError ? error.message : 'The workspace could not be loaded.' });
    });
    return () => { current = false; };
  }, [session, revision, refreshKey, load]);
  return { ...state, refresh: () => setRefreshKey(value => value + 1) };
}

function useCursorPagination<P, C>(
  initial: P | null,
  nextCursor: (page: P) => C | null | undefined,
  fetchPage: (cursor: C) => Promise<P>,
  onError: (error: unknown) => string | null,
) {
  const [pages, setPages] = useState<P[]>(initial ? [initial] : []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setPages(initial ? [initial] : []);
    setLoading(false);
    setError('');
    return () => { generation.current++; };
  }, [initial]);
  const lastPage = pages.at(-1);
  const cursor = lastPage ? nextCursor(lastPage) : null;
  async function loadMore() {
    if (!cursor || loading) return;
    const activeGeneration = generation.current;
    setLoading(true);
    setError('');
    try {
      const next = await fetchPage(cursor);
      if (generation.current === activeGeneration) setPages(previous => [...previous, next]);
    } catch (caught) {
      if (generation.current !== activeGeneration) return;
      const message = onError(caught);
      if (message !== null) setError(message);
    } finally {
      if (generation.current === activeGeneration) setLoading(false);
    }
  }
  return { pages, cursor, loading, error, loadMore };
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const number = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 });
const date = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
export const money = (cents: number | null) => cents == null ? '—' : peso.format(cents / 100);
const quantity = (milli: number, unit: string) => `${number.format(milli / 1000)} ${unit === 'piece' ? 'pc' : unit}`;
export const dateTime = (timestamp: number | null) => timestamp == null ? '—' : date.format(timestamp);
const shiftNames = { awaiting_review: 'Awaiting review', recount_required: 'Recount requested', closed: 'Closed' };

export function fixedPoint(raw: string, places: number, max: number) {
  const match = places === 0
    ? /^(\d+)$/.exec(raw.trim())
    : new RegExp(`^(\\d+)(?:\\.(\\d{1,${places}}))?$`).exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]) * 10 ** places + Number((match[2] ?? '').padEnd(places, '0'));
  return Number.isSafeInteger(value) && value <= max ? value : null;
}

export function field(form: FormData, name: string) { return String(form.get(name) ?? '').trim(); }
export function Heading({ title, refresh, loading }: { title: string; detail: string; refresh: () => void; loading: boolean }) {
  return <div className="heading">
    <div><h1>{title}</h1></div>
    <button type="button" className="refresh" onClick={refresh} disabled={loading}>Refresh</button>
  </div>;
}

export function DataState({ state, children }: { state: LoadState<unknown>; children: ReactNode }) {
  if (state.loading) return <p className="notice" role="status">Loading workspace…</p>;
  if (state.error) return <p className="notice error" role="alert">{state.error}</p>;
  return children;
}

export function Rows({ columns, children }: { columns: string[]; children: ReactNode }) {
  return <table className="records">
    <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
    <tbody>{children}</tbody>
  </table>;
}

export function Cell({ label, children }: { label: string; children: ReactNode }) {
  return <td data-label={label}>{children}</td>;
}

type ShiftDecision = 'approve' | 'recount';

function CashDifference({ cents }: { cents: number }) {
  if (cents === 0) return <span className="shift-difference">Cash matches</span>;
  return <span className="shift-difference" data-variance={cents < 0 ? 'short' : 'over'}>
    {money(Math.abs(cents))} {cents < 0 ? 'short' : 'over'}
  </span>;
}

function ShiftCount({ shift }: { shift: Shift }) {
  return <>
    <div className="shift-modal-context">
      <div><h3>{shift.drawerId}</h3><p className="quiet">Submitted {dateTime(shift.submittedAt)}</p></div>
      <span className="shift-status" data-status={shift.status}>{shiftNames[shift.status]}</span>
    </div>
    <dl className="shift-cash-summary" aria-label="Cash count">
      <div><dt>Expected cash</dt><dd>{money(shift.expectedCashCentavos)}</dd></div>
      <div><dt>Counted cash</dt><dd>{money(shift.countedCashCentavos)}</dd></div>
      <div><dt>Difference</dt><dd><CashDifference cents={shift.varianceCentavos} /></dd></div>
    </dl>
  </>;
}

export function ShiftReview(props: WorkspaceProps) {
  const data = useData(props, api.shifts);
  const [filter, setFilter] = useState<Shift['status'] | 'all'>('awaiting_review');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Shift | null>(null);
  const [decision, setDecision] = useState<ShiftDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const modalContent = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const dialog = modalContent.current?.closest('dialog');
    if (!dialog) return;
    dialog.scrollTop = 0;
    dialog.querySelector<HTMLButtonElement>('.action-modal-close')?.focus({ preventScroll: true });
  }, [selected, decision]);

  const shifts = data.value?.shifts ?? [];
  const query = search.trim().toLowerCase();
  const visible = shifts.filter(shift => (filter === 'all' || shift.status === filter) &&
    [shift.drawerId, shift.id].some(value => value.toLowerCase().includes(query)));
  const awaiting = shifts.filter(shift => shift.status === 'awaiting_review').length;
  const latest = selected && shifts.find(shift => shift.id === selected.id);
  const changed = !!(selected && data.value && (!latest || latest.version !== selected.version ||
    latest.status !== selected.status || latest.expectedCashCentavos !== selected.expectedCashCentavos ||
    latest.countedCashCentavos !== selected.countedCashCentavos));
  const disabled = props.disabled || busy || data.loading || !!data.error || changed;
  function close(returnToSearch = false) {
    setSelected(null);
    setDecision(null);
    requestAnimationFrame(() => {
      if (returnToSearch || document.activeElement === document.body) searchInput.current?.focus({ preventScroll: true });
    });
  }

  async function confirm() {
    if (!selected || !decision || selected.status !== 'awaiting_review' || disabled) return;
    setBusy(true);
    try {
      const accepted = await props.submit(`/api/v1/shifts/${encodeURIComponent(selected.id)}/review`,
        { expectedVersion: selected.version, decision },
        decision === 'approve' ? 'Shift closed.' : 'Recount requested. The drawer remains locked.');
      if (accepted) close(true);
    } finally { setBusy(false); }
  }

  return <>
    <Heading title="Shifts" detail="Review submitted cash counts." {...data} />
    <section className="panel shifts-directory" aria-labelledby="submitted-shifts">
      <div className="accounts-directory-header">
        <div><h2 id="submitted-shifts">Cash drawer review</h2><p className="quiet">Compare the cashier’s count with the expected cash before closing a shift.</p></div>
        {data.value && <span className="shift-status" data-status="awaiting_review">{awaiting} awaiting review</span>}
      </div>
      <div className="shifts-filters">
        <label>Search shifts<input ref={searchInput} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Drawer or shift ID" /></label>
        <label>Shift status<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
          <option value="awaiting_review">Awaiting review</option><option value="recount_required">Recount requested</option><option value="closed">Closed</option><option value="all">All statuses</option>
        </select></label>
      </div>
      <DataState state={data}>{data.value && <>
        <p className="shifts-results quiet" role="status">{visible.length} of {shifts.length} loaded shifts{data.value.truncated && ' · Latest 100 submissions'}</p>
        {visible.length ? <Rows columns={['Drawer', 'Count submitted', 'Cash difference', 'Status', 'Action']}>
          {visible.map(shift => <tr key={shift.id}>
            <Cell label="Drawer"><strong>{shift.drawerId}</strong></Cell>
            <Cell label="Count submitted">{dateTime(shift.submittedAt)}</Cell>
            <Cell label="Cash difference"><CashDifference cents={shift.varianceCentavos} /></Cell>
            <Cell label="Status"><span className="shift-status" data-status={shift.status}>{shiftNames[shift.status]}</span></Cell>
            <Cell label="Action"><button type="button" onClick={() => setSelected(shift)} aria-label={`${shift.status === 'awaiting_review' ? 'Review shift' : 'View details'} for ${shift.drawerId}, submitted ${dateTime(shift.submittedAt)}`}>
              {shift.status === 'awaiting_review' ? 'Review shift' : 'View details'}
            </button></Cell>
          </tr>)}
        </Rows> : <div className="accounts-empty">
          <h3>{!shifts.length ? 'No submitted counts yet' : filter === 'awaiting_review' && !query ? 'No shifts awaiting review' : 'No matching shifts'}</h3>
          <p className="quiet">{shifts.length ? 'Change the search or status to see other shifts.' : 'When a cashier submits a cash count, it will appear here.'}</p>
          {!!shifts.length && <button type="button" onClick={() => { setSearch(''); setFilter('all'); searchInput.current?.focus(); }}>View all shifts</button>}
        </div>}
      </>}</DataState>
    </section>
    {selected && <ActionModal title={decision === 'approve' ? 'Confirm shift closure' : decision === 'recount' ? 'Confirm recount request' : selected.status === 'awaiting_review' ? 'Review shift' : 'Shift details'} onClose={() => close()} dismissDisabled={busy}>
      <div className="shift-modal" ref={modalContent}>
        <ShiftCount shift={selected} />
        {changed ? <div className="notice" role="status">
          <p>{latest ? 'This count changed during review. Open the latest details before taking action.' : 'This shift is no longer in the loaded queue.'}</p>
          {latest && <button type="button" onClick={() => { setSelected(latest); setDecision(null); }}>View latest details</button>}
        </div> : data.error ? <div className="notice error" role="alert"><p>Could not verify the current count. Refresh before taking action.</p><button type="button" onClick={data.refresh}>Refresh shifts</button></div> : null}
        {decision ? <>
          <p className="shift-modal-explanation">{decision === 'approve'
            ? 'This approves the submitted count and closes the shift.'
            : 'The cashier will enter a new count without seeing the expected amount. The drawer stays locked until the shift is closed.'}</p>
          <div className="button-row shift-modal-actions">
            <button type="button" disabled={busy} onClick={() => setDecision(null)}>Back to review</button>
            <button type="button" className="primary" disabled={disabled} onClick={() => void confirm()}>{busy ? 'Saving…' : decision === 'approve' ? 'Approve and close shift' : 'Send recount request'}</button>
          </div>
        </> : <>
          <dl className="shift-meta">
            <div><dt>Opening cash</dt><dd>{money(selected.openingCashCentavos)}</dd></div>
            <div><dt>Shift opened</dt><dd>{dateTime(selected.openedAt)}</dd></div>
          </dl>
          <div className="shift-cashier-note"><h4>Cashier note</h4><p className={selected.note ? undefined : 'quiet'}>{selected.note || 'No note added.'}</p></div>
          {selected.status === 'recount_required' && <p className="notice">Showing the previous count. The drawer stays locked while the cashier recounts.</p>}
          {selected.status === 'closed' && <p className="quiet shift-modal-explanation">This shift is closed. These are the final approved figures.</p>}
          <div className="button-row shift-modal-actions">
            {selected.status === 'awaiting_review' && !changed ? <>
              <button type="button" disabled={disabled} onClick={() => setDecision('recount')}>Request recount</button>
              <button type="button" className="primary" disabled={disabled} onClick={() => setDecision('approve')}>Approve close</button>
            </> : <button type="button" onClick={() => close()}>Done</button>}
          </div>
        </>}
      </div>
    </ActionModal>}
  </>;
}


const approvalNames = { pending: 'Awaiting decision', approved: 'Approved', denied: 'Denied', stale: 'No longer current' };
const approvalActions = { discount: 'Discount', cancel: 'Cancellation' };
const requestedKitchenNames = { not_released: 'Not sent to barista', queued: 'In queue', preparing: 'Preparing', ready: 'Ready' };
const requestedPaymentNames = { unpaid: 'Unpaid', pending_verification: 'Awaiting payment verification', partially_paid: 'Partially paid', paid: 'Fully paid' };
const amendmentActions = { add: 'Item addition', quantity: 'Quantity change', remove: 'Item removal', replace: 'Item replacement', note: 'Preparation note change' };
const amendmentNames = { awaiting_approval: 'Awaiting decision', denied: 'Denied', stale: 'No longer current', awaiting_station: 'Awaiting barista', resolved: 'Resolved' };
const amendmentFilters = { awaiting_approval: 'pending', denied: 'denied', stale: 'stale', awaiting_station: 'barista', resolved: 'approved' } as const;

type ReviewRequest = { type: 'approval'; record: Approval } | { type: 'amendment'; record: Amendment };
type Decision = 'approve' | 'deny';
type ApprovalFilter = Approval['status'] | 'barista' | 'all';
type RequestFilter = Approval['action'] | 'amendment' | 'all';

async function reviewRequests(session: Session): Promise<ReviewRequest[]> {
  const [approvals, amendments] = await Promise.all([api.approvals(session), api.amendments(session)]);
  const queue: ReviewRequest[] = [
    ...approvals.approvals.map(record => ({ type: 'approval' as const, record })),
    ...amendments.amendments.map(record => ({ type: 'amendment' as const, record })),
  ];
  return queue.sort((a, b) => b.record.requestedAt - a.record.requestedAt);
}

const reviewKey = (request: ReviewRequest) => `${request.type}:${request.record.id}`;
const requestAction = (request: ReviewRequest) => request.type === 'amendment' ? amendmentActions[request.record.operation] : approvalActions[request.record.action];
const requestStatus = (request: ReviewRequest) => request.type === 'amendment' ? amendmentNames[request.record.status] : approvalNames[request.record.status];
const requestGroup = (request: ReviewRequest) => request.type === 'amendment' ? amendmentFilters[request.record.status] : request.record.status;
const waitingForBarista = (request: ReviewRequest) => request.type === 'amendment'
  ? request.record.status === 'awaiting_station'
  : request.record.action === 'cancel' && request.record.cancellationStatus === 'awaiting_disposition';

function ApprovalSummary({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="settings-summary approval-summary">
    {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>;
}

function OrderImpact({ request }: { request: ReviewRequest }) {
  const amount = request.type === 'amendment' ? request.record.totalAfterCentavos : request.record.amountCentavos;
  const label = request.type === 'amendment' ? (request.record.appliedAt === null ? 'Proposed order total' : 'Order total after change')
    : request.record.action === 'discount' ? 'Requested discount' : 'Order total at request';
  return <><span className="record-id">{label}</span><strong>{money(amount)}</strong></>;
}

function ApprovalTerms({ approval }: { approval: Approval }) {
  if (approval.action === 'discount') return <ApprovalSummary rows={[
    ['Total before requested discount', money(approval.subtotalCentavos)],
    ['Requested discount', money(approval.amountCentavos)],
    [approval.status === 'approved' ? 'Total after discount' : 'Proposed total', money(approval.subtotalCentavos - approval.amountCentavos)],
  ]} />;
  return <>
    <ApprovalSummary rows={[
      ['Order subtotal', money(approval.subtotalCentavos)], ['Order total at request', money(approval.amountCentavos)],
    ]} />
    <div className="approval-context">
      <h3>When cancellation was requested</h3>
      <ApprovalSummary rows={[
        ['Preparation', requestedKitchenNames[approval.requestedKitchenState]],
        ['Payment status', requestedPaymentNames[approval.requestedPaymentState]],
        ['Collected payments', money(approval.collectedCentavos)], ['Unverified payments', money(approval.pendingCentavos)],
      ]} />
    </div>
    {approval.status === 'approved' && <>
      <p className="settings-note">Preparation {approval.cancellationStatus === 'resolved' ? 'review completed.' : 'is awaiting the barista’s record.'}</p>
      {(approval.collectedCentavos > 0 || approval.pendingCentavos > 0) &&
        <p className="quiet">Check Sales &amp; costs for payments that still need review.</p>}
    </>}
  </>;
}

function AmendmentItem({ line, label, empty }: { line: AmendmentLine | null; label: string; empty: string }) {
  return <div>
    <h4>{label}</h4>
    {line ? <>
      <p><strong>{line.quantity} × {line.name}</strong></p>
      <p className="quiet">{money(line.unitPriceCentavos)} each</p>
      <p className="approval-item-note">{line.note || 'No preparation note'}</p>
    </> : <p className="quiet">{empty}</p>}
  </div>;
}

function AmendmentTerms({ amendment }: { amendment: Amendment }) {
  const applied = amendment.appliedAt !== null;
  const stationNote = applied ? 'The change is applied and is awaiting acknowledgment from the barista.'
    : amendment.needsDisposition ? 'The barista must record what was used before the change takes effect.'
      : 'The change takes effect after the barista acknowledges it.';
  return <>
    <div className="approval-comparison">
      <AmendmentItem line={amendment.before} label="Before" empty="No original item" />
      <AmendmentItem line={amendment.after} label={applied ? 'After' : 'Requested change'} empty={applied ? 'Item removed' : 'Remove this item'} />
    </div>
    <ApprovalSummary rows={[
      ['Order total before', money(amendment.totalBeforeCentavos)], [applied ? 'Order total after' : 'Proposed order total', money(amendment.totalAfterCentavos)],
      ...(amendment.appliedAt !== null ? [['Applied at', dateTime(amendment.appliedAt)] as [string, string]] : []),
      ...(amendment.resolvedAt !== null ? [['Resolved at', dateTime(amendment.resolvedAt)] as [string, string]] : []),
    ]} />
    {amendment.status === 'awaiting_station' && <p className="settings-note">{stationNote}</p>}
    {amendment.dispositionNote && <div className="approval-reason"><h3>Barista’s preparation record</h3><p>{amendment.dispositionNote}</p></div>}
  </>;
}

function RequestOverview({ request, disabled, isRequester, onClose, onDecision }: {
  request: ReviewRequest; disabled: boolean; isRequester: boolean; onClose: () => void; onDecision: (decision: Decision) => void;
}) {
  const { record } = request;
  const pending = requestGroup(request) === 'pending';
  return <>
    <div className="approval-overview-heading"><h3>{requestAction(request)}</h3><strong className="approval-status">{requestStatus(request)}</strong></div>
    <p className="quiet approval-request-meta">
      {dateTime(record.requestedAt)}{request.type === 'approval' && ` · ${request.record.requesterName}`}
    </p>
    <div className="approval-reason"><h3>Cashier’s reason</h3><p>{record.reason}</p></div>
    {request.type === 'approval' ? <ApprovalTerms approval={request.record} /> : <AmendmentTerms amendment={request.record} />}
    {record.decisionReason && <div className="approval-reason"><h3>Decision note</h3><p>{record.decisionReason}</p></div>}
    {request.type === 'approval' && request.record.decidedAt !== null && <p className="settings-note">Decision recorded {dateTime(request.record.decidedAt)}.</p>}
    {record.status === 'stale' && <p className="notice">This request no longer matches the current order or was replaced. Review the current order before proceeding.</p>}
    <details className="stock-record-details"><summary>Request reference</summary>
      <p className="record-id">{record.id} · Order version {record.orderVersion}</p>
      {request.type === 'approval' && <p className="record-id">Requester ID: {request.record.requesterId}</p>}
    </details>
    {pending && isRequester && <p className="settings-note">Another admin must review a request you submitted.</p>}
    <div className="accounts-modal-footer approval-footer">
      <button type="button" onClick={onClose}>{pending ? 'Close' : 'Done'}</button>
      {pending && !isRequester && <>
        <button type="button" disabled={disabled} onClick={() => onDecision('deny')}>Deny request</button>
        <button type="button" className="primary" disabled={disabled} onClick={() => onDecision('approve')}>Review approval</button>
      </>}
    </div>
  </>;
}

function ApprovalDecisionForm({ request, decision, submit, disabled, busy, onBack }: {
  request: ReviewRequest; decision: Decision; submit: SubmitCommand; disabled: boolean; busy: boolean; onBack: () => void;
}) {
  const [error, setError] = useState('');
  const approving = decision === 'approve';
  const isAmendment = request.type === 'amendment';
  const required = !approving || isAmendment;
  const kind = isAmendment ? 'item change' : request.record.action === 'cancel' ? 'cancellation' : 'discount';
  const label = approving ? `Approve ${kind}` : 'Deny request';
  const outcome = !approving ? 'The request will be denied. The order stays as it is.'
    : isAmendment ? 'The barista will review the change. If preparation has started, the change can wait for their record of ingredients used.'
      : request.record.action === 'cancel' ? 'The order will stop. Preparation or payment review may still be required. Any refund is handled separately.'
        : 'The requested discount will be applied if the order is still eligible.';
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || busy) return;
    const reason = field(new FormData(event.currentTarget), 'reason');
    if (required && !reason) { setError('Enter a reason for this decision.'); return; }
    const path = isAmendment ? '/api/v1/amendments' : '/api/v1/approvals';
    let success = 'Request denied.';
    if (approving) {
      if (request.type === 'amendment') success = 'Item change approved for barista review.';
      else success = request.record.action === 'cancel' ? 'Cancellation approved and order stopped.' : 'Discount approved and applied to the order.';
    }
    await submit(`${path}/${encodeURIComponent(request.record.id)}/decision`, { decision, ...(reason ? { reason } : {}) }, success);
  }
  return <form onSubmit={event => void save(event)} onChange={() => setError('')}>
    <div className="approval-decision-preview"><div><strong>{requestAction(request)}</strong><p className="quiet">{request.record.reason}</p></div><div><OrderImpact request={request} /></div></div>
    <p className="quiet">{outcome}</p>
    <label>{required ? 'Reason for this decision' : 'Approval note (optional)'}
      <textarea name="reason" rows={3} maxLength={300} required={required} disabled={disabled || busy} aria-invalid={!!error || undefined} aria-describedby={error ? 'approval-decision-error' : undefined} />
    </label>
    {error && <p className="notice error" id="approval-decision-error" role="alert">{error}</p>}
    <div className="accounts-modal-footer approval-footer">
      <button type="button" disabled={busy} onClick={onBack}>Back to request</button>
      <button type="submit" className={approving ? 'primary' : 'devices-danger-solid'} disabled={disabled || busy}>{busy ? 'Saving…' : label}</button>
    </div>
  </form>;
}

export function Approvals(props: WorkspaceProps) {
  const data = useData(props, reviewRequests);
  const [filter, setFilter] = useState<ApprovalFilter>('pending');
  const [type, setType] = useState<RequestFilter>('all');
  const [search, setSearch] = useState('');
  const [request, setRequest] = useState<ReviewRequest | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const modalContent = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const dialog = modalContent.current?.closest('dialog');
    if (!dialog) return;
    dialog.scrollTop = 0;
    dialog.querySelector<HTMLButtonElement>('.action-modal-close')?.focus({ preventScroll: true });
  }, [request, decision]);
  const queue = data.value ?? [];
  const query = search.trim().toLowerCase().replace(/^#/, '');
  const visible = queue.filter(item => {
    if (filter === 'barista' ? !waitingForBarista(item) : filter !== 'all' && requestGroup(item) !== filter) return false;
    const category = item.type === 'approval' ? item.record.action : 'amendment';
    if (type !== 'all' && category !== type) return false;
    const names = item.type === 'approval' ? item.record.requesterName : [item.record.before?.name, item.record.after?.name].filter(Boolean).join(' ');
    return !query || [item.record.orderNo, item.record.id, requestAction(item), names].some(value => String(value).toLowerCase().includes(query));
  });
  const latest = request && queue.find(item => reviewKey(item) === reviewKey(request));
  const changed = !!(request && data.value && (!latest || latest.record.status !== request.record.status || latest.record.orderVersion !== request.record.orderVersion ||
    (request.type === 'approval' && request.record.action === 'cancel' && latest.type === 'approval' && latest.record.action === 'cancel' &&
      latest.record.cancellationStatus !== request.record.cancellationStatus)));
  const isRequester = request?.type === 'approval' && request.record.requesterId === props.session.actor.id;
  const disabled = props.disabled || data.loading || !!data.error || changed;
  const close = () => { setDecision(null); setRequest(null); };
  const submit: SubmitCommand = async (path, payload, success) => {
    setBusy(true);
    try {
      const ok = await props.submit(path, payload, success);
      if (ok) {
        close();
        requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true }));
      }
      return ok;
    }
    finally { setBusy(false); }
  };
  const title = decision === 'approve' ? 'Confirm approval' : decision === 'deny' ? 'Confirm denial' : 'Review request';
  const awaiting = queue.filter(item => requestGroup(item) === 'pending').length;
  return <>
    <Heading title="Approvals" detail="Review cashier requests." {...data} />
    <section className="panel approvals-directory" aria-labelledby="approval-requests-heading">
      <div className="accounts-directory-header">
        <div><h2 id="approval-requests-heading">Cashier requests</h2><p className="quiet">Review discounts, cancellations, and changes to items sent for preparation.</p></div>
        {data.value && <span className="approval-status">{awaiting} awaiting decision in this queue</span>}
      </div>
      <div className="approvals-filters">
        <label>Search requests<input ref={searchInput} type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Order number, requester or item" /></label>
        <label>Request type<select aria-label="Request type" value={type} onChange={e => setType(e.target.value as RequestFilter)}>
          <option value="all">All types</option><option value="discount">Discounts</option><option value="cancel">Cancellations</option><option value="amendment">Item changes</option>
        </select></label>
        <label>Status<select aria-label="Approval status" value={filter} onChange={e => setFilter(e.target.value as ApprovalFilter)}>
          <option value="pending">Awaiting decision</option><option value="barista">Awaiting barista</option><option value="approved">Approved or resolved</option>
          <option value="denied">Denied</option><option value="stale">No longer current</option><option value="all">All statuses</option>
        </select></label>
      </div>
      <DataState state={data}>{data.value && <>
        <p className="approvals-results quiet" role="status">{visible.length} of {queue.length} loaded requests</p>
        {!visible.length ? <div className="accounts-empty">
          <h3>{queue.length ? 'No matching requests' : 'No approval requests yet'}</h3>
          <p className="quiet">{queue.length ? 'Try another search, request type, or status.' : 'Requests from the cashier will appear here.'}</p>
          {!!queue.length && <button type="button" onClick={() => { setSearch(''); setType('all'); setFilter('all'); }}>View all requests</button>}
        </div> : <Rows columns={['Order', 'Request', 'Order impact', 'Status', 'Review']}>
          {visible.map(item => <tr key={reviewKey(item)}>
            <Cell label="Order"><div><strong>#{item.record.orderNo}</strong><span className="record-id">{dateTime(item.record.requestedAt)}</span></div></Cell>
            <Cell label="Request"><div><strong>{requestAction(item)}</strong>{item.type === 'approval' && <span className="record-id">{item.record.requesterName}</span>}</div></Cell>
            <Cell label="Order impact"><div><OrderImpact request={item} /></div></Cell>
            <Cell label="Status"><div><span className="approval-status">{requestStatus(item)}</span>
              {item.type === 'approval' && waitingForBarista(item) && <span className="record-id">Awaiting barista</span>}
            </div></Cell>
            <Cell label="Review"><button type="button" aria-label={`Review ${requestAction(item).toLowerCase()} for order ${item.record.orderNo}`}
              onClick={() => { setDecision(null); setRequest(item); }}>Review</button></Cell>
          </tr>)}
        </Rows>}
      </>}</DataState>
    </section>
    {request && <ActionModal title={`${title} for order #${request.record.orderNo}`} onClose={close} dismissDisabled={busy}>
      <div className="approvals-modal" ref={modalContent}>
        {changed && <p className="notice" role="status">This request changed. Close and reopen it to review the latest details.</p>}
        {decision
          ? <ApprovalDecisionForm key={decision} request={request} decision={decision} submit={submit} disabled={disabled || isRequester} busy={busy} onBack={() => setDecision(null)} />
          : <RequestOverview request={request} disabled={disabled} isRequester={isRequester} onClose={close} onDecision={setDecision} />}
      </div>
    </ActionModal>}
  </>;
}


const catalogue = async (session: Session) => {
  const [products, ingredients] = await Promise.all([api.products(session), api.ingredients(session)]);
  return { products: products.products, ingredients: ingredients.ingredients };
};

function signedFixedPoint(raw: string, places: number, max: number) {
  const trimmed = raw.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative || trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  const parsed = fixedPoint(unsigned, places, max);
  if (parsed === null) return null;
  return negative ? -parsed : parsed;
}

function RecipeForm({ ingredients, submit, disabled, onCancel }: { ingredients: Ingredient[]; submit: SubmitCommand; disabled: boolean; onCancel: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [rows, setRows] = useState<number[]>([1]);
  const [sizes, setSizes] = useState<number[]>([]);
  const [substitutions, setSubstitutions] = useState<number[]>([]);
  const [addons, setAddons] = useState<number[]>([]);
  const [dineInPkg, setDineInPkg] = useState<number[]>([]);
  const [takeoutPkg, setTakeoutPkg] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [optionType, setOptionType] = useState('size');
  const [units, setUnits] = useState<Record<string, string>>({});
  function clearUnits(...names: string[]) { setUnits(old => { const next = { ...old }; for (const name of names) delete next[name]; return next; }); }
  const nextRow = () => { const row = Math.max(...rows) + 1; pendingFocus.current = `ingredient-${row}`; setRows([...rows, row]); };
  useEffect(() => { const name = pendingFocus.current; if (!name) return; const element = formRef.current?.elements.namedItem(name); if (element instanceof HTMLElement) { element.focus(); pendingFocus.current = null; } }, [rows, sizes, substitutions, addons, dineInPkg, takeoutPkg]);
  const nextItem = (list: number[]) => [...list, (list.length ? Math.max(...list) : 0) + 1];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const price = fixedPoint(field(data, 'price'), 2, 100_000_000_000);
    const recipe = rows.map(row => ({ ingredientId: field(data, `ingredient-${row}`), quantityMilli: fixedPoint(field(data, `quantity-${row}`), 3, 1_000_000_000) }));
    if (!price || recipe.some(line => !line.quantityMilli || !line.ingredientId) || new Set(recipe.map(line => line.ingredientId)).size !== recipe.length) {
      setError('Enter a positive price and a positive quantity for each distinct ingredient.');
      return;
    }
    const parsedSizes = sizes.map(row => ({
      id: field(data, `size-id-${row}`),
      name: field(data, `size-name-${row}`),
      priceDeltaCentavos: signedFixedPoint(field(data, `size-delta-${row}`) || '0', 2, 100_000_000_000),
      ingredientId: field(data, `size-ingredient-${row}`),
      quantityMilli: fixedPoint(field(data, `size-quantity-${row}`), 3, 1_000_000_000),
    }));
    if (parsedSizes.some(s => !s.id || !s.name || s.priceDeltaCentavos === null || !s.ingredientId || !s.quantityMilli) ||
        new Set(parsedSizes.map(s => s.id)).size !== parsedSizes.length) {
      setError('Enter valid, distinct size options.');
      return;
    }
    const parsedSubs = substitutions.map(row => {
      const rawQty = field(data, `sub-quantity-${row}`);
      return {
        id: field(data, `sub-id-${row}`),
        name: field(data, `sub-name-${row}`),
        priceDeltaCentavos: signedFixedPoint(field(data, `sub-delta-${row}`) || '0', 2, 100_000_000_000),
        replaceIngredientId: field(data, `sub-replace-${row}`),
        withIngredientId: field(data, `sub-with-${row}`),
        quantityMilli: rawQty ? fixedPoint(rawQty, 3, 1_000_000_000) : undefined,
      };
    });
    if (parsedSubs.some(s => !s.id || !s.name || s.priceDeltaCentavos === null || !s.replaceIngredientId || !s.withIngredientId || s.replaceIngredientId === s.withIngredientId || s.quantityMilli === null) ||
        new Set(parsedSubs.map(s => s.id)).size !== parsedSubs.length) {
      setError('Enter valid, distinct milk or ingredient substitutions.');
      return;
    }
    const parsedAddons = addons.map(row => ({
      id: field(data, `addon-id-${row}`),
      name: field(data, `addon-name-${row}`),
      priceDeltaCentavos: fixedPoint(field(data, `addon-price-${row}`) || '0', 2, 100_000_000_000),
      ingredientId: field(data, `addon-ingredient-${row}`),
      quantityMilli: fixedPoint(field(data, `addon-quantity-${row}`), 3, 1_000_000_000),
    }));
    if (parsedAddons.some(a => !a.id || !a.name || a.priceDeltaCentavos === null || !a.ingredientId || !a.quantityMilli) ||
        new Set(parsedAddons.map(a => a.id)).size !== parsedAddons.length) {
      setError('Enter valid, distinct add-on options.');
      return;
    }
    const parsedDineIn = dineInPkg.map(row => ({
      ingredientId: field(data, `dinein-ingredient-${row}`),
      quantityMilli: fixedPoint(field(data, `dinein-quantity-${row}`), 3, 1_000_000_000),
    }));
    const parsedTakeout = takeoutPkg.map(row => ({
      ingredientId: field(data, `takeout-ingredient-${row}`),
      quantityMilli: fixedPoint(field(data, `takeout-quantity-${row}`), 3, 1_000_000_000),
    }));
    if (parsedDineIn.some(p => !p.ingredientId || !p.quantityMilli) || new Set(parsedDineIn.map(p => p.ingredientId)).size !== parsedDineIn.length ||
        parsedTakeout.some(p => !p.ingredientId || !p.quantityMilli) || new Set(parsedTakeout.map(p => p.ingredientId)).size !== parsedTakeout.length) {
      setError('Enter a positive quantity for each distinct packaging ingredient.');
      return;
    }
    setError('');
    const payload: Record<string, unknown> = {
      productId: field(data, 'productId'),
      name: field(data, 'name'),
      priceCentavos: price,
      recipe,
      ...(parsedSizes.length ? {
        sizes: parsedSizes.map(s => ({
          id: s.id, name: s.name, priceDeltaCentavos: s.priceDeltaCentavos!,
          recipe: [{ ingredientId: s.ingredientId, quantityMilli: s.quantityMilli! }],
        })),
      } : {}),
      ...(parsedSubs.length ? {
        substitutions: parsedSubs.map(s => ({
          id: s.id, name: s.name, priceDeltaCentavos: s.priceDeltaCentavos!,
          replaceIngredientId: s.replaceIngredientId, withIngredientId: s.withIngredientId,
          ...(s.quantityMilli !== undefined ? { quantityMilli: s.quantityMilli } : {}),
        })),
      } : {}),
      ...(parsedAddons.length ? {
        addons: parsedAddons.map(a => ({
          id: a.id, name: a.name, priceDeltaCentavos: a.priceDeltaCentavos!,
          recipe: [{ ingredientId: a.ingredientId, quantityMilli: a.quantityMilli! }],
        })),
      } : {}),
      ...(parsedDineIn.length ? { dineInPackaging: parsedDineIn } : {}),
      ...(parsedTakeout.length ? { takeoutPackaging: parsedTakeout } : {}),
    };
    if (await submit('/api/v1/products', payload, 'Recipe created.')) {
      form.reset();
      setUnits({});
      setRows([1]);
      setSizes([]);
      setSubstitutions([]);
      setAddons([]);
      setDineInPkg([]);
      setTakeoutPkg([]);
    }
  }
  function ingredientField(name: string, label: string) {
    return <label>{label}<select name={name} defaultValue="" required onChange={e => { const unit = ingredients.find(item => item.id === e.target.value)?.unit; setUnits(old => ({ ...old, [name]: unit === 'piece' ? 'pc' : unit ?? '' })); }}><option value="" disabled>Select ingredient</option>{ingredients.map(item => <option key={item.id} value={item.id}>{item.name} ({item.unit === 'piece' ? 'pc' : item.unit})</option>)}</select></label>;
  }
  const unitFor = (name: string) => units[name] || 'stock unit';
  const optionGroups = { size: sizes, substitution: substitutions, addon: addons, dinein: dineInPkg, takeout: takeoutPkg };
  const optionLimitReached = optionGroups[optionType as keyof typeof optionGroups].length >= 20;
  function addOption() {
    if (optionLimitReached) return;
    const list = optionGroups[optionType as keyof typeof optionGroups];
    const row = (list.length ? Math.max(...list) : 0) + 1;
    const prefixes: Record<string, string> = { size: 'size-name', substitution: 'sub-name', addon: 'addon-name', dinein: 'dinein-ingredient', takeout: 'takeout-ingredient' };
    pendingFocus.current = `${prefixes[optionType]}-${row}`;
    if (optionType === 'size') setSizes(nextItem); else if (optionType === 'substitution') setSubstitutions(nextItem); else if (optionType === 'addon') setAddons(nextItem); else if (optionType === 'dinein') setDineInPkg(nextItem); else setTakeoutPkg(nextItem);
  }
  return <section className="recipes-form-content">
    <p className="quiet settings-modal-intro">Set the price and ingredients for 1 item. Add sizes, substitutions or packaging when needed.</p>
    {!ingredients.length ? <><p className="empty">Add ingredients on the Stock page before creating a recipe.</p><button type="button" onClick={onCancel}>Close</button></> : <form ref={formRef} className="recipes-create-form" onSubmit={event => void save(event)}>
      <fieldset disabled={disabled} className="settings-fields"><legend>Product details</legend>
        <label>Product name<input name="name" maxLength={120} placeholder="e.g. Iced latte" required /></label>
        <div className="settings-form-grid"><label>Product ID<input name="productId" pattern={idRouteSegment} maxLength={100} autoCapitalize="none" spellCheck={false} placeholder="e.g. iced-latte" required /><span className="accounts-help">Use a unique code with letters, numbers, hyphens or underscores.</span></label><label>Retail price (PHP)<input name="price" inputMode="decimal" placeholder="e.g. 120.00" required /></label></div>
      </fieldset>
      <fieldset disabled={disabled} className="settings-fields settings-fields-divider"><legend>Ingredients per item</legend>
        <p className="accounts-help">Enter the quantity used for 1 item, in each ingredient’s stock unit. Use up to 3 decimal places.</p>
        {rows.map((row, index) => <div className="recipes-base-line" key={row}>
          {ingredientField(`ingredient-${row}`, `Ingredient ${index + 1}`)}
          <label>Quantity ({unitFor(`ingredient-${row}`)})<input name={`quantity-${row}`} inputMode="decimal" required /></label>
          {rows.length > 1 && <button type="button" aria-label={`Remove ingredient ${index + 1}`} onClick={() => { setRows(old => old.filter(id => id !== row)); clearUnits(`ingredient-${row}`); }}>Remove</button>}
        </div>)}
        <button type="button" className="recipes-add-line" onClick={nextRow} disabled={rows.length >= Math.min(50, ingredients.length)}>Add ingredient line</button>
      </fieldset>
      {sizes.length > 0 && <fieldset disabled={disabled} className="settings-fields settings-fields-divider"><legend>Sizes</legend><p className="accounts-help">A size changes the price and overrides or adds the selected ingredient quantity. Other base ingredients stay the same.</p>
        {sizes.map((row,index) => <div className="recipes-option-row" key={row}><div className="recipes-option-header"><h4>Size {index + 1}</h4><button type="button" aria-label={`Remove size ${index + 1}`} onClick={() => { setSizes(old => old.filter(id => id !== row)); clearUnits(`size-ingredient-${row}`); }}>Remove</button></div><div className="settings-form-grid">
          <label>Size name<input name={`size-name-${row}`} placeholder="e.g. Large" maxLength={120} required /></label><label>Size ID<input name={`size-id-${row}`} pattern={idRouteSegment} placeholder="e.g. large" maxLength={100} required /></label>
          <label>Price adjustment (PHP)<input name={`size-delta-${row}`} inputMode="decimal" defaultValue="0" required /></label>{ingredientField(`size-ingredient-${row}`, 'Ingredient to adjust')}
          <label>Size quantity ({unitFor(`size-ingredient-${row}`)})<input name={`size-quantity-${row}`} inputMode="decimal" required /></label>
        </div></div>)}
      </fieldset>}
      {substitutions.length > 0 && <fieldset disabled={disabled} className="settings-fields settings-fields-divider"><legend>Substitutions</legend><p className="accounts-help">Replace a base ingredient, such as dairy milk. Leave quantity blank to keep the original quantity.</p>
        {substitutions.map((row,index) => <div className="recipes-option-row" key={row}><div className="recipes-option-header"><h4>Substitution {index + 1}</h4><button type="button" aria-label={`Remove substitution ${index + 1}`} onClick={() => { setSubstitutions(old => old.filter(id => id !== row)); clearUnits(`sub-replace-${row}`, `sub-with-${row}`); }}>Remove</button></div><div className="settings-form-grid">
          <label>Option name<input name={`sub-name-${row}`} placeholder="e.g. Oat milk" maxLength={120} required /></label><label>Option ID<input name={`sub-id-${row}`} pattern={idRouteSegment} placeholder="e.g. oat-milk" maxLength={100} required /></label>
          {ingredientField(`sub-replace-${row}`, 'Ingredient to replace')}{ingredientField(`sub-with-${row}`, 'Replacement ingredient')}
          <label>Price adjustment (PHP)<input name={`sub-delta-${row}`} inputMode="decimal" defaultValue="0" required /></label><label>Replacement quantity ({unitFor(`sub-with-${row}`)})<input name={`sub-quantity-${row}`} inputMode="decimal" placeholder="Same as original" /></label>
        </div></div>)}
      </fieldset>}
      {addons.length > 0 && <fieldset disabled={disabled} className="settings-fields settings-fields-divider"><legend>Add-ons</legend><p className="accounts-help">Add ingredients and an extra charge, such as an espresso shot.</p>
        {addons.map((row,index) => <div className="recipes-option-row" key={row}><div className="recipes-option-header"><h4>Add-on {index + 1}</h4><button type="button" aria-label={`Remove add-on ${index + 1}`} onClick={() => { setAddons(old => old.filter(id => id !== row)); clearUnits(`addon-ingredient-${row}`); }}>Remove</button></div><div className="settings-form-grid">
          <label>Add-on name<input name={`addon-name-${row}`} placeholder="e.g. Extra shot" maxLength={120} required /></label><label>Add-on ID<input name={`addon-id-${row}`} pattern={idRouteSegment} placeholder="e.g. extra-shot" maxLength={100} required /></label>
          <label>Extra price (PHP)<input name={`addon-price-${row}`} inputMode="decimal" defaultValue="0" required /></label>{ingredientField(`addon-ingredient-${row}`, 'Add-on ingredient')}<label>Quantity ({unitFor(`addon-ingredient-${row}`)})<input name={`addon-quantity-${row}`} inputMode="decimal" required /></label>
        </div></div>)}
      </fieldset>}
      {dineInPkg.length > 0 && <fieldset disabled={disabled} className="settings-fields settings-fields-divider"><legend>Dine-in packaging</legend>{dineInPkg.map((row,index) => <div className="recipes-base-line" key={row}>{ingredientField(`dinein-ingredient-${row}`, `Packaging ${index + 1}`)}<label>Quantity ({unitFor(`dinein-ingredient-${row}`)})<input name={`dinein-quantity-${row}`} inputMode="decimal" required /></label><button type="button" aria-label={`Remove dine-in packaging ${index + 1}`} onClick={() => { setDineInPkg(old => old.filter(id => id !== row)); clearUnits(`dinein-ingredient-${row}`); }}>Remove</button></div>)}</fieldset>}
      {takeoutPkg.length > 0 && <fieldset disabled={disabled} className="settings-fields settings-fields-divider"><legend>Takeout packaging</legend>{takeoutPkg.map((row,index) => <div className="recipes-base-line" key={row}>{ingredientField(`takeout-ingredient-${row}`, `Packaging ${index + 1}`)}<label>Quantity ({unitFor(`takeout-ingredient-${row}`)})<input name={`takeout-quantity-${row}`} inputMode="decimal" required /></label><button type="button" aria-label={`Remove takeout packaging ${index + 1}`} onClick={() => { setTakeoutPkg(old => old.filter(id => id !== row)); clearUnits(`takeout-ingredient-${row}`); }}>Remove</button></div>)}</fieldset>}
      <details className="recipes-options-disclosure"><summary>Optional sizes, substitutions, add-ons & packaging</summary><fieldset disabled={disabled} className="recipes-option-picker"><legend>Optional choices</legend><div className="stock-limit-controls"><label>Add an option<select aria-label="Option type" value={optionType} onChange={e => setOptionType(e.target.value)}><option value="size">Size</option><option value="substitution">Substitution</option><option value="addon">Add-on</option><option value="dinein">Dine-in packaging</option><option value="takeout">Takeout packaging</option></select></label><button type="button" onClick={addOption} disabled={optionLimitReached}>Add option</button></div><p className="accounts-help">Up to 20 entries per option type. Price adjustments can be positive or negative; add-on prices cannot be negative.</p></fieldset></details>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="accounts-modal-footer"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button><button className="primary" disabled={disabled}>{disabled ? 'Creating…' : 'Create recipe'}</button></div>
    </form>}
  </section>;
}

function ProductAvailability({ product, submit, disabled, onCancel }: { product: Product; submit: SubmitCommand; disabled: boolean; onCancel: () => void }) {
  const [error, setError] = useState('');
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || product.availabilityVersion === undefined || product.available === undefined) return;
    const reason = field(new FormData(event.currentTarget), 'reason');
    if (!reason) { setError('Enter a reason for this availability change.'); return; }
    setError('');
    await submit(`/api/v1/products/${product.id}/availability`, { expectedVersion: product.availabilityVersion, available: !product.available, reason }, product.available ? 'Product marked unavailable.' : 'Product marked available.');
  }
  return <form onSubmit={event => void change(event)}>
    <div className="recipes-modal-identity"><h3>{product.name}</h3><p className="quiet">Currently {product.available ? 'available to order' : 'unavailable to order'}</p></div>
    <p>{product.available ? 'Mark this item unavailable to stop new orders for it.' : 'Mark this item available so staff can order it again.'}</p>
    <label>Reason for the change<input name="reason" maxLength={160} disabled={disabled} placeholder="e.g. Ingredient temporarily out of stock" required /></label>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="accounts-modal-footer"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button><button className={product.available ? 'devices-danger-solid' : 'primary'} disabled={disabled}>{disabled ? 'Saving…' : product.available ? 'Mark unavailable' : 'Mark available'}</button></div>
  </form>;
}

function RecipeVersionEditor({ product, ingredients, submit, disabled, onCancel }: { product: Product; ingredients: Ingredient[]; submit: SubmitCommand; disabled: boolean; onCancel: () => void }) {
  const [error, setError] = useState('');
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const priceCentavos = fixedPoint(field(data, 'price'), 2, 100_000_000_000);
    const recipe = product.recipe.map((line, index) => ({
      ingredientId: line.ingredientId,
      quantityMilli: fixedPoint(field(data, `update-qty-${index}`), 3, 1_000_000_000),
    }));
    if (!priceCentavos || recipe.some(line => !line.quantityMilli)) {
      setError('Enter a positive retail price and positive quantities for each recipe ingredient.');
      return;
    }
    setError('');
    const payload: Record<string, unknown> = {
      expectedVersion: product.version,
      name: product.name,
      priceCentavos,
      recipe,
      ...(product.options?.sizes?.length ? { sizes: product.options.sizes } : {}),
      ...(product.options?.substitutions?.length ? { substitutions: product.options.substitutions } : {}),
      ...(product.options?.addons?.length ? { addons: product.options.addons } : {}),
      ...(product.options?.dineInPackaging?.length ? { dineInPackaging: product.options.dineInPackaging } : {}),
      ...(product.options?.takeoutPackaging?.length ? { takeoutPackaging: product.options.takeoutPackaging } : {}),
    };
    await submit(`/api/v1/products/${product.id}/recipe`, payload, `Recipe updated to version ${product.version + 1}.`);
  }
  const ingredientById = new Map(ingredients.map(item => [item.id, item]));
  return <form className="recipe-version-editor" onSubmit={event => void update(event)}>
    <div className="recipes-modal-identity"><h3>{product.name}</h3><p className="quiet">Current recipe: version {product.version}</p></div>
    <p className="accounts-help">Publishing saves a new version. Existing sizes, substitutions, add-ons and packaging are kept.</p>
    <fieldset className="settings-fields" disabled={disabled}>
      <legend>Price & ingredient quantities</legend>
      <label>Retail price (PHP)<input name="price" inputMode="decimal" defaultValue={String(product.priceCentavos / 100)} required /></label>
      {product.recipe.map((line, index) => { const ingredient = ingredientById.get(line.ingredientId); return <label key={line.ingredientId}>{ingredient?.name ?? line.ingredientId} ({ingredient?.unit === 'piece' ? 'pc' : ingredient?.unit ?? 'stock unit'})<input name={`update-qty-${index}`} inputMode="decimal" defaultValue={String(line.quantityMilli / 1000)} required /></label>; })}
    </fieldset>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="accounts-modal-footer"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button><button className="primary" disabled={disabled}>{disabled ? 'Publishing…' : `Publish version ${product.version + 1}`}</button></div>
  </form>;
}

function RecipeDetails({ product, ingredients }: { product: Product; ingredients: Ingredient[] }) {
  const byId = new Map(ingredients.map(item => [item.id, item]));
  const ingredientName = (id: string) => byId.get(id)?.name ?? id;
  const ingredientUnit = (id: string) => byId.get(id)?.unit ?? 'unit unknown';
  const adjustment = (amount: number) => amount > 0 ? `+${money(amount)}` : amount === 0 ? 'No extra charge' : money(amount);
  const lines = (items: Product['recipe']) => <ul className="recipes-detail-lines">{items.map(line => <li key={line.ingredientId}><span>{ingredientName(line.ingredientId)}</span><strong>{quantity(line.quantityMilli, ingredientUnit(line.ingredientId))}</strong></li>)}</ul>;
  const options = product.options;
  const hasOptions = !!(options?.sizes?.length || options?.substitutions?.length || options?.addons?.length || options?.dineInPackaging?.length || options?.takeoutPackaging?.length);
  return <div className="recipes-details">
    <dl className="settings-summary"><div><dt>Retail price</dt><dd>{money(product.priceCentavos)}</dd></div><div><dt>Recipe version</dt><dd>{product.version}</dd></div><div><dt>Product ID</dt><dd>{product.id}</dd></div></dl>
    <section><h4>Ingredients per item</h4>{lines(product.recipe)}</section>
    {!!options?.sizes?.length && <section><h4>Sizes</h4><p className="accounts-help">Size quantities override or add to the base ingredients.</p>{options.sizes.map(size => <div className="recipes-detail-option" key={size.id}><div className="record-line"><strong>{size.name}</strong><span>{adjustment(size.priceDeltaCentavos)}</span></div>{lines(size.recipe)}</div>)}</section>}
    {!!options?.substitutions?.length && <section><h4>Substitutions</h4>{options.substitutions.map(option => <div className="recipes-detail-option" key={option.id}><div className="record-line"><strong>{option.name}</strong><span>{adjustment(option.priceDeltaCentavos)}</span></div><p className="quiet">{ingredientName(option.replaceIngredientId)} → {ingredientName(option.withIngredientId)}</p><p className="accounts-help">{option.quantityMilli === undefined ? 'Uses the replaced ingredient quantity.' : quantity(option.quantityMilli, ingredientUnit(option.withIngredientId))}</p></div>)}</section>}
    {!!options?.addons?.length && <section><h4>Add-ons</h4>{options.addons.map(option => <div className="recipes-detail-option" key={option.id}><div className="record-line"><strong>{option.name}</strong><span>{adjustment(option.priceDeltaCentavos)}</span></div>{lines(option.recipe)}</div>)}</section>}
    {!!options?.dineInPackaging?.length && <section><h4>Dine-in packaging</h4>{lines(options.dineInPackaging)}</section>}
    {!!options?.takeoutPackaging?.length && <section><h4>Takeout packaging</h4>{lines(options.takeoutPackaging)}</section>}
    {!hasOptions && <p className="settings-note">No optional choices or packaging configured.</p>}
  </div>;
}

function RecipeList({ products, ingredients, submit, disabled, onCreate }: { products: Product[]; ingredients: Ingredient[]; submit: SubmitCommand; disabled: boolean; onCreate: () => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState('');
  const [view, setView] = useState<'details' | 'edit' | 'availability'>('details');
  const [taskProduct, setTaskProduct] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const active = products.find(product => product.id === selected);
  const visible = products.filter(product => `${product.name} ${product.id}`.toLowerCase().includes(query.trim().toLowerCase()) && (filter === 'all' || (filter === 'available' ? product.available === true : product.available === false)));
  const run: SubmitCommand = async (path, payload, success) => { setBusy(true); try { const ok = await submit(path, payload, success); if (ok) setSelected(''); return ok; } finally { setBusy(false); } };
  const statusText = (product: Product) => product.available === undefined ? 'Status unknown' : product.available ? 'Available' : 'Unavailable';
  return <section className="panel recipes-directory" aria-labelledby="recipes-directory-title">
    <div className="accounts-directory-header"><div><h2 id="recipes-directory-title">Recipe catalogue</h2><p className="quiet">Manage menu prices, ingredients and ordering availability.</p></div><button type="button" className="primary" disabled={disabled || !ingredients.length} onClick={onCreate}>Create recipe</button></div>
    {!ingredients.length && <p className="settings-note">Add ingredients on the Stock page to create a recipe.</p>}
    <div className="recipes-filters"><label>Search recipes<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or product ID" /></label><label>Availability<select aria-label="Filter recipe availability" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All recipes</option><option value="available">Available to order</option><option value="unavailable">Unavailable to order</option></select></label></div>
    <p className="recipes-result-count quiet" role="status">{visible.length} of {products.length} recipes</p>
    {!visible.length ? <div className="accounts-empty"><h3>{products.length ? 'No matching recipes' : 'No recipes yet'}</h3><p className="quiet">{products.length ? 'Try another name or change the availability filter.' : 'Create a recipe to add an item to the menu.'}</p>{products.length > 0 && <button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>Clear filters</button>}</div> : <Rows columns={['Recipe', 'Retail price', 'Ingredients', 'Availability', 'Action']}>
      {visible.map(product => <tr key={product.id}><Cell label="Recipe"><div className="recipes-identity"><strong>{product.name}</strong><span className="record-id">Version {product.version}</span></div></Cell><Cell label="Retail price"><strong>{money(product.priceCentavos)}</strong></Cell><Cell label="Ingredients">{product.recipe.length} {product.recipe.length === 1 ? 'ingredient' : 'ingredients'}</Cell><Cell label="Availability"><span className={`recipes-status ${product.available === true ? 'is-available' : product.available === false ? 'is-unavailable' : ''}`}>{statusText(product)}</span></Cell><Cell label="Action"><button type="button" aria-label={`Manage recipe ${product.name}`} onClick={() => { setSelected(product.id); setView('details'); }}>Manage recipe</button></Cell></tr>)}
    </Rows>}
    {active && <ActionModal title={view === 'details' ? 'Recipe details' : view === 'edit' ? 'Edit recipe' : 'Change availability'} dismissDisabled={busy} onClose={() => setSelected('')}>
      {view === 'details' ? <>
        <div className="recipes-modal-identity"><h3>{active.name}</h3><p className={`recipes-status ${active.available === true ? 'is-available' : active.available === false ? 'is-unavailable' : ''}`}>{statusText(active)}</p></div>
        <div className="recipes-manage-actions"><button type="button" className="primary" disabled={disabled} onClick={() => { setTaskProduct(active); setView('edit'); }}>Edit price & quantities</button><button type="button" disabled={disabled || active.available === undefined || active.availabilityVersion === undefined} onClick={() => { setTaskProduct(active); setView('availability'); }}>Change availability</button></div>
        {active.available === undefined && <p className="settings-note">Refresh the recipe list to check ordering availability.</p>}
        <RecipeDetails product={active} ingredients={ingredients} /><div className="accounts-modal-footer"><button type="button" onClick={() => setSelected('')}>Done</button></div>
      </> : view === 'edit' ? <RecipeVersionEditor product={taskProduct ?? active} ingredients={ingredients} submit={run} disabled={disabled || busy} onCancel={() => setView('details')} /> : <ProductAvailability product={taskProduct ?? active} submit={run} disabled={disabled || busy} onCancel={() => setView('details')} />}
    </ActionModal>}
  </section>;
}

export function Recipes(props: WorkspaceProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = useData(props, catalogue);
  const cached = useRef<{ session: Session; value: Awaited<ReturnType<typeof catalogue>> } | null>(null);
  if (data.value) cached.current = { session: props.session, value: data.value };
  const value = data.value ?? (cached.current?.session === props.session ? cached.current.value : null);
  const disabled = props.disabled || data.loading || data.error !== null;
  const create: SubmitCommand = async (path, payload, success) => { setBusy(true); try { const ok = await props.submit(path, payload, success); if (ok) setCreateOpen(false); return ok; } finally { setBusy(false); } };
  return <><Heading title="Recipes" detail="Manage menu recipes." {...data} />
    {data.loading && <p className="notice" role="status">Refreshing recipes…</p>}
    {data.error && <p className="notice error" role="alert">{data.error}</p>}
    {value && <>
      <RecipeList products={value.products} ingredients={value.ingredients} submit={props.submit} disabled={disabled} onCreate={() => setCreateOpen(true)} />
      <ActionModal title="Create recipe" open={createOpen} dismissDisabled={busy} onClose={() => setCreateOpen(false)}><RecipeForm ingredients={value.ingredients} submit={create} disabled={disabled || busy} onCancel={() => setCreateOpen(false)} /></ActionModal>
    </>}</>;
}

function NewIngredient({ submit, disabled, onCancel }: Pick<WorkspaceProps, 'submit' | 'disabled'> & { onCancel: () => void }) {
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await submit('/api/v1/ingredients', { ingredientId: field(data, 'ingredientId'), name: field(data, 'name'), unit: field(data, 'unit') }, 'Ingredient created.')) form.reset();
  }
  return <section className="stock-modal-content"><p className="quiet settings-modal-intro">Add the ingredient once, then record deliveries and physical counts against it.</p><form onSubmit={event => void save(event)}>
    <fieldset disabled={disabled} className="settings-fields">
      <label>Ingredient name<input name="name" maxLength={120} placeholder="e.g. Espresso beans" required /></label>
      <label>Ingredient ID<input name="ingredientId" pattern={idRouteSegment} maxLength={100} placeholder="e.g. espresso-beans" autoCapitalize="none" spellCheck={false} required /><span className="accounts-help">A unique code using letters, numbers, hyphens or underscores.</span></label>
      <label>Stock unit<select aria-label="Stock unit" name="unit"><option value="g">Grams (g)</option><option value="ml">Millilitres (ml)</option><option value="piece">Pieces (pc)</option></select><span className="accounts-help">Use this same unit for deliveries, recipes and counts.</span></label>
    </fieldset>
    <div className="accounts-modal-footer"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button><button className="primary" disabled={disabled}>{disabled ? 'Saving…' : 'Add ingredient'}</button></div>
  </form></section>;
}

function ReceiveStock({ ingredients, submit, disabled, onCancel }: { ingredients: Ingredient[]; submit: SubmitCommand; disabled: boolean; onCancel: () => void }) {
  const [error, setError] = useState('');
  const [method, setMethod] = useState<'quantity' | 'packs'>('quantity');
  const [ingredientId, setIngredientId] = useState('');
  const unit = ingredients.find(item => item.id === ingredientId)?.unit;
  const unitLabel = unit === 'piece' ? 'pc' : unit ?? 'ingredient units';
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const rawQty = field(data, 'quantity');
    const rawPacks = field(data, 'packCount');
    const rawPackSize = field(data, 'packSize');
    const supplier = field(data, 'supplier');
    const hasPacks = rawPacks !== '' || rawPackSize !== '';
    const packCount = rawPacks ? fixedPoint(rawPacks, 0, 1_000_000) : null;
    const packSizeMilli = rawPackSize ? fixedPoint(rawPackSize, 3, 1_000_000_000) : null;
    const directQuantityMilli = rawQty ? fixedPoint(rawQty, 3, 1_000_000_000) : null;
    if (hasPacks && (!packCount || !packSizeMilli)) {
      setError('Enter both a positive pack count and units per pack.');
      return;
    }
    const convertedMilli = hasPacks && packCount && packSizeMilli ? packCount * packSizeMilli : directQuantityMilli;
    if (!convertedMilli || !Number.isSafeInteger(convertedMilli) || convertedMilli > 1_000_000_000 ||
        (hasPacks && directQuantityMilli !== null && directQuantityMilli !== convertedMilli)) {
      setError('Enter a positive quantity matching any pack count and conversion size.');
      return;
    }
    const totalCostCentavos = fixedPoint(field(data, 'cost'), 2, 100_000_000_000);
    if (totalCostCentavos === null) { setError('Enter a positive quantity and a valid total cost.'); return; }
    setError('');
    const payload: Record<string, unknown> = {
      ingredientId: field(data, 'ingredient'),
      quantityMilli: convertedMilli,
      totalCostCentavos,
      reference: field(data, 'reference'),
      ...(supplier ? { supplier } : {}),
      ...(hasPacks && packCount && packSizeMilli ? { packCount, packSizeMilli } : {}),
    };
    if (await submit('/api/v1/inventory/receipts', payload, 'Stock receipt saved.')) form.reset();
  }
  return <section className="stock-modal-content">
    <p className="quiet settings-modal-intro">Record a delivery using the ingredient’s stock unit. Pack quantities are converted for you.</p>
    {ingredients.length === 0 ? <p>Add an ingredient first.</p> : <form onSubmit={event => void save(event)}>
      <fieldset disabled={disabled} className="settings-fields"><legend>Delivery quantity</legend>
        <label>Ingredient<select aria-label="Delivery ingredient" name="ingredient" value={ingredientId} onChange={e => { setIngredientId(e.target.value); setError(''); }} required><option value="" disabled>Select ingredient</option>{ingredients.map(item => <option key={item.id} value={item.id}>{item.name} ({item.unit === 'piece' ? 'pc' : item.unit})</option>)}</select></label>
        <label>Enter quantity as<select aria-label="Quantity method" value={method} onChange={e => { setMethod(e.target.value as typeof method); setError(''); }}><option value="quantity">Total quantity</option><option value="packs">Number of packs</option></select></label>
        {method === 'quantity' ? <label>Total quantity ({unitLabel})<input name="quantity" inputMode="decimal" placeholder="e.g. 1000" required /><span className="accounts-help">Use up to 3 decimal places.</span></label> : <>
          <div className="settings-form-grid"><label>Packs received<input name="packCount" inputMode="numeric" placeholder="e.g. 2" required /></label><label>Quantity per pack ({unitLabel})<input name="packSize" inputMode="decimal" placeholder="e.g. 500" required /></label></div>
          <p className="accounts-help">Stock added = packs received × quantity per pack.</p>
        </>}
      </fieldset>
      <fieldset disabled={disabled} className="settings-fields settings-fields-divider"><legend>Cost & receipt</legend>
        <div className="settings-form-grid"><label>Total delivery cost (PHP)<input name="cost" inputMode="decimal" placeholder="e.g. 450.00" required /><span className="accounts-help">Enter the total, not the price per unit. Zero is allowed.</span></label><label>Receipt reference<input name="reference" maxLength={120} placeholder="e.g. delivery receipt number" required /></label></div>
        <label>Supplier (optional)<input name="supplier" maxLength={120} placeholder="Supplier name" /></label>
      </fieldset>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="accounts-modal-footer"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button><button className="primary" disabled={disabled}>{disabled ? 'Saving…' : 'Save delivery'}</button></div>
    </form>}
  </section>;
}

async function inventoryWorkspace(session: Session) {
  const [stock, counts] = await Promise.all([api.ingredients(session), api.stockCounts(session)]);
  return { ...stock, ...counts };
}

function CountObservation({ count, submit, disabled, onCancel }: { count: StockCount; submit: SubmitCommand; disabled: boolean; onCancel: () => void }) {
  const [error, setError] = useState('');
  async function observe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const observedMilli = fixedPoint(field(data, 'observed'), 3, maxCountMilli);
    if (observedMilli === null) { setError('Enter zero or a positive quantity with up to three decimal places.'); return; }
    setError('');
    await submit(`${stockCountsPath}/${count.id}/observe`, { expectedVersion: count.version, unit: count.unit, observedMilli }, 'Count submitted for review.');
  }
  return <form className="count-action" onSubmit={event => void observe(event)}>
    <h4>Enter the physical count</h4>
    <label>Counted quantity ({count.unit === 'piece' ? 'pc' : count.unit})<input name="observed" inputMode="decimal" disabled={disabled} placeholder="Enter the quantity you counted" required /></label>
    <p className="quiet">Count the physical stock in the unit shown. Zero is a valid count.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="accounts-modal-footer"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button><button className="primary" disabled={disabled}>{disabled ? 'Submitting…' : 'Submit count'}</button></div>
  </form>;
}

function CountDecision({ count, submit, disabled, decision, onCancel }: { count: StockCount; submit: SubmitCommand; disabled: boolean; decision: 'approve' | 'discard'; onCancel: () => void }) {
  const [error, setError] = useState('');
  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = field(new FormData(event.currentTarget), 'reason');
    if (!reason) { setError('Enter a reason for the stock count decision.'); return; }
    setError('');
    await submit(`${stockCountsPath}/${count.id}/decide`, { expectedVersion: count.version, decision, reason },
      decision === 'approve' ? 'Stock count approved. The adjustment is posted.' : 'Count discarded. Start a fresh count when ready.');
  }
  return <form className="count-action" onSubmit={event => void decide(event)}>
    <h4>{decision === 'approve' ? 'Approve stock adjustment' : 'Discard this count'}</h4>
    <label>Reason for this decision<input name="reason" maxLength={maxCountText} disabled={disabled} placeholder="Explain the adjustment or why this count is being discarded" required /></label>
    {error && <p className="notice error" role="alert">{error}</p>}
    <p className="quiet">{decision === 'approve' ? 'Approval adds or subtracts the difference from the current stock balance.' : 'This closes the count without changing stock. Start a new count when ready.'}</p>
    <div className="accounts-modal-footer"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button><button className={decision === 'approve' ? 'primary' : 'devices-danger-solid'} disabled={disabled}>{disabled ? 'Saving…' : decision === 'approve' ? 'Approve adjustment' : 'Discard count'}</button></div>
  </form>;
}

type CountCostSpec = {
  endpoint: 'confirm-cost' | 'revalue';
  extraPayload?: Record<string, unknown>;
  successMessage: string;
  heading: string;
  description: string;
  costLabel: string;
  referenceLabel: string;
  buttonLabel: string;
};

function CountCostForm({ count, spec, submit, disabled, onCancel }: {
  count: StockCount; spec: CountCostSpec; submit: SubmitCommand; disabled: boolean; onCancel: () => void;
}) {
  const [error, setError] = useState('');
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const totalCostCentavos = fixedPoint(field(data, 'cost'), 2, maxCountCostCentavos);
    const reference = field(data, 'reference');
    if (totalCostCentavos === null || !reference) { setError('Enter a valid amount with up to two decimal places and an evidence reference.'); return; }
    setError('');
    await submit(`${stockCountsPath}/${count.id}/${spec.endpoint}`, {
      expectedVersion: count.version, totalCostCentavos, reference, ...spec.extraPayload,
    }, spec.successMessage);
  }
  return <form className="count-action" onSubmit={event => void confirm(event)}>
    <h4>{spec.heading}</h4>
    <p className="quiet">{spec.description}</p>
    <label>{spec.costLabel}<input name="cost" inputMode="decimal" disabled={disabled} placeholder="e.g. 450.00" required /></label>
    <label>{spec.referenceLabel}<input name="reference" maxLength={maxCountText} disabled={disabled} required /></label>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="accounts-modal-footer"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button><button className="primary" disabled={disabled}>{disabled ? 'Saving…' : spec.buttonLabel}</button></div>
  </form>;
}

const countStatus = { open: 'Open', submitted: 'Awaiting review', approved: 'Approved', discarded: 'Discarded' };
function CountDetails({ count, submit, disabled, ingredientName, onClose }: { count: StockCount; submit: SubmitCommand; disabled: boolean; ingredientName: string; onClose: () => void }) {
  const [action, setAction] = useState<'observe' | 'approve' | 'discard' | 'cost' | 'value' | null>(null);
  const stale = count.status === 'open' && count.liveStockVersion !== count.snapshotStockVersion;
  const outcome = count.varianceMilli === null ? null : count.liveOnHandMilli + count.varianceMilli;
  const variance = count.varianceMilli === null ? '—' : `${count.varianceMilli > 0 ? '+' : ''}${quantity(count.varianceMilli, count.unit)}`;
  return <section aria-label="Selected stock count" className="count-detail">
    <div className="stock-detail-heading"><h3>{ingredientName}</h3><p className="quiet">{countStatus[count.status]}{stale && ' · Recount needed'}</p></div>
    {!action && <details className="stock-record-details"><summary>Count reference</summary><p className="record-id">{count.id}</p></details>}
    <dl className="settings-summary stock-count-summary">
      {(!action || action === 'observe') && <div><dt>Stock when count started</dt><dd>{quantity(count.snapshotMilli, count.unit)}</dd></div>}
      {!action && <div><dt>Counted quantity</dt><dd>{count.observedMilli === null ? '—' : quantity(count.observedMilli, count.unit)}</dd></div>}
      {(!action || action === 'approve' || action === 'cost') && <div className="total"><dt>{action === 'cost' ? 'Extra stock added' : 'Difference'}</dt><dd>{variance}</dd></div>}
      {action !== 'observe' && <div><dt>Current on hand</dt><dd>{quantity(count.liveOnHandMilli, count.unit)}</dd></div>}
      {(!action || action === 'approve') && count.status === 'submitted' && outcome !== null && Number.isSafeInteger(outcome) && <div><dt>On hand after approval</dt><dd>{quantity(outcome, count.unit)}</dd></div>}
    </dl>
    {stale && <p className="notice" role="status">Stock changed before this count was submitted. Discard it and start a fresh count.</p>}
    {!action && <div className="stock-detail-actions">
      {count.status === 'open' && !stale && <button className="primary" type="button" disabled={disabled} onClick={() => setAction('observe')}>Enter physical count</button>}
      {count.status === 'submitted' && <button className="primary" type="button" disabled={disabled} onClick={() => setAction('approve')}>Review adjustment</button>}
      {count.costStatus === 'pending' && <button className="primary" type="button" disabled={disabled} onClick={() => setAction('cost')}>Confirm added-stock cost</button>}
      {count.canRevalue && <button type="button" disabled={disabled} onClick={() => setAction('value')}>Review stock value</button>}
      {(count.status === 'open' || count.status === 'submitted') && <button type="button" className="devices-revoke" disabled={disabled} onClick={() => setAction('discard')}>Discard count</button>}
    </div>}
    {action && <button type="button" className="stock-back-button" disabled={disabled} onClick={() => setAction(null)}>Back to count details</button>}
    {action === 'observe' && count.status === 'open' && !stale && <CountObservation count={count} submit={submit} disabled={disabled} onCancel={() => setAction(null)} />}
    {(action === 'approve' && count.status === 'submitted' || action === 'discard' && (count.status === 'open' || count.status === 'submitted')) && <CountDecision count={count} submit={submit} disabled={disabled} decision={action === 'approve' ? 'approve' : 'discard'} onCancel={() => setAction(null)} />}
    {!action && count.reason && <p className="approval-recorded">Reason · {count.reason}</p>}
    {count.costStatus === 'pending' && action === 'cost' && <><CountCostForm count={count} submit={submit} disabled={disabled} onCancel={() => setAction(null)} spec={{
      endpoint: 'confirm-cost',
      successMessage: 'Additional stock cost confirmed.',
      heading: 'Confirm additional stock cost',
      description: `Confirm the total ingredient cost of the additional ${quantity(count.varianceMilli ?? 0, count.unit)} found. The quantity adjustment is already posted.`,
      costLabel: 'Additional stock cost (PHP)',
      referenceLabel: 'Cost reference',
      buttonLabel: 'Confirm count cost',
    }} /></>}
    {!action && count.costStatus === 'confirmed' && <dl className="detail-lines">
      <div><dt>Additional stock cost</dt><dd>{money(count.totalCostCentavos)}</dd></div>
      <div><dt>Cost reference</dt><dd>{count.costReference}</dd></div>
    </dl>}
    {count.canRevalue && action === 'value' && <CountCostForm count={count} submit={submit} disabled={disabled} onCancel={() => setAction(null)} spec={{
      endpoint: 'revalue',
      extraPayload: { expectedStockVersion: count.liveStockVersion },
      successMessage: 'Current stock value confirmed.',
      heading: 'Review the whole current balance',
      description: `Confirm the total value of all ${quantity(count.liveOnHandMilli, count.unit)} currently on hand. Earlier stock use left the remaining value unresolved.`,
      costLabel: 'Current stock value (PHP)',
      referenceLabel: 'Valuation reference',
      buttonLabel: 'Confirm current stock value',
    }} />}
    {!action && count.balanceCostCentavos !== null && <dl className="detail-lines">
      <div><dt>Approved whole balance value</dt><dd>{money(count.balanceCostCentavos)}</dd></div>
      <div><dt>Valuation reference</dt><dd>{count.balanceCostReference}</dd></div>
    </dl>}
    {!action && <div className="accounts-modal-footer"><button type="button" onClick={onClose}>Close count</button></div>}
  </section>;
}

function StockCounts({ counts, ingredients, submit, disabled }: {
  counts: StockCount[]; ingredients: Ingredient[]; submit: SubmitCommand; disabled: boolean;
}) {
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const run: SubmitCommand = async (path, payload, success) => { setBusy(true); try { return await submit(path, payload, success); } finally { setBusy(false); } };
  const [startOpen, setStartOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const available = ingredients.filter(item => !counts.some(count => count.ingredientId === item.id && (count.status === 'open' || count.status === 'submitted')));
  const visibleCounts = counts.filter(count => filter === 'all' || count.status === filter);
  const active = counts.find(count => count.id === selected);
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled) return;
    const ingredientId = field(new FormData(event.currentTarget), 'ingredient');
    if (await run(stockCountsPath, { ingredientId }, 'Stock count opened. Count the physical stock before any movement.')) { setSelected(''); setStartOpen(false); }
  }
  return <div className="inventory-counts stock-counts-layout">
    <section className="panel stock-panel stock-count-start" aria-labelledby="stock-counts-title">
      <h2 id="stock-counts-title">Check physical stock</h2><p className="quiet">Compare what you count with the recorded balance.</p>
      <ol className="stock-count-steps"><li>Choose an ingredient.</li><li>Count it before stock moves.</li><li>Review and approve the difference.</li></ol>
      <p className="settings-note">Extra stock is added on approval. Confirm its cost separately.</p>
      <button className="primary" type="button" disabled={disabled || !available.length} onClick={() => setStartOpen(true)}>Start stock count</button>
      {!available.length && <p className="settings-note">{ingredients.length ? 'Every ingredient has an active count. Review or discard one to start again.' : 'Add an ingredient first.'}</p>}
      <ActionModal title="Start stock count" open={startOpen} dismissDisabled={busy} onClose={() => setStartOpen(false)}>
        <p className="quiet settings-modal-intro">Choose the ingredient you will count. Use its stock unit and avoid deliveries or stock use until you submit the count.</p>
        <form onSubmit={event => void start(event)}>
          <label>Count ingredient<select aria-label="Count ingredient" name="ingredient" defaultValue="" disabled={disabled} required><option value="" disabled>Select ingredient</option>{available.map(item => <option key={item.id} value={item.id}>{item.name} ({item.unit === 'piece' ? 'pc' : item.unit})</option>)}</select></label>
          <div className="accounts-modal-footer"><button type="button" disabled={disabled} onClick={() => setStartOpen(false)}>Cancel</button><button className="primary" disabled={disabled}>{disabled ? 'Starting…' : 'Start count'}</button></div>
        </form>
      </ActionModal>
    </section>
    <section className="panel stock-panel stock-count-list" aria-labelledby="stock-count-history-title">
      <div className="settings-section-header"><h2 id="stock-count-history-title">Stock counts</h2><span className="quiet stock-small">{counts.length} total</span></div>
      <label className="stock-count-filter">Show counts<select aria-label="Show counts" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All counts</option><option value="open">Open</option><option value="submitted">Awaiting review</option><option value="approved">Approved</option><option value="discarded">Discarded</option></select></label>
      {!visibleCounts.length ? <p className="empty">{counts.length ? 'No counts match this filter.' : 'No stock counts yet.'}</p> : <ul className="list count-history" aria-label="Stock count history">{visibleCounts.map(count => <li key={count.id} aria-label={`Stock count ${count.id}`}>
        <div className="stock-count-copy"><strong>{ingredients.find(item => item.id === count.ingredientId)?.name ?? count.ingredientId}</strong><p className="quiet">{countStatus[count.status]}</p>{count.costStatus === 'pending' && <p className="stock-attention">Cost confirmation needed</p>}{count.canRevalue && <p className="stock-attention">Stock value review needed</p>}</div>
        <button type="button" aria-pressed={active?.id === count.id} onClick={() => setSelected(count.id)}>View count</button>
      </li>)}</ul>}
      {active && <ActionModal title="Stock count" dismissDisabled={busy} onClose={() => setSelected('')}><CountDetails key={`${active.id}-${active.version}`} count={active} ingredientName={ingredients.find(item => item.id === active.ingredientId)?.name ?? active.ingredientId} submit={run} disabled={disabled || busy} onClose={() => setSelected('')} /></ActionModal>}
    </section>
  </div>;
}

function ThresholdForm({ ingredient, threshold, submit, disabled, onCancel }: {
  ingredient: Ingredient; threshold: Threshold; submit: SubmitCommand; disabled: boolean; onCancel: () => void;
}) {
  const [clear, setClear] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const thresholdMilli = clear ? null : fixedPoint(field(form, 'threshold'), 3, maxThresholdMilli);
    const reason = field(form, 'reason');
    if ((!clear && thresholdMilli === null) || !reason) { setError('Enter a threshold with up to three decimal places and a reason for the change.'); return; }
    setError('');
    await submit(`${inventoryThresholdsPath}/${ingredient.id}`, { expectedVersion: threshold.version, thresholdMilli, reason },
      clear ? 'Low-stock threshold cleared. Shortage monitoring remains active.' : 'Low-stock threshold saved. Current conditions have been evaluated.');
  }
  return <form className="threshold-form" onSubmit={event => void save(event)}>
    <h3>{ingredient.name}</h3><p className="quiet">Current limit: {threshold.thresholdMilli === null ? 'Not set' : quantity(threshold.thresholdMilli, ingredient.unit)}</p>
    <p className="accounts-help">A low-stock alert opens when stock on hand reaches this limit. Shortage alerts use available stock and remain active separately.</p>
    <label className="coverage-check"><input type="checkbox" checked={clear} onChange={event => setClear(event.target.checked)} disabled={disabled} />Turn off low-stock alerts for this ingredient</label>
    <label>Low-stock limit ({ingredient.unit === 'piece' ? 'pc' : ingredient.unit})<input name="threshold" inputMode="decimal"
      defaultValue={threshold.thresholdMilli === null ? '' : String(threshold.thresholdMilli / 1000)} disabled={disabled || clear} required={!clear} /></label>
    <label>Reason for this change<input name="reason" maxLength={maxAlertNote} disabled={disabled} placeholder="e.g. Updated our minimum stock level" required /></label>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="accounts-modal-footer"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button><button className="primary" disabled={disabled}>{disabled ? 'Saving…' : 'Save stock limit'}</button></div>
  </form>;
}

function ThresholdChangeHistory({ ingredient, ...props }: WorkspaceProps & { ingredient: Ingredient }) {
  const load = useCallback((session: Session) => api.inventoryThresholdHistory(session, ingredient.id), [ingredient.id]);
  const data = useData(props, load);
  const { pages, cursor, loading, error, loadMore } = useCursorPagination<ThresholdHistory, number>(
    data.value,
    page => page.nextBeforeVersion,
    beforeVersion => api.inventoryThresholdHistory(props.session, ingredient.id, beforeVersion),
    caught => {
      props.onError(caught, props.session);
      return caught instanceof HubError ? caught.message : 'More threshold changes could not be loaded.';
    },
  );
  const showValue = (value: number | null) => value === null ? 'Not configured' : quantity(value, ingredient.unit);
  return <section className="stock-alert-history" aria-label="Threshold change history">
    <div className="section-heading"><h3>Limit change history</h3><button type="button" onClick={data.refresh} disabled={data.loading}>Refresh limit history</button></div>
    <DataState state={data}>{data.value && <>
      {pages.flatMap(page => page.events).length === 0 ? <p className="empty">No limit changes recorded.</p> : <ul className="list">
        {pages.flatMap(page => page.events).map(event => <li key={event.commandId}>
          <div className="record-line"><strong>{showValue(event.previousMilli)} → {showValue(event.thresholdMilli)}</strong><span>{dateTime(event.at)}</span></div>
          <p className="quiet">Recorded by {event.actorId}</p><p>{event.reason}</p>
        </li>)}
      </ul>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {cursor && <button type="button" onClick={() => void loadMore()} disabled={loading}>{loading ? 'Loading changes…' : 'Load more threshold changes'}</button>}
    </>}</DataState>
  </section>;
}

function StockThresholds({ ingredients, thresholds, selected, setSelected, thresholdOpen, setThresholdOpen, ...props }: WorkspaceProps & {
  ingredients: Ingredient[]; thresholds: Threshold[]; selected: string; setSelected: (value: string) => void; thresholdOpen: boolean; setThresholdOpen: (value: boolean) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ingredient = ingredients.find(item => item.id === selected) ?? ingredients[0];
  const threshold = thresholds.find(item => item.ingredientId === ingredient?.id);
  return <section className="stock-limits" aria-labelledby="stock-thresholds-title">
    <h3 id="stock-thresholds-title">Stock limits</h3>
    <p className="quiet">Low-stock alerts use this limit. Shortages use available stock.</p>
    {ingredients.length === 0 ? <p className="empty">Add an ingredient to configure its threshold.</p> : <>
      <div className="stock-limit-controls"><label className="threshold-picker">Ingredient<select aria-label="Ingredient" value={ingredient?.id ?? ''} onChange={event => setSelected(event.target.value)}>
        {ingredients.map(item => <option key={item.id} value={item.id}>{item.name} ({item.unit === 'piece' ? 'pc' : item.unit})</option>)}
      </select></label>
      {ingredient && threshold && <button type="button" onClick={() => setThresholdOpen(true)}>Edit stock limit</button>}</div>
      {ingredient && threshold ? <><p className="stock-current-limit">Current limit: <strong>{threshold.thresholdMilli === null ? 'Not set' : quantity(threshold.thresholdMilli, ingredient.unit)}</strong></p><ActionModal title="Edit stock limit" open={thresholdOpen} dismissDisabled={busy} onClose={() => setThresholdOpen(false)}><ThresholdForm key={`${ingredient.id}-${threshold.version}`} ingredient={ingredient} threshold={threshold} submit={async (path, payload, success) => { setBusy(true); try { const ok = await props.submit(path, payload, success); if (ok) setThresholdOpen(false); return ok; } finally { setBusy(false); } }} disabled={props.disabled} onCancel={() => setThresholdOpen(false)} /></ActionModal>
        <button type="button" className="stock-history-button" onClick={() => setHistoryOpen(true)}>View limit change history</button>
        {historyOpen && <ActionModal title="Limit change history" onClose={() => setHistoryOpen(false)}><ThresholdChangeHistory key={ingredient.id} {...props} ingredient={ingredient} /></ActionModal>}</> :
        <p className="notice error" role="alert">The stock limit is unavailable. Refresh the Stock page.</p>}
    </>}
  </section>;
}

const alertKind = { low_stock: 'Low stock', shortage: 'Stock shortage' };
const alertState = { open: 'Needs acknowledgment', acknowledged: 'Acknowledged · Still active', resolved: 'Resolved' };
const alertEvent = { opened: 'Opened', updated: 'Updated', acknowledged: 'Acknowledged', resolved: 'Resolved' };
function AlertHistory({ alert, unit, ...props }: WorkspaceProps & { alert: StockAlert; unit: string }) {
  const load = useCallback((session: Session) => api.inventoryAlertHistory(session, alert.id), [alert.id]);
  const data = useData(props, load);
  return <section className="stock-alert-history" aria-label="Alert history">
    <div className="section-heading"><h4>Incident history</h4><button type="button" onClick={data.refresh} disabled={data.loading}>Refresh history</button></div>
    <DataState state={data}>{data.value && <>
      {data.value.events.length === 0 ? <p className="empty">No incident history available.</p> : <ul className="list">
        {data.value.events.map(event => <li key={event.id}>
          <div className="record-line"><strong>{alertEvent[event.type]}</strong><span>{event.at === 0 ? 'Existing condition' : dateTime(event.at)}</span></div>
          <p className="quiet">On hand {quantity(event.onHandMilli, unit)} · Reserved {quantity(event.reservedMilli, unit)} · Available {quantity(event.availableMilli, unit)}</p>
          {event.thresholdMilli !== null && <p className="quiet">Threshold {quantity(event.thresholdMilli, unit)}</p>}
          {event.actorId && <p className="quiet">Recorded by {event.actorId}</p>}
          {event.note && <p>{event.note}</p>}
        </li>)}
      </ul>}
      {data.value.shortages.length > 0 && <><h4 className="shortage-observations-title">Linked order shortages</h4><ul className="list">
        {data.value.shortages.map(item => <li key={item.id}>
          <div className="record-line"><strong>Order {item.orderId}</strong><span>{dateTime(item.at)}</span></div>
          <p className="quiet">{item.phase} · Required {quantity(item.requiredMilli, unit)} · Available {quantity(item.availableMilli, unit)} · Shortfall {quantity(item.shortfallMilli, unit)}</p>
        </li>)}
      </ul></>}
    </>}</DataState>
  </section>;
}

function StockAlertDetails({ alert, ingredient, ...props }: WorkspaceProps & { alert: StockAlert; ingredient: Ingredient }) {
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');
  async function acknowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = field(new FormData(event.currentTarget), 'note');
    if (!note) { setError('Enter an acknowledgment note.'); return; }
    setError('');
    await props.submit(`${inventoryAlertsPath}/${alert.id}/acknowledge`, { expectedVersion: alert.version, note },
      'Stock alert acknowledged. The condition stays active until it recovers.');
  }
  return <section className="stock-alert-detail" aria-label="Selected stock alert">
    <h3>{ingredient.name} · {alertKind[alert.kind]}</h3>
    <p className="quiet">{alertState[alert.status]}</p>
    <dl className="settings-summary stock-count-summary">
      <div><dt>On hand</dt><dd>{quantity(alert.onHandMilli, ingredient.unit)}</dd></div>
      <div><dt>Reserved</dt><dd>{quantity(alert.reservedMilli, ingredient.unit)}</dd></div>
      <div className="total"><dt>Available</dt><dd>{quantity(alert.availableMilli, ingredient.unit)}</dd></div>
      {alert.kind === 'low_stock' && <div><dt>Threshold</dt><dd>{alert.thresholdMilli === null ? 'Not configured' : quantity(alert.thresholdMilli, ingredient.unit)}</dd></div>}
    </dl>
    <dl className="detail-lines">
      <div><dt>Opened</dt><dd>{alert.openedAt === 0 ? 'Existing condition' : dateTime(alert.openedAt)}</dd></div>
      <div><dt>Last evaluated</dt><dd>{dateTime(alert.lastEvaluatedAt)}</dd></div>
      {alert.acknowledgedAt !== null && <><div><dt>Acknowledged by</dt><dd>{alert.acknowledgedBy}</dd></div><div><dt>Acknowledged</dt><dd>{dateTime(alert.acknowledgedAt)}</dd></div></>}
      {alert.resolvedAt !== null && <><div><dt>Resolved</dt><dd>{dateTime(alert.resolvedAt)}</dd></div><div><dt>Resolution</dt><dd>{alert.resolution === 'threshold_changed' ? 'Threshold changed' : 'Stock recovered'}</dd></div></>}
    </dl>
    {alert.acknowledgmentNote && <p className="approval-recorded">Acknowledgment · {alert.acknowledgmentNote}</p>}
    {alert.status === 'open' && <form className="count-action" onSubmit={event => void acknowledge(event)}>
      <label>Your response<input name="note" maxLength={maxAlertNote} disabled={props.disabled} placeholder="e.g. Ordered more stock for tomorrow" required /></label><p className="accounts-help">Acknowledging records your response. The alert stays active until the stock issue clears.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="accounts-modal-footer"><button className="primary" disabled={props.disabled}>{props.disabled ? 'Saving…' : 'Acknowledge alert'}</button></div>
    </form>}
    <button type="button" className="stock-history-button" aria-expanded={showHistory} disabled={props.disabled} onClick={() => setShowHistory(value => !value)}>{showHistory ? 'Hide alert history' : 'View alert history'}</button>
    {showHistory && <AlertHistory {...props} alert={alert} unit={ingredient.unit} />}
  </section>;
}

function StockAlertPages({ initial, filter, ingredients, onStaleCursor, onEditLimit, ...props }: WorkspaceProps & {
  initial: InventoryAlerts; filter: 'active' | 'acknowledged' | 'resolved'; ingredients: Ingredient[]; onStaleCursor: () => void; onEditLimit: (ingredientId: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const run: SubmitCommand = async (path, payload, success) => { setBusy(true); try { return await props.submit(path, payload, success); } finally { setBusy(false); } };
  useEffect(() => { setSelected(''); }, [initial]);
  const { pages, cursor, loading, error, loadMore } = useCursorPagination<InventoryAlerts, string>(
    initial,
    page => page.nextCursor,
    before => api.inventoryAlerts(props.session, filter === 'resolved' ? 'resolved' : 'active', before),
    caught => {
      props.onError(caught, props.session);
      if (caught instanceof HubError && caught.status === 404) {
        onStaleCursor();
        return null;
      }
      return caught instanceof HubError ? caught.message : 'More alerts could not be loaded. Retry to continue.';
    },
  );
  const alerts = pages.flatMap(page => page.alerts).filter(alert => filter !== 'acknowledged' || alert.status === 'acknowledged');
  const active = alerts.find(alert => alert.id === selected);
  const ingredient = ingredients.find(item => item.id === active?.ingredientId);
  return <>
    {alerts.length === 0 ? <p className="empty">{filter === 'resolved' ? 'No resolved incidents in this view.' : filter === 'acknowledged' ? 'No acknowledged alerts in this view.' : 'No active stock alerts.'}</p> : <div className="stock-alert-layout">
      <ul className="list" aria-label="Stock alert incidents">
        {alerts.map(alert => <li key={alert.id} aria-label={`Stock alert ${alert.id}`}>
          <div className="stock-alert-copy"><strong>{ingredients.find(item => item.id === alert.ingredientId)?.name ?? alert.ingredientId} · {alertKind[alert.kind]}</strong>
          <p className="quiet">{alertState[alert.status]}</p>
          <small className="record-id">{alert.openedAt === 0 ? 'Existing condition' : dateTime(alert.openedAt)}</small></div>
          <div className="button-row stock-alert-actions"><button type="button" aria-label={`Review alert ${alert.id}`} aria-pressed={active?.id === alert.id} onClick={() => setSelected(alert.id)}>Review alert</button>
          {ingredients.some(item => item.id === alert.ingredientId) && <button type="button" aria-label={`Edit stock limit for ${ingredients.find(item => item.id === alert.ingredientId)?.name ?? alert.ingredientId}`} disabled={props.disabled} onClick={() => onEditLimit(alert.ingredientId)}>Edit limit</button>}</div>
        </li>)}
      </ul>
      {active && ingredient && <ActionModal title="Stock alert" dismissDisabled={busy} onClose={() => setSelected('')}><StockAlertDetails key={`${active.id}-${active.version}`} {...props} submit={run} alert={active} ingredient={ingredient} /></ActionModal>}
      {active && !ingredient && <p className="notice error" role="alert">The alert ingredient is unavailable. Refresh the Stock page.</p>}
    </div>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {cursor && <button type="button" className="load-alerts" onClick={() => void loadMore()} disabled={loading}>{loading ? 'Loading alerts…' : 'Load more alerts'}</button>}
  </>;
}

function InventoryAlertWorkspace({ ingredients, ...props }: WorkspaceProps & { ingredients: Ingredient[] }) {
  const [filter, setFilter] = useState<'active' | 'acknowledged' | 'resolved'>('active');
  const [selectedIngredient, setSelectedIngredient] = useState('');
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const status = filter === 'resolved' ? 'resolved' : 'active';
  const load = useCallback((session: Session) => api.inventoryAlerts(session, status), [status]);
  const data = useData(props, load);
  return <section className="panel stock-panel inventory-alerts" aria-labelledby="stock-alerts-title">
    <div className="section-heading"><h2 id="stock-alerts-title">Stock alerts & limits</h2><button type="button" onClick={data.refresh} disabled={data.loading}>Refresh alerts</button></div>
    <p className="quiet">Review stock alerts and set levels for low stock.</p>
    <label className="alert-filter">Show alerts<select aria-label="Show alerts" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
      <option value="active">Active alerts</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved history</option>
    </select></label>
    <DataState state={data}>{data.value && <div className="stock-monitor-layout">
      <section className="stock-alerts-list" aria-labelledby="stock-alert-list-title">
        <h3 id="stock-alert-list-title">Alerts</h3>
        <div className="stock-alert-heading"><p className="quiet">An alert stays active until the issue is cleared.</p><p className="quiet">Last checked {dateTime(data.value.evaluatedAt)}</p></div>
        <StockAlertPages key={`${status}-${data.value.evaluatedAt}`} {...props} initial={data.value} filter={filter} ingredients={ingredients} onStaleCursor={data.refresh} onEditLimit={ingredientId => { setSelectedIngredient(ingredientId); setThresholdOpen(true); }} />
      </section>
      <StockThresholds {...props} ingredients={ingredients} thresholds={data.value.thresholds} selected={selectedIngredient} setSelected={setSelectedIngredient} thresholdOpen={thresholdOpen} setThresholdOpen={setThresholdOpen} disabled={props.disabled || data.loading} />
    </div>}</DataState>
  </section>;
}

export function Inventory(props: WorkspaceProps) {
  const [ingredientOpen, setIngredientOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [unitFilter, setUnitFilter] = useState('all');
  const data = useData(props, inventoryWorkspace);
  const ingredients = data.value?.ingredients ?? [];
  const visibleIngredients = ingredients.filter(item => `${item.name} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()) && (unitFilter === 'all' || item.unit === unitFilter));
  const submitAndClose = (close: () => void): SubmitCommand => async (path, payload, success) => {
    setBusy(true);
    try { const ok = await props.submit(path, payload, success); if (ok) close(); return ok; }
    finally { setBusy(false); }
  };
  return <><Heading title="Stock" detail="Review ingredient balances, receive stock, and reconcile physical counts." {...data} />
    <DataState state={data}><div className="inventory-layout stock-workspace">
      <section className="panel stock-panel stock-balances" aria-labelledby="stock-balances-title">
        <div className="accounts-directory-header"><div><h2 id="stock-balances-title">Ingredients</h2><p className="quiet">Track quantities and record new deliveries.</p></div><div className="stock-directory-actions"><button type="button" disabled={props.disabled} onClick={() => setIngredientOpen(true)}>Add ingredient</button><button type="button" className="primary" disabled={props.disabled || !ingredients.length} onClick={() => setReceiptOpen(true)}>Receive stock</button></div></div>
        <div className="stock-directory-filters"><label>Search ingredients<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or ingredient ID" /></label><label>Stock unit<select aria-label="Filter stock unit" value={unitFilter} onChange={e => setUnitFilter(e.target.value)}><option value="all">All units</option><option value="g">Grams (g)</option><option value="ml">Millilitres (ml)</option><option value="piece">Pieces (pc)</option></select></label></div>
        <div className="stock-list-meta"><p role="status">{visibleIngredients.length} of {ingredients.length} ingredients</p><p>Available = on hand − reserved for orders.</p></div>
        {!visibleIngredients.length ? <div className="accounts-empty"><h3>{ingredients.length ? 'No matching ingredients' : 'No ingredients yet'}</h3><p className="quiet">{ingredients.length ? 'Try another name or stock unit.' : 'Add an ingredient before recording stock.'}</p>{ingredients.length > 0 && <button type="button" onClick={() => { setQuery(''); setUnitFilter('all'); }}>Clear filters</button>}</div> : <Rows columns={['Ingredient', 'On hand', 'Reserved', 'Available']}>
          {visibleIngredients.map(item => <tr key={item.id}>
            <Cell label="Ingredient"><div className="stock-ingredient-identity"><strong>{item.name}</strong><small className="record-id">{item.id}</small></div></Cell>
            <Cell label="On hand">{quantity(item.onHandMilli, item.unit)}</Cell><Cell label="Reserved">{quantity(item.reservedMilli, item.unit)}</Cell>
            <Cell label="Available"><strong className={item.onHandMilli < item.reservedMilli ? 'negative' : undefined}>{quantity(item.onHandMilli - item.reservedMilli, item.unit)}</strong></Cell>
          </tr>)}
        </Rows>}
      </section>
      <InventoryAlertWorkspace {...props} ingredients={ingredients} />
      <StockCounts counts={data.value?.counts ?? []} ingredients={ingredients} submit={props.submit} disabled={props.disabled || data.loading} />
      <ActionModal title="Add ingredient" open={ingredientOpen} dismissDisabled={busy} onClose={() => setIngredientOpen(false)}><NewIngredient submit={submitAndClose(() => setIngredientOpen(false))} disabled={props.disabled} onCancel={() => setIngredientOpen(false)} /></ActionModal>
      <ActionModal title="Receive stock" open={receiptOpen} dismissDisabled={busy} onClose={() => setReceiptOpen(false)}><ReceiveStock ingredients={ingredients} submit={submitAndClose(() => setReceiptOpen(false))} disabled={props.disabled} onCancel={() => setReceiptOpen(false)} /></ActionModal>
    </div></DataState></>;
}

const manilaDay = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });

function currentManilaPeriod() {
  const parts = manilaDay.formatToParts(new Date());
  const year = parts.find(part => part.type === 'year')!.value;
  const month = parts.find(part => part.type === 'month')!.value;
  const day = parts.find(part => part.type === 'day')!.value;
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return { from: `${year}-${month}-01`, through: `${year}-${month}-${lastDay}`, today: `${year}-${month}-${day}` };
}

function useDatePeriod(throughKey: 'through' | 'today') {
  const [calendar] = useState(currentManilaPeriod);
  const [period, setPeriod] = useState<ExpensePeriod>({ from: calendar.from, through: calendar[throughKey] });
  const [dateError, setDateError] = useState('');
  function applyPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget);
    const from = field(input, 'from');
    const through = field(input, 'through');
    if (!validDatePeriod(from, through)) { setDateError('Choose a report end date on or after its start date.'); return; }
    setDateError('');
    setPeriod({ from, through });
  }
  return { calendar, period, dateError, applyPeriod };
}

function ExpenseForm({ submit, disabled, today, onCancel }: Pick<WorkspaceProps, 'submit' | 'disabled'> & { today: string; onCancel: () => void }) {
  const [error, setError] = useState('');
  const [timing, setTiming] = useState<'day' | 'range'>('day');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const coveredDays = validDatePeriod(startsOn, endsOn) ? (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000 + 1 : null;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const category = field(data, 'category');
    const description = field(data, 'description');
    const amountCentavos = fixedPoint(field(data, 'amount'), 2, 1_000_000_000);
    const end = timing === 'day' ? startsOn : endsOn;
    if (!category || !description) { setError('Enter a category and description.'); return; }
    if (!amountCentavos) { setError('Enter an amount greater than zero with up to 2 decimal places. The maximum is ₱10,000,000.'); return; }
    if (!validDatePeriod(startsOn, end)) { setError('Choose an expense end date on or after its start date.'); return; }
    setError('');
    if (await submit('/api/v1/admin/expenses', { category, description, amountCentavos, startsOn, endsOn: end }, 'Operating expense saved.')) {
      form.reset(); setTiming('day'); setStartsOn(today); setEndsOn(today);
    }
  }
  return <section className="expenses-form-content">
    <p className="quiet settings-modal-intro">Record the full cost, then choose the dates it covers.</p>
    <form className="expenses-entry-form" onSubmit={event => void save(event)} onChange={() => setError('')}>
      <fieldset disabled={disabled} className="settings-fields"><legend>Expense details</legend>
        <div className="settings-form-grid"><label>Category<input name="category" list="expense-category-suggestions" placeholder="e.g. Utilities" maxLength={80} required /><datalist id="expense-category-suggestions">{['Rent', 'Utilities', 'Supplies', 'Maintenance', 'Transport'].map(item => <option value={item} key={item} />)}</datalist></label><label>Total amount (PHP)<input name="amount" inputMode="decimal" placeholder="e.g. 1500.00" required /></label></div>
        <label>Description<textarea aria-label="Expense description" name="description" rows={3} maxLength={240} placeholder="e.g. Electricity bill for November" required /></label>
      </fieldset>
      <fieldset disabled={disabled} className="settings-fields settings-fields-divider"><legend>Dates covered</legend>
        <label>Apply this cost to<select aria-label="Expense date type" value={timing} onChange={e => { setTiming(e.target.value as typeof timing); setError(''); }}><option value="day">A single day</option><option value="range">A date range</option></select></label>
        <div className={timing === 'range' ? 'settings-form-grid' : ''}><label>{timing === 'day' ? 'Expense date' : 'Expense start date'}<input type="date" name="startsOn" min="0001-01-01" max="9999-12-31" value={startsOn} onChange={e => setStartsOn(e.target.value)} required /></label>{timing === 'range' && <label>Expense end date<input type="date" name="endsOn" min="0001-01-01" max="9999-12-31" value={endsOn} onChange={e => setEndsOn(e.target.value)} required /></label>}</div>
        <p className="accounts-help">{timing === 'day' ? 'The full amount counts on this date.' : coveredDays ? `Covers ${coveredDays} calendar ${coveredDays === 1 ? 'day' : 'days'}, including both dates. Reports include only the share for their selected dates.` : 'The end date must be on or after the start date.'} Dates use the Manila calendar.</p>
      </fieldset>
      <p className="expenses-entry-note">Record other operating costs here. Ingredient waste and dial-in costs are deducted automatically.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="accounts-modal-footer"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button><button className="primary" disabled={disabled}>{disabled ? 'Saving…' : 'Save expense'}</button></div>
    </form>
  </section>;
}

export function Expenses(props: WorkspaceProps) {
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<{ expense: Awaited<ReturnType<typeof api.expenses>>['expenses'][number]; from: string; through: string } | null>(null);
  const { calendar, period, dateError, applyPeriod } = useDatePeriod('through');
  const load = useCallback((session: Session) => api.expenses(session, period), [period]);
  const data = useData(props, load);
  useEffect(() => { setQuery(''); setCategory(''); }, [period.from, period.through]);
  const entries = data.value?.expenses ?? [];
  const categories = [...new Set(entries.map(expense => expense.category))].sort((a,b) => a.localeCompare(b));
  const visible = entries.filter(expense => `${expense.category} ${expense.description}`.toLowerCase().includes(query.trim().toLowerCase()) && (category === '' || expense.category === category));
  const record: SubmitCommand = async (path, payload, success) => { setBusy(true); try { const ok = await props.submit(path, payload, success); if (ok) setExpenseOpen(false); return ok; } finally { setBusy(false); } };
  return <>
    <Heading title="Expenses" detail="Review operating expenses." {...data} />
    <section className="panel expenses-directory" aria-labelledby="expense-report">
      <div className="accounts-directory-header"><div><h2 id="expense-report">Expense records</h2><p className="quiet">Record operating costs and review their share of a date range.</p></div><button type="button" className="primary" disabled={props.disabled} onClick={() => setExpenseOpen(true)}>Record expense</button></div>
      <form className="expenses-date-controls" aria-label="Expense reporting period" onSubmit={applyPeriod}>
        <label>Report start date<input type="date" name="from" min="0001-01-01" max="9999-12-31" defaultValue={period.from} required /></label><label>Report end date<input type="date" name="through" min="0001-01-01" max="9999-12-31" defaultValue={period.through} required /></label><button type="submit" disabled={data.loading}>Apply dates</button>
        <p className="accounts-help">Manila calendar dates. Both dates are included.</p>
      </form>
      {dateError && <p className="notice error" role="alert">{dateError}</p>}
      <DataState state={data}>{data.value && <>
        <div className="expenses-overview"><div><p className="expenses-total-label">Expenses in this date range</p><p className="expenses-total-amount" aria-live="polite">{money(data.value.allocatedCentavos)}</p><p className="quiet expenses-small"><time dateTime={data.value.from}>{data.value.from}</time> to <time dateTime={data.value.through}>{data.value.through}</time></p></div><p className="expenses-allocation-note">Multi-day costs are spread across the dates they cover. This total includes only the share within your report dates.</p></div>
        <div className="expenses-list-filters"><label>Search expenses<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search description or category" /></label><label>Category<select aria-label="Filter expense category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>
        <div className="expenses-list-meta"><p role="status">{visible.length} of {entries.length} listed entries</p><p>Search and category filters do not change the date-range total.</p></div>
        {data.value.truncated && <p className="notice">Only the 100 most recently recorded entries are listed. The total includes every overlapping expense. Narrow the report dates to reduce results.</p>}
        {!visible.length ? <div className="accounts-empty"><h3>{entries.length ? 'No matching expenses' : 'No expenses in this date range'}</h3><p className="quiet">{entries.length ? 'Try another description or category.' : 'Choose different report dates or record an expense.'}</p>{entries.length > 0 && <button type="button" onClick={() => { setQuery(''); setCategory(''); }}>Clear filters</button>}</div> : <Rows columns={['Expense', 'Covered dates', 'Total expense', 'In this range', 'Action']}>
          {visible.map(expense => <tr key={expense.id}>
            <Cell label="Expense"><div className="expenses-identity"><strong>{expense.description}</strong><span className="record-id">{expense.category}</span></div></Cell>
            <Cell label="Covered dates"><div className="expenses-covered-dates"><time dateTime={expense.startsOn}>{expense.startsOn}</time>{expense.startsOn !== expense.endsOn && <span>to <time dateTime={expense.endsOn}>{expense.endsOn}</time></span>}</div></Cell>
            <Cell label="Total expense">{money(expense.amountCentavos)}</Cell><Cell label="In this range"><strong>{money(expense.allocatedCentavos)}</strong></Cell>
            <Cell label="Action"><button type="button" aria-label={`View expense ${expense.description}`} onClick={() => setSelected({ expense, from: data.value!.from, through: data.value!.through })}>View details</button></Cell>
          </tr>)}
        </Rows>}
      </>}</DataState>
    </section>
    <ActionModal title="Record expense" open={expenseOpen} dismissDisabled={busy} onClose={() => setExpenseOpen(false)}><ExpenseForm submit={record} disabled={props.disabled || busy} today={calendar.today} onCancel={() => setExpenseOpen(false)} /></ActionModal>
    {selected && <ActionModal title="Expense details" onClose={() => setSelected(null)}>
      <div className="expenses-modal-identity"><h3>{selected.expense.description}</h3><p className="quiet">{selected.expense.category}</p></div>
      <dl className="settings-summary"><div><dt>Total recorded expense</dt><dd>{money(selected.expense.amountCentavos)}</dd></div><div><dt>Amount in this report</dt><dd>{money(selected.expense.allocatedCentavos)}</dd></div><div><dt>Dates covered</dt><dd>{selected.expense.startsOn}{selected.expense.startsOn !== selected.expense.endsOn ? ` to ${selected.expense.endsOn}` : ''}</dd></div><div><dt>Report dates</dt><dd>{selected.from} to {selected.through}</dd></div><div><dt>Recorded</dt><dd>{dateTime(selected.expense.recordedAt)}</dd></div></dl>
      <p className="settings-note">The report includes only the covered days that fall within its date range. Multi-day amounts use centavo-level allocation.</p>
      <details className="stock-record-details"><summary>Expense reference</summary><p className="record-id">{selected.expense.id}</p></details>
      <div className="accounts-modal-footer"><button type="button" onClick={() => setSelected(null)}>Done</button></div>
    </ActionModal>}
  </>;
}

const percent = new Intl.NumberFormat('en-PH', { style: 'percent', maximumFractionDigits: 2 });
const toDay = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;
const chartMoney = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', notation: 'compact', maximumFractionDigits: 2 });
type SalesDetail = 'daily' | 'sales' | 'costs' | 'checks';

function salesChecks(report: SalesReport) {
  const checks: { title: string; detail: string }[] = [];
  if (report.ordersWithUnknownIngredientCost) checks.push({ title: 'Ingredient costs need review', detail: `${number.format(report.ordersWithUnknownIngredientCost)} orders have incomplete ingredient costs. Subtotals show known amounts; profit remains unavailable.` });
  if (report.unattributedLegacySettlements) checks.push({ title: 'Older sales need verified dates', detail: `${number.format(report.unattributedLegacySettlements)} older paid orders have no verified settlement date and are excluded from dated sales. Profit remains unavailable.` });
  if (report.refundsWithUnknownAttribution) checks.push({ title: 'Refunds need a verified original sale', detail: `${number.format(report.refundsWithUnknownAttribution)} refund payouts cannot be linked to a verified original sale. Reconcile them before profit can be estimated.` });
  if (report.unknownRefundLegs) checks.push({ title: 'Refund outcomes need verification', detail: `${number.format(report.unknownRefundLegs)} refund payouts have an unknown outcome. Check merchant payment records in Refunds. Profit remains unavailable.` });
  if (report.wasteEntriesWithUnknownCost) checks.push({ title: 'Waste costs need review', detail: `${number.format(report.wasteEntriesWithUnknownCost)} waste entries have unresolved costs. The subtotal shows known costs. Operating profit remains unavailable.` });
  if (report.stockLossEntriesWithUnknownCost) checks.push({ title: 'Stock loss costs need review', detail: `${number.format(report.stockLossEntriesWithUnknownCost)} stock adjustments have unresolved costs. The subtotal shows known costs. Operating profit remains unavailable.` });
  if (report.cancelledOrdersAwaitingDisposition) checks.push({ title: 'Cancelled preparation needs a record', detail: `${number.format(report.cancelledOrdersAwaitingDisposition)} cancelled orders need a barista preparation record before profit can be estimated.` });
  if (report.cancellationsWithUnresolvedCost) checks.push({ title: 'Cancelled preparation costs need review', detail: `${number.format(report.cancellationsWithUnresolvedCost)} cancellations have unresolved preparation costs. Profit remains unavailable.` });
  if (report.cancelledPaymentsAwaitingRefundCentavos > 0 || report.cancelledPendingPaymentCentavos > 0) checks.push({ title: 'Cancelled-order payments need review', detail: `${money(report.cancelledPaymentsAwaitingRefundCentavos)} collected and awaiting refund review; ${money(report.cancelledPendingPaymentCentavos)} awaiting payment verification. Profit remains unavailable.` });
  if (!report.expenseCoverageConfirmed) checks.push({ title: 'Expenses need confirmation', detail: 'Review and confirm that all operating expenses for this exact date range are entered, including a range with no expenses. Operating profit also requires complete sales and cost records.' });
  return checks;
}

function SalesTrend({ report, onDetail }: { report: SalesReport; onDetail: (kind: SalesDetail) => void }) {
  const { dailySales, from, through } = report;
  const span = toDay(through) - toDay(from) + 1;
  const width = 660;
  const plotHeight = 165;
  const step = width / span;
  const barWidth = Math.min(step * .65, 66);
  const maximum = dailySales.reduce((value, day) => Math.max(value, day.settledSalesCentavos), 0);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, maximum / 4)));
  const axisStep = Math.max(1, Math.ceil(maximum / (4 * magnitude))) * magnitude;
  const guides = [4,3,2,1,0];
  return <section className="panel sales-report-card" aria-labelledby="daily-sales-heading">
    <div className="settings-section-header"><h2 id="daily-sales-heading">Sales overview</h2><button type="button" onClick={() => onDetail('sales')}>View sales details</button></div>
    <p className="sales-metric-label">Net sales</p><p className={`sales-value${report.netSalesCentavos < 0 ? ' negative' : ''}`}>{money(report.netSalesCentavos)}</p>
    <p className="quiet sales-card-copy">After confirmed sales refunds. {number.format(report.settledOrderCount)} {report.settledOrderCount === 1 ? 'settled order' : 'settled orders'} in this period.</p>
    {maximum > 0 ? <figure className="sales-chart">
      <figcaption>Daily settled sales <span>Before refunds</span></figcaption>
      <div className="chart-plot"><div className="chart-scale" aria-hidden="true">{guides.map(level => <span key={level}>{chartMoney.format(level * axisStep / 100)}</span>)}</div>
        <svg viewBox={`0 0 ${width} ${plotHeight}`} preserveAspectRatio="none" role="img" aria-label="Daily settled sales before refunds. Open daily figures for the amounts.">
          {guides.map(level => <path key={level} className="chart-guide" vectorEffect="non-scaling-stroke" d={`M0 ${plotHeight * (1-level/4)}H${width}`} />)}
          {dailySales.map(day => { const height = day.settledSalesCentavos / (axisStep * 4) * plotHeight; const x = (toDay(day.businessDate)-toDay(from))*step+(step-barWidth)/2; return <rect key={day.businessDate} x={x} y={plotHeight-height} width={barWidth} height={height} vectorEffect="non-scaling-stroke" className={day.settledSalesCentavos === maximum ? 'chart-bar chart-peak' : 'chart-bar'}><title>{day.businessDate} · {money(day.settledSalesCentavos)}</title></rect>; })}
        </svg>
      </div><div className="chart-dates"><time dateTime={from}>{from}</time><time dateTime={through}>{through}</time></div>
    </figure> : <p className="empty">No dated sales settled in this period.</p>}
    <div className="sales-card-footer"><button type="button" onClick={() => onDetail('daily')}>View daily figures</button></div>
  </section>;
}

function ProfitSummary({ report, onDetail }: { report: SalesReport; onDetail: (kind: SalesDetail) => void }) {
  const checks = salesChecks(report);
  return <section className="panel sales-report-card" aria-labelledby="profit-heading">
    <div className="settings-section-header"><h2 id="profit-heading">Profit estimate</h2><button type="button" onClick={() => onDetail('costs')}>View cost details</button></div>
    <p className="sales-metric-label">Estimated operating profit</p><p className={`sales-value${report.estimatedOperatingProfitCentavos !== null && report.estimatedOperatingProfitCentavos < 0 ? ' negative' : ''}`}>{report.estimatedOperatingProfitCentavos === null ? <span className="sales-unavailable">Unavailable</span> : money(report.estimatedOperatingProfitCentavos)}</p>
    <p className="quiet sales-card-copy">After ingredient costs, entered expenses and recorded losses.</p>
    <dl className="settings-summary sales-profit-summary"><div><dt>Estimated gross profit</dt><dd>{report.estimatedGrossProfitCentavos === null ? 'Unavailable' : money(report.estimatedGrossProfitCentavos)}</dd></div><div><dt>Estimated gross margin</dt><dd>{report.estimatedGrossMarginBps === null ? 'Unavailable' : percent.format(report.estimatedGrossMarginBps/10000)}</dd></div></dl>
    {checks.length > 0 ? <div className="sales-checks-summary"><p>Some report records need review. Cost subtotals can be incomplete.</p><button type="button" onClick={() => onDetail('checks')}>Review report checks ({checks.length})</button></div> : <p className="settings-note">The required report checks are complete for this date range.</p>}
  </section>;
}

function SalesReportDetails({ report, kind }: { report: SalesReport; kind: SalesDetail }) {
  const costs = [ ['Final ingredient cost', report.finalIngredientCostCentavos], ['Estimated pending ingredient cost', report.estimatedIngredientCostCentavos], ['Entered operating expenses', report.enteredExpensesCentavos], ['Waste and dial-in cost', report.wasteCostCentavos], ['Cancelled preparation loss', report.cancellationCostCentavos], ['Stock loss cost', report.stockLossCostCentavos] ] as const;
  const sales = [ ['Gross settled sales', report.grossSalesCentavos], ['Approved discounts', report.discountCentavos], ['Captured settled sales', report.settledSalesCentavos], ['Confirmed sales refunds', report.refundCentavos], ['Returned unsettled payments', report.returnedUnsettledCentavos] ] as const;
  return <>
    <p className="quiet sales-detail-period">Report dates: {report.from} to {report.through}. Manila dates, inclusive.</p>
    {kind === 'daily' ? <><p className="quiet settings-modal-intro">Daily figures show settled sales before refunds. Net sales deduct confirmed sales refunds on their recorded date.</p>{!report.dailySales.length ? <p className="empty">No dated sales in this period.</p> : <Rows columns={['Manila date','Settled orders','Settled sales']}>{report.dailySales.map(day => <tr key={day.businessDate}><Cell label="Manila date"><time dateTime={day.businessDate}>{day.businessDate}</time></Cell><Cell label="Settled orders">{number.format(day.settledOrderCount)}</Cell><Cell label="Settled sales">{money(day.settledSalesCentavos)}</Cell></tr>)}</Rows>}</>
      : kind === 'checks' ? <div className="sales-report-checks">{salesChecks(report).map(check => <section key={check.title}><h3>{check.title}</h3><p>{check.detail}</p></section>)}</div>
      : <><dl className="settings-summary sales-detail-values">{(kind === 'costs' ? costs : sales).map(([label,amount]) => <div key={label}><dt>{label}</dt><dd>{money(amount)}</dd></div>)}</dl>
        <p className="settings-note">{kind === 'costs' ? 'Cost subtotals show known amounts. Recorded ingredient waste, dial-in, stock loss and cancellation costs are included automatically. Review report checks for missing records.' : 'Returned unsettled payments are separate from sales refunds. Accepted ingredient consumption, waste and cancellation losses remain recorded.'}</p></>}
    <p className="settings-note">Tax and cloud reconciliation use their own records.</p>
  </>;
}

function ExpenseCoverage({ report, today, onReview }: { report: SalesReport; today: string; onReview: () => void }) {
  const isFuture = report.through > today;
  return <section className="panel sales-report-card sales-expense-review" aria-labelledby="expense-coverage-heading">
    <div><h2 id="expense-coverage-heading">Expense confirmation</h2><p className={`sales-coverage-status${report.expenseCoverageConfirmed ? ' is-confirmed' : ''}`}>{report.expenseCoverageConfirmed ? 'Confirmed for this date range' : isFuture ? 'Future dates cannot be confirmed' : 'Review needed for this date range'}</p><p className="quiet sales-card-copy">{isFuture ? 'Choose a range ending today or earlier before confirming.' : 'Confirm after all operating expenses are entered, including a range with no expenses.'}</p><p className="settings-note">An overlapping new expense reopens confirmation for review.</p></div>
    <button type="button" className={report.expenseCoverageConfirmed || isFuture ? '' : 'primary'} onClick={onReview}>{report.expenseCoverageConfirmed || isFuture ? 'View expenses' : 'Review & confirm expenses'}</button>
  </section>;
}

function SalesExpenseReview({ report, today, busy, onCancel, ...props }: WorkspaceProps & { report: SalesReport; today: string; busy: boolean; onCancel: () => void }) {
  const [reviewed, setReviewed] = useState<Awaited<ReturnType<typeof api.expenses>> | null>(null);
  const load = useCallback((session: Session) => api.expenses(session, { from: report.from, through: report.through }), [report.from, report.through]);
  const data = useData(props, load);
  const current = data.value?.from === report.from && data.value?.through === report.through && data.value.allocatedCentavos === report.enteredExpensesCentavos;
  const isFuture = report.through > today;
  const readOnly = isFuture || report.expenseCoverageConfirmed;
  const checked = reviewed !== null && reviewed === data.value;
  const canConfirm = checked && current && !readOnly && !props.disabled && !data.loading && !data.error;
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canConfirm) void props.submit('/api/v1/admin/expense-coverage', { from: report.from, through: report.through }, 'Expense coverage confirmed.');
  }
  return <form className="sales-expense-confirm-form" onSubmit={confirm}>
    <p className="quiet">Review expenses for {report.from} to {report.through}, including both dates.</p>
    <DataState state={data}>{data.value && <>
      <dl className="settings-summary"><div><dt>Expenses in this range</dt><dd>{money(data.value.allocatedCentavos)}</dd></div></dl>
      {!current && <p className="notice error" role="alert">Expenses changed since this report loaded. Close this window and refresh the report before confirming.</p>}
      {data.value.truncated && <p className="notice">The 100 most recently recorded entries are listed. The total includes every overlapping expense.</p>}
      {!data.value.expenses.length ? <p className="empty">No expenses are entered for these dates. Confirm only if that is correct.</p> : <Rows columns={['Expense','Total cost','In this range']}>{data.value.expenses.map(expense => <tr key={expense.id}><Cell label="Expense"><strong>{expense.description}</strong><span className="record-id">{expense.category} · {expense.startsOn} to {expense.endsOn}</span></Cell><Cell label="Total cost">{money(expense.amountCentavos)}</Cell><Cell label="In this range">{money(expense.allocatedCentavos)}</Cell></tr>)}</Rows>}
      {isFuture && <p className="notice">Future dates cannot be confirmed. Choose a range ending today or earlier.</p>}
      {!isFuture && report.expenseCoverageConfirmed && current && <p className="sales-coverage-status is-confirmed">Expenses are already confirmed for this exact range.</p>}
      {!readOnly && <label className="settings-restore-check sales-confirm-check">
        <input type="checkbox" checked={checked} onChange={e => setReviewed(e.target.checked ? data.value : null)} disabled={props.disabled || !current} required />
        I have entered all operating expenses for these dates.
      </label>}
      <p className="accounts-help">Adding another overlapping expense requires a new confirmation.</p>
    </>}</DataState>
    <div className="accounts-modal-footer">
      <button type="button" onClick={onCancel} disabled={busy}>{readOnly ? 'Done' : 'Cancel'}</button>
      {!readOnly && <button type="submit" className="primary" disabled={!canConfirm}>{busy ? 'Confirming…' : 'Confirm expenses'}</button>}
    </div>
  </form>;
}

export function Sales(props: WorkspaceProps) {
  const { calendar, period, dateError, applyPeriod } = useDatePeriod('today');
  const load = useCallback((session: Session) => api.sales(session, period), [period]);
  const data = useData(props, load);
  const [detail, setDetail] = useState<{ kind: SalesDetail; report: SalesReport } | null>(null);
  const [review, setReview] = useState<SalesReport | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm: SubmitCommand = async (path, payload, success) => { setBusy(true); try { const ok = await props.submit(path, payload, success); if (ok) setReview(null); return ok; } finally { setBusy(false); } };
  const detailTitles: Record<SalesDetail,string> = { daily: 'Daily sales figures', sales: 'Sales breakdown', costs: 'Cost breakdown', checks: 'Report checks' };
  return <>
    <Heading title="Sales & costs" detail="Review sales and operating costs." {...data} />
    <section className="panel sales-report-toolbar" aria-labelledby="sales-period-heading">
      <div className="settings-section-header">
        <h2 id="sales-period-heading">Report dates</h2>
        {data.value && <p>Showing <time dateTime={data.value.from}>{data.value.from}</time> to <time dateTime={data.value.through}>{data.value.through}</time></p>}
      </div>
      <form className="sales-report-dates" onSubmit={applyPeriod} aria-label="Sales reporting period">
        <label>Report start date<input type="date" name="from" min="0001-01-01" max="9999-12-31" defaultValue={period.from} required /></label>
        <label>Report end date<input type="date" name="through" min="0001-01-01" max="9999-12-31" defaultValue={period.through} required /></label>
        <button type="submit" disabled={data.loading}>Apply dates</button>
        <p className="accounts-help">Manila calendar dates. Both dates are included.</p>
      </form>
      {dateError && <p className="notice error" role="alert">{dateError}</p>}
    </section>
    <DataState state={data}>{data.value && <div className="sales-report-workspace"><div className="sales-report-columns"><SalesTrend report={data.value} onDetail={kind => setDetail({ kind, report: data.value! })} /><ProfitSummary report={data.value} onDetail={kind => setDetail({ kind, report: data.value! })} /></div><ExpenseCoverage report={data.value} today={calendar.today} onReview={() => setReview(data.value)} /></div>}</DataState>
    {detail && <ActionModal title={detailTitles[detail.kind]} onClose={() => setDetail(null)}><SalesReportDetails report={detail.report} kind={detail.kind} /><div className="accounts-modal-footer"><button type="button" onClick={() => setDetail(null)}>Done</button></div></ActionModal>}
    {review && <ActionModal title="Review operating expenses" dismissDisabled={busy} onClose={() => setReview(null)}><SalesExpenseReview {...props} report={review} today={calendar.today} busy={busy} submit={confirm} disabled={props.disabled || busy} onCancel={() => setReview(null)} /></ActionModal>}
  </>;
}

export function Devices(props: WorkspaceProps) {
  const { show: showToast } = useToast();
  const load = useCallback((session: Session) => api.devices(session), []);
  const data = useData(props, load);
  const [selected, setSelected] = useState<Device | null>(null);
  const [pairing, setPairing] = useState<DevicePairingBundle | null>(null);
  const [pairingBusy, setPairingBusy] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [accessFilter, setAccessFilter] = useState('all');
  const [codeDevice, setCodeDevice] = useState<Device | null>(null);
  const [codeRole, setCodeRole] = useState<'cashier' | 'barista'>('cashier');
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<'cashier' | 'barista'>('cashier');
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const devices = data.value?.devices ?? [];
  const device = devices.find(item => item.id === selected?.id && item.version === selected.version && !item.revoked);
  const visibleDevices = devices.filter(item => `${item.id} ${item.branchId}`.toLowerCase().includes(query.trim().toLowerCase()) && (accessFilter === 'all' || (accessFilter === 'revoked') === item.revoked));

  function randomDeviceSecret() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_!';
    const bytes = new Uint8Array(36);
    globalThis.crypto.getRandomValues(bytes);
    let value = '';
    for (let i = 0; i < bytes.length; i++) value += alphabet[bytes[i]! % alphabet.length];
    return value;
  }

  async function revoke(current: Device) {
    if (revokeBusy || props.disabled) return;
    setRevokeBusy(true);
    setRevokeError(null);
    try { if (await props.submit(`/api/v1/devices/${encodeURIComponent(current.id)}/revoke`, { expectedVersion: current.version }, 'Device access revoked.')) {
      setSelected(null);
      if (pairing?.deviceId === current.id) setPairing(null);
    } } catch (caught) { props.onError(caught, props.session); setRevokeError('Access could not be revoked. Try again.'); }
    finally { setRevokeBusy(false); }
  }

  async function generatePairCode(current: Device, role: 'cashier' | 'barista') {
    if (pairingBusy || props.disabled) return;
    setPairingBusy(current.id);
    setPairingError(null);
    setPairing(null);
    try {
      const res = await api.devicePairCode(props.session, current.id, props.session.hubOrigin, 15, role);
      setPairing(res.pairing);
      setCodeDevice(null);
      setResultOpen(true);
      showToast('Pairing code created.');
    } catch (caught) {
      props.onError(caught, props.session);
      setPairingError(caught instanceof HubError ? caught.message : 'Pairing code could not be generated.');
    } finally {
      setPairingBusy(null);
    }
  }

  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const deviceId = field(formData, 'deviceId');
    if (enrollBusy || props.disabled) return;
    if (devices.some(d => d.id === deviceId && d.revoked)) { setPairingError('This device ID was revoked. Use a new ID for this tablet.'); return; }
    const alreadyEnrolled = devices.some(d => d.id === deviceId && !d.revoked);
    let enrolled = alreadyEnrolled;
    setEnrollBusy(true);
    setPairingError(null);
    setPairing(null);
    try {
      if (!alreadyEnrolled) {
        await api.deviceEnroll(props.session, deviceId, randomDeviceSecret());
        enrolled = true;
        showToast('Device enrolled.');
      }
      const pairRes = await api.devicePairCode(props.session, deviceId, props.session.hubOrigin, 15, selectedRole);
      setPairing(pairRes.pairing);
      showToast('Pairing code created.');
      setEnrollOpen(false);
      setResultOpen(true);
      form.reset();
      data.refresh();
    } catch (caught) {
      props.onError(caught, props.session);
      setPairingError(`${enrolled ? 'Tablet is enrolled. Code creation failed; retry here or use Generate code in the list. ' : ''}${caught instanceof HubError ? caught.message : 'Device pairing code could not be generated.'}`);
      if (enrolled) data.refresh();
    } finally {
      setEnrollBusy(false);
    }
  }
  return <><Heading title="Devices" detail="Manage staff tablets." {...data} />
    <DataState state={data}>
      <section className="panel devices-list" aria-labelledby="devices-list-title">
        <div className="accounts-directory-header devices-section-heading">
          <div><h2 id="devices-list-title">Staff tablets</h2><p>Create sign-in codes and manage tablet access.</p></div>
          <button type="button" className="primary devices-primary" disabled={props.disabled || enrollBusy || !!pairingBusy} onClick={() => { setPairingError(null); setEnrollOpen(true); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Set up tablet
          </button>
        </div>
        <div className="devices-filters">
          <label htmlFor="device-search">Search tablets<input id="device-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search device ID or branch" /></label>
          <label htmlFor="device-access">Access<select id="device-access" aria-label="Filter by access" value={accessFilter} onChange={e => setAccessFilter(e.target.value)}><option value="all">All devices</option><option value="enrolled">Enrolled</option><option value="revoked">Revoked</option></select></label>
        </div>
        <div className="devices-list-meta"><p role="status">{visibleDevices.length} of {devices.length} tablets</p><p>Connection status is unavailable. Unknown does not mean disconnected.</p></div>
        {visibleDevices.length === 0 ? <div className="accounts-empty"><h3>{devices.length ? 'No matching tablets' : 'No tablets yet'}</h3><p className="quiet">{devices.length ? 'Try another device ID or change the access filter.' : 'Set up a tablet to create its first sign-in code.'}</p>{devices.length > 0 && <button type="button" onClick={() => { setQuery(''); setAccessFilter('all'); }}>Clear filters</button>}</div> : <Rows columns={['Tablet', 'Access', 'Actions', 'Status']}>
          {visibleDevices.map((item, index) => <tr key={item.id}>
            <Cell label="Tablet"><div className="devices-identity"><strong id={`device-row-${index}`}>{item.id}</strong><span className="record-id">{item.branchId}</span></div></Cell>
            <Cell label="Access"><span className={`devices-status${item.revoked ? ' is-revoked' : ''}`}>{item.revoked ? 'Revoked' : 'Enrolled'}</span></Cell>
            <Cell label="Actions">{item.revoked ? <span className="quiet">Access removed</span> : <div className="devices-row-actions">
              <button type="button" aria-describedby={`device-row-${index}`} disabled={props.disabled || !!pairingBusy || enrollBusy} onClick={() => { setCodeDevice(item); setCodeRole('cashier'); setPairingError(null); }}>Generate code</button>
              <button type="button" className="devices-revoke" aria-describedby={`device-row-${index}`} disabled={props.disabled || !!pairingBusy || enrollBusy} onClick={() => { setRevokeError(null); setSelected(item); }}>Revoke access</button>
            </div>}</Cell>
            <Cell label="Status"><span className="devices-connection-unknown">Unknown</span></Cell>
          </tr>)}
        </Rows>}
      </section>
    </DataState>
    <ActionModal title="Set up a staff tablet" open={enrollOpen} dismissDisabled={enrollBusy} onClose={() => setEnrollOpen(false)}>
      <p className="quiet devices-modal-intro">Register the tablet, then use its code on the staff sign-in screen.</p>
      <form onSubmit={e => void enroll(e)} className="devices-enroll-form">
        <fieldset disabled={props.disabled || enrollBusy} className="devices-modal-fields">
          <label htmlFor="new-device-id">Device ID<input id="new-device-id" name="deviceId" required maxLength={100} pattern={'[A-Za-z0-9][A-Za-z0-9_\\-]*'} placeholder="e.g. counter-tablet-01" autoCapitalize="none" spellCheck={false} aria-describedby="device-id-help" /></label>
          <p className="accounts-help" id="device-id-help">Use a unique ID. Start with a letter or number; use letters, numbers, hyphens or underscores.</p>
          <label htmlFor="setup-device-role">Staff role<select id="setup-device-role" aria-label="Staff role" value={selectedRole} onChange={e => setSelectedRole(e.target.value as 'cashier' | 'barista')}><option value="cashier">Cashier</option><option value="barista">Barista</option></select></label>
          <p className="accounts-help">{selectedRole === 'cashier' ? 'For taking orders and managing the cash drawer.' : 'For preparing orders and recording waste.'}</p>
        </fieldset>
        {pairingError && <p className="notice error" role="alert">{pairingError}</p>}
        <div className="accounts-modal-footer"><button type="button" disabled={enrollBusy} onClick={() => setEnrollOpen(false)}>Cancel</button><button type="submit" className="primary" disabled={props.disabled || enrollBusy}>{enrollBusy ? 'Setting up…' : 'Set up & create code'}</button></div>
      </form>
    </ActionModal>
    {codeDevice && <ActionModal title="Generate sign-in code" dismissDisabled={!!pairingBusy} onClose={() => { setCodeDevice(null); setPairingError(null); }}>
      <dl className="devices-modal-summary"><div><dt>Tablet</dt><dd>{codeDevice.id}</dd></div></dl>
      <form onSubmit={e => { e.preventDefault(); void generatePairCode(codeDevice, codeRole); }}>
        <label htmlFor="pair-device-role">Staff role<select id="pair-device-role" aria-label="Staff role" disabled={!!pairingBusy} value={codeRole} onChange={e => setCodeRole(e.target.value as 'cashier' | 'barista')}><option value="cashier">Cashier</option><option value="barista">Barista</option></select></label>
        <p className="quiet">{codeRole === 'cashier' ? 'For taking orders and managing the cash drawer.' : 'For preparing orders and recording waste.'}</p>
        <p className="accounts-help">The code lasts 15 minutes. Creating a new code replaces any unused code for this tablet. Check the assigned role on the next screen.</p>
        {pairingError && <p className="notice error" role="alert">{pairingError}</p>}
        <div className="accounts-modal-footer"><button type="button" disabled={!!pairingBusy} onClick={() => { setCodeDevice(null); setPairingError(null); }}>Cancel</button><button type="submit" className="primary" disabled={props.disabled || !!pairingBusy}>{pairingBusy ? 'Generating…' : 'Generate code'}</button></div>
      </form>
    </ActionModal>}
    {resultOpen && pairing && <ActionModal title="Tablet sign-in code" onClose={() => { setResultOpen(false); setPairing(null); }}>
      <p className="quiet">Enter this 8-character code on the tablet’s staff sign-in screen.</p>
      <div className="devices-code-display"><span>Pairing code</span><p className="devices-pairing-code">{pairing.pairingCode}</p><p>Expires {dateTime(pairing.expiresAt)}</p></div>
      <dl className="devices-modal-summary"><div><dt>Tablet</dt><dd>{pairing.deviceId}</dd></div><div><dt>Assigned role</dt><dd>{pairing.role ? pairing.role === 'cashier' ? 'Cashier' : 'Barista' : 'Not assigned'}</dd></div>{pairing.accountId && <div><dt>Account</dt><dd>{pairing.accountId}</dd></div>}</dl>
      <p className="accounts-help">Keep this code private. If the role is incorrect, close this window and check staff accounts before creating another code.</p>
      <div className="accounts-modal-footer"><button className="primary" type="button" onClick={() => { setResultOpen(false); setPairing(null); }}>Done</button></div>
    </ActionModal>}
    {device && <ActionModal title="Revoke tablet access?" onClose={() => setSelected(null)} dismissDisabled={props.disabled || revokeBusy}>
      <dl className="devices-modal-summary"><div><dt>Tablet</dt><dd>{device.id}</dd></div><div><dt>Branch</dt><dd>{device.branchId}</dd></div></dl>
      <p className="devices-revoke-warning">This signs the tablet out and removes its access. To set it up again, you will need a new device ID.</p>
      {revokeError && <p className="notice error" role="alert">{revokeError}</p>}
      <div className="accounts-modal-footer"><button type="button" disabled={props.disabled || revokeBusy} onClick={() => setSelected(null)}>Keep access</button><button type="button" className="devices-danger-solid" disabled={props.disabled || revokeBusy} onClick={() => void revoke(device)}>{revokeBusy ? 'Revoking…' : 'Revoke access'}</button></div>
    </ActionModal>}
  </>;
}

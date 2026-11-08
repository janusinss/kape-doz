import { ActionModal } from './action_modal';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, type Refund, type RefundLeg } from './api';
import { allowedRefundLegActions, REFUND_LEG_ACTIONS, type RefundLegAction } from './command_contracts';
import { Cell, DataState, Heading, Rows, dateTime, field, fixedPoint, money, useData, type SubmitCommand, type WorkspaceProps } from './workspaces';

const statusNames = { pending: 'Awaiting approval', stale: 'No longer current', denied: 'Denied', approved: 'Approved' };
const methodNames = { cash: 'Cash', gcash: 'GCash', card: 'Card' };
const legNames = { pending: 'Pending', unknown: 'Outcome unknown', failed: 'Failed', completed: 'Completed', voided: 'Voided' };
const actionHelp: Record<RefundLegAction, string> = {
  confirm_external: 'Check the payment provider’s records for the returned amount. Enter the provider’s refund reference.',
  mark_unknown: 'Record that the payout outcome could not be verified. Check the payment provider before taking further action.',
  mark_failed: 'Use this when the payment provider confirms the refund failed. The payout can then be reviewed for retry.',
  retry: 'Move this failed payout back to Pending for another attempt. Confirm the provider’s outcome before recording a refund.',
  void: 'Close this unpaid payout and release its reserved amount. Verify that no money was returned first.',
};

type Filter = Refund['status'] | 'attention' | 'all';
type Review =
  | { kind: 'summary'; refund: Refund }
  | { kind: 'approve' | 'deny'; refund: Refund }
  | { kind: 'payout'; refund: Refund; leg: RefundLeg };
type TaskProps = { submit: SubmitCommand; disabled: boolean; busy: boolean; onBack: () => void };

function needsAttention(refund: Refund) {
  return refund.status === 'pending' || (refund.status === 'approved' &&
    refund.legs.some(leg => leg.status === 'pending' || leg.status === 'unknown' || leg.status === 'failed'));
}

function payoutSummary(refund: Refund) {
  if (refund.legs.some(leg => leg.status === 'unknown')) return 'Payout outcome unknown';
  if (refund.legs.some(leg => leg.status === 'failed')) return 'Payout needs review';
  if (refund.legs.some(leg => leg.status === 'pending')) return 'Payout pending';
  if (refund.legs.every(leg => leg.status === 'completed')) return 'Fully returned';
  if (refund.legs.every(leg => leg.status === 'voided')) return 'All payouts voided';
  return 'Returned in part';
}

function Summary({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="settings-summary refund-summary">
    {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>;
}

function TaskFooter({ onBack, busy, disabled, label, danger = false }: Pick<TaskProps, 'onBack' | 'busy' | 'disabled'> & {
  label: string; danger?: boolean;
}) {
  return <div className="accounts-modal-footer">
    <button type="button" onClick={onBack} disabled={busy}>Back to refund</button>
    <button type="submit" className={danger ? 'devices-danger-solid' : 'primary'} disabled={disabled || busy}>
      {busy ? 'Saving…' : label}
    </button>
  </div>;
}

function RefundDecision({ refund, decision, ...task }: TaskProps & { refund: Refund; decision: 'approve' | 'deny' }) {
  const [error, setError] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const approving = decision === 'approve';
  const allocations = refund.tenders.map(tender => ({
    paymentId: tender.paymentId,
    amountCentavos: fixedPoint(amounts[tender.paymentId]?.trim() || '0', 2, tender.refundableCentavos),
  }));
  const allocated = allocations.reduce((sum, allocation) => sum + (allocation.amountCentavos ?? 0), 0);
  const valid = allocations.every(allocation => allocation.amountCentavos !== null) && Number.isSafeInteger(allocated);
  const remaining = refund.amountCentavos - allocated;
  const ready = valid && remaining === 0;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (task.disabled || task.busy || (approving && !ready)) return;
    const reason = field(new FormData(event.currentTarget), 'reason');
    if (!approving && !reason) { setError('Enter a reason for denying this refund.'); return; }
    await task.submit(
      `/api/v1/refunds/${encodeURIComponent(refund.id)}/decision`,
      approving ? { decision, ...(reason ? { reason } : {}), allocations: allocations.filter(row => (row.amountCentavos ?? 0) > 0) } : { decision, reason },
      approving ? 'Refund approved. Review each payout separately.' : 'Refund request denied.',
    );
  }
  return <form onSubmit={e => void save(e)} onChange={() => setError('')}>
    <p className="quiet">{approving ? 'Split the requested amount across the original payments. Approval reserves the money for separate payouts.' : 'Record why this request should be denied. No payout will be created.'}</p>
    <Summary rows={[[ 'Requested refund', money(refund.amountCentavos) ]]} />
    {!approving && <div className="approval-reason"><h3>Cashier’s reason</h3><p>{refund.reason}</p></div>}
    <fieldset className="settings-fields" disabled={task.disabled || task.busy}>
      <legend>{approving ? 'Refund amounts by payment' : 'Denial reason'}</legend>
      {approving && <>
        {refund.tenders.map((tender, index) => {
          const invalid = allocations[index]?.amountCentavos === null;
          const label = `${methodNames[tender.method]} payment ${index + 1}`;
          return <div key={tender.paymentId} className="refund-payment">
            <div><strong>{label}</strong><p className="quiet">{money(tender.refundableCentavos)} available of {money(tender.amountCentavos)}</p>
              {tender.reference && <small className="record-id">Original reference {tender.reference}</small>}
              <small className="record-id">Payment ID {tender.paymentId}</small>
            </div>
            <label>Refund from {label} (PHP)<input name={`amount-${tender.paymentId}`} inputMode="decimal" placeholder="0.00"
              value={amounts[tender.paymentId] ?? ''} aria-invalid={invalid || undefined} disabled={tender.refundableCentavos === 0}
              onChange={e => setAmounts(current => ({ ...current, [tender.paymentId]: e.target.value }))} />
              {invalid && <span className="negative">Enter an amount within the available balance.</span>}
            </label>
          </div>;
        })}
        <div className="refund-allocation-total" role="status">
          <strong>{valid ? `${money(allocated)} allocated` : 'Check the payment amounts'}</strong>
          {valid && <span>{remaining < 0 ? `${money(-remaining)} over the requested refund` : remaining > 0 ? `${money(remaining)} left to allocate` : 'Matches the requested refund'}</span>}
        </div>
      </>}
      <label>{approving ? 'Approval note (optional)' : 'Reason for denial'}<textarea name="reason" rows={3} maxLength={300} required={!approving} /></label>
    </fieldset>
    {error && <p className="notice error" role="alert">{error}</p>}
    <TaskFooter {...task} disabled={task.disabled || (approving && !ready)} label={approving ? 'Approve refund' : 'Deny refund'} danger={!approving} />
  </form>;
}

function PayoutReview({ leg, refund, ...task }: TaskProps & { leg: RefundLeg; refund: Refund }) {
  const actions = allowedRefundLegActions(leg);
  const originalReference = refund.tenders.find(tender => tender.paymentId === leg.paymentId)?.reference;
  const [action, setAction] = useState<RefundLegAction | ''>('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (task.disabled || task.busy || !action || !actions.includes(action)) return;
    const data = new FormData(event.currentTarget);
    const note = field(data, 'note');
    const reference = field(data, 'reference');
    if (!note) { setError('Enter a note about the payout outcome.'); return; }
    if (action === 'confirm_external' && !reference) { setError('Enter the verified refund reference.'); return; }
    if (action === 'void' && !confirmed) return;
    await task.submit(`/api/v1/refunds/${encodeURIComponent(refund.id)}/legs/${encodeURIComponent(leg.id)}`,
      { expectedVersion: leg.version, action, note, ...(action === 'confirm_external' ? { reference } : {}) },
      action === 'confirm_external' ? 'Verified external refund recorded.' : 'Refund payout status saved.');
  }
  return <form onSubmit={e => void save(e)} onChange={() => setError('')}>
    <Summary rows={[
      ['Payment method', methodNames[leg.method]], ['Payout amount', money(leg.amountCentavos)],
      ['Current status', legNames[leg.status]], ['Original payment ID', leg.paymentId],
      ...(originalReference ? [['Original payment reference', originalReference] as [string, string]] : []),
      ...(leg.note ? [['Previous note', leg.note] as [string, string]] : []),
    ]} />
    {leg.method === 'cash' && <p className="quiet">Cash returned is recorded by the cashier from an open drawer.</p>}
    <fieldset className="settings-fields" disabled={task.disabled || task.busy}>
      <legend>Payout outcome</legend>
      <label>Action<select aria-label="Payout action" value={action} required onChange={e => { setAction(e.target.value as typeof action); setConfirmed(false); }}>
        <option value="" disabled>Choose an action</option>
        {actions.map(value => <option key={value} value={value}>{REFUND_LEG_ACTIONS[value].label}</option>)}
      </select></label>
      {action && <>
        <p className="quiet">{actionHelp[action]}</p>
        {action === 'confirm_external' && <label>Verified refund reference<input name="reference" maxLength={120} required /></label>}
        <label>Payout review note<textarea name="note" rows={3} maxLength={300} required /></label>
        {action === 'void' && <label className="settings-restore-check">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required />
          I verified that no money was returned for this payout.
        </label>}
      </>}
    </fieldset>
    {error && <p className="notice error" role="alert">{error}</p>}
    <TaskFooter {...task} disabled={task.disabled || !action || (action === 'void' && !confirmed)} label="Save payout review" danger={action === 'void'} />
  </form>;
}

function RefundOverview({ refund, disabled, isRequester, onClose, onReview }: {
  refund: Refund; disabled: boolean; isRequester: boolean; onClose: () => void; onReview: (review: Review) => void;
}) {
  const completed = refund.legs.filter(leg => leg.status === 'completed').reduce((total, leg) => total + leg.amountCentavos, 0);
  return <>
    <div className="refund-overview-heading">
      <div><p className="quiet">Requested refund</p><strong className="refund-total">{money(refund.amountCentavos)}</strong></div>
      <span className="refund-status">{statusNames[refund.status]}</span>
    </div>
    <Summary rows={[
      ['Requested by', refund.requesterName], ['Requested at', dateTime(refund.requestedAt)],
      ...(refund.status === 'approved' ? [['Confirmed returned', money(completed)], ['Payout status', payoutSummary(refund)]] as [string, string][] : []),
      ...(refund.decidedAt !== null ? [['Decision recorded', dateTime(refund.decidedAt)] as [string, string]] : []),
    ]} />
    <div className="approval-reason"><h3>Cashier’s reason</h3><p>{refund.reason}</p></div>
    {refund.decisionReason && <div className="approval-reason"><h3>Decision note</h3><p>{refund.decisionReason}</p></div>}
    <h3>Requested items</h3>
    <ul className="recipe-contents refund-items">{refund.lines.map(line => <li key={line.lineNo}>
      <strong>{line.quantity} × {line.name}</strong><span>{money(line.unitPriceCentavos)} each</span>
    </li>)}</ul>
    <details className="stock-record-details"><summary>Request reference</summary>
      <p className="record-id">Refund {refund.id} · Order version {refund.orderVersion} · Requested by {refund.requesterId}</p>
    </details>
    {refund.status === 'stale' && <p className="notice">The order changed or a newer request replaced this one. Review the current order or request before proceeding.</p>}
    {refund.status === 'approved' && <section className="refund-payouts" aria-label="Refund payouts">
      <h3>Payouts</h3><p className="quiet">Each original payment has its own payout outcome.</p>
      <ul className="list">{refund.legs.map(leg => {
        const actions = allowedRefundLegActions(leg);
        return <li key={leg.id}>
          <div className="refund-payout-row">
            <div><strong>{methodNames[leg.method]} · {money(leg.amountCentavos)}</strong><p className={`refund-status status-${leg.status}`}>{legNames[leg.status]}</p></div>
            {actions.length > 0 && <button type="button" disabled={disabled}
              aria-label={`Review ${methodNames[leg.method]} payout ${leg.id}`} onClick={() => onReview({ kind: 'payout', refund, leg })}>Review payout</button>}
          </div>
          {leg.method === 'cash' && leg.status === 'pending' && <p className="quiet">Waiting for the cashier to record the cash return.</p>}
          <details className="stock-record-details"><summary>Payout details</summary>
            <Summary rows={[
              ['Payout ID', leg.id], ['Original payment ID', leg.paymentId],
              ...(leg.reference ? [['Refund reference', leg.reference] as [string, string]] : []),
              ...(leg.completedAt !== null ? [['Completed at', dateTime(leg.completedAt)] as [string, string]] : []),
              ...(leg.note ? [['Recorded note', leg.note] as [string, string]] : []),
            ]} />
          </details>
        </li>;
      })}</ul>
    </section>}
    {refund.status === 'pending' && isRequester && <p className="settings-note">Another admin must review a refund you requested.</p>}
    <div className="accounts-modal-footer refund-actions">
      <button type="button" onClick={onClose}>{refund.status === 'pending' ? 'Close' : 'Done'}</button>
      {refund.status === 'pending' && !isRequester && <>
        <button type="button" disabled={disabled} onClick={() => onReview({ kind: 'deny', refund })}>Deny request</button>
        <button type="button" className="primary" disabled={disabled} onClick={() => onReview({ kind: 'approve', refund })}>Review allocation</button>
      </>}
    </div>
  </>;
}

export function Refunds(props: WorkspaceProps) {
  const data = useData(props, api.refunds);
  const [filter, setFilter] = useState<Filter>('attention');
  const [search, setSearch] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const modalContent = useRef<HTMLDivElement>(null);
  const reviewKind = review?.kind;
  useEffect(() => {
    const dialog = modalContent.current?.closest('dialog');
    if (!dialog) return;
    dialog.scrollTop = 0;
    dialog.querySelector<HTMLButtonElement>('.action-modal-close')?.focus({ preventScroll: true });
  }, [reviewKind]);
  const refunds = data.value?.refunds ?? [];
  const query = search.trim().toLowerCase().replace(/^#/, '');
  const visible = refunds.filter(refund =>
    (filter === 'all' || (filter === 'attention' ? needsAttention(refund) : refund.status === filter)) &&
    (!query || String(refund.orderNo).includes(query) || refund.requesterName.toLowerCase().includes(query) || refund.id.toLowerCase().includes(query)),
  );
  const disabled = props.disabled || data.loading || !!data.error;
  const latest = review && refunds.find(refund => refund.id === review.refund.id);
  const changed = !!(review && data.value && (
    !latest || latest.status !== review.refund.status ||
    (review.kind === 'payout' && !latest.legs.some(leg => leg.id === review.leg.id && leg.version === review.leg.version)) ||
    (review.kind === 'approve' && review.refund.tenders.some(tender => !latest.tenders.some(item =>
      item.paymentId === tender.paymentId && item.refundableCentavos === tender.refundableCentavos)))
  ));
  const submit: SubmitCommand = async (path, payload, success) => {
    setBusy(true);
    try {
      const ok = await props.submit(path, payload, success);
      if (ok) setReview(null);
      return ok;
    } finally { setBusy(false); }
  };
  const close = () => setReview(null);
  const back = () => { if (review) setReview({ kind: 'summary', refund: review.refund }); };
  const task = { submit, disabled: disabled || changed, busy, onBack: back };
  const titles = { summary: 'Review refund', approve: 'Allocate refund', deny: 'Deny refund', payout: 'Review payout' };

  return <>
    <Heading title="Refunds" detail="Review refund requests and payouts." {...data} />
    <section className="panel refund-directory" aria-labelledby="refund-requests-heading">
      <div className="accounts-directory-header">
        <div><h2 id="refund-requests-heading">Refund requests</h2><p className="quiet">Review requests and track money returned by payment method.</p></div>
        {data.value && <span className="refund-status">{refunds.filter(needsAttention).length} need attention</span>}
      </div>
      <div className="refund-filters">
        <label>Search refunds<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Order number, requester or refund ID" /></label>
        <label>Refund status<select aria-label="Refund status" value={filter} onChange={e => setFilter(e.target.value as Filter)}>
          <option value="attention">Needs attention</option><option value="pending">Awaiting approval</option><option value="approved">Approved</option>
          <option value="denied">Denied</option><option value="stale">No longer current</option><option value="all">All statuses</option>
        </select></label>
      </div>
      <DataState state={data}>{data.value && <>
        <p className="refund-results quiet" role="status">{visible.length} of {refunds.length} requests</p>
        {!visible.length ? <div className="accounts-empty">
          <h3>{refunds.length ? 'No matching refunds' : 'No refund requests yet'}</h3>
          <p className="quiet">{refunds.length ? 'Try another search or view all statuses.' : 'Refund requests from the cashier will appear here.'}</p>
          {!!refunds.length && <button type="button" onClick={() => { setSearch(''); setFilter('all'); }}>View all refunds</button>}
        </div> : <Rows columns={['Order', 'Requested refund', 'Status', 'Review']}>
          {visible.map(refund => <tr key={refund.id}>
            <Cell label="Order"><div><strong>#{refund.orderNo}</strong><span className="record-id">{refund.requesterName} · {dateTime(refund.requestedAt)}</span></div></Cell>
            <Cell label="Requested refund"><strong>{money(refund.amountCentavos)}</strong></Cell>
            <Cell label="Status"><div><span className="refund-status">{statusNames[refund.status]}</span>
              {refund.status === 'approved' && <span className="record-id">{payoutSummary(refund)}</span>}
            </div></Cell>
            <Cell label="Review"><button type="button" aria-label={`Review refund ${refund.id} for order ${refund.orderNo}`} onClick={() => setReview({ kind: 'summary', refund })}>Review</button></Cell>
          </tr>)}
        </Rows>}
      </>}</DataState>
    </section>
    {review && <ActionModal title={`${titles[review.kind]} for order #${review.refund.orderNo}`} dismissDisabled={busy} onClose={close}>
      <div className="refund-modal" ref={modalContent}>
        {changed && <p className="notice" role="status">This refund changed. Close and reopen it to review the latest details.</p>}
        {review.kind === 'summary' && <RefundOverview refund={review.refund} disabled={disabled || changed} isRequester={review.refund.requesterId === props.session.actor.id} onClose={close} onReview={setReview} />}
        {(review.kind === 'approve' || review.kind === 'deny') && <RefundDecision key={review.kind} {...task} refund={review.refund} decision={review.kind} />}
        {review.kind === 'payout' && <PayoutReview {...task} leg={review.leg} refund={review.refund} />}
      </div>
    </ActionModal>}
  </>;
}


import { useCallback, useState, type FormEvent } from 'react';
import {
  api,
  type AccountRecord,
  type BranchConfigResponse,
  type CloudSyncStatus,
  type CsvImportRun,
  type CsvPreviewReport,
  type PrintJobRecord,
  type PrinterAdapterRecord,
  type Session,
} from './api';
import { ActionModal } from './action_modal';
import { useToast } from './toast';
import { Cell, DataState, Heading, Rows, dateTime, field, useData, type SubmitCommand, type WorkspaceProps } from './workspaces';

type SetupDashboard = {
  configData: BranchConfigResponse;
  adapters: PrinterAdapterRecord[];
  printJobs: PrintJobRecord[];
  csvImports: CsvImportRun[];
  syncStatus: CloudSyncStatus;
};

const printerModeLabels: Record<PrinterAdapterRecord['mode'], string> = {
  unconfigured: 'Unconfigured',
  confirmed: 'Confirmed (simulated)',
  pending: 'Pending',
  failed: 'Failed',
  unknown: 'Timeout (unknown)',
};

function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BranchConfigSection({ configData, isOwner, submit, disabled }: {
  configData: BranchConfigResponse; isOwner: boolean; submit: SubmitCommand; disabled: boolean;
}) {
  const { config } = configData;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      if (await submit('/api/v1/settings/config', {
        expectedVersion: config.version,
        receiptHeader: field(data, 'receiptHeader'), receiptFooter: field(data, 'receiptFooter'),
        taxDisplayNote: field(data, 'taxDisplayNote'), stationVisibleCards: Number(field(data, 'stationVisibleCards')),
        offlineAccessExpiryMinutes: Number(field(data, 'offlineAccessExpiryMinutes')),
      }, 'Branch settings saved.')) { setDraft({}); setEditing(false); }
    } finally { setBusy(false); }
  }
  return <section className="panel setup-card" aria-labelledby="branch-config-heading">
    <div className="settings-section-header"><h2 id="branch-config-heading">Branch settings</h2>{isOwner && <button type="button" disabled={disabled} onClick={() => setEditing(true)}>Edit settings</button>}</div>
    <p className="quiet">Receipt text and staff workspace preferences.</p>
    <dl className="settings-summary"><div><dt>Receipt heading</dt><dd>{config.receiptHeader}</dd></div><div><dt>Visible order cards</dt><dd>{config.stationVisibleCards}</dd></div><div><dt>Offline access limit</dt><dd>{config.offlineAccessExpiryMinutes} minutes</dd></div></dl>
    {!isOwner && <p className="settings-note">Only an owner can change these settings.</p>}
    {isOwner && editing && <ActionModal title="Edit branch settings" dismissDisabled={busy || disabled} onClose={() => setEditing(false)}>
      <p className="settings-modal-intro quiet">Update receipt wording and staff workspace limits.</p>
      <form onSubmit={e => void save(e)} onChange={e => setDraft(Object.fromEntries(new FormData(e.currentTarget) as Iterable<[string, string]>))}>
        <fieldset disabled={disabled || busy} className="settings-fields"><legend>Receipt text</legend>
          <label>Receipt header<input name="receiptHeader" defaultValue={draft.receiptHeader ?? config.receiptHeader} required maxLength={120} /></label>
          <label>Receipt footer<input name="receiptFooter" defaultValue={draft.receiptFooter ?? config.receiptFooter} required maxLength={200} /></label>
          <label>Tax display note<input name="taxDisplayNote" defaultValue={draft.taxDisplayNote ?? config.taxDisplayNote} required maxLength={200} /></label>
          <p className="accounts-help">This changes the printed note, not tax calculations.</p>
        </fieldset>
        <fieldset disabled={disabled || busy} className="settings-fields settings-fields-divider"><legend>Staff workspace</legend><div className="settings-form-grid">
          <label>Visible order cards<input name="stationVisibleCards" type="number" min={1} max={24} step={1} defaultValue={draft.stationVisibleCards ?? config.stationVisibleCards} required /><span className="accounts-help">Show 1–24 cards at the station.</span></label>
          <label>Offline access limit (minutes)<input name="offlineAccessExpiryMinutes" type="number" min={5} max={10080} step={1} defaultValue={draft.offlineAccessExpiryMinutes ?? config.offlineAccessExpiryMinutes} required /><span className="accounts-help">Allowed range: 5–10,080 minutes.</span></label>
        </div></fieldset>
        <div className="accounts-modal-footer"><button type="button" disabled={busy || disabled} onClick={() => setEditing(false)}>Cancel</button><button type="submit" className="primary" disabled={disabled || busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
      </form>
    </ActionModal>}
  </section>;
}

function PrinterSection({ adapters, printJobs, submit, disabled }: {
  adapters: PrinterAdapterRecord[]; printJobs: PrintJobRecord[]; submit: SubmitCommand; disabled: boolean;
}) {
  const [view, setView] = useState<'mode' | 'jobs' | null>(null);
  const [printer, setPrinter] = useState<PrinterAdapterRecord | null>(null);
  const [mode, setMode] = useState<PrinterAdapterRecord['mode']>('unconfigured');
  const [retry, setRetry] = useState<PrintJobRecord | null>(null);
  const [busy, setBusy] = useState(false);
  async function changeMode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!printer || busy || disabled) return;
    setBusy(true);
    try { if (await submit('/api/v1/printers/mode', { type: printer.type, mode }, 'Printer mode updated.')) setView(null); }
    finally { setBusy(false); }
  }
  async function retryJob() {
    if (!retry || busy || disabled) return;
    setBusy(true);
    try { if (await submit(`/api/v1/print-jobs/${encodeURIComponent(retry.id)}/retry`, { action: 'retry', note: 'Operator retry from settings' }, 'Print job retried.')) setRetry(null); }
    finally { setBusy(false); }
  }
  return <section className="panel setup-card" aria-labelledby="printers-heading">
    <div className="settings-section-header"><h2 id="printers-heading">Printers</h2><button type="button" disabled={disabled} onClick={() => { setRetry(null); setView('jobs'); }}>View print jobs</button></div>
    <p className="quiet">Software simulation only. These modes do not confirm physical printing.</p>
    <div className="settings-printer-list">{adapters.map(item => <div key={item.type}><div><h3>{item.type === 'receipt' ? 'Receipt printer' : 'Cup label printer'}</h3><p className="quiet">{printerModeLabels[item.mode]}</p>{item.failureReason && <p className="negative">{item.failureReason}</p>}</div><button type="button" aria-label={`Change ${item.type} printer mode`} disabled={disabled} onClick={() => { setPrinter(item); setMode(item.mode); setView('mode'); }}>Change mode</button></div>)}</div>
    {view && <ActionModal title={view === 'mode' ? 'Change printer mode' : retry ? 'Retry print job?' : 'Recent print jobs'} dismissDisabled={busy || disabled} onClose={() => { setView(null); setRetry(null); }}>
      {view === 'mode' && printer ? <form onSubmit={e => void changeMode(e)}>
        <p className="quiet">Choose how the {printer.type === 'receipt' ? 'receipt' : 'cup label'} printer behaves in the software simulation.</p>
        <label>Simulated mode<select aria-label="Simulated mode" disabled={busy || disabled} value={mode} onChange={e => setMode(e.target.value as PrinterAdapterRecord['mode'])}>{(['unconfigured', 'confirmed', 'pending', 'failed', 'unknown'] as const).map(value => <option key={value} value={value}>{printerModeLabels[value]}</option>)}</select></label>
        <p className="accounts-help">Confirmed means the software simulation reports success. It does not verify paper output.</p>
        <div className="accounts-modal-footer"><button type="button" disabled={busy || disabled} onClick={() => setView(null)}>Cancel</button><button type="submit" className="primary" disabled={busy || disabled || mode === printer.mode}>{busy ? 'Saving…' : 'Save mode'}</button></div>
      </form> : retry ? <>
        <dl className="settings-summary"><div><dt>Order</dt><dd>#{retry.orderNo}</dd></div><div><dt>Print type</dt><dd>{retry.type === 'receipt' ? 'Receipt' : 'Cup label'}</dd></div><div><dt>Job ID</dt><dd>{retry.id}</dd></div><div><dt>Current status</dt><dd>{retry.status}</dd></div></dl>
        <p className="quiet">Check whether the original job printed before retrying to avoid duplicate paper output.</p>
        <div className="accounts-modal-footer"><button type="button" disabled={busy || disabled} onClick={() => setRetry(null)}>Back to jobs</button><button type="button" className="primary" disabled={busy || disabled} onClick={() => void retryJob()}>{busy ? 'Retrying…' : 'Retry print'}</button></div>
      </> : <>
        <p className="quiet settings-modal-intro">The 15 most recent jobs. Status reflects the software adapter.</p>
        {!printJobs.length ? <p className="empty">No print jobs yet.</p> : <Rows columns={['Order / job', 'Type', 'Status', 'Action']}>{printJobs.slice(0,15).map(job => <tr key={job.id}><Cell label="Order / job"><strong>#{job.orderNo}</strong><span className="record-id">{job.id}</span></Cell><Cell label="Type">{job.type === 'receipt' ? 'Receipt' : 'Label'}</Cell><Cell label="Status">{job.status}<span className="record-id">{job.attempts} attempts{job.lastError ? ` · ${job.lastError}` : ''}</span></Cell><Cell label="Action"><button type="button" disabled={disabled} onClick={() => setRetry(job)}>Review retry</button></Cell></tr>)}</Rows>}
        <div className="accounts-modal-footer"><button type="button" onClick={() => setView(null)}>Done</button></div>
      </>}
    </ActionModal>}
  </section>;
}

function CsvSection({ session, imports, submit, disabled, onError }: {
  session: Session; imports: CsvImportRun[]; submit: SubmitCommand; disabled: boolean; onError: WorkspaceProps['onError'];
}) {
  const [view, setView] = useState<'import' | 'export' | null>(null);
  const [kind, setKind] = useState<'catalog' | 'customers'>('catalog');
  const [exportKind, setExportKind] = useState<'catalog' | 'customers' | 'financial'>('catalog');
  const [duplicatePolicy, setDuplicatePolicy] = useState<'skip' | 'update'>('update');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<CsvPreviewReport | null>(null);
  const [exportedText, setExportedText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function report(err: unknown) { onError(err, session); setError(err instanceof Error ? err.message : 'The CSV action failed. Try again.'); }
  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || disabled) return;
    setBusy(true); setError(''); setPreview(null);
    try { setPreview((await api.csvPreview(session, { kind, csvText, duplicatePolicy })).preview); }
    catch (err) { report(err); } finally { setBusy(false); }
  }
  async function executeImport() {
    if (!preview?.valid || busy || disabled) return;
    setBusy(true); setError('');
    try { if (await submit('/api/v1/csv/import', { kind, csvText, duplicatePolicy }, 'CSV imported.')) { setPreview(null); setView(null); setCsvText(''); } }
    finally { setBusy(false); }
  }
  async function exportCsv() {
    if (busy || disabled) return;
    setBusy(true); setError(''); setExportedText('');
    try { setExportedText((await api.csvExport(session, exportKind)).csvText); }
    catch (err) { report(err); } finally { setBusy(false); }
  }
  return <section className="panel setup-card" aria-labelledby="csv-heading">
    <h2 id="csv-heading">Import & export</h2><p className="quiet">Move catalog and customer data using Loyverse CSV files.</p>
    <div className="settings-actions"><button type="button" className="primary" disabled={disabled} onClick={() => { setError(''); setView('import'); }}>Import CSV</button><button type="button" disabled={disabled} onClick={() => { setError(''); setExportedText(''); setView('export'); }}>Export CSV</button></div>
    <p className="settings-note">{imports.length ? `Last import: ${imports[0]!.kind === 'catalog' ? 'Catalog' : 'Customers'} · ${dateTime(imports[0]!.importedAt)}` : 'No imports yet. Preview your file before making changes.'}</p>
    {view && <ActionModal title={view === 'import' ? 'Import CSV' : 'Export CSV'} dismissDisabled={busy || disabled} onClose={() => setView(null)}>
      <p className="quiet settings-modal-intro">{view === 'import' ? 'Choose the data type, add your CSV, then review the preview.' : 'Choose a dataset to prepare a CSV download.'}</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      {view === 'import' ? <form onSubmit={e => void handlePreview(e)}>
        <fieldset disabled={busy || disabled} className="settings-fields"><div className="settings-form-grid">
          <label>Data to import<select aria-label="Data to import" value={kind} onChange={e => { setKind(e.target.value as 'catalog' | 'customers'); setPreview(null); }}><option value="catalog">Catalog & recipes</option><option value="customers">Customers</option></select></label>
          <label>If a record already exists<select aria-label="If a record already exists" value={duplicatePolicy} onChange={e => { setDuplicatePolicy(e.target.value as 'skip' | 'update'); setPreview(null); }}><option value="update">Update it</option><option value="skip">Skip it</option></select></label>
        </div>
          <label>Choose CSV file<input type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; if (!file) return; setCsvText(''); setPreview(null); setError(''); if (file.size > 96000) { setError('Use a CSV file with 24,000 characters or fewer.'); return; } setBusy(true); void file.text().then(text => { if (text.length > 24000) { setError('Use a CSV file with 24,000 characters or fewer.'); return; } setCsvText(text); }).catch(report).finally(() => setBusy(false)); }} /></label>
          <label>CSV content<textarea aria-label="CSV content" rows={6} value={csvText} maxLength={24000} onChange={e => { setCsvText(e.target.value); setPreview(null); }} placeholder="Choose a file above or paste CSV content here" required /></label>
          <p className="accounts-help">Up to 24,000 characters. Updating existing records can replace their imported fields.</p>
        </fieldset>
        {preview && <div className="settings-preview" role="status"><h3>{preview.valid ? 'Ready to import' : 'Fix the CSV before importing'}</h3><p>{preview.summary.addedCount} to add · {preview.summary.updatedCount} to update · {preview.summary.skippedCount} skipped · {preview.summary.errorCount} errors</p>{preview.errors.length > 0 && <ul>{preview.errors.slice(0,5).map(err => <li key={`${err.rowNumber}-${err.identifier}`}>Row {err.rowNumber}: {err.message}</li>)}</ul>}</div>}
        <div className="accounts-modal-footer"><button type="button" disabled={busy || disabled} onClick={() => setView(null)}>Cancel</button><button type="submit" className={preview?.valid ? '' : 'primary'} disabled={busy || disabled || !csvText.trim()}>{busy ? 'Working…' : 'Preview import'}</button>{preview?.valid && <button type="button" className="primary" disabled={busy || disabled} onClick={() => void executeImport()}>Import records</button>}</div>
      </form> : <form onSubmit={e => { e.preventDefault(); void exportCsv(); }}>
        <label>Data to export<select aria-label="Data to export" disabled={busy || disabled} value={exportKind} onChange={e => { setExportKind(e.target.value as typeof exportKind); setExportedText(''); }}><option value="catalog">Catalog & recipes</option><option value="customers">Customers</option><option value="financial">Financial records</option></select></label>
        {exportedText && <label>CSV preview<textarea aria-label="CSV preview" rows={7} readOnly value={exportedText} /></label>}
        <div className="accounts-modal-footer"><button type="button" disabled={busy || disabled} onClick={() => setView(null)}>Close</button>{exportedText ? <button type="button" className="primary" onClick={() => downloadText(exportedText, `kape-doz-${exportKind}.csv`, 'text/csv;charset=utf-8')}>Download CSV</button> : <button type="submit" className="primary" disabled={busy || disabled}>{busy ? 'Preparing…' : 'Prepare CSV'}</button>}</div>
      </form>}
    </ActionModal>}
  </section>;
}

function CloudSyncSection({ syncStatus, submit, disabled }: {
  syncStatus: CloudSyncStatus; submit: SubmitCommand; disabled: boolean;
}) {
  const [view, setView] = useState<'mode' | 'sync' | 'conflicts' | null>(null);
  const [mode, setMode] = useState(syncStatus.mode);
  const [conflict, setConflict] = useState<CloudSyncStatus['conflicts'][number] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const openConflicts = syncStatus.conflicts.filter(item => item.status === 'open');
  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || disabled) return;
    setBusy(true);
    try {
      const ok = view === 'mode' ? await submit('/api/v1/sync/mode', { mode }, 'Sync mode updated.')
        : view === 'sync' ? await submit('/api/v1/sync/push', {}, 'Local sync queue processed.')
        : conflict ? await submit(`/api/v1/sync/conflicts/${encodeURIComponent(conflict.id)}/resolve`, { resolutionNote: note.trim() }, 'Conflict marked resolved.') : false;
      if (ok) { setView(null); setConflict(null); setNote(''); }
    } finally { setBusy(false); }
  }
  return <section className="panel setup-card" aria-labelledby="cloud-sync-heading">
    <div className="settings-section-header"><h2 id="cloud-sync-heading">Cloud sync</h2><button type="button" disabled={disabled} onClick={() => { setMode(syncStatus.mode); setView('mode'); }}>Change mode</button></div>
    <p className="quiet">Local sync simulation. Processing the queue does not upload data to a cloud service.</p>
    <dl className="settings-summary"><div><dt>Mode</dt><dd className="settings-capitalize">{syncStatus.mode}</dd></div><div><dt>Waiting to sync</dt><dd>{syncStatus.pendingOutboxCount} records</dd></div><div><dt>Last processed</dt><dd>{syncStatus.lastSyncedAt ? dateTime(syncStatus.lastSyncedAt) : 'Not yet processed'}</dd></div></dl>
    <div className="settings-actions"><button type="button" className="primary" disabled={disabled || syncStatus.mode === 'offline'} onClick={() => setView('sync')}>Process queue</button><button type="button" disabled={disabled} onClick={() => { setConflict(null); setView('conflicts'); }}>View conflicts ({syncStatus.openConflictCount})</button></div>
    {view && <ActionModal title={view === 'mode' ? 'Change sync mode' : view === 'sync' ? 'Process sync queue?' : conflict ? 'Review sync conflict' : 'Sync conflicts'} dismissDisabled={busy || disabled} onClose={() => { setView(null); setConflict(null); }}>
      {view === 'conflicts' && !conflict ? <>
        <p className="quiet settings-modal-intro">Review differences before marking a conflict resolved. Records are not merged automatically.</p>
        {!openConflicts.length ? <p className="empty">No open conflicts.</p> : <ul className="settings-conflicts">{openConflicts.map(item => <li key={item.id}><div><strong>{item.entityType}: {item.entityId}</strong><p className="quiet">{item.reason}</p></div><button type="button" onClick={() => { setConflict(item); setNote(''); }}>Review conflict</button></li>)}</ul>}
        <div className="accounts-modal-footer"><button type="button" onClick={() => setView(null)}>Done</button></div>
      </> : <form onSubmit={e => void run(e)}>
        <fieldset disabled={busy || disabled} className="settings-fields">
          {view === 'mode' ? <><label>Sync mode<select aria-label="Sync mode" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="online">Online</option><option value="offline">Offline</option></select></label><p className="quiet">Online allows local queue processing. Offline keeps records waiting in the queue.</p></>
          : view === 'sync' ? <><p><strong>{syncStatus.pendingOutboxCount} pending records</strong> will be marked acknowledged in this local simulation.</p><p className="quiet">This does not confirm a remote cloud backup or upload.</p></>
          : conflict && <><dl className="settings-summary"><div><dt>Record</dt><dd>{conflict.entityType}: {conflict.entityId}</dd></div><div><dt>Versions</dt><dd>Local {conflict.localVersion} · Incoming {conflict.incomingVersion}</dd></div><div><dt>Reason</dt><dd>{conflict.reason}</dd></div></dl><p className="quiet">Marking this resolved records your decision. It does not replace or merge either version.</p><label>Resolution note<textarea aria-label="Resolution note" rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={300} required placeholder="Describe how you handled this difference" /></label></>}
        </fieldset>
        <div className="accounts-modal-footer"><button type="button" disabled={busy || disabled} onClick={() => { if (conflict) setConflict(null); else setView(null); }}>{conflict ? 'Back to conflicts' : 'Cancel'}</button><button type="submit" className="primary" disabled={busy || disabled || (view === 'mode' && mode === syncStatus.mode) || (view === 'conflicts' && !note.trim())}>{busy ? 'Working…' : view === 'mode' ? 'Save mode' : view === 'sync' ? 'Process queue' : 'Mark resolved'}</button></div>
      </form>}
    </ActionModal>}
  </section>;
}

function BackupRestoreSection({ session, isOwner, disabled, onError, onRestored }: {
  session: Session; isOwner: boolean; disabled: boolean; onError: WorkspaceProps['onError']; onRestored: () => void;
}) {
  const { show: showToast } = useToast();
  const [view, setView] = useState<'export' | 'restore' | null>(null);
  const [backupJson, setBackupJson] = useState('');
  const [exportedJson, setExportedJson] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!isOwner) return null;
  function report(err: unknown) { onError(err, session); setError(err instanceof Error ? err.message : 'The backup action failed. Try again.'); }
  async function exportBackup() {
    if (busy || disabled) return;
    setBusy(true); setError('');
    try { setExportedJson(JSON.stringify((await api.backupExport(session)).backup, null, 2)); }
    catch (err) { report(err); } finally { setBusy(false); }
  }
  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || disabled || !confirmed) return;
    setError('');
    let parsed: Record<string, unknown>;
    try { const value: unknown = JSON.parse(backupJson); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); parsed = value as Record<string, unknown>; }
    catch { setError('Enter a valid backup JSON object or choose a backup file.'); return; }
    setBusy(true);
    try { await api.backupRestore(session, parsed); showToast('Backup restored and verified.'); setView(null); setBackupJson(''); setConfirmed(false); onRestored(); }
    catch (err) { report(err); } finally { setBusy(false); }
  }
  return <section className="panel setup-card settings-backup" aria-labelledby="backup-heading">
    <div className="settings-section-header"><div><h2 id="backup-heading">Backup & restore</h2><p className="quiet">Save branch records or restore a previous archive.</p></div><div className="settings-actions"><button type="button" className="primary" disabled={disabled} onClick={() => { setError(''); setExportedJson(''); setView('export'); }}>Create backup</button><button type="button" disabled={disabled} onClick={() => { setError(''); setConfirmed(false); setView('restore'); }}>Restore backup</button></div></div>
    <p className="settings-note">Owner only. Backups exclude passwords and device secrets; the system checks archive integrity before restoring.</p>
    {view && <ActionModal title={view === 'export' ? 'Create branch backup' : 'Restore branch backup'} dismissDisabled={busy || disabled} onClose={() => setView(null)}>
      {error && <p className="notice error" role="alert">{error}</p>}
      {view === 'export' ? <>
        <p className="quiet settings-modal-intro">Prepare a JSON archive of this branch’s records. Passwords and device secrets are excluded.</p>
        {exportedJson && <label>Backup archive preview<textarea aria-label="Backup archive preview" rows={7} readOnly value={exportedJson} /></label>}
        <div className="accounts-modal-footer"><button type="button" disabled={busy || disabled} onClick={() => setView(null)}>Close</button>{exportedJson ? <button type="button" className="primary" onClick={() => downloadText(exportedJson, `kape-doz-backup-${new Date().toISOString().slice(0,10)}.json`, 'application/json')}>Download backup</button> : <button type="button" className="primary" disabled={busy || disabled} onClick={() => void exportBackup()}>{busy ? 'Preparing…' : 'Prepare backup'}</button>}</div>
      </> : <form onSubmit={e => void restore(e)}>
        <p className="settings-restore-warning">Restoring replaces backed-up branch records. Account and device details are merged. Newly restored accounts or devices need their credentials reset.</p>
        <fieldset disabled={busy || disabled} className="settings-fields">
          <label>Choose backup file<input type="file" accept=".json,application/json" onChange={e => { const file = e.target.files?.[0]; if (!file) return; setBackupJson(''); setConfirmed(false); setError(''); if (file.size > 500000) { setError('Use a backup smaller than 500 KB.'); return; } setBusy(true); void file.text().then(setBackupJson).catch(report).finally(() => setBusy(false)); }} /></label>
          <label>Backup archive JSON<textarea aria-label="Backup archive JSON" rows={6} value={backupJson} maxLength={500000} onChange={e => { setBackupJson(e.target.value); setConfirmed(false); }} placeholder="Choose a backup file or paste its JSON here" required /></label>
          <p className="accounts-help">Use an unchanged archive from this branch. The format, version and checksum must match.</p>
          <label className="settings-restore-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required />I understand this replaces branch records.</label>
        </fieldset>
        <div className="accounts-modal-footer"><button type="button" disabled={busy || disabled} onClick={() => setView(null)}>Cancel</button><button type="submit" className="devices-danger-solid" disabled={busy || disabled || !confirmed || !backupJson.trim()}>{busy ? 'Restoring…' : 'Restore backup'}</button></div>
      </form>}
    </ActionModal>}
  </section>;
}

function AccountsSection({
  session,
  accounts,
  isOwner,
  onCreated,
  onError,
  disabled,
}: {
  session: Session;
  accounts: AccountRecord[];
  isOwner: boolean;
  onCreated: () => void;
  onError: (error: unknown, session: Session) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRole, setSelectedRole] = useState<AccountRecord['role']>('cashier');
  const [showSecret, setShowSecret] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  function captureDraft(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    setDraft(Object.fromEntries(Array.from(data, ([key, value]) => [key, key === 'secret' ? '' : String(value)])));
  }
  const [errorMessage, setErrorMessage] = useState('');
  const staffRole = selectedRole === 'cashier' || selectedRole === 'barista';
  const roleLabels = { cashier: 'Cashier', barista: 'Barista', manager: 'Manager', owner: 'Owner' };
  const visibleAccounts = accounts.filter(account =>
    `${account.displayName} ${account.id}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (roleFilter === 'all' || account.role === roleFilter) &&
    (statusFilter === 'all' || (statusFilter === 'disabled') === account.disabled));
  function closeCreate() { setCreateOpen(false); setShowSecret(false); setErrorMessage(''); }

  if (!isOwner) return null;

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const role = field(data, 'role') as AccountRecord['role'];
    const secret = String(data.get('secret') ?? '');
    if (busy || disabled) return;
    if (!field(data, 'displayName').trim()) {
      setErrorMessage('Enter a display name.');
      return;
    }
    if ((role === 'owner' || role === 'manager') && new TextEncoder().encode(secret).length > 72) {
      setErrorMessage('Password is too long. Use 72 bytes or fewer; accented letters and symbols can use extra bytes.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      await api.accountCreate(session, {
        accountId: field(data, 'accountId'),
        displayName: field(data, 'displayName'),
        role,
        secret,
      });
      form.reset();
      setDraft({});
      setCreateOpen(false);
      setShowSecret(false);
      setSelectedRole('cashier');
      onCreated();
    } catch (caught) {
      onError(caught, session);
      setErrorMessage(caught instanceof Error ? caught.message : 'Account could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel accounts-directory" aria-labelledby="accounts-heading">
      <div className="accounts-directory-header">
        <div><h2 id="accounts-heading">Staff & admin accounts</h2><p className="quiet">Find accounts and check their access.</p></div>
        <button className="primary accounts-add" type="button" disabled={disabled || busy} onClick={() => { setErrorMessage(''); setCreateOpen(true); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Add account
        </button>
      </div>
      <div className="accounts-filters">
        <label>Search accounts<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or account ID" /></label>
        <label>Role<select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="all">All roles</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Status<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
      </div>
      <p className="accounts-results quiet" role="status">{visibleAccounts.length} of {accounts.length} accounts</p>
      {createOpen && <ActionModal title="Create account" dismissDisabled={busy} onClose={closeCreate}>
      <p className="quiet accounts-modal-intro">Choose a role and set the account’s sign-in details.</p>
      {errorMessage && <p className="notice error" role="alert">{errorMessage}</p>}
      <form className="accounts-create-form" onSubmit={e => void createAccount(e)} onChange={captureDraft}>
        <fieldset disabled={disabled || busy}><legend>Account details</legend><div className="accounts-form-grid">
          <label>Display name<input name="displayName" defaultValue={draft.displayName ?? ''} placeholder="e.g. Counter team" required maxLength={120} /></label>
          <label>New account ID<input name="accountId" defaultValue={draft.accountId ?? ''} placeholder="e.g. counter-01" required maxLength={100} pattern={'[A-Za-z0-9][A-Za-z0-9_\\-]*'} autoCapitalize="none" spellCheck={false} aria-describedby="account-id-help" /><span className="accounts-help" id="account-id-help">Start with a letter or number. Use letters, numbers, hyphens or underscores.</span></label>
        </div></fieldset>
        <fieldset disabled={disabled || busy} className="accounts-access-fields"><legend>Access & sign-in</legend>
          <label>
            Role
            <select name="role" value={selectedRole} onChange={e => { setSelectedRole(e.target.value as AccountRecord['role']); setShowSecret(false); setErrorMessage(''); }} aria-describedby="account-role-help">
              {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <p className="accounts-role-help quiet" id="account-role-help">{selectedRole === 'cashier' ? 'Cashier staff account for the point of sale.' : selectedRole === 'barista' ? 'Barista staff account for preparing orders.' : selectedRole === 'manager' ? 'Manager account for admin operations.' : 'Owner account with full admin access, including account creation.'}</p>
          <label htmlFor="account-secret">{staffRole ? 'Initial PIN' : 'Initial password'}</label>
          <div className="accounts-secret"><input key={staffRole ? 'pin' : 'password'} id="account-secret" name="secret" type={showSecret ? 'text' : 'password'} required minLength={staffRole ? 4 : 6} maxLength={staffRole ? 16 : 72} pattern={staffRole ? '[A-Za-z0-9]{4,16}' : undefined} autoComplete="new-password" autoCapitalize="none" spellCheck={false} aria-describedby="account-secret-help" /><button type="button" aria-controls="account-secret" aria-pressed={showSecret} onClick={() => setShowSecret(value => !value)}>{showSecret ? 'Hide' : 'Show'}</button></div>
          <p id="account-secret-help" className="accounts-help">{staffRole ? 'Use 4–16 letters or numbers. No spaces or symbols.' : 'Use at least 6 characters, up to 72 bytes.'} Share this privately with the account holder.</p>
        </fieldset>
        <div className="accounts-modal-footer"><button type="button" disabled={busy} onClick={closeCreate}>Cancel</button><button type="submit" className="primary" disabled={disabled || busy}>{busy ? 'Creating…' : 'Create account'}</button></div>
      </form>
      </ActionModal>}
      {visibleAccounts.length ? <Rows columns={['Account', 'Role', 'Sign-in', 'Status']}>
        {visibleAccounts.map(acc => (
          <tr key={acc.id}>
            <Cell label="Account"><div className="accounts-identity"><strong>{acc.displayName}</strong><span className="record-id">{acc.id}</span></div></Cell>
            <Cell label="Role">{roleLabels[acc.role]}</Cell>
            <Cell label="Sign-in">{acc.role === 'owner' || acc.role === 'manager' ? 'Admin' : 'Staff'}</Cell>
            <Cell label="Status"><span className={`accounts-status ${acc.disabled ? 'is-disabled' : 'is-active'}`}>{acc.disabled ? 'Disabled' : 'Active'}</span></Cell>
          </tr>
        ))}
      </Rows> : <div className="accounts-empty"><h3>{accounts.length ? 'No matching accounts' : 'No accounts yet'}</h3><p className="quiet">{accounts.length ? 'Try another name or change the filters.' : 'Add an account to give someone access.'}</p>{accounts.length > 0 && <button type="button" onClick={() => { setQuery(''); setRoleFilter('all'); setStatusFilter('all'); }}>Clear filters</button>}</div>}
    </section>
  );
}

export function SetupRecovery(props: WorkspaceProps) {
  const isOwner = props.session.actor.role === 'owner';
  const load = useCallback(async (session: Session): Promise<SetupDashboard> => {
    const [configData, printers, printJobs, csvImports, syncStatus] = await Promise.all([
      api.branchConfig(session),
      api.printers(session),
      api.printJobs(session),
      api.csvImports(session),
      api.syncStatus(session),
    ]);
    return {
      configData,
      adapters: printers.adapters,
      printJobs: printJobs.jobs,
      csvImports: csvImports.imports,
      syncStatus: syncStatus.syncStatus,
    };
  }, []);
  const data = useData(props, load);

  return (
    <>
      <Heading
        title="Settings & recovery"
        detail="Configure branch settings, printer adapters, Loyverse CSV imports, cloud outbox sync, and backups."
        {...data}
      />
      <DataState state={data}>
        {data.value && (
          <div className="setup-workspace">
            <div className="settings-column">
            <BranchConfigSection configData={data.value.configData} isOwner={isOwner} submit={props.submit} disabled={props.disabled} />
            <CsvSection session={props.session} imports={data.value.csvImports} submit={props.submit} disabled={props.disabled} onError={props.onError} />
            </div>
            <div className="settings-column">
            <PrinterSection
              adapters={data.value.adapters}
              printJobs={data.value.printJobs}
              submit={props.submit}
              disabled={props.disabled}
            />
            <CloudSyncSection syncStatus={data.value.syncStatus} submit={props.submit} disabled={props.disabled} />
            </div>
            <BackupRestoreSection session={props.session} isOwner={isOwner} disabled={props.disabled} onError={props.onError} onRestored={data.refresh} />
          </div>
        )}
      </DataState>
    </>
  );
}

export function Accounts(props: WorkspaceProps) {
  const { show: showToast } = useToast();
  const data = useData(props, api.accounts);
  return <>
    <Heading title="Accounts" detail="Manage staff and admin accounts." {...data} />
    <DataState state={data}>{data.value && <AccountsSection
      session={props.session}
      accounts={data.value.accounts}
      isOwner={props.session.actor.role === 'owner'}
      onCreated={() => { showToast('Account created.'); data.refresh(); }}
      onError={props.onError}
      disabled={props.disabled || data.loading}
    />}</DataState>
  </>;
}

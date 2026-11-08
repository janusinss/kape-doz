import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { api, HubError, login, refreshCommand, type Session } from './api';
import { pendingMatchesSession, recoveryScope, recoverDurableCommand, submitDurableCommand } from './command_recovery';
import { AdminRecoveryError, createAdminRecoveryStore, pendingAdminCommand, type AdminRecoveryState, type AdminRecoveryStore, type PendingAdminCommand } from './admin_recovery';
import { Approvals, Devices, Expenses, Inventory, Recipes, Sales, ShiftReview, type SubmitCommand } from './workspaces';
import { Refunds } from './refunds_workspace';
import { Customers } from './customers_workspace';
import { Accounts, SetupRecovery } from './setup_workspace';
import { ModalFeedbackContext } from './action_modal';
import { Toast, ToastContext, type ToastState } from './toast';
import './styles.css';

type Page = 'shifts' | 'approvals' | 'refunds' | 'customers' | 'sales' | 'recipes' | 'inventory' | 'expenses' | 'setup' | 'devices' | 'accounts';
const pages = [
  ['shifts', 'Shifts', 'M8 3H4v18h16V3h-4M8 3v4h8V3H8m0 9h8m-8 4h5'],
  ['approvals', 'Approvals', 'M8 3H4v18h16V3h-4M8 3v4h8V3H8m-1 11 3 3 6-6'],
  ['refunds', 'Refunds', 'M4 7h11a5 5 0 0 1 0 10H8m0-14L4 7l4 4'],
  ['customers', 'Customers', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0'],
  ['sales', 'Sales & costs', 'M4 20h16M6 16v-4m4 4V8m4 8V5m4 11v-6'],
  ['recipes', 'Recipes', 'M4 5h7v15H4zM13 5h7v15h-7M7 9h1m8 0h1'],
  ['inventory', 'Stock', 'M4 7l8-4 8 4v11l-8 4-8-4V7Zm0 0 8 4 8-4m-8 4v11'],
  ['expenses', 'Expenses', 'M5 3h14v18l-3.5-2-3.5 2-3.5-2L5 21V3Zm4 5h6m-6 4h6'],
  ['setup', 'Settings & recovery', 'M12 3v3m0 12v3M3 12h3m12 0h3m-2.6-6.4-2.1 2.1M8.7 15.3l-2.1 2.1m0-12.8 2.1 2.1m6.6 6.6 2.1 2.1'],
  ['devices', 'Devices', 'M7 3h10v18H7zM10 17h4'],
  ['accounts', 'Accounts', 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m9-3v6m-3-3h6'],
] as const;
const ownerNavigationGroups: { label: string; pages: Page[] }[] = [
  { label: 'Operations', pages: ['shifts', 'approvals', 'refunds'] },
  { label: 'Business', pages: ['customers', 'sales', 'expenses'] },
  { label: 'Menu & stock', pages: ['recipes', 'inventory'] },
  { label: 'System', pages: ['setup', 'devices', 'accounts'] },
];
const mobileNavigation = '(max-width: 700px)';

function Wordmark() {
  return <span className="wordmark"><span className="wordmark-mark" aria-hidden="true">KD</span>KAPE DOZ<span className="wordmark-role">ADMIN</span></span>;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [page, setPage] = useState<Page>('shifts');
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [toastPaused, setToastPaused] = useState(false);
  const toastId = useRef(0);
  const showToast = (message: string) => { setToastPaused(false); setToast({ id: ++toastId.current, message }); };
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<PendingAdminCommand | null>(null);
  const [recoveryLoaded, setRecoveryLoaded] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const running = useRef(false);
  const recoveryStore = useRef<AdminRecoveryStore | null>(null);
  const recoverySubscription = useRef<(() => void) | null>(null);
  const recoveryGeneration = useRef(0);
  const mounted = useRef(false);
  const mobileMenu = useRef<HTMLDialogElement>(null);
  const main = useRef<HTMLElement>(null);

  async function loadSavedState(): Promise<AdminRecoveryState | null> {
    const generation = ++recoveryGeneration.current;
    if (mounted.current) setRecoveryLoaded(false);
    try {
      if (!recoveryStore.current) {
        recoveryStore.current = createAdminRecoveryStore();
        recoverySubscription.current = recoveryStore.current.subscribe(() => { void loadSavedState(); });
      }
      const state = await recoveryStore.current.load();
      if (mounted.current && generation === recoveryGeneration.current) {
        setPending(state.pending);
        setRecoveryError(null);
        setRecoveryLoaded(true);
        setRevision(value => value + 1);
      }
      return state;
    } catch (error) {
      if (mounted.current && generation === recoveryGeneration.current) {
        setRecoveryError(error instanceof AdminRecoveryError ? error.message : 'Saved commands could not be read. Retry saved state or contact the manager.');
        setRecoveryLoaded(true);
      }
      return null;
    }
  }

  useEffect(() => {
    mounted.current = true;
    void loadSavedState();
    const focus = () => { void loadSavedState(); };
    window.addEventListener('focus', focus);
    return () => {
      mounted.current = false;
      recoveryGeneration.current++;
      window.removeEventListener('focus', focus);
      recoverySubscription.current?.();
      recoveryStore.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!toast || toastPaused) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast, toastPaused]);

  const endSession = (message: string | null) => {
    setToast(null);
    sessionRef.current = null;
    setSession(null);
    setPage('shifts');
    setMenuOpen(false);
    setNotice(message ? { error: true, text: message } : null);
  };

  useEffect(() => {
    if (!session) return;
    const expiry = window.setTimeout(() => {
      if (sessionRef.current === session) endSession('Your session expired. Sign in again to continue.');
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(expiry);
  }, [session]);

  useEffect(() => {
    const screen = window.matchMedia(mobileNavigation);
    function closeOnWideScreen(event: MediaQueryListEvent) {
      if (!event.matches && mobileMenu.current?.open) {
        mobileMenu.current.close();
        main.current?.focus({ preventScroll: true });
      }
    }
    screen.addEventListener('change', closeOnWideScreen);
    return () => screen.removeEventListener('change', closeOnWideScreen);
  }, []);

  function readError(error: unknown, active: Session) {
    if (sessionRef.current !== active) return;
    if (error instanceof HubError && error.status === 401) endSession(error.message);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current || !recoveryLoaded || recoveryError) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    running.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const signedIn = await login(String(data.get('account')).trim(), String(data.get('password')));
      sessionRef.current = signedIn;
      setSession(signedIn);
      form.reset();
      const saved = await loadSavedState();
      if (saved?.pending) {
        if (pendingMatchesSession(saved.pending, signedIn)) await resolvePending(signedIn, saved.pending, false);
        else setNotice({ error: true, text: 'A saved operation belongs to another account or hub. Sign in with the original account and hub to confirm it.' });
      }
    } catch (error) {
      const message = error instanceof HubError ? error.message : 'Sign-in could not be completed.';
      if (error instanceof HubError && error.status === 401 && sessionRef.current) endSession(message);
      else setNotice({ error: true, text: message });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function signOut() {
    const active = sessionRef.current;
    if (!active || running.current) return;
    running.current = true;
    setBusy(true);
    endSession(null);
    try { await api.logout(active); }
    catch (error) {
      if (!(error instanceof HubError && error.status === 401)) setNotice({ error: true, text: 'This portal is signed out. Hub sign-out could not be confirmed.' });
    } finally { running.current = false; setBusy(false); }
  }

  function dependencies(active: Session) {
    const store = recoveryStore.current;
    if (!store) throw new AdminRecoveryError();
    return { store, isCurrent: () => mounted.current && sessionRef.current === active && active.expiresAt > Date.now(),
      status: api.commandStatus, mutate: api.mutate, refresh: refreshCommand };
  }

  function resolvedNotice(outcome: 'accepted' | 'rejected' | 'unrecorded') {
    if (outcome === 'unrecorded') {
      setNotice({ error: true, text: 'The saved command is awaiting confirmation. Retry it using its original identity.' });
    } else {
      setPending(null);
      setRevision(value => value + 1);
      if (outcome === 'accepted') showToast('Previous command confirmed by the hub.');
      setNotice({ error: outcome === 'rejected', text: outcome === 'rejected'
        ? 'Previous command was not applied to the hub. Current records refreshed. Review before trying again.'
        : 'Previous command confirmed by the hub. Current records refreshed.' });
    }
  }

  async function resolvePending(active: Session, command: PendingAdminCommand, retryUnrecorded: boolean): Promise<boolean> {
    const outcome = await recoverDurableCommand(active, command, dependencies(active), retryUnrecorded);
    if (sessionRef.current !== active) return false;
    if (outcome === 'unrecorded') {
      resolvedNotice(outcome);
      return false;
    }
    resolvedNotice(outcome);
    return outcome === 'accepted';
  }

  async function execute(command: PendingAdminCommand, recovering = false): Promise<boolean> {
    const active = sessionRef.current;
    if (!active || running.current || !recoveryLoaded || recoveryError || !pendingMatchesSession(command, active)) return false;
    running.current = true;
    setBusy(true);
    setNotice(null);
    setPending(command);
    try {
      if (recovering) return await resolvePending(active, command, true);
      const outcome = await submitDurableCommand(active, command, dependencies(active));
      if (sessionRef.current !== active) return false;
      if (outcome === 'accepted') {
        setPending(null);
        setNotice(null);
        showToast(command.label);
        setRevision(value => value + 1);
      } else resolvedNotice(outcome);
      return outcome === 'accepted';
    } catch (error) {
      const hubError = error instanceof HubError ? error : new HubError(error instanceof AdminRecoveryError ? error.message : 'The saved command could not be confirmed. Retry saved state or contact the manager.', undefined, true);
      if (sessionRef.current !== active) return false;
      if (hubError.status === 401) endSession(hubError.message);
      else setNotice({ error: true, text: hubError.message });
      if (hubError.status === 409) setRevision(value => value + 1);
      return false;
    } finally {
      await loadSavedState();
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const submit: SubmitCommand = (path, data, label) => {
    const active = sessionRef.current;
    if (!active || pending || running.current || !recoveryLoaded || recoveryError) return Promise.resolve(false);
    if (!globalThis.crypto?.randomUUID) {
      setNotice({ error: true, text: 'Open the portal on HTTPS or localhost to submit changes.' });
      return Promise.resolve(false);
    }
    try {
      const command = pendingAdminCommand({ id: globalThis.crypto.randomUUID(), path, data, label, actorId: active.actor.id, branchId: active.actor.branchId },
        recoveryScope(active), Date.now());
      return execute(command);
    } catch (error) {
      setNotice({ error: true, text: error instanceof AdminRecoveryError || error instanceof HubError ? error.message : 'This command could not be prepared. Check the details and retry.' });
      return Promise.resolve(false);
    }
  };

  const recoveryState = <>
    {!recoveryLoaded && <p className="notice" role="status">Checking saved commands…</p>}
    {recoveryError && <div className="notice error" role="alert"><p>{recoveryError}</p><button type="button" disabled={busy} onClick={() => void loadSavedState()}>Retry saved state</button></div>}
  </>;

  if (!session) return <div className="auth-page">
    <main className="auth-main">
      <div className="auth-layout auth-split-card">
        <section className="auth-panel" aria-labelledby="admin-sign-in">
          <div className="auth-brand"><Wordmark /></div>
          <div className="auth-header-copy">
            <h1 id="admin-sign-in">Welcome back.</h1>
            <p className="auth-subtitle">Sign in to manage your café’s daily operations.</p>
          </div>

          {recoveryState}
          {pending && <p className="notice" role="status">A saved operation needs confirmation. Sign in with the original administrator account and hub.</p>}
          {notice && <p className="notice error" role="alert">{notice.text}</p>}

          <form onSubmit={event => void signIn(event)} aria-busy={busy} className="auth-form-styled">
            <div className="auth-field-group">
              <label htmlFor="admin-account-field">Account ID</label>
              <div className="auth-input-container">
                <input
                  id="admin-account-field"
                  name="account"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  maxLength={100}
                  placeholder="e.g. admin"
                />
              </div>
            </div>

            <div className="auth-field-group">
              <label htmlFor="admin-password-field">Password</label>
              <div className="auth-input-container auth-password-container">
                <input
                  id="admin-password-field"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  maxLength={256}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password text' : 'Reveal password text'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {showPassword ? (
                      <>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </>
                    ) : (
                      <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
            </div>

            <div className="auth-utility-row">
              <label className="auth-checkbox-label">
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  onChange={e => setKeepSignedIn(e.target.checked)}
                />
                <span>Keep me signed in</span>
              </label>
              <button
                type="button"
                className="auth-link-btn"
                onClick={() => setHelpOpen(v => !v)}
              >
                Need help?
              </button>
            </div>

            {helpOpen && (
              <div className="auth-help-banner" role="note">
                <p><strong>Administrator Credentials</strong></p>
                <p>Default test accounts: <code>admin</code> / <code>admin123</code>. For account recovery, check local hub authority keys.</p>
              </div>
            )}

            <button
              type="submit"
              className="auth-submit primary-submit"
              disabled={busy || !recoveryLoaded || recoveryError !== null}
            >
              {busy ? (
                <span className="submit-loading-wrap">
                  <span className="submit-spinner" aria-hidden="true" />
                  <span>Signing in…</span>
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <p className="auth-footer-note">For owners and managers of KAPE DOZ.</p>
        </section>

        <section className="auth-hero-pane" aria-label="Café showcase">
          <div className="auth-hero-frame">
            <img
              src="/hero-coffee.jpg"
              alt=""
              className="auth-hero-photo"
              width="800"
              height="1000"
            />
            <div className="auth-hero-scrim" />

            <div className="auth-hero-copy">
              <span className="auth-hero-brand">KAPE DOZ</span>
              <p>Good coffee.<br />Better days.</p>
              <span className="auth-hero-caption">Your café, all in one place.</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>;

  const mayRetry = pending ? pendingMatchesSession(pending, session) : false;
  const available = pages.filter(([key]) => (key !== 'devices' && key !== 'accounts') || session.actor.role === 'owner');
  const workspace = { session, revision, onError: readError, submit, disabled: busy || pending !== null || !recoveryLoaded || recoveryError !== null };
  const workspaceButton = ([key, label, icon]: (typeof pages)[number]) => <button key={key} type="button" aria-current={key === page ? 'page' : undefined} onClick={() => {
    setPage(key);
    if (mobileMenu.current?.open) {
      mobileMenu.current.close();
      main.current?.focus({ preventScroll: true });
    }
    if (key !== page) window.scrollTo(0, 0);
  }}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg>
    <span>{label}</span>
  </button>;
  const workspaceLinks = session.actor.role === 'owner'
    ? ownerNavigationGroups.map(group => {
        const items = group.pages.flatMap(key => available.filter(([pageKey]) => pageKey === key));
        return items.length ? <section className="workspace-group" key={group.label} aria-label={group.label}>
          <h2 className="workspace-group-label">{group.label}</h2>
          {items.map(workspaceButton)}
        </section> : null;
      })
    : available.map(workspaceButton);

  return <div className={`app-shell${session.actor.role === 'owner' ? ' owner-shell' : ''}`}>
    <header className="topbar">
      <div className="topbar-brand">
        <button className="menu-toggle" type="button" aria-label="Open navigation" aria-haspopup="dialog" aria-controls="mobile-navigation" aria-expanded={menuOpen} onClick={event => {
          const dialog = mobileMenu.current;
          if (!dialog || dialog.open) return;
          event.currentTarget.focus({ preventScroll: true });
          dialog.showModal();
          setMenuOpen(true);
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <Wordmark />
      </div>
      <div className="profile">
        {session.actor.role !== 'owner' && <div className="profile-identity">
          <span className="profile-details"><strong title={session.actor.displayName}>{session.actor.displayName}</strong><small>{session.actor.role}</small></span>
        </div>}
        <button type="button" onClick={() => void signOut()} disabled={busy}>
          {session.actor.role === 'owner' && <svg className="signout-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2M14 8l4 4-4 4M8 12h10" /></svg>}
          <span>Sign out</span>
        </button>
      </div>
    </header>
    <nav className="sidebar" aria-label="Admin workspaces">
      <div className="workspace-links">{workspaceLinks}</div>
    </nav>
    <dialog ref={mobileMenu} className="mobile-nav" id="mobile-navigation" aria-labelledby="mobile-navigation-title" onClose={event => setMenuOpen(event.currentTarget.open)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) event.currentTarget.close();
    }}>
      <div className="mobile-nav-header">
        <h2 id="mobile-navigation-title">Workspaces</h2>
        <button type="button" aria-label="Close navigation" onClick={() => mobileMenu.current?.close()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <nav className="workspace-links" aria-label="Admin workspaces">{workspaceLinks}</nav>
    </dialog>
    <ToastContext.Provider value={{ toast, show: message => { if (sessionRef.current === session && session.expiresAt > Date.now()) showToast(message); }, dismiss: () => setToast(null), pause: setToastPaused }}>  
    <main ref={main} tabIndex={-1} className="main" id="workspace">
      <ModalFeedbackContext.Provider value={notice?.error ? notice.text : pending ? 'A previous command is awaiting confirmation. Close this dialog to review or retry it.' : null}>
      {recoveryState}
      {pending && <div className="notice pending" role="status">
        <p>{mayRetry ? 'The previous command is saved on this browser. Confirm it before making another change.' : 'A previous command is awaiting confirmation. Sign in with the original account and hub to retry.'}</p>
        {mayRetry && <button type="button" disabled={busy || !recoveryLoaded || recoveryError !== null} onClick={() => void execute(pending, true)}>{busy ? 'Checking…' : 'Retry previous command'}</button>}
      </div>}
      {notice && <p className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      {page === 'shifts' && <ShiftReview {...workspace} />}
      {page === 'approvals' && <Approvals {...workspace} />}
      {page === 'refunds' && <Refunds {...workspace} />}
      {page === 'customers' && <Customers {...workspace} />}
      {page === 'sales' && <Sales {...workspace} />}
      {page === 'recipes' && <Recipes {...workspace} />}
      {page === 'inventory' && <Inventory {...workspace} />}
      {page === 'expenses' && <Expenses {...workspace} />}
      {page === 'setup' && <SetupRecovery {...workspace} />}
      {page === 'devices' && session.actor.role === 'owner' && <Devices {...workspace} />}
      {page === 'accounts' && session.actor.role === 'owner' && <Accounts {...workspace} />}
      </ModalFeedbackContext.Provider>
    </main>
    <Toast />
    </ToastContext.Provider>
  </div>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);

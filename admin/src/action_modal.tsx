import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { Toast } from './toast';

export const ModalFeedbackContext = createContext<string | null>(null);

type ActionModalProps = { title: string; onClose: () => void; children: ReactNode; dismissDisabled?: boolean; open?: boolean };

/** A native modal dialog keeps focus within the active task and restores it on close. */
export function ActionModal({ title, onClose, children, dismissDisabled = false, open = true }: ActionModalProps) {
  const feedback = useContext(ModalFeedbackContext);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    }
    if (!open && element.open) {
      element.close();
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    }
  }, [open]);
  useEffect(() => {
    const element = dialog.current;
    return () => {
      if (element?.open) element.close();
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="action-modal" aria-labelledby={titleId}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')).filter(item => item.getClientRects().length > 0);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }}
    onCancel={event => { event.preventDefault(); if (!dismissDisabled) onClose(); }}>
    <div className="action-modal-header">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="action-modal-close" aria-label="Close dialog" disabled={dismissDisabled} onClick={onClose}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
    <div className="action-modal-body">{feedback && <p className="notice error" role="alert">{feedback}</p>}{children}</div>
    {open && <Toast inModal />}
  </dialog>;
}

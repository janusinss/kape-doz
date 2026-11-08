import { createContext, useContext } from 'react';

export type ToastState = { id: number; message: string } | null;
export const ToastContext = createContext<{ toast: ToastState; show: (message: string) => void; dismiss: () => void; pause: (paused: boolean) => void }>({ toast: null, show: () => {}, dismiss: () => {}, pause: () => {} });
export const useToast = () => useContext(ToastContext);

export function Toast({ inModal = false }: { inModal?: boolean }) {
  const { toast, dismiss, pause } = useToast();
  if (!toast) return null;
  return <div className={`toast ${inModal ? 'toast-modal' : 'toast-global'}`} role="status" aria-live="polite" key={toast.id} onMouseEnter={() => pause(true)} onMouseLeave={() => pause(false)} onFocus={() => pause(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) pause(false); }}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
    <span>{toast.message}</span>
    <button type="button" aria-label="Dismiss notification" onClick={dismiss}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
  </div>;
}

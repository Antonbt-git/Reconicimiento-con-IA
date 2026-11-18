// Bus de notificaciones in-app (toasts). Sin dependencia de React.
export type ToastKind = "success" | "info" | "warning" | "error";
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

type L = (t: Toast) => void;
const listeners = new Set<L>();
let seq = 0;

export function toast(kind: ToastKind, title: string, message?: string) {
  const t = { id: ++seq, kind, title, message };
  listeners.forEach((l) => l(t));
}

export function onToast(l: L) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

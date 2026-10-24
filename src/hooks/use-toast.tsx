"use client";

import * as React from "react";

const TOAST_LIMIT = 5;
const TOAST_REMOVE_DELAY = 4000;

type ToastVariant = "default" | "destructive";

interface ToastState {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  open?: boolean;
}

type Action =
  | { type: "ADD_TOAST"; toast: ToastState }
  | { type: "DISMISS_TOAST"; toastId: string }
  | { type: "REMOVE_TOAST"; toastId: string };

interface State {
  toasts: ToastState[];
}

const actionQueue: Array<{ toastId: string; timeout: ReturnType<typeof setTimeout> }> = [];

function addToRemoveQueue(toastId: string, dispatch: React.Dispatch<Action>) {
  const existing = actionQueue.findIndex((q) => q.toastId === toastId);
  if (existing !== -1) {
    clearTimeout(actionQueue[existing].timeout);
    actionQueue.splice(existing, 1);
  }
  const timeout = setTimeout(() => {
    dispatch({ type: "REMOVE_TOAST", toastId });
  }, TOAST_REMOVE_DELAY);
  actionQueue.push({ toastId, timeout });
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };
    case "DISMISS_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) => (t.id === action.toastId ? { ...t, open: false } : t)),
      };
    case "REMOVE_TOAST":
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
}

const ToastContext = React.createContext<{
  toasts: ToastState[];
  toast: (opts: Omit<ToastState, "id" | "open">) => void;
  dismiss: (id: string) => void;
} | null>(null);

export function ToastContextProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, { toasts: [] });

  const toast = React.useCallback((opts: Omit<ToastState, "id" | "open">) => {
    const id = Math.random().toString(36).slice(2);
    dispatch({ type: "ADD_TOAST", toast: { ...opts, id, open: true } });
    addToRemoveQueue(id, dispatch);
  }, []);

  const dismiss = React.useCallback((id: string) => {
    dispatch({ type: "DISMISS_TOAST", toastId: id });
    addToRemoveQueue(id, dispatch);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts: state.toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastContextProvider");
  return ctx;
}

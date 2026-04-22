"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ToastType = "error" | "success";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const add = useCallback((message: string, type: ToastType) => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const showError = useCallback((message: string) => add(message, "error"), [add]);
  const showSuccess = useCallback((message: string) => add(message, "success"), [add]);

  return (
    <ToastContext.Provider value={{ showError, showSuccess }}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          left: 24,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: 420,
          pointerEvents: "none",
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              pointerEvents: "auto",
              borderRadius: 8,
              padding: "10px 14px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
              fontSize: 14,
              lineHeight: 1.5,
              ...(toast.type === "error"
                ? {
                    color: "#ffd2db",
                    background: "#2a0c13",
                    border: "1px solid rgba(255, 110, 130, 0.5)",
                  }
                : {
                    color: "#d6ffeb",
                    background: "#0b2318",
                    border: "1px solid rgba(79, 224, 162, 0.45)",
                  }),
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé dans ToastProvider");
  return ctx;
}

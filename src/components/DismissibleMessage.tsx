import { useState, type ReactNode } from "react";
import { X } from "lucide-react";

export function DismissibleMessage({
  children,
  onDismiss,
  role = "status",
  className = "",
}: {
  children: ReactNode;
  onDismiss?: () => void;
  role?: "alert" | "status";
  className?: string;
}) {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div
      className={`manager-message dismissible-notice ${className}`.trim()}
      role={role}
    >
      <div className="dismissible-message-content">{children}</div>
      <button
        className="icon-btn"
        aria-label="Dismiss notification"
        onClick={() => {
          setVisible(false);
          onDismiss?.();
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

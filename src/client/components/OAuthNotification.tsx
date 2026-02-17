import React, { useEffect, useState } from "react";
import { CheckCircle, XCircle, X } from "lucide-react";

interface OAuthNotificationProps {
  status: "success" | "error";
  message: string | null;
  serverId: string | null;
  onDismiss: () => void;
}

export default function OAuthNotification({
  status,
  message,
  serverId,
  onDismiss,
}: OAuthNotificationProps) {
  const [visible, setVisible] = useState(true);

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300); // Wait for fade-out animation
    }, 8000);

    return () => clearTimeout(timer);
  }, [onDismiss]);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 300);
  };

  const isSuccess = status === "success";

  return (
    <div
      className={`fixed top-4 right-4 z-50 max-w-md transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      }`}
    >
      <div
        className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl border backdrop-blur-sm ${
          isSuccess
            ? "bg-green-900/80 border-green-700/60 text-green-100"
            : "bg-red-900/80 border-red-700/60 text-red-100"
        }`}
      >
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          {isSuccess ? (
            <CheckCircle className="w-5 h-5 text-green-400" />
          ) : (
            <XCircle className="w-5 h-5 text-red-400" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {isSuccess ? "OAuth Authentication Successful" : "OAuth Authentication Failed"}
          </p>
          <p className="text-xs mt-0.5 opacity-80">
            {isSuccess
              ? serverId
                ? "Server has been authenticated and is now connecting."
                : "Authentication completed successfully."
              : message || "An unknown error occurred during authentication."}
          </p>
        </div>

        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          className={`flex-shrink-0 p-1 rounded-lg transition-colors ${
            isSuccess
              ? "hover:bg-green-800/60 text-green-300"
              : "hover:bg-red-800/60 text-red-300"
          }`}
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
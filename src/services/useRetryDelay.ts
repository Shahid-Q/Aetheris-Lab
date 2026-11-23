import { useEffect, useState } from "react";

export function useRetryDelay(retryAt: number) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(
      () => setElapsed(retryAt),
      Math.max(0, retryAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [retryAt]);
  return retryAt > elapsed;
}

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";

export function useProvisioningJob(jobId, onComplete) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    if (!jobId) return undefined;
    let active = true;
    let timer;

    async function refresh() {
      try {
        const next = await api.getProvisioningJob(jobId);
        if (!active) return;
        setJob(next); setError("");
        if (["ready", "failed"].includes(next.status)) {
          if (next.status === "ready") await onCompleteRef.current?.();
          return;
        }
        const retryAt = next.status === "retrying" && next.nextRetryAt ? new Date(next.nextRetryAt).getTime() : 0;
        const delay = retryAt > Date.now() ? retryAt - Date.now() + 1500 : 5000;
        timer = window.setTimeout(refresh, delay);
      } catch (requestError) {
        if (!active) return;
        setError(requestError.message);
        timer = window.setTimeout(refresh, 10000);
      }
    }

    refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [jobId]);

  async function retry() {
    setError("");
    try { await api.retryProvisioningJob(jobId); setJob((current) => current ? { ...current, status: "queued", currentStep: "queued", error: null } : current); }
    catch (requestError) { setError(requestError.message); }
  }

  return { job, error, retry };
}

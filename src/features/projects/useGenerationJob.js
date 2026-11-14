import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";

export function useGenerationJob(jobId, onComplete) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    if (!jobId) return undefined;
    let active = true;
    let timer;
    async function refresh() {
      try {
        const next = await api.getGenerationJob(jobId);
        if (!active) return;
        setJob(next); setError("");
        const deploymentActive = ["queued", "running"].includes(next.result?.deployment?.status);
        if (["ready", "failed"].includes(next.status) && !deploymentActive) {
          if (next.status === "ready") await onCompleteRef.current?.();
          return;
        }
        timer = window.setTimeout(refresh, 3000);
      } catch (requestError) {
        if (!active) return;
        setError(requestError.message);
        timer = window.setTimeout(refresh, 10000);
      }
    }
    refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [jobId, pollRevision]);

  async function retry() {
    setError("");
    try {
      await api.retryGenerationJob(jobId);
      setJob((current) => current ? { ...current, status: "queued", currentStep: "queued", error: null, attempts: 0 } : current);
      setPollRevision((revision) => revision + 1);
    }
    catch (requestError) { setError(requestError.message); }
  }

  async function redeploy() {
    setError(""); setDeploying(true);
    try {
      const deployment = await api.redeployGenerationJob(jobId);
      setJob((current) => current ? { ...current, result: { ...current.result, deployment } } : current);
      setPollRevision((revision) => revision + 1);
    }
    catch (requestError) { setError(requestError.message); }
    finally { setDeploying(false); }
  }

  return { job, error, retry, redeploy, deploying };
}

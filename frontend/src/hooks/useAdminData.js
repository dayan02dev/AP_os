import { useState, useEffect, useCallback } from "react";
import { adminPlatformApi } from "../lib/adminPlatformApi";
import {
  adaptPipelineRow, adaptStats, adaptDetail, adaptReviewer,
  adaptReviewerApplication, adaptCalibrationRow, adaptAuditEntry, adaptBatch,
} from "../lib/adminDataAdapter";

const LOADERS = {
  pipeline: async (params) => {
    const r = await adminPlatformApi.getPipeline(params);
    return { startups: (r.applications || []).map(adaptPipelineRow), total: r.total };
  },
  stats: async () => adaptStats(await adminPlatformApi.getStats()),
  reviewers: async () => {
    const r = await adminPlatformApi.getReviewers();
    return { reviewers: (r.reviewers || []).map(adaptReviewer) };
  },
  reviewerApplications: async ({ userId }) => {
    const r = await adminPlatformApi.getReviewerApplications(userId);
    return { applications: (r.applications || []).map(adaptReviewerApplication) };
  },
  audit: async (params) => {
    const r = await adminPlatformApi.getAuditLog(params);
    return { entries: (r.entries || []).map(adaptAuditEntry) };
  },
  calibration: async () => {
    const r = await adminPlatformApi.getCalibration();
    return { reviewers: (r.reviewers || []).map(adaptCalibrationRow) };
  },
  batches: async () => {
    const r = await adminPlatformApi.getBatches();
    return { batches: (r.batches || []).map(adaptBatch) };
  },
};

export function useAdminData(kind, params) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const key = JSON.stringify(params || {});
  const reload = useCallback(() => {
    setLoading(true);
    LOADERS[kind](params || {})
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, [kind, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

export async function loadDetail(track, id) {
  return adaptDetail(await adminPlatformApi.getApplication(track, id));
}

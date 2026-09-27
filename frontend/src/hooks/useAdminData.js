import { useState, useEffect, useCallback } from "react";
import { adminPlatformApi } from "../lib/adminPlatformApi";
import { icDocumentsApi } from "../lib/icDocumentsApi";
import {
  adaptPipelineRow, adaptStats, adaptDetail, adaptReviewer,
  adaptReviewerApplication, adaptCalibrationRow, adaptAuditEntry, adaptBatch,
  adaptJuror, adaptJurorApplication,
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
  jurors: async () => {
    const r = await adminPlatformApi.getJurors();
    return { jurors: (r.jurors || []).map(adaptJuror),
             pendingInvites: r.pending_invites || [] };
  },
  jurorApplications: async ({ userId }) => {
    const r = await adminPlatformApi.getJurorApplications(userId);
    return { applications: (r.applications || []).map(adaptJurorApplication) };
  },
  // IC documents, keyed by "<track>:<application_id>" for O(1) row lookup.
  // An application can hold several: `listByKey` has all of them (oldest
  // first); `byKey` keeps the newest one for single-document readers.
  icDocuments: async ({ track } = {}) => {
    const r = await icDocumentsApi.list(track);
    const listByKey = {};
    for (const d of r.documents || []) {
      if (!d || !d.application_id) continue;
      (listByKey[`${d.track}:${d.application_id}`] ||= []).push(d);
    }
    const byKey = {};
    for (const [k, list] of Object.entries(listByKey)) {
      list.sort((a, b) => String(a.uploaded_at || "").localeCompare(String(b.uploaded_at || "")));
      byKey[k] = list[list.length - 1];
    }
    return { documents: r.documents || [], byKey, listByKey };
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

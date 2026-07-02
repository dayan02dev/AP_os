import { apiCall } from "./api.js";

export const profileCompletionApi = {
  getState: (token) => apiCall(`/profile-completion/${encodeURIComponent(token)}`, { method: "GET" }),
  submit: (token, { file, linkedinUrl }) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    if (linkedinUrl) fd.append("linkedin_url", linkedinUrl);
    return apiCall(`/profile-completion/${encodeURIComponent(token)}`, { method: "POST", body: fd });
  },
};

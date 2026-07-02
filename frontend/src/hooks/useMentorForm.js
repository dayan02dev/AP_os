// useMentorForm — load and submit mentor onboarding responses.
//
// load(token)   → GET /mentors/respond/:token  → { mentor_name, email, already_responded }
// submit(token) → POST /mentors/respond/:token → backend confirms

import { useCallback, useState } from "react";
import { api } from "../lib/api.js";

export function useMentorForm() {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (token) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get("/mentors/respond/" + token);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const submit = useCallback(async (token, payload) => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post("/mentors/respond/" + token, payload);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { load, submit, loading, submitting, error };
}

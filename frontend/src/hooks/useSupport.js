// useSupport — file tickets. Works authed or anon.

import { useCallback, useState } from "react";
import { api } from "../lib/api.js";

export function useSupport() {
  const [submitting, setSubmitting] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);
  const [error, setError] = useState(null);

  const submit = useCallback(async ({ email, subject, body, category }) => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post("/support/ticket", {
        email,
        subject,
        body,
        category,
      });
      setLastTicket(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submit, submitting, lastTicket, error };
}

import { useEffect, useState } from "react";

function fmt(msLeft) {
  if (msLeft <= 0) return "0:00";
  const m = Math.floor(msLeft / 60000);
  const s = Math.floor((msLeft % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function classFor(msLeft) {
  if (msLeft < 60 * 1000) return "coral";
  if (msLeft < 5 * 60 * 1000) return "amber";
  return "";
}

export default function EditWindowCountdown({ lockedAt, onExpire }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deadline = new Date(lockedAt).getTime();
  const msLeft = deadline - now;
  const colorClass = classFor(msLeft);

  useEffect(() => {
    if (msLeft <= 0 && typeof onExpire === "function") onExpire();
  }, [msLeft, onExpire]);

  return (
    <span className={`edit-countdown ${colorClass}`}>
      {fmt(msLeft)} left
    </span>
  );
}

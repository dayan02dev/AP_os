// VideoAnswer — embed a video URL if we recognise the provider; otherwise
// render a link card with "open in tab". Empty string → EmptyAnswer.

import EmptyAnswer from "./EmptyAnswer.jsx";

function detectEmbed(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    // Loom — share URL has /share/<uuid>; embed URL uses /embed/<uuid>
    if (host.endsWith("loom.com")) {
      const m = u.pathname.match(/\/share\/([\w-]+)/);
      if (m) return { src: `https://www.loom.com/embed/${m[1]}`, label: "LOOM" };
      const m2 = u.pathname.match(/\/embed\/([\w-]+)/);
      if (m2) return { src: url, label: "LOOM" };
    }
    // YouTube — youtu.be/<id> or youtube.com/watch?v=<id>
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\/+/, "").split("/")[0];
      if (id) return { src: `https://www.youtube.com/embed/${id}`, label: "YOUTUBE" };
    }
    if (host.endsWith("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return { src: `https://www.youtube.com/embed/${id}`, label: "YOUTUBE" };
      const m = u.pathname.match(/\/embed\/([\w-]+)/);
      if (m) return { src: url, label: "YOUTUBE" };
    }
    // Vimeo — vimeo.com/<id>
    if (host.endsWith("vimeo.com")) {
      const id = u.pathname.replace(/^\/+/, "").split("/")[0];
      if (/^\d+$/.test(id)) return { src: `https://player.vimeo.com/video/${id}`, label: "VIMEO" };
    }
  } catch {
    // Not a valid URL — fall through to the link card.
  }
  return null;
}

export default function VideoAnswer({ value }) {
  if (!value || typeof value !== "string" || !value.trim()) return <EmptyAnswer />;
  const url = value.trim();
  const embed = detectEmbed(url);
  if (embed) {
    return (
      <div className="ans-video">
        <iframe
          src={embed.src}
          title="Application video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
        <a
          className="open-tab"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          open in tab ↗
        </a>
        <span className="ans-video-label">{embed.label}</span>
      </div>
    );
  }
  return (
    <div className="ans-video-link">
      <a href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
    </div>
  );
}

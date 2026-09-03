const ALLOWED_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{6,15}$/;

export interface ValidatedYoutubeUrl {
  videoId: string;
  canonicalUrl: string;
  playlistIgnored: boolean;
}

export function validateYoutubeUrl(value: string): ValidatedYoutubeUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL YouTube invalide.");
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Seules les URL HTTPS YouTube publiques sont autorisées.");
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;
  if (host === "youtu.be") {
    if (parts.length !== 1) throw new Error("URL courte YouTube invalide.");
    videoId = parts[0];
  } else if (url.pathname === "/watch") {
    videoId = url.searchParams.get("v");
  } else if (parts.length === 2 && (parts[0] === "shorts" || parts[0] === "live")) {
    videoId = parts[1];
  }
  if (!videoId || !VIDEO_ID.test(videoId)) {
    throw new Error("L’URL doit désigner une vidéo YouTube, pas une chaîne, une recherche ou une playlist seule.");
  }
  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    playlistIgnored: url.searchParams.has("list"),
  };
}


import { describe, expect, it } from "vitest";

import { validateYoutubeUrl } from "./youtube-url";

describe("validateYoutubeUrl", () => {
  it.each([
    ["watch", "https://www.youtube.com/watch?v=abcDEF_1234"],
    ["youtu.be", "https://youtu.be/abcDEF_1234"],
    ["shorts", "https://youtube.com/shorts/abcDEF_1234"],
    ["live", "https://m.youtube.com/live/abcDEF_1234"],
    ["music", "https://music.youtube.com/watch?v=abcDEF_1234"],
  ])("accepte %s", (_, value) => expect(validateYoutubeUrl(value).videoId).toBe("abcDEF_1234"));

  it("ignore la playlist lorsqu’une vidéo est présente", () => {
    expect(validateYoutubeUrl("https://www.youtube.com/watch?v=abcDEF_1234&list=PL123")).toMatchObject({ playlistIgnored: true });
  });

  it("retire les paramètres de tracking de l’URL canonique", () => {
    expect(validateYoutubeUrl("https://youtu.be/abcDEF_1234?si=secret&utm_source=test").canonicalUrl)
      .toBe("https://www.youtube.com/watch?v=abcDEF_1234");
  });

  it.each([
    "http://youtube.com/watch?v=abcDEF_1234",
    "https://youtube.com.evil.test/watch?v=abcDEF_1234",
    "https://evil-youtube.com/watch?v=abcDEF_1234",
    "https://youtube.com/channel/UC1234567890",
    "https://youtube.com/results?search_query=test",
    "https://youtube.com/playlist?list=PL123",
    "https://youtu.be/abcDEF_1234/extra",
  ])("refuse %s", (value) => expect(() => validateYoutubeUrl(value)).toThrow());
});


# ytp-embed

Paste a YouTube playlist URL and watch the video alongside a browsable playlist.

Static HTML/CSS/JS only — no backend, no API key. Minimal styling so it can sit inside other pages.

**Live site:** [https://birdx0810.github.io/ytp-embed/](https://birdx0810.github.io/ytp-embed/)  
**Repo:** [https://github.com/birdx0810/ytp-embed](https://github.com/birdx0810/ytp-embed)

## Run locally

Serve the repo root with any static file server, for example:

```bash
npx --yes serve .
```

Then open [http://localhost:3000](http://localhost:3000) (use `localhost`, not `127.0.0.1` — YouTube blocks embeds from IP hosts). If you open `127.0.0.1`, the app redirects to `localhost` automatically.

## Deploy on GitHub Pages

1. Settings → Pages → Source: deploy from the `main` branch (root).
2. Open [https://birdx0810.github.io/ytp-embed/](https://birdx0810.github.io/ytp-embed/).

Shareable links keep the playlist in the query string, e.g. `?list=PL…&v=VIDEO_ID`.

### Embed on another site

Hide the URL form and empty state with `embed=1`:

```html
<iframe
  src="https://birdx0810.github.io/ytp-embed/?embed=1&list=PLxxxxxxxx"
  title="Playlist"
  width="100%"
  height="640"
  style="border: 0;"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen
></iframe>
```

Optional start video: `&v=VIDEO_ID`.

Playback: `&loop=1` and/or `&shuffle=1` (also available as toggles in the playlist header; remembered in `localStorage`).

Language defaults to the browser/system language. Override with `?lang=en`, `?lang=zh-TW`, or `?lang=zh-CN`, or use the language picker (includes Auto).

## Supported URLs

- `https://www.youtube.com/playlist?list=PL…`
- `https://www.youtube.com/watch?v=VIDEO_ID&list=PL…`
- `https://youtu.be/VIDEO_ID?list=PL…`

## Notes

Playlist metadata is loaded from public [Invidious](https://invidious.io/) API instances (with a YouTube IFrame API probe as fallback). Playback uses the YouTube IFrame API with single-video loads so YouTube’s built-in playlist chrome stays off. The page sets `Referrer-Policy: strict-origin-when-cross-origin` so embeds don’t hit YouTube Error 153. Thumbnails use `i.ytimg.com`. Clicking a playlist item plays it in the embed; Cmd/Ctrl-click a playlist title to open the video on YouTube. Channel links appear only on the author name under the player. The player advances (or stops) at the end so YouTube’s related end-screen is avoided.

# YouTube API setup

Do this last, after everything else works offline.

## 1. Project and APIs

In the [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project.
2. Enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Configure the OAuth consent screen. While it is in Testing, add your own
   Google account under Test users — otherwise the token exchange fails with an
   unhelpful error.

## 2. Credentials

Create an **OAuth client ID** of type *Desktop app*. Note the client ID and
secret into `.env`.

## 3. Scopes

Request exactly these:

| Scope | Why |
|---|---|
| `youtube.upload` | uploading videos |
| `youtube` | thumbnails, playlists, metadata updates |
| `yt-analytics.readonly` | views, retention, traffic sources |
| `yt-analytics-monetary.readonly` | revenue and RPM — omit if not monetized |

Do not request `youtubepartner` or `force-ssl` — they are broader than anything
here needs.

## 4. Refresh token

Run the consent flow once with `access_type=offline` and `prompt=consent`.
Without `prompt=consent`, Google returns a refresh token only on the very first
authorisation, and re-running the flow later silently yields none.

Put the refresh token in `YOUTUBE_REFRESH_TOKEN`.

## 5. Quota — the real constraint

Default quota is **10,000 units per day**. A video insert costs about **1,600**.

That is roughly **six uploads a day**, which is far above two videos a week but
well within reach of a retry loop. `quotaExceeded` is therefore mapped as a
**terminal** error: quota resets at midnight Pacific, and retrying before then
only burns attempts.

Approximate costs:

| Call | Units |
|---|---|
| `videos.insert` | 1,600 |
| `thumbnails.set` | 50 |
| `videos.update` | 50 |
| `playlistItems.insert` | 50 |
| Analytics query | 1 |

Analytics is essentially free. Uploads are not.

## 6. Go carefully

```bash
YOUTUBE_PROVIDER=google
```

Upload the first video as **PRIVATE**. Watch it on YouTube. Check the
thumbnail, chapters, captions and description before anything goes public.

Scheduled publishing requires the video to start private; YouTube flips it at
`publishAt`. The uploader enforces that regardless of the requested visibility.

## Disclosure

Uploads declare synthetic media (`containsSyntheticMedia: true`) and the
description states that narration is synthesised. YouTube's altered-content
policy changes; confirm the current requirement before your first public upload.
The cost of declaring is a checkbox. The cost of not declaring is the channel.

## When it breaks

| Symptom | Cause |
|---|---|
| 401 on every call | refresh token revoked — password change or 6 months idle on an unverified app |
| 403 `quotaExceeded` | out of units; resets midnight Pacific |
| 403 on analytics only | monetary scope missing, or the channel is not monetized |
| Upload succeeds, thumbnail fails | over 2 MB, or the channel lacks custom-thumbnail privileges |
| Impressions always null | impressions require access most channels do not have; recorded as unavailable, not zero |

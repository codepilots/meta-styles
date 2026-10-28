# Instagram access routes (verified against Meta docs, v26.0)

## Decision table

| Goal | Official route | Works for normal users? | Requirements / limits |
|---|---|---|---|
| Home feed (accounts the user follows) | **None.** No API exists. | No | The only option is reading the rendered page in the user's logged-in browser through an extension. Passive capture (no auto-scroll, no extra requests) is lowest risk for personal use. It still breaches Instagram's terms on automated collection, and it's a legal and Chrome Web Store risk if distributed. Instagram's page code changes often, so it needs maintenance. |
| Personal-account media | **None.** Basic Display API was shut down 2024-12-04. | No | There are no consumer Instagram APIs any more. |
| Own posts, captions, comments | Instagram API with Instagram Login (`graph.instagram.com`) | Only if their account is Creator or Business | Professional account plus an app token. |
| Look up other accounts by username | Business Discovery `GET /<IG_ID>?fields=business_discovery.username(<u>){followers_count,media_count,media{caption,like_count,comments_count}}` | No | Works **only with Facebook Login** (`graph.facebook.com`): the IG account must be linked to a Facebook Page. Token permissions: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`. The target must be a Business or Creator account; personal and age-gated accounts aren't returned. |
| Users send content in | **DM-share bot** (Instagram Messaging webhooks) | **Yes**: users just tap Share and send it to your account | Only the receiving account needs to be professional. Recommended product route. |

## DM-share bot details

- Webhook `messages` events carry `message.attachments[]` with types `image`, `video`, `audio`, `file`, `ig_post`, `ig_reel`, `reel` and `story_mention`. The legacy `share` type no longer arrives for posts.
- `ig_post` payload: `{ig_post_media_id, title, url}`, where `title` is the caption and `url` is a signed, expiring link to the first image. There's no author username or permalink, and a token can't look up someone else's media ID. `ig_reel` includes title, URL and video ID, according to the docs; reels haven't been tested with a real share yet.
- A photo sent directly arrives as `image` with a signed URL only.
- Limits: carousels deliver only the first image. GIFs and stickers trigger no webhook. Disappearing media arrives as `ephemeral` with no URL.
- Webhook permissions: `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata` (Facebook Login variant), or `instagram_business_basic` + `instagram_business_manage_messages` (Instagram Login). The app must be **published** to receive webhooks. Users without an app role are only delivered after **App Review** approval.
- The bot can reply within 24 hours of the user's last message.

## Reading messages: Conversations API (Instagram Login)

The host is `graph.instagram.com/v26.0`. Permissions: `instagram_business_basic` and `instagram_business_manage_messages`.

1. List conversations: `GET /me/conversations?platform=instagram` (or `/<IG_ID>/conversations`)
2. Find the conversation with one user: `GET /me/conversations?user_id=<IGSID>`
3. List message IDs: `GET /<CONVERSATION_ID>?fields=messages`
4. Read a message: `GET /<MESSAGE_ID>?fields=id,created_time,from,to,message` (try adding `attachments`; not confirmed on the doc page)

Limits:
- Only the **20 most recent** messages per conversation are readable; older ones return a "deleted" error.
- Shares give only the image or video URL via the API, so use the webhook for the caption.
- Conversations in the Requests folder that have been inactive for 30 days aren't returned.

Treat the webhook as the main way messages arrive, and use the Conversations API to catch up.

Facebook Login variant: `graph.facebook.com/v26.0/<PAGE_ID>/conversations?platform=instagram`, with a Page access token and `instagram_manage_messages`.

Source: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/conversations-api/

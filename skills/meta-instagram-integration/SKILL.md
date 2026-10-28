---
name: meta-instagram-integration
description: "Use when integrating Instagram/Meta data or DMs."
version: 1.0.0
author: Bramble
license: MIT
metadata:
  hermes:
    tags: [instagram, meta, facebook, graph-api, messaging, webhooks, social]
    related_skills: [hermes-agent, logged-in-browser-bridge]
---

# Meta / Instagram integration

This covers getting Instagram content into Autumn's projects: feeds, posts, shared posts and DMs. Autumn builds for real end users, not just herself.

## When to Use

Use when someone wants Instagram feed or post access, username lookups, a bot that receives shared posts, reading Instagram DMs, Meta webhooks, or work on the SecondBloom Meta app.

## Standing rules

- **Design for ordinary users first.** Before proposing a setup, ask whether a normal user with a personal Instagram account could use it with zero setup. Routes that need the user to switch to a Creator account, link a Facebook Page, or click through the developer dashboard and Graph Explorer are dev-only. Autumn rejects those as too complicated and not serving normal users, so lead with the user-facing option and only mention the dev-only route as an aside.
- **Check docs before claiming anything.** Meta's Instagram APIs change often, with deprecations and new attachment types. Verify with the Meta devtools MCP `devtools_discovery` (search_docs) or with `web_extract` on developers.facebook.com, and cite the doc URL in the answer.
- **Credentials:** never take access tokens or OAuth codes in chat. The user saves tokens into `$HERMES_HOME/.env` themselves.

## Procedure

1. **Clarify what "feed" means** with a single clarify call. There are three cases: (a) the home feed of accounts they follow, (b) their own posts and comments, (c) content users send in. Each has a different answer; see `references/access-routes.md`.
2. **Inventory the Meta side** with the devtools MCP (`mcp_meta_social_technologies_*`). `devtools_app_list` shows apps the user granted; Autumn has one app, SecondBloom, where she is admin. The MCP can read app settings, check app review and compliance, manage and test webhooks, and search the docs. Products, use cases and access tokens still need the user in the dashboard.
3. **Recommend the route** from the decision table. For products, the default is the **DM-share bot**: users share a post or reel to the business account, which only needs to be professional, and a messaging webhook delivers it.
4. **App Review gates outsiders.** Accounts with a role on the app (admins and testers) work without App Review. Start App Review for `instagram_business_manage_messages` (or `instagram_manage_messages` on the Facebook Login variant) well before any non-tester traffic is needed, because it can take days.
5. **Receiver infrastructure already exists.** `https://www.codepilots.co.uk/ig/webhook` goes through nginx to the `igwebhook` container in ~/secure-webserver (see the README section there; the nginx side of the build is in the `docker-webserver-deploy` skill).
   - The verify token and app secret are in `~/secure-webserver/igwebhook/secrets.env` (mode 600).
   - Raw events go to `igwebhook/data/events.jsonl`, flattened shares to `shares.jsonl`.
   - Public pages: `/secondbloom/{privacy,terms,data-deletion}.html`.
   - SecondBloom is app_id 29264663606459560, **live**. The receiving IG ID is 17841417613087488.
6. **Connect an Instagram account to the webhook in this order.** Each step is a user click unless marked. It's the order that worked end to end; walk it one step at a time.
   1. Make the receiving IG account professional (Business or Creator).
   2. Turn on IG Settings → Messages and story replies → Message controls → Connected tools → "Allow access to messages". Without it, no events arrive.
   3. Dashboard: add the "Manage messaging & content on Instagram" use case (Instagram login, no Facebook Page needed). Then "API setup with Instagram login" → Generate access tokens → Add account. The user saves the token as `IG_ACCESS_TOKEN` in `$HERMES_HOME/.env`.
   4. The user puts the Instagram app secret in the receiver's secrets.env. **Agent:** recreate the container (`docker compose up -d --no-build --force-recreate igwebhook`, in the background). Confirm the secret loaded with `docker exec igwebhook python -c "import os;print(bool(os.environ.get('IG_APP_SECRET')))"`, which doesn't print the secret.
   5. Dashboard webhook config: the callback URL, plus the verify token **read from secrets.env**. Tell the user the exact `grep IG_VERIFY_TOKEN …` command in the same message that introduces the token.
   6. Turn on the per-account **Webhook subscription** toggle under API setup. A saved callback URL alone delivers nothing.
   7. Publish the app. It needs privacy policy, terms and data deletion URLs. Meta only delivers webhooks to published apps.
   8. Ground truth: the user DMs the account from another account. **Agent:** check `docker logs igwebhook` and the nginx access log for a `POST /ig/webhook` from `facebookexternalua`. Don't rely on `devtools_webhook_list list_subscriptions`: it showed nothing while Instagram-login webhooks were in fact delivering. `devtools_webhook_test` needs the user to approve a prompt in the client.

7. **Process media as soon as it arrives.** Download each attachment `url` straight away into `igwebhook/data/media/`, because the signed links are temporary. Image analysis (outfit description) runs on the local file with `vision_analyze`. For outfits, give the pieces as base / layer / accessory, the colour links between pieces (which colours repeat across which pieces), and a list of style keywords. That's the record downstream matching uses; see the boutique/outfit rules in memory. Note when only part of the outfit is visible, and never identify the person.

## Pitfalls

- **Verify-token mismatch:** if the dashboard says "callback URL or verify token couldn't be validated", nginx shows Meta's GET returned 403. The user typed their own token instead of the one in secrets.env. Diagnose by comparing the logged token length with the expected length (redact the token in any output), then give the user the grep command.
- **Webhook POSTs rejected after the secret is added:** the container still has its old environment, because env_file is only read when the container is created. Force-recreate it.
- **Send replies from a script that reads the token from `.env`**, never with the token on a curl command line where it shows in process listings and the transcript. Use `urllib`: POST `https://graph.instagram.com/v26.0/me/messages` with the Bearer header and body `{"recipient":{"id":IGSID},"message":{"text":...}}`; it returns `{recipient_id, message_id}`. Replies are only allowed within 24 hours of the user's last message, and each reply comes back to the webhook as an `is_echo` event, which must be skipped.
- **Real payloads, verified 14 Oct 2026 on SecondBloom.**
  - A shared post arrives as one attachment: `{"type":"ig_post","payload":{"ig_post_media_id","title","url"}}`. `title` is the caption and `url` is the image on `lookaside.fbsbx.com/ig_messaging_cdn/` (signed).
  - There is no legacy `share` attachment any more.
  - The payload has no author username or permalink.
  - A photo sent directly arrives as `{"type":"image","payload":{"url"}}`. The file can be a PNG even though it's served as image/jpeg.
  - Both signed URLs downloaded fine without a token at once. Save media on arrival rather than relying on the URL later.
  - Our own sent messages come back as echoes with `is_echo: true`.
- Pass `max_results` ≤3 to `devtools_discovery` searches. Results include whole page boilerplate, and 5 results can be about 80KB and spill to disk.
- Meta's doc samples write `&fields=` straight after the node ID. As the first parameter it has to be `?fields=`, or the request fails.
- An Instagram login through a Facebook OAuth redirect appends `#_=_`. Strip URL fragments before parsing any pasted redirect.

## Meta Model API (Muse / SAM). This is not the Graph API.

- **Key and endpoint:** use `MODEL_API_KEY` from `$HERMES_HOME/.env`; `MUSE_API_KEY` is also set. The base URL is `https://api.meta.ai/v1` and the API is OpenAI-compatible. `GET /v1/models` on this key lists `muse-image-1.0`, `sam-3.1`, `muse-spark-1.1..1.3`, `muse-wonder-1.0` and `muse-voice-transcribe-1.0`.
- **Muse Image:** call `POST /v1/images/generations` or `/v1/images/edits` for one-off images; use the Responses API for editing over several turns. It costs $0.01 per image.
- **SAM 3.1:** call `POST /v1/responses` with model `sam-3.1`. The input is a short noun phrase (`input_text`) plus `input_image`, and `stream:true` is required. The output is special-token text containing boxes and masks; see dev.meta.ai/docs/sam/reading-segmentation. Send one object type per request. It costs $2.50 per 1,000 images.
- **Quota (verified 14 Oct 2026):** the key is on a subscription with a rolling usage window. When the quota is used up, Spark returns 429 with "Subscription quota exhausted… resets at <time>" and a `resets_at` field. SAM returns 429 with only "Service temporarily unavailable" for the same cause. Probe with a tiny Spark call to read the reset time, and don't retry in a loop. Hermes' own chat on the meta-ai provider uses the same quota.

## References

- `references/access-routes.md`: decision table (home feed, own media, username lookup, DM share, extension), and the Messaging webhook and Conversations API endpoints and limits.

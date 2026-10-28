"use strict";
/* meta-styles Milestone 9 — NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * This module REPLACES the Milestone 5 fixture-only bridge with a client for
 * the local Instagram bot read API documented in docs/instagram-bot-api.md.
 * That bot API itself is PRIOR WORK: it was built and deployed by Autumn on
 * the separate SecondBloom `igwebhook` service (see
 * docs/prior-work-instagram.md) and is only *called* from here — none of the
 * bot's internal implementation is restated or vendored in this file.
 *
 * Endpoints used (all on the bot, local-only):
 *   GET    http://127.0.0.1:8903/ig/shares?since=<cursor>&limit=<n>
 *   GET    http://127.0.0.1:8903/ig/media/<media_id>   -> image bytes
 *   DELETE http://127.0.0.1:8903/ig/media/<media_id>   -> 204 (see below)
 *
 * DELETE is called ONLY after the image bytes are in hand AND handed to the
 * pipeline (after a successful GET /ig/media/<id> + loadImage() call), never
 * before. Items with media_available:false are shown as not-yet-ready with no
 * "Use this photo" button — no GET is attempted for them.
 *
 * AUTH / TOKEN — how Autumn supplies the real credential at runtime:
 *   Expected file: app/ig-bot-token.local.json (untracked, gitignored),
 *   format: { "token": "<bot-issued bearer token>" }
 *   (the keys "ig_bot_token" / "igBotToken" are accepted as aliases).
 *   The client sends `Authorization: Bearer <token>` on every bot call.
 *   If that file 404s (e.g. not yet dropped in), the client falls back to a
 *   token previously saved via the "Set bot token" button (localStorage key
 *   "igBotToken"). No token is ever hardcoded here and .env/secrets is never
 *   read — this is a static browser app with no server/build step, so there
 *   is no process.env to read from.
 *
 * OFFLINE FALLBACK: the live bot only answers on Autumn's machine (local-only
 * bind at 127.0.0.1:8903). Anywhere else — including a judge's browser — the
 * fetch fails / is blocked by CORS, and the client falls back to the
 * Milestone 5 synthetic fixture file inbox-fixtures/shares.jsonl, saying so
 * plainly in #inboxStatus. That tradeoff is intentional per project
 * conventions: fixture demo everywhere, live DMs only where the bot runs.
 *
 * Picking an inbox entry feeds the existing loadImage(src, id, caption) path
 * in app.js, so the mask-viewer / classifier / assembler pipeline downstream
 * is unchanged.
 */

(function () {
  // Milestone 13: default backend is the local mock bot (zero Instagram
  // dependency demo path). To switch to the real Instagram bot on Autumn's
  // machine, change this one line back to "http://127.0.0.1:8903" — both
  // backends implement the identical contract, so nothing else in this file
  // needs to change. There is deliberately no query-param override.
  var BOT_BASE = "http://127.0.0.1:8904";
  var TOKEN_URL = "ig-bot-token.local.json";
  var TOKEN_STORAGE_KEY = "igBotToken";
  var FIXTURE_URL = "inbox-fixtures/shares.jsonl";
  var PAGE_LIMIT = 20;
  var MAX_PAGES_PER_LOAD = 5;
  var RETRY_FIRST_MS = 30000;
  var RETRY_LATER_MS = 5 * 60 * 1000;

  // Panel state.
  var opened = false;      // panel has been opened at least once
  var loading = false;     // a load is in flight
  var lastGood = [];       // last successfully rendered entries (kept on error)
  var lastSource = "";     // "live" | "fixture"
  var cursor = null;       // opaque bot cursor (next_cursor of last page)
  var retryTimer = null;
  var backoffMs = RETRY_FIRST_MS;

  // ---------------------------------------------------------------------------
  // Pure helpers (also exported for Node vm self-tests; no DOM/fetch touched).
  // ---------------------------------------------------------------------------

  function captionFor(entry) {
    if (entry.caption) return entry.caption;
    var payload = (entry.attachment && entry.attachment.payload) || {};
    if (payload.title) return payload.title;
    return entry.id || "Untitled share";
  }

  function kindFor(entry) {
    var t = entry.attachment && entry.attachment.type;
    if (t === "ig_post") return "shared post/reel";
    if (t === "image") return "direct photo";
    return "share";
  }

  // Shape check for one element of GET /ig/shares `items[]` (or one fixture
  // JSON line). Accepts the two real attachment shapes; requires a media
  // locator of either the live form (media_id) or the fixture form
  // (media_file). Never throws.
  function isValidShareItem(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (typeof entry.id !== "string" || !entry.id) return false;
    var att = entry.attachment;
    if (!att || typeof att !== "object") return false;
    if (att.type === "ig_post") {
      var p = att.payload;
      if (!p || typeof p !== "object") return false;
      if (typeof p.ig_post_media_id !== "string" || !p.ig_post_media_id) return false;
    } else if (att.type === "image") {
      var q = att.payload;
      if (!q || typeof q !== "object") return false;
      if (typeof q.url !== "string" || !q.url) return false;
    } else {
      return false;
    }
    var hasLiveMedia = typeof entry.media_id === "string" && !!entry.media_id;
    var hasFixtureMedia = typeof entry.media_file === "string" && !!entry.media_file;
    if (!hasLiveMedia && !hasFixtureMedia) return false;
    if ("media_available" in entry && typeof entry.media_available !== "boolean") return false;
    return true;
  }

  // Parse newline-delimited JSON; skip blank / malformed / wrong-shape lines.
  function parseJsonLines(text) {
    var entries = [];
    var lines = String(text).split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      try {
        var entry = JSON.parse(line);
        if (isValidShareItem(entry)) entries.push(entry);
      } catch (err) {
        // Skip malformed lines — one bad row must not break the list.
        continue;
      }
    }
    return entries;
  }

  function buildSharesUrl(since, limit) {
    var url = "/ig/shares?limit=" + encodeURIComponent(String(limit));
    if (since !== null && since !== undefined && since !== "") {
      url += "&since=" + encodeURIComponent(String(since));
    }
    return url;
  }

  var InboxBridgePure = {
    captionFor: captionFor,
    kindFor: kindFor,
    isValidShareItem: isValidShareItem,
    parseJsonLines: parseJsonLines,
    buildSharesUrl: buildSharesUrl,
  };
  if (typeof globalThis !== "undefined") globalThis.InboxBridge = InboxBridgePure;
  if (typeof module !== "undefined" && module.exports) module.exports = InboxBridgePure;

  // ---------------------------------------------------------------------------
  // Browser-only wiring below (guarded so Node's vm can load the pure part).
  // ---------------------------------------------------------------------------
  if (typeof document === "undefined" || typeof fetch === "undefined") return;

  function statusEl() {
    return document.getElementById("inboxStatus");
  }

  function setStatus(text) {
    var el = statusEl();
    if (el) el.textContent = text;
  }

  function authHeaders(token) {
    return { Authorization: "Bearer " + token };
  }

  // Resolve the bot credential: untracked local file first, then the
  // localStorage fallback. Resolves to the token string or null.
  function loadToken() {
    return fetch(TOKEN_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("no token file");
        return res.json();
      })
      .then(function (obj) {
        var t = obj && (obj.token || obj.ig_bot_token || obj.igBotToken);
        return typeof t === "string" && t ? t : null;
      })
      .catch(function () {
        try {
          var saved = window.localStorage.getItem(TOKEN_STORAGE_KEY);
          return typeof saved === "string" && saved ? saved : null;
        } catch (err) {
          return null;
        }
      });
  }

  function promptForToken() {
    var t = window.prompt(
      "Paste the Instagram bot Bearer token (stored only in this browser's " +
      "localStorage; prefer app/ig-bot-token.local.json for persistence):"
    );
    if (t && t.trim()) {
      try {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, t.trim());
      } catch (err) {
        /* storage unavailable — still use it for this session */
      }
      return t.trim();
    }
    return null;
  }

  function botGet(path, token) {
    return fetch(BOT_BASE + path, { headers: authHeaders(token) });
  }

  // Fetch one shares page. Resolves { items, nextCursor } with malformed
  // items skipped. Rejects with an Error carrying .kind: "auth" | "badCursor"
  // | "unreachable" | "http".
  function fetchSharesPage(since, token) {
    return botGet(buildSharesUrl(since, PAGE_LIMIT), token).then(
      function (res) {
        if (res.status === 401 || res.status === 403) {
          var e1 = new Error("check bot credential (HTTP " + res.status + ")");
          e1.kind = "auth";
          throw e1;
        }
        if (res.status === 400) {
          var e2 = new Error("bad cursor");
          e2.kind = "badCursor";
          throw e2;
        }
        if (!res.ok) {
          var e3 = new Error("bot HTTP " + res.status);
          e3.kind = "http";
          throw e3;
        }
        return res.json();
      },
      function () {
        var e4 = new Error("bot unreachable");
        e4.kind = "unreachable";
        throw e4;
      }
    ).then(function (body) {
      var raw = body && Array.isArray(body.items) ? body.items : [];
      var items = raw.filter(isValidShareItem);
      var nextCursor =
        body && typeof body.next_cursor === "string" ? body.next_cursor : null;
      return { items: items, nextCursor: nextCursor };
    });
  }

  // Follow next_cursor for a few pages (stops on empty page / missing cursor).
  // On a 400 mid-walk, drops the cursor and refetches once from the start.
  function fetchAllShares(token) {
    var all = [];
    var seenPages = 0;
    var retriedFromStart = false;

    function walk(since) {
      return fetchSharesPage(since, token).then(function (page) {
        all = all.concat(page.items);
        seenPages++;
        if (
          page.items.length === 0 ||
          page.nextCursor === null ||
          seenPages >= MAX_PAGES_PER_LOAD
        ) {
          return { items: all, nextCursor: page.nextCursor };
        }
        return walk(page.nextCursor);
      });
    }

    return walk(null).catch(function (err) {
      if (err && err.kind === "badCursor" && !retriedFromStart) {
        retriedFromStart = true;
        all = [];
        seenPages = 0;
        return walk(null);
      }
      throw err;
    });
  }

  function loadFixtureFallback(reasonNote) {
    return fetch(FIXTURE_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (text) {
        var entries = parseJsonLines(text);
        lastGood = entries;
        lastSource = "fixture";
        renderList(entries, "fixture");
        var note = entries.length + " fixture entr" +
          (entries.length === 1 ? "y" : "ies") +
          " — synthetic demo data, not real DMs.";
        setStatus(
          (reasonNote ? reasonNote + " " : "") +
          "Showing offline demo fixtures instead (" + FIXTURE_URL + "): " + note +
          " The live bot path only works on Autumn's machine (local-only API)."
        );
      })
      .catch(function (err) {
        setStatus(
          (reasonNote ? reasonNote + " " : "") +
          "Could not load " + FIXTURE_URL + " (" + err.message + "). " +
          "Serve app/ over HTTP to use the inbox bridge."
        );
      });
  }

  function scheduleRetry(token) {
    if (retryTimer) return;
    var wait = backoffMs;
    backoffMs = RETRY_LATER_MS; // 30s first, then 5min
    retryTimer = setTimeout(function () {
      retryTimer = null;
      var panel = document.getElementById("inboxPanel");
      if (panel && panel.hidden) return; // user closed it; stop retrying
      refreshLive(token, true);
    }, wait);
  }

  function refreshLive(token, isRetry) {
    if (!token) {
      loadFixtureFallback(
        "No bot token found (expected app/ig-bot-token.local.json or a saved " +
        "browser token)."
      );
      return;
    }
    if (!isRetry) setStatus("Contacting local Instagram bot…");
    fetchAllShares(token).then(
      function (result) {
        backoffMs = RETRY_FIRST_MS;
        lastGood = result.items;
        lastSource = "live";
        cursor = result.nextCursor;
        renderList(result.items, "live", token);
        setStatus(
          result.items.length === 0
            ? "Live bot: no new shares. Cursor " +
              (result.nextCursor === null ? "(none)" : result.nextCursor) + "."
            : "Live bot: " + result.items.length + " share" +
              (result.items.length === 1 ? "" : "s") + "."
        );
      },
      function (err) {
        if (err && err.kind === "auth") {
          setStatus(
            "Live bot rejected our credential (HTTP 401/403) — check bot " +
            "credential, not retrying. " +
            (lastGood.length
              ? "Keeping the last good list below."
              : "Falling back to demo fixtures:") + " "
          );
          if (!lastGood.length || lastSource === "fixture") {
            loadFixtureFallback("");
          }
          return; // no retry loop on auth errors
        }
        if (err && err.kind === "unreachable") {
          if (lastGood.length) {
            setStatus(
              "Bot unavailable (offline or unreachable from this browser) — " +
              "keeping the last good list. Retrying in the background."
            );
          } else {
            loadFixtureFallback(
              "Bot unavailable (offline or unreachable from this browser)."
            );
          }
          scheduleRetry(token);
          return;
        }
        // Other HTTP errors: keep last good list, report plainly.
        setStatus(
          "Bot error (" + (err && err.message ? err.message : err) + ") — " +
          (lastGood.length
            ? "keeping the last good list."
            : "falling back to demo fixtures.")
        );
        if (!lastGood.length) loadFixtureFallback("");
      }
    );
  }

  // GET /ig/media/<id> -> Blob -> object URL usable as <img> src and as the
  // loadImage() source. Rejects on non-200 (e.g. 404 after collection).
  function fetchMediaObjectURL(item, token) {
    return botGet("/ig/media/" + encodeURIComponent(item.media_id), token).then(
      function (res) {
        if (!res.ok) throw new Error("media HTTP " + res.status);
        return res.blob();
      },
      function () {
        throw new Error("bot unreachable during media fetch");
      }
    ).then(function (blob) {
      return URL.createObjectURL(blob);
    });
  }

  // Collect-then-delete acknowledgement: ONLY after the bytes are in hand and
  // handed to the pipeline. Failures are reported but never break the UI.
  function acknowledgeMedia(item, token) {
    fetch(BOT_BASE + "/ig/media/" + encodeURIComponent(item.media_id), {
      method: "DELETE",
      headers: authHeaders(token),
    }).then(
      function (res) {
        if (res.status !== 204) {
          setStatus(
            "Photo loaded, but the bot did not confirm collection " +
            "(DELETE HTTP " + res.status + "). It may offer the same photo again."
          );
        }
      },
      function () {
        /* acknowledgement is best-effort; the photo is already loaded */
      }
    );
  }

  function ensureControls(tokenHolder) {
    var panel = document.getElementById("inboxPanel");
    if (!panel || document.getElementById("inboxControls")) return;
    var row = document.createElement("div");
    row.className = "row";
    row.id = "inboxControls";

    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ghost small";
    retry.textContent = "Retry live bot";
    retry.addEventListener("click", function () {
      if (loading) return;
      loading = true;
      loadToken().then(function (t) {
        loading = false;
        if (t) {
          tokenHolder.token = t;
          refreshLive(t, false);
        } else {
          loadFixtureFallback("Still no bot token found.");
        }
      });
    });

    var setToken = document.createElement("button");
    setToken.type = "button";
    setToken.className = "ghost small";
    setToken.textContent = "Set bot token";
    setToken.addEventListener("click", function () {
      var t = promptForToken();
      if (t) {
        tokenHolder.token = t;
        refreshLive(t, false);
      }
    });

    row.appendChild(retry);
    row.appendChild(setToken);
    var status = document.getElementById("inboxStatus");
    panel.insertBefore(row, status);
  }

  function renderList(entries, source, token) {
    var list = document.getElementById("inboxList");
    list.innerHTML = "";
    if (entries.length === 0) {
      if (source === "live") {
        setStatus("Live bot: no shares yet. New DMs will appear here.");
      }
      return;
    }
    entries.forEach(function (entry) {
      var item = document.createElement("div");
      item.className = "wardrobe-item";

      var thumb = document.createElement("img");
      thumb.alt = "";
      item.appendChild(thumb);

      var label = document.createElement("div");
      var caption = document.createElement("strong");
      caption.textContent = captionFor(entry);
      label.appendChild(caption);
      var meta = document.createElement("span");
      meta.className = "hint";
      meta.textContent = entry.id + " · " + kindFor(entry);
      label.appendChild(document.createElement("br"));
      label.appendChild(meta);
      item.appendChild(label);

      if (source === "fixture") {
        thumb.src = "inbox-fixtures/" + entry.media_file;
        var useFixture = document.createElement("button");
        useFixture.type = "button";
        useFixture.className = "ghost small";
        useFixture.textContent = "Use this photo";
        (function (e) {
          useFixture.addEventListener("click", function () {
            // Same entry point as the upload and demo-picker paths in app.js.
            if (typeof loadImage === "function") {
              loadImage(
                "inbox-fixtures/" + e.media_file,
                e.id,
                captionFor(e)
              );
            }
          });
        })(entry);
        item.appendChild(useFixture);
      } else {
        // Live item: media may not be ready yet.
        if (entry.media_available === false || !entry.media_id) {
          meta.textContent += " · not yet ready (photo still downloading on the bot)";
          var pending = document.createElement("span");
          pending.className = "hint";
          pending.textContent = "Photo not yet ready — no action until the bot finishes downloading it.";
          item.appendChild(pending);
        } else {
          meta.textContent += " · live from bot";
          thumb.alt = captionFor(entry);
          // Prefetch bytes for the thumbnail; the object URL is reused by
          // the "Use this photo" button below.
          fetchMediaObjectURL(entry, token).then(
            function (url) {
              entry._objectURL = url;
              thumb.src = url;
            },
            function () {
              meta.textContent += " · photo fetch failed (will retry on use)";
            }
          );
          var useLive = document.createElement("button");
          useLive.type = "button";
          useLive.className = "ghost small";
          useLive.textContent = "Use this photo";
          (function (e, imgEl, btn) {
            btn.addEventListener("click", function () {
              if (typeof loadImage !== "function") return;
              btn.disabled = true;
              btn.textContent = "Loading photo…";
              var ready = e._objectURL
                ? Promise.resolve(e._objectURL)
                : fetchMediaObjectURL(e, token).then(function (url) {
                    e._objectURL = url;
                    imgEl.src = url;
                    return url;
                  });
              ready.then(
                function (url) {
                  // Bytes are in hand and now used by the pipeline — only
                  // now acknowledge collection so the bot deletes its copy.
                  loadImage(url, e.id, captionFor(e));
                  acknowledgeMedia(e, token);
                  btn.textContent = "Loaded ✓";
                },
                function (err) {
                  btn.disabled = false;
                  btn.textContent = "Use this photo";
                  setStatus("Could not fetch photo for " + e.id +
                    " (" + err.message + ").");
                }
              );
            });
          })(entry, thumb, useLive);
          item.appendChild(useLive);
        }
      }

      list.appendChild(item);
    });
  }

  var tokenHolder = { token: null };

  function loadInbox() {
    var panel = document.getElementById("inboxPanel");
    var btn = document.getElementById("inboxToggleBtn");
    var open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (!open) return;
    ensureControls(tokenHolder);
    if (!opened) {
      opened = true;
      loading = true;
      setStatus("Loading inbox… (trying live bot, demo fixtures as fallback)");
      loadToken().then(function (t) {
        loading = false;
        tokenHolder.token = t;
        if (t) refreshLive(t, false);
        else loadFixtureFallback("No bot token found — this browser is not on the bot's machine or no token was supplied.");
      });
    }
  }

  document
    .getElementById("inboxToggleBtn")
    .addEventListener("click", loadInbox);
})();

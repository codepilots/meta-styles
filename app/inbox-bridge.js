"use strict";
/* meta-styles Milestone 5 — DM-share inbox bridge.
 *
 * SYNTHETIC FIXTURES ONLY — NOT REAL INSTAGRAM DATA. This bridge currently
 * reads the locally created demo file `inbox-fixtures/shares.jsonl` plus the
 * placeholder SVGs next to it. Every id, url, and caption in those fixtures
 * was invented for demo/testing and matches the real SecondBloom payload
 * shape (ig_post attachments carry ig_post_media_id/title/url; directly-sent
 * photos carry image/url) without copying any real captured data.
 *
 * NOT A LIVE WEBHOOK: nothing here connects to the SecondBloom receiver.
 * Wiring this to the real SecondBloom shares.jsonl/media output is future
 * work (not in scope) — and when it happens it must only ever be wired at
 * runtime from a path Autumn configures, never by vendoring real
 * SecondBloom data into this repo.
 *
 * The bridge is an alternate photo source next to the existing in-app upload
 * and the 3 demo SVGs — not a replacement. Picking an inbox entry feeds the
 * existing loadImage() path in app.js, so the mask-viewer / classifier /
 * assembler pipeline downstream is unchanged.
 */

(function () {
  var FIXTURE_URL = "inbox-fixtures/shares.jsonl";
  var loaded = false;
  var loading = false;

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

  function parseJsonLines(text) {
    var entries = [];
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      try {
        var entry = JSON.parse(line);
        if (entry && entry.id && entry.media_file) entries.push(entry);
      } catch (err) {
        // Skip malformed lines — one bad fixture row must not break the list.
        continue;
      }
    }
    return entries;
  }

  function renderList(entries) {
    var list = document.getElementById("inboxList");
    var status = document.getElementById("inboxStatus");
    list.innerHTML = "";
    if (entries.length === 0) {
      status.textContent = "No inbox entries found in the local fixture file.";
      return;
    }
    status.textContent =
      entries.length + " fixture entr" +
      (entries.length === 1 ? "y" : "ies") +
      " — synthetic demo data, not real DMs.";
    entries.forEach(function (entry) {
      var item = document.createElement("div");
      item.className = "wardrobe-item";

      var thumb = document.createElement("img");
      thumb.src = "inbox-fixtures/" + entry.media_file;
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

      var use = document.createElement("button");
      use.type = "button";
      use.className = "ghost small";
      use.textContent = "Use this photo";
      use.addEventListener("click", function () {
        // Same entry point as the upload and demo-picker paths in app.js.
        if (typeof loadImage === "function") {
          loadImage(
            "inbox-fixtures/" + entry.media_file,
            entry.id,
            captionFor(entry)
          );
        }
      });
      item.appendChild(use);

      list.appendChild(item);
    });
  }

  function loadInbox() {
    var panel = document.getElementById("inboxPanel");
    var btn = document.getElementById("inboxToggleBtn");
    var open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (!open || loaded || loading) return;
    loading = true;
    var status = document.getElementById("inboxStatus");
    status.textContent = "Loading local fixture file…";
    fetch(FIXTURE_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (text) {
        loaded = true;
        loading = false;
        renderList(parseJsonLines(text));
      })
      .catch(function (err) {
        loading = false;
        // file:// serves have no fetch: the fixtures need `python3 -m
        // http.server` from app/ (see README). Say so plainly.
        status.textContent =
          "Could not load " + FIXTURE_URL + " (" + err.message + "). " +
          "Serve app/ over HTTP to use the inbox bridge.";
      });
  }

  document
    .getElementById("inboxToggleBtn")
    .addEventListener("click", loadInbox);
})();

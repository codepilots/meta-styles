"use strict";
/* meta-styles Milestone 14 — browser client for the Meta Model API proxy.
 *
 * The browser never sees the Meta API key: it calls the local proxy in
 * meta-api-proxy/ (default http://127.0.0.1:8905), which holds the key
 * server-side. Every function throws on proxy/API failure so callers can
 * fall back to their labelled stubs (placeholder:true) — live success is
 * the only path that returns placeholder:false.
 *
 * Cached/offline mode (M14f): successful segment/copy results are cached
 * in localStorage keyed by a content hash and returned with cached:true
 * when the proxy is unreachable, so a rehearsed demo survives an outage.
 * Preview images are cached in-memory only (too large for localStorage).
 */
(function (root) {
  var PROXY_BASE = "http://127.0.0.1:8905";
  var memCache = {};

  function fnv(str) {
    var h = 0x811c9dc5;
    var s = String(str);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  function cardSignature(card) {
    var pieces = ((card && card.pieces) || []).map(function (p) { return p.id + ":" + p.category; }).join(",");
    return fnv(pieces + "|" + ((card && card.finish) || ""));
  }

  function lsGet(key) {
    try {
      var raw = root.localStorage && root.localStorage.getItem("metaStylesCache:" + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try {
      if (root.localStorage) root.localStorage.setItem("metaStylesCache:" + key, JSON.stringify(value));
    } catch (e) { /* quota / unavailable — cache is best-effort */ }
  }

  function post(path, body, timeoutMs) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 120000) : null;
    return fetch(PROXY_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (timer) clearTimeout(timer);
        if (!res.ok) {
          var err = new Error("proxy HTTP " + res.status + (json && json.error ? ": " + json.error : ""));
          err.status = res.status; err.body = json;
          throw err;
        }
        return json;
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function health() {
    return fetch(PROXY_BASE + "/health").then(function (res) {
      if (!res.ok) throw new Error("proxy HTTP " + res.status);
      return res.json();
    });
  }

  function segment(imageDataUrl, phrases) {
    var key = "segment:" + fnv(imageDataUrl.slice(0, 2048) + "|" + imageDataUrl.length + "|" + (phrases || []).join(","));
    return post("/api/segment", { image: imageDataUrl, phrases: phrases }, 180000).then(function (out) {
      lsSet(key, out);
      return out;
    }, function (err) {
      var cached = lsGet(key);
      if (cached) return Object.assign({}, cached, { cached: true });
      throw err;
    });
  }

  function classify(imageDataUrl, labelHint) {
    return post("/api/classify", { image: imageDataUrl, labelHint: labelHint || "" }, 60000);
  }

  function copy(lookCard) {
    var key = "copy:" + cardSignature(lookCard);
    var body = {
      pieces: ((lookCard && lookCard.pieces) || []).map(function (p) { return { id: p.id, category: p.category }; }),
      finish: (lookCard && lookCard.finish) || null,
      fitNote: (lookCard && lookCard.fitNote) || "",
    };
    return post("/api/copy", body, 60000).then(function (out) {
      lsSet(key, out);
      return out;
    }, function (err) {
      var cached = lsGet(key);
      if (cached) return Object.assign({}, cached, { cached: true });
      throw err;
    });
  }

  function assemble(pieces) {
    return post("/api/assemble", {
      pieces: (pieces || []).map(function (p) { return { id: p.id, category: p.category }; }),
    }, 60000);
  }

  function preview(prompt, imageDataUrl) {
    var key = "preview:" + fnv(prompt + "|" + (imageDataUrl ? imageDataUrl.length : 0));
    if (memCache[key]) return Promise.resolve(Object.assign({}, memCache[key], { cached: true }));
    return post("/api/preview", { prompt: prompt, image: imageDataUrl || null }, 120000).then(function (out) {
      memCache[key] = out;
      return out;
    });
  }

  var client = {
    PROXY_BASE: PROXY_BASE,
    health: health, segment: segment, classify: classify,
    copy: copy, assemble: assemble, preview: preview,
    cardSignature: cardSignature,
  };

  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.metaClient = client;
  if (typeof module !== "undefined" && module.exports) module.exports = client;
})(typeof globalThis !== "undefined" ? globalThis : this);

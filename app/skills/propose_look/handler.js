"use strict";
/* meta-styles Milestone 21 — skill: propose_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * Server-side Spark look choice (no browser global required):
 *  1. Read live pieces from the injected catalog (piece IDs + category only;
 *     no bearer tokens, no raw platform IDs in the Spark prompt or reply).
 *  2. Ask Spark (metaClient.assemble) for JSON {looks:[{pieceIds,rationale}]}
 *     constrained to the available pieces, best first.
 *  3. Validate Spark output locally before replying: every ID must exist,
 *     no repeats, valid outfit shape (assembler rules + no duplicate
 *     category/piece, never all pieces by default).
 *  4. Spark failure / invalid output / no valid look -> deterministic local
 *     assembler fallback, and honest text when nothing validates.
 *  5. Preview (metaClient.preview) only after a validated look; honours the
 *     proxy's actual return shape ({dataURL}, not url). When the service
 *     passes shareId + stageImage (either mode — mock stages via
 *     /mock/stage-outbound-image, live via /ig/outbound-stage), the
 *     dataURL is staged for a real send-with-image and delivered flips
 *     true with no caveat; otherwise sends stay text-only and
 *     result.meta.imageDelivery reports that truthfully — never an
 *     example.invalid URL in reply text. Staged-for-send is not
 *     delivered: only the bot's image_message_id on the later send
 *     counts as delivery (the service layer enforces that).
 */
(function (root) {

  var BASE_CATS = ["base/top", "base/bottom", "dress"];
  var LAYER_CATS = ["layer/cardigan", "layer/blazer"];

  function plainNoun(c) {
    var m = {
      "base/top": "top", "base/bottom": "bottom", "dress": "dress",
      "layer/cardigan": "cardigan", "layer/blazer": "blazer",
      "scarf": "scarf", "bag": "bag", "shoes": "shoes"
    };
    return m[c] || "piece";
  }

  // Server-side assembler, in preference order: injected opt -> Node require
  // -> browser global. Never assumes the browser global exists.
  function getAssembleLook(opts) {
    if (opts && typeof opts.assembler === "function") return opts.assembler;
    if (opts && opts.assembler && typeof opts.assembler.assembleLook === "function") {
      return opts.assembler.assembleLook;
    }
    try {
      if (typeof require !== "undefined") {
        var m = require("../../assembler.js");
        if (m && typeof m.assembleLook === "function") return m.assembleLook;
      }
    } catch (e) { /* fall through to global */ }
    try {
      if (root.MetaStyles && typeof root.MetaStyles.assembleLook === "function") {
        return root.MetaStyles.assembleLook;
      }
    } catch (e2) { /* none available */ }
    return null;
  }

  function byIdMap(active) {
    var map = {};
    active.forEach(function (p) { map[p.piece_id] = p; });
    return map;
  }

  // Strict outfit-shape check (mirrors assembler.js fit rules, plus the
  // skill's stricter no-duplicate-category/piece and never-all-pieces rules).
  // items: [{id, category}]. Returns null when the shape is fine, else a
  // short machine reason code.
  function strictShape(items, activeLength) {
    var cats = items.map(function (it) { return it.category; });
    var i;
    var seenCat = {};
    for (i = 0; i < cats.length; i++) {
      if (cats[i] === "shoes" || /shoe/i.test(cats[i])) return "shoes_excluded";
      if (seenCat[cats[i]]) return "duplicate_category";
      seenCat[cats[i]] = true;
    }
    var bases = items.filter(function (it) { return BASE_CATS.indexOf(it.category) !== -1; });
    if (bases.length === 0) return "missing_base";
    var dresses = bases.filter(function (b) { return b.category === "dress"; });
    if (dresses.length > 0 && bases.length > 1) return "dress_plus_separates";
    var layers = items.filter(function (it) { return LAYER_CATS.indexOf(it.category) !== -1; });
    if (layers.length >= 2) return "two_layers";
    var scarves = items.filter(function (it) { return it.category === "scarf"; });
    var bags = items.filter(function (it) { return it.category === "bag"; });
    var hasLayerFinish = layers.length === 1;
    var hasScarf = scarves.length >= 1;
    var hasBag = bags.length >= 1;
    var hasScarfBagFinish = hasScarf && hasBag;
    if (hasLayerFinish && hasScarfBagFinish) return "two_finishes";
    if (hasLayerFinish && (hasScarf || hasBag)) return "stray_accessory_with_layer";
    if (!hasLayerFinish && !hasScarf && !hasBag) return "missing_finish";
    // A valid strict-shape look is at most 4 pieces (base pair + scarf + bag),
    // so covering a bigger wardrobe wholesale is never a choice — while a
    // small wardrobe (<=4) may genuinely wear all of itself.
    if (items.length === activeLength && activeLength > 4) return "all_pieces";
    return null;
  }

  // Validate one Spark-proposed ID list against the live catalog.
  // Returns {ok, items, reason} where items are assembler-ready.
  function validateSelection(active, selIds, assembleLook) {
    if (!Array.isArray(selIds) || selIds.length === 0) {
      return { ok: false, reason: "empty_selection" };
    }
    var map = byIdMap(active);
    var seen = {};
    var i;
    for (i = 0; i < selIds.length; i++) {
      var id = selIds[i];
      if (typeof id !== "string" || !map[id]) return { ok: false, reason: "unknown_piece" };
      if (seen[id]) return { ok: false, reason: "repeated_piece" };
      seen[id] = true;
    }
    var items = selIds.map(function (pid) {
      var p = map[pid];
      return {
        id: pid,
        category: p.category,
        copy: { text: "SYNTH " + p.category, placeholder: true, note: "propose_look validation input" }
      };
    });
    var shapeReason = strictShape(items, active.length);
    if (shapeReason) return { ok: false, reason: shapeReason };
    if (typeof assembleLook === "function") {
      var card;
      try {
        card = assembleLook(items);
      } catch (e) {
        return { ok: false, reason: "assembler_error" };
      }
      if (!card || card.valid !== true) {
        return { ok: false, reason: "fit_invalid" };
      }
      return { ok: true, items: items, card: card };
    }
    return { ok: true, items: items, card: null };
  }

  // Deterministic local fallback: enumerate base x finish combos in fixed
  // order (dresses first, then tops/bottoms; layers, then scarf+bag pairs,
  // then a lone scarf, then a lone bag) and return the first candidate
  // that validates. Richer finishes (layer, scarf+bag) come before lone
  // accessories, so wardrobes that validated before produce the same look.
  // Small valid subsets come out before larger ones by construction —
  // never all pieces by default.
  function fallbackChoose(active, assembleLook) {
    var dresses = active.filter(function (p) { return p.category === "dress"; });
    var tops = active.filter(function (p) { return p.category === "base/top"; });
    var bottoms = active.filter(function (p) { return p.category === "base/bottom"; });
    var layers = active.filter(function (p) { return LAYER_CATS.indexOf(p.category) !== -1; });
    var scarves = active.filter(function (p) { return p.category === "scarf"; });
    var bags = active.filter(function (p) { return p.category === "bag"; });

    var baseOptions = [];
    dresses.forEach(function (d) { baseOptions.push([d]); });
    tops.forEach(function (t) {
      bottoms.forEach(function (b) { baseOptions.push([t, b]); });
    });
    tops.forEach(function (t) { baseOptions.push([t]); });
    bottoms.forEach(function (b) { baseOptions.push([b]); });

    var finishOptions = [];
    layers.forEach(function (l) { finishOptions.push([l]); });
    scarves.forEach(function (s) {
      bags.forEach(function (b) { finishOptions.push([s, b]); });
    });
    scarves.forEach(function (s) { finishOptions.push([s]); });
    bags.forEach(function (b) { finishOptions.push([b]); });

    var rejected = "no_valid_combination";
    for (var bi = 0; bi < baseOptions.length; bi++) {
      for (var fi = 0; fi < finishOptions.length; fi++) {
        var combo = baseOptions[bi].concat(finishOptions[fi]);
        var ids = combo.map(function (p) { return p.piece_id; });
        var checked = validateSelection(active, ids, assembleLook);
        if (checked.ok) return { items: checked.items, card: checked.card };
        rejected = checked.reason;
      }
    }
    return { items: null, card: null, rejected: rejected };
  }

  // Spark rationale is model text: keep it, but strip anything shaped like a
  // piece/share id so the reply names only pieces/categories, never IDs.
  function cleanRationale(text) {
    var t = String(text || "");
    t = t.replace(/SYNTH_[A-Za-z0-9_]+/g, "");
    t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
    return t;
  }

  function localRationale(items, card) {
    var nouns = items.map(function (it) { return plainNoun(it.category); });
    var finish = (card && card.finish) || null;
    if (!finish) {
      finish = finishOf(items, card);
    }
    if (finish === "layer") {
      return "The single layer worn open keeps the line long and leggy over " +
        (nouns.length > 1 ? "the " + nouns.slice(0, -1).join(" and ") : "your base") + " — nothing pulls, nothing stacks.";
    }
    if (finish === "scarf") {
      return "The scarf tied high draws the eye up and finishes the line in one move — " +
        "nothing stacks, nothing pulls.";
    }
    if (finish === "bag") {
      return "The bag worn high at the waist adds the shine and finishes the line in one move — " +
        "nothing stacks, nothing pulls.";
    }
    return "The scarf tied high draws the eye up while the bag adds shine at the hip — " +
      "the pair works as one finish, so the line stays long.";
  }

  function plainWhy(reason) {
    var m = {
      missing_base: "there's no base to build on yet",
      dress_plus_separates: "a dress already counts as the whole base, so it won't share with separates",
      two_layers: "layers never stack — just one at a time",
      two_finishes: "a look takes exactly one finish, not a layer plus scarf-and-bag",
      stray_accessory_with_layer: "a layer look takes no scarf or bag — drop the stray piece or pair up",
      incomplete_finish: "a scarf needs its bag partner and vice versa",
      missing_finish: "there's no finish yet — a layer, a scarf or a bag",
      all_pieces: "using every single piece at once would stack finishes",
      unknown_piece: "Spark named a piece that isn't in your wardrobe",
      repeated_piece: "Spark named the same piece twice",
      duplicate_category: "two pieces played the same role",
      shoes_excluded: "shoes stay out of look cards",
      fit_invalid: "the fit rules didn't pass it",
      empty_selection: "Spark came back with no selection",
      assembler_error: "the fit-check stumbled",
      no_valid_combination: "nothing in there pairs into a full look yet"
    };
    return m[reason] || "it didn't pass the fit rules";
  }

  // ---- Render-on-user profile flow (shared with revise_look via the
  // exported helpers below) ----
  //
  // Rule: a photo is filed as a wearer profile reference (headshot /
  // full_body) ONLY while a profile_image expectation pends (the
  // agentic loop routes that turn here with pendingSatisfied). Ordinary
  // garment photos outside that expectation are never profile photos.
  // The two-photo sequence is deterministic (headshot first, labels
  // honoured) and restart-safe (consent + "what is missing" derive from
  // the durable server-side record, not memory).

  function getRouterSvc(opts) {
    if (opts && opts.router && typeof opts.router.detectRenderIntent === "function") return opts.router;
    try {
      if (typeof require !== "undefined") {
        var m = require("../../router.js");
        if (m && typeof m.detectRenderIntent === "function") return m;
      }
    } catch (e) { /* fall through to global */ }
    try {
      if (root.MetaStyles && root.MetaStyles.router && typeof root.MetaStyles.router.detectRenderIntent === "function") {
        return root.MetaStyles.router;
      }
    } catch (e2) { /* none available */ }
    return null;
  }

  // Fail-closed: without the shared router vocabulary there is no
  // render intent (flat-lay as before), never a guessed render.
  function isRenderIntent(opts, text) {
    try {
      var r = getRouterSvc(opts);
      if (r) return r.detectRenderIntent(text) === true;
    } catch (e) {}
    return false;
  }

  function isDeletePhotos(opts, text) {
    try {
      var r = getRouterSvc(opts);
      if (r) return r.matchDeletePhotos(text) === true;
    } catch (e) {}
    return false;
  }

  var HEADSHOT_RE = /\bhead[\s-]?shot\b/i;
  var FULLBODY_RE = /\bfull[\s-]?body\b/i;

  // A single photo turn may carry the word "headshot" / "full body":
  // that label wins outright (even over the slot we asked for). Both
  // named or neither named -> null (caller falls back to next-missing).
  function labelProfileType(text) {
    var t = String(text || "");
    var h = HEADSHOT_RE.test(t);
    var f = FULLBODY_RE.test(t);
    if (h && !f) return "headshot";
    if (f && !h) return "full_body";
    return null;
  }

  // Headshot first: the deterministic upload order.
  function missingProfileTypes(profile) {
    var out = [];
    if (!profile || !profile.headshot) out.push("headshot");
    if (!profile || !profile.full_body) out.push("full_body");
    return out;
  }

  function safeGetProfile(catalog) {
    try {
      if (catalog && typeof catalog.getProfileReferences === "function") {
        return catalog.getProfileReferences() || { headshot: null, full_body: null, consent: false, updated_at: null };
      }
    } catch (e) {}
    return { headshot: null, full_body: null, consent: false, updated_at: null };
  }

  async function ensureProfileLoaded(catalog) {
    try {
      if (catalog && typeof catalog.loadProfile === "function") await catalog.loadProfile();
    } catch (e) { /* best-effort: memory state still answers */ }
  }

  async function saveProfileBestEffort(catalog) {
    try {
      if (catalog && typeof catalog.saveProfile === "function") await catalog.saveProfile();
    } catch (e) { /* best-effort: memory holds the truth, like pieces */ }
  }

  function recordConsentExpectation(catalog, skill, questionText) {
    try {
      if (catalog && typeof catalog.askQuestion === "function") {
        catalog.askQuestion({ text: questionText, skill: skill, expects: "yes_no" });
      }
    } catch (e) {}
  }

  function recordProfileImageExpectation(catalog, skill, questionText) {
    try {
      if (catalog && typeof catalog.askQuestion === "function") {
        catalog.askQuestion({ text: questionText, skill: skill, expects: "profile_image" });
      }
    } catch (e) {}
  }

  // Defensive: after a mid-flow delete, resolve our own profile
  // pendings so the next photo can never strand (the loop already
  // resolved them, but direct callers bypass the loop).
  function resolveOwnProfilePendings(catalog, skill) {
    try {
      if (!catalog || typeof catalog.getPendingQuestions !== "function") return;
      var pqs = catalog.getPendingQuestions() || [];
      for (var i = 0; i < pqs.length; i++) {
        if (pqs[i] && pqs[i].skill === skill &&
            (pqs[i].expects === "profile_image" || pqs[i].expects === "yes_no")) {
          try { catalog.resolveQuestion(pqs[i].id); } catch (e) {}
        }
      }
    } catch (e2) {}
  }

  // Concise consent/storage question. Claims encryption because the
  // actual server path (mock-ig-bot /ig/profile) encrypts the record
  // at rest (AES-256-GCM) — never claim it for a path that does not.
  var PROFILE_CONSENT_TEXT = "To show a look on you, darling \u2728 I\u2019ll keep just two photos \u2014 a headshot and a full-body \u2014 encrypted, only to render your looks on you and never for anything else. Say \u201Cdelete my photos\u201D anytime to remove them. May I keep them? A quick \u201Cyes\u201D and I\u2019ll ask for your headshot first.";

  function profileAskText(missing) {
    if (!missing || missing.length >= 2) {
      return "Lovely \u2014 to render this on you I\u2019ll need two photos, one at a time: first your headshot, then a full-body photo, loveling \u2728 (Add the word \u201Cheadshot\u201D or \u201Cfull body\u201D alongside a photo and I\u2019ll file it under that name.) Share your headshot to begin?";
    }
    if (missing[0] === "headshot") {
      return "Just your headshot to go, loveling \u2728 \u2014 share that photo (with the word \u201Cheadshot\u201D if you like) and I\u2019ll render the look on you.";
    }
    return "Headshot kept safe \u2728 \u2014 now just your full-body photo to go, loveling, and I\u2019ll render the look on you.";
  }

  function profileStoredText(slot, stillMissing) {
    if (stillMissing.length === 0) return "";
    if (slot === "headshot") {
      return "Headshot kept safe \u2728 \u2014 now share your full-body photo and I\u2019ll render the look on you.";
    }
    return "Full-body photo kept safe \u2728 \u2014 now share your headshot and I\u2019ll render the look on you.";
  }

  function noPreviewDelivery(reason) {
    return { requested: true, generated: false, delivered: false, reason: reason };
  }

  async function handleDeletePhotos(o) {
    var catalog = o.catalog;
    var skill = typeof o.skill === "string" && o.skill ? o.skill : "propose_look";
    await ensureProfileLoaded(catalog);
    var before = safeGetProfile(catalog);
    var had = !!(before && (before.headshot || before.full_body || before.consent));
    var delOk = true;
    try {
      if (catalog && typeof catalog.deleteProfile === "function") {
        var r = await catalog.deleteProfile();
        if (r && r.ok === false) delOk = false;
      } else if (catalog && typeof catalog.clearProfileReferences === "function") {
        catalog.clearProfileReferences();
      }
    } catch (e) { delOk = false; }
    resolveOwnProfilePendings(catalog, skill);
    if (!delOk) {
      return {
        text: "Oh loveling \u2728 I couldn\u2019t quite reach your saved photos just now \u2014 mind asking me again in a moment? Nothing was deleted yet.",
        image: null,
        persist: { summaryDelta: "Profile-photo delete failed; will retry.", preferencesDelta: "" },
        skill: skill,
        meta: { profileAction: "delete_failed", imageDelivery: noPreviewDelivery("profile_delete_failed") }
      };
    }
    var text = had
      ? "Done, loveling \u2728 \u2014 your saved headshot and full-body photo are deleted, and I won\u2019t render looks on you again until you share new ones. (One-off photos shared for colour advice were never kept in the first place.)"
      : "There were no saved profile photos to delete, loveling \u2728 \u2014 your headshot and full-body photo were never kept. (One-off photos shared for colour advice aren\u2019t kept either \u2014 just for that read.)";
    return {
      text: text,
      image: null,
      persist: { summaryDelta: had ? "Deleted saved profile photos." : "Delete-photos request; nothing saved.", preferencesDelta: "" },
      skill: skill,
      meta: { profileAction: had ? "deleted" : "delete_noop", imageDelivery: { requested: false, generated: false, delivered: false, reason: "profile_delete" } }
    };
  }

  // Intake: store one uploaded photo as a profile reference. Only ever
  // called while a profile_image expectation pends (the loop routes that
  // turn here with pendingSatisfied). Returns { complete, profile,
  // reply }: complete=false replies ask for the next photo; complete=true
  // means both references now exist and the caller should proceed to
  // selection + render in the same turn.
  async function handleProfileIntake(o) {
    var catalog = o.catalog;
    var skill = typeof o.skill === "string" && o.skill ? o.skill : "propose_look";
    var imageDataUrl = typeof o.imageDataUrl === "string" ? o.imageDataUrl : null;
    var userText = typeof o.text === "string" ? o.text : "";
    await ensureProfileLoaded(catalog);
    var profile = safeGetProfile(catalog);
    if (!profile.consent) {
      recordConsentExpectation(catalog, skill, PROFILE_CONSENT_TEXT);
      return {
        complete: false, profile: profile,
        reply: {
          text: PROFILE_CONSENT_TEXT,
          image: null,
          persist: { summaryDelta: "Asked for profile-photo consent.", preferencesDelta: "" },
          skill: skill,
          meta: { profileAction: "consent_asked", imageDelivery: noPreviewDelivery("profile_consent_pending") }
        }
      };
    }
    if (!imageDataUrl || !/^data:image\//.test(imageDataUrl)) {
      var retryMissing = missingProfileTypes(profile);
      var retryAsk = profileAskText(retryMissing);
      recordProfileImageExpectation(catalog, skill, retryAsk);
      return {
        complete: false, profile: profile,
        reply: {
          text: "Oh loveling \u2728 that photo didn\u2019t come through in a form I can keep \u2014 mind resending it as an ordinary photo? " + retryAsk,
          image: null,
          persist: { summaryDelta: "Profile photo unreadable; asked again.", preferencesDelta: "" },
          skill: skill,
          meta: { profileAction: "intake_failed", profileMissing: retryMissing, imageDelivery: noPreviewDelivery("profile_refs_pending") }
        }
      };
    }
    var label = labelProfileType(userText);
    var missing = missingProfileTypes(profile);
    var slot = label || missing[0] || "headshot";
    var storedReceipt = null;
    try {
      if (!catalog || typeof catalog.setProfileReference !== "function") throw new Error("no profile support");
      storedReceipt = catalog.setProfileReference(slot, imageDataUrl);
    } catch (e) {
      var failMissing = missingProfileTypes(safeGetProfile(catalog));
      var failAsk = profileAskText(failMissing);
      recordProfileImageExpectation(catalog, skill, failAsk);
      return {
        complete: false, profile: safeGetProfile(catalog),
        reply: {
          text: "Oh loveling \u2728 that photo didn\u2019t come through in a form I can keep \u2014 mind resending it as an ordinary photo? " + failAsk,
          image: null,
          persist: { summaryDelta: "Profile photo unreadable; asked again.", preferencesDelta: "" },
          skill: skill,
          meta: { profileAction: "intake_failed", profileMissing: failMissing, imageDelivery: noPreviewDelivery("profile_refs_pending") }
        }
      };
    }
    await saveProfileBestEffort(catalog);
    var after = safeGetProfile(catalog);
    var stillMissing = missingProfileTypes(after);
    if (stillMissing.length > 0) {
      var ask = profileAskText(stillMissing);
      recordProfileImageExpectation(catalog, skill, ask);
      // imageConsumed (2026-11-03): the attached photo was just filed
      // as a wearer reference — consumed this turn, so the service may
      // ack the media once this reply goes out.
      return {
        complete: false, profile: after,
        reply: {
          text: profileStoredText(slot, stillMissing),
          image: null,
          persist: { summaryDelta: "Kept profile " + slot + "; still missing " + stillMissing.join(", ") + ".", preferencesDelta: "" },
          skill: skill,
          meta: { profileAction: "stored", profileSlot: slot, profileMissing: stillMissing, imageDelivery: noPreviewDelivery("profile_refs_pending"), imageConsumed: true }
        }
      };
    }
    return { complete: true, profile: after, reply: null };
  }

  function refBytesLen(dataUrl) {
    try {
      var b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").length;
      return Math.ceil(b64.length * 3 / 4);
    } catch (e) { return dataUrl.length; }
  }

  var ONUSER_REF_DIM_PX = 384;
  var ONUSER_PAYLOAD_CAP = 2 * 1024 * 1024;

  // Scale one reference to the shared 384px pipeline (same fail-soft as
  // garment refs); raw bytes survive when the pipeline is unavailable.
  function scaleProfileRef(dataUrl) {
    if (typeof dataUrl !== "string" || !/^data:image\//.test(dataUrl)) return null;
    try {
      var pt = null;
      try { if (typeof require !== "undefined") pt = require("../../photo-thumb.js"); } catch (e) { pt = null; }
      if ((!pt || typeof pt.makeSync !== "function") && root.MetaStyles && root.MetaStyles.photoThumb) pt = root.MetaStyles.photoThumb;
      if (pt && typeof pt.makeSync === "function") {
        var r = pt.makeSync(dataUrl, null, ONUSER_REF_DIM_PX);
        if (typeof r === "string" && r) return { url: r, scaled: true };
      }
    } catch (e) {}
    return { url: dataUrl, scaled: false };
  }

  // Garment reference URLs for the on-user preview: prefer the 384px
  // original-derived ref, fall back to the thumb (downgraded), skip
  // pieces with no usable bytes. Same ≤2 MB defensive payload cap and
  // first-ref-kept rule as the flat-lay path. Pure function over full
  // piece objects — shared by propose_look and revise_look render paths
  // so the two never drift (the flat-lay path keeps its own proven code).
  function buildGarmentRefUrls(activePieces, chosenItems) {
    var map = {};
    (Array.isArray(activePieces) ? activePieces : []).forEach(function (p) {
      if (p && p.piece_id) map[p.piece_id] = p;
    });
    var items = Array.isArray(chosenItems) ? chosenItems : [];
    var urls = [];
    var refs = [];
    var payloadBytes = 0;
    var downgraded = false;
    for (var i = 0; i < items.length && urls.length < 4; i++) {
      var piece = map[items[i] && items[i].id];
      if (!piece) { downgraded = true; continue; }
      var u = null;
      var down = false;
      var src = null;
      if (typeof piece.image_original === "string" && /^data:image\//.test(piece.image_original)) {
        var s = scaleProfileRef(piece.image_original);
        if (s) { u = s.url; down = !s.scaled; src = "image_original"; }
        else if (typeof piece.photo_thumb === "string" && /^data:image\//.test(piece.photo_thumb)) { u = piece.photo_thumb; down = true; src = "photo_thumb"; }
        else { downgraded = true; continue; }
      } else if (typeof piece.photo_thumb === "string" && /^data:image\//.test(piece.photo_thumb)) {
        u = piece.photo_thumb; down = true; src = "photo_thumb";
      } else { downgraded = true; continue; }
      var len = refBytesLen(u);
      if (urls.length === 0 || payloadBytes + len <= ONUSER_PAYLOAD_CAP) {
        urls.push(u);
        // Audit detail for the preview ring (additive: urls/total/
        // downgraded/payloadBytes above are byte-for-byte as before).
        refs.push({
          piece_id: items[i] && items[i].id,
          category: items[i] && items[i].category,
          ref_source: src, ref_bytes: len, downgraded: !!down
        });
        payloadBytes += len;
        if (down) downgraded = true;
      } else {
        downgraded = true;
      }
    }
    return { urls: urls, refs: refs, total: items.length, downgraded: downgraded, payloadBytes: payloadBytes };
  }

  function getPhotoThumbSvc() {
    try {
      if (typeof require !== "undefined") return require("../../photo-thumb.js");
    } catch (e) { /* fall through to global */ }
    try {
      if (root.MetaStyles && root.MetaStyles.photoThumb) return root.MetaStyles.photoThumb;
    } catch (e2) { /* none available */ }
    return null;
  }

  // Garment images for a preview with a fixed image-slot budget: one ref
  // per chosen piece for ALL chosen pieces (no 4 cap), with the same
  // per-piece preference as buildGarmentRefUrls (image_original -> 384px,
  // else photo_thumb, downgraded flags, pieces with no bytes skipped).
  // The <=2MB defensive payload rule still applies while accumulating
  // (first ref kept, over-cap extras skipped as downgraded). When the
  // refs fit `slots` they ride individually (today's behaviour);
  // otherwise ALL refs pre-combine into ONE composite reference sheet
  // (composeSheetSync over all refs in selection order) that counts as
  // one ref. Composition failure (or an over-cap sheet) falls back to
  // the first `slots` individual refs, downgraded. Returns { images,
  // mode ("individual"|"composite"), refs (per-piece audit rows, each
  // with piece_id, category, ref_source, ref_bytes, downgraded, plus a
  // cell index when in the sheet), orderedNouns (plain nouns of the
  // pieces actually represented, in sheet/attachment order), total,
  // represented, downgraded, payloadBytes }. Never throws.
  function buildGarmentImages(activePieces, chosenItems, slots) {
    try {
      var map = {};
      (Array.isArray(activePieces) ? activePieces : []).forEach(function (p) {
        if (p && p.piece_id) map[p.piece_id] = p;
      });
      var items = Array.isArray(chosenItems) ? chosenItems : [];
      var cap = (typeof slots === "number" && isFinite(slots)) ? Math.floor(slots) : 4;
      if (!(cap >= 1)) cap = 1;
      var built = [];
      var downgraded = false;
      var payloadBytes = 0;
      for (var i = 0; i < items.length; i++) {
        var piece = map[items[i] && items[i].id];
        if (!piece) { downgraded = true; continue; }
        var u = null, down = false, src = null;
        if (typeof piece.image_original === "string" && /^data:image\//.test(piece.image_original)) {
          var s = scaleProfileRef(piece.image_original);
          if (s) { u = s.url; down = !s.scaled; src = "image_original"; }
          else if (typeof piece.photo_thumb === "string" && /^data:image\//.test(piece.photo_thumb)) { u = piece.photo_thumb; down = true; src = "photo_thumb"; }
          else { downgraded = true; continue; }
        } else if (typeof piece.photo_thumb === "string" && /^data:image\//.test(piece.photo_thumb)) {
          u = piece.photo_thumb; down = true; src = "photo_thumb";
        } else { downgraded = true; continue; }
        var len = refBytesLen(u);
        if (built.length === 0 || payloadBytes + len <= ONUSER_PAYLOAD_CAP) {
          built.push({ url: u, piece_id: items[i].id, category: items[i].category, source: src, bytes: len, downgraded: !!down });
          payloadBytes += len;
          if (down) downgraded = true;
        } else {
          downgraded = true;
        }
      }
      var total = items.length;
      function rowOf(b, cell) {
        var r = {
          piece_id: b.piece_id, category: b.category,
          ref_source: b.source, ref_bytes: b.bytes, downgraded: b.downgraded
        };
        if (typeof cell === "number" && cell >= 0) r.cell = cell;
        return r;
      }
      function nounsOf(list) {
        return list.map(function (b) { return plainNoun(b.category); });
      }
      if (built.length <= cap) {
        return {
          images: built.map(function (b) { return b.url; }),
          mode: "individual",
          refs: built.map(function (b) { return rowOf(b); }),
          orderedNouns: nounsOf(built),
          total: total, represented: built.length,
          downgraded: downgraded, payloadBytes: payloadBytes
        };
      }
      var sheet = null;
      try {
        var pt = getPhotoThumbSvc();
        if (pt && typeof pt.composeSheetSync === "function") {
          sheet = pt.composeSheetSync(built.map(function (b) { return b.url; }), { maxSide: 1024 });
        }
      } catch (e) { sheet = null; }
      if (sheet && typeof sheet.url === "string" && /^data:image\//.test(sheet.url)) {
        var sheetLen = refBytesLen(sheet.url);
        if (sheetLen <= ONUSER_PAYLOAD_CAP) {
          var order = Array.isArray(sheet.included) ? sheet.included : [];
          // The sheet's `included` indexes are authoritative: only placed
          // inputs are represented (grid order = placement order). Skipped
          // inputs get no cell and count as missing, so the honest
          // "Only N of M" shortfall line applies to them like any other
          // missing ref — the prompt must never name a garment that is
          // not on the sheet.
          var placed = [];
          for (var oi = 0; oi < order.length; oi++) {
            var bi = order[oi];
            if (typeof bi === "number" && isFinite(bi) && Math.floor(bi) === bi &&
                bi >= 0 && bi < built.length && placed.indexOf(bi) === -1) {
              placed.push(bi);
            }
          }
          if (placed.length > 0) {
            return {
              images: [sheet.url],
              mode: "composite",
              refs: placed.map(function (bi2, gridPos) { return rowOf(built[bi2], gridPos); }),
              orderedNouns: placed.map(function (bi3) { return plainNoun(built[bi3].category); }),
              total: total, represented: placed.length,
              downgraded: downgraded || placed.length < built.length, payloadBytes: sheetLen
            };
          }
        }
      }
      var fb = built.slice(0, cap);
      var fbBytes = 0;
      fb.forEach(function (b) { fbBytes += b.bytes; });
      return {
        images: fb.map(function (b) { return b.url; }),
        mode: "individual",
        refs: fb.map(function (b) { return rowOf(b); }),
        orderedNouns: nounsOf(fb),
        total: total, represented: fb.length,
        downgraded: true, payloadBytes: fbBytes
      };
    } catch (e) {
      return {
        images: [], mode: "individual", refs: [], orderedNouns: [],
        total: Array.isArray(chosenItems) ? chosenItems.length : 0,
        represented: 0, downgraded: true, payloadBytes: 0
      };
    }
  }

  // The on-user preview request: profile refs FIRST (headshot,
  // full_body), then garment images — order documented in the prompt and
  // in meta. Max 4 images total (proxy cap): both profile refs plus the
  // garment images from buildGarmentImages(activePieces, chosenItems,
  // slots), slots = 2 by default. When garments outnumber the free slots
  // they ride as ONE composite reference sheet (mode "composite");
  // otherwise they ride individually. The "Only N of M" sentence appears
  // only when pieces are genuinely missing (no bytes / composition
  // failure), never just because of slot count. o: { metaClient,
  // headshot, fullBody, activePieces, chosenItems, slots, nouns,
  // context, shareId, stageImage, toolSteps }. The legacy { garmentRefs,
  // garments, garmentTotal } shape still rides the same individual path.
  // meta.referencePieces reports pieces represented (not image count);
  // meta.referenceMode names the garment path ("individual"|"composite").
  async function requestOnUserPreview(o) {
    var auditSkill = (o && typeof o.skill === "string" && o.skill) ? o.skill : "propose_look";
    var toolSteps = typeof o.toolSteps === "number" ? o.toolSteps : 0;
    var imageDelivery = { requested: true, generated: false, delivered: false, reason: "preview_failed" };
    var meta = {
      renderOnUser: true, profileRefs: 0, referencePieces: 0,
      referenceGarmentTotal: 0,
      referenceDowngraded: false, referencePayloadBytes: 0, previewPrompt: "",
      referenceMode: "individual"
    };
    var hs = scaleProfileRef(o.headshot);
    var fb = scaleProfileRef(o.fullBody);
    if (!hs || !fb) {
      imageDelivery.reason = "profile_ref_unavailable";
      return { image: null, imageDelivery: imageDelivery, meta: meta, toolSteps: toolSteps };
    }
    meta.profileRefs = 2;
    var built = null;
    if (o && Array.isArray(o.chosenItems)) {
      built = buildGarmentImages(o.activePieces, o.chosenItems,
        (o && typeof o.slots === "number") ? o.slots : 2);
    } else {
      // Legacy callers pass prebuilt refs; they always ride individually.
      var legacyRefs = (o && Array.isArray(o.garmentRefs)) ? o.garmentRefs : [];
      var legacyNotes = (o && Array.isArray(o.garments)) ? o.garments : [];
      built = {
        images: legacyRefs.slice(), mode: "individual",
        refs: legacyNotes.slice(), orderedNouns: [],
        total: (o && typeof o.garmentTotal === "number") ? o.garmentTotal : legacyRefs.length,
        represented: 0, downgraded: false, payloadBytes: 0
      };
    }
    meta.referenceGarmentTotal = built.total;
    var images = [hs.url, fb.url];
    var payloadBytes = refBytesLen(hs.url) + refBytesLen(fb.url);
    var downgraded = !(hs.scaled && fb.scaled);
    if (built.downgraded) downgraded = true;
    var passedGarments = [];
    var compositeAttached = false;
    if (built.mode === "composite" && built.images.length === 1) {
      // One sheet carries every represented garment; it counts as one ref.
      var sheetLen = refBytesLen(built.images[0]);
      if (payloadBytes + sheetLen <= ONUSER_PAYLOAD_CAP) {
        images.push(built.images[0]);
        payloadBytes += sheetLen;
        passedGarments = built.refs.slice();
        compositeAttached = true;
      } else {
        downgraded = true;
      }
    } else {
      // Proxy cap: 4 images max.
      for (var i = 0; i < built.images.length && images.length < 4; i++) {
        var len = refBytesLen(built.images[i]);
        if (payloadBytes + len <= ONUSER_PAYLOAD_CAP) {
          images.push(built.images[i]);
          payloadBytes += len;
          if (built.refs[i]) passedGarments.push(built.refs[i]);
        } else {
          downgraded = true;
        }
      }
    }
    var represented = compositeAttached ? built.represented : passedGarments.length;
    if (built.total > represented) downgraded = true;
    meta.referencePieces = represented;
    meta.referenceDowngraded = downgraded;
    meta.referencePayloadBytes = payloadBytes;
    meta.referenceMode = compositeAttached ? "composite" : "individual";
    var previewPrompt;
    if (compositeAttached) {
      previewPrompt =
        "Render the selected look worn by the same user shown in the reference photos, preserving identity and garment details \u2014 not a flat-lay. " +
        "Image 1 is the wearer's headshot and image 2 is their full-body reference: keep this person's face, identity, and proportions exactly. " +
        "Image 3 is a reference sheet of the " + built.represented + " selected garments arranged in a grid, read left-to-right, top-to-bottom: " + built.orderedNouns.join(", ") + ". " +
        "Every cell is a separate garment; dress the person in ALL of them, preserving each garment's colour, print, silhouette, and details; do not render the grid, white background, or sheet layout itself; do not substitute generic garments; do not add unreferenced garments. " +
        "Full-body portrait of the person wearing the complete look, soft pastel backdrop. No unworn garments laid out, no floating clothes, no readable text.";
    } else {
      previewPrompt =
        "Render the selected look worn by the same user shown in the reference photos, preserving identity and garment details \u2014 not a flat-lay. " +
        "Image 1 is the wearer's headshot and image 2 is their full-body reference: keep this person's face, identity, and proportions exactly. " +
        "The remaining attached images are the selected wardrobe garments (" + o.nouns + "): dress the person in exactly this look, preserving each garment's colour, print, silhouette, and details; do not substitute generic garments; do not add unreferenced garments. " +
        "Full-body portrait of the person wearing the complete look, soft pastel backdrop. No unworn garments laid out, no floating clothes, no readable text.";
    }
    if (o.context) {
      previewPrompt += " Styling brief from the wearer: " + o.context + ".";
    }
    if (built.total > represented) {
      // Name the full look (core then extras) so a piece with no attached
      // reference — e.g. a pieceless shoes extra — is still styled in.
      var fullLookBit = (typeof o.nouns === "string" && o.nouns)
        ? " (the full look is " + o.nouns + ")" : "";
      previewPrompt += " Only " + represented + " of " + built.total + " selected pieces have attached references" + fullLookBit + "; render those faithfully and complete the look consistently.";
    }
    meta.previewPrompt = previewPrompt;
    var image = null;
    if (o.metaClient && typeof o.metaClient.preview === "function") {
      // Audit the request (facts only — ids, counts, prompt text; the
      // images[] bytes themselves are never recorded). One entry per
      // preview call, recorded up front so even a throwing call is logged.
      recordPreviewAudit({
        skill: auditSkill, renderOnUser: true, profileRefs: meta.profileRefs,
        refs: passedGarments, previewPromptPreview: previewPrompt,
        totalRefs: images.length, totalPayloadBytes: payloadBytes,
        mode: meta.referenceMode
      });
      toolSteps += 1;
      try {
        var pr = await o.metaClient.preview(previewPrompt, images);
        var durl = pr && (pr.dataURL || pr.dataUrl || pr.data_url);
        if (typeof durl === "string" && /^data:image\//.test(durl)) {
          imageDelivery.generated = true;
          image = { dataURL: durl, caption: o.nouns + " \u2014 styled on you with love" };
          if (o.shareId && o.stageImage) {
            toolSteps += 1;
            var staged = null;
            try { staged = await o.stageImage(o.shareId, durl); } catch (e) { staged = null; }
            if (staged && staged.ok) {
              imageDelivery.delivered = true;
              imageDelivery.reason = "staged for send with image";
            } else {
              imageDelivery.reason = "stage_failed";
            }
          } else {
            imageDelivery.reason = "text-only send; preview not staged for delivery";
          }
        } else {
          imageDelivery.reason = "preview_unparseable";
        }
      } catch (e) {
        imageDelivery.reason = "preview_failed";
      }
    } else {
      imageDelivery.requested = false;
      imageDelivery.reason = "no_preview_client";
    }
    return { image: image, imageDelivery: imageDelivery, meta: meta, toolSteps: toolSteps };
  }

  // ---- Muse Image preview audit ring (shared with revise_look) ----
  //
  // One entry per metaClient.preview() call, request facts ONLY: which
  // stored pieces/references were actually sent (ids, categories, source
  // kind, byte counts), the prompt text (truncated), and totals. NEVER
  // image bytes, base64, data URLs, tokens, or secrets — the sanitising
  // copy below keeps exactly the declared keys so a caller can never
  // smuggle bytes in. Bounded like the service's activity ring
  // (wardrobe-service/server.js ACTIVITY_RING style): newest last, cap 20.
  // The wardrobe-service status surface reads this via getPreviewAudit().
  // Logging never breaks the reply: recordPreviewAudit never throws.
  var PREVIEW_AUDIT_CAP = 20;
  var PREVIEW_PROMPT_PREVIEW_LEN = 200;
  var previewAudit = [];

  function previewPromptPreviewText(prompt) {
    var t = String(prompt || "");
    return t.length > PREVIEW_PROMPT_PREVIEW_LEN ? t.slice(0, PREVIEW_PROMPT_PREVIEW_LEN) : t;
  }

  function recordPreviewAudit(entry) {
    try {
      var o = entry || {};
      var refs = [];
      if (Array.isArray(o.refs)) {
        for (var i = 0; i < o.refs.length; i++) {
          var r = o.refs[i] || {};
          var row = {
            piece_id: typeof r.piece_id === "string" ? r.piece_id : null,
            category: typeof r.category === "string" ? r.category : null,
            ref_source: r.ref_source === "image_original" ? "image_original" : "photo_thumb",
            ref_bytes: typeof r.ref_bytes === "number" ? r.ref_bytes : 0,
            downgraded: r.downgraded === true
          };
          // Composite-sheet cell index (integer >= 0 when this ref rides
          // in the sheet, null otherwise). Bytes can never smuggle in:
          // only this numeric key is kept.
          row.cell = (typeof r.cell === "number" && isFinite(r.cell) &&
            Math.floor(r.cell) === r.cell && r.cell >= 0) ? r.cell : null;
          refs.push(row);
        }
      }
      previewAudit.push({
        timestamp: new Date().toISOString(),
        skill: typeof o.skill === "string" && o.skill ? o.skill : "propose_look",
        renderOnUser: o.renderOnUser === true,
        profileRefs: typeof o.profileRefs === "number" ? o.profileRefs : 0,
        refs: refs,
        previewPromptPreview: previewPromptPreviewText(o.previewPromptPreview || o.previewPrompt),
        totalRefs: typeof o.totalRefs === "number" ? o.totalRefs : refs.length,
        totalPayloadBytes: typeof o.totalPayloadBytes === "number" ? o.totalPayloadBytes : 0,
        mode: o.mode === "composite" ? "composite" : "individual"
      });
      if (previewAudit.length > PREVIEW_AUDIT_CAP) previewAudit = previewAudit.slice(-PREVIEW_AUDIT_CAP);
      return previewAudit[previewAudit.length - 1];
    } catch (e) { return null; }
  }

  function getPreviewAudit() { return previewAudit.slice(); }

  function clearPreviewAudit() { previewAudit = []; }

  function logDecision(source, selectedCount, rejectedReason, toolSteps) {
    try {
      console.log("propose_look " + JSON.stringify({
        skill: "propose_look",
        source: source,
        selected: selectedCount,
        rejected: rejectedReason || null,
        steps: toolSteps
      }));
    } catch (e) { /* logging never breaks the reply */ }
  }

  // Opus finding #6: record every turn (success AND no-op) so later
  // skills (explain_fit via catalog.getTurns()) can see what was just
  // proposed. Fail-closed-but-never-blocking: a schema mismatch must
  // never break the user-facing reply. Verdict-false turns carry a
  // null proposal so explain_fit never reads a failed turn as a look.
  function recordLookTurn(catalog, entry) {
    if (!catalog || typeof catalog.recordTurn !== "function") return;
    try {
      catalog.recordTurn(entry);
    } catch (e) { /* turn-recording never breaks the reply */ }
  }

  function finishOf(items, card) {
    if (card && typeof card.finish === "string" &&
        (card.finish === "layer" || card.finish === "scarf+bag" ||
         card.finish === "scarf" || card.finish === "bag")) {
      return card.finish;
    }
    var cats = items.map(function (it) { return it.category; });
    var hasLayer = cats.some(function (c) { return LAYER_CATS.indexOf(c) !== -1; });
    var hasScarf = cats.indexOf("scarf") !== -1;
    var hasBag = cats.indexOf("bag") !== -1;
    if (hasLayer) return "layer";
    if (hasScarf && hasBag) return "scarf+bag";
    if (hasScarf) return "scarf";
    if (hasBag) return "bag";
    return "scarf+bag";
  }

  async function handle(opts) {
    var o = opts || {};
    var catalog = o.catalog;
    var userText = typeof o.text === "string" ? o.text : (typeof o.message === "string" ? o.message : "");
    var metaClient = o.metaClient || null;
    var assembleLook = getAssembleLook(o);
    // Image delivery: the service passes its share id plus a staging
    // function (per mode — mock /mock/stage-outbound-image, live
    // /ig/outbound-stage). When both are present and staging succeeds,
    // the preview is genuinely queued for an image send and no caveat is
    // appended. Otherwise the honest "can't send pictures yet" caveat
    // stays. A null stageImage (a mode with no staging route) keeps the
    // text-only path exactly as before.
    var shareId = typeof o.shareId === "string" && o.shareId ? o.shareId : null;
    var stageImage = typeof o.stageImage === "function" ? o.stageImage : null;
    var toolSteps = 0;

    // Render-on-user preamble (delete / intake / consent-yes / gate).
    // Delete works with any wardrobe state, so it runs first.
    var renderIntent = isRenderIntent(o, userText);
    var imageDataUrl = typeof o.imageDataUrl === "string" ? o.imageDataUrl : null;
    var pendingSatisfied = o.pendingSatisfied && typeof o.pendingSatisfied === "object" ? o.pendingSatisfied : null;
    // imageConsumed (2026-11-03): true once a profile photo attached to
    // THIS turn has actually been stored as a wearer reference below
    // (intake.complete with bytes present). Stamps result metas so the
    // service may ack the media; turns with no usable photo stay
    // unflagged and the service retains the media.
    var profilePhotoUsed = false;
    function markPhotoUsedMeta(meta) {
      if (profilePhotoUsed && meta && typeof meta === "object") meta.imageConsumed = true;
      return meta;
    }
    if (isDeletePhotos(o, userText)) {
      return await handleDeletePhotos({ catalog: catalog, skill: "propose_look" });
    }
    // A photo arriving while a profile_image expectation pends is a
    // wearer reference, never a catalogue piece. Completion falls
    // through to selection + render below with render forced on.
    var renderProfile = null;
    if (imageDataUrl && pendingSatisfied && pendingSatisfied.expects === "profile_image") {
      var intake = await handleProfileIntake({
        catalog: catalog, skill: "propose_look", imageDataUrl: imageDataUrl, text: userText
      });
      toolSteps += 1;
      if (!intake.complete) {
        recordLookTurn(catalog, {
          userText: userText, proposal: null, verdict: false,
          reasons: [intake.reply && intake.reply.meta && intake.reply.meta.profileAction === "consent_asked"
            ? "profile_consent_pending" : "profile_refs_pending"]
        });
        return intake.reply;
      }
      renderProfile = intake.profile;
      renderIntent = true;
      // intake.complete with bytes present means the photo was just
      // stored as a wearer reference — consumed this turn.
      if (imageDataUrl) profilePhotoUsed = true;
    }
    // Consent "yes" (routed back here by the pending yes_no): grant,
    // persist, then ask for the headshot. An attached photo counts as
    // the first upload — stored inline, never dropped.
    // Only our own consent question counts: any other yes_no routed
    // here (catalogue_piece / describe_wardrobe "want a look?") falls
    // through to the normal look flow below.
    if (!renderProfile && pendingSatisfied && pendingSatisfied.expects === "yes_no" &&
        pendingSatisfied.text === PROFILE_CONSENT_TEXT) {
      await ensureProfileLoaded(catalog);
      var consentNow = safeGetProfile(catalog);
      if (!consentNow.consent) {
        try {
          if (catalog && typeof catalog.setProfileConsent === "function") catalog.setProfileConsent(true);
        } catch (e) { /* fall through to the consent question below */ }
        var granted = safeGetProfile(catalog);
        if (granted.consent) {
          await saveProfileBestEffort(catalog);
          toolSteps += 1;
          if (imageDataUrl && /^data:image\//.test(imageDataUrl)) {
            var grantIntake = await handleProfileIntake({
              catalog: catalog, skill: "propose_look", imageDataUrl: imageDataUrl, text: userText
            });
            toolSteps += 1;
            if (!grantIntake.complete) {
              recordLookTurn(catalog, { userText: userText, proposal: null, verdict: false, reasons: ["profile_refs_pending"] });
              return grantIntake.reply;
            }
            renderProfile = grantIntake.profile;
            renderIntent = true;
            if (imageDataUrl) profilePhotoUsed = true;
          } else {
            var grantAsk = profileAskText(["headshot", "full_body"]);
            recordProfileImageExpectation(catalog, "propose_look", grantAsk);
            recordLookTurn(catalog, { userText: userText, proposal: null, verdict: false, reasons: ["profile_consent_granted"] });
            return {
              text: "Wonderful, darling \u2728 \u2014 your photos will stay encrypted and are only ever used to render your looks on you. " + grantAsk,
              image: null,
              persist: { summaryDelta: "Profile consent granted; asked for headshot.", preferencesDelta: "" },
              skill: "propose_look",
              meta: {
                source: "profile_gate", selectedCount: 0, rejectedReason: "profile_consent_granted",
                toolSteps: toolSteps,
                imageDelivery: noPreviewDelivery("profile_refs_pending")
              }
            };
          }
        }
      }
    }

    var active = [];
    try {
      active = catalog ? catalog.getActivePieces() : [];
      toolSteps += 1;
    } catch (e) { active = []; }
    if (!Array.isArray(active)) active = [];

    if (active.length === 0) {
      logDecision("empty", 0, "empty_wardrobe", toolSteps);
      recordLookTurn(catalog, { userText: userText, proposal: null, verdict: false, reasons: ["empty_wardrobe"] });
      return {
        text: "Your wardrobe\u2019s feeling a little empty just now, loveling \u2014 share a photo of something you love and I\u2019ll catalogue it, then we can make magic! \u2728",
        image: null,
        persist: { summaryDelta: "Empty wardrobe, offered to catalogue.", preferencesDelta: "" },
        skill: "propose_look",
        meta: markPhotoUsedMeta({
          source: "empty", selectedCount: 0, rejectedReason: "empty_wardrobe",
          toolSteps: toolSteps,
          imageDelivery: { requested: false, generated: false, delivered: false, reason: "empty_wardrobe" }
        })
      };
    }

    // Render gate: an explicit render-on-user request never reaches
    // selection (or a Spark call) until consent + both references exist.
    // Missing state returns early with no generated image and an
    // explicit reason — never a silent flat-lay while claiming
    // personalization. renderProfile is already set when this turn
    // completed the two-photo intake above.
    if (renderIntent && !renderProfile) {
      await ensureProfileLoaded(catalog);
      renderProfile = safeGetProfile(catalog);
    }
    if (renderIntent && renderProfile && !renderProfile.consent) {
      recordConsentExpectation(catalog, "propose_look", PROFILE_CONSENT_TEXT);
      recordLookTurn(catalog, { userText: userText, proposal: null, verdict: false, reasons: ["profile_consent_pending"] });
      return {
        text: PROFILE_CONSENT_TEXT,
        image: null,
        persist: { summaryDelta: "Asked for profile-photo consent.", preferencesDelta: "" },
        skill: "propose_look",
        meta: {
          source: "profile_gate", selectedCount: 0, rejectedReason: "profile_consent_pending",
          toolSteps: toolSteps,
          imageDelivery: noPreviewDelivery("profile_consent_pending")
        }
      };
    }
    if (renderIntent && renderProfile && renderProfile.consent) {
      var gateMissing = missingProfileTypes(renderProfile);
      if (gateMissing.length > 0) {
        var gateAsk = profileAskText(gateMissing);
        recordProfileImageExpectation(catalog, "propose_look", gateAsk);
        recordLookTurn(catalog, { userText: userText, proposal: null, verdict: false, reasons: ["profile_refs_pending:" + gateMissing.join(",")] });
        return {
          text: gateAsk,
          image: null,
          persist: { summaryDelta: "Asked for missing profile refs: " + gateMissing.join(", ") + ".", preferencesDelta: "" },
          skill: "propose_look",
          meta: {
            source: "profile_gate", selectedCount: 0, rejectedReason: "profile_refs_pending",
            toolSteps: toolSteps,
            profileMissing: gateMissing,
            imageDelivery: noPreviewDelivery("profile_refs_pending")
          }
        };
      }
    }

    // 1. Ask Spark for a constrained choice: IDs + categories only, JSON only.
    // Occasion/style context (Opus finding #10d, now wired): the current
    // turn's own text plus the rolling `preferences` string (e.g.
    // revise_look's "Prefers without bag.") travel as a soft-preference
    // tie-break among ALREADY-VALID combos — never relaxing the fit-rule
    // validity check below (strictShape + assembleLook stay absolute).
    var prefsText = typeof o.preferences === "string" ? o.preferences : "";
    var context = (userText + (prefsText ? ". " + prefsText : "")).slice(0, 300);
    if (!context.trim()) context = "";
    // Shoes are storable wardrobe pieces but NEVER enter an automatic
    // look: the Spark prompt pool and the local fallback pool both skip
    // them, so an automatic look never fails just because shoes exist.
    // (validateSelection/strictShape still reject them as a backstop.)
    var pool = active.filter(function (p) { return p && p.category !== "shoes"; });
    var sparkLooks = null;
    var sparkError = null;
    if (metaClient && typeof metaClient.assemble === "function") {
      toolSteps += 1;
      var promptPieces = pool.map(function (p) { return { id: p.piece_id, category: p.category }; });
      try {
        var res = await metaClient.assemble(promptPieces, context);
        if (res && Array.isArray(res.looks) && res.looks.length > 0) {
          sparkLooks = res.looks;
        } else {
          sparkError = "no_looks";
        }
      } catch (e) {
        sparkError = "assemble_failed";
      }
    } else {
      sparkError = "no_assemble_client";
    }

    // 2. Validate each Spark candidate best-first.
    var chosen = null;
    var chosenRationale = "";
    var rejectedReason = sparkError;
    var sparkRejected = [];
    if (sparkLooks) {
      for (var li = 0; li < sparkLooks.length; li++) {
        var cand = sparkLooks[li] || {};
        var checked = validateSelection(pool, cand.pieceIds, assembleLook);
        if (checked.ok) {
          chosen = checked;
          chosenRationale = cleanRationale(cand.rationale);
          rejectedReason = null;
          break;
        }
        rejectedReason = "spark_rejected:" + checked.reason;
        sparkRejected.push(rejectedReason);
      }
      if (!chosen && !rejectedReason) rejectedReason = "spark_rejected:no_valid_combination";
    }

    var source = chosen ? "spark" : "fallback";
    var fallbackRejected = null;
    if (!chosen) {
      var fb = fallbackChoose(pool, assembleLook);
      if (fb.items) {
        chosen = { items: fb.items, card: fb.card };
        chosenRationale = localRationale(fb.items, fb.card);
      } else {
        fallbackRejected = fb.rejected;
        rejectedReason = rejectedReason || ("fallback_rejected:" + fb.rejected);
      }
    }

    // 3. No valid look anywhere: honest text, never a placeholder claim.
    if (!chosen) {
      var why = plainWhy(fallbackRejected || "no_valid_combination");
      logDecision("fallback", 0, rejectedReason, toolSteps);
      recordLookTurn(catalog, {
        userText: userText, proposal: null, verdict: false,
        reasons: rejectedReason ? [rejectedReason] : ["no_valid_combination"]
      });
      return {
        text: "Oh, loveling \u2728 I turned every piece over in the lamplight, but " + why +
          " — share one more piece (a layer, a scarf or a bag) and I\u2019ll spin it into a full look!",
        image: null,
        persist: { summaryDelta: "No valid look; said why honestly.", preferencesDelta: "" },
        skill: "propose_look",
        meta: markPhotoUsedMeta({
          source: "fallback", selectedCount: 0, rejectedReason: rejectedReason,
          toolSteps: toolSteps,
          imageDelivery: { requested: false, generated: false, delivered: false, reason: "no_valid_look" }
        })
      };
    }

    // 4. Validated look: reply names only piece nouns + the real rationale.
    var nouns = chosen.items.map(function (it) { return plainNoun(it.category); }).join(" + ");
    var rationale = chosenRationale || localRationale(chosen.items, chosen.card);
    var reply = "Oh, here\u2019s a little spell for you, darling \u2728 How about your " + nouns +
      " together? " + rationale;
    // The fit-rule verdict is user-visible, not hidden in validator logs:
    // the combination above passed strictShape + assembleLook as one finish.
    var lookFinish = finishOf(chosen.items, chosen.card);
    reply += " Fit check: valid \u2714 \u2014 " +
      (lookFinish === "scarf+bag" ? "a base finished with a scarf plus a bag."
        : lookFinish === "scarf" ? "a base finished with a scarf."
        : lookFinish === "bag" ? "a base finished with a bag."
        : "a base plus exactly one layer.");
    // When Spark's candidates were rejected and the local fallback wove
    // this look instead, say so in one short truthful line (plain words,
    // never IDs or stack traces) — not only in console.log. The full
    // machine reasons[] still travel on the recorded turn below.
    if (source === "fallback" && rejectedReason &&
        rejectedReason.indexOf("spark_rejected:") === 0) {
      var rejCode = rejectedReason.slice("spark_rejected:".length);
      reply += " Spark\u2019s first idea didn\u2019t pass the fit check (" +
        plainWhy(rejCode) + "), so this one is woven straight from the wardrobe rules. \u2728";
    }
    reply += " Want me to tweak anything?";

    // 5. Preview only after a validated look. Render intent takes the
    // on-user branch (profile refs + selected garments, never a
    // flat-lay); every other request keeps the flat-lay path below
    // byte-for-byte as before.
    var didRenderOnUser = false;
    var renderOnUserMeta = null;
    if (renderIntent && renderProfile && renderProfile.consent &&
        renderProfile.headshot && renderProfile.full_body) {
      var onUser = await requestOnUserPreview({
        skill: "propose_look", metaClient: metaClient,
        headshot: renderProfile.headshot, fullBody: renderProfile.full_body,
        activePieces: active, chosenItems: chosen.items,
        nouns: nouns, context: context, shareId: shareId, stageImage: stageImage,
        toolSteps: toolSteps
      });
      toolSteps = onUser.toolSteps;
      image = onUser.image;
      imageDelivery = onUser.imageDelivery;
      renderOnUserMeta = onUser.meta;
      didRenderOnUser = true;
      reply += " Rendered on you from your saved photos \u2728.";
    }
    if (!didRenderOnUser) {
    // 5. Preview only after a validated look; honour the real return shape.
    // Photo-reference (M25+M27): one ref per SELECTED piece via the
    // shared buildGarmentImages helper (slots = 4, the proxy cap). More
    // refs than slots pre-combine into ONE composite reference sheet
    // that counts as one ref; the "Only N of M" sentence appears only
    // when pieces are genuinely missing, never for slot count.
    var garFlatLay = buildGarmentImages(active, chosen.items, 4);
    var refThumbs = garFlatLay.images;
    var auditRefs = garFlatLay.refs;
    var payloadBytes = garFlatLay.payloadBytes;
    var anyDowngraded = garFlatLay.downgraded;
    var refPieces = garFlatLay.represented;
    var refThumb = refThumbs[0] || null;
    var missingRefs = garFlatLay.total - garFlatLay.represented;
    var previewPrompt =
      "Y2K fairycore flat-lay look card, soft pastel background, garments laid out neatly: " +
      nouns + ". No people, no worn try-on, no readable text.";
    // The wearer's own occasion/style wording augments (never replaces)
    // the Y2K/fairycore base framing above, so the image reflects it too.
    if (context) {
      previewPrompt += " Styling brief from the wearer: " + context + ".";
    }
    if (refThumbs.length > 0) {
      if (garFlatLay.mode === "composite") {
        previewPrompt += " The attached image is a reference sheet of the " + garFlatLay.represented + " selected garments arranged in a grid, read left-to-right, top-to-bottom: " + garFlatLay.orderedNouns.join(", ") + ".";
        previewPrompt += " Lay each garment from the sheet out as a separate flat-lay item, preserving each garment's colour, print, silhouette, and details; do not reproduce the grid, white background, or sheet layout itself; do not substitute generic garments; do not add unreferenced garments; no person/try-on/readable text.";
      } else {
        previewPrompt += " Use the attached reference garment photo for the true colors and silhouette.";
        previewPrompt += " Each attached image is a distinct wardrobe garment; preserve the colour, print, silhouette, and details of every attached reference as a separate flat-lay item; do not substitute generic garments; do not add unreferenced garments; no person/try-on/readable text.";
      }
      if (missingRefs > 0) {
        previewPrompt += " Only " + garFlatLay.represented + " of " + chosen.items.length + " selected pieces have reference photos; the remaining piece(s) are not represented in references.";
      }
    }
    var imageDelivery = { requested: false, generated: false, delivered: false, reason: "no_preview_client" };
    var image = null;
    if (metaClient && typeof metaClient.preview === "function") {
      imageDelivery.requested = true;
      imageDelivery.reason = "preview_failed";
      // Audit the request (facts only — ids, counts, prompt text; the
      // refThumbs bytes themselves are never recorded). One entry per
      // preview call, recorded up front so even a throwing call is logged.
      recordPreviewAudit({
        skill: "propose_look", renderOnUser: false,
        refs: auditRefs, previewPromptPreview: previewPrompt,
        totalRefs: refThumbs.length, totalPayloadBytes: payloadBytes,
        mode: garFlatLay.mode
      });
      toolSteps += 1;
      try {
        var previewRef = null;
        if (refThumbs.length === 1) previewRef = refThumbs[0];
        else if (refThumbs.length > 1) previewRef = refThumbs;
        var pr = await metaClient.preview(previewPrompt, previewRef);
        var durl = pr && (pr.dataURL || pr.dataUrl || pr.data_url);
        if (typeof durl === "string" && /^data:image\//.test(durl)) {
          imageDelivery.generated = true;
          image = { dataURL: durl, caption: nouns + " \u2014 styled with love" };
          if (shareId && stageImage) {
            toolSteps += 1;
            var staged = null;
            try {
              staged = await stageImage(shareId, durl);
            } catch (e) {
              staged = null;
            }
            if (staged && staged.ok) {
              imageDelivery.delivered = true;
              imageDelivery.reason = "staged for send with image";
            } else {
              imageDelivery.reason = "stage_failed";
            }
          } else {
            imageDelivery.reason = "text-only send; preview not staged for delivery";
          }
        } else {
          imageDelivery.reason = "preview_unparseable";
        }
      } catch (e) {
        imageDelivery.reason = "preview_failed";
      }
    }
    } // end flat-lay-only preview (render intent takes the on-user branch above)
    if (imageDelivery.requested && !imageDelivery.delivered) {
      reply += " (I can\u2019t tuck preview pictures into chat just yet, so this word-picture will have to sparkle on its own. \u2728)";
    }

    // Pending expectation (Milestone 24): the "Want me to tweak
    // anything?" closer above is a yes/no moment — a plain "yes" matches
    // no router trigger and would otherwise fall to off_topic instead of
    // continuing into revise_look's own question flow. Only recorded on
    // this validated-look path (the honest no-valid-look fallback above
    // asks for another photo, which routes to catalogue_piece already).
    // Never throws: a catalog failure must not break the reply itself.
    try{
      if(opts && opts.catalog && typeof opts.catalog.askQuestion==="function"){
        opts.catalog.askQuestion({ text:reply, skill:"revise_look", expects:"yes_no" });
      }
    }catch(e){}
    logDecision(source, chosen.items.length, rejectedReason, toolSteps);
    // Opus finding #6: remember the look for explain_fit / the router.
    // Rejections that happened along the way travel in reasons[] so a
    // later turn can see "Spark's first picks didn't validate".
    var turnReasons = sparkRejected.slice();
    if (source === "fallback" && fallbackRejected) turnReasons.push("fallback_rejected:" + fallbackRejected);
    if (didRenderOnUser) turnReasons.push("render_on_user");
    var turnFinish = finishOf(chosen.items, chosen.card);
    recordLookTurn(catalog, {
      userText: userText,
      proposal: {
        pieces: chosen.items.map(function (it) { return it.id; }),
        title: null, note: "valid:" + turnFinish
      },
      verdict: true, reasons: turnReasons
    });
    var outMeta = {
      source: source, selectedCount: chosen.items.length, rejectedReason: rejectedReason,
      toolSteps: toolSteps, rationale: rationale, imageDelivery: imageDelivery,
      renderOnUser: didRenderOnUser
    };
    // A profile photo stored earlier this turn rode along into this
    // validated look — the bytes were consumed, so stamp it.
    markPhotoUsedMeta(outMeta);
    if (didRenderOnUser && renderOnUserMeta) {
      outMeta.referenceThumb = false;
      outMeta.referencePieces = renderOnUserMeta.referencePieces;
      outMeta.referenceGarmentTotal = renderOnUserMeta.referenceGarmentTotal;
      outMeta.referenceDowngraded = renderOnUserMeta.referenceDowngraded;
      outMeta.referencePayloadBytes = renderOnUserMeta.referencePayloadBytes;
      outMeta.referenceMode = renderOnUserMeta.referenceMode;
      outMeta.profileRefs = renderOnUserMeta.profileRefs;
      // The exact on-user prompt travels in meta (never any image
      // bytes) so tests and status-adjacent paths can audit the
      // render wording without touching photo data.
      outMeta.previewPrompt = renderOnUserMeta.previewPrompt;
    } else {
      outMeta.referenceThumb = refThumb ? true : false;
      outMeta.referencePieces = refPieces;
      outMeta.referenceDowngraded = anyDowngraded;
      outMeta.referencePayloadBytes = payloadBytes;
      outMeta.referenceMode = garFlatLay.mode;
    }
    return {
      text: reply,
      image: image,
      persist: { summaryDelta: "Proposed look: " + nouns + ".", preferencesDelta: "" },
      skill: "propose_look",
      meta: outMeta
    };
  }

  // Shared selection stack (Opus finding #7): revise_look reuses these
  // directly so the fit rules live in exactly one place. handle() above
  // is untouched — these are pure functions over caller-supplied sets.
  // The render-on-user profile flow below is shared the same way, so
  // the intent vocabulary, consent copy, and preview ordering never
  // drift between propose_look and revise_look.
  var api = {
    handle: handle, skill: "propose_look",
    validateSelection: validateSelection, fallbackChoose: fallbackChoose,
    strictShape: strictShape, getAssembleLook: getAssembleLook,
    plainWhy: plainWhy, plainNoun: plainNoun,
    isRenderIntent: isRenderIntent, isDeletePhotos: isDeletePhotos,
    labelProfileType: labelProfileType, missingProfileTypes: missingProfileTypes,
    safeGetProfile: safeGetProfile, ensureProfileLoaded: ensureProfileLoaded,
    saveProfileBestEffort: saveProfileBestEffort,
    recordConsentExpectation: recordConsentExpectation,
    recordProfileImageExpectation: recordProfileImageExpectation,
    resolveOwnProfilePendings: resolveOwnProfilePendings,
    handleDeletePhotos: handleDeletePhotos, handleProfileIntake: handleProfileIntake,
    scaleProfileRef: scaleProfileRef, buildGarmentRefUrls: buildGarmentRefUrls,
    buildGarmentImages: buildGarmentImages,
    requestOnUserPreview: requestOnUserPreview,
    refBytesLen: refBytesLen, previewPromptPreviewText: previewPromptPreviewText,
    recordPreviewAudit: recordPreviewAudit, getPreviewAudit: getPreviewAudit,
    clearPreviewAudit: clearPreviewAudit, PREVIEW_AUDIT_CAP: PREVIEW_AUDIT_CAP,
    PROFILE_CONSENT_TEXT: PROFILE_CONSENT_TEXT,
    profileAskText: profileAskText, profileStoredText: profileStoredText,
    noPreviewDelivery: noPreviewDelivery
  };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["propose_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

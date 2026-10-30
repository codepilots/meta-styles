"use strict";
/* meta-styles Opus finding #12 — Evaluate_prospective_purchase outfit-validation tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves the "lovely outfits" are real validated possibilities, not naive
 * template strings over active.slice(0,2):
 *   (a) the claimed outfit count equals an independent brute-force count
 *       of assembleLook-valid:true combos featuring the held piece, every
 *       line names actual pieces, and no line ever reads "top and top";
 *   (b) a wardrobe with no valid combination gets the honest "can't quite
 *       picture a complete look" branch — never a fabricated outfit count;
 *   (c) the "Want a preview image too?" line is backed by a real
 *       metaClient.preview call (imageDelivery struct asserted), and the
 *       line is gone entirely when no preview client exists.
 * Clients mocked — no network. All ids synthetic (SYNTH_ prefix).
 */
const assert = require("assert");
const Wardrobe = require("../wardrobe-catalog.js");
const Handler = require("../skills/Evaluate_prospective_purchase/handler.js");
const Assembler = require("../assembler.js");

const DURL = "data:image/png;base64,SYNTH_evaluate_preview_bytes";

function catWith(cats, key) {
  const cat = Wardrobe.createCatalog({ userKey: key });
  cats.forEach(function (c, i) {
    cat.addPiece({ category: c, attributes: {}, source_share_id: "SYNTH_share_eval_" + key + "_" + i });
  });
  return cat;
}

function noLeak(r, label) {
  assert.ok(!/SYNTH_/.test(r.text), label + " must not leak SYNTH_ ids: " + r.text.slice(0, 240));
  const dumped = JSON.stringify(r);
  assert.ok(!/example\.invalid/.test(dumped), label + " must contain no example.invalid");
}

// Independent oracle: brute-force every subset (size 2..4) containing the
// held piece, reject duplicate categories/shoes locally, and count what
// the real engine marks valid:true. Written straight against the
// assembler — not against the handler's own enumeration.
function oracleCount(activeCats, heldCat) {
  const pool = activeCats.concat([heldCat]).map(function (c, i) {
    return { id: "SYNTH_oracle_" + i, category: c };
  });
  const heldId = pool[pool.length - 1].id;
  let n = 0;
  const total = pool.length;
  function subsets(start, acc) {
    if (acc.length >= 2 && acc.length <= 4) {
      if (acc.some(function (p) { return p.id === heldId; })) {
        const cats = acc.map(function (p) { return p.category; });
        const seen = {};
        let bad = false;
        for (const c of cats) {
          if (c === "shoes" || /shoe/i.test(c) || seen[c]) { bad = true; break; }
          seen[c] = true;
        }
        if (!bad) {
          const card = Assembler.assembleLook(acc.map(function (p) {
            return { id: p.id, category: p.category, copy: { text: "SYNTH " + p.category, placeholder: true, note: "oracle" } };
          }));
          if (card && card.valid === true) n += 1;
        }
      }
    }
    if (acc.length === 4) return;
    for (let i = start; i < total; i++) {
      acc.push(pool[i]);
      subsets(i + 1, acc);
      acc.pop();
    }
  }
  subsets(0, []);
  return n;
}

function claimedCount(text) {
  const m = /could unlock (\d+) lovely outfit/.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

async function run() {
  console.log("evaluate-purchase-outfit-validation.test.js");

  // --- (a) claimed count matches the engine; names real pieces ---
  console.log("\n[(a) outfits validated and counted honestly]");
  {
    const activeCats = ["base/top", "base/bottom"];
    const cat = catWith(activeCats, "SYNTH_ea");
    const r = await Handler.handle({
      catalog: cat, text: "should I get this cardigan?", shareId: "SYNTH_share_ea"
    });
    const expected = oracleCount(activeCats, "layer/cardigan");
    assert.ok(expected > 0, "oracle finds outfits for this setup");
    assert.strictEqual(claimedCount(r.text), expected,
      "claimed count matches the engine (" + expected + "): " + r.text.slice(0, 200));
    const lines = r.text.split("\n").filter(function (l) { return /^\d+\. /.test(l); });
    assert.strictEqual(lines.length, expected, "one truthful line per outfit");
    lines.forEach(function (l) {
      assert.ok(/fit check: valid/.test(l), "line carries the fit verdict: " + l);
    });
    assert.ok(!/top and top/.test(r.text), "never templates the same category twice");
    assert.ok(/24 hours/.test(r.text), "hold still promised");
    noLeak(r, "outfits reply");
    console.log("  pass: count " + expected + " matches oracle, pieces named, verdicts attached");
  }

  // --- (a2) duplicate-category wardrobe never reads "top and top" ---
  console.log("\n[(a2) two tops never template as a pair]");
  {
    const activeCats = ["base/top", "base/top"];
    const cat = catWith(activeCats, "SYNTH_ea2");
    const r = await Handler.handle({
      catalog: cat, text: "should I get this cardigan?", shareId: "SYNTH_share_ea2"
    });
    const expected = oracleCount(activeCats, "layer/cardigan");
    assert.strictEqual(claimedCount(r.text), expected, "count matches oracle (" + expected + ")");
    assert.ok(!/top and top/.test(r.text), "no duplicated-category line: " + r.text.slice(0, 300));
    if (expected > 0) {
      assert.ok(/With your top \u2014 this cardigan/.test(r.text), "each top used singly and honestly");
    }
    noLeak(r, "dup-category reply");
    console.log("  pass: count " + expected + ", no top-and-top line");
  }

  // --- (b) zero valid combos: honest branch, no fabricated count ---
  console.log("\n[(b) zero combos get the honest branch]");
  {
    const activeCats = ["base/top", "base/top"];
    const cat = catWith(activeCats, "SYNTH_eb");
    const r = await Handler.handle({
      catalog: cat, text: "should I get this scarf?", shareId: "SYNTH_share_eb"
    });
    assert.strictEqual(oracleCount(activeCats, "scarf"), 0, "oracle agrees nothing validates");
    assert.ok(/can\u2019t quite picture a complete look/.test(r.text), "honest zero branch: " + r.text.slice(0, 200));
    assert.ok(/here\u2019s why:/.test(r.text), "says why, engine-grounded");
    assert.ok(!/lovely outfit/.test(r.text), "never claims an outfit count it cannot back");
    assert.ok(!/top and top/.test(r.text), "no templated pair in the zero branch either");
    assert.ok(/held for 24 hours/.test(r.text), "hold still promised");
    noLeak(r, "zero reply");
    console.log("  pass: honest zero branch with engine reason, hold intact");
  }

  // --- (c) preview promise backed by a real call, or dropped ---
  console.log("\n[(c) preview line backed by a real imageDelivery]");
  {
    const cat = catWith(["base/top", "base/bottom"], "SYNTH_ec");
    let seenPrompt = null;
    const r = await Handler.handle({
      catalog: cat, text: "should I get this cardigan?", shareId: "SYNTH_share_ec",
      metaClient: {
        preview: async function (prompt) { seenPrompt = prompt; return { dataURL: DURL }; }
      },
      stageImage: async function (sid, durl) {
        assert.strictEqual(sid, "SYNTH_share_ec", "staged under the share id");
        assert.strictEqual(durl, DURL, "staged bytes are the preview bytes");
        return { ok: true };
      }
    });
    assert.ok(/Want a preview image too\?/.test(r.text), "offer present when a code path backs it");
    assert.ok(seenPrompt && /cardigan/.test(seenPrompt), "preview prompt names the held piece");
    assert.strictEqual(r.meta.imageDelivery.requested, true, "requested");
    assert.strictEqual(r.meta.imageDelivery.generated, true, "generated");
    assert.strictEqual(r.meta.imageDelivery.delivered, true, "delivered");
    assert.ok(r.image && r.image.dataURL === DURL, "real dataURL attached");
    assert.ok(!/can\u2019t tuck preview pictures/.test(r.text), "no caveat when delivered");
    noLeak(r, "preview reply");
    console.log("  pass: delivered:true with real dataURL, offer backed");
  }
  {
    const cat = catWith(["base/top", "base/bottom"], "SYNTH_ec2");
    const r = await Handler.handle({
      catalog: cat, text: "should I get this cardigan?", shareId: "SYNTH_share_ec2"
    });
    assert.ok(!/Want a preview image too\?/.test(r.text), "dangling promise dropped with no preview client");
    assert.strictEqual(r.meta.imageDelivery.requested, false, "not requested");
    assert.strictEqual(r.image, null, "image null");
    assert.ok(/could unlock \d+ lovely outfit/.test(r.text), "outfits still described honestly");
    noLeak(r, "no-client reply");
    console.log("  pass: no client -> no dangling line, outfits intact");
  }
  {
    const cat = catWith(["base/top", "base/bottom"], "SYNTH_ec3");
    const r = await Handler.handle({
      catalog: cat, text: "should I get this cardigan?", shareId: "SYNTH_share_ec3",
      metaClient: { preview: async function () { throw new Error("proxy down"); } },
      stageImage: async function () { return { ok: true }; }
    });
    assert.strictEqual(r.meta.imageDelivery.requested, true, "requested");
    assert.strictEqual(r.meta.imageDelivery.delivered, false, "not delivered");
    assert.strictEqual(r.image, null, "image null");
    assert.ok(/can\u2019t tuck preview pictures/.test(r.text), "honest caveat appended");
    noLeak(r, "preview-failure reply");
    console.log("  pass: preview failure fails closed with caveat");
  }

  console.log("\nAll Evaluate_prospective_purchase outfit-validation tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });

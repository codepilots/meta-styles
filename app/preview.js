"use strict";
/* meta-styles Milestone 3 — image preview stub.
 *
 * Interface: generateImage(canvas, lookCard) draws a mocked "look preview
 * image" onto the given <canvas> and resolves:
 *   { dataURL, width, height, piecesDrawn, thumbsDrawn,
 *     placeholder, placeholderNote, source }
 * The collage stacks one row per piece (thumbnail crop when available,
 * otherwise a category color block) under a title + validity pill, with a
 * "mock preview" watermark so it is never mistaken for AI imagery.
 *
 * STUB: pure client-side canvas drawing — no image model is called and
 * .env/secrets is never read here.
 *
 * TODO(Image-API): replace the body of generateImage with a real image call
 * — e.g. POST the look card (pieces + Spark copy) to the image endpoint and
 * draw the returned pixels into canvas instead of this collage. Keep the
 * return shape so the share-card UI needs no changes.
 */
(function (root) {
  var W = 600;
  var H = 760;
  var ROW_H = 132;

  var CATEGORY_COLORS = {
    "base/top": "#c9a7eb",
    "base/bottom": "#8fb8dd",
    dress: "#a8cbb0",
    "layer/cardigan": "#f2e3c6",
    "layer/blazer": "#5b6b82",
    scarf: "#e7c6e7",
    bag: "#c0c0c8",
    shoes: "#8a8a8a",
  };

  function colorFor(category) {
    if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];
    var h = 0;
    var s = String(category);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ", 35%, 78%)";
  }

  function esc(s) {
    return String(s);
  }

  function loadThumb(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // TODO(Image-API): swap this whole drawing body for the live image call.
  function generateImage(canvas, lookCard) {
    var pieces = ((lookCard && lookCard.pieces) || []).map(function (p) {
      return { id: p.id, category: p.category, thumb: p.thumb };
    });
    var valid = !!(lookCard && lookCard.valid);
    var finish = (lookCard && lookCard.finish) || "none";

    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");

    // Y2K pastel backdrop.
    var bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#fdf3ff");
    bg.addColorStop(0.55, "#efe9fb");
    bg.addColorStop(1, "#e3f2f1");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Faint sparkles (deterministic positions).
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    var sparkles = [[40, 90], [540, 60], [500, 200], [70, 260], [300, 40], [200, 700], [450, 700]];
    for (var s = 0; s < sparkles.length; s++) {
      var sx = sparkles[s][0];
      var sy = sparkles[s][1];
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Header.
    ctx.fillStyle = "#1d1a16";
    ctx.font = "700 26px system-ui, sans-serif";
    ctx.fillText("meta-styles look preview", 28, 52);
    ctx.font = "400 15px system-ui, sans-serif";
    ctx.fillStyle = "#6b6259";
    ctx.fillText("mock preview image · placeholder — not AI imagery", 28, 76);

    // Validity pill.
    var pill = valid ? "Valid full look ✔" : "Not a full look yet";
    ctx.font = "700 15px system-ui, sans-serif";
    var pillW = ctx.measureText(pill).width + 32;
    ctx.fillStyle = valid ? "#0f766e" : "#b3261e";
    roundRect(ctx, 28, 92, pillW, 30, 15);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(pill, 44, 112);
    ctx.fillStyle = "#6b6259";
    ctx.font = "400 14px system-ui, sans-serif";
    ctx.fillText("finish: " + finish, 44 + pillW, 112);

    // Piece rows (thumbnails filled in once loaded, below).
    var rowsY = 144;
    var maxRows = Math.max(pieces.length, 1);
    var rowH = Math.min(ROW_H, Math.floor((H - rowsY - 60) / Math.max(maxRows, 1)));
    var rowTop = rowsY;
    var i;
    var rowGeom = [];
    if (pieces.length === 0) {
      ctx.fillStyle = "#6b6259";
      ctx.font = "400 15px system-ui, sans-serif";
      ctx.fillText("Nothing in this look yet — tag regions above.", 28, rowsY + 24);
    }
    for (i = 0; i < pieces.length; i++) {
      (function (p, idx) {
        var y = rowTop + idx * (rowH + 12);
        rowGeom.push({ p: p, y: y });
        ctx.fillStyle = "rgba(255,253,249,0.85)";
        roundRect(ctx, 28, y, W - 56, rowH, 10);
        ctx.fill();
        ctx.strokeStyle = "#ddd5c9";
        ctx.lineWidth = 1;
        ctx.stroke();
        // Swatch placeholder (color block until thumb draws over it).
        ctx.fillStyle = colorFor(p.category);
        roundRect(ctx, 40, y + 12, rowH - 24, rowH - 24, 8);
        ctx.fill();
        ctx.fillStyle = "#1d1a16";
        ctx.font = "700 15px system-ui, sans-serif";
        ctx.fillText(esc(p.category || "piece"), 40 + rowH, y + 32);
        ctx.fillStyle = "#6b6259";
        ctx.font = "400 13px system-ui, sans-serif";
        ctx.fillText(esc(p.id || "") + " · " + (idx + 1) + "/" + pieces.length, 40 + rowH, y + 52);
      })(pieces[i], i);
    }

    // Footer watermark.
    ctx.fillStyle = "#6b6259";
    ctx.font = "400 13px system-ui, sans-serif";
    ctx.fillText("mock preview · placeholder:true (TODO(Image-API))", 28, H - 22);

    // Overlay real thumbnail crops where available; degrade to color blocks.
    var thumbs = pieces.map(function (p) { return loadThumb(p.thumb); });
    return Promise.all(thumbs).then(function (imgs) {
      var thumbsDrawn = 0;
      for (var k = 0; k < rowGeom.length; k++) {
        var img = imgs[k];
        if (!img) continue;
        var y = rowGeom[k].y;
        var side = rowH - 24;
        try {
          ctx.save();
          roundRect(ctx, 40, y + 12, side, side, 8);
          ctx.clip();
          // Cover-fit the thumbnail into the square swatch.
          var iw = img.naturalWidth || img.width;
          var ih = img.naturalHeight || img.height;
          var scale = Math.max(side / iw, side / ih);
          var dw = iw * scale;
          var dh = ih * scale;
          ctx.drawImage(img, 40 - (dw - side) / 2, y + 12 - (dh - side) / 2, dw, dh);
          ctx.restore();
          thumbsDrawn++;
        } catch (e) {
          // Keep the color block on failure.
        }
      }
      var dataURL = "";
      try {
        dataURL = canvas.toDataURL("image/png");
      } catch (e) {
        dataURL = "";
      }
      return {
        dataURL: dataURL,
        width: W,
        height: H,
        piecesDrawn: pieces.length,
        thumbsDrawn: thumbsDrawn,
        placeholder: true,
        placeholderNote:
          "Placeholder preview: canvas collage, not AI imagery (TODO(Image-API)).",
        source: "stub",
      };
    });
  }

  root.MetaStyles = root.MetaStyles || {};
  Object.assign(root.MetaStyles, { generateImage });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.MetaStyles;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

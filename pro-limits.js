/* ============================================================
 * ProTools Pro limits — shared module (7 Nov 2026, audit Fix 1).
 *
 * FREE LIMITS (canonical, cf. pro-universe lib/pro.js):
 *   photo 5 MB free / 20 MB Pro; PDF 10 MB free / 25 MB Pro.
 *
 * PRO IDENTITY = PAYMENT EMAIL, verified SERVER-SIDE only:
 *   GET https://rps-world-website.onrender.com/api/pro-check?email=...
 *   returns { isPro, pro_until, checked } — read from public.pro_orders
 *   (written only by the payment webhook). The grant NEVER comes from
 *   localStorage or any client flag: localStorage holds only the email
 *   the user typed, and every grant is re-checked server-side.
 *   Coin-trial Pro does NOT unlock these caps (per lib/pro.js).
 *
 * FAIL-CLOSED: any check failure (network, CORS, timeout, bad JSON)
 *   = free tier. A Pro grant must never come from an error path.
 *
 * NOTE (10 Nov 2026 audit): the RPS API now sends
 *   Access-Control-Allow-Origin: https://pdf-merge-split-free.vercel.app
 *   (verified live 10 Nov 2026 — GET /api/pro-check returns
 *   {"isPro":false,"pro_until":null,"checked":true} with that header),
 *   so the cross-origin check works and a paying Pro email unlocks
 *   the higher caps. The 7 Nov "no CORS header" note above is retired.
 *   Fail-closed behaviour below is unchanged: any check failure
 *   (network, CORS, timeout, bad JSON) = free tier.
 *
 * BEACON (13 Nov 2026, consent-gate removal — Ravi's decision):
 *   PTPro.beacon(method) calls window.RPSBeacon[method] unless
 *   Do Not Track is on — the old analytics-consent check is gone.
 *   Tool events are anonymous (random session id, no PII), same
 *   treatment as page_view. The consent bar still collects the
 *   choice; it just no longer blocks these events.
 * ============================================================ */
(function () {
  'use strict';

  var FREE_PHOTO_MB = 5, PRO_PHOTO_MB = 20;
  var FREE_PDF_MB = 10, PRO_PDF_MB = 25;
  var CHECK_URL = 'https://rps-world-website.onrender.com/api/pro-check';
  var COINS_URL = 'https://rps-world-website.onrender.com/coins';
  var EMAIL_KEY = 'pt-pro-email';
  var MB = 1048576;
  var CHECK_TIMEOUT_MS = 8000;

  /* Memory-only Pro cache for this tab. Never persisted as a grant. */
  var cache = { email: null, isPro: false, until: null };

  var modal = null, pending = null;

  function limitsFor(kind) {
    return kind === 'photo'
      ? { free: FREE_PHOTO_MB, pro: PRO_PHOTO_MB, kind: 'photo' }
      : { free: FREE_PDF_MB, pro: PRO_PDF_MB, kind: 'pdf' };
  }

  function fmtMB(bytes) {
    return (bytes / MB).toFixed(1) + ' MB';
  }

  function validEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
  }

  function storedEmail() {
    try { return window.localStorage.getItem(EMAIL_KEY) || ''; } catch (e) { return ''; }
  }

  function storeEmail(e) {
    try { window.localStorage.setItem(EMAIL_KEY, e); } catch (err) {}
  }

  function checkEmail(email) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; resolve({ isPro: false, checked: false, error: true }); }
      }, CHECK_TIMEOUT_MS);
      try {
        fetch(CHECK_URL + '?email=' + encodeURIComponent(email),
          { method: 'GET', mode: 'cors', credentials: 'omit' })
          .then(function (r) {
            if (!r.ok) throw new Error('http ' + r.status);
            return r.json();
          })
          .then(function (j) {
            if (done) return;
            done = true; clearTimeout(timer);
            resolve({ isPro: !!(j && j.isPro === true), until: (j && j.pro_until) || null, checked: !!(j && j.checked) });
          })
          .catch(function () {
            if (done) return;
            done = true; clearTimeout(timer);
            resolve({ isPro: false, checked: false, error: true });
          });
      } catch (e) {
        if (!done) { done = true; clearTimeout(timer); resolve({ isPro: false, checked: false, error: true }); }
      }
    });
  }

  function refreshCache(email) {
    return checkEmail(email).then(function (r) {
      if (r.isPro) cache = { email: email, isPro: true, until: r.until };
      else if (cache.email === email) cache = { email: email, isPro: false, until: null };
      return r;
    });
  }

  /* Background re-check of a stored email (best effort; never blocks tools). */
  (function init() {
    var em = storedEmail();
    if (em && validEmail(em)) { refreshCache(em).catch(function () {}); }
  })();

  /* Synchronous gate for non-async handlers (photo pages): free limit,
   * or a Pro grant verified earlier this session. Anything else is
   * blocked and goes through the modal (which does the async check). */
  function allowSync(file, kind) {
    var L = limitsFor(kind);
    if (file.size <= L.free * MB) return true;
    if (cache.isPro && cache.email && file.size <= L.pro * MB) return true;
    fireFreeLimitHit(kind, file);
    return false;
  }

  /* Async check for async handlers (merge/split/extractor/compressor).
   * Returns { ok, pro, reason?, checkFailed? }.
   * reason 'over-free' = above free limit, not Pro (or check failed).
   * reason 'over-pro'  = above the Pro limit too — Pro cannot help. */
  async function checkFile(file, kind) {
    var L = limitsFor(kind);
    if (file.size <= L.free * MB) return { ok: true, pro: false };
    if (cache.isPro && cache.email) {
      if (file.size <= L.pro * MB) return { ok: true, pro: true };
      return { ok: false, reason: 'over-pro', limitMB: L.pro };
    }
    var em = storedEmail();
    if (em && validEmail(em)) {
      var r = await refreshCache(em);
      if (r.isPro) {
        if (file.size <= L.pro * MB) return { ok: true, pro: true };
        return { ok: false, reason: 'over-pro', limitMB: L.pro };
      }
      fireFreeLimitHit(kind, file);
      return { ok: false, reason: 'over-free', checkFailed: !!r.error };
    }
    fireFreeLimitHit(kind, file);
    return { ok: false, reason: 'over-free' };
  }

  /* ---------- upgrade prompt modal ---------- */
  function injectStyle() {
    if (document.getElementById('pt-pro-style')) return;
    var s = document.createElement('style');
    s.id = 'pt-pro-style';
    s.textContent =
      '#pt-pro-modal{position:fixed;inset:0;z-index:10002;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,8,20,.72);}' +
      '#pt-pro-modal .pt-pro-card{background:#1e1b2e;border:1px solid #3b3654;border-radius:16px;max-width:440px;width:100%;padding:20px;color:#e6e0e9;font-family:inherit;box-shadow:0 12px 40px rgba(0,0,0,.5);}' +
      '#pt-pro-modal .pt-pro-title{font-weight:800;font-size:17px;margin:0 0 8px;color:#fff;}' +
      '#pt-pro-modal .pt-pro-copy{font-size:14px;line-height:1.5;margin:0 0 6px;color:#fff;}' +
      '#pt-pro-modal .pt-pro-file{font-size:12.5px;color:#a99fc0;margin:0 0 12px;}' +
      '#pt-pro-modal .pt-pro-hint{font-size:12.5px;line-height:1.5;color:#a99fc0;margin:0 0 8px;}' +
      '#pt-pro-modal input{width:100%;box-sizing:border-box;background:#12121f;border:1px solid #3b3654;border-radius:10px;color:#fff;font:inherit;font-size:14px;padding:10px 12px;margin-bottom:8px;}' +
      '#pt-pro-modal input:focus{outline:2px solid #7c3aed;outline-offset:1px;}' +
      '#pt-pro-modal .pt-pro-status{font-size:13px;line-height:1.45;min-height:19px;margin:0 0 10px;color:#fbbf24;}' +
      '#pt-pro-modal .pt-pro-status.ok{color:#4ade80;}' +
      '#pt-pro-modal .pt-pro-btns{display:flex;flex-direction:column;gap:8px;}' +
      '#pt-pro-modal .pt-pro-btns button,#pt-pro-modal .pt-pro-btns a{font:inherit;font-size:14px;font-weight:700;padding:11px 14px;border-radius:12px;border:none;cursor:pointer;text-align:center;text-decoration:none;}' +
      '#pt-pro-modal #pt-pro-check{background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;}' +
      '#pt-pro-modal #pt-pro-upgrade{background:#2e2c3a;color:#eaddff;border:1px solid #4a4757;}' +
      '#pt-pro-modal #pt-pro-close{background:transparent;color:#a99fc0;font-weight:600;}' +
      '#pt-pro-modal button:disabled{opacity:.55;cursor:wait;}';
    document.head.appendChild(s);
  }

  function copyFor(kind) {
    return kind === 'photo'
      ? 'Free limit: 5 MB photo. Pro (₹149/mo) allows 20 MB.'
      : 'Free limit: 10 MB. Pro allows 25 MB.';
  }

  function buildModal() {
    if (modal) return modal;
    injectStyle();
    var m = document.createElement('div');
    m.id = 'pt-pro-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', 'File size limit');
    m.innerHTML =
      '<div class="pt-pro-card">' +
      '<p class="pt-pro-title">File size limit</p>' +
      '<p class="pt-pro-copy" id="pt-pro-copy"></p>' +
      '<p class="pt-pro-file" id="pt-pro-file"></p>' +
      '<p class="pt-pro-hint">Pro ho? Apni payment email daalo — server se check hoga, koi login nahi chahiye. Email sirf is browser me save hoti hai.</p>' +
      '<input id="pt-pro-email" type="email" placeholder="Payment email (jaise order me di thi)" autocomplete="email" inputmode="email">' +
      '<p class="pt-pro-status" id="pt-pro-status"></p>' +
      '<div class="pt-pro-btns">' +
      '<button type="button" id="pt-pro-check">Pro check karo</button>' +
      '<a id="pt-pro-upgrade" href="' + COINS_URL + '" target="_blank" rel="noopener">Upgrade to Pro — ₹149/mo</a>' +
      '<button type="button" id="pt-pro-close">Baad me</button>' +
      '</div></div>';
    document.body.appendChild(m);
    m.querySelector('#pt-pro-close').addEventListener('click', function () { closeModal(); });
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    m.querySelector('#pt-pro-check').addEventListener('click', onCheckClick);
    /* Measure-first (Phase 1): Buy Pro click on the upgrade link. */
    var upg = m.querySelector('#pt-pro-upgrade');
    if (upg) upg.addEventListener('click', function () { try { beacon('proClick'); } catch (e) {} });
    modal = m;
    return m;
  }

  function setStatus(text, ok) {
    var el = modal && modal.querySelector('#pt-pro-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('ok', !!ok);
  }

  function closeModal() {
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    modal = null;
    pending = null;
  }

  function onCheckClick() {
    if (!pending) return;
    var input = modal.querySelector('#pt-pro-email');
    var email = String(input.value || '').trim().toLowerCase();
    if (!validEmail(email)) {
      setStatus('Sahi email daalo — jaise Pro order me di thi.');
      return;
    }
    var btn = modal.querySelector('#pt-pro-check');
    btn.disabled = true;
    setStatus('Check ho raha hai…');
    checkEmail(email).then(function (r) {
      btn.disabled = false;
      if (r.error) {
        setStatus('Pro check abhi nahi ho paya (server se connect nahi hua) — free limit hi lagu hai. Dobara try karo.');
        return;
      }
      if (!r.isPro) {
        setStatus('Is email par Pro active nahi hai — pehle Pro khareedo, ya sahi payment email daalo.');
        return;
      }
      storeEmail(email);
      cache = { email: email, isPro: true, until: r.until };
      var L = limitsFor(pending.kind);
      var fitting = pending.files.filter(function (f) { return f.size <= L.pro * MB; });
      var over = pending.files.length - fitting.length;
      if (over > 0) {
        setStatus('Pro active hai ✓ — lekin ' + over + ' file Pro limit (' + L.pro + ' MB) se bhi badi hai, wo skip hogi.', true);
        btn.textContent = fitting.length ? 'Continue with ' + fitting.length + ' file(s)' : 'Theek hai';
        btn.onclick = function () {
          var cb = pending && pending.onAllowed;
          var list = fitting.slice();
          closeModal();
          if (cb && list.length) cb(list);
        };
        return;
      }
      setStatus('Pro active hai ✓ — file khul rahi hai.', true);
      var cb2 = pending && pending.onAllowed;
      var list2 = pending.files.slice();
      closeModal();
      if (cb2) cb2(list2);
    });
  }

  /* Show the prompt for one or more blocked files. onAllowed(files)
   * is called with the files that fit after a successful Pro check. */
  function promptForFiles(files, kind, onAllowed) {
    if (!files || !files.length) return;
    var m = buildModal();
    var L = limitsFor(kind);
    pending = { files: files.slice(), kind: kind, onAllowed: onAllowed };
    m.querySelector('#pt-pro-copy').textContent = copyFor(kind);
    var biggest = files.reduce(function (a, f) { return f.size > a.size ? f : a; }, files[0]);
    m.querySelector('#pt-pro-file').textContent =
      (files.length > 1 ? files.length + ' files — sabse badi: ' : 'Tumhari file: ') +
      fmtMB(biggest.size) + ' (free limit ' + L.free + ' MB)';
    var input = m.querySelector('#pt-pro-email');
    input.value = storedEmail();
    var btn = m.querySelector('#pt-pro-check');
    btn.textContent = 'Pro check karo';
    btn.onclick = onCheckClick;
    setStatus('');
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
  }

  function promptForFile(file, kind, onAllowed) {
    promptForFiles([file], kind, function (list) {
      if (onAllowed && list.length) onAllowed(list[0]);
    });
  }

  /* ---------- Batch 1 — mobile UX guards + file-size guardrail ----------
   * KEYBOARD TRAP (Gemini audit §3.2): on budget Android portrait the
   * virtual keyboard covers ~50% of the screen when a KB input is
   * tapped. Scroll the focused input to the top of the viewport
   * (m3.css gives inputs scroll-margin-top so the sticky header
   * never covers it). 350ms delay lets the keyboard animate in.
   * FILE-SIZE GUARDRAIL (Gemini audit §3.3): a 50MB PDF / 30MB photo
   * can OOM-crash the tab in pdf-lib/canvas on a low-memory phone.
   * Refuse BEFORE any bytes are read, with a plain-Hindi message —
   * never a silent crash. Limits are hard caps (above even Pro):
   * PDF single 50MB, photo single 30MB, merge total 100MB. */
  var HARD_PDF_MB = 50, HARD_PHOTO_MB = 30, HARD_MERGE_TOTAL_MB = 100;

  function guardFile(file, kind) {
    var cap = kind === 'photo' ? HARD_PHOTO_MB : HARD_PDF_MB;
    if (!file) return { ok: true };
    if (file.size > cap * MB) {
      return { ok: false, reason: kind === 'photo'
        ? 'Photo bahut badi hai (' + fmtMB(file.size) + ' — 30 MB se zyada). Phone par crash ho sakti hai — chhoti photo try karo.'
        : 'File bahut badi hai (' + fmtMB(file.size) + ' — 50 MB se zyada). Phone par crash ho sakti hai — laptop par try karo ya PDF chhoti karo.' };
    }
    return { ok: true };
  }

  function guardFiles(files, kind) {
    var list = files ? Array.prototype.slice.call(files) : [];
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      var r = guardFile(list[i], kind);
      if (!r.ok) return r;
      total += list[i].size || 0;
    }
    if (kind !== 'photo' && total > HARD_MERGE_TOTAL_MB * MB) {
      return { ok: false, reason: 'Total size ' + fmtMB(total) + ' hai (100 MB se zyada) — phone par crash ho sakta hai. Kam files ek saath merge karo.' };
    }
    return { ok: true };
  }

  (function initMobileGuards() {
    try {
      document.addEventListener('focusin', function (e) {
        var t = e.target;
        if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        var type = (t.type || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio' || type === 'file' ||
            type === 'button' || type === 'submit' || type === 'hidden') return;
        setTimeout(function () {
          try { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (err) {}
        }, 350);
      });
    } catch (e) {}
  })();

  /* ---------- beacon (DNT-gated only since 13 Nov 2026) ----------
   * Consent-gate removed by Ravi's decision: tool funnel events are
   * anonymous by design, same as page_view. Only Do Not Track still
   * blocks. No consent value is read here anymore. */
  function beaconAllowed() {
    try {
      var d = navigator.doNotTrack || window.doNotTrack;
      if (d === '1' || d === 'yes') return false;
      return true;
    } catch (e) { return false; }
  }

  function beacon(method, arg) {
    try {
      if (beaconAllowed() && window.RPSBeacon && typeof window.RPSBeacon[method] === 'function') {
        window.RPSBeacon[method](arg);
      }
    } catch (e) {}
  }

  /* ---------- Phase 1 (10 Nov 2026) — two-sided JPEG size-band ----------
   * encodeToBand / validateJpeg / renderChecks.
   * RULES (hard): output is produced ONLY by legitimate re-encode
   * (dimension scaling + JPEG quality). NEVER junk-byte padding, NEVER
   * fake DPI metadata. If a compliant file is not reachable without
   * harming readability, the encoder returns ok:false and the UI shows
   * FAIL + "better-resolution scan" guidance instead of a download.
   * Resolution is checked honestly: required pixels = stated physical
   * width (spec.dpiWidthMm) at 100 DPI. No JFIF density is claimed —
   * encoder-written density says nothing about the source scan.
   * DPI STAMP (opt-in, 11 Nov 2026 — CWC): when a spec declares
   * spec.dpi AND spec.dpiWidthMm, the encoder stamps JFIF density=dpi
   * (units=1, dots per inch) ONLY if the produced pixels genuinely
   * cover that physical width at that DPI. The stamp then states a
   * true fact about the output (e.g. 240 px for a 3 cm thumb IS 200
   * DPI, per the notification's own numbers). If the pixels fall
   * short, nothing is stamped and validateJpeg's dpi check FAILS —
   * a file is never called 200 DPI on pixels alone. Specs without
   * spec.dpi are untouched: no density is written, no DPI claimed. */
  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve) {
      try {
        canvas.toBlob(function (b) { resolve(b || null); }, 'image/jpeg', quality);
      } catch (e) { resolve(null); }
    });
  }

  function fitDims(w, h, spec) {
    var maxDim = spec.maxDim || 1200;
    var s = 1;
    if (Math.max(w, h) > maxDim) s = maxDim / Math.max(w, h);
    var nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
    var us = Math.max((spec.minW || 0) / nw, (spec.minH || 0) / nh);
    if (us > 1) { nw = Math.round(nw * us); nh = Math.round(nh * us); }
    return { w: nw, h: nh };
  }

  function drawScaled(img, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  }

  /* Stamp JFIF APP0 density (units=1, dots per inch) with Xdensity =
   * Ydensity = dpi. Patches the existing JFIF APP0 in place when
   * present, else inserts a minimal APP0 right after SOI. Returns the
   * stamped Blob, or null if the patch could not be applied (caller
   * keeps the original blob — never a corrupt file). */
  async function setJfifDensity(blob, dpi) {
    try {
      var buf = await blob.arrayBuffer();
      var b = new Uint8Array(buf);
      if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
      var hi = (dpi >> 8) & 0xFF, lo = dpi & 0xFF;
      if (b[2] === 0xFF && b[3] === 0xE0) {
        var len = (b[4] << 8) | b[5];
        if (len >= 16 && b[6] === 0x4A && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46 && b[10] === 0x00) {
          var out = new Uint8Array(b);
          out[13] = 1; out[14] = hi; out[15] = lo; out[16] = hi; out[17] = lo;
          return new Blob([out], { type: 'image/jpeg' });
        }
      }
      var app0 = new Uint8Array([0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, hi, lo, hi, lo, 0x00, 0x00]);
      var merged = new Uint8Array(2 + app0.length + (b.length - 2));
      merged.set(b.subarray(0, 2), 0);
      merged.set(app0, 2);
      merged.set(b.subarray(2), 2 + app0.length);
      return new Blob([merged], { type: 'image/jpeg' });
    } catch (e) { return null; }
  }

  /* Try to land inside [minKb, maxKb] by legitimate re-encode only.
   * Returns { ok, blob, dataUrl, kb, width, height, failReason, failHint }.
   * failReason: 'too-small' (even largest dims at q=0.95 stay under the
   * floor — source lacks detail/pixels) | 'too-big' (even smallest dims
   * at q=0.05 stay over the ceiling) | 'unreachable'. */
  async function encodeToBand(img, spec) {
    var minKb = spec.minKb, maxKb = spec.maxKb;
    var target = spec.targetKb || Math.round((minKb + maxKb) / 2);
    target = Math.max(minKb, Math.min(maxKb, target));
    var base = fitDims(img.naturalWidth || img.width, img.naturalHeight || img.height, spec);
    var maxDim = spec.maxDim || 1200;
    /* Candidate dimensions, largest first (best quality first). Upscale
     * steps (1.5x/2x, capped at maxDim) are legitimate re-encode: the
     * pixels are real image data, just interpolated — no junk bytes. */
    var cands = [], seen = {};
    [2.0, 1.5, 1.0, 0.8, 0.65, 0.5, 0.38, 0.28].forEach(function (f) {
      var w = Math.round(base.w * f), h = Math.round(base.h * f);
      if (Math.max(w, h) > maxDim) { var s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      if (w < (spec.minW || 0) || h < (spec.minH || 0)) return;
      var k = w + 'x' + h;
      if (!seen[k]) { seen[k] = 1; cands.push({ w: w, h: h }); }
    });
    cands.sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
    var best = null; /* closest miss, for preview only */
    function noteBest(blob, kb, w, h) {
      if (!blob) return;
      var d = kb < minKb ? (minKb - kb) : (kb - maxKb);
      if (!best || d < best.dist) best = { blob: blob, kb: kb, w: w, h: h, dist: d };
    }
    for (var ci = 0; ci < cands.length; ci++) {
      var dim = cands[ci];
      var canvas = drawScaled(img, dim.w, dim.h);
      var hiBlob = await canvasToBlob(canvas, 0.95);
      if (!hiBlob) continue;
      var hiKb = hiBlob.size / 1024;
      noteBest(hiBlob, hiKb, dim.w, dim.h);
      if (hiKb < minKb) continue; /* even max quality is under the floor at these dims */
      var loBlob = await canvasToBlob(canvas, 0.05);
      if (!loBlob) continue;
      var loKb = loBlob.size / 1024;
      noteBest(loBlob, loKb, dim.w, dim.h);
      if (loKb > maxKb) continue; /* even min quality is over the ceiling at these dims */
      var lo = 0.05, hi = 0.95, mid = target, out = null, outKb = 0;
      for (var it = 0; it < 12; it++) {
        var q = (lo + hi) / 2;
        var b = await canvasToBlob(canvas, q);
        if (!b) break;
        var kb = b.size / 1024;
        noteBest(b, kb, dim.w, dim.h);
        if (kb >= minKb && kb <= maxKb) { out = b; outKb = kb; break; }
        if (kb > maxKb) { hi = q; } else { lo = q; }
        mid = kb;
      }
      if (out) {
        var stamped = false;
        if (spec.dpi && spec.dpiWidthMm) {
          var reqPx = Math.round(spec.dpiWidthMm / 25.4 * spec.dpi);
          if (dim.w >= reqPx) {
            var patched = await setJfifDensity(out, spec.dpi);
            if (patched) { out = patched; stamped = true; }
          }
        }
        return { ok: true, blob: out, dataUrl: URL.createObjectURL(out), kb: Math.round(out.size / 1024), width: dim.w, height: dim.h, dpiStamped: stamped };
      }
      void mid;
    }
    var reason = 'unreachable', hint = 'Is file se ' + minKb + '–' + maxKb + ' KB band me compliant file nahi ban payi. Better-resolution scan try karo — saaf, badi photo chuno.';
    if (best) {
      if (best.kb < minKb) { reason = 'too-small'; hint = 'Ye scan ' + minKb + ' KB floor tak nahi pahunch paya — photo me detail/pixels kam hain. Better-resolution scan (saaf, badi, 100 DPI ya zyada) try karo.'; }
      else if (best.kb > maxKb) { reason = 'too-big'; hint = 'Ye photo ' + maxKb + ' KB ceiling se neeche nahi aa payi bina readability kharab kiye. Chhoti ya kam-detail wali photo try karo.'; }
    }
    var prev = best ? { blob: best.blob, dataUrl: URL.createObjectURL(best.blob), kb: Math.round(best.kb), width: best.w, height: best.h } : null;
    return { ok: false, blob: prev ? prev.blob : null, dataUrl: prev ? prev.dataUrl : null, kb: prev ? prev.kb : 0, width: prev ? prev.width : 0, height: prev ? prev.height : 0, failReason: reason, failHint: hint };
  }

  /* Validate a produced JPEG blob against the spec. Decodes it (a blob
   * that does not decode is not a valid JPEG). Resolution is checked
   * from pixels vs the stated physical width at 100 DPI — never from
   * metadata. Returns { ok, sizeKb, width, height, checks:[...] }.
   * checks entries: { key, pass: true|false|null, text } — pass null
   * means "could not be verified" (amber, not a pass). */
  async function validateJpeg(blob, spec) {
    var checks = [];
    var sizeKb = blob ? Math.round(blob.size / 1024) : 0;
    var fmtOk = false, w = 0, h = 0;
    if (blob && blob.size >= 3) {
      try {
        var head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
        fmtOk = (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF);
      } catch (e) { fmtOk = false; }
    }
    if (fmtOk) {
      try {
        var bmp = await createImageBitmap(blob);
        w = bmp.width; h = bmp.height;
        try { bmp.close(); } catch (e2) {}
      } catch (e3) { fmtOk = false; }
    }
    checks.push({ key: 'format', pass: fmtOk, text: 'Format: ' + (fmtOk ? 'JPEG (valid, decodes correctly)' : 'JPEG nahi hai ya file kharab hai') });
    var sizeOk = sizeKb >= spec.minKb && sizeKb <= spec.maxKb;
    checks.push({ key: 'size', pass: sizeOk, text: 'File size: ' + sizeKb + ' KB — ' + (sizeOk ? 'band ' + spec.minKb + '–' + spec.maxKb + ' KB ke andar ✓' : (sizeKb < spec.minKb ? 'band se neeche (' + spec.minKb + ' KB floor)' : 'band se upar (' + spec.maxKb + ' KB ceiling)')) });
    var dimOk = w >= (spec.minW || 0) && h >= (spec.minH || 0);
    checks.push({ key: 'dimensions', pass: dimOk, text: 'Dimensions: ' + w + ' × ' + h + ' px — ' + (dimOk ? 'minimum ' + spec.minW + ' × ' + spec.minH + ' px ✓' : 'minimum ' + spec.minW + ' × ' + spec.minH + ' px se chhota') });
    var resPass = null, resText;
    if (spec.dpiWidthMm) {
      var reqPx = Math.round(spec.dpiWidthMm / 25.4 * 100);
      resPass = w >= reqPx;
      resText = 'Resolution: ' + w + ' px wide — ' + (resPass ? '100 DPI par ' + spec.dpiWidthMm + ' mm cover karta hai ✓' : '100 DPI ke liye kam hai (kam se kam ' + reqPx + ' px chahiye) — better-resolution scan try karo');
    } else {
      resText = 'Resolution: is file se verify nahi ho paya — 100 DPI ya zyada par scan karein (DPI metadata se fake nahi kiya gaya)';
    }
    checks.push({ key: 'resolution', pass: resPass, text: resText });
    if (spec.dpi) {
      var dpiReqPx = Math.round((spec.dpiWidthMm || 0) / 25.4 * spec.dpi);
      var dpiMeta = null;
      try {
        var head20 = new Uint8Array(await blob.slice(0, 20).arrayBuffer());
        if (head20.length >= 20 && head20[2] === 0xFF && head20[3] === 0xE0 && head20[6] === 0x4A) {
          dpiMeta = { units: head20[13], x: (head20[14] << 8) | head20[15], y: (head20[16] << 8) | head20[17] };
        }
      } catch (e) { dpiMeta = null; }
      var dpiPxOk = w >= dpiReqPx;
      var dpiMetaOk = !!(dpiMeta && dpiMeta.units === 1 && dpiMeta.x === spec.dpi && dpiMeta.y === spec.dpi);
      var dpiOk = dpiPxOk && dpiMetaOk;
      checks.push({ key: 'dpi', pass: dpiOk, text: 'DPI: ' + (dpiOk ? spec.dpi + ' DPI — pixels + JFIF metadata, dono se verified ✓' : (dpiPxOk ? 'pixels ' + spec.dpi + ' DPI ke liye kaafi hain, par file me DPI metadata nahi mila — dobara try karo' : 'pixels ' + spec.dpi + ' DPI ke liye kam hain (' + dpiReqPx + ' px chahiye) — better-resolution scan try karo')) });
    }
    var ok = checks.every(function (c) { return c.pass !== false; }) && fmtOk && sizeOk && dimOk;
    return { ok: ok, sizeKb: sizeKb, width: w, height: h, checks: checks };
  }

  /* Render per-check PASS/FAIL rows into an element. */
  function renderChecks(el, checks) {
    if (!el) return;
    var html = '<div style="text-align:left;margin-top:10px;font-size:13px;line-height:1.7">';
    checks.forEach(function (c) {
      var icon = c.pass === true ? '✅' : (c.pass === false ? '❌' : '⚠️');
      var col = c.pass === true ? '#4ade80' : (c.pass === false ? '#f87171' : '#fbbf24');
      html += '<div style="color:' + col + '">' + icon + ' ' + c.text + '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  /* ---------- Phase 1 (10 Nov 2026) — measure-first instrumentation ----------
   * MEASUREMENT ONLY: no fence, no paywall, no UI change. Fires when a
   * file hits the FREE size limit (photo 5MB / PDF 10MB) — via the
   * beacon's free_limit_hit funnel event (DNT-gated only since
   * 13 Nov 2026, no PII: only kind + rounded MB sizes). Buy Pro clicks are measured via
   * the existing proClick event, wired on the upgrade link below. */
  function fireFreeLimitHit(kind, file) {
    try {
      var L = limitsFor(kind);
      beacon('freeLimitHit', { kind: kind, limitMB: L.free, fileMB: Math.round((file.size || 0) / MB * 10) / 10 });
    } catch (e) {}
  }

  window.PTPro = {
    FREE_PHOTO_MB: FREE_PHOTO_MB, PRO_PHOTO_MB: PRO_PHOTO_MB,
    FREE_PDF_MB: FREE_PDF_MB, PRO_PDF_MB: PRO_PDF_MB,
    COINS_URL: COINS_URL, CHECK_URL: CHECK_URL,
    allowSync: allowSync, checkFile: checkFile,
    encodeToBand: encodeToBand, validateJpeg: validateJpeg, renderChecks: renderChecks,
    guardFile: guardFile, guardFiles: guardFiles,
    promptForFile: promptForFile, promptForFiles: promptForFiles,
    beacon: beacon, refreshCache: refreshCache,
    limitsFor: limitsFor
  };
})();

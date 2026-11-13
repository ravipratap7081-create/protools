/* ============================================================
 * ProTools privacy notice — DISCREET bottom bar.
 * HONEST NOTICE (13 Nov 2026): anonymous usage stats are collected
 * for every visitor (same as page views always were) — the beacon
 * gates on Do Not Track only, so there is NO Accept/Reject choice
 * anymore. The old Accept/Reject bar promised "Reject = off" while
 * the beacon ignored the choice; that was misleading and is gone.
 * One button only: "Samajh gaya" dismisses the notice. The notice
 * is shown once per visitor (stored version 'v3' in localStorage);
 * old v1/v2 choices are re-shown once so everyone sees the truth.
 * Footer "Privacy choices" link (injected into every <footer>) re-
 * opens the notice; window.openConsentBanner does the same.
 * Dismissing still dispatches 'rps-consent-decided' — the install
 * banner waits for it before showing, so the notice is never covered.
 * No animation, no overlay, no modal — a small footer-like bar.
 * ============================================================ */
(function () {
  'use strict';

  var KEY = 'rps-consent-v1';
  var BAR_ID = 'rps-consent-bar';
  var LINK_ATTR = 'data-rps-consent-link';
  var shown = false;
  var bar = null;

  function readChoice() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function needsAsk() {
    var c = readChoice();
    if (!c) return true;
    return c.version !== 'v3'; // old v1/v2 choices are re-shown once (honest notice, 13 Nov 2026)
  }

  /* Notice-seen flag only — there is no analytics choice anymore
   * (the beacon is DNT-gated only). Stored so the notice shows once. */
  function writeSeen() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({
        notice_seen: true,
        decided_at: new Date().toISOString(),
        version: 'v3'
      }));
    } catch (e) {}
  }

  function injectStyle() {
    if (document.getElementById('rps-consent-style')) return;
    var s = document.createElement('style');
    s.id = 'rps-consent-style';
    s.textContent =
      '#' + BAR_ID + '{position:fixed;left:0;right:0;bottom:0;z-index:10001;' +
      'background:#1b1b28;border-top:1px solid #2e2c3a;' +
      'color:#c9c3d4;font-family:inherit;}' +
      '#' + BAR_ID + ' .rps-cb-in{max-width:960px;margin:0 auto;padding:10px 14px;' +
      'display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;}' +
      '#' + BAR_ID + ' .rps-cb-t{flex:1 1 260px;font-size:12.5px;line-height:1.45;margin:0;}' +
      '#' + BAR_ID + ' .rps-cb-t a{color:#d0bcff;text-decoration:underline;}' +
      '#' + BAR_ID + ' .rps-cb-b{display:flex;gap:8px;flex-shrink:0;}' +
      '#' + BAR_ID + ' button{font:inherit;font-size:12.5px;font-weight:600;' +
      'padding:7px 16px;min-width:84px;border-radius:999px;cursor:pointer;' +
      'border:1px solid transparent;text-align:center;}' +
      '#' + BAR_ID + ' .rps-cb-ok{background:#7c3aed;color:#fff;}' +
      '#' + BAR_ID + ' button:hover{filter:brightness(1.15);}' +
      '#' + BAR_ID + ' button:focus-visible{outline:2px solid #d0bcff;outline-offset:2px;}' +
      '@media (max-width:480px){#' + BAR_ID + ' .rps-cb-t{font-size:12px;}' +
      '#' + BAR_ID + ' button{min-width:76px;padding:7px 14px;}}';
    document.head.appendChild(s);
  }

  function padBody() {
    try {
      if (bar) document.body.style.paddingBottom = bar.offsetHeight + 'px';
    } catch (e) {}
  }

  function unpadBody() {
    try { document.body.style.paddingBottom = ''; } catch (e) {}
  }

  function hide() {
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    bar = null;
    shown = false;
    unpadBody();
  }

  function dismiss() {
    writeSeen();
    /* Tell the install banner the notice is handled (it waits for
     * this event before showing, so the notice is never covered). */
    try { window.dispatchEvent(new Event('rps-consent-decided')); } catch (e) {}
    hide();
  }

  function show() {
    if (shown) return;
    injectStyle();
    bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Privacy notice');
    var inner = document.createElement('div');
    inner.className = 'rps-cb-in';
    var text = document.createElement('p');
    text.className = 'rps-cb-t';
    text.textContent = 'Hum anonymous usage stats collect karte hain taaki tools behtar ban sakein — koi personal data nahi, aapki files kabhi upload nahi hoti. ';
    var pl = document.createElement('a');
    pl.href = '/privacy-policy';
    pl.textContent = 'Privacy Policy';
    text.appendChild(pl);
    var btns = document.createElement('div');
    btns.className = 'rps-cb-b';
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'rps-cb-ok';
    ok.textContent = 'Samajh gaya';
    ok.addEventListener('click', function () { dismiss(); });
    btns.appendChild(ok);
    inner.appendChild(text);
    inner.appendChild(btns);
    bar.appendChild(inner);
    document.body.appendChild(bar);
    shown = true;
    padBody();
    try { window.addEventListener('resize', padBody); } catch (e) {}
  }

  function injectFooterLink() {
    try {
      var footers = document.querySelectorAll('footer');
      for (var i = 0; i < footers.length; i++) {
        var f = footers[i];
        if (f.querySelector('[' + LINK_ATTR + ']')) continue;
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute(LINK_ATTR, '1');
        b.textContent = 'Privacy choices';
        b.style.cssText = 'background:none;border:none;padding:0;margin:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer;';
        b.addEventListener('click', function () { show(); });
        var host = f.querySelector('div') || f;
        host.appendChild(b);
      }
    } catch (e) {}
  }

  function init() {
    injectFooterLink();
    if (needsAsk()) show();
  }

  window.openConsentBanner = function () { show(); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// The browser side of the text-fit checks (test/ui/room-fit.e2e.test.js, test/ui/lobby-hub.e2e.test.js — §35.18 review):
// a function passed to page.evaluate. Not a test file itself.

/**
 * In the page: the text problems under `rootSel`. Each visible text node's line boxes (a glyph box's middle ± half the line
 * height) against every ancestor up to the root that clips (overflow) or draws a box (background, border, a button) —
 * 2 px of slack for hairlines —, an ancestor that scrolls on that axis ending the climb; the viewport; the other labels'
 * text as it shows (clipped by its clipping ancestors); a line break inside a word (but in a player's name) (not at a space, a hyphen — unless a digit follows it — or between
 * CJK / kana; Korean puts spaces between its words, so a break between two Hangul syllables — or a syllable and a latin
 * letter or digit — is inside a word too, keep-all or not: under word-break: keep-all such a break is the overflow-wrap
 * fallback of a word too long for its box); a line that starts with a small kana, ー, an iteration mark or a closing
 * mark (Japanese line-breaking rules, 禁則; also Chinese for the closing marks — line-break: normal lets Chrome break
 * before a small kana and ー); an ellipsis (one line's, or a line clamp's) anywhere but a player's name (.seat__name, .specbar__who) or a
 * plugin mode's own name (.room-mode, cut by design like a name), or a selector explicitly allowed by the caller;
 * the page scrolling. `extraEllipsis` scopes an existing compact-label policy to the suite that checks its full
 * accessible name and control bounds (the room's version pill, §35.23.11).
 */
export function textProblems(rootSel, extraEllipsis = '') {
  const TOL = 2;
  const out = [];
  const texts = [];
  const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className ?? '').trim().split(/\s+/)[0]}`;
  const isBox = (cs) => cs.backgroundImage !== 'none' || !/^(transparent|rgba\(\d+, \d+, \d+, 0\))$/.test(cs.backgroundColor)
    || ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none');
  const scrolls = (v) => v === 'auto' || v === 'scroll';
  const cjk = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/;
  const hangul = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
  const letter = /[\p{L}\p{N}]/u;
  // may not start a line: small kana, the prolonged sound mark, iteration marks, closing brackets and punctuation
  const noStart = /[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰ-ㇿーゝゞヽヾ々、。，．・：；！？）」』】〉》〕］｝〗〙]/;
  // may a line break between p and c? a space / hyphen / slash / dot before it; between CJK or kana; at Hangul only where
  // one side is not a letter or digit (punctuation such as ：)
  // (a hyphen before a digit is part of a code such as AC-2, not a place to break: §35.18 review of the text-fit fixes)
  const breakOk = (p, c) => (/[\s\-\u2010\u2013\u2014/\u00b7\u30fb]/.test(p) && !(/[-\u2010]/.test(p) && /\d/.test(c)))
    || (hangul.test(p) || hangul.test(c) ? !(letter.test(p) && letter.test(c)) : cjk.test(p) || cjk.test(c));
  // the word of text node `n` around index `i` is wider than `el`'s content box (measured on one line in its font)
  const wordWider = (n, i, el) => {
    const t = n.textContent;
    let a = i, b = i;
    while (a > 0 && !/\s/.test(t[a - 1])) a--;
    while (b < t.length && !/\s/.test(t[b])) b++;
    const cs = getComputedStyle(el), g = document.createElement('canvas').getContext('2d');
    g.font = cs.font;
    const box = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return g.measureText(t.slice(a, b)).width > box + 0.5;
  };
  for (const root of document.querySelectorAll(rootSel)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const txt = n.textContent.trim();
      const el = n.parentElement;
      if (!txt || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) || el.closest('.sr-only')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!rects.length) continue;
      const cs = getComputedStyle(el);
      const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
      const label = `${name(el)} "${txt.slice(0, 30)}"`;
      let boxes = rects.map((r) => { const m = (r.top + r.bottom) / 2, hh = Math.min(r.height, lh) / 2; return { l: r.left, r: r.right, t: m - hh, b: m + hh }; });
      // An ellipsis — on one line, or the last of a line clamp (a long name's two lines on a phone, §35.51): only the
      // known name exceptions and a caller's scoped exception; what shows is the box (a clamp's later lines are hidden).
      const clamped = (a) => { const v = getComputedStyle(a).webkitLineClamp; return !!v && v !== 'none' && a.scrollHeight > a.clientHeight + 1; };
      const cut = [el, el.parentElement].find((a) => a && ((getComputedStyle(a).textOverflow === 'ellipsis' && a.scrollWidth > a.clientWidth + 1) || clamped(a)));
      if (cut) {
        if (!cut.matches(`.seat__name, .specbar__who, .room-mode${extraEllipsis ? `, ${extraEllipsis}` : ''}`)) out.push(`ellipsis ${label}`);
        const ar = cut.getBoundingClientRect();
        boxes = boxes.map((b) => ({ ...b, l: Math.max(b.l, ar.left), r: Math.min(b.r, ar.right) }));
        if (clamped(cut)) boxes = boxes.filter((b) => (b.t + b.b) / 2 < ar.bottom);
      }
      let pastX = false, pastY = false;
      for (let a = el; a && a !== root.parentElement && !(pastX && pastY); a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.display === 'contents') continue;
        const clipX = acs.overflowX !== 'visible', clipY = acs.overflowY !== 'visible';
        const box = isBox(acs) || a.tagName === 'BUTTON';
        if (!cut && (clipX || clipY || box)) {
          const ar = a.getBoundingClientRect();
          const L = ar.left + parseFloat(acs.borderLeftWidth) - TOL, R = ar.right - parseFloat(acs.borderRightWidth) + TOL;
          const T = ar.top + parseFloat(acs.borderTopWidth) - TOL, B = ar.bottom - parseFloat(acs.borderBottomWidth) + TOL;
          const checkX = (clipX || box) && !scrolls(acs.overflowX) && !pastX, checkY = (clipY || box) && !scrolls(acs.overflowY) && !pastY;
          const outX = checkX && boxes.some((b) => b.l < L || b.r > R), outY = checkY && boxes.some((b) => b.t < T || b.b > B);
          if (outX || outY) { out.push(`${outX ? 'x' : ''}${outY ? 'y' : ''} past ${name(a)}: ${label}`); break; }
        }
        if (scrolls(acs.overflowX)) pastX = true;
        if (scrolls(acs.overflowY)) pastY = true;
      }
      let shown = boxes;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        shown = shown.map((b) => ({ l: Math.max(b.l, ar.left), r: Math.min(b.r, ar.right), t: Math.max(b.t, ar.top), b: Math.min(b.b, ar.bottom) }))
          .filter((b) => b.r > b.l && b.b > b.t);
      }
      if (shown.some((b) => b.l < -1 || b.t < -1 || b.r > innerWidth + 1 || b.b > innerHeight + 1)) out.push(`off screen: ${label}`);
      texts.push({ el, label, shown });
      if (new Set(rects.map((r) => Math.round(r.top))).size > 1) {
        let prevTop = null;
        for (let i = 0; i < n.textContent.length; i++) {
          const c = n.textContent[i];
          if (/\s/.test(c)) continue;
          const cr = document.createRange();
          cr.setStart(n, i);
          cr.setEnd(n, i + 1);
          const rr = [...cr.getClientRects()].find((r) => r.width > 0);
          if (!rr) continue;
          const p = n.textContent[i - 1] || ' ';
          if (prevTop != null && rr.top > prevTop + rr.height / 2) {
            const at = `${n.textContent.slice(Math.max(0, i - 6), i)}|${n.textContent.slice(i, i + 6)}`;
            // (a player's name is any string: on a phone its second line may start inside a long word — §35.51; a picker's
            // operator name breaks inside a word only when that word alone is wider than the tile: overflow-wrap
            // break-word, English 「Thunderbringer」)
            if (!breakOk(p, c) && !el.closest('.seat__name') && !(el.closest('.cardpick__name') && wordWider(n, i, el.closest('.cardpick__name')))) {
              out.push(`broken inside a word (${at}): ${label}`); break;
            }
            if (noStart.test(c)) { out.push(`a line starts with ${c} (${at}): ${label}`); break; }
          }
          prevTop = rr.top;
        }
      }
    }
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
    if (a.shown.some((p) => b.shown.some((q) => p.l < q.r - 2 && p.r > q.l + 2 && p.t < q.b - 2 && p.b > q.t + 2))) out.push(`over: ${a.label} / ${b.label}`);
  }
  const de = document.documentElement;
  if (de.scrollWidth > innerWidth + 1 || de.scrollHeight > innerHeight + 1) out.push(`the page scrolls (${de.scrollWidth}×${de.scrollHeight})`);
  return out;
}

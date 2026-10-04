// tools/i18n/jslex.mjs — a small JS lexer for the i18n tools: finds the display text chunks of a source file.
//
// A chunk is the content of a '…' / "…" literal, of a `…` template (its ${…} kept as markers), or — inside an
// html`…` (htm) template — one text node or one quoted attribute value. Comments and regex literals are skipped.
// Each chunk: { kind: 'str'|'tpl'|'text'|'attr', text, exprs, line, start, end, callee }, where `text` holds
// `${0}`, `${1}`… markers for the expressions listed in `exprs`, `start`/`end` are source offsets of the whole
// literal (quotes included; for htm text / attributes: the chunk itself) and `callee` the identifier right before
// the literal's `(` when the literal is a call's first argument (e.g. 't').

export const CJK = /[㐀-鿿豈-﫿]/;

const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KW = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

/**
 * @param {string} src
 * @returns {Array<{ kind: string, text: string, exprs: string[], line: number, start: number, end: number, callee: string|null }>}
 */
export function lexChunks(src) {
  const out = [];
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const calleeBefore = (pos) => {
    let j = pos - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (src[j] !== '(') return null;
    j--;
    while (j >= 0 && /\s/.test(src[j])) j--;
    let k = j;
    while (k >= 0 && /[\w$.]/.test(src[k])) k--;
    return k < j ? src.slice(k + 1, j + 1) : null;
  };

  let i = 0;
  let prevSig = ''; // last significant token (char or identifier) for the regex heuristic

  function readString(q) {
    const start = i;
    let s = '';
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') { s += src[i] + src[i + 1]; i += 2; continue; }
      if (src[i] === '\n') break;
      s += src[i++];
    }
    i++;
    return { start, end: i, raw: s };
  }

  // Template literal at src[i] === '`'. Returns its parts: statics[] (raw text), staticStarts[] (source offset of each
  // static), exprs[] (trimmed expression source) and exprSpans[] ([start, end) of each `${…}` incl. the delimiters).
  function readTemplate() {
    const start = i;
    i++;
    const statics = [''];
    const staticStarts = [i];
    const exprs = [];
    const exprSpans = [];
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { statics[statics.length - 1] += src[i] + src[i + 1]; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        const sStart = i;
        i += 2;
        const eStart = i;
        scan('}');
        exprs.push(src.slice(eStart, i).trim());
        i++; // past }
        exprSpans.push([sStart, i]);
        statics.push('');
        staticStarts.push(i);
        continue;
      }
      statics[statics.length - 1] += src[i++];
    }
    i++;
    return { start, end: i, statics, staticStarts, exprs, exprSpans };
  }

  function emit(kind, text, exprs, start, end, callee = null) {
    if (!text.trim()) return;
    out.push({ kind, text, exprs, line: lineOf(start), start, end, callee });
  }

  // htm template: split statics into text nodes / attribute values (expressions inside become ${n} markers). A text
  // chunk spans its first to last non-space source char; an attribute chunk spans its value including the quotes.
  function emitHtml(tpl) {
    let inTag = false, attrQuote = null, buf = '', bufExprs = [], bufStart = -1, bufEnd = -1;
    const reset = () => { buf = ''; bufExprs = []; bufStart = -1; bufEnd = -1; };
    const flush = (kind) => {
      const txt = buf.replace(/\s+/g, ' ').trim();
      if (txt) emit(kind, txt, bufExprs, bufStart, bufEnd);
      reset();
    };
    tpl.statics.forEach((st, si) => {
      const base = tpl.staticStarts[si];
      for (let k = 0; k < st.length; k++) {
        const c = st[k], pos = base + k;
        if (attrQuote) {
          if (c === attrQuote) { bufEnd = pos + 1; flush('attr'); attrQuote = null; } else buf += c;
          continue;
        }
        if (inTag) {
          if (c === '"' || c === "'") { attrQuote = c; reset(); bufStart = pos; continue; }
          if (c === '>') inTag = false;
          continue;
        }
        if (c === '<') { flush('text'); inTag = true; continue; }
        if (!/\s/.test(c)) { if (bufStart < 0) bufStart = pos; bufEnd = pos + 1; }
        buf += c;
      }
      if (si < tpl.exprs.length) {
        const [eS, eE] = tpl.exprSpans[si];
        if (attrQuote || !inTag) {
          if (bufStart < 0) bufStart = eS;
          bufEnd = eE;
          buf += '${' + bufExprs.length + '}';
          bufExprs.push(tpl.exprs[si]);
        }
      }
    });
    flush('text');
    // a text node made only of expressions is not text
    for (let n = out.length - 1; n >= 0 && out[n].start >= tpl.start; n--) {
      if (out[n].kind === 'text' && /^(\$\{\d+\}\s*)+$/.test(out[n].text)) out.splice(n, 1);
    }
  }

  // Scan code until the closing `stop` char at depth 0 (or EOF).
  function scan(stop) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (stop && depth === 0 && c === stop) return;
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
      if (c === "'" || c === '"') {
        const callee = calleeBefore(i);
        const s = readString(c);
        emit('str', s.raw, [], s.start, s.end, callee);
        prevSig = 'lit';
        continue;
      }
      if (c === '`') {
        const tag = /(?:^|[^\w$.])html\s*$/.test(src.slice(Math.max(0, i - 8), i));
        const callee = tag ? null : calleeBefore(i);
        const tStart = i;
        const tpl = readTemplate();
        if (tag) emitHtml(tpl);
        else {
          let text = tpl.statics[0];
          for (let k = 0; k < tpl.exprs.length; k++) text += '${' + k + '}' + tpl.statics[k + 1];
          emit('tpl', text, tpl.exprs, tStart, tpl.end, callee);
        }
        prevSig = 'lit';
        continue;
      }
      if (c === '/') {
        if (REGEX_PREV.has(prevSig) || REGEX_KW.has(prevSig) || prevSig === '') {
          i++;
          let inClass = false;
          while (i < src.length && src[i] !== '\n') {
            if (src[i] === '\\') { i += 2; continue; }
            if (src[i] === '[') inClass = true;
            else if (src[i] === ']') inClass = false;
            else if (src[i] === '/' && !inClass) break;
            i++;
          }
          i++;
          while (/[a-z]/.test(src[i] || '')) i++;
          prevSig = 'lit';
          continue;
        }
      }
      if (/[\w$]/.test(c)) {
        let j = i;
        while (j < src.length && /[\w$]/.test(src[j])) j++;
        prevSig = src.slice(i, j);
        i = j;
        continue;
      }
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') depth--;
      if (!/\s/.test(c)) prevSig = c;
      i++;
    }
  }

  scan(null);
  return out;
}

/** Decode the escapes of a JS string / template literal body (its ${…} markers are kept). */
export function unescapeJs(raw) {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, e) => {
    if (e[0] === 'u') return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16));
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '', '\r\n': '' }[e] ?? e;
  });
}

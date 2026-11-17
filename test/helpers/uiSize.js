// 界面大小 (DESIGN §35.43): the stylesheet's floors carry var(--sp-ui, 1) — `max(.56rem, 32px, calc(34px * var(--sp-ui, 1)))`
// for a size floor, `max(.1rem, calc(4px * var(--sp-ui, 1)))` for the rest — and both layout roots multiply the design rule by
// it. Tests that pin a rule's design values read the stylesheet through `unscaled`, which writes each floor back as its
// design px (`max(.56rem, 34px)`), so they keep checking the design while test/ui/ui-size.test.js guards the factor.
const NUM = String.raw`\d*\.?\d+px`;
const K = String.raw` \* var\(--sp-ui, 1\)\)`;
/** @param {string} css */
export function unscaled(css) {
  return css
    .replace(new RegExp(`${NUM}, calc\\((${NUM})${K}`, 'g'), '$1')
    .replace(new RegExp(`calc\\((${NUM})${K}`, 'g'), '$1')
    .replace(/calc\((clamp\(40px, .*?, 240px\)) \* var\(--sp-ui, 1\)\)/g, '$1');
}

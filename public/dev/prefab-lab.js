// Official theme prefab lab (see prefab-lab.html): every prefab of a pack, a status picker per status driver.
import '/js/ui/compat.js';
import { render } from '/vendor/preact.module.js';
import { useState } from '/vendor/hooks.module.js';
import { html } from '/js/ui/components.js';
import { data } from '/js/data.js';
import { OFFICIAL_THEMES } from '/shared/uiTheme.js';
import { usePrefabPack, PrefabView } from '/js/ui/prefab/view.js';

const q = new URLSearchParams(location.search);
const scale = Number(q.get('scale')) || 1.44;
// sample=1: every text shows a sample (its text id's last word, else 88), so the layout groups have something to fit
const SAMPLE = { ROUND_TEXT: '回合', REST_STAGE_TIP: '休整期', BATTLE_STAGE_TIP: '作战开始', HELP_STAGE_TIP: '联防开始', PREP_READY: '准备', PREP_CANCEL_READY: '取消' };
const textFor = q.get('sample') ? (node) => {
  const id = node.text?.textId || '';
  const hit = Object.keys(SAMPLE).find((k) => id.endsWith(k));
  return hit ? SAMPLE[hit] : node.text?.text || '88';
} : null;

/** Status names of every status driver under a prefab. */
function statusNames(node, out = []) {
  for (const e of node?.status || []) if (e?.name && !out.includes(e.name)) out.push(e.name);
  for (const c of node?.children || []) statusNames(c, out);
  return out;
}

function Row({ pack, name, prefab }) {
  const names = statusNames(prefab);
  const [status, setStatus] = useState(q.get(`s.${name}`) || '');
  return html`<div class="lab__row" data-prefab=${name}>
    <div class="lab__head"><b>${name}</b>
      ${names.length ? html`<label>status <select value=${status} onChange=${(e) => setStatus(e.currentTarget.value)}>
        <option value="">(prefab defaults)</option>
        ${names.map((s) => html`<option value=${s}>${s}</option>`)}
      </select></label>` : null}
    </div>
    <div class="lab__stage"><${PrefabView} pack=${pack} prefab=${prefab} status=${status ? status.split(',') : null} scale=${scale} textFor=${textFor}
      poses=${(q.get(`c.${name}`) || '').split(',').filter(Boolean).map((c) => { const [clip, at] = c.split(':'); return { clip, at: at || 'end', on: Number(q.get(`on.${name}`)) || null }; })} /></div>
  </div>`;
}

function Lab({ groups }) {
  const [theme, setTheme] = useState(q.get('theme') || 'ac_s_closur');
  const pack = usePrefabPack(groups, theme, { includeDefault: true });
  const only = q.get('only');
  const prefabs = pack ? Object.entries(pack.doc.prefabs).filter(([k]) => !only || only.split(',').includes(k)) : [];
  return html`<div class="lab">
    <div class="lab__head">
      <label>theme <select value=${theme} onChange=${(e) => setTheme(e.currentTarget.value)}>
        ${OFFICIAL_THEMES.map((t) => html`<option value=${t.id}>${t.id}</option>`)}
      </select></label>
      <span>scale ${scale}</span>
      ${pack ? html`<span>${prefabs.length} prefabs</span>` : html`<span>no prefabs.json for this pack (re-run the theme extractor)</span>`}
    </div>
    ${prefabs.map(([k, p]) => html`<${Row} key=${theme + k} pack=${pack} name=${k} prefab=${p} />`)}
  </div>`;
}

data.load('local').then(() => render(html`<${Lab} groups=${data.get('local')?.groups} />`, document.getElementById('app')));

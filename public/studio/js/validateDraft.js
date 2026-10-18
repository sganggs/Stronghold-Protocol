import { PRESENTATION_TEMPLATES, validatePresentation } from './presentation.js';
import { GAMEPLAY_TEMPLATES } from './gameplayModel.js';
// The save gate is independent of the editor's debounced explanation.
export async function validateDraft(draft, { get, post }) {
  if (PRESENTATION_TEMPLATES.includes(draft.template)) {
    const local = validatePresentation(draft);
    return local.ok ? post('validate-dsl', { draft }) : local;
  }
  if (GAMEPLAY_TEMPLATES.includes(draft.template)) return post('validate-dsl', { draft });
  const o = draft.options || {};
  let spec;
  if (draft.template === 'dsl' || draft.template === 'meta') {
    spec = o.dsl !== undefined ? o.dsl : (await get(`dsl-example?name=${encodeURIComponent(o.example || (draft.template === 'meta' ? 'lmlee' : 'demo'))}&id=${encodeURIComponent(draft.id)}`)).spec;
  } else if (draft.template === 'operator' && o.kitSource === 'dsl') {
    spec = o.dsl !== undefined ? o.dsl : { dsl: 1, talents: [{ when: 'deploy', do: [{ buff: { mods: { atkPct: 0.5 } } }] }] };
  } else return { ok: true };
  return post('validate-dsl', { spec });
}

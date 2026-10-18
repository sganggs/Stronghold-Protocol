import { presentationOptions, validatePresentation } from '../../../public/studio/js/presentation.js';
import { StudioError } from '../files.js';

export function checkedPresentation(template, id, target, options) {
  const o = presentationOptions(template, options);
  const result = validatePresentation({ template, id, target: target ? `operator:${target.key}` : '', options: o });
  if (!result.ok) throw new StudioError(result.problems[0].code, 400, { where: result.problems[0].path, detail: result.problems[0].message });
  return o;
}
export default {
  id: 'theme', class: 'cosmetic', kinds: [], slots: () => [], overlay: () => ({}),
  build({ id, options }) {
    const o = checkedPresentation('theme', id, null, options);
    return { manifest: { scope: ['personal'], permissions: ['theme'], theme: { vars: o.vars } }, files: {} };
  },
};

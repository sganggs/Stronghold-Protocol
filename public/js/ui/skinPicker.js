// Compat shim (stronghold-ui-hub package) — install ONLY when the target has no public/js/ui/skinPicker.js.
// The original shows a 皮肤 section in 干员调配's detail. Without skins: no section.

export function SkinSection() { return null; }

"""The UI shader family behind the 规程 shop card: what the shipped Shader assets still say, and what they do not.

The three shaders the card's materials use (`Torappu/UI/UI-Fx-Common`, `Torappu/UI/AlphaBlend`,
`Torappu/UI/Dissolve/UI-DoubleDissolve-Tex`) are **baked** in this build: `m_ShaderIsBaked` is true, the `m_Script`
field that would hold the ShaderLab source is absent, and all that is left of each program is a per-platform
bytecode blob (D3D11 `DXBC` on the Windows install: `platforms: [4]`, 2 stages). So no ShaderLab/HLSL source exists
to extract, and the maths cannot be read out of the asset — it has to be reimplemented.

What the asset *does* still carry is everything the renderer needs to make that reimplementation exact in its
inputs and its pipeline state:

* the property table: name, type (colour / vector / float / range / texture), default value or default texture,
  range, the official description, and the `Toggle(...)` / `Enum(...)` / `MaterialToggle(...)` attributes that say
  which shader keyword a property switches and what an enum value means;
* the pass render state, including the *named* property bindings: `destBlend` is bound to `_Dst` (UI-Fx-Common,
  UI-DoubleDissolve-Tex) or `_DstBlend` (AlphaBlend), `zTest` to `_ZTest`, so the material's own float is the source
  of the blend factor;
* the uniform list and constant-buffer layout (names such as `_BaseTex_ST`, `_Dissolve1_Tex_ST`, `_Color`), plus the
  texture units and samplers;
* the keyword list and the keyword set of every compiled variant;
* the program blobs' platform, stage count, compressed/decompressed size and hash.

`docs_markdown()` renders that as a page a person ports from, with the derived meaning of each card property
(`PROPERTY_NOTES`) marked `[ASSUMED]` where the official description does not settle it.
"""
import hashlib
import re

PROP_TYPES = {0: 'color', 1: 'vector', 2: 'float', 3: 'range', 4: 'texture'}
PROP_FLAGS = {1: 'hideInInspector', 2: 'perRendererData'}
# Unity Particles: the shape module's emitter type. Kept as a name beside the raw number.
PROPERTY_NOTES = {
    '_MainTex': 'The sprite texture the graphic draws (a UITexture sheet unless the material overrides it).',
    '_Color': 'Tint multiplied into the sampled colour.',
    '_TintColor': 'Tint multiplied into the sampled colour (AlphaBlend family; default 0.5 grey).',
    '_ColIntensity': 'Brightness multiplier applied to the tint.',
    '_BaseTex': 'The effect texture the Image draws instead of a sprite; sampled through _BaseTex_Channel and '
                'scrolled by _BaseTex_SpeedU/_BaseTex_SpeedV.',
    '_BaseTex_Channel': 'Which channel of _BaseTex is used (Enum RGBA=0, R=1): the RGB/A channel pick the renderer '
                        'has to reproduce before tinting.',
    '_BaseTex_SpeedU': 'UV scroll per second on U of _BaseTex (added to _BaseTex_ST.x over time).',
    '_BaseTex_SpeedV': 'UV scroll per second on V of _BaseTex (added to _BaseTex_ST.y over time).',
    '_ClampV': 'Toggle: clamp the scrolled V to [0, 1] instead of wrapping.',
    '_RgbCtrl': 'Toggle: the Image colour drives the shader (red picks the particle-sheet frame, per ui_components) '
                'instead of tinting the texture.',
    '_Intensity': 'Overall multiplier on the result.',
    '_Mask': 'Feature switch: multiply the result by _Mask_Tex.',
    '_Mask_Tex': 'The alpha mask sampled for _Mask; its TexEnv scale is the mask tiling.',
    '_Mask_Invert': 'Toggle: invert the mask before multiplying.',
    '_Distortion': 'Feature switch: distort the base UV by _Distortion_Tex before sampling.',
    '_Distortion_Tex': 'Noise texture for the distortion.',
    '_Distortion_Dir': 'Enum Single=0 / Double=1: one or two-way distortion.',
    '_Distortion_IntensityU': 'Distortion strength on U.',
    '_Distortion_IntensityV': 'Distortion strength on V.',
    '_Distortion_SpeedU': 'Distortion noise scroll per second on U.',
    '_Distortion_SpeedV': 'Distortion noise scroll per second on V.',
    '_Dissolve': 'Feature switch for the two-map dissolve.',
    '_Dissolve1_Tex': 'Dissolve map 1. Alpha below _Dissolve1_Threshold is cut; _Dissolve1_Smoothness widens the '
                      'cut edge.',
    '_Dissolve1_Invert': 'Toggle: invert dissolve map 1.',
    '_Dissolve1_Threshold': 'Range -1..1: the dissolve cut for map 1.',
    '_Dissolve1_Smoothness': 'Range 0..1 (default 0.3): edge softness of the map 1 cut.',
    '_Dissolve1_Distortion': 'Toggle: distort the dissolve sample by the base texture.',
    '_Dissolve2_Tex': 'Dissolve map 2 (same four knobs as map 1).',
    '_Dissolve2_Invert': 'Toggle: invert dissolve map 2.',
    '_Dissolve2_Threshold': 'Range -1..1: the dissolve cut for map 2.',
    '_Dissolve2_Smoothness': 'Range 0..1: edge softness of the map 2 cut.',
    '_Dissolve2_Distortion': 'Toggle: distort the dissolve sample by the base texture.',
    '_Dissolve_Speed': 'Vector (x:U1 y:V1 z:U2 w:V2): UV scroll per second of dissolve map 1 (xy) and map 2 (zw).',
    '_Dst': 'Enum Alpha=10 / Additive=1: the destination blend factor. The pass state binds destBlend to this '
            'property, so a value of 1 means (src * SrcAlpha) + dst.',
    '_DstBlend': 'Enum Add=1 / AlphaBlend=10: the destination blend factor (AlphaBlend family).',
    '_UseUIAlphaClip': 'Toggle(UNITY_UI_ALPHACLIP): clip(a - 0.001) on the final alpha.',
    '_ZTest': 'Enum LessEqual=4 / Disable=0: the depth test the pass uses (_ZTest is the named binding).',
    '_StencilComp': 'UGUI stencil comparison (CompareFunction, 8 = Always).',
    '_Stencil': 'UGUI stencil id.',
    '_StencilOp': 'UGUI stencil operation.',
    '_StencilWriteMask': 'UGUI stencil write mask.',
    '_StencilReadMask': 'UGUI stencil read mask.',
    '_ColorMask': 'UGUI colour write mask (15 = RGBA).',
    '_ImageControl': 'Toggle: the Image colour drives the dissolve threshold (off: it drives the tint).',
    '_DissolveTex1': 'Dissolve map 1 of the DoubleDissolve family.',
    '_Revert1': 'Toggle: invert dissolve map 1.',
    '_Dissolve1Clip': 'Range -1..1: dissolve cut 1.',
    '_Dissolve1Smooth': 'Range 0..1: dissolve edge 1.',
    '_DissolveTex2': 'Dissolve map 2.',
    '_Revert2': 'Toggle: invert dissolve map 2.',
    '_Dissolve2Clip': 'Range -1..1: dissolve cut 2.',
    '_Dissolve2Smooth': 'Range 0..1: dissolve edge 2.',
    '_HG_UI_ANM_ON': 'Keyword property: the UV-animation variant of the shader.',
    '_MainTexConfig': 'Vector: main texture tiling in xy.',
    '_AmountA': 'Range 0..1: map A dissolve amount.',
    '_BorderWidthA': 'Range: map A edge width.',
    '_AmountB': 'Range 0..1: map B dissolve amount.',
    '_BorderWidthB': 'Range: map B edge width.',
    '_DissolveMapA': 'Dissolve map A.',
    '_DissolveMapB': 'Dissolve map B.',
    '_DissolveTillingSpeed': 'Vector (A:xy, B:zw): UV scroll per second of dissolve maps A and B.',
}
# [ASSUMED] Unity's ParticleSystemShapeType, in the order the engine serialises it.
SHAPE_TYPES = {
    0: 'sphere', 1: 'sphereShell', 2: 'hemisphere', 3: 'hemisphereShell', 4: 'cone', 5: 'box', 6: 'mesh',
    7: 'coneShell', 8: 'coneVolume', 9: 'coneVolumeShell', 10: 'circle', 11: 'circleEdge', 12: 'singleSidedEdge',
    13: 'meshRenderer', 14: 'skinnedMeshRenderer', 15: 'boxShell', 16: 'boxEdge', 17: 'donut', 18: 'rectangle',
    19: 'sprite', 20: 'spriteRenderer',
}


def record(tree, name=None, cab=None):
    """A Shader typetree → the card's `shaders` entry. Pure: no UnityPy, no file reads."""
    parsed = (tree or {}).get('m_ParsedForm') or {}
    shader_name = name or parsed.get('m_Name') or (tree or {}).get('m_Name') or ''
    keywords = [str(word) for word in (parsed.get('m_KeywordNames') or [])]
    blob = (tree or {}).get('compressedBlob')
    blob_bytes = bytes(blob) if isinstance(blob, (bytes, bytearray)) else (
        bytes(int(byte) for byte in blob) if isinstance(blob, list) else b'')
    out = {
        'name': shader_name,
        'cab': cab,
        # The ShaderLab source is gone in this build: nothing to port verbatim, by evidence, not by choice.
        'compiled': not isinstance((tree or {}).get('m_Script'), str),
        'source': None,
        'customEditor': parsed.get('m_CustomEditorName') or None,
        'fallback': parsed.get('m_FallbackName') or None,
        'keywords': keywords,
        'keywordFlags': list(parsed.get('m_KeywordFlags') or []),
        'properties': [_property(prop) for prop in ((parsed.get('m_PropInfo') or {}).get('m_Props') or [])],
        'platforms': list((tree or {}).get('platforms') or []),
        'stages': list((tree or {}).get('stageCounts') or []),
        'programBytes': _blob_size(tree),
        'programSha256': hashlib.sha256(blob_bytes).hexdigest() if blob_bytes else None,
        'subShaders': [],
    }
    for sub in parsed.get('m_SubShaders') or []:
        tags = {str(pair[0]): str(pair[1]) for pair in ((sub.get('m_Tags') or {}).get('tags') or []) if len(pair) == 2}
        passes = []
        for passage in sub.get('m_Passes') or []:
            passes.append(_pass(passage, keywords))
        out['subShaders'].append({'tags': tags, 'lod': _num(sub.get('m_LOD')), 'passes': passes})
    return out


def _blob_size(tree):
    lengths = (tree or {}).get('decompressedLengths') or []
    total = 0
    for entry in lengths:
        if isinstance(entry, list):
            total += sum(int(value) for value in entry)
        elif isinstance(entry, (int, float)):
            total += int(entry)
    return total


def _num(value, digits=4):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    out = round(float(value), digits)
    return int(out) if out == int(out) else out


def _property(prop):
    """One Shader property: type, default, range, the toggle keyword and enum labels its attribute names."""
    kind = int(prop.get('m_Type') or 0)
    attributes = [str(text) for text in (prop.get('m_Attributes') or [])]
    description = str(prop.get('m_Description') or '')
    parsed = _attributes(attributes)
    out = {
        'name': str(prop.get('m_Name') or ''),
        'type': PROP_TYPES.get(kind, f'type{kind}'),
        'description': description,
        'attributes': attributes,
        'flags': [PROP_FLAGS[flag] for flag in sorted(PROP_FLAGS) if int(prop.get('m_Flags') or 0) & flag],
    }
    defaults = [prop.get(f'm_DefValue[{index}]') for index in range(4)]
    if kind == 4:
        out['defaultTexture'] = str((prop.get('m_DefTexture') or {}).get('m_DefaultName') or '') or None
    elif kind in (0, 1):
        out['default'] = [_num(value) for value in defaults]
    else:
        out['default'] = _num(defaults[0])
        if kind == 3:
            out['range'] = [_num(defaults[1]), _num(defaults[2])]
    if parsed.get('toggle'):
        out['toggle'] = parsed['toggle']
    if parsed.get('enum'):
        out['enum'] = parsed['enum']
    part_of = _part_of(description)
    if part_of:
        out['partOf'] = part_of
    if '[Feature]' in description:
        out['feature'] = 1
    if PROPERTY_NOTES.get(out['name']):
        out['note'] = PROPERTY_NOTES[out['name']]
    return out


def _attributes(attributes):
    """Parse a shader property's attributes: the keyword a toggle switches, the labels of an enum."""
    out = {}
    for text in attributes:
        match = re.match(r'^(?:Material)?Toggle(?:\((.*)\))?$', text)
        if match:
            out['toggle'] = match.group(1) or None
            continue
        match = re.match(r'^Enum\((.*)\)$', text)
        if match:
            parts = [part.strip() for part in match.group(1).split(',')]
            labels = {}
            for index in range(0, len(parts) - 1, 2):
                try:
                    labels[parts[index]] = int(float(parts[index + 1]))
                except ValueError:
                    continue
            if labels:
                out['enum'] = labels
    return out


def _part_of(description):
    match = re.search(r'\[PartOf\(([^)]+)\)\]', description or '')
    return match.group(1) if match else None


def _pass(passage, keywords):
    """One pass: tags, render state (with the property bound to each factor), uniforms and compiled variants."""
    names = {}
    for pair in passage.get('m_NameIndices') or []:
        if isinstance(pair, (list, tuple)) and len(pair) == 2:
            names[int(pair[1])] = str(pair[0])
    state = passage.get('m_State') or {}
    out = {
        'name': (state.get('m_Name') or passage.get('m_Name') or '') or None,
        'tags': {str(pair[0]): str(pair[1])
                 for pair in ((passage.get('m_Tags') or {}).get('tags') or []) if len(pair) == 2},
        'texture': passage.get('m_TextureName') or None,
        'blend': _blend(state),
        'zTest': _factor(state.get('zTest')),
        'zWrite': _factor(state.get('zWrite')),
        'culling': _factor(state.get('culling')),
        'colorMask': _factor(state.get('colMask') or state.get('colorMask')),
        'stencil': _stencil(state),
        'uniforms': [names[index] for index in sorted(names)],
        'variants': _variants(passage, keywords),
    }
    return {key: value for key, value in out.items() if value not in (None, [], {}, '')}


def _factor(entry):
    """A render-state factor: its value, the material property the shader binds it to, or the engine's own value."""
    if not isinstance(entry, dict):
        return {'value': _num(entry)}
    value = _num(entry.get('val'))
    bound = entry.get('name')
    if bound in (None, '', '<noninit>'):
        return {'value': value}
    if bound == 'unity_GUIZTestMode':
        return {'value': value, 'engine': str(bound)}
    return {'value': value, 'property': str(bound)}


def _blend(state):
    blend = state.get('rtBlend0') or {}
    out = {}
    for key, field in (('src', 'srcBlend'), ('dst', 'destBlend'), ('srcAlpha', 'srcBlendAlpha'),
                       ('dstAlpha', 'destBlendAlpha'), ('op', 'blendOp'), ('opAlpha', 'blendOpAlpha')):
        out[key] = _factor(blend.get(field))
    out['separate'] = bool(state.get('rtSeparateBlend'))
    return out


def _stencil(state):
    out = {}
    for key, field in (('ref', 'stencilRef'), ('readMask', 'stencilReadMask'), ('writeMask', 'stencilWriteMask')):
        if field in state:
            out[key] = _factor(state.get(field))
    ops = state.get('stencilOp') or {}
    for key, field in (('comp', 'comp'), ('pass', 'pass'), ('fail', 'fail'), ('zFail', 'zFail')):
        if field in ops:
            out[key] = _factor(ops.get(field))
    return out or None


def _variants(passage, keywords):
    """The compiled sub-programs per stage: the keyword set that selects each one, deduplicated.

    Blob indices and platform slots are left out — a port needs to know which keywords change the code (and only
    the Toggle/Enum attributes and the keyword list matter for that), not where the D3D11 blob sits.
    """
    out = {}
    for field, stage in (('progVertex', 'vertex'), ('progFragment', 'fragment')):
        program = passage.get(field) or {}
        sets = []
        for sub_programs in program.get('m_PlayerSubPrograms') or []:
            for sub in sub_programs or []:
                if not isinstance(sub, dict):
                    continue
                indices = sub.get('m_KeywordIndices') or []
                words = [keywords[int(index)] for index in indices if 0 <= int(index) < len(keywords)]
                if words not in sets:
                    sets.append(words)
        if sets:
            out[stage] = sets
    return out


def docs_markdown(record):
    """A page to port from: what the shader is, what it cannot tell us, its properties and its pipeline state."""
    lines = []
    name = record.get('name') or '?'
    lines.append(f'# {name}')
    lines.append('')
    lines.append('Extracted by `tools/local-extract/` from the official bundle; do not edit, re-run the extractor.')
    lines.append('')
    lines.append('| | |')
    lines.append('|---|---|')
    lines.append(f'| CAB | `{record.get("cab") or "in this bundle"}` |')
    lines.append(f'| ShaderLab source | {"not available" if record.get("compiled") else "available"} |')
    lines.append(f'| Custom editor / fallback | `{record.get("customEditor") or "-"}` / `{record.get("fallback") or "-"}` |')
    lines.append(f'| Compiled platforms | {record.get("platforms")} (stages per platform: {record.get("stages")}) |')
    lines.append(f'| Program blob | {record.get("programBytes")} bytes decompressed, sha256 `{record.get("programSha256")}` |')
    lines.append(f'| Keywords | {", ".join(f"`{word}`" for word in record.get("keywords") or []) or "-"} |')
    lines.append('')
    lines.append('## Limitation: compiled only')
    lines.append('')
    if record.get('compiled'):
        lines.append('This build ships the shader baked: `m_ShaderIsBaked` is true and the `m_Script` field that would')
        lines.append('hold the ShaderLab source is absent. What is left is the compiled program (D3D11 bytecode on the')
        lines.append('Windows install), so the HLSL maths cannot be read out of the asset. Everything below is exact')
        lines.append('input and pipeline state; the body of the shader has to be reimplemented from the property names,')
        lines.append('the official descriptions and the blend/test state.')
    else:
        lines.append('The asset carries its ShaderLab source; see `source`.')
    lines.append('')
    lines.append('## Properties')
    lines.append('')
    lines.append('| Name | Type | Default | Range | Official description | Attribute | Notes |')
    lines.append('|---|---|---|---|---|---|---|')
    for prop in record.get('properties') or []:
        default = prop.get('defaultTexture') or prop.get('default')
        if isinstance(default, list):
            default = ', '.join(str(value) for value in default)
        attributes = ', '.join(f'`{text}`' for text in prop.get('attributes') or [])
        lines.append(f'| `{prop["name"]}` | {prop["type"]} | {default if default is not None else "-"} '
                     f'| {prop.get("range") or "-"} | {prop.get("description") or "-"} | {attributes or "-"} '
                     f'| {prop.get("note") or "-"} |')
    lines.append('')
    for sub_index, sub in enumerate(record.get('subShaders') or []):
        tags = ', '.join(f'{key}={value}' for key, value in (sub.get('tags') or {}).items()) or '-'
        lines.append(f'## SubShader {sub_index} (LOD {sub.get("lod")})')
        lines.append('')
        lines.append(f'Tags: {tags}')
        lines.append('')
        for pass_index, passage in enumerate(sub.get('passes') or []):
            lines.append(f'### Pass {pass_index}' + (f' — {passage["name"]}' if passage.get('name') else ''))
            lines.append('')
            blend = passage.get('blend') or {}
            for key in ('src', 'dst', 'srcAlpha', 'dstAlpha', 'op', 'opAlpha'):
                factor = blend.get(key) or {}
                bound = f' (bound to `{factor.get("property")}`)' if factor.get('property') else ''
                engine = f' (engine: `{factor.get("engine")}`)' if factor.get('engine') else ''
                lines.append(f'- blend `{key}`: {factor.get("value")}{bound}{engine}')
            for key in ('zTest', 'zWrite', 'culling'):
                factor = passage.get(key) or {}
                if not factor:
                    continue
                bound = f' (bound to `{factor.get("property")}`)' if factor.get('property') else ''
                engine = f' (engine: `{factor.get("engine")}`)' if factor.get('engine') else ''
                lines.append(f'- {key}: {factor.get("value")}{bound}{engine}')
            stencil = passage.get('stencil') or {}
            if stencil:
                lines.append('- stencil: ' + ', '.join(f'{key}={value.get("value")}' for key, value in stencil.items()))
            lines.append('')
            lines.append('Uniforms: ' + ', '.join(f'`{word}`' for word in passage.get('uniforms') or []))
            lines.append('')
            variants = passage.get('variants') or {}
            if variants:
                for stage, sets in variants.items():
                    lines.append(f'Compiled {stage} variants: {len(sets)}')
                    for words in sets:
                        lines.append(f'- {stage}: {", ".join(words) if words else "(no keywords)"}')
                lines.append('')
    lines.append('## Porting notes')
    lines.append('')
    lines.append('- A property with `note` above is the extractor\'s reading of its official description; a note that')
    lines.append('  the description does not settle is marked `[ASSUMED]` there or in the property list.')
    lines.append('- The blend factors bound to a property (`_Dst`, `_DstBlend`) mean the material float is the source')
    lines.append('  of truth: `_Dst = 1` is additive (src × SrcAlpha + dst), `_Dst = 10` is alpha blending.')
    lines.append('- `_UseUIAlphaClip` switches the `UNITY_UI_ALPHACLIP` keyword: `clip(alpha - 0.001)`.')
    lines.append('- `*_ST` uniforms are the texture tiling/offset of the matching TexEnv (see the material record).')
    lines.append('')
    return '\n'.join(lines) + '\n'

"""Unity UI components on official prefabs, as compact layout.json fields. Pure functions over typetrees.

The UI MonoScripts sit in one CAB that no bundle on disk carries (the client's index is encrypted), so a component is
known by its fields. HorizontalLayoutGroup and VerticalLayoutGroup have the same fields: their script path ids tell
them apart (every UI bundle of a client build points at the same script objects), and the saved child positions are
the fallback. The tween scripts are told apart the same way (a float, Euler angles, an anchored position or a size).

`ref` is a callable that turns a PPtr into a reference the walker resolves later (a node id), or None.
"""

import math

LAYOUT_AXIS = {-3229211799126679632: 'h', -4621643977240678714: 'v'}
TWEEN_KIND = {
    -7396670433381408218: 'alpha',
    6318307027612266610: 'rot',
    1880868421193314568: 'pos',
    8776025743667943388: 'size',
}
# descriptionType of the status driver (statusName → descriptions). 1 sets a GameObject active, 2 plays a clip on an
# animation wrapper, 3 plays a switch clip (forward to show, back to hide).
STATUS_SET_ACTIVE = 1


def _num(value, nd=3):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(f):
        return 0
    r = round(f, nd)
    return int(r) if r == int(r) else r


def _vec(value, keys=('x', 'y')):
    if not isinstance(value, dict):
        return [0] * len(keys)
    return [_num(value.get(k, 0)) for k in keys]


def _hex(color):
    if not isinstance(color, dict):
        return None
    parts = []
    for key in ('r', 'g', 'b', 'a'):
        try:
            channel = float(color.get(key, 1 if key == 'a' else 0))
        except (TypeError, ValueError):
            channel = 0.0
        parts.append(max(0, min(255, int(round(channel * 255)))))
    text = '#' + ''.join(f'{p:02X}' for p in parts)
    return text[:7] if parts[3] == 255 else text


def _flag(value):
    return bool(value) and value not in (0, '0')


def layout_group(tree, script_id=None):
    """HorizontalLayoutGroup / VerticalLayoutGroup. axis is None when the script id is unknown."""
    if not isinstance(tree, dict) or 'm_ChildAlignment' not in tree or 'm_Spacing' not in tree:
        return None
    if 'm_CellSize' in tree or not isinstance(tree.get('m_Spacing'), (int, float)):
        return None
    pad = tree.get('m_Padding') or {}
    out = {
        'axis': LAYOUT_AXIS.get(script_id),
        'align': int(tree.get('m_ChildAlignment') or 0),
        'spacing': _num(tree.get('m_Spacing')),
        'control': [int(_flag(tree.get('m_ChildControlWidth'))), int(_flag(tree.get('m_ChildControlHeight')))],
        'expand': [int(_flag(tree.get('m_ChildForceExpandWidth'))), int(_flag(tree.get('m_ChildForceExpandHeight')))],
    }
    padding = [_num(pad.get(k, 0)) for k in ('m_Left', 'm_Right', 'm_Top', 'm_Bottom')]
    if any(padding):
        out['pad'] = padding
    scale = [int(_flag(tree.get('m_ChildScaleWidth'))), int(_flag(tree.get('m_ChildScaleHeight')))]
    if any(scale):
        out['scale'] = scale
    if _flag(tree.get('m_ReverseArrangement')):
        out['reverse'] = 1
    return out


def guess_axis(child_rects):
    """Fallback axis from the children's saved positions: the axis they spread along. 'h' when nothing tells."""
    xs = [r['anchoredPosition'][0] for r in child_rects if isinstance(r, dict) and r.get('anchoredPosition')]
    ys = [r['anchoredPosition'][1] for r in child_rects if isinstance(r, dict) and r.get('anchoredPosition')]
    if len(xs) < 2:
        return 'h'
    return 'v' if (max(ys) - min(ys)) > (max(xs) - min(xs)) else 'h'


def grid_group(tree):
    if not isinstance(tree, dict) or 'm_CellSize' not in tree or 'm_StartCorner' not in tree:
        return None
    pad = tree.get('m_Padding') or {}
    out = {
        'cell': _vec(tree.get('m_CellSize')),
        'spacing': _vec(tree.get('m_Spacing')),
        'corner': int(tree.get('m_StartCorner') or 0),
        'startAxis': int(tree.get('m_StartAxis') or 0),
        'align': int(tree.get('m_ChildAlignment') or 0),
        'constraint': int(tree.get('m_Constraint') or 0),
        'count': int(tree.get('m_ConstraintCount') or 0),
    }
    padding = [_num(pad.get(k, 0)) for k in ('m_Left', 'm_Right', 'm_Top', 'm_Bottom')]
    if any(padding):
        out['pad'] = padding
    return out


def size_fitter(tree):
    """ContentSizeFitter: [horizontal, vertical], 0 unconstrained, 1 min size, 2 preferred size."""
    if not isinstance(tree, dict) or 'm_HorizontalFit' not in tree or 'm_VerticalFit' not in tree:
        return None
    return [int(tree.get('m_HorizontalFit') or 0), int(tree.get('m_VerticalFit') or 0)]


def layout_element(tree):
    """LayoutElement (and the variant with a max size). -1 means unset and is left out."""
    if not isinstance(tree, dict) or 'm_IgnoreLayout' not in tree or 'm_PreferredWidth' not in tree:
        return None
    out = {}
    if _flag(tree.get('m_IgnoreLayout')):
        out['ignore'] = 1
    for key, (w, h) in (('min', ('m_MinWidth', 'm_MinHeight')), ('pref', ('m_PreferredWidth', 'm_PreferredHeight')),
                        ('flex', ('m_FlexibleWidth', 'm_FlexibleHeight'))):
        pair = [_num(tree.get(w, -1)), _num(tree.get(h, -1))]
        if pair != [-1, -1]:
            out[key] = pair
    if 'useMaxWidth' in tree:
        mx = [_num(tree.get('maxWidth')) if _flag(tree.get('useMaxWidth')) else -1,
              _num(tree.get('maxHeight')) if _flag(tree.get('useMaxHeight')) else -1]
        if mx != [-1, -1]:
            out['max'] = mx
    return out


def rect_mask(tree):
    """RectMask2D: clips children to the rect. padding [left, bottom, right, top], softness [x, y] in units."""
    if not isinstance(tree, dict) or 'm_Softness' not in tree or 'm_Padding' not in tree:
        return None
    out = {'rect': 1}
    pad = _vec(tree.get('m_Padding'), ('x', 'y', 'z', 'w'))
    if any(pad):
        out['pad'] = pad
    soft = _vec(tree.get('m_Softness'))
    if any(soft):
        out['soft'] = soft
    return out


def stencil_mask(tree):
    """Mask: clips children to the graphic's alpha; show = the graphic itself is drawn."""
    if not isinstance(tree, dict) or 'm_ShowMaskGraphic' not in tree:
        return None
    return {'stencil': 1, 'show': int(_flag(tree.get('m_ShowMaskGraphic')))}


def _tween_value(value):
    if isinstance(value, (int, float)):
        return _num(value)
    if isinstance(value, dict):
        if '_position' in value:
            return _vec(value.get('_position'))
        if '_size' in value:
            return _vec(value.get('_size'))
        if {'r', 'g', 'b'} <= set(value):
            return _hex(value)
        if {'x', 'y', 'z'} <= set(value):
            return _vec(value, ('x', 'y', 'z'))
        if {'x', 'y'} <= set(value):
            return _vec(value)
    return None


def tween(tree, script_id=None):
    """The client's looping tween components (from, to, duration, ease, loops). kind from the script id, else the value."""
    if not isinstance(tree, dict) or '_from' not in tree or '_to' not in tree or '_duration' not in tree:
        return None
    start, end = _tween_value(tree.get('_from')), _tween_value(tree.get('_to'))
    kind = TWEEN_KIND.get(script_id)
    if kind is None:
        raw = tree.get('_from')
        if isinstance(raw, (int, float)):
            kind = 'alpha'
        elif isinstance(raw, dict) and '_position' in raw:
            kind = 'pos'
        elif isinstance(raw, dict) and '_size' in raw:
            kind = 'size'
        elif isinstance(start, str):
            kind = 'color'
        else:
            kind = 'vec'
    out = {
        'kind': kind, 'from': start, 'to': end,
        'dur': _num(tree.get('_duration')), 'ease': int(tree.get('_easeType') or 0),
        'loop': int(tree.get('_loop') or 0), 'loopType': int(tree.get('_loopType') or 0),
    }
    if _num(tree.get('_delay')):
        out['delay'] = _num(tree.get('_delay'))
    if _flag(tree.get('_playWhenStart')):
        out['auto'] = 1
    if not _flag(tree.get('_startByFrom')):
        out['fromCurrent'] = 1
    return out


def slider(tree, ref):
    """UnityEngine.UI.Slider: direction 0 L→R, 1 R→L, 2 B→T, 3 T→B; fill / handle are node refs."""
    if not isinstance(tree, dict) or 'm_FillRect' not in tree or 'm_Direction' not in tree or 'm_MaxValue' not in tree:
        return None
    out = {
        'dir': int(tree.get('m_Direction') or 0),
        'min': _num(tree.get('m_MinValue')), 'max': _num(tree.get('m_MaxValue')),
        'value': _num(tree.get('m_Value')),
    }
    if _flag(tree.get('m_WholeNumbers')):
        out['whole'] = 1
    fill = ref(tree.get('m_FillRect'))
    if fill is not None:
        out['fill'] = fill
    handle = ref(tree.get('m_HandleRect'))
    if handle is not None:
        out['handle'] = handle
    return out


def _anim_location(value, ref):
    if not isinstance(value, dict) or not value.get('animationName'):
        return None
    return {'clip': value.get('animationName'), 'on': ref(value.get('animationWrapper'))}


def status_driver(tree, ref):
    """statusName → ops. An op sets a node active (t 1) or plays a clip (t 2, t 3), as the client's status driver does."""
    if not isinstance(tree, dict) or not isinstance(tree.get('_statusEntries'), list):
        return None
    out = []
    for entry in tree['_statusEntries']:
        if not isinstance(entry, dict):
            continue
        ops = []
        for desc in entry.get('descriptions') or []:
            if not isinstance(desc, dict):
                continue
            kind = int(desc.get('descriptionType') or 0)
            op = {'t': kind}
            if kind == STATUS_SET_ACTIVE:
                node = ref(desc.get('gameObject'))
                if node is None:
                    continue
                op['node'] = node
                op['on'] = int(_flag(desc.get('active')))
            else:
                anim = _anim_location(desc.get('_animationLocation'), ref)
                if anim:
                    op['anim'] = anim
                back = _anim_location(desc.get('_animationLocationOut'), ref)
                if back:
                    op['animOut'] = back
                for key, short in (('isFastMode', 'fast'), ('isSwitchTweenShow', 'show'), ('isSwitchTweenReset', 'reset')):
                    if _flag(desc.get(key)):
                        op[short] = 1
                if _num(desc.get('animationDelay')):
                    op['delay'] = _num(desc.get('animationDelay'))
                rt = ref(desc.get('rectTransform'))
                if rt is not None:
                    op['rect'] = {'node': rt, 'pos': _vec(desc.get('anchoredPosition')), 'size': _vec(desc.get('sizeDelta'))}
                cg = ref(desc.get('canvasGroup'))
                if cg is not None:
                    op['alpha'] = {'node': cg, 'value': _num(desc.get('canvasGroupAlpha'))}
                if 'anim' not in op and 'rect' not in op and 'alpha' not in op:
                    continue
            ops.append(op)
        out.append({'name': entry.get('statusName') or '', 'ops': ops})
    return out


def spine_graphic(tree, name_of):
    """Spine SkeletonGraphic: the skeleton data asset name and the clip it starts with."""
    if not isinstance(tree, dict) or 'skeletonDataAsset' not in tree:
        return None
    out = {'data': name_of(tree.get('skeletonDataAsset'))}
    if tree.get('startingAnimation'):
        out['anim'] = tree.get('startingAnimation')
    if _flag(tree.get('startingLoop')):
        out['loop'] = 1
    if tree.get('initialSkinName'):
        out['skin'] = tree.get('initialSkinName')
    if 'timeScale' in tree and _num(tree.get('timeScale')) not in (1, 0):
        out['timeScale'] = _num(tree.get('timeScale'))
    return out


def raw_image(tree, name_of):
    if not isinstance(tree, dict) or 'm_Texture' not in tree or 'm_UVRect' not in tree:
        return None
    out = {'tex': name_of(tree.get('m_Texture')), 'color': _hex(tree.get('m_Color'))}
    uv = _vec(tree.get('m_UVRect'), ('x', 'y', 'width', 'height'))
    if uv != [0, 0, 1, 1]:
        out['uv'] = uv
    return out


def is_particles(tree):
    return isinstance(tree, dict) and '_particles' in tree and '_scale3D' in tree


def color_group(tree, ref):
    """A colour applied to listed graphics (the ready button's hotspot, the countdown's view holder)."""
    if not isinstance(tree, dict) or '_colorElements' not in tree or '_color' not in tree:
        return None
    nodes = [n for n in (ref(p) for p in tree.get('_colorElements') or []) if n is not None]
    return {'color': _hex(tree.get('_color')), 'nodes': nodes}


def font_binding(tree):
    """The client's font binder: a dynamic font by name on the same node's Text."""
    if not isinstance(tree, dict) or '_fontName' not in tree:
        return None
    return tree.get('_fontName') or None


def controller(tree, ref, script_id=None):
    """Any other script with references into the prefab: field → node, field → {clip, on}. None without references."""
    if not isinstance(tree, dict):
        return None
    refs, anims = {}, {}
    for key, value in tree.items():
        if not key.startswith('_') or key in ('_statusEntries', '_particles', '_colorElements'):
            continue
        if isinstance(value, dict) and 'm_PathID' in value:
            node = ref(value)
            if node is not None:
                refs[key] = node
        elif isinstance(value, dict) and 'animationName' in value:
            anim = _anim_location(value, ref)
            if anim:
                anims[key] = anim
        elif isinstance(value, list) and value and all(isinstance(v, dict) and 'm_PathID' in v for v in value):
            nodes = [n for n in (ref(v) for v in value) if n is not None]
            if nodes:
                refs[key] = nodes
    if not refs and not anims:
        return None
    out = {'script': str(script_id) if script_id is not None else None}
    if refs:
        out['refs'] = refs
    if anims:
        out['anims'] = anims
    return out


def text_extras(tree):
    """m_FontData beyond size and colour: TextAnchor 0–8, overflow, line spacing, style, rich text."""
    font = (tree or {}).get('m_FontData') if isinstance(tree, dict) else None
    if not isinstance(font, dict):
        return {}
    out = {'align': int(font.get('m_Alignment') or 0)}
    if not _flag(font.get('m_RichText')):
        out['rich'] = 0
    if _flag(font.get('m_HorizontalOverflow')):
        out['hov'] = 1
    if _flag(font.get('m_VerticalOverflow')):
        out['vov'] = 1
    spacing = _num(font.get('m_LineSpacing', 1))
    if spacing != 1:
        out['lineSpacing'] = spacing
    style = int(font.get('m_FontStyle') or 0)
    if style:
        out['style'] = style
    return out


def image_extras(tree):
    if not isinstance(tree, dict):
        return {}
    out = {}
    ppu = _num(tree.get('m_PixelsPerUnitMultiplier', 1))
    if ppu not in (0, 1):
        out['ppu'] = ppu
    if _flag(tree.get('m_PreserveAspect')):
        out['preserve'] = 1
    if 'm_FillCenter' in tree and not _flag(tree.get('m_FillCenter')):
        out['fillCenter'] = 0
    if int(tree.get('m_Type') or 0) == 3:
        out['fillOrigin'] = int(tree.get('m_FillOrigin') or 0)
        out['clockwise'] = int(_flag(tree.get('m_FillClockwise')))
    return out


def rotation_z(quat):
    """Degrees about z from a quaternion dict; 0 when there is none."""
    if not isinstance(quat, dict):
        return 0
    x, y, z, w = (float(quat.get(k, 0 if k != 'w' else 1) or 0) for k in ('x', 'y', 'z', 'w'))
    angle = math.degrees(math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))
    return _num(angle, 2) if abs(angle) > 0.01 else 0


def font_glyphs(tree):
    """A bitmap Font's glyphs: char code, uv rect [x, y, w, h] (0–1, from the bottom), vert rect, advance."""
    rects = (tree or {}).get('m_CharacterRects') if isinstance(tree, dict) else None
    if not isinstance(rects, list):
        return []
    out = []
    for rect in rects:
        if not isinstance(rect, dict):
            continue
        out.append({
            'char': int(rect.get('index') or 0),
            'uv': _vec(rect.get('uv'), ('x', 'y', 'width', 'height')),
            'vert': _vec(rect.get('vert'), ('x', 'y', 'width', 'height')),
            'advance': _num(rect.get('advance')),
        })
    return out


# ---- legacy AnimationClips (the theme prefabs' Animation components) ----
# A float curve's target: classID 1 GameObject, 114 a script (Image / Text / RawImage by script path id, else other),
# 224 RectTransform, 225 CanvasGroup. Attributes the client draws get short names; the rest are dropped.
CLIP_SCRIPT_TARGET = {
    350208831926335389: 'img',
    8843432510084398651: 'txt',
    8211606541286769707: 'raw',
}
CLIP_FLOAT_ATTRS = {
    (1, 'm_IsActive'): 'active',
    (225, 'm_Alpha'): 'alpha',
    (224, 'm_AnchoredPosition.x'): 'ax', (224, 'm_AnchoredPosition.y'): 'ay',
    (224, 'm_SizeDelta.x'): 'sw', (224, 'm_SizeDelta.y'): 'sh',
    (224, 'm_LocalEulerAnglesRaw.z'): 'rz',
}
INF = 1e9


def _key_num(value):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0
    if math.isinf(f):
        return INF if f > 0 else -INF
    if math.isnan(f):
        return 0
    r = round(f, 4)
    return int(r) if r == int(r) else r


def _scalar_keys(curve):
    keys = []
    for k in ((curve or {}).get('m_Curve') or []):
        keys.append([_key_num(k.get('time')), _key_num(k.get('value')), _key_num(k.get('inSlope')), _key_num(k.get('outSlope'))])
    return keys


def _vector_keys(curve, axes):
    keys = []
    for k in ((curve or {}).get('m_Curve') or []):
        v, i, o = k.get('value') or {}, k.get('inSlope') or {}, k.get('outSlope') or {}
        keys.append([_key_num(k.get('time')), [_key_num(v.get(a)) for a in axes], [_key_num(i.get(a)) for a in axes],
                     [_key_num(o.get(a)) for a in axes]])
    return keys


def clip_info(tree):
    """A legacy AnimationClip → {len, wrap, curves}. curves: [path, prop, keys] with keys [time, value, inSlope, outSlope]
    (a vector prop: value / slopes are lists). props: active, alpha, ax / ay, sw / sh, rz, img.r…a, txt.r…a, raw.a, maxw,
    scale (x, y, z), rot (quaternion x, y, z, w). ±1e9 is an infinite slope (a step). Weighted keys are read as plain
    Hermite ones ([ASSUMED] they are 1 % of the keys)."""
    if not isinstance(tree, dict) or not tree.get('m_Legacy'):
        return None
    curves = []
    length = 0.0
    for c in tree.get('m_FloatCurves') or []:
        cls = int(c.get('classID') or 0)
        attr = c.get('attribute') or ''
        prop = CLIP_FLOAT_ATTRS.get((cls, attr))
        if prop is None and cls == 114:
            sid = int((c.get('script') or {}).get('m_PathID', 0))
            target = CLIP_SCRIPT_TARGET.get(sid)
            if target and attr.startswith('m_Color.'):
                prop = f'{target}.{attr[-1]}'
            elif attr == 'maxWidth':
                prop = 'maxw'
        if prop is None:
            continue
        keys = _scalar_keys(c.get('curve'))
        if keys:
            curves.append([c.get('path') or '', prop, keys])
            length = max(length, keys[-1][0])
    for field, prop, axes in (('m_ScaleCurves', 'scale', ('x', 'y', 'z')), ('m_PositionCurves', 'lpos', ('x', 'y', 'z')),
                              ('m_RotationCurves', 'rot', ('x', 'y', 'z', 'w')), ('m_EulerCurves', 'euler', ('x', 'y', 'z'))):
        for c in tree.get(field) or []:
            keys = _vector_keys(c.get('curve'), axes)
            if keys:
                curves.append([c.get('path') or '', prop, keys])
                length = max(length, keys[-1][0])
    return {'len': _key_num(length), 'wrap': int(tree.get('m_WrapMode') or 0), 'curves': curves}


def _saved(tree, key):
    """m_SavedProperties list (pairs) → dict."""
    items = ((tree or {}).get('m_SavedProperties') or {}).get(key) or []
    out = {}
    for item in items:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            out[item[0]] = item[1]
        elif isinstance(item, dict) and 'first' in item:
            out[item['first']] = item.get('second')
    return out


def material_info(tree, name_of=None):
    """An Image's own material: its name; fx 1 when it samples textures of its own (a shader effect). With name_of, the
    effect shader's base texture (_BaseTex, its tiling and offset, its UV scroll per second), alpha mask (_Mask_Tex, its
    tiling) and tint (_Color) — enough for ui/prefab/view.js to draw the base × colour × mask; dissolves and distortion
    are left out. Also read: the shape shader's ring (two radii and their smoothing, an optional tiled _AdditionMap
    inside it), the particle-sheet shader's frames (_ParticleTex, columns × rows, the colour that picks a frame),
    _RgbCtrl (the vertex colour drives the shader instead of tinting) and an additive blend."""
    if not isinstance(tree, dict):
        return None
    out = {'name': tree.get('m_Name') or ''}
    envs = _saved(tree, 'm_TexEnvs')
    for env in envs.values():
        tex = (env or {}).get('m_Texture') or {}
        if int(tex.get('m_PathID', 0) or 0):
            out['fx'] = 1
            break
    floats = _saved(tree, 'm_Floats')
    colors = _saved(tree, 'm_Colors')
    # the shape shader (mat_shape_circle_*): a ring between two radii in UV units (0.5 is the rect's edge), each edge
    # smoothed; it needs no texture, so it is read before the texture-less return
    if '_InStep' in floats and '_OutStep' in floats:
        out['ring'] = [_num(floats.get('_InStep')), _num(floats.get('_InSmooth', 0)),
                       _num(floats.get('_OutStep')), _num(floats.get('_OutSmooth', 0))]
    # a destination factor of One (BlendMode.One in _DstBlend, or the effect shaders' own _Dst): additive light
    if _num(floats.get('_DstBlend', 0)) == 1 or _num(floats.get('_Dst', 0)) == 1:
        out['blend'] = 'add'
    if name_of is None or not out.get('fx'):
        return out

    def tex_name(key):
        env = envs.get(key) or {}
        ptr = env.get('m_Texture') or {}
        if int(ptr.get('m_FileID', 0) or 0) or not int(ptr.get('m_PathID', 0) or 0):
            return None
        return name_of(ptr)

    def tex_tile(key):
        scale = _vec((envs.get(key) or {}).get('m_Scale'))
        return scale if scale != [1, 1] else None

    base = tex_name('_BaseTex') or tex_name('_MainTex')
    if base:
        env = envs.get('_BaseTex') if tex_name('_BaseTex') else envs.get('_MainTex')
        scale = _vec((env or {}).get('m_Scale'))
        offset = _vec((env or {}).get('m_Offset'))
        out['base'] = base
        if scale != [1, 1]:
            out['tile'] = scale
        if any(offset):
            out['offset'] = offset
        speed = [_num(floats.get('_BaseTex_SpeedU', 0)), _num(floats.get('_BaseTex_SpeedV', 0))]
        if any(speed):
            out['speed'] = speed
    mask = tex_name('_Mask_Tex')
    if mask:
        out['mask'] = mask
        if tex_tile('_Mask_Tex'):
            out['maskTile'] = tex_tile('_Mask_Tex')
    # the particle-sheet shader (mat_entry_num_sheet …): columns × rows frames, row by row from the top-left; with
    # _PropertyCtrlMode 1 the Image colour's red channel picks the frame, drawn in _Color1
    sheet = tex_name('_ParticleTex')
    if sheet and ('_Column' in floats or '_Row' in floats):
        out['sheet'] = {'tex': sheet, 'cols': max(1, int(_num(floats.get('_Column', 1)) or 1)),
                        'rows': max(1, int(_num(floats.get('_Row', 1)) or 1)),
                        'ctrl': int(_num(floats.get('_PropertyCtrlMode', 0))),
                        'color': _hex(colors.get('_Color1')) if colors.get('_Color1') else '#FFFFFF'}
    add = tex_name('_AdditionMap')
    if add:
        out['add'] = add
        if tex_tile('_AdditionMap'):
            out['addTile'] = tex_tile('_AdditionMap')
    if _num(floats.get('_RgbCtrl', 0)) == 1:
        out['rgbCtrl'] = 1
    tint = _hex(colors.get('_Color')) if colors.get('_Color') else None
    if tint and tint != '#FFFFFF':
        out['tint'] = tint
    if tex_name('_Dissolve1_Tex') or tex_name('_Dissolve2_Tex') or tex_name('_DissolveTex'):
        out['dissolve'] = 1
    return out

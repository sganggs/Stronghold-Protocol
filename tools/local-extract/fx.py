"""The official battle effects (特效) of 卫戍协议：盟约 from a locally installed client
(DESIGN §33, docs/design/vfx-format.md: the format every file below follows).

Run through extract.py (needs the client and .venv-extract; nothing is extracted on a plain `extract.py` run):
  .venv/bin/python tools/local-extract/extract.py --only fx                 the Phase 1a sample (FX_SAMPLE_*)
  .venv/bin/python tools/local-extract/extract.py --only fx --fx-set used   every effect the mode's units reference
  .venv/bin/python tools/local-extract/extract.py --only fx --fx-keys common_hit_01,buff_stun

What is read (paths relative to the AB root, see extract.py CANDIDATES):
  battle/prefabs/effects/<code>.ab, pkgrps/btl_pfb_fx_*.ab   the effect prefabs (one prefab = one effect key)
  refs/fx/**, [uc]shaders.ab, shaders/*.ab, anon/*.bin       their shared materials / textures / meshes, the shaders
                                                             (only their names and render states are read), the
                                                             MonoScripts (class names of the behaviours)
  charpack/<charId>.ab, chararts/<charId>.ab                 the operators' attack modes / effect emitters, the skin
                                                             mount points (HitPoint, Muzzle, HeadPoint, …)
  battle/prefabs/[uc]projectiles.ab, [uc]skills.ab           projectile flight + effects, the skills' effects
  config/buff_template_holder.ab                             the buff templates (a buff's default effect, its actions)
  battle/enm_pfb_*.ab, pkgrps/btl_pfb_tokens_*.ab            enemies and tokens
and from the repository: data/chess.json, backups.json, enemies.json, tokens.json (the unit list, the skills, the
enemies' talent keys) and, when setup fetched them, .cache/gamedata/excel/character_table.json, battle_equip_table.json
and uniequip_table.json (our data's talent indexes → the prefabs' Talents/<key> nodes, index.json units[id].talentKeys).

What is written under <out>/fx (every file is listed in data/local-fx.json, next to the --manifest — its own file: ~8,800
entries kept out of data/local-assets.json, which has no fx group — and the server hands that list out with each URL
carrying its file's content hash):
  index.json           per unit (charId / enemy key / token id): attack modes (cast / hit / projectile), mount points,
                       its talents and common / general abilities (their effects' roles, when they act, the buff
                       template actions that cast them, our data's talent ids); per skill its effects with their
                       roles (start / loop / range / hit / end …, from the skill prefab and the buff templates, with
                       the buffs' lives), its abilities' projectiles and the mode it switches to; the projectiles; the
                       generic keys (hits, deaths, deploy, status loops)
  textures.json        texture key → size, wrap, filter, alpha, the WebP files
  prefabs/<file>.json  one descriptor per effect prefab: nodes (Unity-native transforms), ParticleSystems (every
                       enabled module), renderers, materials (shader name + resolved render state), decoded clips,
                       behaviours
  tex/<key>.webp       textures (WebP q90, alpha kept); tex/half/<key>.webp the half-size copy of the light tier
  mesh/<key>.json      meshes of mesh particles, MeshRenderers, SkinnedMeshRenderers and mesh shapes
Everything is (c) Hypergryph; for private, non-commercial fan use only. Nothing of it is ever committed.
"""
import hashlib
import json
import math
import os
import re
import struct
import subprocess
import sys
import time
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

FX_SUB = 'fx'
FORMAT_VERSION = 1      # the descriptors and textures.json (§33.4–§33.8)
MESH_VERSION = 2        # the meshes (§33.9): 2 since Phase 1c — vertex colours 0…1 (version 1 wrote the bytes, 0…255)
INDEX_VERSION = 3       # index.json (§33.12): 2 since Phase 1c, 3 since Phase 1d (2026-10-15) — vfx-format.md's changelog
MANIFEST_VERSION = 1    # data/local-fx.json top-level "version" (the file list; index.json carries INDEX_VERSION)
FX_MANIFEST = 'local-fx.json'                           # data/local-fx.json: every fx file, served as a hashed view
FX_GROUPS = ('fx', 'fx/prefabs', 'fx/tex', 'fx/mesh')   # its groups (§33.1; none of them in data/local-assets.json)

# effect prefabs: battle/prefabs/effects/<prefix>.ab holds the keys `<prefix>_…`; the enemy / token / map effects are
# grouped in pkgrps packs (looked up through the container index)
EFFECT_GLOBS = ('battle/prefabs/effects/*.ab', 'pkgrps/btl_pfb_fx_*.ab')
# where the CABs an effect bundle depends on live (found by CAB name: their file names change between client versions)
CAB_DIRS = ('refs/fx', 'shaders', 'anon', 'arts/effects', 'battle/prefabs/effects', 'pkgrps')
CAB_FILES = ('[uc]shaders.ab', 'arts/maps/effect.ab')
PROJECTILES = 'battle/prefabs/[uc]projectiles.ab'
# projectile behaviours whose _mainEffect is a line, not the projectile's flying effect (`main`): a chain lightning's
# (drawn between the chain's targets as the shot reaches them) or a harpoon's rope (from the shooter to the head) —
# index.json `link`; the runtime tells them apart by `behaviours` (render/vfx/flight.js projectileParts)
LINK_BEHAVIOURS = ('ChainLightningEffectBehaviour', 'HarpoonRenderer')
SKILLS = 'battle/prefabs/[uc]skills.ab'
ENEMY_GLOB = 'battle/enm_pfb_*.ab'
TOKEN_GLOB = 'pkgrps/btl_pfb_tokens_*.ab'

# The Phase 1a sample (handoff/vfx-feasibility.md): these effect keys, every effect the sample units reference, the
# generic keys (FX_GENERIC + every buff_* of buff.ab) and a few prefabs that cover the rarer features of the format
FX_SAMPLE_KEYS = [
    'common_hit_01', 'common_firemagic_hit_01', 'common_enemy_hit_01', 'common_char_die_01', 'common_enemy_die_01',
    'common_char_birth_01', 'buff_stun', 'buff_frozen', 'buff_autochess_frozen', 'buff_sleep', 'buff_burn', 'buff_cold',
    'inside_attack_01_start_front', 'inside_attack_01_trail_front', 'inside_attack_01_hit',
    'greyy_attack_01_start', 'greyy_attack_01_trail', 'greyy_attack_01_hit', 'silent_attack_01_trail', 'myrrh_attack_01_hit',
    'ifrit_attack_01_start', 'ifrit_skill_03_start', 'ifrit_skill_03_range', 'ifrit_skill_03_buff',
    'amgoat_skill_03_trail', 'amgoat_skill_03_hit', 'amgoat_skill_03_buff',
    'lazerd_attack_01_start', 'lazerd_attack_01_trail', 'lazerd_attack_01_hit', 'enemy_tidmag_attack_01_hit',
]
FX_SAMPLE_UNITS = ['char_498_inside', 'char_253_greyy', 'char_108_silent', 'char_134_ifrit', 'char_180_amgoat',
                   'enemy_1041_lazerd', 'enemy_1041_lazerd_2', 'enemy_1161_tidmag', 'enemy_1161_tidmag_2']
# one prefab per rare feature (DESIGN §33.13): mesh shape, ribbon / particle trails, rate over
# distance, orbital velocity, velocity alignment, horizontal billboard, custom-data shader, clips on GameObject.active /
# ParticleSystem / LineRenderer, LineRenderer, birth / death sub-emitters, prewarm
FX_COVERAGE_KEYS = [
    'swire2_skill_02_range', 'kroos2_attack_trail_01', 'bldsk_attack_01_start', 'vendla_attack_trail_01',
    'akkord_skill_02_buff_01', 'jesca2_skill_01_trail_01', 'chen2_skill_02_range_01', 'enemy_tgshd_attack_start_01',
    'crosly_attack_a_start', 'aphris_attack_01_line_01', 'enemy_jakill_reborn_03_start', 'irene_skill_03_range_02',
    'enemy_achunt_chain',
    # and one prefab per rarer behaviour class: SwitchableBackEffect, SwitchableRightEffect,
    # SwitchableEffectByFaceDirection, FollowTileHeight, FunnelHitEffect, TriggerAnimatorWhenFinish, OnFinishAnime,
    # PauseEffectIfDisappeared, FxUVRotation, FollowDirection, PauseEffectWithAnimation
    'chen2_skill_01_buff_02', 'indigo_skill_01_buff_02', 'angel2_attack_loop_start_01', 'sbell2_ground_01',
    'lumen_skill_02_hit', 'glady_skill_01_line', 'phatm2_skill_03_buff_02', 'etlchi_innate_hit_01', 'enemy_crstf_buff_01',
    'yu_skill1_attack_01', 'aglna2_skill_02_buff_weapon_02',
]
# Generic keys the client binds in code (no data file names them): what the remake shows for a hit by damage type, a
# death, a deploy, and the status loops keyed by the sim's status names (render/style.js STATUS_ICON)
FX_GENERIC = {
    'hit': {'phys': 'common_hit_01', 'arts': 'common_magic_hit_01', 'heal': 'common_heal_hit_01',
            'enemy': 'common_enemy_hit_01', 'fire': 'common_firemagic_hit_01', 'cut': 'common_cuting_hit_01',
            'ranger': 'common_ranger_hit_01'},
    'die': {'char': 'common_char_die_01', 'enemy': 'common_enemy_die_01'},
    'birth': {'char': 'common_char_birth_01'},
    'status': {'stun': 'buff_stun', 'freeze': 'buff_autochess_frozen', 'cold': 'buff_cold', 'sleep': 'buff_sleep',
               'burn': 'buff_burn', 'silence': 'buff_silence', 'slow': 'buff_slowdown', 'sluggish': 'buff_sluggish',
               'fear': 'common_buff_fear', 'levitate': 'common_levitate_01', 'bind': 'common_root_01',
               'groundbind': 'common_root_01', 'stealth': 'common_stealth', 'shield': 'common_shield_01',
               'weaken': 'buff_weak', 'fragile': 'buff_ fragile_01', 'artsFragile': 'buff_ fragile_01',
               'physFragile': 'buff_ fragile_01', 'elemFragile': 'buff_ fragile_01', 'defDown': 'buff_defdown',
               'resDown': 'buff_magic_resistance_down', 'aspdDown': 'buff_attack_speed_reduction_01',
               'disarm': 'common_disarm_01', 'invulnerable': 'common_invincible_01', 'poison': 'buff_poison'},
}
FX_GENERIC_BUNDLES = ('battle/prefabs/effects/buff.ab',)   # every prefab of these is a generic key too

FX_SAFE = re.compile(r'[^A-Za-z0-9_.\-]+')
WEBP_QUALITY = 90
WEBP_METHOD = 4        # libwebp effort: 6 is ~90x slower here for 4.5 % smaller files
HALF_MIN = 64          # textures smaller than this (either side) get no half-size copy

# ---- Unity enums (UnityEngine) used by the descriptors ----------------------------------------------------------------
BLEND = ['Zero', 'One', 'DstColor', 'SrcColor', 'OneMinusDstColor', 'SrcAlpha', 'OneMinusSrcColor', 'DstAlpha',
         'OneMinusDstAlpha', 'SrcAlphaSaturate', 'OneMinusSrcAlpha']
BLEND_OP = ['Add', 'Subtract', 'ReverseSubtract', 'Min', 'Max']
COMPARE = ['Disabled', 'Never', 'Less', 'Equal', 'LessEqual', 'Greater', 'NotEqual', 'GreaterEqual', 'Always']
CULL = ['Off', 'Front', 'Back']
SHAPE_TYPES = ['sphere', 'sphereShell', 'hemisphere', 'hemisphereShell', 'cone', 'box', 'mesh', 'coneShell', 'coneVolume',
               'coneVolumeShell', 'circle', 'circleEdge', 'singleSidedEdge', 'meshRenderer', 'skinnedMeshRenderer',
               'boxShell', 'boxEdge', 'donut', 'rectangle', 'sprite', 'spriteRenderer']
RENDER_MODES = ['billboard', 'stretch', 'horizontalBillboard', 'verticalBillboard', 'mesh', 'none']
RENDER_ALIGN = ['view', 'world', 'local', 'facing', 'velocity']
VERTEX_STREAMS = ['Position', 'Normal', 'Tangent', 'Color', 'UV', 'UV2', 'UV3', 'UV4', 'AnimBlend', 'AnimFrame', 'Center',
                  'VertexID', 'SizeX', 'SizeXY', 'SizeXYZ', 'Rotation', 'Rotation3D', 'RotationSpeed', 'RotationSpeed3D',
                  'Velocity', 'Speed', 'AgePercent', 'InvStartLifetime', 'StableRandomX', 'StableRandomXY',
                  'StableRandomXYZ', 'StableRandomXYZW', 'VaryingRandomX', 'VaryingRandomXY', 'VaryingRandomXYZ',
                  'VaryingRandomXYZW', 'Custom1X', 'Custom1XY', 'Custom1XYZ', 'Custom1XYZW', 'Custom2X', 'Custom2XY',
                  'Custom2XYZ', 'Custom2XYZW', 'NoiseSumX', 'NoiseSumXY', 'NoiseSumXYZ', 'NoiseImpulseX',
                  'NoiseImpulseXY', 'NoiseImpulseXYZ', 'MeshIndex', 'ParticleIndex', 'ColorPackedAsTwoFloats']
TEXTURE_FORMATS = {1: 'Alpha8', 3: 'RGB24', 4: 'RGBA32', 5: 'ARGB32', 7: 'RGB565', 10: 'DXT1', 12: 'DXT5', 13: 'RGBA4444',
                   25: 'BC7', 26: 'BC4', 27: 'BC5', 34: 'ETC_RGB4', 45: 'ETC2_RGB', 47: 'ETC2_RGBA8', 48: 'ASTC_4x4',
                   49: 'ASTC_5x5', 50: 'ASTC_6x6', 51: 'ASTC_8x8', 52: 'ASTC_10x10', 53: 'ASTC_12x12'}
CLASS_IDS = {1: 'GameObject', 4: 'Transform', 23: 'MeshRenderer', 33: 'MeshFilter', 95: 'Animator', 96: 'TrailRenderer',
             108: 'Light', 111: 'Animation', 114: 'MonoBehaviour', 120: 'LineRenderer', 137: 'SkinnedMeshRenderer',
             198: 'ParticleSystem', 199: 'ParticleSystemRenderer', 212: 'SpriteRenderer', 224: 'RectTransform'}
# Unity's built-in meshes (the player's "unity default resources", not in any bundle), by path id
BUILTIN_MESHES = {10202: 'Cube', 10206: 'Cylinder', 10207: 'Sphere', 10208: 'Capsule', 10209: 'Plane', 10210: 'Quad'}
TRANSFORM_PROPS = {1: ('localPosition', 'xyz'), 2: ('localRotation', 'xyzw'), 3: ('localScale', 'xyz'),
                   4: ('localEulerAnglesRaw', 'xyz')}
MATERIAL_COMPONENTS = {0: 'x', 1: 'y', 2: 'z', 3: 'w', 4: 'r', 5: 'g', 6: 'b', 7: 'a', 8: ''}
PS_MODULES = ('InitialModule', 'ShapeModule', 'EmissionModule', 'SizeModule', 'RotationModule', 'ColorModule', 'UVModule',
              'VelocityModule', 'InheritVelocityModule', 'LifetimeByEmitterSpeedModule', 'ForceModule',
              'ExternalForcesModule', 'ClampVelocityModule', 'NoiseModule', 'SizeBySpeedModule', 'RotationBySpeedModule',
              'ColorBySpeedModule', 'CollisionModule', 'TriggerModule', 'SubModule', 'LightsModule', 'TrailModule',
              'CustomDataModule')
PS_TOP = ('lengthInSec', 'simulationSpeed', 'stopAction', 'cullingMode', 'ringBufferMode', 'ringBufferLoopRange',
          'emitterVelocityMode', 'looping', 'prewarm', 'playOnAwake', 'useUnscaledTime', 'autoRandomSeed', 'startDelay',
          'moveWithTransform', 'moveWithCustomTransform', 'scalingMode', 'randomSeed')
RENDERER_COMMON = ('m_Enabled', 'm_SortingLayerID', 'm_SortingLayer', 'm_SortingOrder')
PSR_FIELDS = ('m_RenderMode', 'm_RenderAlignment', 'm_SortMode', 'm_SortingFudge', 'm_MinParticleSize', 'm_MaxParticleSize',
              'm_CameraVelocityScale', 'm_VelocityScale', 'm_LengthScale', 'm_NormalDirection', 'm_Pivot', 'm_Flip',
              'm_AllowRoll', 'm_FreeformStretching', 'm_RotateWithStretchDirection', 'm_UseCustomVertexStreams',
              'm_VertexStreams', 'm_MeshDistribution', 'm_Mesh', 'm_Mesh1', 'm_Mesh2', 'm_Mesh3', 'm_MeshWeighting',
              'm_MeshWeighting1', 'm_MeshWeighting2', 'm_MeshWeighting3', 'm_MaskInteraction')
TRAIL_FIELDS = ('m_Time', 'm_Parameters', 'm_MinVertexDistance', 'm_Autodestruct', 'm_Emitting')
LINE_FIELDS = ('m_Positions', 'm_Parameters', 'm_UseWorldSpace', 'm_Loop')
SKIN_FIELDS = ('m_Mesh', 'm_Bones', 'm_RootBone', 'm_Quality', 'm_UpdateWhenOffscreen', 'm_BlendShapeWeights')
SKIP_FIELDS = {'m_GameObject', 'm_Script', 'm_Name', 'm_Enabled'}
MOUNT_NAME = re.compile(r'(Point|Muzzle|Anchor|^Special)', re.I)

# ---- Torappu enums of the skills' effect fields (il2cpp metadata, DESIGN §33.12) ------------------------------------
# Torappu.Battle.AbilityStandard/Event: an UberEffectEmitter row's _startEvent / _endEvent, the play / stop events of the
# channeling and range emitters
ABILITY_EVENTS = ('ON_ATTACHED', 'ON_DETACHED', 'ON_CAST_START', 'ON_CAST_END', 'ON_SPELL_ON', 'ON_SPELL_END',
                  'ON_ATTACK_FINISH', 'ON_ATTACK_CHECK_POINT', 'ON_OVERLOAD')
# Torappu.Battle.Buff/Event: the keys of a buff template's action graphs (eventToActions)
BUFF_EVENTS = (
    'ON_BUFF_START', 'ON_BUFF_FINISH', 'ON_BUFF_TRIGGER', 'ON_OWNER_KILLED', 'ON_OWNER_FINISH', 'ON_BEFORE_APPLYING_MODIFIER',
    'ON_APPLYING_MODIFIER', 'ON_APPLIED_MODIFIER', 'ON_OUTPUT_MODIFIER', 'ON_TARGET_KILLED', 'ON_TAKE_DAMAGE',
    'ON_OUTPUT_DAMAGE', 'ON_OWNER_BORN', 'ON_OWNER_LOCATE', 'ON_CALCULATE_DAMAGE', 'ON_EVADE_DAMAGE', 'ON_ABILITY_START',
    'ON_ABILITY_FINISH', 'ON_ABILITY_SPELL_ON', 'ON_ABILITY_CAST_ON_TARGET', 'ON_SKILL_FINISH', 'ON_AFTER_OUTPUT_DAMAGE',
    'ON_OUTPUT_ATK_OR_HEAL', 'ON_AFTER_ATTACK', 'ON_BUFF_ENABLE', 'ON_BUFF_DISABLE', 'ON_BEFORE_ATTACK',
    'ON_BEFORE_TRY_SET_HP_ZERO', 'ON_BEFORE_DISAPPEAR', 'ON_OWNER_KILLED_BY_MAIN_TARGET', 'ON_ABNORMAL_FLAG_DIRTY',
    'ON_AFTER_CALCULATE_DAMAGE', 'ON_BUFF_LATE_ENABLE', 'ON_SKILL_START', 'ON_OWNER_REACH_EXIT', 'ON_OWNER_POST_BORN',
    'ON_OTHER_BUFF_START', 'ON_OWNER_BLOCKEE_CHANGED', 'ON_COLLIDE_WITH_HIGHLAND', 'ON_BEFORE_EXIT_UNBALANCED_STATE',
    'ON_CALCULATE_CACHED_PROJECTILE_DAMAGE', 'ON_APPLYING_SKIPPED_MODIFIER', 'ON_ABILITY_INTERRUPTED', 'ON_BEFORE_APPEAR',
    'ON_OWNER_ROOT_TILE_CHANGED', 'ON_OTHER_RESISTABLE_BUFF_START', 'ON_BEFORE_TRY_SET_EP_ZERO', 'ON_ES_OVER_ZERO',
    'ON_ENTER_MAGICCIRCUIT', 'ON_LEAVE_MAGICCIRCUIT', 'ON_OWNER_DYING', 'ON_GAME_OVER', 'ON_MAKE_ENEMY_UNBALANCED',
    'ON_END_PULLING', 'ON_BLOCK_DAMAGE', 'ON_OWNER_OVERLAPPED', 'ON_BOSS_WAVE_WILL_START', 'ON_LEGION_MODE_DRAW_CARD',
    'ON_LEGION_MODE_REFRESH_CARD', 'ON_MOTION_MODE_CHANGED', 'ON_SANDBOX_OWNER_RES_CHANGED',
    'ON_BEFORE_TARGET_APPLY_MODIFIER', 'ON_ENTER_LEVITATE_STATE', 'ON_BEFORE_EXIT_LEVITATE_STATE',
    'ON_ENTITY_WILL_OVERLAP', 'ON_SKILL_CAST_SUCCEED', 'ON_DIRECTION_CHANGED', 'ON_BEFORE_DIRECTION_CHANGE',
    'ON_TAKE_EP_DAMAGE', 'ON_EP_BREAK_START', 'ON_EP_BREAK_FINISH', 'ON_BEFORE_FALLDOWN', 'ON_OWNER_BEFORE_DEAD',
    'ON_BEING_CALCULATE_DAMAGE', 'ON_STAGE_END', 'ON_UNIT_SWITCH_MODE', 'COOPERATE_PLAYER_DYING',
    'COOPERATE_PLAYER_REVIVE', 'ON_ENTER_UNBALANCED_STATE', 'ON_BEFORE_EP_BREAK_FINISH', 'ON_TOGGLE_SKILL_START',
    'ON_BEFORE_EP_BREAK_START', 'ON_POST_TRY_SET_HP_ZERO', 'ON_AFTER_OUTPUT_ELEMENT_DAMAGE', 'ON_BEFORE_ABILITY_SPELL_ON',
    'ON_AFTER_OUTPUT_HEAL', 'ON_LEGION_MODE_DANGER_LEVEL_REFRESH', 'ON_HALF_IDLE_TRAP_CHECK_UPGRADE',
    'ON_HALF_IDLE_KAWA_CLEANED', 'ON_HALF_IDLE_KAWA_POLLUTED', 'HALF_IDLE_GAIN_EQUIP', 'HALF_IDLE_GAIN_TRAP',
    'ON_OUTPUT_ATK_OR_HEAL_EACH_SPELL', 'ON_PALSY_OVERFLOW', 'ON_TRIGGER_PALSY', 'ON_SKILL_RETRIGGERED',
    'ON_AUTO_CHESS_MODE_CHANGED', 'ON_OWNER_BLOCK_MODE_CHANGED', 'ON_OWNER_HP_FULL', 'ON_PROJECTILE_SELECT_TARGETS',
    'ON_OWNER_REBORN', 'ON_SANDBOX_V3_RESOURCE_CNT_CHANGE', 'ON_BLOCK_CNT_CHANGE', 'ON_SANDBOX_V3_RECIPE_CHANGE',
    'ON_ENTER_GROUND_BOUND_STATE', 'ON_BEFORE_EXIT_GROUND_BOUND_STATE', 'ON_OTHER_BUFF_LATE_ENABLE', 'ON_PROJECTILE_BORN',
    'ON_PROJECTILE_HIT_TARGET')
BUFF_TEMPLATES = 'config/buff_template_holder.ab'   # Torappu BuffTemplateHolder: templateKey → effectKey + action graphs

# A skill's effect roles (index.json skills[id].roles; §33.12): start (once, when the skill — or its one cast — starts),
# loop (while it, or the buff carrying the effect, lasts), range (its area), cast (each ability use of a buff's owner),
# hit (each target hit), end (when it ends), ready (while it is ready to cast), trigger (a buff's periodic or reactive
# event), other (an effect the extractor cannot place in time)
SKILL_ROLES = ('start', 'loop', 'range', 'cast', 'hit', 'end', 'ready', 'trigger', 'other')
SKILL_RANGE = re.compile(r'_range', re.I)
SKILL_END = re.compile(r'_end(?:_|$)', re.I)
# UberEffectEmitter's row lists (rows `{_effects, …}`) → the list kind (Emit lists of a unit's attack, a skill use's `list`)
EMIT_LISTS = {'_castEffects': 'cast', '_hitEffects': 'hit', '_attachEffects': 'attach', '_inputTargetEffects': 'inputTarget',
              '_castTargetEffects': 'castTarget'}
# lists of groups whose elements hold such rows one level down (MultiHitUberEffectEmitter's per-hit groups,
# UberAnimationEffectEmitter's per-animation `_replaceGroup`): the kind of their rows, or None when the element's inner
# list names it (REPLACE_LISTS); the rows carry `group` (and a replace group's `anim`)
EMIT_GROUPS = {'_hitGroups': 'hit', '_timesBasedHitEffects': 'hit', '_castGroups': 'cast', '_replaceGroup': None}
REPLACE_LISTS = {'effectOptions': 'cast', 'hitEffectOptions': 'hit'}
# MultiHitUberEffectEmitter: how a hit picks its group (copied onto the group's uses / the attack's emitters[] when set)
MULTI_HIT_FLAGS = ('_useRandomHitEffect', '_useLoopHitEffect', '_keepBaseHitEffect', '_oncePerTarget', '_useTimesBasedHitEffect')
# single effect fields (a key or a list of keys) → role, whatever the class
EFFECT_FIELDS = {'_beginEffect': 'start', '_endEffect': 'end', '_overrideStartEffect': 'start', '_startEffect': 'start',
                 '_mainChantEffects': 'loop', '_extraChantEffects': 'loop', '_chantSuccessEffects': 'start',
                 '_beforeEndEffects': 'end', '_hitEffect': 'hit', '_hitEffectKey': 'hit', '_tileEffectKey': 'range',
                 '_edgeLineRendererEffectKey': 'range', '_effectOnEliminatePos': 'hit', '_lineEffectKey': 'loop',
                 '_startPointEffectKey': 'loop', '_waypointEffectKey': 'loop', '_endPointEffectKey': 'loop',
                 # v3: a funnel's (FunnelEffectEmitter: its idle loops facing front / back, its appearing and leaving)
                 '_idleEffect': 'loop', '_idleBackEffect': 'loop', '_overloadIdleEffect': 'loop', '_appearEffect': 'start',
                 '_disappearEffect': 'end'}
# `_effects` / `_effect` / `_effectKey` by class (others: role other; None: not played — PauseEffectDuringCasting pauses
# them, ExtraAbilityPreloads only preloads; a reborn talent's `_effects` play when the 重生 starts)
CLASS_EFFECTS = {'ReadySkillEffect': 'ready', 'TrapEddSkillReadyEffect': 'ready', 'ReadyEnemySkillEffect': 'ready', 'AuraAbility': 'loop',
                 'GlobalAuraAbility': 'loop', 'ProjectileAuraAbility': 'loop', 'AuraWithHostAsSourceAbility': 'loop',
                 'ChannelingEffectEmitter': 'loop', 'ChannelingEffectGroupEmitter': 'loop', 'PauseEffectDuringCasting': None,
                 'ExtraAbilityPreloads': None, 'RebornTalent': 'start', 'ManualTriggerRebornTalent': 'start',
                 'RallyPointRebornTalent': 'start'}
# ability events of the emitters that are not UberEffectEmitters: class → (start field, end field, oneshot field)
CLASS_EVENTS = {'ChannelingEffectEmitter': ('_playOnEvent', '_stopOnEvent', None),
                'ChannelingEffectGroupEmitter': ('_playOnEvent', '_stopOnEvent', None),
                'RangeEffectEmitter': ('_playCastEffectOnEvent', '_stopCastEffectOnEvent', '_oneShot'),
                'PauseEffectDuringCasting': ('_startEv', '_endEv', None)}
# buff events → role (a template's CreateEffect / CreateBuff nodes); others: trigger
BUFF_EVENT_ROLES = {'ON_BUFF_START': 'start', 'ON_BUFF_ENABLE': 'start', 'ON_BUFF_LATE_ENABLE': 'start',
                    'ON_SKILL_START': 'start', 'ON_TOGGLE_SKILL_START': 'start', 'ON_BUFF_FINISH': 'end',
                    'ON_BUFF_DISABLE': 'end', 'ON_SKILL_FINISH': 'end', 'ON_ABILITY_START': 'cast',
                    'ON_ABILITY_SPELL_ON': 'cast', 'ON_BEFORE_ABILITY_SPELL_ON': 'cast', 'ON_BEFORE_ATTACK': 'cast',
                    'ON_OUTPUT_DAMAGE': 'hit', 'ON_AFTER_OUTPUT_DAMAGE': 'hit', 'ON_ABILITY_CAST_ON_TARGET': 'hit',
                    'ON_OUTPUT_ATK_OR_HEAL': 'hit', 'ON_OUTPUT_ATK_OR_HEAL_EACH_SPELL': 'hit', 'ON_AFTER_ATTACK': 'hit',
                    'ON_AFTER_OUTPUT_HEAL': 'hit', 'ON_AFTER_OUTPUT_ELEMENT_DAMAGE': 'hit'}
# fields that hold animation / audio names, never effect keys (a name may equal a key by chance)
NOT_EFFECT_FIELDS = re.compile(r'anim|audio|signal', re.I)

# ---- the units' abilities and emitters (index.json units[id]: modes' attack / combat, charge, enemy skills; §33.12) ----
# the base UberEffectEmitter's own fields: a subclass's other fields are its settings (attack.emitters[]); the three
# timing fields are not exported (as before Phase 1c)
EMITTER_BASE_FIELDS = frozenset(EMIT_LISTS) | {'_convertCastEndToAttachFinish', '_recalculatePlaybackSpeed', '_preDelayFactor'}
# the charge emitters' per-energy groups (Multi(Ex)ChargeUberEffectEmitter, MergeableChargeUberEffectEmitter): nested
# [[Emit…]…] (group k = the k-th stored energy) in the emitter's settings, never attack rows
CHARGE_GROUP_LISTS = ('_chargeEffectGroups', '_chargeCastGroups', '_mergedChargeEffectGroups', '_mergedChargeCastGroups')
CHARGE_GROUP_KEYS = tuple(k.lstrip('_') for k in CHARGE_GROUP_LISTS)
ROW_KINDS = tuple(EMIT_LISTS.values())     # cast, hit, attach, inputTarget, castTarget
# a unit's chargeable groups (AbilityChargeableGroup, AbilityExChargeGroup: Trait/Charge…Group of the 秘术师)
CHARGE_GROUP = re.compile(r'Charge\w*Group$')
# fields of a charge group's abilities (ChargeRangedAttack, ExChargeRangedAttack, MergeableChargeRangeAttack) written
CHARGE_ABILITY_FIELDS = re.compile(r'^_(\w*[pP]rojectileKeys?|mountPointType|mountPointForProjectiles|exMounts|'
                                   r'max\w*ChargeTimes|mergeSize|forceExCharge|animKey)$')
# their mount lists → the field of the MountPointType names written next to them
CHARGE_MOUNT_NAMES = {'mountPointForProjectiles': 'mounts', 'exMounts': 'exMountNames', 'mountPointType': 'mount'}
# the attack fields written for every ability (modes' attack / combat, sub-abilities)
ABILITY_FIELDS = ('_animKey', '_attackType', '_damageType', '_projectileKey', '_extraProjectileKeys', '_projectileDestination')
# ability classes (a behaviour that casts: MeleeAttack, RangedHeal, ActiveBuffAbility, …) and the helpers that are not
ABILITY_CLASS = re.compile(r'Attack|Heal|Ability')
NOT_ABILITY_CLASS = re.compile(r'Emitter|Selector|Range$|Validator|Trigger|Checker|Effect$|Counter|Listener|Hooker|Animation$')
# Torappu MountPointType (il2cpp metadata; FollowMountPoint, a charge ability's _mountPointForProjectiles)
MOUNT_POINT_TYPES = ('FOOT', 'HIT', 'MUZZLE', 'HEAD', 'UI', 'SPECIAL_0', 'SPECIAL_1', 'GROUND', 'SPECIAL_2',
                     'SPECIAL_3') + tuple(f'SPECIAL_{i}' for i in range(4, 24))
# a skill prefab root's skill class derives from Torappu.Battle.Skill: its fields hold these two (CastSkill, PassiveSkill,
# AppearSkill, ReplacementSkill, …; helpers such as BuffDuringSkill do not); an enemy's skill is an `…EnemySkill` node
SKILL_BASE_FIELDS = ('_canSilenced', '_attachSignalIds')
ENEMY_SKILL_CLASS = re.compile(r'EnemySkill$')

# ---- Phase 1d (index.json v3, DESIGN §33.17): talents, common / general abilities, abilities' projectiles, buff lives -
# Torappu.LifeType (il2cpp metadata): a BuffData's lifeTimeType / triggerLifeType — the buff templates' Odin data spell
# the same fields out by name ("lifeTimeType": "INFINITY"), the prefabs write the numbers
LIFE_TYPES = ('IMMEDIATELY', 'LIMITED', 'INFINITY', 'CUSTOM')
# Torappu.Battle.Abilities.UberAnimationEffectEmitter/LoopType: how the replace groups' animations take turns
ANIM_LOOP_TYPES = ('LOOP', 'RANDOM')
# Torappu.Battle.Abilities.AbilityRandomGroup/SelectMethod
RANDOM_SELECT = ('Random', 'Loop')
# Torappu.Battle.Entity/MountPointGroup/LoopType: an ability's _mountGroup (the mount points its shots take in turn)
MOUNT_GROUP_LOOP = ('RANDOM', 'LOOP')
# a Talent behaviour (Torappu.Battle.Talent and its subclasses: AppearTalent, RebornTalent, ProbReplaceNextAtkTalent, …)
TALENT_BASE_FIELDS = ('_overwriteTalentKey', '_checkValidBySkillIndex')
# when a talent node's abilities act, by its Talent class (the rest: by its ability, talent_when)
TALENT_WHEN = (('deploy', re.compile(r'^Appear(Synced)?Talent$')), ('reborn', re.compile(r'RebornTalent$')),
               ('attack', re.compile(r'^Prob\w*NextAtkTalent$')))
# abilities attached for as long as their owner (the talent, the mode of a general ability, the unit) holds them
PASSIVE_ABILITY = re.compile(r'^(Passive|Toggleable|ExtraPassive)|Aura|^StealAttributeAbility$')
TOGGLE_CHECKER = re.compile(r'ToggleChecker$')
# buff template actions that cast / stop an ability by its name (`_abilityName`: a GameObject name or a namedAsAlias)
TRIGGER_ACTION = re.compile(r'^Trigger\w*Abilit')
STOP_ACTION = re.compile(r'^(Interrupt\w*Abilit|PauseAbility$)')
# the group abilities' choice of a sub-ability (ability_entry `select`)
GROUP_SELECT = {'AbilityRandomGroup': 'random', 'AbilitySelectableGroup': 'trigger', 'BurstAttackGroup': 'trigger',
                'AbilityFirstSucceedGroup': 'firstSucceed', 'AbilityParallelGroup': 'parallel', 'AbilitySequenceGroup': 'sequence'}
# common-ability containers (the unit head's _commonAbilities sit under them)
COMMON_NODE = re.compile(r'^CommonAbilit(y|ies)$')


# ---- pure helpers (no UnityPy; test/local-extract-fx.test.js) ---------------------------------------------------------

def fx_file(key):
    """File stem of an effect key: the key when it is URL-safe, else its safe form + the key's CRC32 (keys hold spaces,
    `#`, `[`, `]`: 'buff_ fragile_01', 'x#1')."""
    s = FX_SAFE.sub('_', key).strip('._') or 'fx'
    return s if s == key else f'{s}-{zlib.crc32(key.encode("utf-8")) & 0xffffffff:08x}'


def f6(v):
    """JSON-safe number: 6 significant digits, -0 → 0; NaN / ±inf → None."""
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return v
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x or x in (math.inf, -math.inf):
        return None
    if abs(x) < 1e-12:
        return 0
    y = float(f'{x:.6g}')
    return int(y) if y.is_integer() and abs(y) < 1e15 else y


def enc_keys(curve):
    """AnimationCurve → [[time, value, inSlope, outSlope(, weightedMode, inWeight, outWeight)], …]; an infinite slope
    (Unity's stepped tangent) is null."""
    out = []
    for k in (curve or {}).get('m_Curve', []) or []:
        row = [f6(k.get('time', 0)), f6(k.get('value', 0)), f6(k.get('inSlope', 0)), f6(k.get('outSlope', 0))]
        wm = k.get('weightedMode', 0) or 0
        if wm:
            row += [wm, f6(k.get('inWeight', 1 / 3)), f6(k.get('outWeight', 1 / 3))]
        out.append(row)
    return out


def enc_mmc(c):
    """MinMaxCurve → number (Constant) | {min, max} (TwoConstants) | {scalar, curve} (Curve) |
    {scalar, minCurve, maxCurve} (TwoCurves)."""
    st = c.get('minMaxState', 0)
    s = f6(c.get('scalar', 0))
    if st == 0:
        return s
    if st == 3:
        return {'min': f6(c.get('minScalar', 0)), 'max': s}
    if st == 1:
        return {'scalar': s, 'curve': enc_keys(c.get('maxCurve'))}
    return {'scalar': s, 'minCurve': enc_keys(c.get('minCurve')), 'maxCurve': enc_keys(c.get('maxCurve'))}


def enc_color(c):
    return [f6(c.get('r', 0)), f6(c.get('g', 0)), f6(c.get('b', 0)), f6(c.get('a', 0))]


def enc_gradient(g):
    """Gradient → {mode: 'blend'|'fixed', color: [[t, r, g, b]…], alpha: [[t, a]…]} (t in 0…1)."""
    nc = g.get('m_NumColorKeys', 2)
    na = g.get('m_NumAlphaKeys', 2)
    col = [[f6(g.get(f'ctime{i}', 0) / 65535.0)] + enc_color(g.get(f'key{i}', {}))[:3] for i in range(nc)]
    alp = [[f6(g.get(f'atime{i}', 0) / 65535.0), f6(g.get(f'key{i}', {}).get('a', 1))] for i in range(na)]
    return {'mode': 'fixed' if g.get('m_Mode', 0) == 1 else 'blend', 'color': col, 'alpha': alp}


def enc_mmg(c):
    """MinMaxGradient → [r, g, b, a] (Color) | {min, max} (TwoColors) | {gradient} | {minGradient, maxGradient} |
    {random} (RandomColor: a random point of the gradient)."""
    st = c.get('minMaxState', 0)
    if st == 0:
        return enc_color(c.get('maxColor', {}))
    if st == 2:
        return {'min': enc_color(c.get('minColor', {})), 'max': enc_color(c.get('maxColor', {}))}
    if st == 1:
        return {'gradient': enc_gradient(c.get('maxGradient', {}))}
    if st == 3:
        return {'minGradient': enc_gradient(c.get('minGradient', {})), 'maxGradient': enc_gradient(c.get('maxGradient', {}))}
    return {'random': enc_gradient(c.get('maxGradient', {}))}


def is_pptr(v):
    return isinstance(v, dict) and set(v) == {'m_FileID', 'm_PathID'}


def is_mmc(v):
    return isinstance(v, dict) and 'minMaxState' in v and 'scalar' in v and 'maxCurve' in v


def is_mmg(v):
    return isinstance(v, dict) and 'minMaxState' in v and 'maxColor' in v


def is_gradient(v):
    return isinstance(v, dict) and 'key0' in v and 'ctime0' in v


def is_curve(v):
    # an AnimationCurve's m_Curve is its key list (InheritVelocityModule / LifetimeByEmitterSpeedModule name a
    # MinMaxCurve m_Curve: those modules are dicts, encoded field by field)
    return isinstance(v, dict) and isinstance(v.get('m_Curve'), list)


def is_vec(v):
    return isinstance(v, dict) and v and set(v) <= {'x', 'y', 'z', 'w'} and all(isinstance(x, (int, float)) for x in v.values())


def is_rgba(v):
    return isinstance(v, dict) and set(v) == {'r', 'g', 'b', 'a'}


def enc_value(v, pptr):
    """Encode a typetree value for a descriptor: MinMaxCurve / MinMaxGradient / Gradient / AnimationCurve / PPtr
    (through `pptr(dict)`) / vectors / colours / floats; everything else recursively."""
    if is_pptr(v):
        return pptr(v)
    if is_mmc(v):
        return enc_mmc(v)
    if is_mmg(v):
        return enc_mmg(v)
    if is_gradient(v):
        return enc_gradient(v)
    if is_curve(v):
        return enc_keys(v)
    if is_rgba(v):
        return enc_color(v)
    if is_vec(v):
        return [f6(v[k]) for k in 'xyzw' if k in v]
    if isinstance(v, dict):
        return {k: enc_value(x, pptr) for k, x in v.items() if k != 'serializedVersion'}
    if isinstance(v, (list, tuple)):
        return [enc_value(x, pptr) for x in v]
    if isinstance(v, float):
        return f6(v)
    return v


def enum_name(table, v):
    try:
        i = int(v)
    except (TypeError, ValueError):
        return None
    return table[i] if 0 <= i < len(table) else str(i)


def state_value(state, floats, defaults=None):
    """A shader render-state value ({val, name}): when the state names a property, the material's float, else the
    property's default in the shader (Unity uses it for a property the material does not store); else the value
    written in the shader."""
    name = (state or {}).get('name') or ''
    if name and name != '<noninit>':
        if name in floats:
            return floats[name]
        if defaults and name in defaults:
            return defaults[name]
    return (state or {}).get('val', 0)


def render_state(pass_state, floats, defaults=None):
    """Resolved render state of one shader pass for a material: blend factors (colour src, dst, alpha src, dst) and
    op, ZTest, ZWrite, cull, colour mask."""
    v = lambda st: state_value(st, floats, defaults)  # noqa: E731
    rt = pass_state.get('rtBlend0', {})
    return {
        'blend': [enum_name(BLEND, v(rt.get('srcBlend'))), enum_name(BLEND, v(rt.get('destBlend'))),
                  enum_name(BLEND, v(rt.get('srcBlendAlpha'))), enum_name(BLEND, v(rt.get('destBlendAlpha')))],
        'blendOp': enum_name(BLEND_OP, v(rt.get('blendOp'))),
        'zTest': enum_name(COMPARE, v(pass_state.get('zTest'))),
        'zWrite': bool(v(pass_state.get('zWrite'))),
        'cull': enum_name(CULL, v(pass_state.get('culling'))),
        'colorMask': int(v(rt.get('colMask')) or 0),
    }


def decode_streamed(words):
    """A streamed clip (uint32 words) → [(time, [(curve, a, b, c, d)…])…]. Frame 0 sits at -FLT_MAX (start values),
    the last one at +inf (empty)."""
    raw = struct.pack('<%dI' % len(words), *words)
    frames, off = [], 0
    while off + 8 <= len(raw):
        t, n = struct.unpack_from('<fI', raw, off)
        off += 8
        keys = []
        for _ in range(n):
            if off + 20 > len(raw):
                break
            keys.append(struct.unpack_from('<i4f', raw, off))
            off += 20
        frames.append((t, keys))
    return frames


def streamed_curves(frames):
    """Per curve index, Hermite keys [[t, v, in, out]…] from the streamed frames: v = d, out = c of the key's own
    segment p(Δ) = aΔ³ + bΔ² + cΔ + d; in = the previous segment's slope at its end (3aΔ² + 2bΔ + c), null when that
    segment is stepped (a = b = c = 0 and the value jumps)."""
    seq = {}
    for t, keys in frames:
        if not (abs(t) < 1e30):
            continue
        for idx, a, b, c, d in keys:
            seq.setdefault(idx, []).append((t, a, b, c, d))
    out = {}
    for idx, ks in seq.items():
        rows = []
        for i, (t, a, b, c, d) in enumerate(ks):
            if i == 0:
                ins = c
            else:
                t0, a0, b0, c0, d0 = ks[i - 1]
                dt = t - t0
                if a0 == 0 and b0 == 0 and c0 == 0 and abs(d - d0) > 1e-9:
                    ins = None
                else:
                    ins = 3 * a0 * dt * dt + 2 * b0 * dt + c0
            stepped_out = (a == 0 and b == 0 and c == 0 and i + 1 < len(ks) and abs(ks[i + 1][4] - d) > 1e-9)
            rows.append([f6(t), f6(d), None if ins is None else f6(ins), None if stepped_out else f6(c)])
        out[idx] = rows
    return out


def dense_curves(dense, offset):
    """A dense clip (frame-major samples) → per curve index (offset + i), linear keys."""
    n, count = dense.get('m_FrameCount', 0), dense.get('m_CurveCount', 0)
    samples, rate, begin = dense.get('m_SampleArray', []) or [], dense.get('m_SampleRate', 30) or 30, dense.get('m_BeginTime', 0)
    out = {}
    if not count or not n:
        return out
    dt = 1.0 / rate
    for c in range(count):
        vals = [samples[f * count + c] for f in range(n) if f * count + c < len(samples)]
        rows = []
        for f, v in enumerate(vals):
            ins = (v - vals[f - 1]) / dt if f > 0 else 0.0
            outs = (vals[f + 1] - v) / dt if f + 1 < len(vals) else 0.0
            rows.append([f6(begin + f * dt), f6(v), f6(ins), f6(outs)])
        out[offset + c] = rows
    return out


def binding_dims(b):
    """How many curves one generic binding drives: a Transform position / scale / euler 3, a rotation 4, else 1."""
    if b.get('typeID') == 4 and b.get('attribute') in TRANSFORM_PROPS:
        return len(TRANSFORM_PROPS[b['attribute']][1])
    return 1


def material_attribute(attr):
    """(property-name CRC32 & 0x0FFFFFFF, component) of a material-property binding attribute (customType 22): the
    top four bits are the component — 0–3 a vector's x y z w, 4–7 a colour's r g b a, 8 a float."""
    return attr & 0x0FFFFFFF, MATERIAL_COMPONENTS.get(attr >> 28, str(attr >> 28))


def typetree_paths(tree, prefix='', depth=0, out=None):
    """Every dotted field path of a typetree (lists are not entered) — the candidates of a generic binding."""
    out = set() if out is None else out
    if depth > 6 or not isinstance(tree, dict):
        return out
    for k, v in tree.items():
        p = f'{prefix}.{k}' if prefix else k
        out.add(p)
        if isinstance(v, dict):
            typetree_paths(v, p, depth + 1, out)
    return out


def trs_matrix(pos, rot, scale):
    """3×4 matrix [R·S | t] of a Unity local transform (rot = quaternion x y z w)."""
    x, y, z, w = rot
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[r[i][0] * scale[0], r[i][1] * scale[1], r[i][2] * scale[2], pos[i]] for i in range(3)]


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) + (a[i][3] if j == 3 else 0) for j in range(4)] for i in range(3)]


def mat_point(m):
    return [f6(m[0][3]), f6(m[1][3]), f6(m[2][3])]


def est_live(ps):
    """Rough peak count of live particles of one encoded ParticleSystem (descriptor stats only)."""
    def top(v):
        if isinstance(v, (int, float)):
            return abs(v)
        if isinstance(v, dict):
            if 'max' in v:
                return max(abs(v.get('min') or 0), abs(v.get('max') or 0))
            keys = (v.get('curve') or []) + (v.get('maxCurve') or []) + (v.get('minCurve') or [])
            return abs(v.get('scalar') or 0) * max([abs(k[1] or 0) for k in keys] or [0])
        return 0
    im = ps.get('InitialModule', {})
    life, dur = top(im.get('startLifetime', 0)), ps.get('lengthInSec') or 1
    em = ps.get('EmissionModule')
    rate = top(em.get('rateOverTime', 0)) if em else 0
    bursts = sum(top(b.get('countCurve', 0)) * max(1, b.get('cycleCount', 1) or 1) for b in (em or {}).get('m_Bursts', []))
    span = life if ps.get('looping') else min(life, dur)
    n = rate * span + (bursts * min(1.0, life / max(dur, 1e-3)) if ps.get('looping') else bursts)
    return min(im.get('maxNumParticles', 1000) or 1000, n)


# ---- UnityPy side ---------------------------------------------------------------------------------------------------

def scan_cabs(ab_root, dirs=CAB_DIRS, files=CAB_FILES):
    """CAB name (lower case) → absolute path of every bundle under `dirs` / `files`, from the UnityFS headers only."""
    import lz4.block
    from aklz4 import decompress_lz4ak
    out = {}
    paths = []
    for d in dirs:
        base = Path(ab_root) / d
        if base.is_dir():
            paths += [p for p in base.rglob('*') if p.is_file() and p.suffix in ('.ab', '.bin')]
    paths += [Path(ab_root) / f for f in files if (Path(ab_root) / f).is_file()]
    for p in paths:
        try:
            for name in bundle_nodes(p, lz4.block, decompress_lz4ak):
                out.setdefault(name.lower(), str(p))
        except Exception:  # not a UnityFS file / unknown compression: skipped
            continue
    return out


def bundle_nodes(path, lz4block, lz4ak):
    """Node names (CAB-…) of a UnityFS bundle from its header and block info."""
    def cstr(f):
        b = bytearray()
        while True:
            c = f.read(1)
            if not c or c == b'\0':
                return b.decode('utf-8', 'replace')
            b += c
    with open(path, 'rb') as f:
        if cstr(f) != 'UnityFS':
            return []
        ver = struct.unpack('>I', f.read(4))[0]
        cstr(f)
        cstr(f)
        size, csz, usz, flags = struct.unpack('>qIII', f.read(20))
        if ver >= 7:
            f.seek((f.tell() + 15) // 16 * 16)
        if flags & 0x80:
            f.seek((size or os.path.getsize(path)) - csz)
        data = f.read(csz)
    comp = flags & 0x3F
    raw = data if comp == 0 else lz4block.decompress(data, usz) if comp in (2, 3) else lz4ak(data, usz) if comp == 4 else None
    if raw is None:
        return []
    off = 16
    nb = struct.unpack_from('>i', raw, off)[0]
    off += 4 + nb * 10
    nn = struct.unpack_from('>i', raw, off)[0]
    off += 4
    names = []
    for _ in range(nn):
        off += 20
        e = raw.index(b'\0', off)
        names.append(raw[off:e].decode())
        off = e + 1
    return names


class AssetEnv:
    """A UnityPy environment that loads the CABs a PPtr names on demand (scan_cabs), resolves PPtrs across files and
    caches typetrees / script class names."""

    def __init__(self, ab_root, cabs):
        import aklz4  # noqa: F401  (registers the LZ4AK decoder)
        import UnityPy
        self.ab_root = Path(ab_root)
        self.env = UnityPy.Environment()
        self.cabs = cabs
        self.loaded = {}
        self.sf = {}
        self._tt = {}
        self._script = {}

    def load(self, path):
        """Load a bundle (once); returns its serialized files."""
        path = str(path)
        if path in self.loaded:
            return self.loaded[path]
        before = set(self.sf)
        self.env.load_file(path)
        self._index()
        self.loaded[path] = [self.sf[k] for k in self.sf if k not in before]
        return self.loaded[path]

    def load_rel(self, rel):
        return self.load(self.ab_root / rel)

    def _index(self):
        def walk(f):
            for name, sub in getattr(f, 'files', {}).items():
                if hasattr(sub, 'objects') and hasattr(sub, 'externals'):
                    self.sf.setdefault(name.lower(), sub)
                else:
                    walk(sub)
        for f in list(self.env.files.values()):
            walk(f)

    def sfile(self, cab):
        cab = cab.lower()
        if cab not in self.sf and cab in self.cabs:
            try:
                self.load(self.cabs[cab])
            except Exception:
                pass
        return self.sf.get(cab)

    def resolve(self, sfile, pptr):
        """(file, object) of a typetree PPtr seen in `sfile`; ('builtin', path id) for Unity's default resources;
        (None, None) when null or unresolvable."""
        if not isinstance(pptr, dict):
            return None, None
        fid, pid = pptr.get('m_FileID', 0), pptr.get('m_PathID', 0)
        if not pid:
            return None, None
        if fid == 0:
            tgt = sfile
        else:
            try:
                ext = sfile.externals[fid - 1].path
            except (IndexError, AttributeError):
                return None, None
            name = ext.replace('\\', '/').split('/')[-1]
            if 'unity default resources' in ext.lower() or 'unity_builtin' in ext.lower():
                return 'builtin', pid
            tgt = self.sfile(name)
            if tgt is None:
                return None, None
        o = tgt.objects.get(pid)
        return (tgt, o) if o is not None else (None, None)

    def tt(self, o):
        k = (id(o.assets_file), o.path_id)
        if k not in self._tt:
            self._tt[k] = o.read_typetree()
        return self._tt[k]

    def script(self, o):
        """(namespace, class) of a MonoBehaviour."""
        k = (id(o.assets_file), o.path_id)
        if k not in self._script:
            try:
                d = self.tt(o)
                f, ms = self.resolve(o.assets_file, d.get('m_Script'))
                st = self.tt(ms) if ms is not None and f != 'builtin' else {}
                self._script[k] = (st.get('m_Namespace', ''), st.get('m_ClassName', '?'))
            except Exception:
                self._script[k] = ('', '?')
        return self._script[k]

    def prefabs(self, rel, full=False):
        """prefab name (or full container path with `full`) → GameObject reader, for the containers of bundle `rel`
        only (loading it when needed)."""
        out = {}
        for sf in self.load_rel(rel):
            cont = getattr(sf, 'container', None) or {}
            for path, obj in cont.items():
                if not path.endswith('.prefab'):
                    continue
                try:
                    o = obj.deref() if hasattr(obj, 'deref') else obj
                except Exception:
                    continue
                out.setdefault(path if full else path.split('/')[-1][:-len('.prefab')], o)
        return out


def go_children(env, go):
    """Child GameObjects of a GameObject (through its Transform)."""
    d = env.tt(go)
    for c in d.get('m_Component', []):
        f, o = env.resolve(go.assets_file, c.get('component'))
        if o is None or f == 'builtin' or o.type.name not in ('Transform', 'RectTransform'):
            continue
        kids = []
        for ch in env.tt(o).get('m_Children', []):
            tf, to = env.resolve(o.assets_file, ch)
            if to is None or tf == 'builtin':
                continue
            gf, g = env.resolve(to.assets_file, env.tt(to).get('m_GameObject'))
            if g is not None and gf != 'builtin':
                kids.append(g)
        return kids
    return []


def go_transform(env, go):
    d = env.tt(go)
    for c in d.get('m_Component', []):
        f, o = env.resolve(go.assets_file, c.get('component'))
        if o is not None and f != 'builtin' and o.type.name in ('Transform', 'RectTransform'):
            t = env.tt(o)
            p, q, s = t['m_LocalPosition'], t['m_LocalRotation'], t['m_LocalScale']
            return [p['x'], p['y'], p['z']], [q['x'], q['y'], q['z'], q['w']], [s['x'], s['y'], s['z']]
    return [0, 0, 0], [0, 0, 0, 1], [1, 1, 1]


def all_strings(v, out, quoted=re.compile(r'"([^"\\]{2,160})"')):
    """Every string of a typetree, and every quoted token inside long / serialized (Odin JSON) strings."""
    if isinstance(v, dict):
        for x in v.values():
            all_strings(x, out)
    elif isinstance(v, (list, tuple)):
        for x in v:
            all_strings(x, out)
    elif isinstance(v, str) and v:
        if len(v) < 200 and '"' not in v:
            out.add(v)
        else:
            out.update(quoted.findall(v))
    return out


# ---- the effect descriptor ------------------------------------------------------------------------------------------

EFFECT_KEYS = frozenset()   # every effect prefab key of the client (set in each worker: the behaviours' references)


def _init_worker(keys):
    global EFFECT_KEYS
    EFFECT_KEYS = frozenset(keys)


def string_values(v, out):
    """Every string inside an encoded value."""
    if isinstance(v, str):
        out.add(v)
    elif isinstance(v, dict):
        for x in v.values():
            string_values(x, out)
    elif isinstance(v, list):
        for x in v:
            string_values(x, out)
    return out


class Exporter:
    """Writes the descriptors, textures and meshes of the effect prefabs of one AssetEnv into <out>/fx."""

    def __init__(self, env, out_root, log=print):
        self.env = env
        self.out = Path(out_root) / FX_SUB
        self.log = log
        self.textures = {}      # key → meta
        self.meshes = {}        # key → meta
        self._tex_keys = {}     # (file id, path id) → key
        self._mesh_keys = {}
        self._shader = {}

    # -- textures / meshes --------------------------------------------------------------------------------------------
    def texture(self, f, o):
        k = (id(f), o.path_id)
        if k in self._tex_keys:
            return self._tex_keys[k]
        key = None
        try:
            key = self._export_texture(o)
        except Exception as e:
            self.log(f'  warn texture #{o.path_id}: {e}')
        self._tex_keys[k] = key
        return key

    def _export_texture(self, o):
        from PIL import Image
        t = o.read()
        d = self.env.tt(o)
        img = t.image
        if img is None:
            return None
        h = hashlib.sha1(f'{img.mode}:{img.size}'.encode())
        h.update(img.tobytes())                               # the pixels: identical copies in other bundles share a key
        key = f'{FX_SAFE.sub("_", t.m_Name or "tex").strip("._") or "tex"}-{h.hexdigest()[:8]}'
        if key in self.textures:
            return key
        has_alpha = 'A' in img.getbands() and img.getchannel('A').getextrema()[0] < 255
        img = img.convert('RGBA') if has_alpha else img.convert('RGB')
        tex_dir = self.out / 'tex'
        full = tex_dir / f'{key}.webp'
        half = tex_dir / 'half' / f'{key}.webp'
        meta = {'name': t.m_Name, 'w': t.m_Width, 'h': t.m_Height, 'format': TEXTURE_FORMATS.get(d.get('m_TextureFormat'), str(d.get('m_TextureFormat'))),
                'mips': d.get('m_MipCount', 1), 'srgb': d.get('m_ColorSpace', 1) == 1, 'alpha': has_alpha,
                'file': f'tex/{key}.webp', 'half': None}
        ts = d.get('m_TextureSettings', {})
        meta.update({'wrapU': ['repeat', 'clamp', 'mirror', 'mirrorOnce'][min(3, ts.get('m_WrapU', 0))],
                     'wrapV': ['repeat', 'clamp', 'mirror', 'mirrorOnce'][min(3, ts.get('m_WrapV', 0))],
                     'filter': ['point', 'bilinear', 'trilinear'][min(2, ts.get('m_FilterMode', 1))], 'aniso': ts.get('m_Aniso', 0)})
        save_webp(img, full)
        if t.m_Width >= HALF_MIN and t.m_Height >= HALF_MIN:
            size = (max(1, t.m_Width // 2), max(1, t.m_Height // 2))
            small = img.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA') if has_alpha else img.resize(size, Image.LANCZOS)
            save_webp(small, half)
            meta['half'] = f'tex/half/{key}.webp'
        self.textures[key] = meta
        return key

    def mesh(self, f, o):
        if f == 'builtin':
            return f'builtin:{BUILTIN_MESHES.get(o, o)}'
        k = (id(f), o.path_id)
        if k in self._mesh_keys:
            return self._mesh_keys[k]
        key = None
        try:
            key = self._export_mesh(o)
        except Exception as e:
            self.log(f'  warn mesh #{o.path_id}: {e}')
        self._mesh_keys[k] = key
        return key

    def _export_mesh(self, o):
        from UnityPy.helpers.MeshHelper import MeshHandler
        m = o.read()
        h = MeshHandler(m)
        h.process()
        flat = lambda rows, n: [f6(x) for r in (rows or []) for x in list(r)[:n]]  # noqa: E731
        doc = {'format': 'fx-mesh', 'version': MESH_VERSION, 'name': m.m_Name, 'vertexCount': h.m_VertexCount,
               'positions': flat(h.m_Vertices, 3)}
        if h.m_Normals:
            doc['normals'] = flat(h.m_Normals, 3)
        if h.m_UV0:
            doc['uv0'] = flat(h.m_UV0, 2)
        if h.m_UV1:
            doc['uv1'] = flat(h.m_UV1, 2)
        if h.m_Colors:
            doc['colors'] = [f6(x) for x in norm_channel(flat(h.m_Colors, 4), color_format(m, h))]
        doc['submeshes'] = [[i for tri in sub for i in tri] for sub in h.get_triangles()]
        bone_i, bone_w = skin_rows(h.m_BoneIndices, h.m_BoneWeights, h.m_VertexCount)
        if bone_i:                                            # four influences per vertex (skin_rows; §33.9)
            doc['boneWeights'] = bone_w
            doc['boneIndices'] = bone_i
            doc['bindPoses'] = [[f6(bp.get(f'e{r}{c}', 0)) for r in range(4) for c in range(4)] for bp in (self.env.tt(o).get('m_BindPose') or [])]
        body = json.dumps(doc, separators=(',', ':'))
        key = f'{FX_SAFE.sub("_", m.m_Name or "mesh").strip("._") or "mesh"}-{hashlib.sha1(body.encode()).hexdigest()[:8]}'
        if key not in self.meshes:
            path = self.out / 'mesh' / f'{key}.json'
            write_atomic(path, body.encode('utf-8'))
            self.meshes[key] = {'name': m.m_Name, 'verts': h.m_VertexCount, 'file': f'mesh/{key}.json'}
        return key

    # -- shaders / materials ------------------------------------------------------------------------------------------
    def shader_info(self, f, o):
        """Name, declared properties (type, default), first-subshader pass states and queue tag of a shader."""
        k = (id(f), o.path_id)
        if k not in self._shader:
            info = {'name': None, 'props': None, 'passes': [], 'queue': None}
            try:
                d = self.env.tt(o)
                pf = d.get('m_ParsedForm', {})
                info['name'] = pf.get('m_Name')
                info['props'] = {p.get('m_Name'): {'type': p.get('m_Type'), 'default': [p.get(f'm_DefValue[{i}]', 0) for i in range(4)],
                                                   'texture': (p.get('m_DefTexture') or {}).get('m_DefaultName')}
                                 for p in pf.get('m_PropInfo', {}).get('m_Props', [])}
                subs = pf.get('m_SubShaders', [])
                if subs:
                    info['passes'] = [p.get('m_State', {}) for p in subs[0].get('m_Passes', [])]
                    tags = dict(subs[0].get('m_Tags', {}).get('tags', []))
                    info['queue'] = tags.get('QUEUE') or tags.get('Queue')
            except Exception as e:
                self.log(f'  warn shader #{o.path_id}: {e}')
            self._shader[k] = info
        return self._shader[k]

    def material(self, f, o):
        """A material entry: shader name, resolved pass states, queue, keywords and the shader's declared properties —
        the material's values, the shader defaults for those it does not store (`defaults` lists their names)."""
        d = self.env.tt(o)
        sp = d.get('m_SavedProperties', {})
        floats = {k: v for k, v in sp.get('m_Floats', [])}
        ints = {k: v for k, v in sp.get('m_Ints', [])} if sp.get('m_Ints') else {}
        floats.update({k: v for k, v in ints.items() if k not in floats})
        cols = {k: c for k, c in sp.get('m_Colors', [])}
        sf, so = self.env.resolve(o.assets_file, d.get('m_Shader'))
        sh = self.shader_info(sf, so) if so is not None and sf != 'builtin' else {'name': None, 'props': None, 'passes': [], 'queue': None}
        props = sh['props']
        defaults = {n: p['default'][0] for n, p in (props or {}).items() if p['type'] in (2, 3, 5)}
        out_f, out_c, tex, filled = {}, {}, {}, []
        texenv = {k: te for k, te in sp.get('m_TexEnvs', [])}
        names = list(props) if props is not None else list(floats) + list(cols) + list(texenv)
        for name in names:
            ptype = props[name]['type'] if props is not None else (2 if name in floats else 0 if name in cols else 4)
            if ptype in (2, 3, 5):
                if name in floats:
                    out_f[name] = f6(floats[name])
                elif props is not None:
                    out_f[name] = f6(props[name]['default'][0])
                    filled.append(name)
            elif ptype in (0, 1):
                if name in cols:
                    out_c[name] = enc_color(cols[name])
                elif props is not None:
                    out_c[name] = [f6(x) for x in props[name]['default']]
                    filled.append(name)
            elif ptype == 4:
                te = texenv.get(name)
                if te is None:
                    tex[name] = {'tex': None, 'default': props[name]['texture'] if props is not None else None, 'st': [1, 1, 0, 0]}
                    filled.append(name)
                    continue
                tf, to = self.env.resolve(o.assets_file, te.get('m_Texture'))
                key = None
                if tf == 'builtin':
                    key = f'builtin:{to}'
                elif to is not None and to.type.name == 'Texture2D':
                    key = self.texture(tf, to)
                s, off = te.get('m_Scale', {}), te.get('m_Offset', {})
                tex[name] = {'tex': key, 'st': [f6(s.get('x', 1)), f6(s.get('y', 1)), f6(off.get('x', 0)), f6(off.get('y', 0))]}
                if key is None:
                    tex[name]['default'] = props[name]['texture'] if props is not None else None
        kw = d.get('m_ValidKeywords') or d.get('m_ShaderKeywords') or []
        if isinstance(kw, str):
            kw = kw.split()
        queue = d.get('m_CustomRenderQueue', -1)
        m = {
            'name': d.get('m_Name'), 'shader': sh['name'],
            'passes': [render_state(p, floats, defaults) for p in sh['passes']],
            'queue': queue if queue is not None and queue >= 0 else sh['queue'],
            'keywords': sorted(kw), 'floats': out_f, 'colors': out_c, 'textures': tex,
        }
        if filled:
            m['defaults'] = sorted(filled)
        return m

    # -- one prefab ---------------------------------------------------------------------------------------------------
    def prefab(self, key, root, bundle):
        """Write prefabs/<file>.json for the GameObject tree under `root`; returns the index entry."""
        env = self.env
        nodes, ids, comps = [], {}, {}
        order = [(root, None)]
        while order:                                          # depth first, children in Transform order
            go, parent = order.pop(0)
            nid = len(nodes)
            ids[(id(go.assets_file), go.path_id)] = nid
            gd = env.tt(go)
            nodes.append({'id': nid, 'name': gd.get('m_Name', ''), 'parent': parent, 'children': [],
                          'active': bool(gd.get('m_IsActive', 1)), '_go': go})
            if parent is not None:
                nodes[parent]['children'].append(nid)
            order[0:0] = [(k, nid) for k in go_children(env, go)]
            for c in gd.get('m_Component', []):
                cf, co = env.resolve(go.assets_file, c.get('component'))
                if co is not None and cf != 'builtin':
                    comps[(id(co.assets_file), co.path_id)] = (nid, co.type.name, co)
        ctx = PrefabCtx(self, nodes, ids, comps)
        stats = {'nodes': len(nodes), 'particleSystems': 0, 'liveParticles': 0, 'duration': 0.0, 'looping': False}
        for n in nodes:
            ctx.node(n, n.pop('_go'), stats)
        ctx.finish()
        stats['liveParticles'] = round(stats['liveParticles'])
        stats['duration'] = None if stats['looping'] else f6(stats['duration'])
        refs = set()
        for n in nodes:
            for b in n.get('behaviours', []):
                refs |= {x.lower() for x in string_values(b['fields'], set()) if x.lower() in EFFECT_KEYS and x.lower() != key}
        doc = {'format': 'fx-prefab', 'version': FORMAT_VERSION, 'key': key, 'bundle': bundle, 'root': 0,
               'nodes': nodes, 'materials': ctx.materials, 'clips': ctx.clips, 'textures': sorted(ctx.tex_used),
               'meshes': sorted(ctx.mesh_used), 'refs': sorted(refs), 'stats': stats}
        body = json.dumps(doc, ensure_ascii=False, separators=(',', ':'))
        write_atomic(self.out / 'prefabs' / f'{fx_file(key)}.json', body.encode('utf-8'))
        spawn, follow = prefab_anchor(nodes)
        return {'file': f'prefabs/{fx_file(key)}.json', 'bundle': bundle, 'bytes': len(body),
                'textures': sorted(ctx.tex_used), 'meshes': sorted(ctx.mesh_used), 'refs': sorted(refs), **stats,
                **({'spawn': spawn} if spawn is not None else {}), **({'follow': follow} if follow is not None else {})}


class PrefabCtx:
    """Per-prefab state: node / component ids, the material and clip tables, PPtr encoding."""

    def __init__(self, ex, nodes, ids, comps):
        self.ex, self.env, self.nodes, self.ids, self.comps = ex, ex.env, nodes, ids, comps
        self.materials, self._mat = [], {}
        self.clips, self._clip, self._pending = [], {}, []
        self.tex_used, self.mesh_used = set(), set()
        self._names = {}

    def pptr(self, sfile):
        """PPtr encoder for typetrees read from `sfile`: a node of this prefab ({node[, component]}), a material /
        mesh / texture / clip of the descriptor, a built-in asset, else {asset, name}; null when null or unresolvable."""
        def enc(p):
            f, o = self.env.resolve(sfile, p)
            if o is None:
                return None
            if f == 'builtin':
                return {'builtin': BUILTIN_MESHES.get(o, o)}
            k = (id(o.assets_file), o.path_id)
            t = o.type.name
            if t == 'GameObject' and k in self.ids:
                return {'node': self.ids[k]}
            if k in self.comps:
                nid, ct, _ = self.comps[k]
                return {'node': nid, 'component': ct}
            if t == 'Material':
                return {'material': self.material(f, o)}
            if t == 'Mesh':
                return {'mesh': self.mesh(f, o)}
            if t == 'Texture2D':
                key = self.ex.texture(f, o)
                if key:
                    self.tex_used.add(key)
                return {'texture': key}
            if t == 'AnimationClip':
                return {'clip': self.clip(f, o, None)}
            if t in ('MonoScript', 'Shader'):
                return None
            try:
                name = self.env.tt(o).get('m_Name')
            except Exception:
                name = None
            return {'asset': t, 'name': name}
        return enc

    def material(self, f, o):
        k = (id(o.assets_file), o.path_id)
        if k not in self._mat:
            m = self.ex.material(f, o)
            for t in m['textures'].values():
                if t['tex'] and not t['tex'].startswith('builtin:'):
                    self.tex_used.add(t['tex'])
            self._mat[k] = len(self.materials)
            self.materials.append(m)
        return self._mat[k]

    def mesh(self, f, o):
        key = self.ex.mesh(f, o)
        if key and not key.startswith('builtin:'):
            self.mesh_used.add(key)
        return key

    def materials_of(self, sfile, d):
        out = []
        for m in d.get('m_Materials', []):
            f, o = self.env.resolve(sfile, m)
            out.append(self.material(f, o) if o is not None and f != 'builtin' else None)
        return out

    def node(self, n, go, stats):
        env = self.env
        gd = env.tt(go)
        for c in gd.get('m_Component', []):
            f, o = env.resolve(go.assets_file, c.get('component'))
            if o is None or f == 'builtin':
                continue
            t = o.type.name
            try:
                d = env.tt(o)
            except Exception:
                n.setdefault('ignored', []).append(t)
                continue
            pp = self.pptr(o.assets_file)
            enc = lambda v: enc_value(v, pp)  # noqa: E731
            if t in ('Transform', 'RectTransform'):
                p, q, s = d['m_LocalPosition'], d['m_LocalRotation'], d['m_LocalScale']
                n['pos'] = [f6(p['x']), f6(p['y']), f6(p['z'])]
                n['rot'] = [f6(q['x']), f6(q['y']), f6(q['z']), f6(q['w'])]
                n['scale'] = [f6(s['x']), f6(s['y']), f6(s['z'])]
            elif t == 'ParticleSystem':
                ps = {k: enc(d[k]) for k in PS_TOP if k in d}
                for m in PS_MODULES:
                    md = d.get(m)
                    if isinstance(md, dict) and (md.get('enabled') or m == 'InitialModule'):
                        ps[m] = enc({k: v for k, v in md.items() if k != 'enabled'})
                if 'ShapeModule' in ps:
                    ps['ShapeModule']['typeName'] = enum_name(SHAPE_TYPES, ps['ShapeModule'].get('type'))
                n['particleSystem'] = ps
                stats['particleSystems'] += 1
                if n['active']:
                    stats['liveParticles'] += est_live(ps)
                if ps.get('looping'):
                    stats['looping'] = True
                im = ps.get('InitialModule', {})
                life = im.get('startLifetime', 0)
                life = life if isinstance(life, (int, float)) else (life.get('max') if isinstance(life, dict) and 'max' in life
                                                                    else abs((life or {}).get('scalar') or 1))
                delay = ps.get('startDelay', 0)
                delay = delay if isinstance(delay, (int, float)) else ((delay or {}).get('max') or 0)
                stats['duration'] = max(stats['duration'], (delay or 0) + (ps.get('lengthInSec') or 0) + (life or 0))
            elif t == 'ParticleSystemRenderer':
                r = {k: enc(d[k]) for k in RENDERER_COMMON + PSR_FIELDS if k in d}
                r['renderMode'] = enum_name(RENDER_MODES, d.get('m_RenderMode'))
                r['renderAlignment'] = enum_name(RENDER_ALIGN, d.get('m_RenderAlignment'))
                r['vertexStreams'] = [enum_name(VERTEX_STREAMS, v) for v in d.get('m_VertexStreams', [])]
                r['materials'] = self.materials_of(o.assets_file, d)
                n['particleSystemRenderer'] = r
            elif t in ('MeshRenderer', 'TrailRenderer', 'LineRenderer', 'SkinnedMeshRenderer', 'SpriteRenderer'):
                fields = {'TrailRenderer': TRAIL_FIELDS, 'LineRenderer': LINE_FIELDS, 'SkinnedMeshRenderer': SKIN_FIELDS}.get(t, ())
                r = {k: enc(d[k]) for k in RENDERER_COMMON + fields if k in d}
                r['materials'] = self.materials_of(o.assets_file, d)
                n[t[0].lower() + t[1:]] = r
            elif t == 'MeshFilter':
                mf, mo = env.resolve(o.assets_file, d.get('m_Mesh'))
                n['meshFilter'] = self.mesh(mf, mo) if mo is not None else None
            elif t == 'Animator':
                cf, co = env.resolve(o.assets_file, d.get('m_Controller'))
                clips, cname = [], None
                if co is not None and cf != 'builtin':
                    cd = env.tt(co)
                    cname = cd.get('m_Name')
                    for cp in cd.get('m_AnimationClips', []):
                        kf, ko = env.resolve(co.assets_file, cp)
                        if ko is not None and kf != 'builtin':
                            clips.append(self.clip(kf, ko, n['id']))
                n['animator'] = {'controller': cname, 'clips': clips, 'default': clips[0] if clips else None,
                                 'enabled': bool(d.get('m_Enabled', 1)), 'cullingMode': d.get('m_CullingMode'),
                                 'updateMode': d.get('m_UpdateMode')}
            elif t == 'Animation':
                clips = []
                for cp in d.get('m_Animations', []):
                    kf, ko = env.resolve(o.assets_file, cp)
                    if ko is not None and kf != 'builtin':
                        clips.append(self.clip(kf, ko, n['id']))
                df, do = env.resolve(o.assets_file, d.get('m_Animation'))
                default = self.clip(df, do, n['id']) if do is not None and df != 'builtin' else (clips[0] if clips else None)
                n['animation'] = {'clips': clips, 'default': default, 'playAutomatically': bool(d.get('m_PlayAutomatically', 1)),
                                  'wrapMode': d.get('m_WrapMode', 0), 'enabled': bool(d.get('m_Enabled', 1))}
            elif t == 'MonoBehaviour':
                ns, cls = env.script(o)
                fields = {k: enc(v) for k, v in d.items() if k not in SKIP_FIELDS}
                n.setdefault('behaviours', []).append({'class': cls, 'namespace': ns, 'enabled': bool(d.get('m_Enabled', 1)),
                                                       'fields': fields})
            elif t == 'GameObject':
                continue
            else:
                n.setdefault('ignored', []).append(t)

    # -- clips --------------------------------------------------------------------------------------------------------
    def clip(self, f, o, owner):
        """Index of the clip in this descriptor (decoded in finish(), once every node and material is known); its
        curve paths resolve against node `owner`, the GameObject of the Animator / Animation that plays it."""
        k = (id(o.assets_file), o.path_id, owner)
        if k not in self._clip:
            self._clip[k] = len(self.clips)
            self.clips.append(None)
            self._pending.append((self._clip[k], o, owner))
        return self._clip[k]

    def finish(self):
        for i, o, owner in self._pending:
            try:
                self.clips[i] = self.decode_clip(o, owner)
            except Exception as e:
                self.ex.log(f'  warn clip #{o.path_id}: {e!r}')
                self.clips[i] = {'name': None, 'error': str(e)[:200], 'curves': []}
        self._pending = []

    def _paths(self, owner):
        """Relative path (from node `owner`) → node id, for every node under it ('' = the owner itself)."""
        out = {}
        if owner is None:
            return out
        def walk(nid, path):
            out[path] = nid
            for ch in self.nodes[nid]['children']:
                walk(ch, f'{path}/{self.nodes[ch]["name"]}' if path else self.nodes[ch]['name'])
        walk(owner, '')
        return out

    def _component(self, nid, type_name):
        for n, t, o in self.comps.values():
            if n == nid and t == type_name:
                return o
        return None

    def _generic_names(self, nid, type_id):
        """(CRC32 → dotted field path, CRC32 & 0x0FFFFFFF → path) of the component a generic binding targets."""
        t = CLASS_IDS.get(type_id)
        o = self._component(nid, t) if nid is not None and t else None
        if o is None:
            return {}, {}
        k = (nid, t)
        if k not in self._names:
            paths = typetree_paths(self.env.tt(o))
            exact = {zlib.crc32(p.encode()): p for p in paths}
            self._names[k] = (exact, {c & 0x0FFFFFFF: p for c, p in exact.items()})
        return self._names[k]

    def _material_names(self, nid):
        """CRC32 & 0x0FFFFFFF → property name, for the materials of the renderers on node `nid` (plus common ones)."""
        names = {'_TintColor', '_MainColor', '_Color', '_MainTex_ST', '_Amount', '_DissolveTex_ST', '_DisturTex_ST',
                 '_DisturbTex_ST', '_Opacity', '_BorderWidth', '_IntensityU', '_IntensityV', '_Amount_01', '_Amount_02'}
        node = self.nodes[nid] if nid is not None else {}
        for key in ('meshRenderer', 'particleSystemRenderer', 'trailRenderer', 'lineRenderer', 'skinnedMeshRenderer'):
            for mi in (node.get(key) or {}).get('materials', []) or []:
                if mi is not None:
                    m = self.materials[mi]
                    names.update(m['floats'])
                    names.update(m['colors'])
                    names.update(f'{t}_ST' for t in m['textures'])
        return {zlib.crc32(n.encode()) & 0x0FFFFFFF: n for n in names}

    def decode_clip(self, o, owner):
        d = self.env.tt(o)
        paths = self._paths(owner)
        by_hash = {zlib.crc32(p.encode()): (p, n) for p, n in paths.items()}
        clip = {'name': d.get('m_Name'), 'legacy': bool(d.get('m_Legacy')), 'sampleRate': f6(d.get('m_SampleRate', 30)),
                'wrapMode': d.get('m_WrapMode', 0),
                'events': [{'time': f6(e.get('time')), 'function': e.get('functionName'), 'data': e.get('data'),
                            'float': f6(e.get('floatParameter')), 'int': e.get('intParameter')} for e in d.get('m_Events', [])],
                'curves': []}
        if d.get('m_Legacy'):
            self._legacy_curves(d, paths, clip)
            ends = [c['keys'][-1][0] for c in clip['curves'] if c['keys']] or [0]
            clip['length'] = f6(max(ends))
            clip['start'] = 0
            clip['loop'] = d.get('m_WrapMode', 0) == 2
            return clip
        mc = d.get('m_MuscleClip', {})
        clip['length'] = f6(mc.get('m_StopTime', 0) - mc.get('m_StartTime', 0))
        clip['start'] = f6(mc.get('m_StartTime', 0))
        clip['loop'] = bool(mc.get('m_LoopTime'))
        data = mc.get('m_Clip', {}).get('data', {})
        streamed = data.get('m_StreamedClip', {})
        dense = data.get('m_DenseClip', {})
        const = data.get('m_ConstantClip', {}).get('data', []) or []
        n_s = streamed.get('curveCount', 0)
        n_d = dense.get('m_CurveCount', 0)
        curves = streamed_curves(decode_streamed(streamed.get('data', []) or []))
        curves.update(dense_curves(dense, n_s))
        for i, v in enumerate(const):
            curves[n_s + n_d + i] = [[clip['start'], f6(v), 0, 0]]
        idx = 0
        for b in d.get('m_ClipBindingConstant', {}).get('genericBindings', []):
            dims = binding_dims(b)
            path, nid = by_hash.get(b.get('path'), (None, None))
            base = {'node': nid, 'path': path, 'type': CLASS_IDS.get(b.get('typeID'), str(b.get('typeID')))}
            if path is None:
                base['pathHash'] = b.get('path')
            if b.get('typeID') == 4 and b.get('attribute') in TRANSFORM_PROPS:
                prop, comps = TRANSFORM_PROPS[b['attribute']]
                for j, comp in enumerate(comps):
                    clip['curves'].append({**base, 'property': f'{prop}.{comp}', 'keys': curves.get(idx + j, [])})
            else:
                attr = b.get('attribute', 0)
                if b.get('typeID') == 1:
                    prop = 'm_IsActive' if attr == zlib.crc32(b'm_IsActive') else f'crc:{attr}'
                elif b.get('customType') == 22:
                    h, comp = material_attribute(attr)
                    name = self._material_names(nid).get(h)
                    prop = f'material.{name or f"crc:{h}"}' + (f'.{comp}' if comp else '')
                else:
                    exact, masked = self._generic_names(nid, b.get('typeID'))
                    prop = exact.get(attr) or masked.get(attr & 0x0FFFFFFF) or f'crc:{attr}'
                cur = {**base, 'property': prop, 'keys': curves.get(idx, [])}
                if b.get('customType'):
                    cur['customType'] = b.get('customType')
                if b.get('isPPtrCurve'):
                    cur['pptr'] = True
                clip['curves'].append(cur)
            idx += dims
        return clip

    def _legacy_curves(self, d, paths, clip):
        def vec_curves(key, prop, comps):
            for c in d.get(key, []) or []:
                path = c.get('path', '')
                for comp in comps:
                    rows = []
                    for kf in c.get('curve', {}).get('m_Curve', []):
                        val, ins, outs = kf.get('value', {}), kf.get('inSlope', {}), kf.get('outSlope', {})
                        rows.append([f6(kf.get('time', 0)), f6(val.get(comp, 0)), f6(ins.get(comp, 0)), f6(outs.get(comp, 0))])
                    clip['curves'].append({'node': paths.get(path), 'path': path, 'type': 'Transform',
                                           'property': f'{prop}.{comp}', 'keys': rows})
        vec_curves('m_PositionCurves', 'localPosition', 'xyz')
        vec_curves('m_RotationCurves', 'localRotation', 'xyzw')
        vec_curves('m_EulerCurves', 'localEulerAnglesRaw', 'xyz')
        vec_curves('m_ScaleCurves', 'localScale', 'xyz')
        for c in d.get('m_FloatCurves', []) or []:
            path = c.get('path', '')
            clip['curves'].append({'node': paths.get(path), 'path': path,
                                   'type': CLASS_IDS.get(c.get('classID'), str(c.get('classID'))),
                                   'property': c.get('attribute'), 'keys': enc_keys(c.get('curve'))})


def save_webp(img, path):
    import io
    buf = io.BytesIO()
    img.save(buf, 'WEBP', quality=WEBP_QUALITY, method=WEBP_METHOD)
    write_atomic(path, buf.getvalue())


def write_atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    tmp.write_bytes(data)
    os.replace(tmp, path)


# ---- container indexes ----------------------------------------------------------------------------------------------

def _containers(args):
    """(rel, size, mtime, [prefab names]) of one bundle (pool worker)."""
    ab_root, rel = args
    import aklz4  # noqa: F401
    import UnityPy
    p = Path(ab_root) / rel
    st = p.stat()
    try:
        env = UnityPy.load(str(p))
        names = sorted({k.split('/')[-1][:-len('.prefab')] for k in env.container.keys() if k.endswith('.prefab')})
    except Exception:
        names = []
    return rel, st.st_size, int(st.st_mtime), names


def container_index(ab_root, globs, cache_file, jobs, log):
    """prefab name → bundle rel path over every bundle matching `globs` (cached per bundle by size + mtime)."""
    try:
        cache = json.loads(Path(cache_file).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        cache = {}
    rels = sorted({p.relative_to(ab_root).as_posix() for g in globs for p in Path(ab_root).glob(g) if p.is_file()})
    todo = []
    for rel in rels:
        st = (Path(ab_root) / rel).stat()
        c = cache.get(rel)
        if not c or c.get('size') != st.st_size or c.get('mtime') != int(st.st_mtime):
            todo.append((str(ab_root), rel))
    if todo:
        t0 = time.time()
        if jobs > 1 and len(todo) > 4:
            with ProcessPoolExecutor(max_workers=jobs) as pool:
                results = list(pool.map(_containers, todo, chunksize=4))
        else:
            results = [_containers(a) for a in todo]
        for rel, size, mtime, names in results:
            cache[rel] = {'size': size, 'mtime': mtime, 'prefabs': names}
        log(f'  container index: {len(todo)} bundles read in {time.time() - t0:.1f}s')
        Path(cache_file).parent.mkdir(parents=True, exist_ok=True)
        Path(cache_file).write_text(json.dumps({r: cache[r] for r in rels if r in cache}), encoding='utf-8')
    out = {}
    for rel in rels:
        for n in cache.get(rel, {}).get('prefabs', []):
            out.setdefault(n, rel)
    return out


# ---- units: operators, enemies, tokens (index.json) -------------------------------------------------------------------

def emit_row(e):
    """One UberEffectEmitter option row → an Emit: its fields without the leading underscore and `effects`, the keys
    it plays: the first slot when directionType is 0 (NONE — the other slots are leftovers the game does not play), else
    every non-empty slot, and then also `slots`, the effect per facing (Torappu SharedConsts.Direction: 0 UP, 1 RIGHT,
    2 DOWN, 3 LEFT; null: none). None when the row plays nothing (no key, no hookEffectAfterFirstAttack)."""
    if not isinstance(e, dict):
        return None
    row = {k.lstrip('_'): v for k, v in e.items()}
    slots = [x if isinstance(x, str) and x else None for x in row.get('effects', []) or []]
    if row.get('directionType'):
        row['effects'] = list(dict.fromkeys(x for x in slots if x))
        while slots and slots[-1] is None:
            slots.pop()
        row['slots'] = slots
    else:
        row['effects'] = slots[:1] if slots and slots[0] else []
    return row if row['effects'] or row.get('hookEffectAfterFirstAttack') else None


def row_keys(row):
    """Every key an Emit row names: its effects, its slots and its hookEffectAfterFirstAttack."""
    return [k for k in list(row.get('effects') or []) + list(row.get('slots') or []) + [row.get('hookEffectAfterFirstAttack')]
            if isinstance(k, str) and k]


def emitter_lists(fields):
    """The effect lists of an UberEffectEmitter, keyed cast / hit / attach / inputTarget / castTarget (emit_row rows)."""
    out = {}
    for src, dst in EMIT_LISTS.items():
        rows = [r for r in (emit_row(e) for e in fields.get(src, []) or []) if r]
        if rows:
            out[dst] = rows
    return out


def is_row_list(v):
    """Whether a value is a list of emitter option rows (dicts with an `_effects` list)."""
    return isinstance(v, list) and bool(v) and all(isinstance(r, dict) and isinstance(r.get('_effects'), list) for r in v)


def list_kind(name):
    """The Emit list kind a row list of another name holds, by that name: hit / attach / inputTarget / castTarget, else
    cast (VigilWolfEffectEmitter._vigilWolfCastEffects → cast)."""
    n = name.lower()
    return 'hit' if 'hit' in n else 'attach' if 'attach' in n else 'inputTarget' if 'inputtarget' in n \
        else 'castTarget' if 'casttarget' in n else 'cast'


def emitter_export(cls, fields):
    """An effect emitter of one of a unit's abilities (any class: UberEffectEmitter, its subclasses, the custom
    emitters) → (rows, settings). rows = {kind: [Emit…]}: its row lists (EMIT_LISTS; another list of rows by its
    name, the row keeping `field`) and the rows of its group lists (EMIT_GROUPS) with `group`, the element's index,
    and a replace group's `anim`. settings = {class, …} for anything but a plain UberEffectEmitter (None for one): the
    fields the base class does not have, without the leading underscore (PPtrs dropped), `groups` {list: element count}
    (a group without rows still counts), `replaceAnims` (a replace group's animations in order) and the charge groups
    nested per energy, `chargeEffectGroups` … [[Emit…]…]."""
    rows, settings, groups = {}, {'class': cls}, {}

    def add(kind, r, **kw):
        row = emit_row(r)
        if row is not None:
            row.update({k: v for k, v in kw.items() if v is not None})
            rows.setdefault(kind, []).append(row)

    for f, v in fields.items():
        if f in SKIP_FIELDS:
            continue
        if f in EMIT_LISTS:
            for r in v or []:
                add(EMIT_LISTS[f], r)
        elif f in EMIT_GROUPS and isinstance(v, list):
            if v:
                groups[f.lstrip('_')] = len(v)
            if f == '_replaceGroup' and v:
                settings['replaceAnims'] = [g.get('anim') if isinstance(g, dict) else None for g in v]
            for gi, g in enumerate(v):
                if not isinstance(g, dict):
                    continue
                anim = g.get('anim') if isinstance(g.get('anim'), str) and g.get('anim') else None
                for inner, x in g.items():
                    for r in (x if isinstance(x, list) else []):
                        add(EMIT_GROUPS[f] or REPLACE_LISTS.get(inner) or list_kind(inner), r, group=gi, anim=anim)
        elif f in CHARGE_GROUP_LISTS and isinstance(v, list):
            nested = [[row for row in (emit_row(r) for r in (g.get('effects') or [])) if row]
                      for g in v if isinstance(g, dict)]
            if any(nested):
                settings[f.lstrip('_')] = nested
        elif is_row_list(v):
            for r in v:
                add(list_kind(f), r, field=f)
        elif f not in EMITTER_BASE_FIELDS and not is_pptr(v) and not (isinstance(v, list) and any(is_pptr(x) for x in v)):
            settings[f.lstrip('_')] = enc_value(v, lambda p: None)
    if groups:
        settings['groups'] = groups
    if isinstance(settings.get('loopType'), int) and not isinstance(settings['loopType'], bool) and '_replaceGroup' in fields:
        settings['loopTypeName'] = event_name(ANIM_LOOP_TYPES, settings['loopType']) or str(settings['loopType'])  # v3
    plain = cls == 'UberEffectEmitter' and len(settings) == 1
    return rows, (None if plain else settings)


def is_emitter(cls, fields):
    """Whether a behaviour is an effect emitter: an `…Emitter` class or one with UberEffectEmitter's row lists."""
    return cls.endswith('Emitter') or any(k in fields for k in EMIT_LISTS)


def is_ability(cls):
    """Whether a behaviour class is an ability (it casts: MeleeAttack, RangedHeal, ActiveBuffAbility, …), not a helper
    (emitters, selectors, triggers, counters, ranges, validators, …)."""
    return bool(ABILITY_CLASS.search(cls)) and not NOT_ABILITY_CLASS.search(cls)


def main_ability(classes):
    """The ability among the behaviour classes of one GameObject (the first is_ability one), else the first class that
    is no helper, else None — the ability its emitters serve."""
    cands = [c for c in classes if not NOT_ABILITY_CLASS.search(c)]
    return next((c for c in cands if ABILITY_CLASS.search(c)), cands[0] if cands else None)


def skill_root(behaviours):
    """(rootClass, rootAbility) of a skill's root GameObject from its behaviours [(class, fields)…]: the class deriving
    from Torappu.Battle.Skill (SKILL_BASE_FIELDS in its fields: CastSkill, PassiveSkill, AppearSkill, ReplacementSkill,
    …), else an enemy's EnemySkill, else None; the ability (main_ability) or None."""
    root = next((c for c, f in behaviours if all(k in f for k in SKILL_BASE_FIELDS)), None)
    root = root or next((c for c, f in behaviours if ENEMY_SKILL_CLASS.search(c)), None)
    ability = main_ability([c for c, f in behaviours if c != root])
    return root, ability if ability and is_ability(ability) else None


# Unity VertexFormat (2019+) of a normalized integer vertex channel → its divisor (UNorm8, SNorm8, UNorm16, SNorm16)
NORM_FORMATS = {2: 255.0, 3: 127.0, 4: 65535.0, 5: 32767.0}


def norm_channel(values, fmt):
    """A vertex channel's values as floats: a normalized integer format (NORM_FORMATS) divided to 0…1 (−1…1 for the
    signed ones, clamped), anything else (Float, Float16; None: unknown or already normalized) unchanged."""
    div = NORM_FORMATS.get(fmt)
    return list(values) if div is None else [max(-1.0, x / div) for x in values]


def skin_rows(indices, weights, count):
    """A skinned mesh's bone influences as §33.9 writes them: four (index, weight) pairs per vertex, flat —
    (boneIndices, boneWeights), or (None, None) without bone indices. UnityPy hands the vertex channels over as they
    are stored: a Unity 2019+ mesh keeps 1–4 influences per vertex (the BlendIndices / BlendWeight channels' dimension —
    2 for 铃兰 S3's fox tails, 琴柳's flags, 森蚺 S2) and drops the BlendWeight channel when every vertex follows a
    single bone (weight 1: 伊芙利特 S3's flame tongues, 凯尔希 S1, 8 of 铃兰's 9 tails); the legacy m_Skin and a
    compressed mesh give four. Missing pairs are (0, 0)."""
    if not indices:
        return None, None
    out_i, out_w = [], []
    for v in range(count):
        ri = [int(x) for x in list(indices[v])[:4]] if v < len(indices) else []
        if weights:
            rw = [f6(x) for x in list(weights[v])[:4]] if v < len(weights) else []
        else:
            rw = [1.0] if ri else []                          # one bone per vertex: no BlendWeight channel, weight 1
        rw = rw[:len(ri)]
        out_i += ri + [0] * (4 - len(ri))
        out_w += rw + [0.0] * (4 - len(rw))
    return out_i, out_w


def color_format(mesh, handler):
    """The VertexFormat of a mesh's colour channel (channel 3), which UnityPy reads raw from the vertex data, for a
    Unity 2019+ file (this client: 2021.3); None otherwise — a compressed mesh's colours arrive as 0…1 floats, an older
    file's channel formats are another enum (left as read)."""
    try:
        ch = mesh.m_VertexData.m_Channels[3]
        return ch.format if handler.version[0] >= 2019 and ch.dimension & 0xF else None
    except (AttributeError, IndexError, TypeError):
        return None


def mount_names(values):
    """MountPointType names (MOUNT_POINT_TYPES) of a list of values; None for an unknown one."""
    return [MOUNT_POINT_TYPES[v] if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < len(MOUNT_POINT_TYPES)
            else None for v in values or []]


def config_ability(v):
    """The ability PPtr of a group's field: the PPtr itself, or an ability config's `_ability` (a BurstAttackGroup's
    `_burstAttack` is a config like its `_abilityConfigs` entries)."""
    return v.get('_ability') if isinstance(v, dict) and '_ability' in v else v


def group_select(cls, d):
    """How a group ability picks the sub-abilities of a cast (v3; its class and fields — *metadata* names): {method:
    'random' / 'loop' (an AbilityRandomGroup's SelectMethod: a random one / each in turn), 'trigger' (an
    AbilitySelectableGroup's or BurstAttackGroup's configs: the first, in config order, whose own trigger finds its
    target), 'sequential' (the same with _selectAbilitySequentially: each in turn), 'firstSucceed' (the first whose cast
    succeeds), 'parallel' (all), 'sequence' (one after the other); probKeys? (the blackboard keys of the random weights,
    _isConfigurableProb), diffFromLast? / allAtLeastOnce? (random: never the same twice in a row / each once before
    repeating), loop? (a sequence that starts over)}; None for a class that is no group."""
    if '_selectMethod' in d and isinstance(d.get('_abilities'), list):
        out = {'method': (event_name(RANDOM_SELECT, d['_selectMethod']) or str(d['_selectMethod'])).lower()}
        if d.get('_isConfigurableProb') and d.get('_probKeyList'):
            out['probKeys'] = list(d['_probKeyList'])
        if d.get('_diffFromLastOneIfNotFirst'):
            out['diffFromLast'] = True
        if d.get('_selectAllAtLeastOnce'):
            out['allAtLeastOnce'] = True
        return out
    if isinstance(d.get('_abilityConfigs'), list):
        return {'method': 'sequential' if d.get('_selectAbilitySequentially') else 'trigger'}
    method = GROUP_SELECT.get(cls)
    if method is None:
        return None
    out = {'method': method}
    if method == 'sequence' and d.get('_enableLoop'):
        out['loop'] = True
    return out


def attack_extras(d):
    """The v3 fields of an ability beyond ABILITY_FIELDS: `mount` (the MountPointType name of `_mountPointType`: where
    its projectile leaves — MUZZLE for most), `mountGroup` ({loop: MOUNT_GROUP_LOOP name, mounts: [names]} when the
    shots take turns over several points: `_useMountGroup` / MultiRangedAttack's `_enableMountPointGroup`), and a multi
    attack's `additionalTimes` (the hits / shots after the first) and `triggerDelta` (s between them)."""
    out = {}
    if isinstance(d.get('_mountPointType'), int) and not isinstance(d['_mountPointType'], bool):
        out['mount'] = mount_names([d['_mountPointType']])[0]
    for use, key in (('_useMountGroup', '_mountGroup'), ('_enableMountPointGroup', '_mountPointGroup')):
        g = d.get(key)
        if d.get(use) and isinstance(g, dict) and g.get('mountPoints'):
            out['mountGroup'] = {'loop': event_name(MOUNT_GROUP_LOOP, g.get('loopType')) or str(g.get('loopType')),
                                 'mounts': mount_names(g.get('mountPoints'))}
    for k in ('_additionalTimes', '_triggerDelta'):
        if isinstance(d.get(k), (int, float)) and not isinstance(d[k], bool):
            out[k.lstrip('_')] = f6(d[k])
    if isinstance(d.get('_additionalProjectile'), str) and d['_additionalProjectile']:   # the shots after the first
        out['additionalProjectile'] = d['_additionalProjectile']
    if d.get('_useMultiAdditionalProjectiles') and isinstance(d.get('_additionalProjectiles'), list):
        ks = [x for x in d['_additionalProjectiles'] if isinstance(x, str) and x]
        if ks:
            out['additionalProjectiles'] = ks
    return out


def talent_when(talent_cls, ability_cls, classes):
    """When a talent node's abilities act (v3; from its classes — *metadata* names): 'deploy' (AppearTalent,
    AppearSyncedTalent: cast as the unit appears), 'reborn' (RebornTalent and its kin: its 重生), 'attack'
    (ProbReplaceNextAtkTalent / ProbAdditionNextAtkTalent: on an attack, with a blackboard probability), 'toggle' (a
    ToggleablePassive* ability with a toggle checker — HpRatioToggleChecker, BlockedToggleChecker, …: on while its
    condition holds), 'passive' (a passive / aura ability: for as long as the talent holds, i.e. from the deploy), else
    None (cast by something else: a buff template's action — the entry's `triggers` —, a reborn talent's handler)."""
    for when, rx in TALENT_WHEN:
        if talent_cls and rx.search(talent_cls):
            return when
    return ability_when(ability_cls, classes)


def ability_when(ability_cls, classes):
    """'toggle' / 'passive' for an ability attached for as long as its holder holds it (talent_when), else None."""
    if ability_cls and PASSIVE_ABILITY.search(ability_cls):
        return 'toggle' if any(TOGGLE_CHECKER.search(c) for c in classes) else 'passive'
    return None


def prefab_anchor(nodes):
    """(spawn, follow) of an exported descriptor's nodes: the first enabled ParticleEffect / EmptyEffect's
    `_spawnLocation` (SpawnLocation, §33.11) and the first enabled FollowMountPoint's `_mountPointType` (MountPointType),
    None when absent."""
    spawn = follow = None
    for n in nodes:
        for b in n.get('behaviours') or []:
            if not b.get('enabled', True):
                continue
            f = b.get('fields') or {}
            if spawn is None and b.get('class') in ('ParticleEffect', 'EmptyEffect') and isinstance(f.get('_spawnLocation'), int):
                spawn = f['_spawnLocation']
            elif follow is None and b.get('class') == 'FollowMountPoint' and isinstance(f.get('_mountPointType'), int):
                follow = f['_mountPointType']
    return spawn, follow


def token_skill_ids(record, out=None, depth=0):
    """Every skill id of a token record (data/tokens.json, data/backups.json tokens): the `skillId` / `prefabId` of
    each object under a `skill` key — its own, per variant, per owner skill or module (as tools/vfx-skill-coverage.mjs
    counts them) — in first-seen order."""
    out = [] if out is None else out
    if depth > 5:
        return out
    items = record.items() if isinstance(record, dict) else enumerate(record) if isinstance(record, list) else []
    for k, v in items:
        if k == 'skill' and isinstance(v, dict) and isinstance(v.get('skillId'), str):
            sid = v.get('prefabId') or v['skillId']
            if sid not in out:
                out.append(sid)
        elif isinstance(v, (dict, list)):
            token_skill_ids(v, out, depth + 1)
    return out


def event_name(table, v):
    """An enum value's name from `table` (ABILITY_EVENTS, BUFF_EVENTS, …); None for a missing or unknown value."""
    return table[v] if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < len(table) else None


def emit_role(kind, row, key):
    """The role (SKILL_ROLES) of an effect of an UberEffectEmitter-like row of list kind `kind` (EMIT_LISTS values):
    hit / castTarget / inputTarget rows play on targets, attach rows while the ability is attached; a cast row loops
    from its start to its end event unless one-shot; by name a cast row is the skill's range or end."""
    if kind in ('hit', 'castTarget', 'inputTarget'):
        return 'hit'
    if kind == 'attach':
        return 'loop'
    if SKILL_RANGE.search(key):
        return 'range'
    if not row.get('_oneshot', 1):
        return 'loop'
    if row.get('_startEvent') in (1, 3, 5, 6) or SKILL_END.search(key):   # ON_DETACHED, ON_CAST_END, ON_SPELL_END, …
        return 'end'
    return 'start'


def name_role(key, event=None):
    """The role of an effect whose field says nothing about its timing (a buff's blackboard `effect`, an extra event
    group, an unknown class's `_effects`), from the key's name and the event that plays it; 'other' when neither tells."""
    if SKILL_RANGE.search(key):
        return 'range'
    if SKILL_END.search(key):
        return 'end'
    if re.search(r'_(hit|heal)', key, re.I):
        return 'hit'
    if re.search(r'_(buff|loop)', key, re.I):
        return 'loop'
    if re.search(r'_start', key, re.I) or event in ('ON_ATTACHED', 'ON_CAST_START', 'ON_SPELL_ON'):
        return 'start'
    if event in ('ON_DETACHED', 'ON_CAST_END', 'ON_SPELL_END', 'ON_ATTACK_FINISH'):
        return 'end'
    return 'other'


def buff_target(cls, field, fields):
    """Who carries the buffs of field `field` of a behaviour `cls`: 'owner', 'targets', 'token' or None (not known).
    Since index v3 the attachments' `_additiveActiveBuffs` (added to the owner's attacks, so on their targets), a
    blocker's `_buffsToBlockee`, `_projectileBuffs`, the tile listeners' and LockTargetAbility's buffs are the targets'
    (they were the owner's or unknown), `_buffsToExistToken` a summon's."""
    if field in ('_buffsToToken', '_buffsToExistToken'):
        return 'token'
    if field in ('_activeBuffs', '_additiveActiveBuffs', '_buffsToBlockee', '_projectileBuffs', '_buffsWhenEnemyEnter') \
            or cls in ('BuffToCastTargets', 'GlobalUniqueBuffToTargetsBySelectorAbility', 'GloballUniqueBuffAbility',
                       'Headb2S3HighlandAOE', 'BuffToCharacterTileListener', 'BuffToEnemyTileListener', 'LockTargetAbility'):
        return 'targets'
    if 'Aura' in cls:
        return 'owner' if field == '_passiveBuffs' else 'targets'
    if cls in ('ActiveBuffAbility', 'ActiveOneOfBuffAbility'):
        sel = fields.get('_selector')
        return 'targets' if field != '_passiveBuffs' and isinstance(sel, dict) and sel.get('m_PathID') else 'owner'
    if cls.startswith(('BuffToOwner', 'BuffDuring', 'BuffAfter', 'Passive', 'ToggleablePassive', 'ExtraPassive', 'Chant')):
        return 'owner'
    return None


def buffs_in(v):
    """Every BuffData (a dict with buffKey and overrideEffectKey) inside a value."""
    out = []
    if isinstance(v, dict):
        if 'buffKey' in v and 'overrideEffectKey' in v:
            out.append(v)
        for x in v.values():
            out += buffs_in(x)
    elif isinstance(v, list):
        for x in v:
            out += buffs_in(x)
    return out


def buff_life(b):
    """The life of a BuffData (§33.17): {type (LIFE_TYPES: IMMEDIATELY — applied and gone at once, LIMITED — for a time,
    INFINITY — until removed: its ability ends, the target leaves an aura, …; CUSTOM), time? (`lifeTime` s, when set),
    key? (`durationKey`, a LIMITED / CUSTOM buff's: the blackboard key its time is read from — our data records'
    blackboards carry the values), db? (`loadFromDB`: the client's buff table may override these), tick?
    (`triggerInterval` s: the period of its ON_BUFF_TRIGGER actions)}; None when `b` has no lifeTimeType."""
    t = b.get('lifeTimeType') if isinstance(b, dict) else None
    if isinstance(t, str) and t in LIFE_TYPES:            # the templates' Odin data: the enum's names
        name = t
    elif isinstance(t, int) and not isinstance(t, bool):
        name = event_name(LIFE_TYPES, t) or str(t)
    else:
        return None
    life = {'type': name}
    if isinstance(b.get('lifeTime'), (int, float)) and b['lifeTime'] > 0:
        life['time'] = f6(b['lifeTime'])
    key = b.get('durationKey')
    if name in ('LIMITED', 'CUSTOM') and isinstance(key, str) and key and key != 'none':
        life['key'] = key
    if b.get('loadFromDB') in (1, True):
        life['db'] = True
    if isinstance(b.get('triggerInterval'), (int, float)) and b['triggerInterval'] > 0:
        life['tick'] = f6(b['triggerInterval'])
    return life


def bb_ability_names(v):
    """The abilities the buffs inside a value name in their blackboard (`ability_name`: what a template's TriggerAbility
    without a name of its own casts, graph_links): [(buffKey, templateKey, ability name)…] (v3)."""
    out = []
    for b in buffs_in(v):
        for x in b.get('blackboard') or []:
            if isinstance(x, dict) and x.get('key') == 'ability_name' and isinstance(x.get('valueStr'), str) and x['valueStr']:
                out.append((b.get('buffKey') or None, b.get('templateKey') or None, x['valueStr']))
    return out


def graph_effects(state, ek):
    """The effect keys of an Odin-serialized action graph (a SerializedState JSON string): [(node type, field, key)…]
    — the node type without its namespace (CreateEffect, CreateBuff, …), the field naming the key."""
    try:
        nodes = json.loads(state) if isinstance(state, str) and state[:1] in '[{' else None
    except ValueError:
        return []
    out = []

    def walk(v, typ):
        if isinstance(v, dict):
            typ = str(v.get('$type') or typ).split('+')[-1]
            for k, x in v.items():
                if isinstance(x, str) and ek(x):
                    out.append((typ, k, ek(x)))
                elif isinstance(x, list) and x and all(isinstance(y, str) for y in x):
                    out.extend((typ, k, ek(y)) for y in x if ek(y))
                elif isinstance(x, (dict, list)):
                    walk(x, typ)
        elif isinstance(v, list):
            for x in v:
                walk(x, typ)
    walk(nodes, '')
    return out


def graph_nodes(state):
    """Every action node of an Odin-serialized action graph (a SerializedState JSON string), nested ones included (a
    condition's `_succeedNodes`, …): [(node type without its namespace, node dict)…]."""
    try:
        nodes = json.loads(state) if isinstance(state, str) and state[:1] in '[{' else None
    except ValueError:
        return []
    out = []

    def walk(v):
        if isinstance(v, dict):
            if isinstance(v.get('$type'), str):
                out.append((v['$type'].split('+')[-1].split(',')[0], v))
            for x in v.values():
                if isinstance(x, (dict, list)):
                    walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(nodes)
    return out


def graph_links(state):
    """What an action graph does to abilities, modes and buffs (v3): (abilities: [[action type, ability name | None (the
    buff's blackboard `ability_name`), 'cast' | 'stop']…] — TRIGGER_ACTION / STOP_ACTION nodes, switches: [[mode index |
    'bb' (the buff's blackboard `mode`), restoreDefault]…] — SwitchMode nodes, creates: [template keys of the buffs it
    creates]); a node's own fields only, not the abilities its buffs' templates trigger."""
    abilities, switches, creates = [], [], []
    for typ, n in graph_nodes(state):
        if '_abilityName' in n:
            # an empty name: the ability the buff's blackboard `ability_name` names (generic templates such as
            # triggerability_tick_trigger, trigger_ability[onstart] — assumed from the data: their buffs carry that key)
            name = n['_abilityName'] if isinstance(n['_abilityName'], str) and n['_abilityName'] else None
            if TRIGGER_ACTION.search(typ):
                abilities.append([typ, name, 'cast'])
            elif STOP_ACTION.search(typ):
                abilities.append([typ, name, 'stop'])
        if typ == 'SwitchMode':
            idx = 'bb' if n.get('_loadModeFromBlackboard') else n.get('_modeIndex')
            switches.append([idx, bool(n.get('_restoreDefault'))])
        for b in buffs_in({k: v for k, v in n.items() if k != '$type'}):
            if isinstance(b.get('templateKey'), str) and b['templateKey'] and b['templateKey'] not in creates:
                creates.append(b['templateKey'])
    return abilities, switches, creates


def template_uses(tkey, template, on, buff):
    """The uses of a buff template's action graph (a buff_templates() entry): its CreateEffect nodes play at their buff
    event (BUFF_EVENT_ROLES; a target's buff starts when the target is hit), the buffs it creates loop."""
    uses = []
    for event, typ, field, key in template.get('graph', []):
        role = BUFF_EVENT_ROLES.get(event, 'trigger')
        if typ.startswith(('CreateBuff', 'CreateNoSourceBuff', 'CreateLineEffect')) or field == 'overrideEffectKey':
            role = 'loop'
        elif typ.startswith('CreateTileEffect'):
            role = 'range'
        if on == 'targets' and role == 'start':
            role = 'hit'
        uses.append({'role': role, 'keys': [key], 'from': f'template {tkey}', 'event': event, 'action': typ,
                     **({'on': on} if on else {}), 'buff': buff})
    return uses


def behaviour_uses(cls, fields, ek, templates=None, node=None, ability=None):
    """The effect uses of one behaviour of a skill prefab (class `cls`, typetree `fields`): [{role (SKILL_ROLES), keys,
    from (class.field, or `template <key>`), node?, ability?, startEvent? / endEvent? (ABILITY_EVENTS names), oneshot?,
    directionType?, slots?, on?, buff?, template?, event? / action? (a buff template's), bb?}…]. `ek(name)` gives the
    lower-case effect key or None; `templates`: buff_templates()."""
    templates = templates or {}
    uses = []

    def add(keys, role, src, **kw):
        ks = [ek(x) for x in keys if isinstance(x, str) and x and ek(x)]
        if ks:
            u = {'role': role, 'keys': ks, 'from': f'{cls}.{src}'}
            if node:
                u['node'] = node
            if ability and ability != cls:
                u['ability'] = ability
            u.update({a: b for a, b in kw.items() if b is not None})
            uses.append(u)

    def row(kind, r, src, **extra):
        if not isinstance(r, dict) or not isinstance(r.get('_effects'), list):
            return
        slots = [ek(x) if isinstance(x, str) and x else None for x in r['_effects']]
        directional = bool(r.get('_directionType'))
        keys = list(dict.fromkeys(x for x in slots if x)) if directional else slots[:1] if slots and slots[0] else []
        while directional and slots and slots[-1] is None:
            slots.pop()
        kw = {'startEvent': event_name(ABILITY_EVENTS, r.get('_startEvent')), 'endEvent': event_name(ABILITY_EVENTS, r.get('_endEvent')),
              'oneshot': bool(r['_oneshot']) if '_oneshot' in r else None, 'list': kind, **extra}
        if keys:
            add(keys, emit_role(kind, r, keys[0]), src, **kw, **({'directionType': r['_directionType'], 'slots': slots} if directional else {}))
        hook = r.get('_hookEffectAfterFirstAttack')     # played instead of the row's effect from the second attack on
        if isinstance(hook, str) and ek(hook):
            add([hook], emit_role(kind, r, ek(hook)), f'{src}._hookEffectAfterFirstAttack', **kw)

    events = CLASS_EVENTS.get(cls)
    ev_kw = {}
    if events:
        ev_kw = {'startEvent': event_name(ABILITY_EVENTS, fields.get(events[0])),
                 'endEvent': event_name(ABILITY_EVENTS, fields.get(events[1]))}
        if events[2]:
            ev_kw['oneshot'] = bool(fields.get(events[2]))
    for f, v in fields.items():
        if f in EMIT_LISTS and isinstance(v, list):
            if v and all(isinstance(x, str) for x in v):          # RangeEffectEmitter._castEffects: plain keys
                add(v, 'range' if cls == 'RangeEffectEmitter' else emit_role(EMIT_LISTS[f], {}, v[0]), f, **ev_kw)
            for r in v:
                row(EMIT_LISTS[f], r, f)
        elif f in EMIT_GROUPS and isinstance(v, list):
            # a group's rows: `group` (its index; `groups` the list's length, empty groups included), a replace group's
            # `anim` and `loopType` (v3: ANIM_LOOP_TYPES — LOOP, the animations in turn; RANDOM), and the
            # MultiHitUberEffectEmitter's choice of group per hit (MULTI_HIT_FLAGS, when set)
            flags = {k.lstrip('_'): True for k in MULTI_HIT_FLAGS if fields.get(k)}
            if f == '_replaceGroup' and isinstance(fields.get('_loopType'), int):
                flags['loopType'] = event_name(ANIM_LOOP_TYPES, fields['_loopType']) or str(fields['_loopType'])
            for gi, g in enumerate(v):
                anim = g.get('anim') if isinstance(g, dict) and isinstance(g.get('anim'), str) and g.get('anim') else None
                for inner, x in (g.items() if isinstance(g, dict) else []):
                    kind = EMIT_GROUPS[f] or REPLACE_LISTS.get(inner) or list_kind(inner)
                    for r in (x if isinstance(x, list) else []):
                        row(kind, r, f, group=gi, groups=len(v), anim=anim, **flags)
        elif f in EFFECT_FIELDS:
            add(v if isinstance(v, list) else [v], EFFECT_FIELDS[f], f, **ev_kw)
        elif f in ('_effects', '_effect', '_effectKey'):
            role = CLASS_EFFECTS.get(cls, 'other')
            for k in (v if isinstance(v, list) else [v]) if role else []:
                if isinstance(k, str) and ek(k):
                    r2 = role if role != 'other' else name_role(ek(k), ev_kw.get('startEvent'))
                    add([k], r2, f, **ev_kw, **({'by': 'name'} if role == 'other' else {}))
        elif f == '_extraEventGroup' and isinstance(v, list):    # ChannelingEffectGroupEmitter: {effect, event…}
            for g in v:
                if isinstance(g, dict) and isinstance(g.get('effect'), str) and ek(g['effect']):
                    ev = event_name(ABILITY_EVENTS, g.get('playOnEvent', g.get('_playOnEvent', g.get('event'))))
                    add([g['effect']], name_role(ek(g['effect']), ev), f, startEvent=ev, by='name')
        if isinstance(v, (dict, list)):
            for b in buffs_in(v):
                on, tkey = buff_target(cls, f, fields), b.get('templateKey') or None
                t = templates.get(tkey) or {}
                effect = b.get('overrideEffectKey') or t.get('effect')
                life = buff_life(b)                             # the buff's life: every use it carries has it (v3)
                add([effect], 'loop', f, on=on, buff=b.get('buffKey') or None, template=tkey, life=life)
                for u in template_uses(tkey, t, on, b.get('buffKey') or None) if t else []:
                    u['from'] = f'{cls}.{f} → {u["from"]}'
                    if node:
                        u['node'] = node
                    if life:
                        u['life'] = life
                    uses.append(u)
                for bb in b.get('blackboard') or []:            # an effect the template's actions read by name
                    if isinstance(bb, dict) and isinstance(bb.get('valueStr'), str) and ek(bb['valueStr']):
                        add([bb['valueStr']], name_role(ek(bb['valueStr'])), f'{f}.blackboard', on=on,
                            buff=b.get('buffKey') or None, bb=bb.get('key'), by='name', life=life)
            if isinstance(v, dict) and isinstance(v.get('SerializedState'), str):
                for typ, field, key in graph_effects(v['SerializedState'], ek):
                    role = 'loop' if field == 'overrideEffectKey' or typ.startswith('CreateBuff') else 'start'
                    add([key], role, f'{f} {typ}', action=typ)
    return uses


def skill_mode(fields):
    """The unit mode a skill behaviour switches its owner to (index into the unit's modes), or None: the blackboard
    `mode` of a switch_mode* buff, a ToggleSkill's _switchToMode."""
    for b in buffs_in(fields):
        if str(b.get('templateKey') or '').startswith('switch_mode'):
            for bb in b.get('blackboard') or []:
                if isinstance(bb, dict) and bb.get('key') == 'mode' and isinstance(bb.get('value'), (int, float)):
                    return int(bb['value'])
    m = fields.get('_switchToMode')
    return m if isinstance(m, int) and not isinstance(m, bool) and m >= 0 else None


def roles_of(uses):
    """{role: [keys…]} of a skill's uses (SKILL_ROLES order, keys in first-use order, slots included)."""
    out = {}
    for u in uses:
        lst = out.setdefault(u['role'], [])
        for k in list(u['keys']) + [x for x in u.get('slots') or [] if x]:
            if k not in lst:
                lst.append(k)
    return {r: out[r] for r in SKILL_ROLES if r in out}


def parse_unit(env, rel, name, kind):
    """A unit prefab (charpack / enemy / token) → its index.json unit (§33.12) before the keys are checked: the modes
    (attack, combat: ability_entry), start / dead effects, the Graphic transform, the chargeable groups (`charge`), the
    Spine-event effects (`spineEffects`, v3), and for crawl_units `_enemySkills` (its EnemySkill nodes: name, GameObject,
    path, mode name), `_strings` (every string of its behaviours), `_paths` (GameObject → path), `_roots` (unit_roots:
    its talents, common / general abilities and trait, v3), `_templates` (the buff templates its buffs use) and `_named`
    (the abilities its buffs name in their blackboards); None when the bundle has no prefab `name`."""
    root = env.prefabs(rel).get(name)
    if root is None:
        return None
    unit = {'kind': kind, 'prefab': rel, 'rootClass': None, 'modes': [], 'startEffect': None, 'deadEffect': None, 'graphic': None}
    strings, gos, mbs_of = set(), [], {}
    gkey = lambda o: (id(o.assets_file), o.path_id)  # noqa: E731
    stack = [(root, '')]
    while stack:
        go, path = stack.pop()
        gd = env.tt(go)
        if gd.get('m_Name') == 'Graphic' and unit['graphic'] is None:
            p, q, s = go_transform(env, go)
            unit['graphic'] = {'path': path + 'Graphic', 'pos': [f6(x) for x in p], 'rot': [f6(x) for x in q], 'scale': [f6(x) for x in s]}
        ms = []
        for c in gd.get('m_Component', []):
            f, o = env.resolve(go.assets_file, c.get('component'))
            if o is None or f == 'builtin' or o.type.name != 'MonoBehaviour':
                continue
            try:
                d = env.tt(o)
            except Exception:
                continue
            ms.append((env.script(o)[1], o, d))
            all_strings({k: v for k, v in d.items() if k != 'm_Name'}, strings)
        mbs_of[gkey(go)] = ms
        gos.append((go, '' if go is root else path + gd.get('m_Name', '')))
        for k in go_children(env, go):
            stack.append((k, '' if go is root else f'{path}{gd.get("m_Name")}/'))
    path_of = {gkey(go): p for go, p in gos}

    def go_of(o):
        g = env.resolve(o.assets_file, env.tt(o).get('m_GameObject'))[1]
        return g if g is not None and gkey(g) in path_of else None

    def deref(o, pptr):
        f, x = env.resolve(o.assets_file, pptr)
        return x if x is not None and f != 'builtin' and x.type.name == 'MonoBehaviour' else None

    def node_emitters(go):
        """[(class, rows, settings)] of the emitters on a GameObject (emitter_export)."""
        return [(cls,) + emitter_export(cls, d) for cls, o, d in mbs_of.get(gkey(go), []) if is_emitter(cls, d)]

    # the chargeable groups (§33.12 Charge) first: the modes' attacks name their abilities (attack.charge)
    charge, charge_at = [], {}
    for go, p in gos:
        for cls, o, d in mbs_of.get(gkey(go), []):
            if not (CHARGE_GROUP.search(cls) and isinstance(d.get('_abilities'), list)):
                continue
            g = {'node': p, 'class': cls}
            if isinstance(d.get('_maxChargeTimes'), int):
                g['maxChargeTimes'] = d['_maxChargeTimes']
            g['emitters'] = [{'class': c, **(st or {}), **rows} for c, rows, st in node_emitters(go)]
            g['abilities'] = []
            for ap in d['_abilities']:
                ao = deref(o, ap)
                if ao is None:
                    continue
                ad, ago = env.tt(ao), go_of(ao)
                ab = {'node': path_of.get(gkey(ago)) if ago is not None else None, 'class': env.script(ao)[1], 'modes': []}
                for k, v in ad.items():
                    if CHARGE_ABILITY_FIELDS.search(k) and not is_pptr(v) and not isinstance(v, dict) \
                            and not (isinstance(v, list) and any(isinstance(x, dict) for x in v)):
                        ab[k.lstrip('_')] = enc_value(v, lambda q: None)
                for k, n in CHARGE_MOUNT_NAMES.items():
                    if isinstance(ab.get(k), list):
                        ab[n] = mount_names(ab[k])
                    elif isinstance(ab.get(k), int):
                        ab[n] = mount_names([ab[k]])[0]
                ab['emitters'] = [{'class': c, **(st or {}), **rows} for c, rows, st in node_emitters(ago)] if ago is not None else []
                charge_at[gkey(ao)] = (len(charge), len(g['abilities']))
                g['abilities'].append(ab)
            charge_at[gkey(o)] = (len(charge), None)
            charge.append(g)

    claimed = set()                     # GameObjects the modes' attacks, the charge groups, the enemy skills export

    def ability_entry(ao, mode_name, depth=0):
        """A mode's attack / combat (or a sub-ability of one): its class and ABILITY_FIELDS, its node, the rows of every
        emitter on its node (attack.emitters + `emitter` on each row when that is not one plain UberEffectEmitter), its
        sub-abilities (a group's `_abilities` — an AbilitySelectableGroup's `_abilityConfigs` in config order and a
        BurstAttackGroup's `_burstAttack`, v3 —, else the child nodes that carry an ability: MultiFunnelRemoteAttack's
        funnels), the charge ability it releases (`charge`: [group, ability] indexes into unit.charge); v3: the group's
        `select` (group_select; `main` / `burst`: the index of its _mainAbility / _burstAttack among `abilities`) and
        attack_extras (mount, mountGroup, additionalTimes, triggerDelta)."""
        ad = env.tt(ao)
        a = {'class': env.script(ao)[1]}
        for k in ABILITY_FIELDS:
            if k in ad:
                a[k.lstrip('_')] = ad[k]
        a.update(attack_extras(ad))
        sel = group_select(a['class'], ad)
        ago = go_of(ao)
        if ago is None:
            return a
        a['node'] = path_of[gkey(ago)]
        claimed.add(gkey(ago))
        ems = node_emitters(ago)
        if len(ems) == 1 and ems[0][2] is None:
            a.update(ems[0][1])
        elif ems:
            a['emitters'] = [st or {'class': c} for c, rows, st in ems]
            for i, (c, rows, st) in enumerate(ems):
                for kind, rs in rows.items():
                    a.setdefault(kind, []).extend({**r, 'emitter': i} for r in rs)
        if ad.get('_useChargeableGroup') or '_chargeAbility' in ad:
            co = deref(ao, ad.get('_chargeAbility'))
            at = charge_at.get(gkey(co)) if co is not None else None
            if at:
                a['charge'] = {'group': at[0], 'ability': at[1]}
                if isinstance(ad.get('_chargeAnimKey'), str) and ad['_chargeAnimKey']:
                    a['charge']['animKey'] = ad['_chargeAnimKey']
                ab = charge[at[0]]['abilities'][at[1]] if at[1] is not None else None
                if ab is not None and mode_name and mode_name not in ab['modes']:
                    ab['modes'].append(mode_name)
        if depth < 4 and not CHARGE_GROUP.search(a['class']):
            if isinstance(ad.get('_abilities'), list):
                subs = [s for s in (deref(ao, x) for x in ad['_abilities']) if s is not None]
            elif isinstance(ad.get('_abilityConfigs'), list):          # v3: the configs' abilities, in their order
                subs = [s for s in (deref(ao, c.get('_ability')) for c in ad['_abilityConfigs'] if isinstance(c, dict)) if s is not None]
                burst = deref(ao, config_ability(ad.get('_burstAttack')))
                if burst is not None and all(gkey(s) != gkey(burst) for s in subs):
                    subs.append(burst)
            else:
                subs = []
                for ch in go_children(env, ago):
                    subs += [o for cls, o, d in mbs_of.get(gkey(ch), []) if is_ability(cls)][:1]
                if not subs and depth == 0 and 'Funnel' in a['class']:
                    # v3: a funnel attack whose funnels sit next to it (耶拉 S2's Funnel_0 / Funnel_1 beside Attack): the
                    # sibling abilities with a FunnelEffectEmitter
                    for go2, p2 in sorted(gos, key=lambda x: x[1]):
                        if p2.rsplit('/', 1)[0] == a['node'].rsplit('/', 1)[0] and p2 != a['node'] \
                                and any(cls == 'FunnelEffectEmitter' for cls, o, d in mbs_of.get(gkey(go2), [])):
                            subs += [o for cls, o, d in mbs_of.get(gkey(go2), []) if is_ability(cls)][:1]
            subs = [s for s in subs if gkey(s) != gkey(ao)]
            if sel:
                for field, label in (('_mainAbility', 'main'), ('_burstAttack', 'burst')):
                    x = deref(ao, config_ability(ad.get(field)))
                    at = next((i for i, s in enumerate(subs) if x is not None and gkey(s) == gkey(x)), None)
                    if at is not None:
                        sel[label] = at
            subs = [ability_entry(s, mode_name, depth + 1) for s in subs]
            if subs:
                a['abilities'] = subs
        if sel:
            a['select'] = sel
        return a

    head = next(((o, d) for cls, o, d in mbs_of.get(gkey(root), []) if '_modes' in d), None)
    mode_paths, general_of = [], {}
    if head:
        ho, hd = head
        unit['rootClass'] = env.script(ho)[1]
        unit['startEffect'] = hd.get('_startEffect') or None
        unit['deadEffect'] = hd.get('_deadEffect') or None
        for mp in hd.get('_modes', []):
            mo = deref(ho, mp)
            if mo is None:
                continue
            md = env.tt(mo)
            mgo = env.resolve(mo.assets_file, md.get('m_GameObject'))[1]
            mode = {'name': env.tt(mgo).get('m_Name') if mgo is not None else None,
                    'overrideStartEffect': md.get('_overrideStartEffect') or None,
                    'overrideDeadEffect': md.get('_overrideDeadEffect') or None, 'attack': None}
            if mgo is not None and gkey(mgo) in path_of:
                mode_paths.append((path_of[gkey(mgo)], mode['name']))
            ao, co = deref(mo, md.get('_attack')), deref(mo, md.get('_combat'))
            if ao is not None:
                mode['attack'] = ability_entry(ao, mode['name'])
            if co is not None and (ao is None or gkey(co) != gkey(ao)):   # the blocked units' attack, when another one
                mode['combat'] = ability_entry(co, mode['name'])
            for gp in md.get('_generalAbilities') or []:                 # v3: the mode's general abilities
                ga = deref(mo, gp)
                go_ = go_of(ga) if ga is not None else None
                if go_ is not None:
                    names = general_of.setdefault(gkey(go_), [])
                    if mode['name'] not in names:
                        names.append(mode['name'])
            unit['modes'].append(mode)
    if charge:
        unit['charge'] = charge
        for g in charge:
            claimed.update(gkey(go) for go, p in gos if p == g['node'] or any(p == ab['node'] for ab in g['abilities']))

    def mode_of(p):
        return next((n for mp_, n in sorted(mode_paths, key=lambda x: -len(x[0])) if mp_ and p.startswith(mp_ + '/')), None)

    # an enemy's skills: the nodes with an EnemySkill (data/enemies.json skills[].prefabKey names them), with the mode
    # whose node holds them (a skill a boss has per mode: one copy per mode)
    unit['_enemySkills'] = []
    for go, p in gos:
        if any(ENEMY_SKILL_CLASS.search(cls) for cls, o, d in mbs_of.get(gkey(go), [])):
            unit['_enemySkills'].append((env.tt(go).get('m_Name') or '', go, p, mode_of(p)))
            claimed.add(gkey(go))
    unit['_strings'] = strings
    unit['_paths'] = path_of
    unit['_roots'] = unit_roots(env, root, gos, mbs_of, gkey, go_of, deref, head, general_of, claimed, mode_of)
    unit['_templates'] = {b.get('templateKey') for ms in mbs_of.values() for cls, o, d in ms for b in buffs_in(d)
                          if isinstance(b.get('templateKey'), str) and b.get('templateKey')}
    unit['_named'] = [x for ms in mbs_of.values() for cls, o, d in ms for x in bb_ability_names(d)]
    spine = []
    for go, p in gos:                                   # v3: effects a Spine clip's events play (SpineEffectEmitter)
        for cls, o, d in mbs_of.get(gkey(go), []):
            if cls == 'SpineEffectEmitter' and isinstance(d.get('_spineEffectPresets'), list):
                for i, pr in enumerate(d['_spineEffectPresets']):
                    row = emit_row(pr) if isinstance(pr, dict) else None
                    if row:
                        spine.append({'node': p, 'preset': i, 'effects': row['effects'], 'directionType': row.get('directionType', 0),
                                      **({'slots': row['slots']} if 'slots' in row else {}),
                                      'createAtWorldPos': row.get('createAtWorldPos', 0)})
    if spine:
        unit['spineEffects'] = spine
    return unit


def unit_roots(env, root, gos, mbs_of, gkey, go_of, deref, head, general_of, claimed, mode_of):
    """The roots of a unit's v3 entries (§33.17), for crawl_units' node_entry walks: [{kind ('talent' | 'trait' |
    'common' | 'general'), go, path, name (the GameObject's name: a talent's prefab key, an ability's name), alias (the
    ability's namedAsAlias), classes, talent (its Talent class), ability (main_ability), mode (the mode holding the
    node) or modes (a general ability: the modes listing it), fields (the Talent's and the toggle checkers' typetrees),
    stop (gkeys of every root and claimed node: the walks do not enter them)}…]. A GameObject is one root: talent before
    trait, common, general. Common abilities: the head's `_commonAbilities` and the abilities right under a
    CommonAbilities node; general abilities: the modes' `_generalAbilities`; the trait: the head's `_traitAbility`."""
    by_key = {gkey(go): (go, p) for go, p in gos}
    kinds = {}

    def add(go, kind):
        if go is not None and gkey(go) in by_key and gkey(go) not in kinds and gkey(go) not in claimed and go is not root:
            kinds[gkey(go)] = kind
    for go, p in gos:
        if any(all(k in d for k in TALENT_BASE_FIELDS) for cls, o, d in mbs_of.get(gkey(go), [])):
            add(go, 'talent')
    if head:
        ho, hd = head
        t = deref(ho, hd.get('_traitAbility'))
        add(go_of(t) if t is not None else None, 'trait')
        for cp in hd.get('_commonAbilities') or []:
            c = deref(ho, cp)
            add(go_of(c) if c is not None else None, 'common')
    for go, p in gos:
        if COMMON_NODE.match(env.tt(go).get('m_Name') or ''):
            for ch in go_children(env, go):
                if any(is_ability(cls) for cls, o, d in mbs_of.get(gkey(ch), [])):
                    add(ch, 'common')
    for k in general_of:
        add(by_key[k][0] if k in by_key else None, 'general')
    # a root inside another root of the same kind belongs to that one (a common group's sub-abilities)
    paths = {k: by_key[k][1] for k in kinds}
    for k in list(kinds):
        if kinds[k] != 'talent' and any(k2 != k and kinds[k2] == kinds[k] and paths[k].startswith(paths[k2] + '/') for k2 in kinds):
            del kinds[k]
    stop = set(kinds) | claimed
    out = []
    for go, p in gos:
        k = gkey(go)
        if k not in kinds:
            continue
        ms = mbs_of.get(k, [])
        classes = [cls for cls, o, d in ms]
        talent = next(((cls, d) for cls, o, d in ms if all(f in d for f in TALENT_BASE_FIELDS)), None)
        ability = main_ability([c for c in classes if not (talent and c == talent[0])])
        ab_d = next((d for cls, o, d in ms if cls == ability), {}) if ability else {}
        alias = ((ab_d.get('_metadata') or {}).get('namedAsAlias') or None) if isinstance(ab_d, dict) else None
        r = {'kind': kinds[k], 'go': go, 'path': p, 'name': env.tt(go).get('m_Name') or '', 'alias': alias,
             'classes': classes, 'ability': ability, 'talent': talent[0] if talent else None,
             'talentFields': talent[1] if talent else None,
             'toggles': [(cls, d) for cls, o, d in ms if TOGGLE_CHECKER.search(cls)], 'stop': stop}
        if kinds[k] == 'general':
            r['modes'] = general_of.get(k, [])
        else:
            r['mode'] = mode_of(p)
        out.append(r)
    return out


def skin_points(env, rel, prefab, graphic, container=None):
    """Mount points under a skin root (an operator's chararts defaultskin, placed under the charpack's Graphic) or
    under a unit prefab (an enemy / token: its own Graphic subtree): name → {facing ('front' | 'back' | 'all'):
    {pos (unit-root frame, Unity units and axes), bone (BoneFollower bone or null), path, rot (the point's local
    rotation, quaternion x y z w), followRot (with a bone: the BoneFollower's followBoneRotation)}}. The root's own
    transform is not composed: a unit prefab's root transform is where the prefab was authored (88 of the full set's
    roots sit tiles away, e.g. enemy_1007_slime at (3, 3, 0); the game places the unit), a skin root's the offset the
    client drops when it attaches the skin under Graphic (char_446_aroma's −1.895 in x) — the points are relative to
    the unit's feet. spine-unity's BoneFollower (the point's parent holds the skeleton: an operator's Front / Back, an
    enemy's Spine) sets the point's local position from the bone every frame and, with followBoneRotation, its local
    rotation to the bone's angle about z; without it the point keeps `rot` (洛洛's SpecialPoint1 and 令's
    SpecialPoint2: 30° about x, which cancels the Graphic's −30° tilt)."""
    prefabs = env.prefabs(rel, full=container is not None)
    root = None
    if container is not None:
        root = next((o for p, o in prefabs.items() if p.endswith(container)), None)
    else:
        root = prefabs.get(prefab)
    if root is None:
        return None
    base = trs_matrix(graphic['pos'], graphic['rot'], graphic['scale']) if graphic else trs_matrix([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])
    points = {}

    def walk(go, m, facing, path):
        gd = env.tt(go)
        name = gd.get('m_Name', '')
        trs = None if go is root else go_transform(env, go)
        m2 = m if trs is None else mat_mul(m, trs_matrix(*trs))
        f2 = 'front' if name == 'Front' else 'back' if name == 'Back' else facing
        bone, follow_rot = None, True
        for c in gd.get('m_Component', []):
            cf, co = env.resolve(go.assets_file, c.get('component'))
            if co is not None and cf != 'builtin' and co.type.name == 'MonoBehaviour' and env.script(co)[1] == 'BoneFollower':
                bf = env.tt(co)
                bone = bf.get('boneName') or None
                follow_rot = bool(bf.get('followBoneRotation', 1))   # spine-unity's default: true
        if trs is not None and MOUNT_NAME.search(name):
            pt = {'pos': mat_point(m2), 'bone': bone, 'path': path + name, 'rot': [f6(x) for x in trs[1]]}
            if bone:
                pt['followRot'] = follow_rot
            points.setdefault(name, {})[f2 or 'all'] = pt
        for k in go_children(env, go):
            walk(k, m2, f2, '' if go is root else f'{path}{name}/')
    walk(root, base, None, '')
    return points


def strings_of(v, out):
    """all_strings without the fields that name animations or sounds (NOT_EFFECT_FIELDS)."""
    if isinstance(v, dict):
        for k, x in v.items():
            if not NOT_EFFECT_FIELDS.search(str(k)):
                strings_of(x, out)
    elif isinstance(v, (list, tuple)):
        for x in v:
            strings_of(x, out)
    else:
        all_strings(v, out)
    return out


def buff_templates(env, ek):
    """templateKey → {effect: key | None, graph: [[buff event, action node type, field, key]…], abilities?: [[buff
    event, action node type, ability name, 'cast' | 'stop']…], switches?: [[buff event, mode index | 'bb',
    restoreDefault]…], creates?: [template keys]} for every buff template (BUFF_TEMPLATES, Torappu
    BuffTemplateHolder._templates) that names an effect, an ability, a mode switch or another template: a buff whose
    overrideEffectKey is empty loops its template's effectKey; the graph's CreateEffect / CreateBuff nodes play at
    their buff event; the abilities (v3, graph_links) are the ones its TriggerAbility* / Interrupt* actions cast and
    stop — how the client ties a common ability or a talent's ability to an event."""
    try:
        files = env.load_rel(BUFF_TEMPLATES)
    except Exception:  # noqa: BLE001 — an older client without the holder: buffs keep their override keys only
        return {}
    out = {}
    for sf in files:
        for o in sf.objects.values():
            if o.type.name != 'MonoBehaviour':
                continue
            for t in (env.tt(o).get('_templates') or []):
                if not isinstance(t, dict) or not t.get('templateKey'):
                    continue
                graph, abilities, switches, creates = [], [], [], []
                for it in ((t.get('eventToActions') or {}).get('_items') or []):
                    ev = event_name(BUFF_EVENTS, it.get('key')) or it.get('key')
                    state = (it.get('value') or {}).get('SerializedState')
                    for typ, field, key in graph_effects(state, ek):
                        graph.append([ev, typ, field, key])
                    ab, sw, cr = graph_links(state)
                    abilities += [[ev] + x for x in ab]
                    switches += [[ev] + x for x in sw]
                    creates += [x for x in cr if x not in creates]
                effect = ek(t.get('effectKey')) if t.get('effectKey') else None
                if effect or graph or abilities or switches or creates:
                    out[t['templateKey']] = {'effect': effect, 'graph': graph, **({'abilities': abilities} if abilities else {}),
                                             **({'switches': switches} if switches else {}),
                                             **({'creates': creates} if creates else {})}
    return out


def ability_info(mbs, pk):
    """The attack ability of one GameObject's behaviours [(class, typetree)…] (v3: the skills' and the talents'
    `abilities`): {class, …ABILITY_FIELDS without the underscore (projectileKey lower case), …attack_extras, select?
    (group_select)} for the GameObject's ability (main_ability) when it has attack fields or is a group; else None."""
    cls = main_ability([c for c, _ in mbs])
    d = next((d for c, d in mbs if c == cls), None) if cls else None
    if d is None or not is_ability(cls):
        return None
    return ability_fields(cls, d, pk)


def projectile_emitters(mbs, pk, skip=None):
    """The other behaviours of a GameObject that fire a projectile of their own (`_projectileKey`: SimpleProjectileEmitter,
    ChantWithProjectileBeforeSkill, …), as abilities entries {class, projectileKey} (v3); `skip`: the main ability's class."""
    out = []
    for c, d in mbs:
        if c != skip and isinstance(d.get('_projectileKey'), str) and d['_projectileKey'] and pk(d['_projectileKey']):
            out.append({'class': c, 'projectileKey': pk(d['_projectileKey'])})
    return out


def ability_fields(cls, d, pk):
    """ability_info's fields of an ability behaviour `cls` (typetree `d`); None when it has neither attack fields nor
    a group's sub-abilities."""
    sel = group_select(cls, d)
    if not sel and not any(k in d for k in ABILITY_FIELDS):
        return None
    a = {'class': cls}
    for k in ABILITY_FIELDS:
        if k in d:
            a[k.lstrip('_')] = d[k]
    if a.get('projectileKey'):
        a['projectileKey'] = pk(a['projectileKey']) or a['projectileKey']
    if isinstance(a.get('extraProjectileKeys'), list):
        a['extraProjectileKeys'] = [pk(x) or x for x in a['extraProjectileKeys'] if isinstance(x, str) and x]
    a.update(attack_extras(d))
    for k in ('additionalProjectile',):
        if a.get(k):
            a[k] = pk(a[k]) or a[k]
    if a.get('additionalProjectiles'):
        a['additionalProjectiles'] = [pk(x) or x for x in a['additionalProjectiles']]
    if sel:
        a['select'] = sel
    return a


def node_entry(env, root, ek, pk, effect_refs, templates, node_name=None, stop=None):
    """An index.json entry of a GameObject subtree — a skill prefab ([uc]skills.ab), an enemy's skill node, a unit's
    talent / common / general / trait ability (v3): rootClass / rootAbility (the root's skill class and ability,
    skill_root), effects (every effect key it names, its templates' included), projectiles, mode (the unit mode a skill
    switches to, or null), uses (behaviour_uses of every behaviour; an emitter use of an ability that fires a projectile
    carries its `projectileKey`, v3), roles (roles_of), unclassified (keys found in the subtree that no use places),
    abilities (v3: ability_info of every GameObject, with `node`). `node_name(go, name)` gives a use's `node` (default:
    the GameObject's name); `stop(go)` skips a child subtree that another entry exports."""
    strings, uses, mode, stack, root_mbs, abilities, switches, named = set(), [], None, [root], [], [], [], []
    while stack:
        go = stack.pop()
        gd = env.tt(go)
        name = node_name(go, gd.get('m_Name')) if node_name else gd.get('m_Name')
        mbs = []
        for c in gd.get('m_Component', []):
            f, o = env.resolve(go.assets_file, c.get('component'))
            if o is not None and f != 'builtin' and o.type.name == 'MonoBehaviour':
                mbs.append((env.script(o)[1] or 'MonoBehaviour', env.tt(o)))
        if go is root:
            root_mbs = mbs
        ability = main_ability([c for c, _ in mbs])
        info = ability_info(mbs, pk)
        if info:
            abilities.append({'node': name, **info})
        abilities += [{'node': name, **x} for x in projectile_emitters(mbs, pk, skip=ability)]
        for cls, d in mbs:
            fields = {k: v for k, v in d.items() if k not in SKIP_FIELDS}
            strings_of(fields, strings)
            named += bb_ability_names(fields)            # the abilities its buffs' generic templates cast (v3)
            for b in buffs_in(fields):                  # the mode switches its buffs' templates make (crawl_units, v3)
                for ev, idx, restore in (templates.get(b.get('templateKey')) or {}).get('switches') or []:
                    if idx == 'bb':
                        idx = next((int(x['value']) for x in b.get('blackboard') or [] if isinstance(x, dict)
                                    and x.get('key') == 'mode' and isinstance(x.get('value'), (int, float))), None)
                    switches.append({'event': ev, 'mode': idx, 'restore': restore, 'buff': b.get('buffKey') or None, 'node': name})
            found_uses = behaviour_uses(cls, fields, ek, templates, node=name, ability=ability if 'Emitter' in cls else None)
            if info and info.get('projectileKey') and 'Emitter' in cls:
                for u in found_uses:
                    u['projectileKey'] = info['projectileKey']
                    if info.get('extraProjectileKeys'):
                        u['extraProjectileKeys'] = info['extraProjectileKeys']
            uses += found_uses
            if mode is None:
                mode = skill_mode(fields)
        stack.extend(k for k in go_children(env, go) if not (stop and stop(k)))
    found = set(effect_refs(strings))
    placed = {k for u in uses for k in list(u['keys']) + [x for x in u.get('slots') or [] if x]}
    root_class, root_ability = skill_root(root_mbs)
    return {'rootClass': root_class, 'rootAbility': root_ability,
            'effects': sorted(found | placed), 'projectiles': sorted({pk(x) for x in strings if pk(x)}), 'mode': mode,
            **({'modeBy': 'data'} if mode is not None else {}), 'uses': uses, 'roles': roles_of(uses),
            'unclassified': sorted(found - placed), 'abilities': abilities, '_switches': switches, '_named': named}


def skill_entry(env, root, ek, pk, effect_refs, templates):
    """index.json skills[id] of a skill prefab ([uc]skills.ab) or of an enemy's skill node (node_entry)."""
    e = node_entry(env, root, ek, pk, effect_refs, templates)
    e.pop('_switches', None)
    e.pop('_named', None)
    return e


def crawl_units(ab_root, cabs, unit_ids, gd, eff, enemy_idx, token_idx, log):
    """index.json's units / projectiles / skills / skins for `unit_ids`, and every effect key they reference."""
    units, projectiles, skills, skins, referenced = {}, {}, {}, {}, set()
    shared = AssetEnv(ab_root, cabs)                           # [uc]projectiles.ab and [uc]skills.ab, loaded once
    proj_roots = shared.prefabs(PROJECTILES)
    skill_roots = shared.prefabs(SKILLS)
    # effect / projectile / skill keys are case-insensitive: the client's references mix cases ('…_buff_02_B'), the
    # bundles' containers (and so the files, the manifest and this index) use the lower-case names
    effect_refs = lambda strings: sorted({x.lower() for x in strings if x.lower() in eff})  # noqa: E731
    ek = lambda x: x.lower() if isinstance(x, str) and x.lower() in eff else x  # noqa: E731
    pk = lambda x: x.lower() if isinstance(x, str) and x.lower() in proj_roots else None  # noqa: E731
    lists = (('_effectsWhenStart', 'onStart'), ('_effectsWhenReached', 'onReached'), ('_effectsWhenHit', 'onHit'),
             ('_effectsWhenStop', 'onStop'), ('_effectsToTargetWhenStart', 'toTargetOnStart'),
             ('_effectsToTileWhenStart', 'toTileOnStart'), ('_effectOnTrigger', 'onTrigger'), ('_effectsWhenSelect', 'onSelect'))

    def projectile(key, depth=0):
        key = pk(key)
        if key is None or key in projectiles or depth > 3:
            return
        entry = {'main': None, 'lifeTime': None, 'movement': None, 'behaviours': []}
        projectiles[key] = entry
        strings, stack = set(), [proj_roots[key]]
        while stack:
            go = stack.pop()
            gdd = shared.tt(go)
            for c in gdd.get('m_Component', []):
                f, o = shared.resolve(go.assets_file, c.get('component'))
                if o is None or f == 'builtin' or o.type.name != 'MonoBehaviour':
                    continue
                d = shared.tt(o)
                cls = shared.script(o)[1]
                fields = {k: enc_value(v, lambda p: None) for k, v in d.items() if k not in SKIP_FIELDS and not is_pptr(v)}
                entry['behaviours'].append({'class': cls, 'node': gdd.get('m_Name'), 'fields': fields})
                all_strings({k: v for k, v in d.items() if k != 'm_Name'}, strings)
                if '_mainEffect' in d and cls.endswith('Projectile'):
                    # the projectile class's own flying effect and life (SimpleProjectile, HarpoonProjectile, …); until
                    # 2026-10-15 any behaviour's _mainEffect overwrote them — a chain's or a rope's line (below) became
                    # `main` and `lifeTime` was lost (30 projectiles)
                    entry['main'] = ek(d.get('_mainEffect')) or entry['main']
                    entry['lifeTime'] = f6(d.get('_lifeTime'))
                elif '_mainEffect' in d and cls in LINK_BEHAVIOURS and ek(d.get('_mainEffect')):
                    entry.setdefault('link', ek(d.get('_mainEffect')))
                if cls.endswith('Movement') and entry['movement'] is None:
                    entry['movement'] = {'class': cls, **{k.lstrip('_'): v for k, v in fields.items()}}
                for src, dst in lists:
                    vals = [ek(x) for x in (d.get(src) or []) if isinstance(x, str) and x]
                    if vals:
                        entry.setdefault(dst, []).extend(vals)
            stack.extend(go_children(shared, go))
        entry['effects'] = effect_refs(strings)
        entry['projectiles'] = sorted({pk(x) for x in strings if pk(x) and pk(x) != key})
        for p in entry['projectiles']:
            projectile(p, depth + 1)

    ekn = lambda x: x.lower() if isinstance(x, str) and x.lower() in eff else None  # noqa: E731
    templates = buff_templates(shared, ekn)

    def skill_key(sid):
        """The [uc]skills.ab prefab of a skill id of our data (lower case; a `[n]` variant suffix dropped), or None."""
        for k in (sid, str(sid).lower(), re.sub(r'\[\d+\]$', '', str(sid).lower())):
            if k in skill_roots:
                return k
        return None

    skill_named = {}                    # skill id → the abilities its buffs name in their blackboards (v3)

    def skill(sid):
        sid = skill_key(sid)
        if sid is None or sid in skills:
            return sid
        entry = node_entry(shared, skill_roots[sid], ekn, pk, effect_refs, templates)
        entry.pop('_switches', None)
        skill_named[sid] = entry.pop('_named', [])
        for p in entry['projectiles']:
            projectile(p)
        skills[sid] = entry
        return sid

    def fix_rows(rows, where):
        """Emit rows: keys lower case, the keys the client lacks dropped (logged), rows that play nothing dropped."""
        out = []
        for e in rows or []:
            for x in e['effects']:
                if x.lower() not in eff:
                    log(f'  {where}: names {x}, which the client lacks (dropped)')
            e['effects'] = [ek(x) for x in e['effects'] if x.lower() in eff]
            if 'slots' in e:
                e['slots'] = [ek(x) if x and x.lower() in eff else None for x in e['slots']]
            if e.get('hookEffectAfterFirstAttack'):
                e['hookEffectAfterFirstAttack'] = ek(e['hookEffectAfterFirstAttack'])
            if e['effects'] or e.get('hookEffectAfterFirstAttack'):
                out.append(e)
        return out

    def keyify(v):
        """The effect / projectile keys among an emitter's or a charge ability's settings in lower case."""
        if isinstance(v, str):
            return v.lower() if v.lower() in eff or v.lower() in proj_roots else v
        if isinstance(v, list):
            return [keyify(x) for x in v]
        if isinstance(v, dict):
            return {k: keyify(x) for k, x in v.items()}
        return v

    def fix_emitter(em, where):
        for k in list(em):
            if k in ROW_KINDS:
                em[k] = fix_rows(em[k], f'{where} {k}')
                if not em[k]:
                    del em[k]
            elif k in CHARGE_GROUP_KEYS:
                em[k] = [fix_rows(g, f'{where} {k}[{i}]') for i, g in enumerate(em[k])]
            elif k != 'class':
                em[k] = keyify(em[k])
        return em

    def fix_attack(a, where):
        for k in ('projectileKey', 'additionalProjectile'):
            if a.get(k):
                a[k] = pk(a[k]) or a[k]
        if a.get('additionalProjectiles'):
            a['additionalProjectiles'] = [pk(x) or x for x in a['additionalProjectiles']]
        for lst in ROW_KINDS:
            if lst in a:
                a[lst] = fix_rows(a[lst], f'{where} {lst}')
                if not a[lst]:
                    a.pop(lst)
        for i, em in enumerate(a.get('emitters') or []):
            fix_emitter(em, f'{where} emitters[{i}]')
        for i, sub in enumerate(a.get('abilities') or []):
            fix_attack(sub, f'{where} abilities[{i}]')

    def enemy_skills(env, found):
        """An enemy's skills (parse_unit `_enemySkills`) → {lower-case node name: skill entry}: a skill node the prefab
        has once per mode is one entry when the copies agree, else their uses joined with `mode` (the copy's mode name);
        `nodes` lists the copies' paths, `inModes` the modes holding them."""
        copies = {}
        for name, go, path, mname in found:
            copies.setdefault(name.lower(), []).append((go, path, mname))
        out = {}
        for key, cs in copies.items():
            entries = [(skill_entry(env, go, ekn, pk, effect_refs, templates), path, mname) for go, path, mname in cs]
            e0 = entries[0][0]
            if any(json.dumps(e['uses'], sort_keys=True) != json.dumps(e0['uses'], sort_keys=True) for e, _, _ in entries[1:]):
                uses = [{**x, 'mode': m} for e, _, m in entries for x in e['uses']]
                found_keys = set().union(*(e['effects'] for e, _, _ in entries))
                placed = {k for x in uses for k in list(x['keys']) + [y for y in x.get('slots') or [] if y]}
                e0 = {**e0, 'effects': sorted(found_keys | placed), 'uses': uses, 'roles': roles_of(uses),
                      'projectiles': sorted(set().union(*(e['projectiles'] for e, _, _ in entries))),
                      'unclassified': sorted(found_keys - placed)}
            e0['nodes'] = [p for _, p, _ in entries]
            if any(m for _, _, m in entries):
                e0['inModes'] = [m for _, _, m in entries]
            for p in e0['projectiles']:
                projectile(p)
            out[key] = e0
        return out

    # v3 (§33.17): the buff template actions that cast / stop an ability, by the ability's name
    by_ability = {}
    for tkey, t in templates.items():
        for ev, typ, name, kind in t.get('abilities') or []:
            if name:
                by_ability.setdefault(name, []).append((tkey, ev, typ, kind, None))

    def reach(start):
        """Template keys reachable from `start` through the templates' CreateBuff… actions."""
        seen, todo = set(), [k for k in start if isinstance(k, str) and k]
        while todo:
            k = todo.pop()
            if k not in seen:
                seen.add(k)
                todo.extend((templates.get(k) or {}).get('creates') or [])
        return seen

    def scalars(d):
        """A behaviour's scalar fields without the underscore (a toggle checker's settings)."""
        return {k.lstrip('_'): f6(v) if isinstance(v, float) else v for k, v in d.items()
                if k not in SKIP_FIELDS and not k.startswith('m_') and isinstance(v, (int, float, str)) and not isinstance(v, bool)}

    def own_entries(uid, u, env, roots, paths, own_tpls, own_named):
        """units[uid].talents and .abilities (v3, §33.17) from parse_unit's roots: one node_entry per root (its subtree
        without the other roots and the claimed nodes); the triggers are the actions of the buff templates related to
        the unit (reached from its prefab's and its skills' buffs, or named after its code) that name the root's
        GameObject or alias."""
        code = uid.split('_', 2)[2].lower() if uid.count('_') >= 2 else uid.lower()
        prefixes = (code, f'enemy_{code}')
        skill_tpls = {x.get('template') for s in u['skills'].values() for x in s.get('uses') or [] if x.get('template')}
        reachable = reach(set(own_tpls) | skill_tpls)

        def related(tkey):
            k = tkey.lower()
            return tkey in reachable or any(k == p or k.startswith((p + '_', p + '[')) for p in prefixes)
        by_bb = {}                      # generic templates' unnamed TriggerAbility: the name in the buff's blackboard
        for buff, tkey, name in list(own_named) + [x for sid in u['skills'] for x in skill_named.get(sid, [])]:
            for ev, typ, nm, kind in (templates.get(tkey) or {}).get('abilities') or []:
                if nm is None:
                    by_bb.setdefault(name, []).append((tkey, ev, typ, kind, buff))
        gk = lambda o: (id(o.assets_file), o.path_id)  # noqa: E731
        mode_names = [m.get('name') for m in u['modes']]
        mode_name = lambda i: mode_names[i] if isinstance(i, int) and not isinstance(i, bool) and 0 <= i < len(mode_names) else None  # noqa: E731
        built = []
        for r in roots:
            e = node_entry(env, r['go'], ekn, pk, effect_refs, templates, node_name=lambda go, nm: paths.get(gk(go), nm),
                           stop=lambda go, s=r['stop']: gk(go) in s)
            sw = e.pop('_switches')
            for p in e['projectiles']:
                projectile(p)
            talent = r['kind'] == 'talent'
            node = {'node': r['path'], 'class': r['talent'] if talent else r['ability']}
            if talent:
                node['ability'] = r['ability']
            if r.get('modes'):
                node['modes'] = r['modes']
            elif r.get('mode'):
                node['mode'] = r['mode']
            when = talent_when(r['talent'], r['ability'], r['classes']) if talent else ability_when(r['ability'], r['classes'])
            node['when'] = when
            tf = r.get('talentFields') or {}
            if tf.get('_overwriteTalentKey'):
                node['overwriteKey'] = tf['_overwriteTalentKey']
            if isinstance(tf.get('_checkValidBySkillIndex'), list) and tf['_checkValidBySkillIndex']:
                node['skills'] = list(tf['_checkValidBySkillIndex'])
            if when == 'reborn' and talent:
                node['reborn'] = {k: v for k, v in (
                    ('mode', mode_name(tf.get('_modeIndex'))), ('maxCount', tf.get('_maxRespawnCnt')),
                    ('hpRatio', f6(tf['_hpRechargeRatio']) if isinstance(tf.get('_hpRechargeRatio'), (int, float)) else None),
                    ('handler', tf.get('_abilityName') if tf.get('_useAbilityToHandle') and tf.get('_abilityName') else None)) if v is not None}
            if r['toggles']:
                node['toggle'] = [{'class': c, **scalars(d)} for c, d in r['toggles']]
            names = list(dict.fromkeys(x for x in (r['name'], r['alias']) if x))
            for kind, field in (('cast', 'triggers'), ('stop', 'stops')):
                acts = [{'template': t, 'event': ev, 'action': typ, 'name': name, **({'buff': buff} if buff else {})}
                        for name in names for t, ev, typ, k, buff in by_ability.get(name, []) + by_bb.get(name, [])
                        if k == kind and (buff or related(t))]
                if acts:
                    node[field] = list({json.dumps(a, sort_keys=True): a for a in acts}.values())
            if any(x['mode'] is not None for x in sw):
                node['switchMode'] = [{'mode': mode_name(x['mode']), 'restore': x['restore'], 'event': x['event'], 'buff': x['buff']}
                                      for x in sw if x['mode'] is not None]
            if r['alias'] and not talent and r['alias'] != r['name']:
                node['alias'] = r['alias']
            built.append((r, e, node))
        # a reborn talent's handler (its _abilityName: an ability's alias or name) acts on the 重生 too
        for r, e, node in built:
            h = (node.get('reborn') or {}).get('handler')
            for r2, e2, node2 in (built if h else []):
                if h in (r2['alias'], r2['name']):
                    node2['when'] = 'reborn'
                    node['reborn'].setdefault('handlerNode', r2['path'])
        talents = {}
        for r, e, node in sorted(built, key=lambda x: bool(x[0].get('mode'))):     # nodes outside the modes first
            if r['kind'] != 'talent':
                continue
            t = talents.setdefault(r['name'], {'nodes': [], 'uses': [], 'effects': set(), 'projectiles': set(),
                                               'unclassified': set(), 'abilities': [], '_sigs': {}})
            sig = json.dumps([{k: v for k, v in x.items() if k != 'node'} for x in e['uses']], sort_keys=True)
            same = t['_sigs'].get(sig) if r.get('mode') and e['uses'] else None
            if same is not None:              # a mode's copy of a talent that also sits outside the modes: listed once
                node['same'] = same
            else:
                if not r.get('mode'):
                    t['_sigs'].setdefault(sig, len(t['nodes']))
                t['uses'] += [{**x, **({'mode': r['mode']} if r.get('mode') else {})} for x in e['uses']]
                t['abilities'] += e['abilities']
            t['nodes'].append(node)
            t['effects'] |= set(e['effects'])
            t['projectiles'] |= set(e['projectiles'])
            t['unclassified'] |= set(e['unclassified'])
        out_t = {}
        enemy_keys = (gd.get('enemyTalentKeys') or {}).get(uid) or []
        for key, t in talents.items():
            if not (t['effects'] or t['projectiles']):
                continue
            placed = {k for x in t['uses'] for k in list(x['keys']) + [y for y in x.get('slots') or [] if y]}
            entry = {'nodes': t['nodes']}
            over = {n.get('overwriteKey', '').lower() for n in t['nodes']} - {''}
            bb = next((p for p in enemy_keys if p.lower() == key.lower() or p.lower() in over), None)
            if bb:
                entry['bb'] = bb
            entry.update({'effects': sorted(t['effects']), 'projectiles': sorted(t['projectiles']), 'uses': t['uses'],
                          'roles': roles_of(t['uses']), 'unclassified': sorted(t['unclassified'] - placed),
                          'abilities': t['abilities']})
            out_t[key] = entry
        out_a = []
        for r, e, node in built:
            if r['kind'] == 'talent' or not (e['effects'] or e['projectiles']):
                continue
            out_a.append({'kind': r['kind'], 'name': r['name'], **node,
                          **{k: e[k] for k in ('effects', 'projectiles', 'uses', 'roles', 'unclassified', 'abilities')}})
        return out_t, out_a

    # an enemy variant without a prefab of its own (the elite `_2` keys of six enemies) is drawn with its base prefab:
    # index.json gets a copy of the base unit with `aliasOf`
    aliases, ids = {}, []
    for uid in unit_ids:
        base = re.sub(r'_\d+$', '', uid)
        if uid.startswith('enemy_') and uid not in enemy_idx and base != uid and base in enemy_idx:
            aliases[uid] = base
            if base not in unit_ids and base not in ids:
                ids.append(base)
        elif uid not in ids:
            ids.append(uid)
    for uid in ids:
        env = AssetEnv(ab_root, cabs)                          # one environment per unit: chararts are large
        try:
            if uid.startswith('char_'):
                rel = f'charpack/{uid}.ab'
                u = parse_unit(env, rel, uid, 'char') if (Path(ab_root) / rel).exists() else None
            elif uid.startswith('enemy_'):
                rel = enemy_idx.get(uid)
                u = parse_unit(env, rel, uid, 'enemy') if rel else None
            else:
                rel = token_idx.get(uid)
                u = parse_unit(env, rel, uid, 'token') if rel else None
            if u is None:
                log(f'  skip (no prefab) {uid}')
                continue
            strings = u.pop('_strings')
            found_skills = u.pop('_enemySkills')
            for x in ('startEffect', 'deadEffect'):
                u[x] = ek(u[x]) if u[x] else None
            for m in u['modes']:
                for x in ('overrideStartEffect', 'overrideDeadEffect'):
                    m[x] = ek(m[x]) if m[x] else None
                for x in ('attack', 'combat'):
                    if m.get(x):
                        fix_attack(m[x], f'{uid} {m.get("name")} {x}')
            for gi, g in enumerate(u.get('charge') or []):
                for i, em in enumerate(g['emitters']):
                    fix_emitter(em, f'{uid} charge[{gi}] emitters[{i}]')
                for ai, ab in enumerate(g['abilities']):
                    for k in list(ab):
                        if k == 'emitters':
                            for i, em in enumerate(ab[k]):
                                fix_emitter(em, f'{uid} charge[{gi}] abilities[{ai}] emitters[{i}]')
                        elif k not in ('node', 'class', 'modes', 'mounts', 'mount', 'exMountNames'):
                            ab[k] = keyify(ab[k])
            for x in sorted(strings):
                if pk(x):
                    projectile(x)
            code = uid.split('_', 2)[2] if uid.startswith('char_') else None
            sids = set(gd['skills'].get(uid, [])) | set((gd.get('tokenSkills') or {}).get(uid, []))
            if code:
                sids |= {k for k in skill_roots if k.startswith(f'skchr_{code}_')}
            sids = {skill(sid) for sid in sorted(sids)} - {None}
            for sid in sids:                     # no mode in the skill's data: the unit's mode named after the skill
                m = re.match(r'skchr_.+_(\d+)$', sid)
                names = [str(x.get('name') or '').lower() for x in u['modes']]
                if sid in skills and skills[sid]['mode'] is None and m and f's{m.group(1)}' in names:
                    skills[sid]['mode'] = names.index(f's{m.group(1)}')
                    skills[sid]['modeBy'] = 'name'
            u['skills'] = {sid: skills[sid] for sid in sorted(sids) if sid in skills}
            # an enemy's own skills (their nodes in its prefab; keys like `1` repeat across enemies: not in index.skills)
            for key, entry in sorted(enemy_skills(env, found_skills).items()):
                u['skills'].setdefault(key, entry)
            # v3: its talents, common / general abilities and trait, our data's talent ids, its Spine-event effects
            roots, paths, own_tpls, own_named = u.pop('_roots'), u.pop('_paths'), u.pop('_templates'), u.pop('_named')
            tal, abl = own_entries(uid, u, env, roots, paths, own_tpls, own_named)
            if tal:
                u['talents'] = tal
            if abl:
                u['abilities'] = abl
            if (gd.get('talentKeys') or {}).get(uid):
                u['talentKeys'] = gd['talentKeys'][uid]
            if u.get('spineEffects'):
                u['spineEffects'] = fix_rows(u['spineEffects'], f'{uid} spineEffects')
                if not u['spineEffects']:
                    del u['spineEffects']
            u['projectiles'] = sorted({pk(x) for x in strings if pk(x) in projectiles})
            refs = set(effect_refs(strings))
            for p in u['projectiles']:
                refs.update(projectiles[p]['effects'])
            for s in list(u['skills'].values()) + list((u.get('talents') or {}).values()) + list(u.get('abilities') or []):
                refs.update(s['effects'])
                for p in s['projectiles']:
                    refs.update(projectiles.get(p, {}).get('effects', []))
            for e in u.get('spineEffects') or []:
                refs.update(row_keys(e))
            u['refs'] = sorted(refs)
            referenced |= refs
            if uid.startswith('char_'):
                arts = f'chararts/{uid}.ab'
                pts = skin_points(env, arts, 'defaultskin', u.get('graphic'), container=f'/{uid}/defaultskin.prefab') \
                    if (Path(ab_root) / arts).exists() else None
                src = f'{arts} defaultskin'
            else:
                pts, src = skin_points(env, rel, uid, None), f'{rel} {uid}'
            if pts:
                skins[uid] = {'source': src, 'graphic': u.get('graphic'), 'points': pts}
                u['skin'] = uid
            units[uid] = u
        except Exception as e:
            log(f'  FAIL unit {uid}: {e!r}')
    for uid, base in aliases.items():
        if base in units:
            units[uid] = {**units[base], 'aliasOf': base}
            log(f'  {uid}: no prefab of its own, drawn with {base} (aliasOf)')
        else:
            log(f'  skip (no prefab, nor its base {base}) {uid}')
    if skills:
        with_roles = [s for s, e in skills.items() if e['uses']]
        mode_only = [s for s, e in skills.items() if not e['uses'] and e['mode'] is not None]
        by_name = [s for s, e in skills.items() if e.get('modeBy') == 'name']
        none = [s for s, e in skills.items() if not e['uses'] and e['mode'] is None and not e['effects']]
        open_keys = {s: e['unclassified'] for s, e in skills.items() if e['unclassified']}
        log(f'fx: {len(skills)} skills: {len(with_roles)} with effect roles, {len(mode_only)} drawn by the mode they switch '
            f'to only, {len(none)} without effects; {len(open_keys)} name keys no role places; {len(by_name)} modes found by '
            f'name ({sum(1 for t in templates.values() if t["effect"] or t["graph"])} buff templates with effects)')
        for s, ks in sorted(open_keys.items()):
            log(f'  skill {s}: unclassified {", ".join(ks)}')
    own = [x for x in units.values() if not x.get('aliasOf')]
    for kind in ('char', 'enemy', 'token'):
        us = [x for x in own if x['kind'] == kind]
        tk = [t for x in us for t in (x.get('talents') or {}).values()]
        ab = [a for x in us for a in x.get('abilities') or []]
        whens = {}
        for n in [n for t in tk for n in t['nodes']] + ab:
            whens[n.get('when')] = whens.get(n.get('when'), 0) + 1
        log(f'fx: {kind}: talents of {sum(1 for x in us if x.get("talents"))} units ({len(tk)} keys, '
            f'{sum(len(t["nodes"]) for t in tk)} nodes), abilities of {sum(1 for x in us if x.get("abilities"))} units '
            f'({", ".join(f"{k} {sum(1 for a in ab if a["kind"] == k)}" for k in ("common", "general", "trait"))}); '
            f'when: {", ".join(f"{k} {v}" for k, v in sorted(whens.items(), key=lambda kv: str(kv[0])))}; '
            f'{sum(1 for n in [n for t in tk for n in t["nodes"]] + ab if n.get("triggers"))} with template triggers')
    for p in projectiles.values():
        referenced.update(p['effects'])
    return units, projectiles, skills, skins, referenced


# ---- the run ----------------------------------------------------------------------------------------------------------

def _export_worker(args, keys_all=None):
    """Export the prefabs `keys` of bundle `rel` (pool worker, or in-process with `keys_all`, every effect key):
    (entries, textures meta, meshes meta, log lines)."""
    if keys_all is not None:
        _init_worker(keys_all)
    ab_root, out_root, cabs, rel, keys = args
    lines = []
    env = AssetEnv(ab_root, cabs)
    ex = Exporter(env, out_root, lines.append)
    entries = {}
    try:
        roots = env.prefabs(rel)
        for k in keys:
            root = roots.get(k)
            if root is None:
                lines.append(f'  skip (not in {rel}) {k}')
                continue
            try:
                entries[k] = ex.prefab(k, root, rel)
            except Exception as e:
                lines.append(f'  FAIL {k}: {e!r}')
    except Exception as e:
        lines.append(f'  FAIL load {rel}: {e!r}')
    return entries, ex.textures, ex.meshes, lines


def game_data(root):
    """Operator ids (chess.json + backups.json units), the skill prefab ids per operator (its chess records' and its
    backups.json forms'), enemy keys, token ids and the skill ids of each token (token_skill_ids of its tokens.json /
    backups.json record)."""
    data = Path(root) / 'data'
    def load(n):
        try:
            return json.loads((data / n).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}
    chess, backups, enemies, tokens = load('chess.json'), load('backups.json'), load('enemies.json'), load('tokens.json')
    chars, skills = [], {}
    for v in chess.values():
        cid = v.get('charId')
        if not cid:
            continue
        if cid not in chars:
            chars.append(cid)
        for s in [v.get('skill')] + list(v.get('skills') or []):
            if isinstance(s, dict) and (s.get('prefabId') or s.get('skillId')):
                skills.setdefault(cid, set()).add(s.get('prefabId') or s.get('skillId'))
    for cid, u in (backups.get('units') or {}).items():
        if cid not in chars:
            chars.append(cid)
        for form in ((u or {}).get('forms') or {}).values():     # the 补位 / 自选 forms' skills (skcom_* among them)
            for s in (form or {}).get('skills') or []:
                if isinstance(s, dict) and (s.get('prefabId') or s.get('skillId')):
                    skills.setdefault(cid, set()).add(s.get('prefabId') or s.get('skillId'))
    toks = sorted(set(tokens) | set(backups.get('tokens') or {}))
    token_skills = {}
    for src in (backups.get('tokens') or {}, tokens):
        for tid, rec in src.items():
            ids = token_skill_ids(rec)
            if ids:
                token_skills[tid] = sorted(set(token_skills.get(tid, [])) | set(ids))
    excel = Path(root) / '.cache' / 'gamedata' / 'excel'
    def load_excel(n):
        try:
            return json.loads((excel / n).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}
    # Repository-owned JSON reader; installed plugin code is never imported or executed.
    try:
        ref_reader = Path(__file__).with_name('plugin-fx.mjs')
        refs = json.loads(subprocess.check_output(['node', str(ref_reader), str(root)], timeout=30))
    except (OSError, ValueError, subprocess.SubprocessError):
        refs = []
    char_table = load_excel('character_table.json')
    for cid in refs:
        if cid not in chars:
            chars.append(cid)
        # Shared skills do not always follow skchr_<codename>_<slot>.
        for skill_rec in (char_table.get(cid) or {}).get('skills') or []:
            sid = skill_rec.get('skillId') if isinstance(skill_rec, dict) else None
            if sid:
                skills.setdefault(cid, set()).add(sid)
    return {'chars': chars, 'skills': {k: sorted(v) for k, v in skills.items()}, 'enemies': sorted(enemies), 'tokens': toks,
            'tokenSkills': token_skills,
            'talentKeys': talent_keys(chars + toks, char_table,
                                      load_excel('battle_equip_table.json'), load_excel('uniequip_table.json')),
            'enemyTalentKeys': {k: enemy_talent_prefixes(v) for k, v in enemies.items() if isinstance(v, dict)}}


def talent_keys(ids, char_table, equip_table, uniequip_table):
    """Our data's talent ids → the units' talent prefab keys (v3, §33.17; operators and tokens): {id: {base: {talent
    index: [prefab keys]} (data/chess.json / data/tokens.json `talents[].index` — the official character_table's
    talents, whose candidates name their Talents/<prefabKey> node), trait?: [prefab keys] (the trait's: always on),
    modules?: {uniEquipId: {talent index: [prefab keys]}} (a module's talents — our data's `fromModule` talents, index
    −1 for a talent it adds)}} from the official tables (.cache/gamedata/excel; empty without them)."""
    owner = {}
    for eid, e in ((uniequip_table or {}).get('equipDict') or {}).items():
        if isinstance(e, dict) and e.get('charId'):
            owner.setdefault(e['charId'], []).append(eid)

    def keys_of(cands):
        return list(dict.fromkeys(str(x['prefabKey']) for x in cands or [] if isinstance(x, dict) and x.get('prefabKey') not in (None, '')))
    out = {}
    for uid in ids:
        c = (char_table or {}).get(uid)
        if not isinstance(c, dict):
            continue
        entry = {'base': {str(i): ks for i, t in enumerate(c.get('talents') or []) for ks in [keys_of((t or {}).get('candidates'))] if ks}}
        trait = keys_of(((c.get('trait') or {}).get('candidates')))
        if trait:
            entry['trait'] = trait
        mods = {}
        for eid in sorted(owner.get(uid, [])):
            for ph in ((equip_table or {}).get(eid) or {}).get('phases') or []:
                for part in ph.get('parts') or []:
                    if part.get('isToken'):
                        continue
                    for x in ((part.get('addOrOverrideTalentDataBundle') or {}).get('candidates') or []):
                        if x.get('prefabKey') in (None, ''):
                            continue
                        lst = mods.setdefault(eid, {}).setdefault(str(x.get('talentIndex')), [])
                        if str(x['prefabKey']) not in lst:
                            lst.append(str(x['prefabKey']))
        if mods:
            entry['modules'] = mods
        if entry['base'] or len(entry) > 1:
            out[uid] = entry
    return out


def enemy_talent_prefixes(rec):
    """The talent keys of an enemy record (data/enemies.json `talents.bb` / `bbStr`: "<talent key>.<blackboard key>"),
    as written, in first-seen order — the prefab's Talents/<key> node names, case aside (v3)."""
    out = []
    for src in ((rec.get('talents') or {}).get('bb') or {}, (rec.get('talents') or {}).get('bbStr') or {}):
        for k in src:
            if isinstance(k, str) and '.' in k and k.split('.', 1)[0] not in out:
                out.append(k.split('.', 1)[0])
    return out


def client_version(ab_root):
    try:
        return json.loads((Path(ab_root) / 'hot_update_list.json').read_text(encoding='utf-8')).get('versionId')
    except (OSError, ValueError):
        return None


def _read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def export_fx(ab_root, out_root, manifest, log, selection='sample', keys=None, jobs=None, root=None, fx_manifest=None):
    """The fx run (extract.py --only fx): writes <out_root>/fx/** and `fx_manifest` (default <root>/data/local-fx.json:
    the groups FX_GROUPS, every file); returns the number of files written. `manifest` (the groups of
    data/local-assets.json) gets nothing: extract.py drops the fx groups an earlier run left there (ran_groups). A
    --fx-keys run (`keys`) updates those prefabs in the earlier set's index and file list."""
    t_start = time.time()
    ab_root = Path(ab_root)
    root = Path(root) if root else Path(__file__).resolve().parents[2]
    fx_manifest = Path(fx_manifest) if fx_manifest else root / 'data' / FX_MANIFEST
    jobs = max(1, jobs or min(8, os.cpu_count() or 2))
    out = Path(out_root) / FX_SUB
    out.mkdir(parents=True, exist_ok=True)
    timings = {}

    t0 = time.time()
    cabs = scan_cabs(ab_root)
    eff = container_index(ab_root, EFFECT_GLOBS, root / '.cache/fx/effects.json', jobs, log)
    timings['index'] = time.time() - t0
    log(f'fx: {len(eff)} effect prefabs in the client ({client_version(ab_root)}), {len(cabs)} bundle CABs scanned')

    t0 = time.time()
    gd = game_data(root)
    if keys:
        unit_ids = []
    elif selection == 'sample':
        unit_ids = list(FX_SAMPLE_UNITS)
    else:
        unit_ids = gd['chars'] + gd['enemies'] + gd['tokens']
    enemy_idx = container_index(ab_root, (ENEMY_GLOB,), root / '.cache/fx/enemies.json', jobs, log) \
        if any(u.startswith('enemy_') for u in unit_ids) else {}
    token_idx = container_index(ab_root, (TOKEN_GLOB,), root / '.cache/fx/tokens.json', jobs, log) \
        if any(not u.startswith(('char_', 'enemy_')) for u in unit_ids) else {}
    units, projectiles, skills, skins, referenced = crawl_units(ab_root, cabs, unit_ids, gd, eff, enemy_idx, token_idx, log)
    timings['units'] = time.time() - t0

    generic = {v for group in FX_GENERIC.values() for v in group.values()}
    generic |= {k for k, rel in eff.items() if rel in FX_GENERIC_BUNDLES}
    if keys:
        wanted = set(keys)
    else:                         # the used set holds the sample too (a full run never drops a key a sample has)
        wanted = set(FX_SAMPLE_KEYS) | set(FX_COVERAGE_KEYS) | referenced | generic
    missing = sorted(k for k in wanted if k not in eff)
    for k in missing:
        log(f'  skip (no such effect prefab in this client) {k}')
    wanted -= set(missing)

    # -- descriptors, textures, meshes; then the keys the exported behaviours name (variants by facing, chained
    #    effects), until nothing new is named
    t0 = time.time()
    entries, textures, meshes, done = {}, {}, {}, set()
    todo, rounds = set(wanted), 0
    with ProcessPoolExecutor(max_workers=jobs, initializer=_init_worker, initargs=(tuple(eff),)) as pool:
        while todo and rounds < 6:
            rounds += 1
            by_bundle = {}
            for k in sorted(todo):
                by_bundle.setdefault(eff[k], []).append(k)
            log(f'fx: pass {rounds}: exporting {len(todo)} prefabs from {len(by_bundle)} bundles ({jobs} processes)')
            work = [(str(ab_root), str(out_root), cabs, rel, ks) for rel, ks in sorted(by_bundle.items(), key=lambda kv: -len(kv[1]))]
            results = list(pool.map(_export_worker, work)) if jobs > 1 and len(work) > 1 else [_export_worker(w, tuple(eff)) for w in work]
            done |= todo
            for e, tx, me, lines in results:
                entries.update(e)
                textures.update(tx)
                meshes.update(me)
                for line in lines:
                    log(line)
            named = {r for e in entries.values() for r in e.get('refs', [])}
            todo = {k for k in named if k in eff and k not in done}
    timings['prefabs'] = time.time() - t0

    summaries = {k: {f: v[f] for f in ('file', 'bundle', 'nodes', 'particleSystems', 'liveParticles', 'duration', 'looping', 'refs',
                                       'spawn', 'follow') if f in v}
                 for k, v in entries.items()}
    url = lambda rel: f'/assets/local/{FX_SUB}/{rel}'  # noqa: E731
    groups = {
        'fx/prefabs': {k: {'path': url(v['file']), 'kind': 'FxPrefab'} for k, v in entries.items()},
        'fx/tex': {k: {'path': url(v['file']), 'w': v['w'], 'h': v['h'], 'kind': 'Texture2D',
                       **({'half': url(v['half'])} if v.get('half') else {})} for k, v in textures.items()},
        'fx/mesh': {k: {'path': url(v['file']), 'kind': 'FxMesh', 'verts': v['verts']} for k, v in meshes.items()},
    }
    tex_all, set_name = dict(textures), 'keys' if keys else selection
    prev = _read_json(out / 'index.json') if keys else None
    if isinstance(prev, dict) and prev.get('format') == 'fx-index' and prev.get('version') == INDEX_VERSION:
        # a --fx-keys run: these prefabs replace their earlier copies; the earlier set's units, skills, prefabs stay
        units, projectiles, skills, skins = (prev.get(x) or {} for x in ('units', 'projectiles', 'skills', 'skins'))
        summaries = {**(prev.get('prefabs') or {}), **summaries}
        tex_all = {**((_read_json(out / 'textures.json') or {}).get('textures') or {}), **textures}
        old_groups = (_read_json(fx_manifest) or {}).get('groups') or {}
        groups = {g: {**(old_groups.get(g) or {}), **v} for g, v in groups.items()}
        set_name = prev.get('set') or set_name
    groups = {'fx': {'index': {'path': url('index.json'), 'kind': 'FxIndex', 'version': INDEX_VERSION, 'set': set_name,
                               'prefabs': len(summaries)},
                     'textures': {'path': url('textures.json'), 'kind': 'FxTextures', 'count': len(tex_all)}},
              **{g: dict(sorted(v.items())) for g, v in groups.items()}}
    index = {
        'format': 'fx-index', 'version': INDEX_VERSION, 'set': set_name,
        'source': {'root': ab_root.name, 'client': client_version(ab_root)},
        'units': units, 'projectiles': projectiles, 'skills': skills, 'skins': skins,
        'generic': {**FX_GENERIC, 'keys': sorted(k for k in generic if k in summaries)},
        'prefabs': dict(sorted(summaries.items())),
    }
    write_atomic(out / 'index.json', json.dumps(index, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    write_atomic(out / 'textures.json', json.dumps({'format': 'fx-textures', 'version': FORMAT_VERSION,
                                                   'textures': dict(sorted(tex_all.items()))}, separators=(',', ':')).encode('utf-8'))
    count = sum(len(v) for v in groups.values())
    write_atomic(fx_manifest, json.dumps({'version': MANIFEST_VERSION, 'format': 'fx-manifest', 'source': 'local-client',
                                          'client': client_version(ab_root), 'set': set_name, 'count': count,
                                          'groups': groups}, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    total = 3 + len(entries) + len(meshes) + sum(1 + (1 if v.get('half') else 0) for v in textures.values())
    if not keys:                                              # a full set: drop files an earlier run left behind
        keep = {out / 'index.json', out / 'textures.json'} | {out / v['file'] for v in entries.values()}
        keep |= {out / v['file'] for v in meshes.values()} | {out / v['file'] for v in textures.values()}
        keep |= {out / v['half'] for v in textures.values() if v.get('half')}
        stale = [q for d in ('prefabs', 'tex', 'mesh') for q in (out / d).rglob('*') if q.is_file() and q not in keep]
        for q in stale:
            q.unlink()
        if stale:
            log(f'  removed {len(stale)} files of an earlier run')
    timings['total'] = time.time() - t_start
    size = sum(p.stat().st_size for p in out.rglob('*') if p.is_file() and not p.name.startswith('.'))
    log(f'fx: {len(entries)} prefabs, {len(textures)} textures, {len(meshes)} meshes, {len(units)} units, '
        f'{len(projectiles)} projectiles, {len(skills)} skills → {out} ({size / 1e6:.1f} MB), {fx_manifest} '
        f'({count} entries, {fx_manifest.stat().st_size / 1e6:.2f} MB); '
        + ', '.join(f'{k} {v:.1f}s' for k, v in timings.items()))
    return total


if __name__ == '__main__':
    print('run through tools/local-extract/extract.py --only fx (see the module docstring)', file=sys.stderr)
    sys.exit(2)

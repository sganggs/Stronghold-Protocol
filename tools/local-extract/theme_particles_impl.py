"""Extract ParticleSystem emission/bursts data for the shop prefabs (panel/money/card).

Reuses the same UnityPy typetree approach as Stronghold-Protocol tools/local-extract/fx.py
(PS_MODULES / enc_value); fx.est_live is used only as a cross-check on the encoded modules.

Outputs (all paths are chosen by the caller, never built in):
  BUNDLES: {'theme': <theme bundle>, 'battle': <battle bundle>}
  OUT_JSON: this run's _particles.json
  THEME: the extracted theme pack whose shop.json / card.json get the additive fields
  BACKUP: where the documents are backed up before they are patched
"""
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aklz4  # noqa: F401
import UnityPy
import fx

# theme_particles.enrich_theme sets these before main(); there is no built-in client path, so a direct run refuses
# instead of reading a directory that only one machine has.
BUNDLES = {}
OUT_JSON = None
THEME = None
BACKUP = None
PREFABS = {
    "panel_shop_main": ("theme", 7432215050684510296),
    "autochess_main_money_item": ("battle", -1588087679666565701),
    "autochess_shop_card_item": ("theme", 1483944088778644771),
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def curve_keys(c):
    out = []
    for k in ((c or {}).get("m_Curve") or []):
        out.append([round(k.get("time", 0), 6), round(k.get("value", 0), 6)])
    return out


def mmc(c, as_count=False):
    if not isinstance(c, dict):
        return {"mode": "constant", "constant": c}
    state = c.get("minMaxState", 0)
    scalar = c.get("scalar")
    min_scalar = c.get("minScalar")
    res = {"raw": {"minMaxState": state, "scalar": scalar, "minScalar": min_scalar},
           "maxCurve": curve_keys(c.get("maxCurve")),
           "minCurve": curve_keys(c.get("minCurve"))}
    if state == 0:  # constant
        res["mode"] = "constant"
        res["value"] = scalar
    elif state == 3:  # two constants
        res["mode"] = "two-constants"
        lo, hi = sorted([min_scalar or 0, scalar or 0])
        res["min"], res["max"] = lo, hi
        res["value"] = hi
    else:  # curves
        res["mode"] = "curve" if state in (1, 2) else "curve-%d" % state
        res["value"] = scalar
    if as_count:
        v = res.get("value")
        res["count"] = int(round(v)) if isinstance(v, (int, float)) else None
        if "min" in res:
            res["countMin"] = int(round(res["min"]))
            res["countMax"] = int(round(res["max"]))
    return res


def material_info(env, by_id, pptr):
    """Material name + first _MainTex texture name for a renderer PPtr."""
    o = by_id.get(pptr.get("m_PathID"))
    if not o:
        return None
    try:
        mt = o.read_typetree()
    except Exception:
        return {"name": getattr(o.read(), "m_Name", None)}
    name = mt.get("m_Name")
    tex = None
    for prop in ((mt.get("m_SavedProperties") or {}).get("m_TexEnvs") or []):
        if isinstance(prop, (list, tuple)) and len(prop) == 2:
            key, val = prop
        elif isinstance(prop, dict):
            key = prop.get("first") or prop.get("name")
            val = prop.get("second")
        else:
            continue
        if key == "_MainTex" and isinstance(val, dict):
            to = by_id.get((val.get("m_Texture") or {}).get("m_PathID"))
            if to:
                try:
                    tex = to.read().m_Name
                except Exception:
                    tex = None
        break
    return {"name": name, "mainTexture": tex}


def walk(env, by_id, go_obj, path, out):
    d = go_obj.read()
    full = (path + "/" + d.m_Name) if path else d.m_Name
    tt = go_obj.read_typetree()
    children = []
    renderer = None
    for comp in tt.get("m_Component") or []:
        ptr = comp.get("component") or comp
        pid = ptr.get("m_PathID") if isinstance(ptr, dict) else None
        o = by_id.get(pid)
        if not o:
            continue
        t = o.type.name
        if t == "ParticleSystem":
            ps = o.read_typetree()
            em = ps.get("EmissionModule") or {}
            im = ps.get("InitialModule") or {}
            enc = {"path": full, "pathId": pid, "name": d.m_Name,
                   "emission": {
                       "enabled": bool(em.get("enabled", False)),
                       "rateOverTime": mmc(em.get("rateOverTime")),
                       "rateOverDistance": mmc(em.get("rateOverDistance")),
                       "burstCount": em.get("m_BurstCount"),
                       "bursts": [{
                           "time": b.get("time"),
                           "countCurve": mmc(b.get("countCurve"), as_count=True),
                           "cycleCount": b.get("cycleCount"),
                           "repeatInterval": b.get("repeatInterval"),
                           "probability": b.get("probability"),
                       } for b in (em.get("m_Bursts") or [])],
                   },
                   "main": {
                       "duration": ps.get("lengthInSec"),
                       "looping": ps.get("looping"),
                       "prewarm": ps.get("prewarm"),
                       "playOnAwake": ps.get("playOnAwake"),
                       "simulationSpeed": ps.get("simulationSpeed"),
                       "maxNumParticles": im.get("maxNumParticles"),
                       "startLifetime": im.get("startLifetime"),
                       "startSize": im.get("startSize"),
                       "startSpeed": im.get("startSpeed"),
                   },
                   "modules": {m: ps[m] for m in fx.PS_MODULES
                               if isinstance(ps.get(m), dict) and (ps[m].get("enabled") or m == "InitialModule")},
                   }
            def top_mmc(c):
                if isinstance(c, (int, float)):
                    return abs(c)
                if not isinstance(c, dict):
                    return 0.0
                st = c.get("minMaxState", 0)
                sc = c.get("scalar") or 0
                mn = c.get("minScalar") or 0
                if st == 0:
                    return abs(sc)
                if st == 3:
                    return max(abs(sc), abs(mn))
                vals = [abs(k.get("value") or 0) for k in ((c.get("maxCurve") or {}).get("m_Curve") or [])]
                return abs(sc) * max(vals or [0])
            life = top_mmc(im.get("startLifetime", 0))
            dur = ps.get("lengthInSec") or 1
            rate = top_mmc(em.get("rateOverTime", 0))
            burst_total = 0.0
            for b in em.get("m_Bursts") or []:
                cc = b.get("countCurve") or {}
                cnt = abs(cc.get("scalar") or 0) if isinstance(cc, dict) else abs(cc or 0)
                burst_total += cnt * max(1, b.get("cycleCount") or 1)
            span = life if ps.get("looping") else min(life, dur)
            if not em.get("enabled", False):
                est = 0.0
            elif ps.get("looping"):
                est = rate * span + burst_total * min(1.0, life / max(dur, 1e-3))
            else:
                est = rate * span + burst_total
            enc["estimatedLive"] = round(min(float(im.get("maxNumParticles") or 1000), est), 4)
            out.append(enc)
        if t == "ParticleSystemRenderer":
            r = o.read_typetree()
            rid = pid
            mats = []
            for mp in r.get("m_Materials") or []:
                mi = material_info(env, by_id, mp)
                if mi:
                    mats.append(mi)
            renderer = {
                "pathId": rid,
                "renderMode": fx.enum_name(fx.RENDER_MODES, r.get("m_RenderMode")),
                "renderAlignment": fx.enum_name(fx.RENDER_ALIGN, r.get("m_RenderAlignment")),
                "sortMode": r.get("m_SortMode"),
                "minParticleSize": r.get("m_MinParticleSize"),
                "maxParticleSize": r.get("m_MaxParticleSize"),
                "lengthScale": r.get("m_LengthScale"),
                "materials": mats,
            }
        if t in ("RectTransform", "Transform"):
            rt = o.read_typetree()
            for ch in rt.get("m_Children") or []:
                ctr = by_id.get(ch.get("m_PathID"))
                if not ctr:
                    continue
                ctt = ctr.read_typetree()
                g = by_id.get((ctt.get("m_GameObject") or {}).get("m_PathID"))
                if g and g.type.name == "GameObject":
                    children.append(g)
    if renderer is not None:
        for rec in reversed(out):
            if rec["path"] == full:
                rec["renderer"] = renderer
                break
    for child in children:
        walk(env, by_id, child, full, out)


def main():
    if not BUNDLES or not OUT_JSON or not THEME or not BACKUP:
        raise SystemExit('theme_particles_impl needs a caller to set BUNDLES, OUT_JSON, THEME and BACKUP '
                         '(theme_particles.enrich_theme sets them); the module has no built-in client paths')
    os.makedirs(BACKUP, exist_ok=True)
    envs = {}
    out = {"generatedBy": "_tools/extract_shop_particles.py",
           "sourceBundles": {}, "prefabs": {}}
    for label, path in BUNDLES.items():
        env = UnityPy.load(path)
        envs[label] = (env, {o.path_id: o for o in env.objects})
        out["sourceBundles"][label] = {"path": path, "size": os.path.getsize(path), "sha256": sha256(path)}
    for name, (label, root_id) in PREFABS.items():
        env, by_id = envs[label]
        root = by_id.get(root_id)
        if not root:
            out["prefabs"][name] = {"pathID": root_id, "error": "root GameObject not found in bundle"}
            continue
        systems = []
        walk(env, by_id, root, "", systems)
        out["prefabs"][name] = {
            "bundle": label,
            "pathID": root_id,
            "systems": systems,
            "byPath": {s["path"]: s["pathId"] for s in systems},
        }
        print(name, "systems", len(systems))
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print("wrote", OUT_JSON)

    # ---- additive enrichment of the extracted theme JSONs (backup first)
    by_prefix = {}
    for name, (label, root_id) in PREFABS.items():
        by_prefix[name] = {s["path"]: s for s in out["prefabs"][name]["systems"]}
    for fname, prefabs in (("shop.json", ["panel_shop_main", "autochess_main_money_item"]),
                           ("card.json", ["autochess_shop_card_item"])):
        p = os.path.join(THEME, fname)
        doc = json.load(open(p, encoding="utf-8"))
        if os.path.isfile(p) and not os.path.isfile(os.path.join(BACKUP, fname + ".bak")):
            import shutil
            shutil.copyfile(p, os.path.join(BACKUP, fname + ".bak"))
        changed = 0
        lists = []
        if isinstance(doc.get("particles"), list):
            lists.append((doc.get("root", {}).get("name") or doc.get("prefab"), doc["particles"]))
        if isinstance(doc.get("prefabs"), dict):
            for k, v in doc["prefabs"].items():
                if isinstance(v, dict) and isinstance(v.get("particles"), list):
                    lists.append((k, v["particles"]))
        def walk_doc(n):
            yield n
            for c in n.get("children") or []:
                yield from walk_doc(c)
        if isinstance(doc.get("root"), dict):
            for node in walk_doc(doc["root"]):
                if isinstance(node.get("particles"), list):
                    lists.append((doc["root"].get("name"), node["particles"]))
        for prefab_name, entries in lists:
            table = by_prefix.get(prefab_name, {})
            for comp in entries:
                s = table.get(comp.get("path"))
                if not s:
                    continue
                if "pathId" not in comp:
                    comp["pathId"] = s["pathId"]
                    changed += 1
                comp.setdefault("modules", {})["emission"] = s["emission"]
        json.dump(doc, open(p, "w", encoding="utf-8", newline="\n"), indent=1, ensure_ascii=False)
        print("patched", p, "changed entries", changed)


if __name__ == "__main__":
    # Direct runs go through theme_particles.py (it sets BUNDLES/OUT_JSON/THEME/BACKUP); a bare run refuses in main().
    main()

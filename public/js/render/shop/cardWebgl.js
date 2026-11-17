























import { buildRecords as buildRecordSet, cardSize, propagateTransforms, relayoutAnimatedSizes } from './cardRecords.js';
import { create as createStage, fontMetrics as stageFontMetrics, sliceQuads as stageSliceQuads, UNITY_FONT_METRICS } from './cardStage.js';


export function normalizeDraw(draw) {
  const d = draw || {};
  const dst = Number.isFinite(Number(d.dst)) ? Number(d.dst) : d.blend === 'add' ? 1 : 10;
  const blend = Number.isFinite(Number(d.blend)) ? Number(d.blend) : d.blend === 'add' ? 'add' : d.blend === 'alpha' ? 'alpha' : dst === 1 ? 'add' : 'alpha';
  return {
    tint: d.tint || '#FFFFFF',
    blend,
    dst,
    intensity: Number.isFinite(Number(d.intensity)) ? Number(d.intensity) : 1,
    colIntensity: Number.isFinite(Number(d.colIntensity)) ? Number(d.colIntensity) : 1,
    channel: Number.isFinite(Number(d.channel)) ? Number(d.channel) : 0,
    rgbCtrl: !!d.rgbCtrl,
    base: d.base || null,
    baseFile: d.baseFile || null,
    tile: Array.isArray(d.tile) ? d.tile : [1, 1],
    offset: Array.isArray(d.offset) ? d.offset : [0, 0],
    speed: Array.isArray(d.speed) ? d.speed : [0, 0],
    mask: d.mask || null,
    maskFile: d.maskFile || null,
    maskTile: Array.isArray(d.maskTile) ? d.maskTile : [1, 1],
    maskOffset: Array.isArray(d.maskOffset) ? d.maskOffset : [0, 0],
    maskInvert: !!d.maskInvert,
    dissolve: d.dissolve || null,
    alphaClip: !!d.alphaClip,
  };
}


export function sliceQuads(image, box, unit) {
  const sl = Array.isArray(image?.slice) ? image.slice : null;
  if (!sl || sl.length !== 4) return null;
  const [top, right, bottom, left] = sl.map(Number);
  return stageSliceQuads({ top, right, bottom, left, spriteW: Number(image.w) || 0, spriteH: Number(image.h) || 0 },
    box?.x ?? 0, box?.y ?? 0, box?.w ?? 0, box?.h ?? 0, Number(unit) || 1);
}


export function stencilSteps(stencil) {
  if (!stencil) return [];
  if (stencil.mode === 'write') {
    return [{ test: 'always', op: 'replace', writeMask: true, colorWrite: false }, { writeMask: true, colorWrite: true }];
  }
  const steps = [{ test: 'equal', op: 'keep', writeMask: false, colorWrite: true }];
  if (stencil.clean) steps.push({ clean: true });
  return steps;
}


export function fontMetrics(family, px, measure) {
  const probe = typeof measure === 'function' ? { measureText: measure } : measure;
  const fallback = { measureText: () => ({ width: 0 }) };
  return stageFontMetrics(family, px, probe || fallback);
}

export { UNITY_FONT_METRICS };


export function buildRecords(card, pack, opts = {}) {
  const doc = card && card.root ? card : { root: card };
  void pack;
  if (opts.pose && opts.pose.active instanceof Map) {
    for (const [node, value] of opts.pose.active) if (node) node.active = !!value;
  }
  const built = buildRecordSet(doc.root, doc, { size: opts.size || (Array.isArray(doc.size) ? doc.size : null) });



  const unit = Number(opts.unit) > 0 ? Number(opts.unit) : 1;
  const pad = Array.isArray(opts.pad) ? opts.pad : [0, 0];
  relayoutAnimatedSizes(built, doc);
  propagateTransforms(built);
  const boxes = new Map();
  for (const rec of built.order) {
    const delta = rec.delta || { x: 0, y: 0 };
    const box = {
      x: (rec.abs.x + delta.x) * unit + (Number(pad[0]) || 0),
      y: (rec.abs.y + delta.y) * unit + (Number(pad[1]) || 0),
      w: rec.abs.w * unit,
      h: rec.abs.h * unit,
    };
    const alpha = (rec.inheritAlpha == null ? 1 : rec.inheritAlpha) * (rec.pose && rec.pose.alpha != null ? rec.pose.alpha : 1);
    rec.box = box;
    rec.alpha = alpha;
    boxes.set(rec.node.path || rec.node.name, { ...box, alpha, shown: rec.active });
  }



  const draws = built.order.filter((rec) => rec.active && rec.alpha > 0 && drawsShape(rec.node, doc));
  if (!opts.only?.length && !opts.skip?.length) return { ...built, records: draws, boxes };
  const order = draws.filter((rec) => (!opts.only?.length || opts.only.includes(rec.node.name)) && !opts.skip?.includes(rec.node.name));
  return { ...built, order, records: order, boxes };
}


export function roleBoxes(doc, built) {
  const out = new Map();
  const boxes = built && built.boxes;
  if (!boxes) return out;
  for (const [role, id] of Object.entries((doc && doc.roles) || {})) {
    const path = doc.ids && doc.ids[id];
    const box = path && boxes.get(path);
    if (box) out.set(role, { role, path, x: box.x, y: box.y, w: box.w, h: box.h });
  }
  return out;
}


function drawsShape(node, card) {
  if (!node) return false;
  if (node.text) return String(node.text.text || '').length > 0;
  const image = node.image || null;
  const key = (node.raw && node.raw.mat) || (image && (image.mat || (image.material && image.material.name))) || null;
  if (key) {
    const known = (card.materials && card.materials[key])
      || Object.values(card.sub || {}).some((sub) => sub.materials && sub.materials[key]);
    if (known) return true;
  }
  if (!image || !(image.file || image.color)) return false;

  return !(image.external || (image.sprite && !image.file));
}


export function createCardRenderer({ canvas, card = null, view = null, pad = null, search = '', particles = null, resolveUrl = null, cardTime = null, cardStill = null, particleTime = null, onError = null, debugStats = false }) {
  const pads = { left: 4, right: 4, top: 6, bottom: 1, ...(pad || {}) };
  const [cardW, cardH] = cardSize(card || {});
  let forcedTime = null;
  let current = [];



  const stageCard = { ...(card || {}), size: [cardW, cardH] };
  const hostView = {
    order: () => (view && typeof view.order === 'function' ? view.order() : current),
    get mounted() { return (view && view.mounted) || null; },
  };
  const stage = createStage(canvas, stageCard, hostView, {
    particles,
    search,
    debugStats,
    resolveUrl,
    cardTime: () => (forcedTime != null ? forcedTime : (cardTime ? cardTime() : null)),
    cardStill,
    particleTime,
    onError: onError || ((message) => { canvas.dataset.stageError = message; }),
  });
  if (!stage) throw new Error('WebGL2 is not available');


  const resize = (widthCss, w = cardW, h = cardH, ratio = 1) => {
    const baseW = Number(w) || cardW;
    const baseH = Number(h) || cardH;
    stageCard.size = [baseW, baseH];
    const gridW = baseW + pads.left + pads.right;
    const unitCss = widthCss / gridW;
    stage.resize(widthCss, (baseH + pads.top + pads.bottom) * unitCss, ratio, pads);
  };
  return {
    gl: stage.gl,
    stage,
    resize,
    
    pad: () => [stage.metrics.padPx.left, stage.metrics.padPx.top],
    
    unit: () => stage.metrics.unitPx,
    
    get textures() { return stage.textures; },
    texture: (url) => stage.textures.get(url) || null,
    /**
     * Draw the current records. `time === null` clears the pinned card clock (the live path from
     * ShopScene.paint), a finite number pins it (still / dev scrub), and `undefined` leaves it as is.
     */
    draw(records, time) {
      if (Array.isArray(records)) current = records;
      if (time === null) forcedTime = null;
      else if (time !== undefined && Number.isFinite(Number(time))) forcedTime = Number(time);
      stage.draw(0);
    },
    setForcedTime(time) {
      forcedTime = time == null ? null : Number(time);
      return forcedTime;
    },
    clearForcedTime() { forcedTime = null; },
    
    drawParticles() { return 0; },
    destroy() { stage.destroy(); },
    get lost() { return !!stage.lost; },
    get destroyed() { return !!stage.destroyed; },
  };
}





















export function priceColour(price, srcPrice) {
  const p = Number(price);
  const s = Number(srcPrice);
  if (!Number.isFinite(p) || !Number.isFinite(s) || s === p) return '#FFC600';
  return p < s ? '#59F4CA' : '#FF5454';
}


function contentNode(root, name) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (node.name === name) return node;
    for (const child of node.children || []) stack.push(child);
  }
  return null;
}


function cloneNode(node) {
  return typeof structuredClone === 'function' ? structuredClone(node) : JSON.parse(JSON.stringify(node));
}


function applyCostFace(costRoot, model) {
  const price = String(model.price);
  const coin = Number.isFinite(Number(model.coin)) ? Number(model.coin) : Number(model.price);
  const normal = contentNode(costRoot, 'root_normal');
  const grey = contentNode(costRoot, 'root_grey');
  const enough = Number(model.price) <= coin;
  if (normal) normal.active = enough;
  if (grey) grey.active = !enough;
  const normalText = normal && contentNode(normal, 'text_num');
  if (normalText) {
    normalText.text = { ...(normalText.text || {}), text: price, color: priceColour(model.price, model.srcPrice) };
  }
  const greyText = grey && contentNode(grey, 'text_num');
  if (greyText) greyText.text = { ...(greyText.text || {}), text: price };
}


export function fillCardContent(card, model = {}, options = {}) {
  const root = card && card.root;
  if (!root) return card;
  const subs = (card && card.sub) || {};
  const model2 = model || {};

  if (model2.portraitUrl) {
    const portrait = contentNode(root, 'char_portrait');




    if (portrait) {
      portrait.image = { type: 'simple', color: '#FFFFFF', file: model2.portraitUrl, sprite: 'char_portrait', w: 180, h: 360 };
    }
  }

  if (model2.name != null && String(model2.name).length) {
    const name = contentNode(root, 'char_name');
    if (name) {
      name.text = {
        ...(name.text || {}),
        text: String(model2.name),
        color: model2.nameColour || (name.text && name.text.color) || '#000000',
        fontSize: 16, bestFit: true, minSize: 1, maxSize: 16, align: 3, font: 'NotoSansHans-Medium',
      };
    }
  }

  const profession = contentNode(root, 'prof_icon');
  if (profession) {

    profession.active = !!model2.professionUrl;
    if (model2.professionUrl) profession.image = { ...(profession.image || {}), file: model2.professionUrl };
  }

  const garrison = contentNode(root, 'garrison_icon');
  if (garrison) {
    const icon = model2.garrison && model2.garrison.url;
    garrison.active = !!icon;
    if (icon) {


      garrison.image = {
        ...(garrison.image || {}),
        file: model2.garrison.url,
        sprite: model2.garrison.sprite || 'garrison_icon',
        color: model2.garrison.colour || (garrison.image && garrison.image.color) || '#FFFFFF',
      };
    }
  }

  const square = contentNode(root, 'square_fx');
  if (square) {
    const shown = model2.difficulty != null && !!model2.difficultyUrl;
    square.active = shown;
    if (shown) square.image = { ...(square.image || {}), file: model2.difficultyUrl };
  }

  const costHolder = contentNode(root, 'root_cost');
  const costView = subs.cost_view;
  if (costHolder && costView && costView.root && model2.price != null) {
    const costRoot = cloneNode(costView.root);
    costHolder.children = [costRoot];
    applyCostFace(costRoot, model2);
  }

  const bondList = contentNode(root, 'bond_list');
  const rowTemplate = subs.bond_item && subs.bond_item.root;
  if (bondList && rowTemplate) {
    const rows = (Array.isArray(model2.bonds) ? model2.bonds : []).filter(Boolean).slice(0, options.bondRows || 3);




    const rowH = Number(rowTemplate.rect?.sizeDelta?.[1]) || 18;
    const rowW = Number(rowTemplate.rect?.sizeDelta?.[0]) || 154;
    const containerH = Number(bondList.rect?.sizeDelta?.[1]) || 58;
    const blockH = rows.length * rowH;
    const startY = Math.max(0, containerH - blockH);
    bondList.children = rows.map((bond, index) => {
      const row = cloneNode(rowTemplate);
      row.name = `${rowTemplate.name}_${index}`;
      row.rect = {
        anchors: { min: [0, 1], max: [0, 1] },
        pivot: [0, 1],
        sizeDelta: [rowW, rowH],
        anchoredPosition: [4, -(startY + index * rowH)],
      };
      const icon = contentNode(row, 'icon');
      if (icon) {
        icon.active = !!bond.iconUrl;
        if (bond.iconUrl) icon.image = { ...(icon.image || {}), file: bond.iconUrl, sprite: bond.iconId || 'bond_icon' };
      }
      const txt = contentNode(row, 'txt');
      if (txt) {
        txt.text = {
          ...(txt.text || {}),
          text: bond.name == null ? '' : String(bond.name),
          color: model2.bondColour || (txt.text && txt.text.color) || '#000000',
        };
      }
      return row;
    });
  }

  return card;
}


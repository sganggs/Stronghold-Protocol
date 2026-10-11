/** Apply a manual view's zoom and pan relative to its old preset to a new viewport's preset. **/
export function preserveCameraOffset(camera, previousPreset, nextPreset) {
  const viewportRatio = nextPreset.scale / previousPreset.scale;
  nextPreset.cx += (camera.cx - previousPreset.cx) * viewportRatio;
  nextPreset.cy += (camera.cy - previousPreset.cy) * viewportRatio;
  nextPreset.scale *= camera.scale / previousPreset.scale;
  nextPreset.update();
  return nextPreset;
}

/** Own manual camera state while the field view supplies its current camera and existing interactions. **/
export function createCameraControls({ canvas, settings, getCamera, destroyed, animating, dragging, canvasPoint, hasUnit, cancelDrag, tileClick, resetCamera }) {
  let zoomCamera = null,
    zoomBase = 0,
    manualBase = null,
    pan = null,
    locked = false;
  const touches = new Map();
  const cameraCaptures = new Set(); // Only captures explicitly taken over by the camera
  let wheelZoom = null;
  let pinch = null,
    touchGesture = false;

  /** Measure the first two fingers' midpoint and distance in canvas coordinates. **/
  function mobilePinchPoints() {
    const [a, b] = [...touches.values()];

    return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) } : null;
  }

  /** Release all camera captures and discard active gestures without generating clicks. **/
  function cancelInputs() {
    wheelZoom = null;
    for (const id of cameraCaptures) {
      try {
        canvas.releasePointerCapture(id);
      } catch {
        /* ignore */
      }
    }
    cameraCaptures.clear();
    touches.clear();
    pan = pinch = null;
    touchGesture = false;
  }

  /** Zoom around the pointer, returning whether the scale actually changed. **/
  function zoomAt(factor, x, y) {
    const cam = getCamera();
    if (zoomCamera !== cam) {
      zoomCamera = cam;
      zoomBase = cam.scale;
    }
    const scale = Math.max(zoomBase * 0.5, Math.min(zoomBase * 3, cam.scale * factor));
    if (!Number.isFinite(scale) || scale === cam.scale) return false;
    if (!manualBase) manualBase = cam.clone();
    const ratio = scale / cam.scale;
    cam.cx = x + (cam.cx - x) * ratio;
    cam.cy = y + (cam.cy - y) * ratio;
    cam.scale = scale;
    cam.update();
    return true;
  }

  /** Consume the wheel only when enabled, unlocked and actually changing the zoom. **/
  function webOnWheel(e) {
    if (destroyed() || !settings.cameraControls || locked || animating() || dragging() || pan || touches.size) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    const delta = e.deltaY * unit;
    if (!Number.isFinite(delta) || delta === 0) return;

    const factor = Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002);
    const cam = getCamera();
    if (zoomCamera !== cam) {
      zoomCamera = cam;
      zoomBase = cam.scale;
    }
    const previousTarget = wheelZoom?.camera === cam ? wheelZoom.scale : cam.scale;
    const scale = Math.max(zoomBase * 0.5, Math.min(zoomBase * 3, previousTarget * factor));
    if (scale === previousTarget) return;
    const p = canvasPoint(e);
    wheelZoom = { camera: cam, scale, x: p.x, y: p.y };

    e.preventDefault();
  }

  /** Ease wheel zoom toward its accumulated target using elapsed frame time. **/
  function webUpdateZoom(dt) {
    if (!wheelZoom) return;
    const cam = getCamera();
    if (destroyed() || !settings.cameraControls || locked || animating() || dragging() || cam !== wheelZoom.camera) {
      wheelZoom = null;
      return;
    }
    const target = wheelZoom;
    const remaining = Math.log(target.scale / cam.scale);
    const finished = Math.abs(remaining) < 0.0001;
    const factor = finished ? target.scale / cam.scale : Math.exp(remaining * (1 - Math.exp(-18 * dt)));
    zoomAt(factor, target.x, target.y);
    if (finished) wheelZoom = null;
  }

  /** Start empty-ground panning or take over two fingers while preserving single-finger unit interactions. **/
  function pointerDown(e) {
    if (destroyed()) return true;
    wheelZoom = null;
    if (settings.cameraControls && !locked && e.pointerType === 'touch') {
      touches.set(e.pointerId, canvasPoint(e));
      if (touches.size >= 2) {
        cancelDrag();
        pan = null;
        touchGesture = true;
        pinch = mobilePinchPoints();
        for (const id of touches.keys()) {
          try {
            canvas.setPointerCapture(id);
            cameraCaptures.add(id);
          } catch {
            /* ignore */
          }
        }
        e.preventDefault();
        return true;
      }
    }
    if (
      settings.cameraControls &&
      !locked &&
      (e.pointerType === 'touch' || e.pointerType === 'mouse' && e.button === 0)
    ) {
      const p = canvasPoint(e);
      if (hasUnit(p)) return !!pan;
      e.preventDefault();
      if (animating() || dragging() || pan) return true;
      cancelDrag();
      pan = { pointerId: e.pointerId, ...p, startX: p.x, startY: p.y, moved: false, threshold: e.pointerType === 'touch' ? 8 : 4 };
      try {
        canvas.setPointerCapture(e.pointerId);
        cameraCaptures.add(e.pointerId);
      } catch {
        /* ignore */
      }
      return true;
    }
    return !!pan || touchGesture;
  }

  /** Move a single-finger pan or zoom and translate around a two-finger midpoint. **/
  function pointerMove(e) {
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, canvasPoint(e));
      if (touchGesture && touches.size >= 2) {
        const next = mobilePinchPoints();
        if (!animating() && pinch) {
          if (pinch.distance > 0 && next.distance > 0)
            zoomAt(next.distance / pinch.distance, pinch.x, pinch.y);
          const cam = getCamera();
          const dx = next.x - pinch.x,
            dy = next.y - pinch.y;
          if (dx || dy) {
            if (!manualBase) manualBase = cam.clone();
            cam.cx += dx;
            cam.cy += dy;
            cam.update();
          }
        }
        pinch = next;
        e.preventDefault();
        return true;
      }
    }
    if (!pan) return false;
    if (e.pointerId === pan.pointerId) {
      const p = canvasPoint(e);
      if (
        !pan.moved &&
        Math.hypot(p.x - pan.startX, p.y - pan.startY) <= pan.threshold
      ) return true;
      pan.moved = true;
      if (!animating()) {
        const cam = getCamera();
        if (!manualBase) manualBase = cam.clone();
        cam.cx += p.x - pan.x;
        cam.cy += p.y - pan.y;
        cam.update();
      }
      pan = { ...pan, ...p };
    }
    return true;
  }

  /** Clear the matching pan and release capture after a release or cancellation. **/
  function endPan(e) {
    if (pan?.pointerId === e.pointerId) pan = null;
    if (touches.delete(e.pointerId)) {
      pinch = mobilePinchPoints();
      if (touchGesture && touches.size === 1) {
        const [id, p] = touches.entries().next().value;
        // Continue from the remaining finger without jumping or emitting a terrain click.
        pan = { pointerId: id, ...p, startX: p.x, startY: p.y, moved: true, threshold: 8 };
      }
      if (!touches.size) touchGesture = false;
    }
    if (cameraCaptures.delete(e.pointerId)) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  /** A ground click without a drag keeps the original terrain-click behavior. **/
  function pointerUp(e) {
    if (
      !destroyed() &&
      !touchGesture &&
      pan?.pointerId === e.pointerId &&
      !pan.moved
    ) tileClick(e);
    endPan(e);
  }

  /** Transfer manual offsets onto the resized preset and update the zoom limits. **/
  function resize(target) {
    wheelZoom = null;
    if (manualBase) {
      const nextBase = target.clone();
      preserveCameraOffset(getCamera(), manualBase, target);
      manualBase = nextBase;
      zoomCamera = target;
      zoomBase = nextBase.scale;
    }
    return target;
  }

  /** Explicit scene changes and resets discard the previous manual view. **/
  function clearManual() {
    manualBase = null;
    cancelInputs();
  }

  /** Disabling manual controls ends dragging and restores the current scene's preset. **/
  function setEnabled(enabled) {
    const wasEnabled = settings.cameraControls;
    settings.cameraControls = enabled;
    if (!enabled) cancelInputs();
    if (wasEnabled && !enabled) resetCamera();
  }

  /** Lock this game's camera independently of the saved control preference. **/
  function setLocked(value) {
    locked = !!value;
    if (locked) cancelInputs();
  }

  return { webOnWheel, webUpdateZoom, pointerDown, pointerMove, pointerUp, endPan, resize, clearManual, setEnabled, setLocked, resetCamera, cancelInputs,
    get panning() {
      return !!pan || touchGesture;
    }
  };
}

// Synthetic board input. Verified on the live chess.com board: a click pair and
// a drag both move the piece (e2e4, e7e5, g1f3). Coordinates are jittered and
// the pointer travels a curved path, so the event stream is not a fixed cadence.

function jitteredSquareClientXY(boardEl, squareStr, flipped) {
  const sq = Chess.parseSquare(squareStr);
  if (!sq || !boardEl) return null;
  const rect = boardEl.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return null;

  const sqW = rect.width / 8;
  const sqH = rect.height / 8;
  const col = flipped ? 7 - sq.file : sq.file;
  const row = flipped ? sq.rank : 7 - sq.rank;
  return {
    x: rect.left + (col + 0.5) * sqW + gaussian() * sqW * 0.52,
    y: rect.top + (row + 0.5) * sqH + gaussian() * sqH * 0.52
  };
}

function isInsideBoard(el, boardEl) {
  return Boolean(el && boardEl && (el === boardEl || boardEl.contains(el)));
}

function eventInit(x, y, buttons) {
  const chromeOffsetY = Math.max(72, window.outerHeight - window.innerHeight || 88);
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: Math.round(x),
    clientY: Math.round(y),
    screenX: Math.round(x + (window.screenX || 0)),
    screenY: Math.round(y + (window.screenY || 0) + chromeOffsetY),
    button: 0,
    buttons
  };
}

function emitPointer(target, type, x, y, buttons) {
  const opts = eventInit(x, y, buttons);
  if (type.startsWith('pointer')) {
    try {
      target.dispatchEvent(
        new PointerEvent(type, { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true })
      );
    } catch {
      /* very old engines: the mouse event below is still delivered */
    }
  } else {
    target.dispatchEvent(new MouseEvent(type, opts));
  }
}

async function movePointerCurve(fromPt, toPt, buttons, boardEl) {
  const dist = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
  const steps = Math.max(6, Math.min(16, Math.round(dist / 28) + 4));
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const perp = Math.hypot(dx, dy) || 1;
  const arc = (Math.random() - 0.5) * Math.min(34, dist * 0.18);
  const ctrlX = (fromPt.x + toPt.x) / 2 + (-dy / perp) * arc;
  const ctrlY = (fromPt.y + toPt.y) / 2 + (dx / perp) * arc;

  for (let i = 1; i <= steps; i++) {
    const raw = i / steps;
    const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    const inv = 1 - t;
    const x = inv * inv * fromPt.x + 2 * inv * t * ctrlX + t * t * toPt.x;
    const y = inv * inv * fromPt.y + 2 * inv * t * ctrlY + t * t * toPt.y;
    let target = document.elementFromPoint(x, y);
    if (!isInsideBoard(target, boardEl)) target = boardEl;
    emitPointer(target, 'pointermove', x, y, buttons);
    emitPointer(target, 'mousemove', x, y, buttons);
    await sleep(rand(7, 15));
  }
}

async function clickPoint(pt, boardEl) {
  let target = document.elementFromPoint(pt.x, pt.y);
  if (!isInsideBoard(target, boardEl)) target = boardEl;
  emitPointer(target, 'pointermove', pt.x, pt.y, 0);
  emitPointer(target, 'pointerdown', pt.x, pt.y, 1);
  emitPointer(target, 'mousedown', pt.x, pt.y, 1);
  await sleep(rand(18, 42));
  emitPointer(target, 'pointerup', pt.x, pt.y, 0);
  emitPointer(target, 'mouseup', pt.x, pt.y, 0);
  emitPointer(target, 'click', pt.x, pt.y, 0);
  return true;
}

// A drag and a click are not interchangeable on chess.com: click-to-move can be
// switched off in the site's own settings, and a drag can be lost to an overlay.
// The retry therefore has to use the gesture that just failed the least: the
// other one.
function retryInputMode(mode) {
  return mode === 'drag' ? 'click' : 'drag';
}

function findPromotionPiece(boardEl, promoCls) {
  const selector = `.promotion-window .promotion-piece.${promoCls}`;
  const inside = boardEl && typeof boardEl.querySelector === 'function' ? boardEl.querySelector(selector) : null;
  if (inside) return inside;
  return typeof document === 'undefined' ? null : document.querySelector(selector);
}

// The dialog is painted after the drag, and how late depends on the machine, so
// one look 100 ms after the drop was a coin flip on a slow board. Poll instead:
// a promotion left open is a move that never registers and a session that stops.
async function awaitPromotionPiece(boardEl, promoCls, attempts = 8, pauseMs = 120, sleepFn = sleep) {
  const tries = Math.max(1, Math.round(attempts));
  for (let attempt = 0; attempt < tries; attempt++) {
    const el = findPromotionPiece(boardEl, promoCls);
    if (el) return el;
    if (attempt < tries - 1) await sleepFn(pauseMs);
  }
  return null;
}

async function clickPromotion(boardEl, promoCls, clockSeconds) {
  const press = async (el) => {
    const box = el.getBoundingClientRect();
    await clickPoint(
      {
        x: box.left + box.width * (0.5 + gaussian() * 0.4),
        y: box.top + box.height * (0.5 + gaussian() * 0.4)
      },
      boardEl
    );
  };
  const plan = promotionPollPlan(clockSeconds);
  const piece = await awaitPromotionPiece(boardEl, promoCls, plan.attempts, plan.pauseMs);
  if (!piece) return false;
  await press(piece);
  // A dialog still on screen means the click missed it. One more press is
  // cheaper than a whole move retry.
  await sleep(220);
  const still = findPromotionPiece(boardEl, promoCls);
  if (still) await press(still);
  return true;
}

async function executeMoveOnBoard(boardEl, uciMove, flipped, turnColor, options = {}) {
  if (!boardEl || !uciMove || uciMove.length < 4) return false;
  const fromSq = uciMove.slice(0, 2);
  const toSq = uciMove.slice(2, 4);
  const promo = uciMove.length >= 5 ? uciMove[4].toLowerCase() : null;

  const fromPt = jitteredSquareClientXY(boardEl, fromSq, flipped);
  const toPt = jitteredSquareClientXY(boardEl, toSq, flipped);
  if (!fromPt || !toPt) return false;

  const mode = options.inputMode || 'mixed';
  const useDrag = mode === 'drag' ? true : mode === 'click' ? false : Math.random() < 0.65;

  if (useDrag) {
    let fromTarget = document.elementFromPoint(fromPt.x, fromPt.y);
    if (!isInsideBoard(fromTarget, boardEl)) fromTarget = boardEl;
    emitPointer(fromTarget, 'pointermove', fromPt.x, fromPt.y, 0);
    await sleep(rand(15, 35));
    emitPointer(fromTarget, 'pointerdown', fromPt.x, fromPt.y, 1);
    emitPointer(fromTarget, 'mousedown', fromPt.x, fromPt.y, 1);
    await sleep(rand(28, 60));
    await movePointerCurve(fromPt, toPt, 1, boardEl);
    await sleep(rand(18, 45));
    let toTarget = document.elementFromPoint(toPt.x, toPt.y);
    if (!isInsideBoard(toTarget, boardEl)) toTarget = boardEl;
    emitPointer(toTarget, 'pointerup', toPt.x, toPt.y, 0);
    emitPointer(toTarget, 'mouseup', toPt.x, toPt.y, 0);
  } else {
    await clickPoint(fromPt, boardEl);
    await sleep(rand(45, 110));
    await movePointerCurve(fromPt, toPt, 0, boardEl);
    await clickPoint(toPt, boardEl);
  }

  if (promo) await clickPromotion(boardEl, `${turnColor === 'b' ? 'b' : 'w'}${promo}`, options.clockSeconds);
  return true;
}

// The panel can say 'Nf3', but a player reads an arrow faster than a SAN line.
// This paints the engine's choice on the board itself: one SVG, no innerHTML,
// no pointer events, and the same eight-by-eight grid the reader already uses.
const OVERLAY_ATTR = 'data-cw-overlay';
const OVERLAY_OURS = '#5cf2a0';
const OVERLAY_THREAT = '#ff6f6f';
const OVERLAY_NS = 'http://www.w3.org/2000/svg';

function overlayCell(square, flipped) {
  const parsed = Chess.parseSquare(square);
  if (!parsed) return null;
  return {
    x: flipped ? 7 - parsed.file : parsed.file,
    y: flipped ? parsed.rank : 7 - parsed.rank
  };
}

// Cell centres, shortened at both ends: an arrow that starts under the piece
// and ends under the target hides the two squares the user wants to see.
function overlayArrow(uci, flipped) {
  if (typeof uci !== 'string' || uci.length < 4) return null;
  const from = overlayCell(uci.slice(0, 2), flipped);
  const to = overlayCell(uci.slice(2, 4), flipped);
  if (!from || !to) return null;
  const ax = from.x + 0.5;
  const ay = from.y + 0.5;
  const bx = to.x + 0.5;
  const by = to.y + 0.5;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (!length) return null;
  const ux = dx / length;
  const uy = dy / length;
  return {
    x1: ax + ux * 0.20,
    y1: ay + uy * 0.20,
    x2: bx - ux * 0.42,
    y2: by - uy * 0.42,
    ux,
    uy,
    length
  };
}

function overlaySvg(boardEl) {
  if (!boardEl || typeof boardEl.querySelector !== 'function') return null;
  let svg = boardEl.querySelector(`svg[${OVERLAY_ATTR}]`);
  if (svg) return svg;
  svg = document.createElementNS(OVERLAY_NS, 'svg');
  svg.setAttribute(OVERLAY_ATTR, '1');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '6';
  svg.style.overflow = 'visible';
  boardEl.appendChild(svg);
  return svg;
}

function drawOverlayArrow(svg, arrow, color, width, opacity) {
  if (!svg || !arrow || arrow.length < 0.25) return;
  const line = document.createElementNS(OVERLAY_NS, 'line');
  line.setAttribute('x1', String(arrow.x1));
  line.setAttribute('y1', String(arrow.y1));
  line.setAttribute('x2', String(arrow.x2));
  line.setAttribute('y2', String(arrow.y2));
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', String(width));
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('opacity', String(opacity));
  line.setAttribute('data-cw-arrow', 'shaft');
  const head = 0.26;
  const half = 0.15;
  const tipX = arrow.x2 + arrow.ux * head;
  const tipY = arrow.y2 + arrow.uy * head;
  const poly = document.createElementNS(OVERLAY_NS, 'polygon');
  poly.setAttribute('points', [
    `${tipX},${tipY}`,
    `${arrow.x2 - arrow.uy * half},${arrow.y2 + arrow.ux * half}`,
    `${arrow.x2 + arrow.uy * half},${arrow.y2 - arrow.ux * half}`
  ].join(' '));
  poly.setAttribute('fill', color);
  poly.setAttribute('opacity', String(opacity));
  poly.setAttribute('data-cw-arrow', 'head');
  svg.appendChild(line);
  svg.appendChild(poly);
}

// lines is the engine's formatted MultiPV list. The top line is our move; its
// second ply is the opponent's best answer, drawn thinner and red so the two
// cannot be confused when they cross.
function paintBoardOverlay(boardEl, lines, flipped, enabled) {
  if (!boardEl || typeof boardEl.querySelector !== 'function') return;
  const svg = boardEl.querySelector(`svg[${OVERLAY_ATTR}]`);
  const first = enabled && Array.isArray(lines) ? lines[0] : null;
  const best = first && typeof first.bestUci === 'string' ? first.bestUci : '';
  const reply = best && Array.isArray(first.pv) && typeof first.pv[1] === 'string' ? first.pv[1] : '';
  if (!best) {
    if (svg) {
      svg.textContent = '';
      svg.removeAttribute('data-sig');
    }
    return;
  }
  const target = overlaySvg(boardEl);
  const sig = `${flipped ? 'b' : 'w'}|${best}|${reply}`;
  if (target.getAttribute('data-sig') === sig) return;
  target.setAttribute('data-sig', sig);
  target.textContent = '';
  const theirs = reply ? overlayArrow(reply, flipped) : null;
  const ours = overlayArrow(best, flipped);
  if (theirs) drawOverlayArrow(target, theirs, OVERLAY_THREAT, 0.07, 0.55);
  if (ours) drawOverlayArrow(target, ours, OVERLAY_OURS, 0.095, 0.9);
}

// Raster -> vector tracing.
// Extracts the alpha silhouette of a canvas as closed polygon loops
// (pixel-edge boundary walk), then simplifies with Ramer-Douglas-Peucker.
// Holes come out as separate loops and render correctly with fill-rule evenodd.

const Vectorize = (() => {

  // Build a binary mask from canvas alpha (or luminance when fully opaque).
  function buildMask(canvas, alphaThreshold = 128) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    let anyTransparent = false;
    for (let i = 0; i < w * h; i++) {
      if (data[i * 4 + 3] < 250) { anyTransparent = true; break; }
    }
    for (let i = 0; i < w * h; i++) {
      const a = data[i * 4 + 3];
      if (anyTransparent) {
        mask[i] = a >= alphaThreshold ? 1 : 0;
      } else {
        // Opaque image (e.g. JPEG): treat dark pixels as shape, light as background.
        const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
        mask[i] = lum < 200 ? 1 : 0;
      }
    }
    return { mask, w, h };
  }

  // Collect directed boundary edges between filled and empty pixels.
  // Orientation: interior is on the right of the direction of travel.
  function traceLoops(mask, w, h) {
    const filled = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? mask[y * w + x] : 0;
    const edgeMap = new Map(); // "x,y" start -> array of [dx, dy]
    const addEdge = (x, y, dx, dy) => {
      const k = x + ',' + y;
      let arr = edgeMap.get(k);
      if (!arr) { arr = []; edgeMap.set(k, arr); }
      arr.push([dx, dy]);
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!filled(x, y)) continue;
        if (!filled(x, y - 1)) addEdge(x, y, 1, 0);          // top edge, travel +x
        if (!filled(x + 1, y)) addEdge(x + 1, y, 0, 1);      // right edge, travel +y
        if (!filled(x, y + 1)) addEdge(x + 1, y + 1, -1, 0); // bottom edge, travel -x
        if (!filled(x - 1, y)) addEdge(x, y + 1, 0, -1);     // left edge, travel -y
      }
    }

    const loops = [];
    const takeEdge = (x, y, preferDx, preferDy) => {
      const k = x + ',' + y;
      const arr = edgeMap.get(k);
      if (!arr || arr.length === 0) return null;
      let idx = 0;
      if (arr.length > 1 && preferDx !== undefined) {
        // Saddle point: prefer right turn (toward interior) to keep loops separate.
        const rightDx = -preferDy, rightDy = preferDx;
        idx = arr.findIndex(d => d[0] === rightDx && d[1] === rightDy);
        if (idx < 0) idx = arr.findIndex(d => d[0] === preferDx && d[1] === preferDy);
        if (idx < 0) idx = 0;
      }
      const d = arr.splice(idx, 1)[0];
      if (arr.length === 0) edgeMap.delete(k);
      return d;
    };

    for (const startKey of Array.from(edgeMap.keys())) {
      while (edgeMap.has(startKey)) {
        const [sx, sy] = startKey.split(',').map(Number);
        let d = takeEdge(sx, sy);
        if (!d) break;
        const loop = [[sx, sy]];
        let cx = sx + d[0], cy = sy + d[1];
        let guard = w * h * 8;
        while ((cx !== sx || cy !== sy) && guard-- > 0) {
          loop.push([cx, cy]);
          d = takeEdge(cx, cy, d[0], d[1]);
          if (!d) break;
          cx += d[0];
          cy += d[1];
        }
        if (loop.length > 3) loops.push(loop);
      }
    }
    return loops;
  }

  // Ramer-Douglas-Peucker simplification of a closed loop.
  function simplifyLoop(points, epsilon) {
    if (epsilon <= 0 || points.length < 5) return points;
    const sqDistToSeg = (p, a, b) => {
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const lenSq = dx * dx + dy * dy;
      let t = lenSq ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      dx = p[0] - (a[0] + t * dx);
      dy = p[1] - (a[1] + t * dy);
      return dx * dx + dy * dy;
    };
    const epsSq = epsilon * epsilon;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [i0, i1] = stack.pop();
      let maxD = 0, maxI = -1;
      for (let i = i0 + 1; i < i1; i++) {
        const dsq = sqDistToSeg(points[i], points[i0], points[i1]);
        if (dsq > maxD) { maxD = dsq; maxI = i; }
      }
      if (maxD > epsSq && maxI > 0) {
        keep[maxI] = 1;
        stack.push([i0, maxI], [maxI, i1]);
      }
    }
    const out = [];
    for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
    return out;
  }

  // Main entry: trace a canvas into simplified loops.
  function trace(canvas, { epsilon = 1.5, alphaThreshold = 128 } = {}) {
    const { mask, w, h } = buildMask(canvas, alphaThreshold);
    let loops = traceLoops(mask, w, h);
    // Drop speck loops (area heuristic via bbox)
    loops = loops.filter(l => {
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const [x, y] of l) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      return (maxX - minX) * (maxY - minY) >= 9;
    });
    return {
      loops: loops.map(l => simplifyLoop(l, epsilon)),
      width: w,
      height: h,
    };
  }

  function toPathData(loops) {
    let d = '';
    for (const loop of loops) {
      d += 'M' + loop[0][0] + ' ' + loop[0][1];
      for (let i = 1; i < loop.length; i++) d += 'L' + loop[i][0] + ' ' + loop[i][1];
      d += 'Z';
    }
    return d;
  }

  function toSVG(traced, fillColor = '#000000') {
    const { loops, width, height } = traced;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n` +
      `  <path d="${toPathData(loops)}" fill="${fillColor}" fill-rule="evenodd"/>\n</svg>\n`;
  }

  function toPath2D(traced) {
    return new Path2D(toPathData(traced.loops));
  }

  return { trace, toSVG, toPath2D, toPathData };
})();

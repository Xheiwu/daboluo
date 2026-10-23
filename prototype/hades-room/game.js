/* 镇妖塔 · 地牢试制（hades-pack-v1）
 * 一层 = 随机房间 + 走廊；进房锁门刷波次；精英带词缀；首领尸王有多套大范围技能。
 * 摇杆只管移动；普攻三连与技能全部自动。
 * 素材为独立关键姿势（不是连续帧）：节奏靠短位移、停顿、闪白、刀光与粒子；
 * 命中/范围/伤害全部由代码判定，不按图片边缘推断。墙体为临时代码绘制，等 v2 墙体素材替换。 */
(() => {
  'use strict';
  const ASSET = '../../assets/art-reference/hades-pack-v1/';
  const Q = new URLSearchParams(location.search);
  const CAPTURE = Q.has('capture');
  const AUTO = Q.has('auto') || CAPTURE;
  const START = Q.get('start') || '';

  // ---------- 随机 ----------
  let seed = (+(Q.get('seed') || 20261023)) >>> 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const R = (a, b) => a + (b - a) * rnd();
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  const isoD = (ax, ay, bx, by) => Math.hypot(bx - ax, (by - ay) * 2);
  const angTo = (a, b) => Math.atan2((b.y - a.y) * 2, b.x - a.x);
  const angDiff = (a, b) => { const d = a - b; return Math.atan2(Math.sin(d), Math.cos(d)); };

  // ---------- 切图表（按 alpha bbox 计算，坐标为原图像素） ----------
  const SLICE = {
    hero: { file: 'hero-poses.png', fw: 900, anchor: [450, 680], scale: 0.19,
      poses: { idle: [0, 229, 77, 640, 681], run: [1, 91, 172, 714, 671], cleave: [2, 165, 155, 773, 668], cast: [3, 211, 58, 622, 693] } },
    js: { file: 'jiangshi-poses.png', fw: 900, anchor: [450, 750], scale: 0.18,
      poses: { idle: [0, 216, 59, 775, 754], jump: [1, 69, 68, 792, 685], hit: [2, 75, 103, 677, 752] } },
    tiles: { file: 'ground_tiles_4x4.png', boxes: [
      [16, 19, 423, 200], [454, 16, 424, 203], [896, 17, 425, 202], [1337, 17, 423, 202],
      [14, 229, 425, 206], [454, 230, 424, 205], [895, 230, 426, 205], [1336, 229, 424, 206],
      [14, 445, 425, 209], [453, 444, 425, 210], [895, 444, 426, 211], [1336, 445, 426, 209],
      [11, 661, 427, 209], [453, 661, 425, 208], [895, 661, 425, 209], [1336, 661, 426, 208]] },
    // [x,y,w,h, 锚点x比例, 锚点y比例, 缩放]
    deco: { file: 'decorations_7_padded.png', items: {
      brazier: [94, 29, 293, 441, 0.5, 0.9, 0.2], column: [556, 29, 203, 433, 0.5, 0.94, 0.33],
      flag: [940, 27, 379, 435, 0.13, 0.95, 0.31], grave: [1388, 83, 338, 386, 0.5, 0.86, 0.24],
      statue: [94, 479, 300, 381, 0.5, 0.9, 0.3], maple: [489, 503, 367, 340, 0.5, 0.9, 0.25],
      chain: [958, 552, 371, 290, 0.5, 0.5, 0.2] } },
  };
  const HAND = [130, -520]; // 掌心幽火相对锚点（原图像素，cast 姿势）
  // 怪物体型：同一套跳尸姿势，按体型整体缩放（不单独缩放姿势）
  const KINDS = {
    js: { k: 1, tint: null },
    small: { k: 0.72, tint: ['rgba(40,60,50,1)', 0.25] },
    elite: { k: 1.25, tint: ['rgba(110,10,10,1)', 0.22] },
    chief: { k: 1.45, tint: ['rgba(60,20,90,1)', 0.25] },
    boss: { k: 1.85, tint: ['rgba(120,0,0,1)', 0.3] },
  };

  // ---------- 画布 ----------
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  let W = 390, H = 844, DPR = 1, ZOOM = 1, RS = 1;
  function resize() {
    const cw = CAPTURE ? 390 : window.innerWidth, ch = CAPTURE ? 844 : window.innerHeight;
    DPR = CAPTURE ? 2 : Math.min(window.devicePixelRatio || 1, 2);
    ZOOM = clamp(Math.min(cw / 390, ch / 700), 0.85, 1.5);
    W = cw / ZOOM; H = ch / ZOOM; RS = ZOOM * DPR;
    cv.width = Math.round(cw * DPR); cv.height = Math.round(ch * DPR);
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
  }
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  function bake(img, sx, sy, sw, sh, scale) {
    let src = mk(sw, sh); src.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const tw = Math.max(1, Math.round(sw * scale)), th = Math.max(1, Math.round(sh * scale));
    while (src.width / 2 > tw) {
      const n = mk(src.width / 2, src.height / 2), g = n.getContext('2d');
      g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, n.width, n.height); src = n;
    }
    const out = mk(tw, th), g = out.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, tw, th);
    return out;
  }
  function tint(c, color) {
    const o = mk(c.width, c.height), g = o.getContext('2d');
    g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, o.width, o.height);
    return o;
  }
  function shade(c, color, a) {
    const g = c.getContext('2d'); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = a; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; return c;
  }
  const IMG = {};
  const load = (k, f) => new Promise((ok, no) => { const i = new Image(); i.onload = () => { IMG[k] = i; ok(); }; i.onerror = () => no(new Error(f)); i.src = ASSET + f; });

  const SPR = { hero: {}, mob: {}, tiles: [], deco: {} };
  let portrait = null;
  function buildSprites() {
    SPR.hero = {}; SPR.mob = {}; SPR.tiles = []; SPR.deco = {};
    {
      const S = SLICE.hero, img = IMG.hero;
      for (const [name, [i, x0, y0, x1, y1]] of Object.entries(S.poses)) {
        const k = S.scale * RS, c = bake(img, i * S.fw + x0, y0, x1 - x0, y1 - y0, k);
        SPR.hero[name] = { c, white: tint(c, '#fff'), red: tint(c, '#ff2a1a'), ghost: tint(c, '#3fe6d0'), ax: (S.anchor[0] - x0) * k, ay: (S.anchor[1] - y0) * k };
      }
    }
    for (const [kind, def] of Object.entries(KINDS)) {
      const S = SLICE.js, img = IMG.js; SPR.mob[kind] = {};
      for (const [name, [i, x0, y0, x1, y1]] of Object.entries(S.poses)) {
        const k = S.scale * def.k * RS, c = bake(img, i * S.fw + x0, y0, x1 - x0, y1 - y0, k);
        if (def.tint) shade(c, def.tint[0], def.tint[1]);
        SPR.mob[kind][name] = { c, white: tint(c, '#fff'), red: tint(c, '#ff2a1a'), purple: tint(c, '#b25cff'), ax: (S.anchor[0] - x0) * k, ay: (S.anchor[1] - y0) * k };
      }
    }
    const tileW = TW * 1.07 * RS;
    SLICE.tiles.boxes.forEach(([x, y, w, h]) => SPR.tiles.push(bake(IMG.tiles, x, y, w, h, tileW / w)));
    for (const [name, [x, y, w, h, fx, fy, s]] of Object.entries(SLICE.deco.items)) {
      const c = bake(IMG.deco, x, y, w, h, s * RS);
      SPR.deco[name] = { c, ax: w * fx * s * RS, ay: h * fy * s * RS };
    }
    portrait = bake(IMG.hero, 395, 58, 140, 140, 64 * RS / 140);
    buildWallSprites();
  }
  function drawSpr(s, x, y, face, o = {}) {
    const sx = (o.sx || 1) * face, sy = o.sy || 1;
    ctx.save(); ctx.translate(x, y); if (o.rot) ctx.rotate(o.rot); ctx.scale(sx, sy);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    const dx = -s.ax / RS, dy = -s.ay / RS, dw = s.c.width / RS, dh = s.c.height / RS;
    ctx.drawImage(o.img || s.c, dx, dy, dw, dh);
    if (o.flash > 0) { ctx.globalAlpha = Math.min(0.55, o.flash) * (o.alpha == null ? 1 : o.alpha); ctx.drawImage(o.flashImg || s.white, dx, dy, dw, dh); }
    ctx.restore();
  }

  // ---------- 地牢 ----------
  const TW = 104, TH = 52, HTW = TW / 2, HTH = TH / 2, GU = Math.hypot(HTW, HTH * 2); // GU：一格在等距度量下的长度
  const MW = 52, MH = 52, WH = 74; // 地图格数、墙高
  let grid, roomOf, lock, seen, tileIdx, wallKind, rooms = [], props = [], floorNo = 1;
  const cellX = (i, j) => (i - j) * HTW, cellY = (i, j) => (i + j + 1) * HTH;
  const toG = (x, y) => [(x / HTW + y / HTH) / 2, (y / HTH - x / HTW) / 2];
  const inB = (i, j) => i >= 0 && j >= 0 && i < MW && j < MH;
  const isFloor = (i, j) => inB(i, j) && grid[i + j * MW] === 1;
  const walkable = (i, j) => isFloor(i, j) && !lock[i + j * MW];
  function freeAt(gx, gy, rg) {
    return walkable(Math.floor(gx - rg), Math.floor(gy - rg)) && walkable(Math.floor(gx + rg), Math.floor(gy - rg)) &&
      walkable(Math.floor(gx - rg), Math.floor(gy + rg)) && walkable(Math.floor(gx + rg), Math.floor(gy + rg));
  }
  // 在格子空间里分轴移动，贴墙可滑动
  function moveEnt(e, dx, dy) {
    let [gx, gy] = toG(e.x, e.y); const rg = (e.r || 14) / GU;
    const dgx = (dx / HTW + dy / HTH) / 2, dgy = (dy / HTH - dx / HTW) / 2;
    let hit = false;
    if (freeAt(gx + dgx, gy, rg)) gx += dgx; else hit = true;
    if (freeAt(gx, gy + dgy, rg)) gy += dgy; else hit = true;
    e.x = (gx - gy) * HTW; e.y = (gx + gy) * HTH;
    for (const p of props) {
      if (!p.r) continue;
      const ddx = e.x - p.x, ddy = (e.y - p.y) * 2, d = Math.hypot(ddx, ddy), rr = p.r + (e.r || 14);
      if (d < rr && d > 0.01) { const nx = p.x + ddx / d * rr, ny = p.y + ddy / d * rr / 2; const [qx, qy] = toG(nx, ny); if (freeAt(qx, qy, rg)) { e.x = nx; e.y = ny; } }
    }
    return hit;
  }
  const cellOf = e => { const [gx, gy] = toG(e.x, e.y); return [Math.floor(gx), Math.floor(gy)]; };
  const roomAt = e => { const [i, j] = cellOf(e); return inB(i, j) ? roomOf[i + j * MW] : -1; };
  function randFloorIn(rm, avoid, minD = 150, tries = 40) {
    let best = null;
    for (let k = 0; k < tries; k++) {
      const i = RI(rm.x + 1, rm.x + rm.w - 2), j = RI(rm.y + 1, rm.y + rm.h - 2);
      if (!walkable(i, j)) continue;
      const p = { x: cellX(i, j) + R(-10, 10), y: cellY(i, j) + R(-5, 5) };
      if (!avoid || isoD(p.x, p.y, avoid.x, avoid.y) > minD) return p;
      best = p;
    }
    return best || { x: cellX(rm.cx, rm.cy), y: cellY(rm.cx, rm.cy) };
  }

  function genFloor() {
    grid = new Uint8Array(MW * MH); roomOf = new Int16Array(MW * MH).fill(-1); lock = new Uint8Array(MW * MH);
    seen = new Uint8Array(MW * MH); tileIdx = new Uint8Array(MW * MH); wallKind = new Uint8Array(MW * MH);
    rooms = []; props = [];
    const want = 9 + Math.min(3, floorNo - 1);
    for (let t = 0; t < 600 && rooms.length < want; t++) {
      const big = rooms.length === 0 ? false : rnd() < 0.15;
      const w = big ? RI(11, 13) : RI(7, 10), h = big ? RI(11, 13) : RI(7, 10);
      const x = RI(2, MW - w - 3), y = RI(2, MH - h - 3);
      if (rooms.some(r => x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y)) continue;
      rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1), id: rooms.length, type: 'normal', state: 'idle', waves: [], doors: [] });
    }
    for (const r of rooms) for (let i = r.x; i < r.x + r.w; i++) for (let j = r.y; j < r.y + r.h; j++) { grid[i + j * MW] = 1; roomOf[i + j * MW] = r.id; }
    // 最小生成树 + 少量回环
    const edges = [], inT = new Set([0]);
    while (inT.size < rooms.length) {
      let best = null;
      for (const a of inT) for (const b of rooms) if (!inT.has(b.id)) { const d = Math.abs(rooms[a].cx - b.cx) + Math.abs(rooms[a].cy - b.cy); if (!best || d < best[2]) best = [a, b.id, d]; }
      edges.push(best); inT.add(best[1]);
    }
    for (let k = 0; k < 2; k++) { const a = RI(0, rooms.length - 1), b = RI(0, rooms.length - 1); if (a !== b && !edges.some(e => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) edges.push([a, b, 0]); }
    const carve = (i, j) => { for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const x = i + di, y = j + dj; if (inB(x, y) && !grid[x + y * MW]) grid[x + y * MW] = 2; } };
    for (const [a, b] of edges) {
      const A = rooms[a], B = rooms[b]; let i = A.cx, j = A.cy;
      const hFirst = rnd() < 0.5;
      const stepTo = (ti, tj) => { while (i !== ti) { i += Math.sign(ti - i); carve(i, j); } while (j !== tj) { j += Math.sign(tj - j); carve(i, j); } };
      if (hFirst) { stepTo(B.cx, j); stepTo(i, B.cy); } else { stepTo(i, B.cy); stepTo(B.cx, j); }
    }
    for (let k = 0; k < grid.length; k++) if (grid[k] === 2) grid[k] = 1;
    // 门：与房间相邻的走廊格
    for (const r of rooms) {
      for (let i = r.x - 1; i <= r.x + r.w; i++) for (let j = r.y - 1; j <= r.y + r.h; j++) {
        const inside = i >= r.x && i < r.x + r.w && j >= r.y && j < r.y + r.h;
        if (inside || !isFloor(i, j) || roomOf[i + j * MW] !== -1) continue;
        r.doors.push([i, j]);
      }
    }
    // 房间类型：起点=0，首领=最远，宝箱=次远叶子，精英×2（其一为小首领）
    const dist = bfsRooms(0);
    const order = rooms.slice(1).sort((a, b) => dist[b.id] - dist[a.id]);
    rooms[0].type = 'start'; rooms[0].state = 'clear';
    order[0].type = 'boss';
    const deg = rooms.map(r => edges.filter(e => e[0] === r.id || e[1] === r.id).length);
    const rest = order.slice(1);
    const tre = rest.find(r => deg[r.id] === 1) || rest[0]; tre.type = 'treasure'; tre.state = 'clear';
    const others = rest.filter(r => r !== tre);
    if (others[0]) others[0].type = 'chief';
    if (others[2]) others[2].type = 'elite';
    // 地砖：房间与走廊不同风格
    for (let i = 0; i < MW; i++) for (let j = 0; j < MH; j++) {
      const k = i + j * MW; if (!grid[k]) continue;
      const r = roomOf[k] >= 0 ? rooms[roomOf[k]] : null, x = rnd();
      let idx = x < 0.62 ? RI(0, 3) : x < 0.9 ? RI(4, 7) : RI(12, 15);
      if (!r) idx = x < 0.45 ? RI(0, 3) : x < 0.85 ? RI(4, 7) : RI(12, 15);
      if (r && (r.type === 'boss' || r.type === 'treasure' || r.type === 'start') && Math.abs(i - r.cx) <= 1 && Math.abs(j - r.cy) <= 1) idx = 8 + ((i - r.cx + 1) % 2) * 2 + ((j - r.cy + 1) % 2);
      if (r && r.type === 'boss' && x < 0.25) idx = RI(12, 15);
      tileIdx[k] = idx;
    }
    // 墙：靠地面的墙格。1=高墙（地面在其前方）2=矮沿（地面在其后方）
    for (let i = 0; i < MW; i++) for (let j = 0; j < MH; j++) {
      const k = i + j * MW; if (grid[k]) continue;
      const f = (a, b) => isFloor(i + a, j + b);
      if (f(1, 0) || f(0, 1) || f(1, 1)) wallKind[k] = (rnd() < 0.08 && (f(1, 0) || f(0, 1))) ? 3 : 1; // 3=带幽火壁灯
      else if (f(-1, 0) || f(0, -1) || f(-1, -1) || f(1, -1) || f(-1, 1)) wallKind[k] = 2;
    }
    // 装饰
    for (const r of rooms) decorate(r);
  }
  function bfsRooms(s) {
    // 用格子 BFS 求房间间距离（走廊长度）
    const d = new Int32Array(MW * MH).fill(-1), qx = [], st = rooms[s];
    const start = st.cx + st.cy * MW; d[start] = 0; qx.push(start);
    for (let h = 0; h < qx.length; h++) { const k = qx[h], i = k % MW, j = (k / MW) | 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = i + a, y = j + b; if (isFloor(x, y) && d[x + y * MW] < 0) { d[x + y * MW] = d[k] + 1; qx.push(x + y * MW); } } }
    return rooms.map(r => d[r.cx + r.cy * MW]);
  }
  function addProp(k, i, j, r, ox = 0, oy = 0) {
    if (!isFloor(i, j)) return;
    props.push({ k, x: cellX(i, j) + ox, y: cellY(i, j) + oy, r, t: R(0, 10) });
  }
  function decorate(r) {
    const c = [[r.x, r.y], [r.x + r.w - 1, r.y], [r.x, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1]];
    const nearDoor = (i, j) => r.doors.some(([a, b]) => Math.abs(a - i) + Math.abs(b - j) < 3);
    const ok = (i, j) => !nearDoor(i, j);
    if (r.type === 'boss') {
      for (const [i, j] of c) if (ok(i, j)) addProp('brazier', i + Math.sign(r.cx - i), j + Math.sign(r.cy - j), 18);
      addProp('statue', r.x + 1, r.y + 1, 24); addProp('flag', r.cx - 2, r.y, 8); addProp('flag', r.x, r.cy - 2, 8);
      for (let k = 0; k < 3; k++) { const i = RI(r.x + 1, r.x + r.w - 2), j = RI(r.y + 1, r.y + r.h - 2); if (Math.abs(i - r.cx) > 2 || Math.abs(j - r.cy) > 2) addProp('chain', i, j, 0); }
      return;
    }
    // 角落：火盆/石柱/墓碑/红枫
    c.forEach(([i, j], n) => { if (!ok(i, j)) return; const k = r.type === 'start' ? (n % 2 ? 'brazier' : 'column') : pick(['brazier', 'brazier', 'column', 'grave', 'maple']); addProp(k, i, j, k === 'maple' ? 18 : 20); });
    if (r.type === 'start') { addProp('statue', r.x, r.cy, 24); }
    if (r.w >= 9 && rnd() < 0.6) addProp('flag', r.cx, r.y, 8);
    if (rnd() < 0.6) addProp('chain', RI(r.x + 2, r.x + r.w - 3), RI(r.y + 2, r.y + r.h - 3), 0);
    if (rnd() < 0.5) { const i = RI(r.x + 1, r.x + r.w - 2), j = r.y + r.h - 1; if (ok(i, j)) addProp('maple', i, j, 18); }
  }

  // 临时墙体（代码绘制，等 v2 墙体素材替换）
  const WSPR = {};
  function buildWallSprites() {
    const mkWall = (left, right, torch) => {
      const c = mk(TW * RS + 2, (TH + WH) * RS + 2), g = c.getContext('2d'); g.scale(RS, RS); g.translate(HTW, WH);
      // 顶点：top(0,0) right(HTW,HTH) bottom(0,TH) left(-HTW,HTH)，向上抬 WH
      const face = (ax, ay, bx, by, c0, c1) => {
        const gr = g.createLinearGradient(0, -WH, 0, TH); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
        g.fillStyle = gr; g.beginPath(); g.moveTo(ax, ay - WH); g.lineTo(bx, by - WH); g.lineTo(bx, by); g.lineTo(ax, ay); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1;
        for (let r = 1; r < 4; r++) { const y = -WH + r * WH / 4; g.beginPath(); g.moveTo(ax, ay + y); g.lineTo(bx, by + y); g.stroke(); }
        for (let r = 0; r < 4; r++) { const u = (r + (r % 2 ? 0.5 : 0.25)) / 4, x = lerp(ax, bx, u), y = lerp(ay, by, u); const row = r % 4; g.beginPath(); g.moveTo(x, y - WH + row * WH / 4); g.lineTo(x, y - WH + (row + 1) * WH / 4); g.stroke(); }
        g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(ax, ay - WH); g.lineTo(bx, by - WH); g.lineTo(bx, by); g.lineTo(ax, ay); g.closePath(); g.stroke();
      };
      if (left) face(-HTW, HTH, 0, TH, '#2b4644', '#0b1515');
      if (right) face(0, TH, HTW, HTH, '#1f3533', '#081010');
      // 顶面
      g.fillStyle = '#152322'; g.beginPath(); g.moveTo(0, -WH); g.lineTo(HTW, HTH - WH); g.lineTo(0, TH - WH); g.lineTo(-HTW, HTH - WH); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(201,160,84,.75)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-HTW, HTH - WH); g.lineTo(0, TH - WH); g.lineTo(HTW, HTH - WH); g.stroke();
      g.strokeStyle = '#050808'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -WH); g.lineTo(HTW, HTH - WH); g.lineTo(0, TH - WH); g.lineTo(-HTW, HTH - WH); g.closePath(); g.stroke();
      if (torch) {
        const fx = left ? -HTW / 2 : HTW / 2, fy = (left ? HTH * 1.5 : HTH * 1.5) - WH * 0.55;
        g.fillStyle = '#0a0f0f'; g.fillRect(fx - 6, fy, 12, 7); g.fillStyle = '#c9a054'; g.fillRect(fx - 7, fy, 14, 2);
        g.fillStyle = '#c9a054'; g.fillRect(fx - 1.5, fy + 7, 3, 10);
      }
      return { c, ax: HTW * RS, ay: (WH + TH) * RS, torch: torch ? [left ? -HTW / 2 : HTW / 2, HTH * 1.5 - WH * 0.55 - TH] : null };
    };
    WSPR.LR = mkWall(1, 1, 0); WSPR.L = mkWall(1, 0, 0); WSPR.R = mkWall(0, 1, 0); WSPR.N = mkWall(0, 0, 0);
    WSPR.LT = mkWall(1, 0, 1); WSPR.RT = mkWall(0, 1, 1);
    // 矮沿
    const lip = mk(TW * RS + 2, (TH + 16) * RS + 2), g = lip.getContext('2d'); g.scale(RS, RS); g.translate(HTW, 14);
    g.fillStyle = '#0b1414'; g.beginPath(); g.moveTo(-HTW, HTH - 14); g.lineTo(0, -14); g.lineTo(HTW, HTH - 14); g.lineTo(HTW, HTH); g.lineTo(0, TH); g.lineTo(-HTW, HTH); g.closePath(); g.fill();
    g.fillStyle = '#1d302f'; g.beginPath(); g.moveTo(0, -14); g.lineTo(HTW, HTH - 14); g.lineTo(0, TH - 14); g.lineTo(-HTW, HTH - 14); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(201,160,84,.5)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-HTW, HTH - 14); g.lineTo(0, -14); g.lineTo(HTW, HTH - 14); g.stroke();
    WSPR.lip = { c: lip, ax: HTW * RS, ay: (14 + TH) * RS };
  }
  function wallSpr(i, j) {
    const k = wallKind[i + j * MW];
    if (k === 2) return WSPR.lip;
    const L = isFloor(i, j + 1), Rr = isFloor(i + 1, j);
    if (k === 3) return L ? WSPR.LT : Rr ? WSPR.RT : WSPR.LR;
    return L && Rr ? WSPR.LR : L ? WSPR.L : Rr ? WSPR.R : WSPR.LR;
  }
  function viewCells(pad = 3) {
    const z = 1 + zoomP, hw = W / 2 / z + 80, hh = H / 2 / z + 160;
    const cs = [[cam.x - hw, cam.y - hh], [cam.x + hw, cam.y - hh], [cam.x - hw, cam.y + hh], [cam.x + hw, cam.y + hh]].map(([x, y]) => toG(x, y));
    const i0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c[0]))) - pad), i1 = Math.min(MW - 1, Math.ceil(Math.max(...cs.map(c => c[0]))) + pad);
    const j0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c[1]))) - pad), j1 = Math.min(MH - 1, Math.ceil(Math.max(...cs.map(c => c[1]))) + pad);
    return [i0, i1, j0, j1];
  }
  const vis = (i, j) => seen[i + j * MW] || (inB(i + 1, j) && seen[i + 1 + j * MW]) || (inB(i, j + 1) && seen[i + (j + 1) * MW]) || (inB(i - 1, j) && seen[i - 1 + j * MW]) || (inB(i, j - 1) && seen[i + (j - 1) * MW]) || (inB(i + 1, j + 1) && seen[i + 1 + (j + 1) * MW]);
  function drawGround() {
    const [i0, i1, j0, j1] = viewCells();
    for (let s = i0 + j0; s <= i1 + j1; s++) for (let i = Math.max(i0, s - j1); i <= Math.min(i1, s - j0); i++) {
      const j = s - i, k = i + j * MW;
      if (grid[k] === 1 && seen[k]) { const t = SPR.tiles[tileIdx[k]], w = TW * 1.07, h = w * t.height / t.width; ctx.drawImage(t, cellX(i, j) - w / 2, cellY(i, j) - h / 2 + 1, w, h); }
      else if (wallKind[k] === 2 && vis(i, j)) { const L = WSPR.lip; ctx.drawImage(L.c, cellX(i, j) - L.ax / RS, cellY(i, j) + HTH - L.ay / RS, L.c.width / RS, L.c.height / RS); }
    }
  }
  function wallList(list) {
    const [i0, i1, j0, j1] = viewCells();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i + j * MW; const wk = wallKind[k]; if ((wk === 1 || wk === 3) && vis(i, j)) list.push([cellY(i, j), 9, [i, j]]); }
  }
  function drawWall(i, j) {
    const s = wallSpr(i, j), x = cellX(i, j), y = cellY(i, j) + HTH;
    let a = 1; const dy = y - hero.y, dx = Math.abs(x - hero.x);
    if (dy > -10 && dy < 120 && dx < 80) a = 0.35; // 主角被墙挡住时墙体半透明
    if (a < 1) ctx.globalAlpha = a;
    ctx.drawImage(s.c, x - s.ax / RS, y - s.ay / RS, s.c.width / RS, s.c.height / RS);
    ctx.globalAlpha = 1;
  }
  const torches = () => { const out = []; const [i0, i1, j0, j1] = viewCells(); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (wallKind[i + j * MW] === 3 && vis(i, j)) { const L = isFloor(i, j + 1); out.push({ x: cellX(i, j) + (L ? -HTW / 2 : HTW / 2), y: cellY(i, j) + HTH / 2 + 2, z: WH * 0.55 + 6 }); } return out; };

  // 迷雾 + 小地图
  let mini = null, miniDirty = true, revealT = 0;
  function reveal() {
    const [ci, cj] = cellOf(hero), r = 6;
    const ri = roomAt(hero);
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) if (inB(i, j) && !seen[i + j * MW] && (i - ci) ** 2 + (j - cj) ** 2 <= r * r) { seen[i + j * MW] = 1; miniDirty = true; }
    if (ri >= 0 && !rooms[ri].seen) { const rm = rooms[ri]; rm.seen = true; for (let i = rm.x - 1; i <= rm.x + rm.w; i++) for (let j = rm.y - 1; j <= rm.y + rm.h; j++) if (inB(i, j)) seen[i + j * MW] = 1; miniDirty = true; }
  }
  const MS = 2.4;
  function drawMini() {
    if (!mini) mini = mk((MW + MH) * MS * RS + 4, (MW + MH) * MS / 2 * RS + 4);
    if (miniDirty) {
      miniDirty = false; const g = mini.getContext('2d'); g.setTransform(RS, 0, 0, RS, (MH * MS + 2) * RS, 2 * RS); g.clearRect(-999, -999, 9999, 9999);
      for (let i = 0; i < MW; i++) for (let j = 0; j < MH; j++) {
        const k = i + j * MW; if (!seen[k] || !grid[k]) continue;
        const r = roomOf[k] >= 0 ? rooms[roomOf[k]] : null;
        g.fillStyle = !r ? '#3c5452' : r.type === 'boss' ? '#7a1d16' : r.type === 'treasure' ? '#7a6224' : (r.type === 'elite' || r.type === 'chief') ? '#5a2c6a' : r.state === 'clear' ? '#4d6e6a' : '#3f5a57';
        const x = (i - j) * MS, y = (i + j) * MS / 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + MS, y + MS / 2); g.lineTo(x, y + MS); g.lineTo(x - MS, y + MS / 2); g.closePath(); g.fill();
      }
    }
    const w = 150, h = 82, x0 = W - w - 10, y0 = 66;
    ctx.fillStyle = 'rgba(6,8,10,.72)'; frame(x0, y0, w, h, 6); ctx.fill(); ctx.strokeStyle = '#6a5130'; ctx.lineWidth = 1; ctx.stroke();
    // 以主角为中心
    const [gx, gy] = toG(hero.x, hero.y), hx = (gx - gy) * MS + MH * MS + 2, hy = (gx + gy) * MS / 2 + 2;
    ctx.save(); ctx.beginPath(); ctx.rect(x0 + 2, y0 + 2, w - 4, h - 4); ctx.clip();
    ctx.drawImage(mini, x0 + w / 2 - hx, y0 + h / 2 - hy, mini.width / RS, mini.height / RS);
    for (const r of rooms) if (r.seen || r.type === 'boss') {
      const mx = x0 + w / 2 - hx + (r.cx - r.cy) * MS + MH * MS + 2, my = y0 + h / 2 - hy + (r.cx + r.cy) * MS / 2 + 2;
      if (r.type === 'boss') { ctx.fillStyle = '#ff4a3a'; ctx.font = `900 10px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('首', mx, my); }
      else if (r.type === 'treasure' && r.seen) { ctx.fillStyle = r.chestOpen ? '#6a5a30' : '#ffd25a'; ctx.fillRect(mx - 2, my - 2, 4, 4); }
      else if ((r.type === 'elite' || r.type === 'chief') && r.state !== 'clear') { ctx.fillStyle = '#c36bff'; ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, TAU); ctx.fill(); }
    }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x0 + w / 2, y0 + h / 2, 2.4, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------- 状态 ----------
  const hero = { x: 0, y: 0, vx: 0, vy: 0, face: 1, r: 14, hp: 160, maxhp: 160, act: null, atkCd: 0, combo: 0, comboT: 0, inv: 0, red: 0, moveT: 0, bob: 0, trail: 0, lv: 12, deaths: 0 };
  const SK = [
    { id: 'palm', name: '幽冥掌', glyph: '掌', color: '#46f0d8', cd: 4.5, t: 1.2, flash: 0 },
    { id: 'spin', name: '金轮斩', glyph: '旋', color: '#f2c45a', cd: 7, t: 3.0, flash: 0 },
    { id: 'dash', name: '血影斩', glyph: '斩', color: '#ff4a3a', cd: 9, t: 5.0, flash: 0 },
  ];
  let mobs = [], parts = [], slashes = [], rings = [], decals = [], nums = [], coins = [], orbs = [], ghosts = [], teles = [], hazards = [], loot = [], toasts = [];
  let slow = 0, dim = 0, zoomP = 0, flashes = [], pillars = [], lines = [];
  let T = 0, hitstop = 0, shake = 0, shakeX = 0, shakeY = 0, kills = 0, gold = 0, gems = 0, autoOn = true, goldPop = 0;
  let banner = null, curRoom = null, boss = null, stairs = null, homeGate = null, chest = null, fade = 0, fadeAct = null, summary = null;
  const bag = [];
  const cam = { x: 0, y: 0 };
  const stick = { on: false, bx: 0, by: 0, x: 0, y: 0, id: null };
  const keys = {};

  // ---------- 特效 ----------
  function spark(x, y, n, ang, spread, sp, col = '#ffd56a') {
    for (let i = 0; i < n; i++) { const a = ang + R(-spread, spread), v = R(sp * 0.4, sp); parts.push({ t: 'spark', x, y, z: R(20, 50), vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: R(-40, 120), life: R(0.18, 0.4), age: 0, col }); }
  }
  function ink(x, y, n, ang, sp) {
    for (let i = 0; i < n; i++) { const a = ang + R(-0.9, 0.9), v = R(sp * 0.3, sp); parts.push({ t: 'ink', x, y, z: R(24, 56), vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: R(40, 200), life: 2, age: 0, s: R(2, 5.5), col: rnd() < 0.3 ? '#5a0d0d' : '#07090a' }); }
  }
  function ghostFire(x, y, z, n, sp = 30, col = 'c') {
    for (let i = 0; i < n; i++) parts.push({ t: 'fire', x: x + R(-6, 6), y: y + R(-3, 3), z: z + R(-4, 4), vx: R(-sp, sp), vy: R(-sp, sp) * 0.5, vz: R(30, 90), life: R(0.4, 0.8), age: 0, s: R(3, 7), col });
  }
  function dust(x, y, n, sp = 60) {
    for (let i = 0; i < n; i++) { const a = R(0, TAU); parts.push({ t: 'dust', x, y, z: 2, vx: Math.cos(a) * R(sp * .4, sp), vy: Math.sin(a) * R(sp * .4, sp) * 0.5, vz: R(5, 30), life: R(0.35, 0.6), age: 0, s: R(5, 10) }); }
  }
  function ring(x, y, r0, r1, life, col, w = 4) { rings.push({ x, y, r0, r1, life, age: 0, col, w }); }
  function num(x, y, v, crit, col, big) { nums.push({ x: x + R(-22, 22), y, z: R(62, 96) * (big || 1), v, crit, col: col || (crit ? '#ffd24a' : '#fff4dc'), age: 0, life: crit ? 0.95 : 0.7, vx: R(-20, 20) }); if (nums.length > 60) nums.shift(); }
  function addShake(v) { shake = Math.max(shake, v); }
  function decal(x, y, s, col, a = 0.8) { decals.push({ x, y, s, col, a, age: 0, blobs: Array.from({ length: 5 }, () => [R(-1, 1), R(-0.5, 0.5), R(0.3, 0.8)]) }); if (decals.length > 90) decals.shift(); }
  function flash(col, a, life = 0.25) { flashes.push({ col, a, life, age: 0 }); }
  function say(text, sub, col = '#f3dca2', life = 2.2) { banner = { text, sub, col, age: 0, life }; }
  function toast(text, col) { toasts.push({ text, col, age: 0 }); if (toasts.length > 4) toasts.shift(); }

  // ---------- 危险区（怪物技能） ----------
  // circle：延迟落下的圆形；ring：带缺口的扩散冲击波；pool：持续伤害的地面区域；cone：扇形
  function hzCircle(x, y, r, delay, dmg, o = {}) { hazards.push(Object.assign({ type: 'circle', x, y, r, delay, dmg, age: 0, col: '#ff3526' }, o)); }
  function hzRing(x, y, max, speed, dmg, gaps, o = {}) { hazards.push(Object.assign({ type: 'ring', x, y, rad: 10, max, speed, dmg, gaps, gapW: 0.75, band: 16, age: 0, hit: false, col: '#ff3526' }, o)); }
  function hzPool(x, y, r, life, dps, o = {}) { hazards.push(Object.assign({ type: 'pool', x, y, r, life, dps, age: 0, col: '#5cff6a' }, o)); }
  function hzCone(x, y, ang, r, half, delay, dmg, src, o = {}) { hazards.push(Object.assign({ type: 'cone', x, y, ang, r, half, delay, dmg, age: 0, src }, o)); }
  function updHazards(dt) {
    for (const h of hazards) {
      h.age += dt;
      const d = isoD(h.x, h.y, hero.x, hero.y);
      if (h.type === 'circle' || h.type === 'cone') {
        if (h.age >= h.delay && !h.done) {
          h.done = true;
          if (h.type === 'circle') {
            ring(h.x, h.y, 6, h.r * 1.1, 0.35, h.col, 4); dust(h.x, h.y, 8, 120); addShake(h.r > 70 ? 6 : 3); decal(h.x, h.y, h.r * 0.25, '#120404', 0.5);
            if (h.fx === 'talisman') { spark(h.x, h.y, 10, -Math.PI / 2, 1.5, 300, '#ff6a40'); pillars.push({ x: h.x, y: h.y, age: 0, life: 0.4, s: 0.7, red: true }); }
            if (h.fx === 'bomb') { pillars.push({ x: h.x, y: h.y, age: 0, life: 0.5, s: 1.1, red: true }); ink(h.x, h.y, 20, 0, 300); flash('#ff2a1a', 0.12, 0.2); }
            if (h.pool) hzPool(h.x, h.y, h.r * 0.6, 4, 8);
            if (d < h.r && hero.inv <= 0) hurtHero(h.dmg, h);
          } else {
            if (h.beam) { for (let q = 0.2; q <= 1; q += 0.2) { const x = h.x + Math.cos(h.ang) * h.r * q, y = h.y + Math.sin(h.ang) * h.r * q / 2; spark(x, y, 3, -Math.PI / 2, 1.2, 260, '#ff6a40'); dust(x, y, 2, 80); } lines.push({ x0: h.x, y0: h.y, x1: h.x + Math.cos(h.ang) * h.r, y1: h.y + Math.sin(h.ang) * h.r / 2, age: 0, life: 0.45, ground: true }); addShake(4); decal(h.x + Math.cos(h.ang) * h.r * 0.5, h.y + Math.sin(h.ang) * h.r * 0.25, 14, '#120404', 0.4); rings.push({ x: h.x, y: h.y, r0: 10, r1: 30, life: 0.2, age: 0, col: '#ff3526', w: 3 }); }
            else slashes.push({ kind: 'claw', x: h.x + Math.cos(h.ang) * h.r * 0.45, y: h.y + Math.sin(h.ang) * h.r * 0.22, ang: h.ang, face: Math.cos(h.ang) >= 0 ? 1 : -1, age: 0, life: 0.3, s: h.r / 80 });
            addShake(h.r > 120 ? 8 : 3);
            const a = Math.atan2((hero.y - h.y) * 2, hero.x - h.x);
            if (d < h.r && Math.abs(angDiff(a, h.ang)) < h.half && hero.inv <= 0) hurtHero(h.dmg, h);
          }
        }
        h.dead = h.age > h.delay + 0.05;
      } else if (h.type === 'ring') {
        h.rad += h.speed * dt;
        if (!h.hit && Math.abs(d - h.rad) < h.band && hero.inv <= 0) {
          const a = Math.atan2((hero.y - h.y) * 2, hero.x - h.x);
          const inGap = h.gaps.some(g => Math.abs(angDiff(a, g)) < h.gapW / 2);
          if (!inGap) { h.hit = true; hurtHero(h.dmg, h); }
        }
        h.dead = h.rad > h.max;
      } else if (h.type === 'pool') {
        if (d < h.r && h.age > 0.4) { h.tick = (h.tick || 0) + dt; if (h.tick > 0.5) { h.tick = 0; hurtHero(Math.round(h.dps * 0.5), h, true); } }
        if (rnd() < 0.2) parts.push({ t: 'fire', x: h.x + R(-h.r, h.r), y: h.y + R(-h.r, h.r) * 0.4, z: 2, vx: 0, vy: 0, vz: R(10, 30), life: R(0.5, 1), age: 0, s: R(2, 4), col: 'g' });
        h.dead = h.age > h.life;
      }
    }
    hazards = hazards.filter(h => !h.dead);
  }
  function drawHazards() {
    for (const h of hazards) {
      if (h.type === 'circle') {
        const u = Math.min(1, h.age / h.delay), blink = u > 0.8 && Math.floor(T * 20) % 2;
        ctx.lineWidth = 2.5; ctx.strokeStyle = blink ? '#fff' : `rgba(255,50,40,${0.45 + 0.4 * u})`;
        ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r, h.r * 0.39, 0, 0, TAU); ctx.stroke();
        ctx.fillStyle = `rgba(220,20,15,${0.14 + 0.2 * u})`; ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r * u, h.r * 0.39 * u, 0, 0, TAU); ctx.fill();
        if (h.fx === 'talisman') { const z = (1 - u) * 260; ctx.save(); ctx.translate(h.x, h.y - z - 10); ctx.rotate(Math.sin(T * 9 + h.x) * 0.3); ctx.globalAlpha = Math.min(1, u * 3); ctx.fillStyle = '#e2b640'; ctx.fillRect(-6, -11, 12, 22); ctx.fillStyle = '#a3170f'; ctx.fillRect(-1.5, -8, 3, 16); ctx.restore(); ctx.globalAlpha = 1; }
      } else if (h.type === 'cone') {
        const u = Math.min(1, h.age / h.delay);
        ctx.save(); ctx.translate(h.x, h.y); ctx.scale(1, 0.5);
        ctx.fillStyle = `rgba(255,30,20,${0.12 + 0.12 * u})`; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, h.r, h.ang - h.half, h.ang + h.half); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,60,40,.33)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, h.r * u, h.ang - h.half, h.ang + h.half); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = u > 0.85 ? '#fff' : 'rgba(255,70,50,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, h.r, h.ang - h.half, h.ang + h.half); ctx.stroke();
        ctx.restore();
      } else if (h.type === 'ring') {
        ctx.save(); ctx.translate(h.x, h.y); ctx.scale(1, 0.5);
        // 缺口之间画实线（危险），缺口处为安全通道
        const gs = h.gaps.map(g => g).sort((a, b) => a - b);
        for (let k = 0; k < gs.length; k++) {
          const a0 = gs[k] + h.gapW / 2, a1 = (k + 1 < gs.length ? gs[k + 1] : gs[0] + TAU) - h.gapW / 2;
          ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(10,0,0,.6)'; ctx.lineWidth = h.band * 1.6; ctx.beginPath(); ctx.arc(0, 0, h.rad, a0, a1); ctx.stroke();
          ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = h.col; ctx.lineWidth = h.band; ctx.beginPath(); ctx.arc(0, 0, h.rad, a0, a1); ctx.stroke();
          ctx.strokeStyle = '#ffd0b8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, h.rad, a0, a1); ctx.stroke();
        }
        // 缺口方向的预警引导线
        ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(120,255,200,.35)'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
        for (const g of gs) { ctx.beginPath(); ctx.moveTo(Math.cos(g) * h.rad, Math.sin(g) * h.rad); ctx.lineTo(Math.cos(g) * h.max, Math.sin(g) * h.max); ctx.stroke(); }
        ctx.setLineDash([]); ctx.restore(); ctx.globalCompositeOperation = 'source-over';
      } else if (h.type === 'pool') {
        const u = Math.min(1, h.age / 0.4), fade = Math.min(1, (h.life - h.age) / 0.6);
        const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r); g.addColorStop(0, `rgba(80,200,60,${0.45 * fade})`); g.addColorStop(0.8, `rgba(40,120,30,${0.35 * fade})`); g.addColorStop(1, 'rgba(20,60,10,0)');
        ctx.save(); ctx.translate(h.x, h.y); ctx.scale(1, 0.42); ctx.translate(-h.x, -h.y); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h.x, h.y, h.r * u, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(140,255,110,${0.5 * fade})`; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      }
    }
  }

  // ---------- 怪物 ----------
  const AFFIX = {
    rage: { name: '狂暴', col: '#ff4a3a' }, armor: { name: '坚甲', col: '#e8c060' }, quake: { name: '震地', col: '#ff9a3a' },
    poison: { name: '尸毒', col: '#7cff5a' }, blink: { name: '闪现', col: '#c36bff' }, summon: { name: '唤尸', col: '#46f0d8' },
    split: { name: '分裂', col: '#9ab0a8' }, bomb: { name: '尸爆', col: '#ff2a6a' }, shield: { name: '护体', col: '#7fd8ff' },
  };
  const AFF_KEYS = Object.keys(AFFIX);
  const hpScale = () => 1 + 0.35 * (floorNo - 1);
  function makeMob(kind, x, y, aff = []) {
    const base = { js: 70, small: 30, elite: 420, chief: 820, boss: 3400 }[kind] * hpScale();
    const m = { kind, x, y, r: { js: 16, small: 12, elite: 20, chief: 24, boss: 34 }[kind], face: x < hero.x ? 1 : -1, hp: base, maxhp: base, st: 'spawn', t: 0, z: 0, flash: 0, kx: 0, ky: 0,
      atkCd: R(0.8, 1.6), clawCd: R(0.3, 1), hopT: R(0, 0.3), tx: x, ty: y, sx: x, sy: y, aff, spd: 1, cdMul: 1, dmgTaken: 1, leapR: 52, dmg: 1 + 0.2 * (floorNo - 1), blinkT: 3, sumT: 5, poisonT: 2, shield: 0, shieldMax: 0, shieldT: 0 };
    if (kind === 'small') { m.spd = 1.25; m.leapR = 40; m.dmg *= 0.6; }
    if (kind === 'elite' || kind === 'chief') { m.leapR = 62; m.dmg *= 1.3; }
    if (kind === 'boss') { m.leapR = 100; m.dmg *= 1.6; }
    if (aff.includes('rage')) { m.spd *= 1.35; m.cdMul = 0.6; }
    if (aff.includes('armor')) m.dmgTaken = 0.5;
    if (aff.includes('quake')) m.leapR *= 1.5;
    if (aff.includes('shield')) { m.shieldMax = m.maxhp * 0.35; m.shield = m.shieldMax; }
    if (aff.length) m.name = `【${aff.map(a => AFFIX[a].name).join('·')}】${kind === 'chief' ? '尸将' : '血衣尸卫'}`;
    mobs.push(m);
    ring(x, y, 4, 46 * KINDS[kind].k, 0.7, '#3fe6d0', 3); ghostFire(x, y, 4, 18, 26);
    return m;
  }
  function spawnBoss(rm) {
    const p = { x: cellX(rm.cx, rm.cy), y: cellY(rm.cx, rm.cy) };
    const m = makeMob('boss', p.x, p.y, []); m.st = 'intro'; m.name = '尸王·旱魃'; m.phase = 1; m.next = 0; m.combo = 0;
    boss = m; addShake(10); flash('#ff1a0a', 0.25, 0.6);
    ring(p.x, p.y, 10, 260, 1.2, '#ff3526', 6); ring(p.x, p.y, 10, 180, 0.9, '#c9a054', 3);
    say('尸王 · 旱魃', '第一层首领  ·  注意红圈与冲击波缺口', '#ff6a50', 3);
  }
  const alive = () => mobs.filter(m => m.st !== 'dead' && m.st !== 'spawn' && m.st !== 'intro');
  function hurtMob(m, dmg, crit, kx, ky, kb = 1) {
    if (m.st === 'dead' || m.st === 'spawn' || m.st === 'intro') return false;
    dmg = Math.max(1, Math.round(dmg * m.dmgTaken));
    if (m.shield > 0) { const a = Math.min(m.shield, dmg); m.shield -= a; dmg -= a; m.shieldT = 6; ring(m.x, m.y, 10, 40 * KINDS[m.kind].k, 0.2, '#7fd8ff', 2); if (m.shield <= 0) { flash('#7fd8ff', 0.08); ring(m.x, m.y, 10, 90, 0.4, '#bfefff', 5); spark(m.x, m.y, 18, 0, Math.PI, 300, '#bfefff'); num(m.x, m.y - 20, '破盾', true, '#bfefff'); } }
    m.hp -= dmg; m.flash = kb < 0.5 ? 0.45 : 1; if (dmg > 0) num(m.x, m.y, dmg, crit, null, KINDS[m.kind].k);
    const a = Math.atan2(ky, kx);
    spark(m.x, m.y, crit ? 14 : 8, a, 0.7, crit ? 380 : 260); ink(m.x, m.y, crit ? 7 : 3, a, 220);
    const d = Math.hypot(kx, ky) || 1;
    const heavy = m.kind === 'boss' || m.kind === 'chief' || m.kind === 'elite';
    const kbm = m.aff.includes('armor') ? 0.2 : m.kind === 'boss' ? 0 : heavy ? 0.35 : 1;
    if (m.st !== 'leap' && m.st !== 'swipe' && !(m.kind === 'boss')) {
      m.kx = kx / d * 260 * kb * kbm; m.ky = ky / d * 130 * kb * kbm;
      if (!heavy || (kb >= 1.4 && rnd() < 0.3 && m.st !== 'windup')) { m.st = 'hit'; m.t = 0; m.z = 0; }
    }
    if (m.hp <= 0) killMob(m, kx / d, ky / d);
    return true;
  }
  function killMob(m, dx, dy) {
    m.st = 'dead'; m.t = 0; m.kx = dx * 320; m.ky = dy * 160; kills++;
    const big = KINDS[m.kind].k;
    addShake(5 * big); ink(m.x, m.y, 18 * big, Math.atan2(dy, dx), 260); ghostFire(m.x, m.y, 40, 16 * big, 40, 'k');
    decal(m.x + dx * 20, m.y + dy * 10, R(12, 18) * big, '#3a0707', 0.7);
    for (let i = 0; i < 3 * big; i++) parts.push({ t: 'paper', x: m.x, y: m.y, z: 95 * big, vx: R(-60, 60), vy: R(-20, 20), vz: R(60, 160), life: 1.6, age: 0, rot: R(0, TAU), vr: R(-8, 8) });
    if (m.aff.includes('split')) for (let k = 0; k < 2; k++) { const s = makeMob('small', m.x + R(-20, 20), m.y + R(-10, 10)); s.st = 'hop'; }
    if (m.aff.includes('bomb')) { hzCircle(m.x, m.y, 115, 0.9, Math.round(18 * m.dmg), { fx: 'bomb' }); say('尸爆！', '快离开红圈', '#ff6a8a', 1.2); }
    dropLoot(m);
    if (m.kind === 'boss') {
      boss = null; slow = 0.8; hitstop = 0.25; flash('#fff2c0', 0.3, 0.7); addShake(18); zoomP = 0.08;
      ring(m.x, m.y, 10, 300, 1.2, '#ffd25a', 8); spark(m.x, m.y, 60, 0, Math.PI, 600); ghostFire(m.x, m.y, 60, 60, 160, 'k');
      for (const o of mobs) if (o !== m && o.st !== 'dead') hurtMob(o, 9999, false, o.x - m.x, o.y - m.y, 2);
      hazards = [];
      say('尸王伏诛', '掉落已散落四周', '#ffd25a', 3);
    } else if (m.name) say(`${m.name} 已斩`, '', '#e3b6ff', 1.6);
  }

  // 普通/精英跳尸 AI
  function updMob(m, dt) {
    m.t += dt; m.flash = Math.max(0, m.flash - dt * 9); m.atkCd -= dt; m.clawCd -= dt;
    if (m.shieldMax) { m.shieldT -= dt; if (m.shieldT <= 0 && m.shield < m.shieldMax) m.shield = Math.min(m.shieldMax, m.shield + m.shieldMax * 0.25 * dt); }
    if (m.kind === 'boss') return updBoss(m, dt);
    const dh = isoD(m.x, m.y, hero.x, hero.y);
    const faceHero = () => { m.face = hero.x >= m.x ? 1 : -1; };
    const K = KINDS[m.kind].k;
    // 词缀：周期技能
    if (m.st !== 'dead' && m.st !== 'spawn') {
      if (m.aff.includes('blink') && (m.blinkT -= dt) <= 0 && dh > 80 && (m.st === 'hop')) {
        m.blinkT = 4.5; const a = angTo(m, hero) + R(-0.6, 0.6), L = 46;
        const p = { x: hero.x + Math.cos(a) * L, y: hero.y + Math.sin(a) * L / 2, r: m.r }; const [gx, gy] = toG(p.x, p.y);
        if (freeAt(gx, gy, m.r / GU)) { m.st = 'blinkW'; m.t = 0; m.bx = p.x; m.by = p.y; teles.push({ m, type: 'blink', x: p.x, y: p.y, age: 0, life: 0.55 }); }
      }
      if (m.aff.includes('summon') && (m.sumT -= dt) <= 0 && mobs.filter(o => o.st !== 'dead').length < 9) {
        m.sumT = 7; for (let k = 0; k < 2; k++) { const p = randFloorIn(curRoom || rooms[0], hero, 90); makeMob('small', p.x, p.y); } ring(m.x, m.y, 10, 90, 0.5, '#46f0d8', 4); num(m.x, m.y - 30, '唤尸', true, '#46f0d8');
      }
      if (m.aff.includes('poison') && (m.poisonT -= dt) <= 0) { m.poisonT = 2.2; hzPool(m.x, m.y, 34, 4, 8 * m.dmg); }
    }
    switch (m.st) {
      case 'spawn':
        if (rnd() < 0.5) ghostFire(m.x, m.y, 4, 1, 20);
        if (m.t > 0.9) { m.st = 'hop'; m.t = 0; }
        break;
      case 'hop': {
        const rest = 0.16 / m.spd, air = 0.4 / m.spd, cyc = rest + air;
        m.hopT += dt;
        const p = m.hopT % cyc;
        if (p < rest) { m.z = 0; if (p < dt) { m.sx = m.x; m.sy = m.y; const a = angTo(m, hero) + R(-0.35, 0.35); const L = Math.min(46 * m.spd, Math.max(0, dh - 50)); m.tx = m.x + Math.cos(a) * L; m.ty = m.y + Math.sin(a) * L / 2; faceHero(); dust(m.x, m.y, 3, 30); } }
        else { const u = (p - rest) / air; m.z = Math.sin(u * Math.PI) * 17 * K; const nx = lerp(m.sx, m.tx, u), ny = lerp(m.sy, m.ty, u); moveEnt(m, nx - m.x, ny - m.y); }
        if (p < rest && dh < 66 * K && m.clawCd <= 0) {
          m.st = 'claw'; m.t = 0; m.z = 0; faceHero(); m.ang = angTo(m, hero);
          teles.push({ m, type: 'cone', x: m.x, y: m.y, ang: m.ang, age: 0, life: 0.42 * m.cdMul + 0.1, R0: 86 * K });
        } else if (p < rest && dh < 150 * K && dh > 40 && m.atkCd <= 0) {
          m.st = 'windup'; m.t = 0; m.z = 0; faceHero();
          let tx = hero.x + hero.vx * 0.4, ty = hero.y + hero.vy * 0.4; const [gx, gy] = toG(tx, ty); if (!freeAt(gx, gy, 0.2)) { tx = hero.x; ty = hero.y; }
          m.tx = tx; m.ty = ty;
          teles.push({ m, type: 'leap', x: m.tx, y: m.ty, sx: m.x, sy: m.y, age: 0, life: 0.62 * Math.max(0.75, m.cdMul) + 0.42, R0: m.leapR });
        }
        break;
      }
      case 'windup':
        m.z = 0; if (m.t > 0.62 * Math.max(0.75, m.cdMul)) { m.st = 'leap'; m.t = 0; m.sx = m.x; m.sy = m.y; dust(m.x, m.y, 8, 90); }
        break;
      case 'leap': {
        const u = Math.min(1, m.t / 0.42); m.x = lerp(m.sx, m.tx, u); m.y = lerp(m.sy, m.ty, u); m.z = Math.sin(u * Math.PI) * 58 * K;
        if (u >= 1) {
          m.st = 'recover'; m.t = 0; m.z = 0; m.atkCd = R(1.6, 2.4) * m.cdMul;
          dust(m.x, m.y, 18 * K, 150); ring(m.x, m.y, 8, m.leapR * 1.2, 0.4, '#ff3a2a', 4); addShake(5 * K); decal(m.x, m.y, 16 * K, '#05070a', 0.45);
          if (isoD(m.x, m.y, hero.x, hero.y) < m.leapR && hero.inv <= 0) hurtHero(Math.round(11 * m.dmg), m);
          if (m.aff.includes('quake')) { const g0 = R(0, TAU); hzRing(m.x, m.y, 230, 240, Math.round(9 * m.dmg), [g0, g0 + TAU / 3, g0 + TAU * 2 / 3], { col: '#ff8a3a', band: 12 }); }
          if (m.aff.includes('poison')) hzPool(m.x, m.y, 50, 4.5, 10 * m.dmg);
        }
        break;
      }
      case 'claw':
        m.z = 0; if (m.t > 0.42 * m.cdMul + 0.1) {
          m.st = 'swipe'; m.t = 0; m.clawCd = R(1.3, 1.9) * m.cdMul;
          slashes.push({ kind: 'claw', x: m.x + Math.cos(m.ang) * 34 * K, y: m.y + Math.sin(m.ang) * 17 * K, ang: m.ang, face: m.face, age: 0, life: 0.26, s: K });
          const a = angTo(m, hero);
          if (dh < 84 * K && Math.abs(angDiff(a, m.ang)) < 0.95 && hero.inv <= 0) hurtHero(Math.round(7 * m.dmg), m);
        }
        break;
      case 'swipe':
        moveEnt(m, Math.cos(m.ang) * 150 * dt, Math.sin(m.ang) * 75 * dt); m.z = Math.sin(Math.min(1, m.t / 0.16) * Math.PI) * 8;
        if (m.t > 0.16) { m.st = 'recover'; m.t = 0; m.z = 0; }
        break;
      case 'blinkW':
        if (m.t > 0.55) { ghostFire(m.x, m.y, 30, 14, 60, 'p'); m.x = m.bx; m.y = m.by; ghostFire(m.x, m.y, 30, 14, 60, 'p'); ring(m.x, m.y, 50, 6, 0.25, '#c36bff', 3); faceHero(); m.st = 'claw'; m.t = 0.2; m.ang = angTo(m, hero); m.clawCd = 0; teles.push({ m, type: 'cone', x: m.x, y: m.y, ang: m.ang, age: 0.2, life: 0.42 * m.cdMul + 0.1, R0: 86 * K }); }
        break;
      case 'recover': m.z = 0; if (m.t > 0.45 * m.cdMul) { m.st = 'hop'; m.t = 0; m.hopT = 0; } break;
      case 'hit':
        m.z = 0; moveEnt(m, m.kx * dt, m.ky * dt); m.kx *= Math.pow(0.0008, dt); m.ky *= Math.pow(0.0008, dt);
        if (m.t > 0.26) { m.st = 'hop'; m.t = 0; m.hopT = 0; }
        break;
      case 'dead':
        moveEnt(m, m.kx * dt, m.ky * dt); m.kx *= Math.pow(0.002, dt); m.ky *= Math.pow(0.002, dt);
        if (m.t < 0.5 && rnd() < 0.6) parts.push({ t: 'ash', x: m.x + R(-18, 18), y: m.y, z: R(10, 100), vx: R(-20, 20), vy: 0, vz: R(20, 70), life: R(0.6, 1.1), age: 0, s: R(1.5, 3.5) });
        if (m.t > 0.9) m.gone = true;
        break;
    }
    // 精英光环粒子
    if (m.aff.length && m.st !== 'dead' && rnd() < 0.5) { const c = AFFIX[m.aff[0]].col; parts.push({ t: 'aura', x: m.x + R(-20, 20) * K, y: m.y + R(-6, 6), z: R(0, 20), vx: 0, vy: 0, vz: R(30, 70), life: R(0.5, 0.9), age: 0, s: R(2, 4), col: c }); }
  }

  // 首领：尸王·旱魃
  // 招式：三连震地跳 / 缺口冲击波 / 血符雨 / 巨爪横扫 / 唤尸；半血进入暴怒（更快、更多段、连招）
  function updBoss(m, dt) {
    const dh = isoD(m.x, m.y, hero.x, hero.y), P2 = m.phase === 2, cdm = P2 ? 0.65 : 1;
    const faceHero = () => { m.face = hero.x >= m.x ? 1 : -1; };
    if (m.st !== 'dead' && m.phase === 1 && m.hp < m.maxhp * 0.5) {
      m.phase = 2; m.st = 'roar'; m.t = 0; flash('#ff1a0a', 0.35, 0.6); addShake(14); zoomP = 0.06;
      ring(m.x, m.y, 10, 320, 1, '#ff3526', 8); say('尸王暴怒', '攻击更快 · 连招更多', '#ff5a40', 2.4);
      for (let k = 0; k < 3; k++) { const p = randFloorIn(curRoom, hero, 100); makeMob(k ? 'small' : 'js', p.x, p.y); }
    }
    if (m.st !== 'dead' && rnd() < (P2 ? 0.9 : 0.4)) parts.push({ t: 'aura', x: m.x + R(-36, 36), y: m.y + R(-10, 10), z: R(0, 40), vx: 0, vy: 0, vz: R(40, 90), life: R(0.5, 1), age: 0, s: R(3, 6), col: P2 ? '#ff3a2a' : '#c9a054' });
    const choose = () => {
      m.combo++;
      const opts = [];
      if (dh > 110) opts.push('slam', 'slam');
      if (dh < 220) opts.push('sweep', 'sweep');
      opts.push('nova', 'rain');
      if (P2) opts.push('cross', 'cross');
      if (m.combo % 4 === 0 && mobs.filter(o => o.st !== 'dead').length < 6) opts.push('summon', 'summon', 'summon');
      let a = pick(opts); if (a === m.last && rnd() < 0.7) a = pick(opts); m.last = a;
      m.st = a; m.t = 0; m.n = 0; faceHero();
      if (a === 'slam') m.n = P2 ? 4 : 3;
      if (a === 'sweep') { m.ang = angTo(m, hero); hzCone(m.x, m.y, m.ang, 210, 1.15, 0.8 * cdm + 0.1, Math.round(16 * m.dmg), m); }
      if (a === 'nova') { m.waves = P2 ? 3 : 2; m.wt = 0.9 * cdm; }
      if (a === 'rain') m.wt = 0.55;
      if (a === 'summon') m.wt = 0.8;
      if (a === 'cross') {
        // 血爪裂地：两轮放射状长条，第二轮错开半个角度，逼玩家换位
        const g0 = R(0, TAU), n = 6;
        for (let k = 0; k < n; k++) hzCone(m.x, m.y, g0 + k * TAU / n, 420, 0.13, 0.9, Math.round(14 * m.dmg), m, { beam: true });
        for (let k = 0; k < n; k++) hzCone(m.x, m.y, g0 + (k + 0.5) * TAU / n, 420, 0.13, 1.6, Math.round(14 * m.dmg), m, { beam: true });
        say('', '血爪裂地', '#ff6a50', 0.8);
      }
    };
    switch (m.st) {
      case 'intro':
        if (rnd() < 0.8) ghostFire(m.x + R(-30, 30), m.y, 4, 2, 40, 'k');
        if (m.t > 1.8) { m.st = 'chase'; m.t = 0; m.next = 1.0; }
        break;
      case 'roar': m.z = 0; if (m.t > 1.0) { m.st = 'nova'; m.t = 0; m.waves = 3; m.wt = 0.3; } break;
      case 'chase': {
        // 沉重地蹦近
        const cyc = 0.75; m.hopT += dt; const p = m.hopT % cyc;
        if (p < 0.25) { m.z = 0; if (p < dt) { m.sx = m.x; m.sy = m.y; const a = angTo(m, hero), L = Math.min(60, Math.max(0, dh - 90)); m.tx = m.x + Math.cos(a) * L; m.ty = m.y + Math.sin(a) * L / 2; faceHero(); dust(m.x, m.y, 8, 70); addShake(2); } }
        else { const u = (p - 0.25) / 0.5; m.z = Math.sin(u * Math.PI) * 24; moveEnt(m, lerp(m.sx, m.tx, u) - m.x, lerp(m.sy, m.ty, u) - m.y); }
        m.next -= dt; if (m.next <= 0 && p < 0.25) choose();
        break;
      }
      case 'slam': {
        // 每跳：0.22s 下蹲 + 0.42s 腾空；落点圆圈提前出现
        const per = (m.n === (P2 ? 4 : 3) ? 0.7 : 0.55) * (P2 ? 0.85 : 1);
        if (!m.jumping) {
          if (m.t === dt || m.t <= dt + 1e-6 || m.armed !== m.n) {
            m.armed = m.n; faceHero();
            let tx = hero.x + hero.vx * 0.35, ty = hero.y + hero.vy * 0.35; const [gx, gy] = toG(tx, ty); if (!freeAt(gx, gy, m.r / GU)) { tx = hero.x; ty = hero.y; }
            m.tx = tx; m.ty = ty; hzCircle(tx, ty, 100, per, Math.round(15 * m.dmg), { pool: P2 });
            m.jt = 0;
          }
          m.jt += dt; m.z = 0;
          if (m.jt >= per - 0.42) { m.jumping = true; m.jt = 0; m.sx = m.x; m.sy = m.y; dust(m.x, m.y, 12, 120); }
        } else {
          m.jt += dt; const u = Math.min(1, m.jt / 0.42); m.x = lerp(m.sx, m.tx, u); m.y = lerp(m.sy, m.ty, u); m.z = Math.sin(u * Math.PI) * 90;
          if (u >= 1) {
            m.jumping = false; m.z = 0; m.n--; addShake(10); zoomP = Math.max(zoomP, 0.03); dust(m.x, m.y, 26, 220); ring(m.x, m.y, 10, 140, 0.45, '#c9a054', 5);
            if (m.n <= 0) { m.st = 'rest'; m.t = 0; if (P2) { m.st = 'nova'; m.waves = 1; m.wt = 0.35; } }
          }
        }
        break;
      }
      case 'sweep':
        m.z = 0; if (m.t > 0.8 * cdm + 0.1) { m.st = 'rest'; m.t = 0; moveEnt(m, Math.cos(m.ang) * 30, Math.sin(m.ang) * 15); }
        break;
      case 'nova':
        m.z = 0; m.wt -= dt;
        if (m.wt <= 0) {
          const g0 = R(0, TAU), n = P2 ? 2 : 3, gaps = Array.from({ length: n }, (_, k) => g0 + k * TAU / n);
          hzRing(m.x, m.y, 560, P2 ? 300 : 250, Math.round(16 * m.dmg), gaps, { gapW: P2 ? 0.7 : 0.85 });
          addShake(8); flash('#ff2a1a', 0.12, 0.2); ring(m.x, m.y, 10, 90, 0.3, '#fff0e0', 4); dust(m.x, m.y, 20, 200);
          m.waves--; m.wt = 0.55;
          if (m.waves <= 0) { m.st = 'rest'; m.t = 0; }
        }
        break;
      case 'rain':
        m.z = 0; m.wt -= dt;
        if (m.wt <= 0 && !m.rained) {
          m.rained = true; const n = P2 ? 16 : 10;
          for (let k = 0; k < n; k++) {
            let x, y, tries = 0;
            do { const a = R(0, TAU), r = k === 0 ? 0 : R(40, 240); x = hero.x + Math.cos(a) * r; y = hero.y + Math.sin(a) * r / 2; tries++; } while (tries < 10 && !freeAt(...toG(x, y), 0.3));
            hzCircle(x, y, 48, 0.95 + k * 0.07, Math.round(12 * m.dmg), { fx: 'talisman' });
          }
          say('', '血符雨', '#ff6a50', 0.8);
        }
        if (m.t > 1.2) { m.st = 'rest'; m.t = 0; m.rained = false; }
        break;
      case 'summon':
        m.z = 0; m.wt -= dt;
        if (m.wt <= 0 && !m.summoned) {
          m.summoned = true; for (let k = 0; k < (P2 ? 4 : 3); k++) { const p = randFloorIn(curRoom, hero, 100); makeMob(k === 0 && P2 ? 'elite' : 'small', p.x, p.y, k === 0 && P2 ? ['rage'] : []); }
          ring(m.x, m.y, 10, 200, 0.6, '#46f0d8', 5); flash('#46f0d8', 0.12);
        }
        if (m.t > 1.1) { m.st = 'rest'; m.t = 0; m.summoned = false; }
        break;
      case 'cross': m.z = 0; if (m.t > 1.8) { m.st = 'rest'; m.t = 0; } break;
      case 'rest': m.z = 0; if (m.t > (P2 ? 0.45 : 0.8)) { m.st = 'chase'; m.t = 0; m.hopT = 0; m.next = R(0.6, 1.2) * cdm; } break;
      case 'dead':
        if (m.t < 1 && rnd() < 0.9) parts.push({ t: 'ash', x: m.x + R(-40, 40), y: m.y, z: R(10, 180), vx: R(-20, 20), vy: 0, vz: R(20, 70), life: R(0.6, 1.1), age: 0, s: R(2, 4) });
        if (m.t > 1.6) m.gone = true;
        break;
    }
  }

  // ---------- 掉落 ----------
  const RAR = [{ n: '凡', c: '#cfc8b8' }, { n: '良', c: '#6fdc6a' }, { n: '珍', c: '#4aa8ff' }, { n: '绝', c: '#c36bff' }, { n: '传说', c: '#ff9a2a' }];
  const SLOTS = [['剑', ['青锋', '断魂', '镇妖', '追月']], ['刀', ['破甲', '斩尸', '血饮']], ['甲', ['玄铁', '鳞纹', '金缕']], ['盔', ['獬豸', '铁面']], ['戒', ['魂火', '血玉']], ['佩', ['镇魂', '辟邪']], ['靴', ['踏云', '缩地']]];
  const PREF = ['旧', '精制', '寒铁', '幽冥', '尸王'];
  const MATS = [['镇尸符', 0], ['幽火精', 0], ['血枫叶', 0], ['断锁链', 0], ['古铜钱', 0], ['灵兽蛋', 3, '宠物'], ['奇花种子', 2, '种田'], ['古宅图纸', 2, '装饰']];
  function rollRar(min = 0) { const x = rnd(); let r = x < 0.5 ? 0 : x < 0.8 ? 1 : x < 0.94 ? 2 : x < 0.99 ? 3 : 4; return Math.max(min, r); }
  function mkEquip(min = 0, force) { const r = force != null ? force : rollRar(min), [slot, names] = pick(SLOTS); return { kind: 'equip', rar: r, glyph: slot, name: `${PREF[r]}·${pick(names)}${slot}`, power: Math.round((10 + r * 12) * R(0.9, 1.2) * hpScale()) }; }
  function mkMat(rare) { const pool = MATS.filter(m => rare ? m[1] >= 2 : m[1] === 0); const [n, r, use] = pick(pool); return { kind: 'mat', rar: r, glyph: n[0], name: n, use }; }
  function dropLoot(m) {
    const K = m.kind, spill = (it) => loot.push({ x: m.x, y: m.y, z: 30, vx: R(-120, 120), vy: R(-60, 60), vz: R(160, 300), age: 0, item: it });
    const nc = { js: RI(3, 6), small: RI(1, 2), elite: 14, chief: 22, boss: 40 }[K];
    for (let i = 0; i < nc; i++) coins.push({ x: m.x, y: m.y, z: 40, vx: R(-120, 120) * Math.sqrt(KINDS[K].k), vy: R(-60, 60), vz: R(120, 280), age: 0, gem: false });
    if (rnd() < (K === 'js' ? 0.25 : K === 'small' ? 0.08 : 1)) coins.push({ x: m.x, y: m.y, z: 40, vx: R(-60, 60), vy: R(-30, 30), vz: 240, age: 0, gem: true });
    if (K === 'js' || K === 'small') { if (rnd() < 0.06) spill(mkEquip()); if (rnd() < 0.12) spill(mkMat(rnd() < 0.1)); return; }
    if (K === 'elite') { spill(mkEquip(2)); spill(mkEquip(1)); spill(mkMat()); spill(mkMat(rnd() < 0.4)); }
    if (K === 'chief') { spill(mkEquip(3)); spill(mkEquip(2)); spill(mkEquip(1)); spill(mkMat(true)); spill(mkMat()); }
    if (K === 'boss') { spill(mkEquip(4, 4)); spill(mkEquip(3)); spill(mkEquip(2)); spill({ kind: 'mat', rar: 4, glyph: '牙', name: '尸王獠牙', use: '锻造' }); spill(mkMat(true)); spill(mkMat(true)); }
  }
  function updLoot(dt) {
    for (const l of loot) {
      l.age += dt;
      if (l.z > 0 || l.vz > 0) { l.vz -= 900 * dt; moveEnt(l, l.vx * dt, l.vy * dt); l.z += l.vz * dt; if (l.z < 0) { l.z = 0; l.vz = Math.abs(l.vz) > 80 ? -l.vz * 0.35 : 0; l.vx *= 0.5; l.vy *= 0.5; if (!l.vz) l.vx = l.vy = 0; } }
      if (l.age > 0.7 && isoD(l.x, l.y, hero.x, hero.y) < 40) {
        l.dead = true; bag.push(l.item); const r = RAR[l.item.rar];
        toast(`获得 [${r.n}] ${l.item.name}${l.item.use ? '（' + l.item.use + '）' : ''}`, r.c);
        spark(hero.x, hero.y, 6 + l.item.rar * 4, -Math.PI / 2, 1.4, 200, r.c); if (l.item.rar >= 3) { flash(r.c, 0.12, 0.25); ring(hero.x, hero.y, 10, 70, 0.4, r.c, 4); }
      }
    }
    loot = loot.filter(l => !l.dead);
  }
  function drawLootItem(l) {
    const r = RAR[l.item.rar], y = l.y - l.z - 8, bob = l.z ? 0 : Math.sin(T * 3 + l.x) * 2;
    shadow(l.x, l.y, 7, 0.4);
    if (l.item.rar >= 2 && !l.z) { ctx.globalCompositeOperation = 'lighter'; const g = ctx.createLinearGradient(0, l.y - 120, 0, l.y); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, r.c); ctx.globalAlpha = 0.35 + 0.15 * Math.sin(T * 4); ctx.fillStyle = g; ctx.fillRect(l.x - 5, l.y - 120, 10, 120); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    ctx.save(); ctx.translate(l.x, y + bob);
    ctx.fillStyle = '#0b0807'; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(10, 0); ctx.lineTo(0, 11); ctx.lineTo(-10, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = r.c; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = r.c; ctx.font = `900 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(l.item.glyph, 0, 1);
    ctx.restore();
  }
  function drawLootLabels() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 10px ${FONT}`;
    for (const l of loot) if (!l.z && l.item.rar >= 1) {
      const r = RAR[l.item.rar], t = l.item.name, w = ctx.measureText(t).width + 8, y = l.y - 34;
      ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(l.x - w / 2, y - 7, w, 14); ctx.fillStyle = r.c; ctx.fillText(t, l.x, y + 0.5);
    }
  }

  // ---------- 主角 ----------
  function hurtHero(d, src, dot) {
    if (summary || fade > 0) return;
    hero.hp -= d; hero.red = 1; num(hero.x, hero.y, d, false, dot ? '#9cff7a' : '#ff5a48');
    if (!dot) {
      hero.inv = 0.6; addShake(7); flash('#ff1a0a', 0.16, 0.22);
      const a = Math.atan2(hero.y - src.y, hero.x - src.x); hero.vx += Math.cos(a) * 220; hero.vy += Math.sin(a) * 110;
      ink(hero.x, hero.y, 8, a, 200); spark(hero.x, hero.y, 6, a, 1, 200, '#ff6a4a');
    } else flash('#2a8a1a', 0.06, 0.15);
    if (hero.hp <= 0) {
      hero.deaths++; hero.hp = hero.maxhp; hero.inv = 1.6; ring(hero.x, hero.y, 10, 200, 0.6, '#3fe6d0', 6); ghostFire(hero.x, hero.y, 30, 30, 80);
      num(hero.x, hero.y - 10, '回魂', true, '#46f0d8'); say('回魂', '镇魂玉护住一口真气（试玩不会死亡）', '#46f0d8', 1.6);
      for (const o of alive()) hurtMob(o, 0, false, o.x - hero.x, o.y - hero.y, 1.6);
      hazards = hazards.filter(h => h.type === 'pool');
    }
  }
  function nearest(range) { let b = null, bd = range; for (const m of alive()) { const d = isoD(hero.x, hero.y, m.x, m.y) - m.r * 0.6; if (d < bd) { bd = d; b = m; } } return b; }
  const countIn = r => alive().filter(m => isoD(hero.x, hero.y, m.x, m.y) < r + m.r * 0.6).length;
  let gearPow = 0;
  function rollDmg(base) { const crit = rnd() < 0.22; return [Math.round(base * (1 + gearPow / 260) * R(0.9, 1.15) * (crit ? 1.8 : 1)), crit]; }

  // 三连：① 横扫  ② 突进斩  ③ 跃起大劈
  const COMBO = { 1: { wind: 0.06, hold: 0.2, dur: 0.32 }, 2: { wind: 0.06, hold: 0.2, dur: 0.34 }, 3: { wind: 0.18, hold: 0.26, dur: 0.6 } };
  function startAct(type, target) {
    const a = { type, t: 0, target, ang: Math.atan2((target.y - hero.y) * 2, target.x - hero.x), done: {} };
    if (type === 'atk') { hero.combo = hero.comboT > 0 ? (hero.combo % 3) + 1 : 1; a.n = hero.combo; Object.assign(a, COMBO[a.n]); }
    if (type === 'palm') a.dur = 0.62;
    if (type === 'spin') { a.dur = 0.95; a.rot = 0; }
    if (type === 'dash') {
      a.dur = 0.8; const d = isoD(hero.x, hero.y, target.x, target.y), L = Math.min(260, d + 80); a.sx = hero.x; a.sy = hero.y;
      // 终点沿路径逐步检查，不能穿墙
      let ex = hero.x, ey = hero.y;
      for (let s = 8; s <= L; s += 8) { const x = hero.x + Math.cos(a.ang) * s, y = hero.y + Math.sin(a.ang) * s / 2; if (!freeAt(...toG(x, y), hero.r / GU)) break; ex = x; ey = y; }
      a.ex = ex; a.ey = ey; a.hit = new Set();
    }
    hero.face = Math.cos(a.ang) >= 0 ? 1 : -1; hero.act = a;
  }
  function slashFx(x, y, ang, r, o = {}) { slashes.push(Object.assign({ kind: 'arc', x, y, ang, r, age: 0, life: 0.2, dir: 1, w: 0.5, col: 'gold', arc: 2.4, flat: 0.55, mirror: 1, lift: 30 }, o)); }
  function meleeHit(ang, range, half, base, kb, ox = hero.x, oy = hero.y, crit) {
    let hit = 0;
    for (const m of alive()) {
      const dx = m.x - ox, dy = (m.y - oy) * 2, d = Math.hypot(dx, dy);
      if (d > range + m.r) continue;
      let da = Math.atan2(dy, dx) - ang; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > half && d > 26 + m.r) continue;
      const r = rollDmg(base); if (crit) r[1] = true; hurtMob(m, r[0], r[1], dx, dy / 2, kb); hit++;
      if (r[1]) addShake(6);
    }
    return hit;
  }
  function updAct(dt) {
    const a = hero.act; a.t += dt;
    const ca = Math.cos(a.ang), sa = Math.sin(a.ang) / 2;
    if (a.type === 'atk') {
      if (a.t >= a.wind && !a.done.hit) {
        a.done.hit = 1;
        if (a.n === 1) {
          // 横扫：宽、扁的金色弧
          hero.vx += ca * 180; hero.vy += sa * 180;
          slashFx(hero.x + ca * 16, hero.y + sa * 16, a.ang, 78, { arc: 3.1, w: 0.42, flat: 0.4, life: 0.2, lift: 34, dir: hero.face });
          const h = meleeHit(a.ang, 98, 1.45, 17, 0.8); if (h) { hitstop = Math.max(hitstop, 0.05); addShake(3); }
        } else if (a.n === 2) {
          // 突进斩：向前冲一大步，直线刀芒
          hero.vx += ca * 560; hero.vy += sa * 560;
          slashes.push({ kind: 'thrust', x: hero.x, y: hero.y, ang: a.ang, len: 160, age: 0, life: 0.24 });
          for (let i = 0; i < 4; i++) ghosts.push({ x: hero.x + ca * i * 14, y: hero.y + sa * i * 14, face: hero.face, pose: 'run', age: -i * 0.025, life: 0.26 });
          const h = meleeHit(a.ang, 150, 0.5, 21, 1.1); if (h) { hitstop = Math.max(hitstop, 0.055); addShake(4); }
        } else {
          // 跃起大劈：竖向刀弧 + 落地震波
          const px = hero.x + ca * 46, py = hero.y + sa * 46; hero.vx += ca * 140; hero.vy += sa * 140;
          slashFx(hero.x + ca * 14, hero.y + sa * 14, -0.5, 84, { arc: 3.2, w: 0.55, flat: 1, mirror: hero.face, life: 0.3, lift: 50 });
          ring(px, py, 10, 120, 0.45, '#ffd25a', 6); ring(px, py, 6, 74, 0.3, '#fff6d8', 3); dust(px, py, 20, 170); decal(px, py, 20, '#040506', 0.65);
          spark(px, py, 24, -Math.PI / 2, 1.5, 440);
          const h = meleeHit(a.ang, 106, 1.2, 30, 1.6) + meleeHit(0, 72, 9, 12, 1.2, px, py);
          hitstop = Math.max(hitstop, h ? 0.11 : 0.05); addShake(h ? 10 : 5); zoomP = Math.max(zoomP, 0.045);
        }
      }
    } else if (a.type === 'palm') {
      const hx = hero.x + HAND[0] * SLICE.hero.scale * hero.face, hz = -HAND[1] * SLICE.hero.scale;
      if (!a.done.ch) { a.done.ch = 1; ring(hx, hero.y, 70, 6, 0.32, '#46f0d8', 3); ring(hero.x, hero.y, 60, 20, 0.32, '#46f0d8', 2); }
      if (a.t < 0.32) for (let i = 0; i < 4; i++) { const an = R(0, TAU), rr = R(36, 70); parts.push({ t: 'gather', x: hx + Math.cos(an) * rr, y: hero.y + 0.5, z: hz + Math.sin(an) * rr, tx: hx, tz: hz, life: 0.25, age: 0 }); }
      if (a.t >= 0.32 && !a.done.fire) {
        a.done.fire = 1; const tg = a.target.st === 'dead' ? nearest(400) || a.target : a.target;
        const an = Math.atan2((tg.y - hero.y) * 2, tg.x - hero.x);
        for (const off of [-0.34, 0, 0.34]) orbs.push({ x: hx, y: hero.y + 1, z: hz, vx: Math.cos(an + off) * 470, vy: Math.sin(an + off) * 235, tz: 34, age: 0, big: off === 0 });
        ring(hx, hero.y, 4, 46, 0.3, '#e9fffb', 4); hero.vx -= Math.cos(an) * 120; addShake(5); flash('#46f0d8', 0.14, 0.18); zoomP = Math.max(zoomP, 0.03);
      }
    } else if (a.type === 'spin') {
      if (Math.floor(a.t / 0.06) !== Math.floor((a.t - dt) / 0.06)) hero.face = -hero.face;
      a.rot += dt * 16;
      for (const m of alive()) { const d = isoD(hero.x, hero.y, m.x, m.y); if (d < 180 && d > 46) { if (m.kind !== 'boss') moveEnt(m, (hero.x - m.x) / d * 110 * dt, (hero.y - m.y) / d * 110 * dt); } }
      spark(hero.x, hero.y, 2, R(0, TAU), 0.3, 340);
      for (const k of [0.1, 0.24, 0.38, 0.52, 0.66]) if (a.t >= k && !a.done[k]) {
        a.done[k] = 1;
        slashFx(hero.x, hero.y, a.rot, 96, { life: 0.22, w: 0.38, arc: 3.8, lift: 26 }); slashFx(hero.x, hero.y, a.rot + Math.PI, 96, { life: 0.22, w: 0.38, arc: 3.8, lift: 26 });
        const h = meleeHit(0, 120, 9, 13, 0.3); if (h) { hitstop = Math.max(hitstop, 0.03); addShake(4); }
      }
      if (a.t >= 0.8 && !a.done.burst) {
        a.done.burst = 1; ring(hero.x, hero.y, 20, 180, 0.5, '#ffd25a', 8); ring(hero.x, hero.y, 10, 120, 0.35, '#fff6d8', 3);
        spark(hero.x, hero.y, 44, 0, Math.PI, 560); dust(hero.x, hero.y, 22, 220); flash('#ffcf5a', 0.2, 0.25);
        addShake(11); zoomP = Math.max(zoomP, 0.05); hitstop = 0.08; slow = 0.15; meleeHit(0, 160, 9, 24, 2.2);
      }
    } else if (a.type === 'dash') {
      if (a.t < 0.5) dim = Math.max(dim, Math.min(1, a.t / 0.12) * 0.55);
      if (a.t < 0.12) { if (!a.done.c) { a.done.c = 1; ring(hero.x, hero.y, 60, 8, 0.12, '#ff4a3a', 3); } }
      else if (a.t < 0.28) {
        const u = (a.t - 0.12) / 0.16, px = hero.x, py = hero.y; moveEnt(hero, lerp(a.sx, a.ex, u * (2 - u)) - hero.x, lerp(a.sy, a.ey, u * (2 - u)) - hero.y); hero.vx = hero.vy = 0;
        hero.trail += dt; if (hero.trail > 0.018) { hero.trail = 0; ghosts.push({ x: hero.x, y: hero.y, face: hero.face, pose: 'run', age: 0, life: 0.4, col: 'red' }); }
        for (const m of alive()) if (!a.hit.has(m) && isoD(m.x, m.y, hero.x, hero.y) < 52) { a.hit.add(m); const [dmg, crit] = rollDmg(14); hurtMob(m, dmg, crit, m.x - px, (m.y - py), 0.4); }
        dust(hero.x, hero.y, 1, 40);
      } else if (!a.done.fin) {
        a.done.fin = 1; hitstop = 0.06; addShake(8);
        lines.push({ x0: a.sx, y0: a.sy, x1: hero.x, y1: hero.y, age: 0, life: 0.7 });
        slashFx(hero.x + ca * 26, hero.y + sa * 26, a.ang + 0.6, 80, { col: 'blood', life: 0.3, w: 0.6, arc: 2.6 });
        slashFx(hero.x + ca * 26, hero.y + sa * 26, a.ang - 0.6, 80, { col: 'blood', life: 0.3, w: 0.6, arc: 2.6, dir: -1 });
        meleeHit(a.ang, 104, 1.4, 20, 1.0);
      }
      if (a.t >= 0.5 && !a.done.iai) {
        // 一闪：路径上所有被穿过的敌人同时爆开
        a.done.iai = 1; flash('#ff2a1a', 0.32, 0.32); addShake(15); hitstop = 0.12; slow = 0.22; zoomP = Math.max(zoomP, 0.06);
        for (const m of a.hit) if (m.st !== 'dead') {
          slashFx(m.x, m.y, 0.75, 52, { col: 'blood', life: 0.3, w: 0.5, arc: 2.2, flat: 1, lift: 56 });
          slashFx(m.x, m.y, Math.PI - 0.75, 52, { col: 'blood', life: 0.3, w: 0.5, arc: 2.2, flat: 1, lift: 56, dir: -1 });
          const [dmg] = rollDmg(46); hurtMob(m, dmg, true, m.x - a.sx, m.y - a.sy, 1.4); ink(m.x, m.y, 12, R(0, TAU), 320);
        }
      }
    }
    if (a.t >= a.dur) { hero.act = null; if (a.type === 'atk') { hero.atkCd = 0.04; hero.comboT = 0.6; } }
  }
  function heroPose() {
    const a = hero.act;
    if (a) {
      if (a.type === 'atk') return a.t < a.wind ? 'idle' : a.t < a.wind + a.hold ? (a.n === 2 ? 'run' : 'cleave') : 'idle';
      if (a.type === 'palm') return 'cast';
      if (a.type === 'spin') return 'cleave';
      if (a.type === 'dash') return a.t < 0.12 ? 'idle' : a.t < 0.28 ? 'run' : a.t < 0.62 ? 'cleave' : 'idle';
    }
    return hero.moveT > 0.05 ? 'run' : 'idle';
  }

  // ---------- 演示用自动摇杆（?auto / ?capture） ----------
  function shadow(x, y, rx, a = 0.5) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.38, 0, 0, TAU); ctx.fill(); }
  function heroXform(pose, a) {
    let ox = 0, oy = 0, rot = 0, sx = 1, sy = 1;
    if (pose === 'run' && !a) { oy = -Math.abs(Math.sin(hero.bob)) * 4; rot = 0.04 * hero.face; sy = 1 + Math.sin(hero.bob * 2) * 0.02; }
    if (pose === 'idle' && !a) { sy = 1 + Math.sin(T * 2.4) * 0.012; }
    if (a && a.type === 'atk') {
      const k = Math.min(1, a.t / a.wind), st = a.t - a.wind;
      if (a.n === 1) { if (st < 0) { ox = -hero.face * 5 * k; rot = -0.09 * hero.face * k; } else { rot = 0.05 * hero.face * Math.max(0, 1 - st / 0.2); sx = 1 + 0.06 * Math.max(0, 1 - st / 0.1); } }
      if (a.n === 2) { if (st < 0) { ox = -hero.face * 9 * k; sx = 1 - 0.06 * k; sy = 1 + 0.04 * k; } else { const q = Math.max(0, 1 - st / 0.15); sx = 1 + 0.12 * q; sy = 1 - 0.06 * q; rot = 0.08 * hero.face * q; } }
      if (a.n === 3) { if (st < 0) { oy = -Math.sin(k * Math.PI / 2) * 22; rot = -0.16 * hero.face * k; sy = 1 + 0.05 * k; } else { const q = Math.max(0, 1 - st / 0.09); oy = -q * 10; sy = 1 - 0.1 * (1 - q) * Math.max(0, 1 - st / 0.2); sx = 1 + 0.08 * Math.max(0, 1 - st / 0.2); } }
    }
    if (a && a.type === 'dash' && a.t < 0.12) { const k = a.t / 0.12; sy = 1 - 0.1 * k; sx = 1 + 0.06 * k; ox = -hero.face * 7 * k; }
    if (a && a.type === 'palm') { const k = Math.min(1, a.t / 0.32); sy = 1 + k * 0.03; if (a.t > 0.32) ox = -hero.face * 4 * Math.max(0, 1 - (a.t - 0.32) / 0.15); }
    return { ox, oy, rot, sx, sy };
  }
  function drawHero() {
    const pose = heroPose(), s = SPR.hero[pose], a = hero.act;
    if (pose !== hero.pose) { hero.prev = hero.pose; hero.prevX = hero.lastX; hero.blendT = T; hero.pose = pose; }
    const f = heroXform(pose, a); hero.lastX = f;
    shadow(hero.x, hero.y, 22 * (1 + f.oy / 80), 0.55);
    if (hero.inv > 0 && Math.floor(T * 20) % 2 && hero.red < 0.3) ctx.globalAlpha = 0.6;
    // 姿势切换时，上一姿势残留 70ms，形成运动模糊式的过渡
    const bk = 1 - (T - (hero.blendT || -9)) / 0.07;
    if (bk > 0 && hero.prev && SPR.hero[hero.prev]) { const p = hero.prevX || f; drawSpr(SPR.hero[hero.prev], hero.x + p.ox, hero.y + p.oy, hero.face, { rot: p.rot, sx: p.sx, sy: p.sy, alpha: 0.45 * bk }); }
    drawSpr(s, hero.x + f.ox, hero.y + f.oy, hero.face, { rot: f.rot, sx: f.sx, sy: f.sy, flash: hero.red * 0.7, flashImg: s.red });
    ctx.globalAlpha = 1;
  }

  // ---------- 房间流程 ----------
  const ROOM_NAME = { start: '镇妖塔入口', normal: '尸房', elite: '血衣尸卫', chief: '尸将堂', treasure: '藏宝阁', boss: '旱魃殿' };
  let spawnQ = [], waveT = 0, gateT = 0, lastBag = 0, firstDone = false;
  function pickAff(n) { const a = AFF_KEYS.slice(); const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; }
  function roomWaves(rm) {
    const f = floorNo - 1, js = n => Array.from({ length: n }, () => ['js']), sm = n => Array.from({ length: n }, () => ['small']);
    if (rm.type === 'normal') return [[...js(3 + f)], [...js(2 + f), ...sm(3)]];
    if (rm.type === 'elite') return [[['elite', pickAff(2)], ...js(2)], [...js(3), ...sm(2)]];
    if (rm.type === 'chief') return [[['chief', pickAff(3)], ...js(2)], [['elite', pickAff(1)], ...sm(4)]];
    return [];
  }
  function queueWave(rm, wave) {
    wave.forEach(([kind, aff], k) => {
      const big = kind === 'elite' || kind === 'chief', p = big ? { x: cellX(rm.cx, rm.cy), y: cellY(rm.cx, rm.cy) } : randFloorIn(rm, hero, 170);
      spawnQ.push({ t: 0.35 + k * 0.16 + (big ? 0.5 : 0), kind, aff: aff || [], x: p.x, y: p.y, warned: false });
    });
  }
  function startRoom(rm) {
    rm.state = 'fight'; curRoom = rm; rm.wave = 0;
    for (const [i, j] of rm.doors) lock[i + j * MW] = 1;
    addShake(6); flash('#ff2a1a', 0.1, 0.3);
    for (const [i, j] of rm.doors) ring(cellX(i, j), cellY(i, j), 4, 40, 0.5, '#ff3526', 3);
    if (rm.type === 'boss') { spawnBoss(rm); return; }
    rm.waves = roomWaves(rm);
    if (rm.type === 'elite') say('血衣尸卫', '精英 · 词缀随机', '#e3b6ff', 2);
    else if (rm.type === 'chief') say('尸将', '小首领 · 三重词缀 · 会放十字血爪', '#c36bff', 2.2);
    else say('门已封印', `尸房 · 共 ${rm.waves.length} 波`, '#f3dca2', 1.4);
    queueWave(rm, rm.waves[0]);
  }
  function clearRoom(rm) {
    rm.state = 'clear'; curRoom = null; miniDirty = true;
    for (const [i, j] of rm.doors) { lock[i + j * MW] = 0; spark(cellX(i, j), cellY(i, j), 6, -Math.PI / 2, 1.2, 200, '#ff6a40'); }
    ring(hero.x, hero.y, 10, 160, 0.6, '#ffd25a', 5);
    const nc = rm.type === 'normal' ? 6 : 12;
    for (let k = 0; k < nc; k++) coins.push({ x: hero.x + R(-30, 30), y: hero.y + R(-15, 15), z: 120, vx: R(-120, 120), vy: R(-60, 60), vz: R(60, 200), age: 0, gem: k < (rm.type === 'normal' ? 0 : 2) });
    if (rm.type === 'boss') {
      const x = cellX(rm.cx, rm.cy), y = cellY(rm.cx, rm.cy);
      stairs = { x: x + 70, y: y + 20, age: 0 }; homeGate = { x: x - 70, y: y + 20, age: 0 };
      say('首领已镇压', '左：回小院（带回战利品）  右：继续下一层', '#ffd25a', 3.2);
    } else say('镇压完成', rm.type === 'normal' ? '封印解除' : '封印解除 · 精英掉落已散落', '#ffd25a', 1.4);
  }
  function updRooms(dt) {
    // 进房判定：进入房间内缩一格
    if (!curRoom) {
      const ri = roomAt(hero);
      if (ri >= 0) {
        const rm = rooms[ri], [i, j] = cellOf(hero);
        if (rm.state === 'idle' && i >= rm.x + 1 && i <= rm.x + rm.w - 2 && j >= rm.y + 1 && j <= rm.y + rm.h - 2) startRoom(rm);
      }
    }
    for (const q of spawnQ) {
      q.t -= dt;
      if (!q.warned && q.t < 0.45) { q.warned = true; ring(q.x, q.y, 50 * KINDS[q.kind].k, 6, 0.45, '#3fe6d0', 3); }
      if (q.t <= 0) { q.done = true; makeMob(q.kind, q.x, q.y, q.aff); }
    }
    spawnQ = spawnQ.filter(q => !q.done);
    const rm = curRoom;
    if (rm && rm.state === 'fight' && !spawnQ.length && !mobs.some(m => m.st !== 'dead')) {
      if (rm.type !== 'boss' && rm.wave + 1 < rm.waves.length) {
        waveT += dt;
        if (waveT > 0.7) { waveT = 0; rm.wave++; queueWave(rm, rm.waves[rm.wave]); say('', `第 ${rm.wave + 1} 波`, '#f3dca2', 0.9); }
      } else if (rm.type !== 'boss' || !boss) { waveT = 0; clearRoom(rm); }
    }
    // 宝箱
    for (const r of rooms) if (r.chest && !r.chest.open && isoD(hero.x, hero.y, r.chest.x, r.chest.y) < 56) {
      const c = r.chest; c.open = true; c.at = T; r.chestOpen = true; miniDirty = true;
      flash('#ffd25a', 0.18, 0.4); addShake(5); ring(c.x, c.y, 10, 120, 0.6, '#ffd25a', 6); spark(c.x, c.y, 30, -Math.PI / 2, 0.8, 420, '#ffe08a');
      const fake = { x: c.x, y: c.y, kind: 'elite' };
      for (const it of [mkEquip(2), mkEquip(1), mkMat(true)]) loot.push({ x: c.x, y: c.y, z: 30, vx: R(-120, 120), vy: R(-60, 60), vz: R(200, 320), age: 0, item: it });
      for (let k = 0; k < 16; k++) coins.push({ x: fake.x, y: fake.y, z: 30, vx: R(-140, 140), vy: R(-70, 70), vz: R(160, 300), age: 0, gem: k < 3 });
      say('藏宝阁', '宝箱开启', '#ffd25a', 1.4);
    }
    // 出口
    if (stairs && !fadeAct) {
      stairs.age += dt; homeGate.age += dt;
      if (isoD(hero.x, hero.y, stairs.x, stairs.y) < 34) { fadeAct = 'down'; fade = 0.001; }
      else if (isoD(hero.x, hero.y, homeGate.x, homeGate.y) < 34) { fadeAct = 'home'; fade = 0.001; }
    }
    // 装备自动穿戴：每个部位取最高战力
    if (bag.length !== lastBag) {
      lastBag = bag.length; const best = {};
      for (const it of bag) if (it.kind === 'equip') best[it.glyph] = Math.max(best[it.glyph] || 0, it.power);
      const np = Object.values(best).reduce((a, b) => a + b, 0);
      if (np > gearPow) { num(hero.x, hero.y - 20, `战力 +${np - gearPow}`, true, '#ffd25a'); gearPow = np; }
    }
  }
  function initFloor() {
    genFloor();
    mobs = []; parts = []; slashes = []; rings = []; decals = []; nums = []; coins = []; orbs = []; ghosts = []; teles = []; hazards = []; loot = [];
    pillars = []; lines = []; spawnQ = []; boss = null; stairs = null; homeGate = null; curRoom = null; hero.act = null; mini = null; miniDirty = true;
    for (const r of rooms) if (r.type === 'treasure') r.chest = { x: cellX(r.cx, r.cy), y: cellY(r.cx, r.cy), open: false };
    let rm = rooms[0], ii = rm.cx, jj = rm.cy;
    const tgt = START === 'boss' ? rooms.find(r => r.type === 'boss') : START === 'elite' ? rooms.find(r => r.type === 'chief') : null;
    if (tgt && !firstDone) {
      // 直接放到目标房间门内两格，其余房间视为已清
      for (const r of rooms) if (r !== tgt) { r.state = 'clear'; r.seen = true; for (let i = r.x - 1; i <= r.x + r.w; i++) for (let j = r.y - 1; j <= r.y + r.h; j++) if (inB(i, j)) seen[i + j * MW] = 1; }
      for (let k = 0; k < seen.length; k++) if (grid[k] && roomOf[k] < 0) seen[k] = 1;
      const [di, dj] = tgt.doors[Math.floor(tgt.doors.length / 2)];
      ii = clamp(di, tgt.x + 1, tgt.x + tgt.w - 2); jj = clamp(dj, tgt.y + 1, tgt.y + tgt.h - 2);
      ii += Math.sign(tgt.cx - ii); jj += Math.sign(tgt.cy - jj);
      if (START === 'boss') { for (const it of [mkEquip(2), mkEquip(1), mkEquip(3), mkMat(), mkMat(true), mkMat()]) bag.push(it); kills = 34; gold = 412; gems = 6; }
    }
    hero.x = cellX(ii, jj); hero.y = cellY(ii, jj); hero.vx = hero.vy = 0;
    cam.x = hero.x; cam.y = hero.y - 24;
    reveal();
    const fd = firstDone; firstDone = true;
    if (!tgt || fd) say(`镇妖塔 · 第${floorNo}层`, '清理尸房 · 寻找首领 旱魃', '#f3dca2', 2.4);
  }

  // 尸将专属：十字血爪 / 连环震地（周期释放）
  function updChief(m, dt) {
    if (m.kind !== 'chief' || m.st === 'dead' || m.st === 'spawn') return;
    m.spT = (m.spT == null ? 3 : m.spT) - dt;
    if (m.spT <= 0 && m.st === 'hop') {
      m.spT = R(5, 6.5) * m.cdMul; m.st = 'cast'; m.t = 0; m.z = 0; m.face = hero.x >= m.x ? 1 : -1;
      if (rnd() < 0.55) {
        m.cast = 'cross'; const g0 = angTo(m, hero);
        for (let k = 0; k < 4; k++) hzCone(m.x, m.y, g0 + k * Math.PI / 2, 330, 0.15, 0.85, Math.round(13 * m.dmg), m, { beam: true });
        for (let k = 0; k < 4; k++) hzCone(m.x, m.y, g0 + (k + 0.5) * Math.PI / 2, 330, 0.15, 1.45, Math.round(13 * m.dmg), m, { beam: true });
        m.castDur = 1.6; num(m.x, m.y - 40, '十字血爪', true, '#ff6a50');
      } else {
        m.cast = 'quake'; m.castDur = 1.5; m.q = 0; num(m.x, m.y - 40, '连环震地', true, '#ff9a3a');
      }
    }
    if (m.st === 'cast') {
      if (m.cast === 'quake') {
        const ts = [0.45, 0.9, 1.35];
        while (m.q < 3 && m.t >= ts[m.q]) { const g0 = R(0, TAU); hzRing(m.x, m.y, 300, 230, Math.round(10 * m.dmg), [g0, g0 + Math.PI], { col: '#ff8a3a', band: 13, gapW: 0.9 }); addShake(6); dust(m.x, m.y, 16, 160); m.q++; }
      }
      if (m.t > m.castDur) { m.st = 'recover'; m.t = 0; }
    }
  }

  // ---------- 演示自动驾驶（?auto / ?capture） ----------
  let path = null, pathT = 0, pathGoal = null;
  function bfsPath(goal) {
    const [si, sj] = cellOf(hero), s = si + sj * MW, g = goal[0] + goal[1] * MW;
    const prev = new Int32Array(MW * MH).fill(-1); prev[s] = s; const q = [s];
    for (let h = 0; h < q.length; h++) {
      const k = q[h]; if (k === g) break; const i = k % MW, j = (k / MW) | 0;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = i + a, y = j + b; if (walkable(x, y) && prev[x + y * MW] < 0) { prev[x + y * MW] = k; q.push(x + y * MW); } }
    }
    if (prev[g] < 0) return null;
    const out = []; for (let k = g; k !== s; k = prev[k]) out.push(k); return out.reverse();
  }
  function autoGoal() {
    const at = e => [...cellOf(e), e.x, e.y];
    if (stairs) return Q.get('exit') === 'down' ? at(stairs) : (loot.length ? at(loot[0]) : at(homeGate));
    const near = loot.filter(l => !l.z && isoD(l.x, l.y, hero.x, hero.y) < 500).sort((a, b) => isoD(a.x, a.y, hero.x, hero.y) - isoD(b.x, b.y, hero.x, hero.y))[0];
    if (near) return at(near);
    if (coins.length && coins.some(c => c.age < 0.75)) return null;
    const ch = rooms.find(r => r.chest && !r.chest.open && r.seen); if (ch) return at(ch.chest);
    const todo = rooms.filter(r => r.state === 'idle' && r.type !== 'boss' && r.type !== 'treasure');
    const pool = todo.length ? todo : rooms.filter(r => r.state === 'idle' || (r.chest && !r.chest.open));
    if (!pool.length) return null;
    const [hi, hj] = cellOf(hero); pool.sort((a, b) => Math.abs(a.cx - hi) + Math.abs(a.cy - hj) - Math.abs(b.cx - hi) - Math.abs(b.cy - hj));
    return [pool[0].cx, pool[0].cy];
  }
  function dangerVec() {
    let vx = 0, vy = 0;
    const away = (x, y, r, w) => { const dx = hero.x - x, dy = (hero.y - y) * 2, d = Math.hypot(dx, dy) || 1; if (d < r) { const k = w * (1 - d / r) + 0.6; vx += dx / d * k; vy += dy / d * k; } };
    for (const h of hazards) {
      if (h.type === 'circle' && !h.done) away(h.x, h.y, h.r + 26, 2.5);
      else if (h.type === 'pool') away(h.x, h.y, h.r + 14, 1.2);
      else if (h.type === 'cone' && !h.done) {
        const d = isoD(h.x, h.y, hero.x, hero.y), a = Math.atan2((hero.y - h.y) * 2, hero.x - h.x), da = angDiff(a, h.ang);
        if (d < h.r + 30 && Math.abs(da) < h.half + 0.35) {
          if (h.beam) { const s = da >= 0 ? 1 : -1; vx += Math.cos(h.ang + s * Math.PI / 2) * 2.2; vy += Math.sin(h.ang + s * Math.PI / 2) * 2.2; }
          else { const s = da >= 0 ? 1 : -1; vx += Math.cos(h.ang + s * 1.9) * 2.4; vy += Math.sin(h.ang + s * 1.9) * 2.4; }
        }
      } else if (h.type === 'ring') {
        const d = isoD(h.x, h.y, hero.x, hero.y);
        if (d > h.rad - 10 && d - h.rad < 170) {
          const a = Math.atan2((hero.y - h.y) * 2, hero.x - h.x); let best = h.gaps[0];
          for (const g of h.gaps) if (Math.abs(angDiff(a, g)) < Math.abs(angDiff(a, best))) best = g;
          const da = angDiff(best, a);
          if (Math.abs(da) > h.gapW * 0.25) { const s = Math.sign(da); vx += -Math.sin(a) * s * 2.6; vy += Math.cos(a) * s * 2.6; }
          else { vx += Math.cos(a) * 0.4; vy += Math.sin(a) * 0.4; }
        }
      }
    }
    for (const t of teles) {
      if (t.type === 'leap' || t.type === 'blink') away(t.x, t.y, (t.R0 || 52) + 30, 2.2);
      else if (t.type === 'cone') { const d = isoD(t.x, t.y, hero.x, hero.y); if (d < t.R0 + 24) { const a = Math.atan2((hero.y - t.y) * 2, hero.x - t.x); if (Math.abs(angDiff(a, t.ang)) < 1.2) { const s = angDiff(a, t.ang) >= 0 ? 1 : -1; vx += Math.cos(t.ang + s * 2) * 2.2; vy += Math.sin(t.ang + s * 2) * 2.2; } } }
    }
    return [vx, vy];
  }
  let autoT = 0, orbit = 1;
  function autoStick(dt) {
    autoT += dt; pathT -= dt;
    if (summary || fadeAct) return [0, 0];
    let gx = 0, gy = 0;
    const live = alive();
    if (curRoom && live.length) {
      let tg = boss && boss.st !== 'dead' && boss.st !== 'intro' ? boss : nearest(9999);
      if (boss && live.length > 1) { const n = nearest(140); if (n && n !== boss) tg = n; }
      if (tg) {
        const dx = tg.x - hero.x, dy = (tg.y - hero.y) * 2, d = Math.hypot(dx, dy) || 1;
        const want = tg.kind === 'boss' ? 120 : tg.kind === 'chief' ? 80 : 58;
        if (Math.floor(autoT / 3.5) % 2) orbit = -1; else orbit = 1;
        const rad = clamp((d - want) / 50, -1, 1.2);
        gx = dx / d * rad - dy / d * orbit * 0.7; gy = dy / d * rad + dx / d * orbit * 0.7;
      }
    } else if (!curRoom || !live.length) {
      if (pathT <= 0) { pathT = 0.3; pathGoal = autoGoal(); path = pathGoal ? bfsPath(pathGoal) : null; }
      if (pathGoal && pathGoal.length > 2 && (!path || path.length < 2)) {
        const dx = pathGoal[2] - hero.x, dy = (pathGoal[3] - hero.y) * 2, d = Math.hypot(dx, dy) || 1; gx = dx / d; gy = dy / d;
      } else if (path && path.length) {
        const [ci, cj] = cellOf(hero); const idx = path.findIndex(k => k === ci + cj * MW); if (idx >= 0) path.splice(0, idx + 1);
        const k = path[Math.min(2, path.length - 1)];
        if (k != null) { const tx = cellX(k % MW, (k / MW) | 0), ty = cellY(k % MW, (k / MW) | 0); const dx = tx - hero.x, dy = (ty - hero.y) * 2, d = Math.hypot(dx, dy) || 1; gx = dx / d; gy = dy / d; }
      }
    }
    const [vx, vy] = dangerVec(); gx += vx; gy += vy;
    const m = Math.hypot(gx, gy); if (m < 0.15) return [0, 0];
    return [gx / Math.max(1, m), gy / Math.max(1, m) * 0.81];
  }

  // ---------- 更新 ----------
  function update(dt) {
    T += dt;
    let ix = 0, iy = 0;
    if (stick.on) { ix = stick.x; iy = stick.y; }
    else { if (keys.a || keys.arrowleft) ix -= 1; if (keys.d || keys.arrowright) ix += 1; if (keys.w || keys.arrowup) iy -= 1; if (keys.s || keys.arrowdown) iy += 1; const m = Math.hypot(ix, iy); if (m > 1) { ix /= m; iy /= m; } }
    if (AUTO && !stick.on && !ix && !iy) { [ix, iy] = autoStick(dt); }
    stick.vis = [ix, iy];
    if (summary) { ix = iy = 0; }
    shake = Math.max(0, shake - dt * 30); shakeX = R(-1, 1) * shake; shakeY = R(-1, 1) * shake * 0.7;
    SK.forEach(s => { s.flash = Math.max(0, s.flash - dt * 3); });
    zoomP = Math.max(0, zoomP - dt * 0.25); dim = Math.max(0, dim - dt * 1.6);
    for (const f of flashes) f.age += dt; flashes = flashes.filter(f => f.age < f.life);
    if (banner) { banner.age += dt; if (banner.age > banner.life) banner = null; }
    for (const t of toasts) t.age += dt; toasts = toasts.filter(t => t.age < 3.2);
    // 转场
    if (fadeAct) {
      fade = Math.min(1, fade + dt * 2.2);
      if (fade >= 1) {
        if (fadeAct === 'down') { floorNo++; initFloor(); }
        else if (fadeAct === 'home') summary = { age: 0, floor: floorNo, kills, gold, gems, deaths: hero.deaths, items: bag.slice() };
        fadeAct = null;
      }
    } else fade = Math.max(0, fade - dt * 2.2);
    if (summary) { summary.age += dt; return; }
    if (hitstop > 0) { hitstop -= dt; return; }
    if (slow > 0) { slow -= dt; dt *= 0.4; }
    for (const L of [pillars, lines]) for (const q of L) q.age += dt;
    pillars = pillars.filter(q => q.age < q.life); lines = lines.filter(q => q.age < q.life);

    // 主角
    const SPEED = 172;
    let mul = 1;
    if (hero.act) mul = { atk: 0.45, palm: 0.3, spin: 0.8, dash: 0 }[hero.act.type];
    const mag = Math.hypot(ix, iy);
    const tvx = ix * SPEED * mul, tvy = iy * SPEED * 0.62 * mul;
    hero.vx = lerp(hero.vx, tvx, 1 - Math.pow(0.0001, dt)); hero.vy = lerp(hero.vy, tvy, 1 - Math.pow(0.0001, dt));
    moveEnt(hero, hero.vx * dt, hero.vy * dt);
    if (mag > 0.2) { hero.moveT += dt; if (!hero.act) hero.face = ix > 0.1 ? 1 : ix < -0.1 ? -1 : hero.face; hero.bob += dt * 13; } else hero.moveT = 0;
    if (mag > 0.2 && !hero.act) { hero.trail += dt; if (hero.trail > 0.12) { hero.trail = 0; dust(hero.x - ix * 8, hero.y, 2, 25); } }
    hero.inv -= dt; hero.red = Math.max(0, hero.red - dt * 4); hero.atkCd -= dt; hero.comboT -= dt;
    hero.hp = Math.min(hero.maxhp, hero.hp + dt * (curRoom ? 2 : 12));
    SK.forEach(s => { s.t = Math.max(0, s.t - dt); });
    if (hero.act) updAct(dt);
    if (!hero.act && autoOn && alive().length) {
      let started = false;
      for (const s of SK) {
        if (s.t > 0) continue;
        let tg = null;
        if (s.id === 'palm') tg = nearest(320);
        if (s.id === 'spin' && countIn(140) >= 1) tg = nearest(140);
        if (s.id === 'dash') { const n = nearest(260); if (n && isoD(hero.x, hero.y, n.x, n.y) > 70) tg = n; }
        if (tg) { startAct(s.id, tg); s.t = s.cd; s.flash = 1; started = true; break; }
      }
      if (!started && hero.atkCd <= 0) { const n = nearest(84); if (n) startAct('atk', n); }
    }

    // 房间与敌人
    updRooms(dt);
    for (const m of mobs) { updMob(m, dt); updChief(m, dt); }
    const live = mobs.filter(m => m.st !== 'dead');
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j], dx = b.x - a.x, dy = (b.y - a.y) * 2, d = Math.hypot(dx, dy), rr = (a.r + b.r) * 1.05;
      if (d < rr && d > 0.01) {
        const p = (rr - d) / 2 / d, wa = a.kind === 'boss' ? 0 : b.kind === 'boss' ? 2 : 1, wb = 2 - wa;
        if (a.st !== 'leap') moveEnt(a, -dx * p * wa, -dy * p / 2 * wa); if (b.st !== 'leap') moveEnt(b, dx * p * wb, dy * p / 2 * wb);
      }
    }
    mobs = mobs.filter(m => !m.gone);
    updHazards(dt);

    // 法球
    for (const o of orbs) {
      o.age += dt; o.x += o.vx * dt; o.y += o.vy * dt; o.z = lerp(o.z, o.tz, 1 - Math.pow(0.02, dt));
      ghostFire(o.x, o.y, o.z, o.big ? 4 : 2, 22);
      let boom = o.age > 0.9 || !freeAt(...toG(o.x, o.y), 0.1);
      for (const m of alive()) if (isoD(o.x, o.y, m.x, m.y) < 30 + m.r * 0.5) boom = true;
      if (boom) {
        o.dead = true; const big = o.big ? 1.25 : 1;
        ring(o.x, o.y, 10, 100 * big, 0.45, '#46f0d8', 7); ring(o.x, o.y, 4, 64 * big, 0.3, '#e9fffb', 3); ring(o.x, o.y, 20, 140 * big, 0.6, '#1d8f80', 2);
        pillars.push({ x: o.x, y: o.y, age: 0, life: 0.55, s: big }); ghostFire(o.x, o.y, 20, 40, 160); spark(o.x, o.y, 14, -Math.PI / 2, 1.4, 360, '#aafff0');
        addShake(o.big ? 9 : 6); hitstop = Math.max(hitstop, 0.05); decal(o.x, o.y, 24, '#051311', 0.55);
        for (const m of alive()) if (isoD(o.x, o.y, m.x, m.y) < 96 * big + m.r * 0.5) { const [dmg, crit] = rollDmg(o.big ? 34 : 24); hurtMob(m, dmg, crit, m.x - o.x, m.y - o.y, 1.5); }
      }
    }
    orbs = orbs.filter(o => !o.dead);

    // 金币/魂晶
    for (const c of coins) {
      c.age += dt;
      if (c.age < 0.75) { c.vz -= 900 * dt; moveEnt(c, c.vx * dt, c.vy * dt); c.z += c.vz * dt; if (c.z < 0) { c.z = 0; c.vz *= -0.45; c.vx *= 0.6; c.vy *= 0.6; } }
      else { const dx = hero.x - c.x, dy = hero.y - c.y, d = Math.hypot(dx, dy * 2); const sp = 200 + (c.age - 0.75) * 900; c.x += dx / (d || 1) * sp * dt; c.y += dy / (d || 1) * sp * dt; c.z = lerp(c.z, 30, 0.1); if (d < 16) { c.dead = true; if (c.gem) gems++; else gold += 7 + (rnd() * 6 | 0); goldPop = 1; spark(hero.x, hero.y, 3, -Math.PI / 2, 1.5, 120, c.gem ? '#d78bff' : '#ffe08a'); } }
    }
    coins = coins.filter(c => !c.dead); goldPop = Math.max(0, goldPop - dt * 4);
    updLoot(dt);

    // 粒子
    for (const p of parts) {
      p.age += dt;
      if (p.t === 'gather') { const u = p.age / p.life; p.x = lerp(p.x, p.tx, u * 0.5); p.z = lerp(p.z, p.tz, u * 0.5); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.t === 'spark') { p.vz -= 500 * dt; p.vx *= 0.9; p.vy *= 0.9; }
      if (p.t === 'ink') { p.vz -= 900 * dt; if (p.z <= 0) { p.z = 0; if (rnd() < 0.35) decal(p.x, p.y, p.s * 0.8, p.col, 0.6); p.age = 99; } }
      if (p.t === 'fire' || p.t === 'ash' || p.t === 'aura') { p.vx *= 0.95; p.vy *= 0.95; }
      if (p.t === 'dust') { p.vx *= 0.9; p.vy *= 0.9; p.vz *= 0.9; }
      if (p.t === 'paper') { p.vz -= 200 * dt; p.vz = Math.max(p.vz, -40); p.vx *= 0.97; p.rot += p.vr * dt; if (p.z < 0) { p.z = 0; p.vz = 0; p.vx = p.vy = 0; p.vr = 0; } }
    }
    parts = parts.filter(p => p.age < p.life);
    if (parts.length > 1100) parts.splice(0, parts.length - 1100);
    for (const L of [slashes, rings, nums, ghosts, teles]) for (const s of L) s.age += dt;
    slashes = slashes.filter(s => s.age < s.life); rings = rings.filter(s => s.age < s.life); nums = nums.filter(s => s.age < s.life); ghosts = ghosts.filter(s => s.age < s.life);
    teles = teles.filter(s => s.age < s.life && s.m.st !== 'dead' && s.m.st !== 'hit');
    for (const d of decals) d.age += dt;
    decals = decals.filter(d => d.age < 20);
    // 火盆 / 壁灯幽火
    const [i0, i1, j0, j1] = viewCells(1);
    for (const p of props) if (p.k === 'brazier' && rnd() < 0.55) { const [gi, gj] = toG(p.x, p.y); if (gi >= i0 && gi <= i1 && gj >= j0 && gj <= j1 && seen[Math.floor(gi) + Math.floor(gj) * MW]) ghostFire(p.x, p.y + 1, 68, 1, 10); }
    for (const t of torches()) if (rnd() < 0.35) ghostFire(t.x, t.y, t.z + 4, 1, 6);
    if (rnd() < 0.3) parts.push({ t: 'ash', x: cam.x + R(-W / 2, W / 2), y: cam.y + R(-H / 2, H / 2), z: R(0, 40), vx: R(5, 20), vy: R(-5, 5), vz: R(8, 22), life: R(2, 4), age: 0, s: R(1, 2.2) });
    revealT -= dt; if (revealT <= 0) { revealT = 0.1; reveal(); }

    // 相机
    const lx = hero.x + hero.vx * 0.22, ly = hero.y + hero.vy * 0.22 - 24;
    cam.x = lerp(cam.x, lx, 1 - Math.pow(0.02, dt)); cam.y = lerp(cam.y, ly, 1 - Math.pow(0.02, dt));
  }

  // ---------- 绘制 ----------
  function drawThrust(s) {
    const u = s.age / s.life, ca = Math.cos(s.ang), sa = Math.sin(s.ang) / 2;
    const len = s.len * Math.min(1, u / 0.3), fade = 1 - Math.max(0, (u - 0.4) / 0.6);
    const x0 = s.x, y0 = s.y - 34, x1 = x0 + ca * len, y1 = y0 + sa * len, nx = -sa, ny = ca, k = 1 / Math.hypot(nx, ny);
    const quad = (w) => { ctx.beginPath(); ctx.moveTo(x0 + nx * k * w * 0.3, y0 + ny * k * w * 0.3); ctx.lineTo(x1, y1); ctx.lineTo(x0 - nx * k * w * 0.3, y0 - ny * k * w * 0.3); ctx.lineTo(x0 - ca * 10, y0 - sa * 10); ctx.closePath(); };
    ctx.save(); ctx.globalAlpha = 0.5 * fade; ctx.fillStyle = '#030303'; quad(30); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7 * fade; ctx.fillStyle = '#e08a20'; quad(26); ctx.fill();
    ctx.globalAlpha = fade; ctx.fillStyle = '#ffd864'; quad(14); ctx.fill(); ctx.fillStyle = '#fffbe8'; quad(5); ctx.fill();
    ctx.translate(x1, y1); ctx.scale(1, 0.5); ctx.strokeStyle = '#fff2c0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 8 + u * 30, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  function drawClaw(s) {
    const u = s.age / s.life, fade = 1 - u;
    const ks = s.s || 1; ctx.save(); ctx.translate(s.x, s.y - 50 * ks); ctx.scale(s.face * ks, ks);
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 10, p = Math.min(1, u / 0.35);
      ctx.beginPath(); ctx.moveTo(-18 + off, -26); ctx.quadraticCurveTo(off + 6, -4, lerp(-18 + off, 22 + off, p), lerp(-26, 26, p));
      ctx.globalAlpha = 0.8 * fade; ctx.strokeStyle = '#050303'; ctx.lineWidth = 7; ctx.stroke();
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#ff3a26'; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = '#ffd0b0'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  function drawSlash(s) {
    if (s.kind === 'thrust') return drawThrust(s);
    if (s.kind === 'claw') return drawClaw(s);
    const u = s.age / s.life;
    const head = Math.min(1, u / 0.45), tail = Math.max(0, (u - 0.25) / 0.75);
    const a0 = -s.arc / 2, span = s.arc;
    const from = a0 + span * tail, to = a0 + span * head;
    if (to <= from) return;
    ctx.save(); ctx.translate(s.x, s.y - s.lift); ctx.scale(s.mirror, s.flat); ctx.rotate(s.ang); if (s.dir < 0) ctx.scale(1, -1);
    const path = (R0, wid) => {
      ctx.beginPath(); const n = 22;
      for (let i = 0; i <= n; i++) { const a = lerp(from, to, i / n); ctx.lineTo(Math.cos(a) * R0, Math.sin(a) * R0); }
      for (let i = n; i >= 0; i--) { const k = i / n, a = lerp(from, to, k), w = wid * Math.pow(k, 0.7); ctx.lineTo(Math.cos(a) * (R0 - w), Math.sin(a) * (R0 - w)); }
      ctx.closePath();
    };
    const fade = 1 - Math.max(0, (u - 0.55) / 0.45);
    const blood = s.col === 'blood';
    const cg = (c0, c1) => { const g = ctx.createConicGradient(from, 0, 0); const e = Math.min(0.999, (to - from) / TAU); g.addColorStop(0, c0); g.addColorStop(e, c1); g.addColorStop(Math.min(1, e + 0.001), c0); return g; };
    // 墨色外缘
    ctx.globalAlpha = 0.55 * fade; ctx.strokeStyle = '#030303'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, s.r + 3, from + (to - from) * 0.25, to); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6 * fade; ctx.fillStyle = cg('rgba(0,0,0,0)', blood ? 'rgba(200,20,24,1)' : 'rgba(230,130,30,1)'); path(s.r + 3, s.r * s.w * 0.9 + 4); ctx.fill();
    ctx.globalAlpha = fade; ctx.fillStyle = cg('rgba(0,0,0,0)', blood ? 'rgba(255,96,64,1)' : 'rgba(255,214,96,1)'); path(s.r, s.r * s.w * 0.55); ctx.fill();
    ctx.fillStyle = cg('rgba(0,0,0,0)', 'rgba(255,252,236,1)'); path(s.r - 1, s.r * s.w * 0.16); ctx.fill();
    // 速度线
    ctx.strokeStyle = blood ? 'rgba(255,120,90,.7)' : 'rgba(255,230,150,.7)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) { const rr = s.r * (0.62 + i * 0.12), a1 = to - 0.15, a0 = lerp(from, to, 0.35 + i * 0.12); if (a1 > a0) { ctx.beginPath(); ctx.arc(0, 0, rr, a0, a1); ctx.stroke(); } }
    ctx.restore();
  }
  function drawParts(pass) {
    for (const p of parts) {
      const u = p.age / p.life, x = p.x, y = p.y - p.z;
      if (pass === 'add') {
        if (p.t === 'spark') { const sp = Math.hypot(p.vx, p.vy * 2) * 0.03 + 3; ctx.strokeStyle = p.col; ctx.globalAlpha = 1 - u; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * 0.025 - 0.1, y - (p.vy - p.vz) * 0.025); ctx.stroke(); }
        else if (p.t === 'fire' || p.t === 'gather') {
          const k = p.col === 'g' ? ['rgba(190,255,140,', 'rgba(60,160,30,'] : p.col === 'p' ? ['rgba(230,180,255,', 'rgba(120,40,190,'] : p.col === 'k' ? ['rgba(130,255,230,', 'rgba(20,120,110,'] : ['rgba(150,255,235,', 'rgba(20,170,150,'];
          const s = p.t === 'gather' ? 3 : p.s * (1 - u * 0.6);
          ctx.globalAlpha = (1 - u) * 0.8; ctx.fillStyle = k[1] + '0.55)'; ctx.beginPath(); ctx.ellipse(x, y, s * 0.9, s * 1.5, 0, 0, TAU); ctx.fill();
          ctx.globalAlpha = (1 - u); ctx.fillStyle = k[0] + '1)'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.2, s * 0.35, s * 0.7, 0, 0, TAU); ctx.fill();
        }
        else if (p.t === 'aura') { ctx.globalAlpha = Math.sin(u * Math.PI) * 0.75; ctx.fillStyle = p.col; ctx.beginPath(); ctx.ellipse(x, y, p.s * 0.6, p.s * 1.3, 0, 0, TAU); ctx.fill(); }
      } else {
        if (p.t === 'ink') { ctx.globalAlpha = 1; ctx.fillStyle = p.col; ctx.beginPath(); ctx.ellipse(x, y, p.s, p.s * 0.8, 0, 0, TAU); ctx.fill(); }
        else if (p.t === 'dust') { ctx.globalAlpha = (1 - u) * 0.35; ctx.fillStyle = '#9aa7a0'; ctx.beginPath(); ctx.arc(x, y, p.s * (0.6 + u), 0, TAU); ctx.fill(); }
        else if (p.t === 'ash') { ctx.globalAlpha = Math.sin(u * Math.PI) * 0.6; ctx.fillStyle = '#c9c1b0'; ctx.fillRect(x, y, p.s, p.s); }
        else if (p.t === 'paper') { ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.rot * 1.7)); ctx.globalAlpha = Math.min(1, (1 - u) * 3); ctx.fillStyle = '#e2b640'; ctx.fillRect(-4, -7, 8, 14); ctx.fillStyle = '#a3170f'; ctx.fillRect(-1, -5, 2, 10); ctx.restore(); }
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawProp(p) {
    const s = SPR.deco[p.k];
    if (p.k === 'flag') {
      // 旗面摆动：按列切片位移，旗杆端固定
      const dw = s.c.width / RS, dh = s.c.height / RS, x0 = p.x - s.ax / RS, y0 = p.y - s.ay / RS, poleX = s.ax;
      const step = 2 * RS;
      for (let sx = 0; sx < s.c.width; sx += step) {
        const k = Math.max(0, (sx - poleX) / (s.c.width - poleX));
        const off = Math.sin(T * 3.2 + sx / RS * 0.09 + p.t) * 4 * k + Math.sin(T * 5.1 + sx * 0.05) * 1.2 * k;
        ctx.drawImage(s.c, sx, 0, step, s.c.height, x0 + sx / RS, y0 + off, step / RS + 0.3, dh);
      }
      return;
    }
    ctx.drawImage(s.c, p.x - s.ax / RS, p.y - s.ay / RS, s.c.width / RS, s.c.height / RS);
  }
  function drawCoin(c) {
    const y = c.y - c.z;
    shadow(c.x, c.y, 5, 0.4);
    if (c.gem) {
      ctx.save(); ctx.translate(c.x, y - 4); ctx.fillStyle = '#7d2bd1'; ctx.strokeStyle = '#140818'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, -1); ctx.lineTo(0, 7); ctx.lineTo(-5, -1); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e3b6ff'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(2.5, -1); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill(); ctx.restore();
    } else {
      const sq = Math.abs(Math.cos(c.age * 9 + c.vx));
      ctx.fillStyle = '#1a1206'; ctx.beginPath(); ctx.ellipse(c.x, y - 4, 5.5 * sq + 1.2, 5.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f0c34a'; ctx.beginPath(); ctx.ellipse(c.x, y - 4, 4.3 * sq + 0.5, 4.3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff3b0'; ctx.fillRect(c.x - 0.8, y - 7, 1.6, 2.5);
    }
  }
  function drawOrb(o) {
    const y = o.y - o.z;
    shadow(o.x, o.y, 9, 0.35);
    ctx.globalCompositeOperation = 'lighter';
    const OR = o.big ? 34 : 24, g = ctx.createRadialGradient(o.x, y, 0, o.x, y, OR); g.addColorStop(0, 'rgba(230,255,250,1)'); g.addColorStop(0.3, 'rgba(70,240,216,.9)'); g.addColorStop(1, 'rgba(10,80,70,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, y, OR, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#04100e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(o.x, y, 8 + Math.sin(T * 30), 0, TAU); ctx.stroke();
  }
  // 光照层（半分辨率）
  function drawMob(m) {
    const K = KINDS[m.kind].k, S = SPR.mob[m.kind], B = m.kind === 'boss';
    let pose = 'idle', sx = 1, sy = 1, rot = 0, ox = 0, alpha = 1, warn = false, img = null;
    if (m.st === 'leap' || m.st === 'swipe' || m.jumping || m.z > 10) pose = 'jump';
    if (m.st === 'hit' || m.st === 'dead' || m.st === 'roar') pose = 'hit';
    if (m.st === 'hop') { const rest = 0.16 / m.spd, p = m.hopT % (rest + 0.4 / m.spd); if (p < rest) { const k = Math.sin(p / rest * Math.PI); sy = 1 - k * 0.07; sx = 1 + k * 0.04; } else sy = 1.03; }
    if (m.st === 'windup') { const k = Math.min(1, m.t / 0.62); sy = 1 - k * 0.14; sx = 1 + k * 0.07; ox = Math.sin(T * 60) * 2 * k; warn = true; }
    if (m.st === 'claw') { const k = Math.min(1, m.t / 0.42); rot = -0.12 * m.face * k; ox = -m.face * 6 * k; sy = 1 - 0.05 * k; warn = true; }
    if (m.st === 'swipe') { rot = 0.1 * m.face; sx = 1.08; }
    if (m.st === 'cast') { const k = Math.min(1, m.t / 0.3); sy = 1 + 0.06 * k; sx = 1 - 0.03 * k; ox = Math.sin(T * 50) * 2; warn = m.t < 1.2; }
    if (m.st === 'blinkW') { alpha = 1 - Math.min(1, m.t / 0.5) * 0.75; img = S[pose].purple; }
    if (m.st === 'recover') { const k = Math.max(0, 1 - m.t / 0.2); sy = 1 - k * 0.1; sx = 1 + k * 0.06; }
    if (m.st === 'hit') { rot = -0.08 * m.face * Math.max(0, 1 - m.t / 0.26); }
    if (B) {
      if (m.st === 'sweep') { const k = Math.min(1, m.t / 0.7); if (m.t < 0.85) { rot = -0.14 * m.face * k; sy = 1 - 0.06 * k; warn = true; } else { pose = 'jump'; rot = 0.12 * m.face; sx = 1.1; } }
      if (m.st === 'nova' || m.st === 'roar') { sx = 1 + 0.05 * Math.abs(Math.sin(T * 18)); sy = 1 - 0.03 * Math.abs(Math.sin(T * 18)); ox = Math.sin(T * 70) * 2.5; warn = m.st === 'nova'; }
      if (m.st === 'rain' || m.st === 'summon' || m.st === 'cross') { sy = 1 + 0.05 * Math.sin(T * 10); warn = m.t < 1; }
      if (m.st === 'slam' && !m.jumping) { const k = Math.min(1, (m.jt || 0) / 0.2); sy = 1 - 0.12 * k; sx = 1 + 0.06 * k; warn = true; }
    }
    if (m.st === 'dead') { rot = -m.face * Math.min(0.35, m.t * 0.8); alpha = Math.max(0, 1 - m.t / (B ? 1.6 : 0.9)); }
    let rise = 0;
    if (m.st === 'spawn') { const k = Math.min(1, m.t / 0.8); rise = (1 - k * (2 - k)) * 120 * K; alpha = Math.min(1, m.t * 2.5); }
    if (m.st === 'intro') { const k = Math.min(1, m.t / 1.4); rise = (1 - k * (2 - k)) * 240; ox = Math.sin(T * 40) * 3 * (1 - k); }
    const s = S[pose];
    shadow(m.x, m.y, 22 * K * (1 - Math.min(0.4, m.z / (120 * K))), 0.5 * alpha);
    if ((m.aff.length || B) && m.st !== 'dead') {
      const col = B ? (m.phase === 2 ? '#ff3a2a' : '#c9a054') : AFFIX[m.aff[0]].col;
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = col; ctx.globalAlpha = 0.35 + 0.2 * Math.sin(T * 6); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(m.x, m.y, 30 * K, 11 * K, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (rise > 0) { ctx.save(); ctx.beginPath(); ctx.rect(m.x - 100 * K, m.y - 240 * K, 200 * K, 242 * K); ctx.clip(); }
    drawSpr(s, m.x + ox, m.y - m.z + rise, m.face, warn && m.flash <= 0 ? { sx, sy, rot, alpha, img, flash: 0.12 + 0.26 * (0.5 + 0.5 * Math.sin(T * 32)), flashImg: s.red } : { sx, sy, rot, alpha, img, flash: m.flash });
    if (rise > 0) ctx.restore();
    if (!m.name && m.st !== 'dead' && m.st !== 'spawn' && m.hp < m.maxhp) {
      const w = 36 * K, y = m.y - m.z - 128 * K;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(m.x - w / 2 - 1, y - 1, w + 2, 5);
      ctx.fillStyle = '#b3201a'; ctx.fillRect(m.x - w / 2, y, w * Math.max(0, m.hp / m.maxhp), 3);
    }
  }
  // 等距小方盒（宝箱用）
  function isoBox(x, y, hw, hd, h, cl, cr, ct) {
    ctx.fillStyle = cl; ctx.beginPath(); ctx.moveTo(x - hw, y); ctx.lineTo(x, y + hd); ctx.lineTo(x, y + hd - h); ctx.lineTo(x - hw, y - h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = cr; ctx.beginPath(); ctx.moveTo(x, y + hd); ctx.lineTo(x + hw, y); ctx.lineTo(x + hw, y - h); ctx.lineTo(x, y + hd - h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = ct; ctx.beginPath(); ctx.moveTo(x - hw, y - h); ctx.lineTo(x, y + hd - h); ctx.lineTo(x + hw, y - h); ctx.lineTo(x, y - hd - h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#0a0503'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - hw, y - h); ctx.lineTo(x - hw, y); ctx.lineTo(x, y + hd); ctx.lineTo(x + hw, y); ctx.lineTo(x + hw, y - h); ctx.lineTo(x, y - hd - h); ctx.closePath(); ctx.moveTo(x - hw, y - h); ctx.lineTo(x, y + hd - h); ctx.lineTo(x + hw, y - h); ctx.moveTo(x, y + hd - h); ctx.lineTo(x, y + hd); ctx.stroke();
  }
  function drawChest(c) {
    const x = c.x, y = c.y, op = c.open ? Math.min(1, (T - c.at) / 0.25) : 0;
    shadow(x, y + 4, 34, 0.55);
    if (op > 0) { // 掀开的箱盖立在后方
      const L = 22 * op;
      ctx.fillStyle = '#4a2410'; ctx.beginPath(); ctx.moveTo(x - 26, y - 22); ctx.lineTo(x, y - 35); ctx.lineTo(x, y - 35 - L); ctx.lineTo(x - 26, y - 22 - L); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a1a0a'; ctx.beginPath(); ctx.moveTo(x, y - 35); ctx.lineTo(x + 26, y - 22); ctx.lineTo(x + 26, y - 22 - L); ctx.lineTo(x, y - 35 - L); ctx.closePath(); ctx.fill();
    }
    isoBox(x, y, 26, 13, 22, '#5e2c12', '#3e1c0b', op > 0 ? '#120804' : '#7a3a18');
    ctx.strokeStyle = '#d9a640'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x - 13, y + 6.5); ctx.lineTo(x - 13, y + 6.5 - 22); ctx.moveTo(x + 13, y + 6.5); ctx.lineTo(x + 13, y + 6.5 - 22); ctx.stroke();
    if (!op) { isoBox(x, y - 22, 26, 13, 8, '#6e3416', '#4a220c', '#8a4620'); ctx.fillStyle = '#ffd25a'; ctx.fillRect(x - 4, y + 13 - 30, 8, 10); ctx.fillStyle = '#5a3a08'; ctx.fillRect(x - 1, y - 14, 2, 4); }
    ctx.globalCompositeOperation = 'lighter';
    if (!c.open) { ctx.strokeStyle = `rgba(255,210,90,${0.35 + 0.25 * Math.sin(T * 4)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y + 2, 40, 16, 0, 0, TAU); ctx.stroke(); }
    else { const k = Math.max(0, 1 - (T - c.at) / 2.5); if (k > 0) { const g = ctx.createLinearGradient(0, y - 200, 0, y - 20); g.addColorStop(0, 'rgba(255,200,80,0)'); g.addColorStop(1, `rgba(255,220,120,${0.6 * k})`); ctx.fillStyle = g; ctx.fillRect(x - 22, y - 200, 44, 180); } }
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawExits() {
    if (stairs) {
      const { x, y } = stairs, k = Math.min(1, stairs.age / 0.6);
      ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
      ctx.fillStyle = '#010203'; ctx.beginPath(); ctx.moveTo(-44, 0); ctx.lineTo(0, -22); ctx.lineTo(44, 0); ctx.lineTo(0, 22); ctx.closePath(); ctx.fill();
      for (let n = 1; n <= 4; n++) { const s = 1 - n * 0.17; ctx.strokeStyle = `rgba(70,240,216,${0.55 - n * 0.1})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-44 * s, n * 3); ctx.lineTo(0, -22 * s + n * 3); ctx.lineTo(44 * s, n * 3); ctx.stroke(); }
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(70,240,216,${0.6 + 0.3 * Math.sin(T * 5)})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-48, 0); ctx.lineTo(0, -24); ctx.lineTo(48, 0); ctx.lineTo(0, 24); ctx.closePath(); ctx.stroke();
      ctx.restore(); ctx.globalCompositeOperation = 'source-over';
    }
    if (homeGate) {
      const { x, y } = homeGate, k = Math.min(1, homeGate.age / 0.6);
      ctx.save(); ctx.translate(x, y); ctx.scale(k, k * 0.42);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 48); g.addColorStop(0, 'rgba(255,220,120,.55)'); g.addColorStop(1, 'rgba(255,160,40,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 48, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffd25a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 42, 0, TAU); ctx.stroke(); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 32, 0, TAU); ctx.stroke();
      ctx.rotate(T * 0.8);
      for (let n = 0; n < 8; n++) { ctx.rotate(TAU / 8); ctx.fillStyle = '#ffe9a0'; ctx.fillRect(34, -3, 7, 6); }
      ctx.restore(); ctx.globalCompositeOperation = 'source-over';
    }
  }
  function drawSeal(i, j) {
    const x = cellX(i, j), y = cellY(i, j), f = 0.7 + 0.3 * Math.sin(T * 7 + i + j);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, y, 0, y - 96); g.addColorStop(0, `rgba(255,60,40,${0.55 * f})`); g.addColorStop(1, 'rgba(160,10,10,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - HTW * 0.8, y); ctx.lineTo(x, y - HTH * 0.8); ctx.lineTo(x + HTW * 0.8, y); ctx.lineTo(x + HTW * 0.8, y - 90); ctx.lineTo(x - HTW * 0.8, y - 90); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = `rgba(255,90,60,${0.8 * f})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - HTW, y); ctx.lineTo(x, y - HTH); ctx.lineTo(x + HTW, y); ctx.lineTo(x, y + HTH); ctx.closePath(); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    const by = y - 54 + Math.sin(T * 3 + i * 1.7) * 4;
    ctx.save(); ctx.translate(x, by); ctx.rotate(Math.sin(T * 2 + j) * 0.12);
    ctx.fillStyle = '#e2b640'; ctx.fillRect(-8, -15, 16, 30); ctx.fillStyle = '#a3170f'; ctx.font = `900 12px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('封', 0, 0);
    ctx.restore();
  }
  const seenAt = e => { const [i, j] = cellOf(e); return inB(i, j) && seen[i + j * MW]; };

  // 光照层（半分辨率）
  let lightCv = null, lightG = null;
  function drawLighting() {
    const lw = Math.ceil(cv.width / 2), lh = Math.ceil(cv.height / 2);
    if (!lightCv || lightCv.width !== lw || lightCv.height !== lh) { lightCv = mk(lw, lh); lightG = lightCv.getContext('2d'); }
    const g = lightG, k = lw / W;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, lw, lh);
    g.fillStyle = boss && boss.phase === 2 ? 'rgba(10,2,2,0.66)' : 'rgba(2,5,8,0.64)'; g.fillRect(0, 0, lw, lh);
    worldT(g, k);
    g.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 0.75, 0, 0, TAU); g.fill(); };
    hole(hero.x, hero.y - 40, 200, 0.78);
    for (const p of props) if (p.k === 'brazier' && seenAt(p)) hole(p.x, p.y - 60, 150 + Math.sin(T * 9 + p.t) * 8, 0.85);
    for (const t of torches()) hole(t.x, t.y - t.z, 95 + Math.sin(T * 8 + t.x) * 6, 0.7);
    for (const o of orbs) hole(o.x, o.y - o.z, 110, 0.9);
    for (const r of rings) hole(r.x, r.y, r.r1 * 1.6, 0.6 * (1 - r.age / r.life));
    for (const s of slashes) hole(s.x, s.y - 30, 110, 0.7 * (1 - s.age / s.life));
    for (const q of pillars) hole(q.x, q.y - 60, 140 * q.s, 0.8 * (1 - q.age / q.life));
    if (stairs) { hole(stairs.x, stairs.y, 120, 0.7); hole(homeGate.x, homeGate.y - 20, 130, 0.8); }
    for (const r of rooms) if (r.chest && r.seen) hole(r.chest.x, r.chest.y - 20, 110, 0.6);
    if (boss) hole(boss.x, boss.y - 80, 170, 0.45);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(lightCv, 0, 0, cv.width, cv.height);
  }
  function worldT(c = ctx, k = RS) {
    const a = k * (1 + zoomP), fx = hero.x, fy = hero.y - 40;
    c.setTransform(a, 0, 0, a, (fx - cam.x + W / 2 + shakeX) * k - fx * a, (fy - cam.y + H * 0.5 + shakeY) * k - fy * a);
  }
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#020304'; ctx.fillRect(0, 0, cv.width, cv.height);
    worldT();
    drawGround();
    for (const p of props) if (p.k === 'chain' && seenAt(p)) drawProp(p);
    for (const d of decals) {
      ctx.globalAlpha = d.a * Math.min(1, (20 - d.age) / 3); ctx.fillStyle = d.col;
      for (const [bx, by, br] of d.blobs) { ctx.beginPath(); ctx.ellipse(d.x + bx * d.s, d.y + by * d.s, d.s * br, d.s * br * 0.5, 0, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    drawExits();
    drawHazards();
    // 预警：扑杀=轨迹+落点圈；抓挠=扇形；闪现=紫圈
    for (const t of teles) {
      if (t.type === 'cone') {
        const u = Math.min(1, t.age / t.life), R0 = t.R0;
        ctx.save(); ctx.translate(t.x, t.y); ctx.scale(1, 0.5);
        ctx.fillStyle = `rgba(255,30,20,${0.12 + 0.12 * u})`; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R0, t.ang - 0.95, t.ang + 0.95); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,60,40,.35)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R0 * u, t.ang - 0.95, t.ang + 0.95); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = u > 0.85 ? '#fff' : 'rgba(255,70,50,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, R0, t.ang - 0.95, t.ang + 0.95); ctx.stroke();
        ctx.restore(); continue;
      }
      if (t.type === 'blink') {
        const u = Math.min(1, t.age / t.life);
        ctx.strokeStyle = `rgba(195,107,255,${0.5 + 0.5 * u})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(t.x, t.y, 40, 16, 0, 0, TAU); ctx.stroke();
        ctx.fillStyle = `rgba(150,60,220,${0.15 + 0.25 * u})`; ctx.beginPath(); ctx.ellipse(t.x, t.y, 40 * u, 16 * u, 0, 0, TAU); ctx.fill(); continue;
      }
      const u = Math.min(1, t.age / (t.life - 0.42)), mx = t.m.st === 'leap' ? t.sx : t.m.x, my = t.m.st === 'leap' ? t.sy : t.m.y, R0 = t.R0 || 52;
      const dx = t.x - mx, dy = t.y - my, L = Math.hypot(dx, dy * 2) || 1;
      ctx.fillStyle = 'rgba(255,50,40,.55)';
      for (let i = 1; i < L / 22; i++) {
        const q = i * 22 / L; if (q > u + 0.15) break;
        const x = lerp(mx, t.x, q), y = lerp(my, t.y, q), an = Math.atan2(dy, dx);
        ctx.save(); ctx.translate(x, y); ctx.rotate(an); ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-1, 0); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      const blink = u > 0.8 && Math.floor(T * 20) % 2;
      ctx.lineWidth = 2.5; ctx.strokeStyle = blink ? '#ffffff' : `rgba(255,50,40,${0.5 + 0.4 * u})`;
      ctx.beginPath(); ctx.ellipse(t.x, t.y, R0, R0 * 0.39, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = `rgba(220,20,15,${0.18 + 0.2 * u})`; ctx.beginPath(); ctx.ellipse(t.x, t.y, R0 * u, R0 * 0.39 * u, 0, 0, TAU); ctx.fill();
    }
    if (dim > 0) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(10,0,0,${dim})`; ctx.fillRect(0, 0, cv.width, cv.height); ctx.restore(); }
    for (const r of rings) {
      const u = r.age / r.life, rr = lerp(r.r0, r.r1, 1 - Math.pow(1 - u, 2.5));
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = r.col; ctx.globalAlpha = 1 - u; ctx.lineWidth = r.w * (1 - u * 0.6);
      ctx.beginPath(); ctx.ellipse(r.x, r.y, rr, rr * 0.42, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // 深度排序
    const list = [];
    for (const p of props) if (p.k !== 'chain' && seenAt(p)) list.push([p.y, 0, p]);
    wallList(list);
    for (const m of mobs) list.push([m.y, 1, m]);
    list.push([hero.y, 2, hero]);
    for (const c of coins) list.push([c.y, 3, c]);
    for (const o of orbs) list.push([o.y + 2, 4, o]);
    for (const g of ghosts) list.push([g.y - 0.5, 5, g]);
    for (const l of loot) list.push([l.y, 6, l]);
    for (const r of rooms) if (r.chest && r.seen) list.push([r.chest.y, 7, r.chest]);
    if (curRoom) for (const [i, j] of curRoom.doors) if (lock[i + j * MW]) list.push([cellY(i, j), 8, [i, j]]);
    list.sort((a, b) => a[0] - b[0]);
    for (const [, k, e] of list) {
      if (k === 0) drawProp(e); else if (k === 1) drawMob(e); else if (k === 2) drawHero(); else if (k === 3) drawCoin(e); else if (k === 4) drawOrb(e);
      else if (k === 6) drawLootItem(e); else if (k === 7) drawChest(e); else if (k === 8) drawSeal(e[0], e[1]); else if (k === 9) drawWall(e[0], e[1]);
      else if (e.age >= 0) { const u = e.age / e.life; ctx.globalCompositeOperation = 'lighter'; drawSpr(SPR.hero[e.pose], e.x, e.y, e.face, { img: e.col === 'red' ? SPR.hero[e.pose].red : SPR.hero[e.pose].ghost, alpha: 0.55 * (1 - u) }); ctx.globalCompositeOperation = 'source-over'; }
    }
    drawParts('norm');
    for (const s of slashes) drawSlash(s);
    ctx.globalCompositeOperation = 'lighter'; drawParts('add');
    if (hero.act && hero.act.type === 'spin') {
      const a = hero.act, rot = a.rot, k = Math.min(1, a.t / 0.1) * Math.max(0, Math.min(1, (a.dur - a.t) / 0.15));
      ctx.save(); ctx.translate(hero.x, hero.y - 26); ctx.scale(1, 0.45);
      const gg = ctx.createRadialGradient(0, 0, 20, 0, 0, 130); gg.addColorStop(0, 'rgba(255,200,80,0)'); gg.addColorStop(0.7, `rgba(255,190,70,${0.18 * k})`); gg.addColorStop(1, 'rgba(255,160,40,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, 0, 130, 0, TAU); ctx.fill();
      for (let i = 0; i < 4; i++) { const r = 62 + i * 18, sp = rot * (1 + i * 0.25) + i; ctx.strokeStyle = i % 2 ? `rgba(255,240,190,${0.8 * k})` : `rgba(255,190,60,${0.9 * k})`; ctx.lineWidth = 7 - i * 1.3; ctx.beginPath(); ctx.arc(0, 0, r, sp, sp + 2.4); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r, sp + Math.PI, sp + Math.PI + 2.4); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = `rgba(255,220,140,${0.5 * k})`; ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) { const an = rot * 1.4 + i * TAU / 6, r = 100; ctx.beginPath(); ctx.ellipse(hero.x, hero.y - 40 - i * 6, r - i * 6, (r - i * 6) * 0.4, 0, an, an + 0.9); ctx.stroke(); }
    }
    for (const q of pillars) {
      const u = q.age / q.life, h = 190 * q.s * Math.min(1, u / 0.25), w = 34 * q.s * (1 - u * 0.5), al = 1 - u;
      const c = q.red ? ['255,220,200', '255,60,40', '120,10,10'] : ['200,255,245', '70,240,216', '10,90,80'];
      const g = ctx.createLinearGradient(0, q.y, 0, q.y - h); g.addColorStop(0, `rgba(${c[0]},${al})`); g.addColorStop(0.4, `rgba(${c[1]},${0.8 * al})`); g.addColorStop(1, `rgba(${c[2]},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(q.x, q.y - h / 2, w, h / 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(${q.red ? '255,240,230' : '240,255,252'},${al})`; ctx.beginPath(); ctx.ellipse(q.x, q.y - h * 0.35, w * 0.3, h * 0.35, 0, 0, TAU); ctx.fill();
    }
    ctx.lineCap = 'round';
    for (const q of lines) {
      const u = q.age / q.life, al = 1 - u, z = q.ground ? 2 : 34;
      ctx.strokeStyle = q.ground ? `rgba(255,60,30,${0.8 * al})` : `rgba(200,20,20,${0.7 * al})`; ctx.lineWidth = (q.ground ? 18 : 14) * (1 - u * 0.7); ctx.beginPath(); ctx.moveTo(q.x0, q.y0 - z); ctx.lineTo(q.x1, q.y1 - z); ctx.stroke();
      ctx.strokeStyle = `rgba(255,230,210,${al})`; ctx.lineWidth = 3 * (1 - u * 0.7); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    for (const p of props) if (p.k === 'brazier' && seenAt(p)) { const r = 46 + Math.sin(T * 11 + p.t) * 4, g = ctx.createRadialGradient(p.x, p.y - 64, 0, p.x, p.y - 64, r); g.addColorStop(0, 'rgba(90,255,225,.35)'); g.addColorStop(1, 'rgba(0,80,70,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 64, r, 0, TAU); ctx.fill(); }
    for (const t of torches()) { const r = 26 + Math.sin(T * 13 + t.x) * 3, y = t.y - t.z, g = ctx.createRadialGradient(t.x, y, 0, t.x, y, r); g.addColorStop(0, 'rgba(120,255,230,.5)'); g.addColorStop(1, 'rgba(0,80,70,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(t.x, y, r, 0, TAU); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
    drawLighting();
    // 光照之上：预警标记、名牌、数字、标签
    worldT();
    for (const m of mobs) {
      const B = m.kind === 'boss', K = KINDS[m.kind].k;
      const w = m.st === 'windup' || m.st === 'claw' || (m.st === 'cast' && m.t < 1.2) || (B && ['sweep', 'nova', 'rain', 'slam', 'cross', 'summon'].includes(m.st) && m.t < 0.8);
      if (!w) continue;
      const k = Math.min(1, m.t / 0.12), y = m.y - m.z - (B ? 250 : 150 * K) - Math.abs(Math.sin(T * 14)) * 4;
      ctx.save(); ctx.translate(m.x, y); ctx.scale((0.6 + 0.6 * k) * (B ? 1.4 : 1), (0.6 + 0.6 * k) * (B ? 1.4 : 1));
      ctx.fillStyle = '#0a0302'; ctx.beginPath(); ctx.moveTo(-9, -16); ctx.lineTo(9, -16); ctx.lineTo(4, 6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(0, 14, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff3526'; ctx.beginPath(); ctx.moveTo(-6, -13); ctx.lineTo(6, -13); ctx.lineTo(2.5, 3); ctx.lineTo(-2.5, 3); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(0, 14, 3.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const m of mobs) if (m.name && m.kind !== 'boss' && m.st !== 'dead' && m.st !== 'spawn') {
      const K = KINDS[m.kind].k, y = m.y - m.z - 132 * K, w = 58;
      ctx.font = `900 11px ${FONT}`; ctx.lineWidth = 3; ctx.strokeStyle = '#050303'; ctx.strokeText(m.name, m.x, y - 10); ctx.fillStyle = AFFIX[m.aff[0]].col; ctx.fillText(m.name, m.x, y - 10);
      ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(m.x - w / 2 - 1, y - 1, w + 2, 6);
      ctx.fillStyle = m.kind === 'chief' ? '#9a3ad0' : '#c0281c'; ctx.fillRect(m.x - w / 2, y, w * Math.max(0, m.hp / m.maxhp), 4);
      if (m.shieldMax) { ctx.fillStyle = '#7fd8ff'; ctx.fillRect(m.x - w / 2, y + 5, w * m.shield / m.shieldMax, 2); }
    }
    for (const n of nums) {
      const u = n.age / n.life, pop = u < 0.15 ? 1 + (1 - u / 0.15) * (n.crit ? 0.9 : 0.5) : 1;
      const y = n.y - n.z - u * 34, x = n.x + n.vx * u;
      ctx.globalAlpha = Math.min(1, (1 - u) * 3);
      ctx.font = `900 ${(typeof n.v === 'string' ? 15 : n.crit ? 22 : 16) * pop}px ${FONT}`;
      ctx.lineWidth = 4; ctx.strokeStyle = '#0a0503'; ctx.strokeText(n.v, x, y); ctx.fillStyle = n.col; ctx.fillText(n.v, x, y);
    }
    ctx.globalAlpha = 1;
    drawLootLabels();
    const tag = (x, y, t, c) => { ctx.font = `900 12px ${FONT}`; const w = ctx.measureText(t).width + 14; ctx.fillStyle = 'rgba(0,0,0,.7)'; frame(x - w / 2, y - 10, w, 20, 10); ctx.fill(); ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = c; ctx.fillText(t, x, y + 0.5); };
    if (stairs) { tag(stairs.x, stairs.y - 46 + Math.sin(T * 3) * 3, '下一层 ▼', '#46f0d8'); tag(homeGate.x, homeGate.y - 58 + Math.sin(T * 3 + 1) * 3, '回小院', '#ffd25a'); }
    for (const r of rooms) if (r.chest && r.seen && !r.chest.open) tag(r.chest.x, r.chest.y - 62 + Math.sin(T * 3) * 3, '宝箱', '#ffd25a');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const f of flashes) { ctx.globalAlpha = f.a * (1 - f.age / f.life); ctx.fillStyle = f.col; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.globalAlpha = 1;
    drawUI();
    if (fade > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, cv.width, cv.height); }
    if (summary) drawSummary();
  }

  // ---------- 界面 ----------
  const FONT = '"STKaiti","KaiTi","Noto Serif CJK SC","Songti SC",serif';
  const skillPos = () => [[W - 172, H - 86], [W - 112, H - 112], [W - 52, H - 86]];
  const stickHome = () => [86, H - 118];
  function frame(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function drawUI() {
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.65)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    const tg = ctx.createLinearGradient(0, 0, 0, 120); tg.addColorStop(0, 'rgba(0,0,0,.8)'); tg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = tg; ctx.fillRect(0, 0, W, 120);
    // 头像 + 血条
    const px = 46, py = 56;
    ctx.save(); ctx.beginPath(); ctx.arc(px, py, 30, 0, TAU); ctx.fillStyle = '#1a0f12'; ctx.fill(); ctx.clip(); ctx.drawImage(portrait, px - 32, py - 32, 64, 64); ctx.restore();
    ctx.strokeStyle = '#0b0705'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(px, py, 31, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#c9a054'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(px, py, 31, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#7a1410'; ctx.strokeStyle = '#c9a054'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px + 22, py + 22, 10, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffe9b8'; ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(hero.lv, px + 22, py + 22.5);
    ctx.textAlign = 'left'; ctx.font = `700 15px ${FONT}`; ctx.fillStyle = '#e9d6a6'; ctx.fillText('夜无痕', 86, 36);
    if (gearPow) { ctx.font = `700 11px ${FONT}`; ctx.fillStyle = '#ffd25a'; ctx.fillText(`战力 ${1000 + gearPow * 10}`, 146, 37); }
    const bw = 130, hp = Math.max(0, hero.hp / hero.maxhp);
    ctx.fillStyle = '#0a0606'; frame(84, 46, bw + 4, 14, 3); ctx.fill(); ctx.strokeStyle = '#8a6a34'; ctx.lineWidth = 1.2; ctx.stroke();
    const hg = ctx.createLinearGradient(0, 48, 0, 58); hg.addColorStop(0, '#e2463a'); hg.addColorStop(1, '#7a0f0c'); ctx.fillStyle = hg; ctx.fillRect(86, 48, bw * hp, 10);
    ctx.fillStyle = '#fff2dc'; ctx.font = `700 10px ${FONT}`; ctx.fillText(`${Math.ceil(hero.hp)} / ${hero.maxhp}`, 90, 53.5);
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = goldPop > 0 ? '#fff6c8' : '#f0c34a'; ctx.fillText(`金 ${gold}`, 86, 74);
    ctx.fillStyle = '#d78bff'; ctx.fillText(`魂晶 ${gems}`, 140, 74);
    ctx.fillStyle = '#e8d9c0'; ctx.fillText(`行囊 ${bag.length}`, 196, 74);
    // 自动攻击
    const ax = W - 112, ay = 24;
    ctx.fillStyle = 'rgba(14,8,8,.85)'; frame(ax, ay, 98, 32, 16); ctx.fill();
    ctx.strokeStyle = autoOn ? `rgba(230,180,80,${0.7 + 0.3 * Math.sin(T * 5)})` : '#555'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.save(); ctx.translate(ax + 20, ay + 16); ctx.rotate(-0.8); ctx.fillStyle = '#e9c46a'; ctx.fillRect(-1.5, -10, 3, 16); ctx.fillRect(-5, 5, 10, 2.5); ctx.restore();
    ctx.fillStyle = autoOn ? '#f3dca2' : '#888'; ctx.font = `700 14px ${FONT}`; ctx.fillText('自动攻击', ax + 34, ay + 16.5);
    drawMini();
    // 标题
    const rm = rooms[roomAt(hero)];
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(233,214,166,.85)'; ctx.font = `700 12px ${FONT}`;
    const st = curRoom && curRoom.waves && curRoom.waves.length > 1 ? ` · 第${curRoom.wave + 1}/${curRoom.waves.length}波` : '';
    ctx.fillText(`镇妖塔 · 第${floorNo}层 · ${rm ? ROOM_NAME[rm.type] : '甬道'}${st}`, 16, 104); ctx.textAlign = 'center';
    // 首领血条
    if (boss && boss.st !== 'dead') {
      const bw2 = W - 60, x = 30, y = 160, k = boss.st === 'intro' ? Math.min(1, boss.t / 1.2) : 1, f = Math.max(0, boss.hp / boss.maxhp);
      ctx.globalAlpha = k;
      ctx.font = `900 16px ${FONT}`; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(boss.name, W / 2, y - 14); ctx.fillStyle = boss.phase === 2 ? '#ff6a50' : '#f3dca2'; ctx.fillText(boss.name, W / 2, y - 14);
      ctx.fillStyle = '#080404'; frame(x - 2, y - 2, bw2 + 4, 14, 3); ctx.fill(); ctx.strokeStyle = '#c9a054'; ctx.lineWidth = 1.4; ctx.stroke();
      const gg = ctx.createLinearGradient(0, y, 0, y + 10); gg.addColorStop(0, boss.phase === 2 ? '#ff5a2a' : '#d8342a'); gg.addColorStop(1, '#5a0806'); ctx.fillStyle = gg; ctx.fillRect(x, y, bw2 * f * k, 10);
      ctx.fillStyle = '#c9a054'; ctx.fillRect(x + bw2 * 0.5 - 1, y - 3, 2, 16);
      ctx.font = `700 10px ${FONT}`; ctx.fillStyle = '#fff2dc'; ctx.fillText(boss.phase === 2 ? '第二阶段 · 暴怒' : '第一阶段', W / 2, y + 22);
      ctx.globalAlpha = 1;
    }
    // 横幅
    if (banner) {
      const b = banner, u = b.age / b.life, a = Math.min(1, b.age / 0.15, (b.life - b.age) / 0.4), y = H * 0.3;
      ctx.globalAlpha = Math.max(0, a);
      if (b.text) {
        const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,.7)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, y - 30, W, b.sub ? 66 : 52);
        ctx.font = `900 ${28 + (1 - Math.min(1, b.age / 0.2)) * 10}px ${FONT}`; ctx.lineWidth = 5; ctx.strokeStyle = '#0a0302'; ctx.strokeText(b.text, W / 2, y); ctx.fillStyle = b.col; ctx.fillText(b.text, W / 2, y);
        ctx.strokeStyle = b.col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W / 2 - 120 * Math.min(1, b.age / 0.3), y + 18); ctx.lineTo(W / 2 + 120 * Math.min(1, b.age / 0.3), y + 18); ctx.stroke();
      }
      if (b.sub) { ctx.font = `700 13px ${FONT}`; ctx.fillStyle = '#e9d6a6'; ctx.fillText(b.sub, W / 2, b.text ? y + 30 : y); }
      ctx.globalAlpha = 1;
    }
    // 拾取提示
    ctx.textAlign = 'left';
    toasts.forEach((t, i) => {
      const a = Math.min(1, t.age / 0.15, (3.2 - t.age) / 0.5), y = H - 200 - (toasts.length - 1 - i) * 22, x = 12 - (1 - Math.min(1, t.age / 0.15)) * 30;
      ctx.globalAlpha = Math.max(0, a); ctx.font = `700 12px ${FONT}`; const w = ctx.measureText(t.text).width + 16;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; frame(x, y - 10, w, 20, 4); ctx.fill(); ctx.fillStyle = t.col; ctx.fillRect(x, y - 10, 3, 20); ctx.fillText(t.text, x + 9, y + 0.5);
    });
    ctx.globalAlpha = 1; ctx.textAlign = 'center';
    // 摇杆
    const [hx, hy] = stick.on ? [stick.bx, stick.by] : stickHome();
    const [vx, vy] = stick.vis || [0, 0];
    ctx.globalAlpha = stick.on ? 1 : 0.75;
    ctx.fillStyle = 'rgba(8,10,12,.55)'; ctx.beginPath(); ctx.arc(hx, hy, 58, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8a6a34'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy, 58, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(201,160,84,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hx, hy, 50, 0, TAU); ctx.stroke();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 - Math.PI / 2; ctx.save(); ctx.translate(hx + Math.cos(a) * 44, hy + Math.sin(a) * 44); ctx.rotate(a + Math.PI / 2); ctx.fillStyle = 'rgba(201,160,84,.6)'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(5, 2); ctx.lineTo(-5, 2); ctx.closePath(); ctx.fill(); ctx.restore(); }
    const kx = hx + clamp(vx, -1, 1) * 34, ky = hy + clamp(vy, -1, 1) * 34;
    if (Math.hypot(vx, vy) > 0.1) { ctx.strokeStyle = 'rgba(255,210,110,.8)'; ctx.lineWidth = 4; const a = Math.atan2(vy, vx); ctx.beginPath(); ctx.arc(hx, hy, 58, a - 0.45, a + 0.45); ctx.stroke(); }
    const kg = ctx.createRadialGradient(kx - 6, ky - 8, 2, kx, ky, 26); kg.addColorStop(0, '#5b4a3a'); kg.addColorStop(1, '#17100c'); ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(kx, ky, 25, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#c9a054'; ctx.lineWidth = 2; ctx.stroke();
    ctx.globalAlpha = 1;
    // 技能
    ctx.fillStyle = 'rgba(233,214,166,.85)'; ctx.font = `700 12px ${FONT}`; ctx.fillText('技能自动释放', W - 112, H - 156);
    skillPos().forEach(([x, y], i) => {
      const s = SK[i], r = 25, cdk = s.t / s.cd;
      ctx.fillStyle = '#0b0807'; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(x, y - 6, 2, x, y, r); g.addColorStop(0, '#3a2a22'); g.addColorStop(1, '#120c0a'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = s.color; ctx.font = `900 24px ${FONT}`; ctx.shadowColor = s.color; ctx.shadowBlur = cdk > 0 ? 0 : 10; ctx.globalAlpha = cdk > 0 ? 0.45 : 1; ctx.fillText(s.glyph, x, y + 1); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      if (cdk > 0) { ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * cdk); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = `700 13px ${FONT}`; ctx.fillText(s.t >= 1 ? Math.ceil(s.t) : s.t.toFixed(1), x, y + 1); }
      ctx.strokeStyle = cdk > 0 ? '#6a5130' : '#e3b65a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 1, 0, TAU); ctx.stroke();
      if (s.flash > 0) { ctx.strokeStyle = s.color; ctx.globalAlpha = s.flash; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 4 + (1 - s.flash) * 14, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.fillStyle = 'rgba(233,214,166,.75)'; ctx.font = `700 10px ${FONT}`; ctx.fillText(s.name, x, y + r + 12);
    });
  }
  // 回小院：本次战果
  function drawSummary() {
    const S = summary, a = Math.min(1, S.age / 0.4);
    ctx.setTransform(RS, 0, 0, RS, 0, 0); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(4,3,3,.88)'; ctx.fillRect(0, 0, W, H);
    const x = 22, w = W - 44, y = 90 + (1 - a) * 30, h = H - 200;
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#1d1410'); g.addColorStop(1, '#0d0907'); ctx.fillStyle = g; frame(x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = '#c9a054'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.strokeStyle = 'rgba(201,160,84,.35)'; frame(x + 5, y + 5, w - 10, h - 10, 7); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd25a'; ctx.font = `900 26px ${FONT}`; ctx.fillText('回到小院', W / 2, y + 38);
    ctx.fillStyle = '#e9d6a6'; ctx.font = `700 13px ${FONT}`; ctx.fillText(`镇妖塔第 ${S.floor} 层 · 首领已镇压`, W / 2, y + 66);
    const stats = [['斩尸', S.kills, '#e8d9c0'], ['金', S.gold, '#f0c34a'], ['魂晶', S.gems, '#d78bff'], ['回魂', S.deaths, '#46f0d8']];
    stats.forEach(([n, v, c], i) => { const sx = x + w * (i + 0.5) / 4; ctx.fillStyle = c; ctx.font = `900 20px ${FONT}`; ctx.fillText(v, sx, y + 100); ctx.fillStyle = 'rgba(233,214,166,.7)'; ctx.font = `700 11px ${FONT}`; ctx.fillText(n, sx, y + 122); });
    ctx.strokeStyle = 'rgba(201,160,84,.4)'; ctx.beginPath(); ctx.moveTo(x + 20, y + 140); ctx.lineTo(x + w - 20, y + 140); ctx.stroke();
    ctx.fillStyle = '#e9d6a6'; ctx.font = `700 13px ${FONT}`; ctx.fillText(`行囊 · ${S.items.length} 件`, W / 2, y + 158);
    const items = S.items.slice().sort((p, q) => q.rar - p.rar).slice(0, 12);
    ctx.textAlign = 'left';
    items.forEach((it, i) => {
      const r = RAR[it.rar], col = i % 2, row = i >> 1, ix = x + 18 + col * (w - 36) / 2, iy = y + 184 + row * 30;
      ctx.fillStyle = '#0b0807'; ctx.beginPath(); ctx.moveTo(ix + 11, iy - 11); ctx.lineTo(ix + 22, iy); ctx.lineTo(ix + 11, iy + 11); ctx.lineTo(ix, iy); ctx.closePath(); ctx.fill(); ctx.strokeStyle = r.c; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = r.c; ctx.font = `900 10px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(it.glyph, ix + 11, iy + 0.5); ctx.textAlign = 'left';
      ctx.font = `700 11px ${FONT}`; ctx.fillText(it.name, ix + 27, iy - 4);
      ctx.fillStyle = 'rgba(233,214,166,.6)'; ctx.font = `700 9px ${FONT}`; ctx.fillText(it.kind === 'equip' ? `${r.n} · 战力 ${it.power}` : it.use ? `→ 家园 · ${it.use}` : `${r.n} · 材料`, ix + 27, iy + 8);
    });
    const uses = {}; for (const it of S.items) if (it.use) uses[it.use] = (uses[it.use] || 0) + 1;
    ctx.textAlign = 'center'; ctx.fillStyle = '#46f0d8'; ctx.font = `700 12px ${FONT}`;
    const ut = Object.entries(uses).map(([k, v]) => `${k}×${v}`).join('  ');
    ctx.fillText(ut ? `可带回家园：${ut}` : '家园材料：本次未获得', W / 2, y + h - 56);
    ctx.fillStyle = 'rgba(233,214,166,.55)'; ctx.font = `700 10px ${FONT}`; ctx.fillText('（宠物 / 种田 / 装饰 / 锻造 将在小院系统接入）', W / 2, y + h - 38);
    const bx = W / 2 - 80, by = y + h + 22, pulse = 0.7 + 0.3 * Math.sin(T * 4);
    ctx.fillStyle = '#3a1a10'; frame(bx, by, 160, 40, 20); ctx.fill(); ctx.strokeStyle = `rgba(255,210,90,${pulse})`; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffe9b8'; ctx.font = `900 15px ${FONT}`; ctx.fillText('再入镇妖塔', W / 2, by + 20.5);
    ctx.globalAlpha = 1;
  }

  // ---------- 输入 ----------
  function toLogical(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / ZOOM, (e.clientY - r.top) / ZOOM]; }
  cv.addEventListener('pointerdown', e => {
    const [x, y] = toLogical(e);
    if (summary) { if (summary.age > 0.6) { summary = null; floorNo = 1; hero.hp = hero.maxhp; initFloor(); } return; }
    if (y < 64 && x > W - 120) { autoOn = !autoOn; return; }
    if (stick.on || y < 150) return;
    if (x > W - 200 && y > H - 190) return;
    stick.on = true; stick.id = e.pointerId; stick.bx = x; stick.by = y; stick.x = stick.y = 0; cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    if (!stick.on || e.pointerId !== stick.id) return;
    const [x, y] = toLogical(e); let dx = x - stick.bx, dy = y - stick.by; const d = Math.hypot(dx, dy), max = 48;
    if (d > max) { stick.bx += dx / d * (d - max); stick.by += dy / d * (d - max); dx = dx / d * max; dy = dy / d * max; }
    stick.x = dx / max; stick.y = dy / max;
  });
  const up = e => { if (e.pointerId === stick.id) { stick.on = false; stick.id = null; stick.x = stick.y = 0; } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  // ---------- 启动 ----------
  let last = 0;
  function loop(ts) { const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts; update(dt); render(); requestAnimationFrame(loop); }
  window.addEventListener('resize', () => { if (CAPTURE) return; const oldRS = RS; resize(); if (RS !== oldRS) { buildSprites(); mini = null; miniDirty = true; } });
  resize();
  Promise.all([load('hero', SLICE.hero.file), load('js', SLICE.js.file), load('tiles', SLICE.tiles.file), load('deco', SLICE.deco.file)]).then(() => {
    buildSprites(); initFloor();
    document.getElementById('loading').remove();
    if (CAPTURE) {
      window.__step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) update(dt); render(); };
      window.__frame = (q = 0.85) => cv.toDataURL('image/jpeg', q);
      window.__state = () => ({ floor: floorNo, room: curRoom && curRoom.type, mobs: mobs.length, boss: boss && [boss.st, Math.round(boss.hp), boss.phase], hp: Math.round(hero.hp), deaths: hero.deaths, kills, bag: bag.length, clear: rooms.filter(r => r.state === 'clear').length + '/' + rooms.length, summary: !!summary, x: Math.round(hero.x), y: Math.round(hero.y) });
      window.DONE = true;
    } else requestAnimationFrame(ts => { last = ts; loop(ts); });
  }).catch(err => { document.getElementById('loading').textContent = '素材载入失败：' + err.message; console.error(err); });
})();

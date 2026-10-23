/* 镇妖塔 · 一房间试制（hades-pack-v1）
 * 一个房间、一个主角、一种跳尸。摇杆只管移动；攻击与技能全部自动。
 * 素材为独立关键姿势（不是连续帧）：节奏靠短位移、停顿、闪白、刀光与粒子，
 * 命中/范围/伤害全部由代码判定，不按图片边缘推断。 */
(() => {
  'use strict';
  const ASSET = '../../assets/art-reference/hades-pack-v1/';
  const Q = new URLSearchParams(location.search);
  const CAPTURE = Q.has('capture');
  const AUTO = Q.has('auto') || CAPTURE;

  // ---------- 随机 ----------
  let seed = 20261023 >>> 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const R = (a, b) => a + (b - a) * rnd();
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  const isoD = (ax, ay, bx, by) => Math.hypot(bx - ax, (by - ay) * 2);

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
  const IMG = {};
  const load = (k, f) => new Promise((ok, no) => { const i = new Image(); i.onload = () => { IMG[k] = i; ok(); }; i.onerror = () => no(new Error(f)); i.src = ASSET + f; });

  const SPR = { hero: {}, js: {}, tiles: [], deco: {} };
  let portrait = null;
  function buildSprites() {
    for (const who of ['hero', 'js']) {
      const S = SLICE[who], img = IMG[who];
      for (const [name, [i, x0, y0, x1, y1]] of Object.entries(S.poses)) {
        const k = S.scale * RS, c = bake(img, i * S.fw + x0, y0, x1 - x0, y1 - y0, k);
        SPR[who][name] = { c, white: tint(c, '#fff'), red: tint(c, '#ff2a1a'), ghost: tint(c, who === 'hero' ? '#3fe6d0' : '#000'),
          ax: (S.anchor[0] - x0) * k, ay: (S.anchor[1] - y0) * k };
      }
    }
    const tileW = TW * 1.07 * RS;
    SLICE.tiles.boxes.forEach(([x, y, w, h]) => SPR.tiles.push(bake(IMG.tiles, x, y, w, h, tileW / w)));
    for (const [name, [x, y, w, h, fx, fy, s]] of Object.entries(SLICE.deco.items)) {
      const c = bake(IMG.deco, x, y, w, h, s * RS);
      SPR.deco[name] = { c, ax: w * fx * s * RS, ay: h * fy * s * RS };
    }
    portrait = bake(IMG.hero, 395, 58, 140, 140, 64 * RS / 140);
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

  // ---------- 房间 ----------
  const N = 8, TW = 104, TH = 52, HW = N * TW / 2, HH = N * TH / 2, LIM = 0.86;
  const props = [];
  let groundCv = null; const GB = { x0: -HW - 20, y0: -HH - 30, x1: HW + 20, y1: HH + 120 };
  function buildRoom() {
    const P = (k, x, y, r) => props.push({ k, x, y, r, t: R(0, 10) });
    P('column', -352, 0, 22); P('column', 352, 0, 22); P('statue', 0, -170, 26);
    P('brazier', -200, -86, 20); P('brazier', 200, -86, 20); P('brazier', -200, 88, 20); P('brazier', 200, 88, 20);
    P('flag', -104, -146, 10); P('flag', 112, -142, 10);
    P('grave', -292, -34, 24); P('grave', 286, 40, 24);
    P('maple', -96, 138, 22); P('maple', 300, -36, 20); P('maple', -276, 52, 20);
    // 地面烘焙
    const gw = GB.x1 - GB.x0, gh = GB.y1 - GB.y0;
    groundCv = mk(gw * RS, gh * RS); const g = groundCv.getContext('2d');
    g.scale(RS, RS); g.translate(-GB.x0, -GB.y0);
    // 平台侧面
    const D = 84;
    const side = (ax, ay, bx, by, shade) => {
      const gr = g.createLinearGradient(0, Math.min(ay, by), 0, Math.max(ay, by) + D);
      gr.addColorStop(0, shade); gr.addColorStop(1, '#020405');
      g.fillStyle = gr; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(bx, by + D); g.lineTo(ax, ay + D); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1.2;
      for (let r = 1; r < 4; r++) { g.beginPath(); g.moveTo(ax, ay + r * 20); g.lineTo(bx, by + r * 20); g.stroke(); }
      for (let u = 0; u <= 1; u += 1 / 12) { const x = lerp(ax, bx, u), y = lerp(ay, by, u); g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + D * 0.8); g.stroke(); }
    };
    side(-HW, 0, 0, HH, '#18302f'); side(0, HH, HW, 0, '#0f2120');
    // 地砖
    const order = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) order.push([i, j]);
    order.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    for (const [i, j] of order) {
      const cx = (i - j) * TW / 2, cy = (i + j - (N - 1)) * TH / 2;
      let idx;
      const cen = (i === 3 || i === 4) && (j === 3 || j === 4);
      if (cen) idx = 8 + ((i - 3) * 2 + (j - 3));
      else { const r = rnd(); idx = r < 0.1 ? 12 + (rnd() * 4 | 0) : r < 0.38 ? 4 + (rnd() * 4 | 0) : (rnd() * 4 | 0); }
      const t = SPR.tiles[idx], w = TW * 1.07, h = w * t.height / t.width;
      g.drawImage(t, cx - w / 2, cy - h / 2 + 1, w, h);
    }
    // 边沿金线
    g.strokeStyle = 'rgba(201,160,84,.55)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-HW, 1); g.lineTo(0, HH + 1); g.lineTo(HW, 1); g.stroke();
    // 锁链贴地
    const ch = SPR.deco.chain;
    g.globalAlpha = 0.95; g.drawImage(ch.c, 70 - ch.ax / RS, 34 - ch.ay / RS, ch.c.width / RS, ch.c.height / RS);
    g.save(); g.translate(-150, -20); g.scale(-0.8, 0.8); g.drawImage(ch.c, -ch.ax / RS, -ch.ay / RS, ch.c.width / RS, ch.c.height / RS); g.restore();
    g.globalAlpha = 1;
  }
  function keepIn(e, m = LIM) {
    const f = Math.abs(e.x) / HW + Math.abs(e.y) / HH;
    if (f > m) { e.x *= m / f; e.y *= m / f; }
    for (const p of props) {
      const dx = e.x - p.x, dy = (e.y - p.y) * 2, d = Math.hypot(dx, dy), rr = p.r + (e.r || 14);
      if (d < rr && d > 0.01) { e.x = p.x + dx / d * rr; e.y = p.y + dy / d * rr / 2; }
    }
  }

  // ---------- 状态 ----------
  const hero = { x: 0, y: 40, vx: 0, vy: 0, face: 1, r: 14, hp: 120, maxhp: 120, act: null, atkCd: 0, combo: 0, comboT: 0, inv: 0, flash: 0, red: 0, moveT: 0, bob: 0, trail: 0, lv: 12 };
  const SK = [
    { id: 'palm', name: '幽冥掌', glyph: '掌', color: '#46f0d8', cd: 4.5, t: 1.2, flash: 0 },
    { id: 'spin', name: '金轮斩', glyph: '旋', color: '#f2c45a', cd: 7, t: 3.0, flash: 0 },
    { id: 'dash', name: '血影斩', glyph: '斩', color: '#ff4a3a', cd: 9, t: 5.0, flash: 0 },
  ];
  let mobs = [], parts = [], slashes = [], rings = [], decals = [], nums = [], coins = [], orbs = [], ghosts = [], teles = [];
  let slow = 0, dim = 0, zoomP = 0, flashes = [], pillars = [], lines = [];
  let T = 0, hitstop = 0, shake = 0, shakeX = 0, shakeY = 0, kills = 0, gold = 0, gems = 0, spawnT = 0.4, wave = 1, autoOn = true, goldPop = 0;
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
  function num(x, y, v, crit, col) { nums.push({ x: x + R(-22, 22), y, z: R(62, 96), v, crit, col: col || (crit ? '#ffd24a' : '#fff4dc'), age: 0, life: crit ? 0.95 : 0.7, vx: R(-20, 20) }); }
  function addShake(v) { shake = Math.max(shake, v); }
  function decal(x, y, s, col, a = 0.8) { decals.push({ x, y, s, col, a, age: 0, rot: R(0, TAU), blobs: Array.from({ length: 5 }, () => [R(-1, 1), R(-0.5, 0.5), R(0.3, 0.8)]) }); if (decals.length > 70) decals.shift(); }

  // ---------- 敌人 ----------
  function spawnMob() {
    let x, y, k = 0;
    do { const a = R(0, TAU), r = R(0.35, 0.8); x = Math.cos(a) * HW * r * 0.9; y = Math.sin(a) * HH * r * 0.9; k++; }
    while (k < 30 && (isoD(x, y, hero.x, hero.y) < 220 || Math.abs(x) / HW + Math.abs(y) / HH > 0.8));
    const m = { x, y, r: 16, face: x < hero.x ? 1 : -1, hp: 70, maxhp: 70, st: 'spawn', t: 0, z: 0, flash: 0, kx: 0, ky: 0, atkCd: R(0.8, 1.6), hopT: R(0, 0.3), tx: 0, ty: 0, sx: 0, sy: 0, poise: 0, id: Math.random() };
    mobs.push(m);
    ring(x, y, 4, 46, 0.7, '#3fe6d0', 3); ghostFire(x, y, 4, 18, 26);
  }
  function hurtMob(m, dmg, crit, kx, ky, kb = 1) {
    if (m.st === 'dead' || m.st === 'spawn') return false;
    m.hp -= dmg; m.flash = kb < 0.5 ? 0.45 : 1; num(m.x, m.y, dmg, crit);
    const a = Math.atan2(ky, kx);
    spark(m.x, m.y, crit ? 14 : 8, a, 0.7, crit ? 380 : 260); ink(m.x, m.y, crit ? 7 : 3, a, 220);
    
    const d = Math.hypot(kx, ky) || 1;
    if (m.st !== 'leap') {
      m.kx = kx / d * 260 * kb; m.ky = ky / d * 130 * kb;
      m.st = 'hit'; m.t = 0; m.z = 0;
    }
    if (m.hp <= 0) killMob(m, kx / d, ky / d);
    return true;
  }
  function killMob(m, dx, dy) {
    m.st = 'dead'; m.t = 0; m.kx = dx * 320; m.ky = dy * 160; kills++;
    addShake(5); ink(m.x, m.y, 18, Math.atan2(dy, dx), 260); ghostFire(m.x, m.y, 40, 16, 40, 'k');
    decal(m.x + dx * 20, m.y + dy * 10, R(12, 18), '#3a0707', 0.7);
    for (let i = 0; i < 3; i++) parts.push({ t: 'paper', x: m.x, y: m.y, z: 95, vx: R(-60, 60), vy: R(-20, 20), vz: R(60, 160), life: 1.6, age: 0, rot: R(0, TAU), vr: R(-8, 8) });
    const n = 3 + (rnd() * 4 | 0);
    for (let i = 0; i < n; i++) coins.push({ x: m.x, y: m.y, z: 40, vx: R(-110, 110), vy: R(-55, 55), vz: R(120, 260), age: 0, gem: false });
    if (rnd() < 0.25) coins.push({ x: m.x, y: m.y, z: 40, vx: R(-60, 60), vy: R(-30, 30), vz: 240, age: 0, gem: true });
    if (kills % 8 === 0) wave++;
  }
  function updMob(m, dt) {
    m.t += dt; m.flash = Math.max(0, m.flash - dt * 9); m.atkCd -= dt; m.clawCd = (m.clawCd || 0) - dt;
    const dh = isoD(m.x, m.y, hero.x, hero.y);
    const faceHero = () => { m.face = hero.x >= m.x ? 1 : -1; };
    switch (m.st) {
      case 'spawn':
        if (rnd() < 0.5) ghostFire(m.x, m.y, 4, 1, 20);
        if (m.t > 0.9) { m.st = 'hop'; m.t = 0; }
        break;
      case 'hop': {
        // 僵尸跳：落地短停 → 直腿蹦起前进
        const rest = 0.16, air = 0.4, cyc = rest + air;
        m.hopT += dt;
        const p = m.hopT % cyc;
        if (p < rest) { m.z = 0; if (p < dt) { m.sx = m.x; m.sy = m.y; const a = Math.atan2((hero.y - m.y) * 2, hero.x - m.x) + R(-0.35, 0.35); const L = Math.min(46, Math.max(0, dh - 50)); m.tx = m.x + Math.cos(a) * L; m.ty = m.y + Math.sin(a) * L / 2; faceHero(); dust(m.x, m.y, 3, 30); } }
        else { const u = (p - rest) / air; m.z = Math.sin(u * Math.PI) * 17; m.x = lerp(m.sx, m.tx, u); m.y = lerp(m.sy, m.ty, u); }
        if (p < rest && dh < 66 && m.clawCd <= 0) {
          // 近身：抓挠（扇形预警）
          m.st = 'claw'; m.t = 0; m.z = 0; faceHero(); m.ang = Math.atan2((hero.y - m.y) * 2, hero.x - m.x);
          teles.push({ m, type: 'cone', x: m.x, y: m.y, ang: m.ang, age: 0, life: 0.42 });
        } else if (p < rest && dh < 150 && dh > 40 && m.atkCd <= 0) {
          // 中距：蓄力扑杀（落点圆圈 + 轨迹预警）
          m.st = 'windup'; m.t = 0; m.z = 0; faceHero();
          m.tx = hero.x + hero.vx * 0.4; m.ty = hero.y + hero.vy * 0.4; const f = { x: m.tx, y: m.ty }; keepIn(f, LIM); m.tx = f.x; m.ty = f.y;
          teles.push({ m, type: 'leap', x: m.tx, y: m.ty, sx: m.x, sy: m.y, age: 0, life: 0.62 + 0.42 });
        }
        break;
      }
      case 'windup':
        m.z = 0; if (m.t > 0.62) { m.st = 'leap'; m.t = 0; m.sx = m.x; m.sy = m.y; dust(m.x, m.y, 8, 90); }
        break;
      case 'leap': {
        const u = Math.min(1, m.t / 0.42); m.x = lerp(m.sx, m.tx, u); m.y = lerp(m.sy, m.ty, u); m.z = Math.sin(u * Math.PI) * 58;
        if (u >= 1) {
          m.st = 'recover'; m.t = 0; m.z = 0; m.atkCd = R(1.6, 2.4);
          dust(m.x, m.y, 18, 150); ring(m.x, m.y, 8, 62, 0.4, '#ff3a2a', 4); ring(m.x, m.y, 4, 40, 0.25, '#c9a054', 2); addShake(5); decal(m.x, m.y, 16, '#05070a', 0.45);
          if (isoD(m.x, m.y, hero.x, hero.y) < 52 && hero.inv <= 0) hurtHero(11, m);
        }
        break;
      }
      case 'claw':
        m.z = 0; if (m.t > 0.42) {
          m.st = 'swipe'; m.t = 0; m.clawCd = R(1.3, 1.9);
          slashes.push({ kind: 'claw', x: m.x + Math.cos(m.ang) * 34, y: m.y + Math.sin(m.ang) * 17, ang: m.ang, face: m.face, age: 0, life: 0.26 });
          const dx = hero.x - m.x, dy = (hero.y - m.y) * 2; let da = Math.atan2(dy, dx) - m.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.hypot(dx, dy) < 84 && Math.abs(da) < 0.95 && hero.inv <= 0) hurtHero(7, m);
        }
        break;
      case 'swipe':
        m.x += Math.cos(m.ang) * 150 * dt; m.y += Math.sin(m.ang) * 75 * dt; m.z = Math.sin(Math.min(1, m.t / 0.16) * Math.PI) * 8;
        if (m.t > 0.16) { m.st = 'recover'; m.t = 0; m.z = 0; }
        break;
      case 'recover': m.z = 0; if (m.t > 0.45) { m.st = 'hop'; m.t = 0; m.hopT = 0; } break;
      case 'hit':
        m.z = 0; m.x += m.kx * dt; m.y += m.ky * dt; m.kx *= Math.pow(0.0008, dt); m.ky *= Math.pow(0.0008, dt);
        if (m.t > 0.26) { m.st = 'hop'; m.t = 0; m.hopT = 0; }
        break;
      case 'dead':
        m.x += m.kx * dt; m.y += m.ky * dt; m.kx *= Math.pow(0.002, dt); m.ky *= Math.pow(0.002, dt);
        if (m.t < 0.5 && rnd() < 0.6) parts.push({ t: 'ash', x: m.x + R(-18, 18), y: m.y, z: R(10, 100), vx: R(-20, 20), vy: 0, vz: R(20, 70), life: R(0.6, 1.1), age: 0, s: R(1.5, 3.5) });
        if (m.t > 0.9) m.gone = true;
        break;
    }
    if (m.st !== 'dead') keepIn(m, 0.9);
  }
  function hurtHero(d, m) {
    hero.hp -= d; hero.inv = 0.6; hero.red = 1; addShake(7); flash('#ff1a0a', 0.16, 0.22); num(hero.x, hero.y, d, false, '#ff5a48');
    const a = Math.atan2(hero.y - m.y, hero.x - m.x); hero.vx += Math.cos(a) * 220; hero.vy += Math.sin(a) * 110;
    ink(hero.x, hero.y, 8, a, 200); spark(hero.x, hero.y, 6, a, 1, 200, '#ff6a4a');
    if (hero.hp <= 0) { hero.hp = hero.maxhp; ring(hero.x, hero.y, 10, 160, 0.6, '#3fe6d0', 6); ghostFire(hero.x, hero.y, 30, 30, 80); num(hero.x, hero.y - 10, '回魂', true, '#46f0d8'); for (const o of mobs) if (o.st !== 'dead') hurtMob(o, 0, false, o.x - hero.x, o.y - hero.y, 1.6); }
  }

  // ---------- 主角动作 ----------
  const alive = () => mobs.filter(m => m.st !== 'dead' && m.st !== 'spawn');
  function nearest(range) { let b = null, bd = range; for (const m of alive()) { const d = isoD(hero.x, hero.y, m.x, m.y); if (d < bd) { bd = d; b = m; } } return b; }
  const countIn = r => alive().filter(m => isoD(hero.x, hero.y, m.x, m.y) < r).length;
  function rollDmg(base) { const crit = rnd() < 0.22; return [Math.round(base * R(0.9, 1.15) * (crit ? 1.8 : 1)), crit]; }

  // 三连：① 横扫  ② 突进斩  ③ 跃起大劈
  const COMBO = { 1: { wind: 0.06, hold: 0.2, dur: 0.32 }, 2: { wind: 0.06, hold: 0.2, dur: 0.34 }, 3: { wind: 0.18, hold: 0.26, dur: 0.6 } };
  function flash(col, a, life = 0.25) { flashes.push({ col, a, life, age: 0 }); }
  function startAct(type, target) {
    const a = { type, t: 0, target, ang: Math.atan2((target.y - hero.y) * 2, target.x - hero.x), done: {} };
    if (type === 'atk') { hero.combo = hero.comboT > 0 ? (hero.combo % 3) + 1 : 1; a.n = hero.combo; Object.assign(a, COMBO[a.n]); }
    if (type === 'palm') a.dur = 0.62;
    if (type === 'spin') { a.dur = 0.95; a.rot = 0; }
    if (type === 'dash') { a.dur = 0.8; const d = isoD(hero.x, hero.y, target.x, target.y), L = Math.min(260, d + 80); a.sx = hero.x; a.sy = hero.y; const e = { x: hero.x + Math.cos(a.ang) * L, y: hero.y + Math.sin(a.ang) * L / 2 }; keepIn(e, LIM); a.ex = e.x; a.ey = e.y; a.hit = new Set(); }
    hero.face = Math.cos(a.ang) >= 0 ? 1 : -1; hero.act = a;
  }
  function slashFx(x, y, ang, r, o = {}) { slashes.push(Object.assign({ kind: 'arc', x, y, ang, r, age: 0, life: 0.2, dir: 1, w: 0.5, col: 'gold', arc: 2.4, flat: 0.55, mirror: 1, lift: 30 }, o)); }
  function meleeHit(ang, range, half, base, kb, ox = hero.x, oy = hero.y, crit) {
    let hit = 0;
    for (const m of alive()) {
      const dx = m.x - ox, dy = (m.y - oy) * 2, d = Math.hypot(dx, dy);
      if (d > range + m.r) continue;
      let da = Math.atan2(dy, dx) - ang; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > half && d > 26) continue;
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
      for (const m of alive()) { const d = isoD(hero.x, hero.y, m.x, m.y); if (d < 180 && d > 46) { m.x += (hero.x - m.x) / d * 110 * dt; m.y += (hero.y - m.y) / d * 110 * dt; } }
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
        const u = (a.t - 0.12) / 0.16, px = hero.x, py = hero.y; hero.x = lerp(a.sx, a.ex, u * (2 - u)); hero.y = lerp(a.sy, a.ey, u * (2 - u)); hero.vx = hero.vy = 0;
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
  let autoT = 0, autoDir = 1;
  function autoStick(dt) {
    autoT += dt;
    const ph = autoT % 7;
    if (ph < 1.2) return [0, 0];
    const r = Math.hypot(hero.x, hero.y * 2), a = Math.atan2(hero.y * 2, hero.x);
    if (Math.floor(autoT / 7) % 2) autoDir = -1; else autoDir = 1;
    let tx = -Math.sin(a) * autoDir, ty = Math.cos(a) * autoDir;
    const want = 150; tx += Math.cos(a) * (want - r) / 80; ty += Math.sin(a) * (want - r) / 80;
    const m = Math.hypot(tx, ty) || 1; return [tx / m, ty / m];
  }

  // ---------- 更新 ----------
  function update(dt) {
    T += dt;
    // 输入
    let ix = 0, iy = 0;
    if (stick.on) { ix = stick.x; iy = stick.y; }
    else { if (keys.a || keys.arrowleft) ix -= 1; if (keys.d || keys.arrowright) ix += 1; if (keys.w || keys.arrowup) iy -= 1; if (keys.s || keys.arrowdown) iy += 1; const m = Math.hypot(ix, iy); if (m > 1) { ix /= m; iy /= m; } }
    if (AUTO && !stick.on && !ix && !iy) { [ix, iy] = autoStick(dt); stick.vis = [ix, iy]; } else stick.vis = [ix, iy];
    shake = Math.max(0, shake - dt * 30); shakeX = R(-1, 1) * shake; shakeY = R(-1, 1) * shake * 0.7;
    SK.forEach(s => { s.flash = Math.max(0, s.flash - dt * 3); });
    zoomP = Math.max(0, zoomP - dt * 0.25); dim = Math.max(0, dim - dt * 1.6);
    for (const f of flashes) f.age += dt; flashes = flashes.filter(f => f.age < f.life);
    if (hitstop > 0) { hitstop -= dt; return; }
    if (slow > 0) { slow -= dt; dt *= 0.4; }
    for (const L of [pillars, lines]) for (const q of L) q.age += dt;
    pillars = pillars.filter(q => q.age < q.life); lines = lines.filter(q => q.age < q.life);

    // 主角
    const SPEED = 168;
    let mul = 1;
    if (hero.act) mul = { atk: 0.4, palm: 0.25, spin: 0.75, dash: 0 }[hero.act.type];
    const mag = Math.hypot(ix, iy);
    const tvx = ix * SPEED * mul, tvy = iy * SPEED * 0.62 * mul;
    hero.vx = lerp(hero.vx, tvx, 1 - Math.pow(0.0001, dt)); hero.vy = lerp(hero.vy, tvy, 1 - Math.pow(0.0001, dt));
    hero.x += hero.vx * dt; hero.y += hero.vy * dt; keepIn(hero);
    if (mag > 0.2) { hero.moveT += dt; if (!hero.act) hero.face = ix > 0.1 ? 1 : ix < -0.1 ? -1 : hero.face; hero.bob += dt * 13; } else hero.moveT = 0;
    if (mag > 0.2 && !hero.act) { hero.trail += dt; if (hero.trail > 0.12) { hero.trail = 0; dust(hero.x - ix * 8, hero.y, 2, 25); } }
    hero.inv -= dt; hero.red = Math.max(0, hero.red - dt * 4); hero.atkCd -= dt; hero.comboT -= dt;
    hero.hp = Math.min(hero.maxhp, hero.hp + dt * 2.5);
    SK.forEach(s => { s.t = Math.max(0, s.t - dt); });
    if (hero.act) updAct(dt);
    if (!hero.act && autoOn) {
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

    // 敌人
    spawnT -= dt;
    const want = Math.min(3 + Math.floor(kills / 5), 7);
    if (spawnT <= 0 && mobs.filter(m => m.st !== 'dead').length < want) { spawnMob(); spawnT = R(0.6, 1.3); }
    for (const m of mobs) updMob(m, dt);
    const live = mobs.filter(m => m.st !== 'dead');
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j], dx = b.x - a.x, dy = (b.y - a.y) * 2, d = Math.hypot(dx, dy);
      if (d < 34 && d > 0.01) { const p = (34 - d) / 2 / d; a.x -= dx * p; a.y -= dy * p / 2; b.x += dx * p; b.y += dy * p / 2; }
    }
    mobs = mobs.filter(m => !m.gone);

    // 法球
    for (const o of orbs) {
      o.age += dt; o.x += o.vx * dt; o.y += o.vy * dt; o.z = lerp(o.z, o.tz, 1 - Math.pow(0.02, dt));
      ghostFire(o.x, o.y, o.z, o.big ? 4 : 2, 22);
      let boom = o.age > 0.9 || Math.abs(o.x) / HW + Math.abs(o.y) / HH > 0.95;
      for (const m of alive()) if (isoD(o.x, o.y, m.x, m.y) < 30) boom = true;
      if (boom) {
        o.dead = true; const big = o.big ? 1.25 : 1;
        ring(o.x, o.y, 10, 100 * big, 0.45, '#46f0d8', 7); ring(o.x, o.y, 4, 64 * big, 0.3, '#e9fffb', 3); ring(o.x, o.y, 20, 140 * big, 0.6, '#1d8f80', 2);
        pillars.push({ x: o.x, y: o.y, age: 0, life: 0.55, s: big }); ghostFire(o.x, o.y, 20, 40, 160); spark(o.x, o.y, 14, -Math.PI / 2, 1.4, 360, '#aafff0');
        addShake(o.big ? 9 : 6); hitstop = Math.max(hitstop, 0.05); decal(o.x, o.y, 24, '#051311', 0.55);
        for (const m of alive()) if (isoD(o.x, o.y, m.x, m.y) < 96 * big) { const [dmg, crit] = rollDmg(o.big ? 34 : 24); hurtMob(m, dmg, crit, m.x - o.x, m.y - o.y, 1.5); }
      }
    }
    orbs = orbs.filter(o => !o.dead);

    // 掉落
    for (const c of coins) {
      c.age += dt;
      if (c.age < 0.75) { c.vz -= 900 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; if (c.z < 0) { c.z = 0; c.vz *= -0.45; c.vx *= 0.6; c.vy *= 0.6; } }
      else { const dx = hero.x - c.x, dy = hero.y - c.y, d = Math.hypot(dx, dy * 2); const sp = 200 + (c.age - 0.75) * 900; c.x += dx / (d || 1) * sp * dt; c.y += dy / (d || 1) * sp * dt; c.z = lerp(c.z, 30, 0.1); if (d < 16) { c.dead = true; if (c.gem) gems++; else gold += 7 + (rnd() * 6 | 0); goldPop = 1; spark(hero.x, hero.y, 3, -Math.PI / 2, 1.5, 120, c.gem ? '#d78bff' : '#ffe08a'); } }
    }
    coins = coins.filter(c => !c.dead); goldPop = Math.max(0, goldPop - dt * 4);

    // 粒子
    for (const p of parts) {
      p.age += dt;
      if (p.t === 'gather') { const u = p.age / p.life; p.x = lerp(p.x, p.tx, u * 0.5); p.z = lerp(p.z, p.tz, u * 0.5); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.t === 'spark') { p.vz -= 500 * dt; p.vx *= 0.9; p.vy *= 0.9; }
      if (p.t === 'ink') { p.vz -= 900 * dt; if (p.z <= 0) { p.z = 0; if (rnd() < 0.35) decal(p.x, p.y, p.s * 0.8, p.col, 0.6); p.age = 99; } }
      if (p.t === 'fire' || p.t === 'ash') { p.vx *= 0.95; p.vy *= 0.95; }
      if (p.t === 'dust') { p.vx *= 0.9; p.vy *= 0.9; p.vz *= 0.9; }
      if (p.t === 'paper') { p.vz -= 200 * dt; p.vz = Math.max(p.vz, -40); p.vx *= 0.97; p.rot += p.vr * dt; if (p.z < 0) { p.z = 0; p.vz = 0; p.vx = p.vy = 0; p.vr = 0; } }
    }
    parts = parts.filter(p => p.age < p.life);
    if (parts.length > 900) parts.splice(0, parts.length - 900);
    for (const L of [slashes, rings, nums, ghosts, teles]) for (const s of L) s.age += dt;
    slashes = slashes.filter(s => s.age < s.life); rings = rings.filter(s => s.age < s.life); nums = nums.filter(s => s.age < s.life); ghosts = ghosts.filter(s => s.age < s.life); teles = teles.filter(s => s.age < s.life && s.m.st !== 'dead' && s.m.st !== 'hit');
    for (const d of decals) d.age += dt;
    decals = decals.filter(d => d.age < 14);
    // 火盆幽火
    for (const p of props) if (p.k === 'brazier' && rnd() < 0.55) ghostFire(p.x, p.y + 1, 68, 1, 10);
    if (rnd() < 0.3) parts.push({ t: 'ash', x: cam.x + R(-W / 2, W / 2), y: cam.y + R(-H / 2, H / 2), z: R(0, 40), vx: R(5, 20), vy: R(-5, 5), vz: R(8, 22), life: R(2, 4), age: 0, s: R(1, 2.2) });

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
    ctx.save(); ctx.translate(s.x, s.y - 50); ctx.scale(s.face, 1);
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
          const k = p.col === 'k' ? ['rgba(130,255,230,', 'rgba(20,120,110,'] : ['rgba(150,255,235,', 'rgba(20,170,150,'];
          const s = p.t === 'gather' ? 3 : p.s * (1 - u * 0.6);
          ctx.globalAlpha = (1 - u) * 0.8; ctx.fillStyle = k[1] + '0.55)'; ctx.beginPath(); ctx.ellipse(x, y, s * 0.9, s * 1.5, 0, 0, TAU); ctx.fill();
          ctx.globalAlpha = (1 - u); ctx.fillStyle = k[0] + '1)'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.2, s * 0.35, s * 0.7, 0, 0, TAU); ctx.fill();
        }
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
  function drawMob(m) {
    let pose = 'idle', sx = 1, sy = 1, rot = 0, ox = 0, alpha = 1;
    if (m.st === 'leap' || m.st === 'swipe') pose = 'jump';
    if (m.st === 'hit' || m.st === 'dead') pose = 'hit';
    if (m.st === 'hop') { const p = m.hopT % 0.56; if (p < 0.16) { const k = Math.sin(p / 0.16 * Math.PI); sy = 1 - k * 0.07; sx = 1 + k * 0.04; } else sy = 1.03; }
    if (m.st === 'windup') { const k = Math.min(1, m.t / 0.62); sy = 1 - k * 0.14; sx = 1 + k * 0.07; ox = Math.sin(T * 60) * 2 * k; }
    if (m.st === 'claw') { const k = Math.min(1, m.t / 0.42); rot = -0.12 * m.face * k; ox = -m.face * 6 * k; sy = 1 - 0.05 * k; }
    if (m.st === 'swipe') { rot = 0.1 * m.face; sx = 1.08; }
    const warn = m.st === 'windup' || m.st === 'claw';
    if (m.st === 'recover') { const k = Math.max(0, 1 - m.t / 0.2); sy = 1 - k * 0.1; sx = 1 + k * 0.06; }
    if (m.st === 'hit') { rot = -0.08 * m.face * Math.max(0, 1 - m.t / 0.26); }
    if (m.st === 'dead') { rot = -m.face * Math.min(0.35, m.t * 0.8); alpha = Math.max(0, 1 - m.t / 0.9); }
    let rise = 0; if (m.st === 'spawn') { const k = Math.min(1, m.t / 0.8); rise = (1 - k * (2 - k)) * 120; alpha = Math.min(1, m.t * 2.5); }
    const s = SPR.js[pose];
    shadow(m.x, m.y, 22 * (1 - Math.min(0.4, m.z / 120)), 0.5 * alpha);
    if (rise > 0) { ctx.save(); ctx.beginPath(); ctx.rect(m.x - 90, m.y - 220, 180, 222); ctx.clip(); }
    drawSpr(s, m.x + ox, m.y - m.z + rise, m.face, warn && m.flash <= 0 ? { sx, sy, rot, alpha, flash: 0.12 + 0.26 * (0.5 + 0.5 * Math.sin(T * 32)), flashImg: s.red } : { sx, sy, rot, alpha, flash: m.flash });
    if (rise > 0) ctx.restore();
    if (m.st !== 'dead' && m.st !== 'spawn' && m.hp < m.maxhp) {
      const w = 36, y = m.y - m.z - 128;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(m.x - w / 2 - 1, y - 1, w + 2, 5);
      ctx.fillStyle = '#b3201a'; ctx.fillRect(m.x - w / 2, y, w * Math.max(0, m.hp / m.maxhp), 3);
    }
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
  let lightCv = null, lightG = null;
  function drawLighting() {
    const lw = Math.ceil(cv.width / 2), lh = Math.ceil(cv.height / 2);
    if (!lightCv || lightCv.width !== lw) { lightCv = mk(lw, lh); lightG = lightCv.getContext('2d'); }
    const g = lightG, k = lw / W;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, lw, lh);
    g.fillStyle = 'rgba(2,5,8,0.62)'; g.fillRect(0, 0, lw, lh);
    worldT(g, k);
    g.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 0.75, 0, 0, TAU); g.fill(); };
    hole(hero.x, hero.y - 40, 190, 0.75);
    for (const p of props) if (p.k === 'brazier') hole(p.x, p.y - 60, 150 + Math.sin(T * 9 + p.t) * 8, 0.85);
    for (const o of orbs) hole(o.x, o.y - o.z, 110, 0.9);
    for (const r of rings) hole(r.x, r.y, r.r1 * 1.6, 0.6 * (1 - r.age / r.life));
    for (const s of slashes) hole(s.x, s.y - 30, 110, 0.7 * (1 - s.age / s.life));
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(lightCv, 0, 0, cv.width, cv.height);
  }
  function worldT(c = ctx, k = RS) {
    // 以主角为焦点做冲击缩放：screen = (world - F) * a + screenF
    const a = k * (1 + zoomP), fx = hero.x, fy = hero.y - 40;
    c.setTransform(a, 0, 0, a, (fx - cam.x + W / 2 + shakeX) * k - fx * a, (fy - cam.y + H * 0.5 + shakeY) * k - fy * a);
  }
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = ctx.createRadialGradient(cv.width / 2, cv.height * 0.45, 0, cv.width / 2, cv.height * 0.45, cv.height * 0.7);
    bg.addColorStop(0, '#0d1a1b'); bg.addColorStop(1, '#020304'); ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
    worldT();
    ctx.drawImage(groundCv, GB.x0, GB.y0, groundCv.width / RS, groundCv.height / RS);
    // 地面污迹
    for (const d of decals) {
      ctx.globalAlpha = d.a * Math.min(1, (14 - d.age) / 3); ctx.fillStyle = d.col;
      for (const [bx, by, br] of d.blobs) { ctx.beginPath(); ctx.ellipse(d.x + bx * d.s, d.y + by * d.s, d.s * br, d.s * br * 0.5, 0, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    // 跳尸预警：扑杀=轨迹+落点圈逐渐填满；抓挠=扇形
    for (const t of teles) {
      if (t.type === 'cone') {
        const u = Math.min(1, t.age / 0.42), R0 = 86;
        ctx.save(); ctx.translate(t.x, t.y); ctx.scale(1, 0.5);
        ctx.fillStyle = `rgba(255,30,20,${0.12 + 0.12 * u})`; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R0, t.ang - 0.95, t.ang + 0.95); ctx.closePath(); ctx.fill();
        ctx.fillStyle = `rgba(255,60,40,${0.35})`; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R0 * u, t.ang - 0.95, t.ang + 0.95); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = u > 0.85 ? '#fff' : 'rgba(255,70,50,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, R0, t.ang - 0.95, t.ang + 0.95); ctx.stroke();
        ctx.restore(); continue;
      }
      const u = Math.min(1, t.age / 0.62), mx = t.m.st === 'leap' ? t.sx : t.m.x, my = t.m.st === 'leap' ? t.sy : t.m.y;
      // 轨迹箭头
      const dx = t.x - mx, dy = t.y - my, L = Math.hypot(dx, dy * 2) || 1;
      ctx.fillStyle = 'rgba(255,50,40,.55)';
      for (let i = 1; i < L / 22; i++) {
        const q = i * 22 / L; if (q > u + 0.15) break;
        const x = lerp(mx, t.x, q), y = lerp(my, t.y, q), an = Math.atan2(dy, dx);
        ctx.save(); ctx.translate(x, y); ctx.rotate(an); ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-1, 0); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      const blink = u > 0.8 && Math.floor(T * 20) % 2;
      ctx.lineWidth = 2.5; ctx.strokeStyle = blink ? '#ffffff' : `rgba(255,50,40,${0.5 + 0.4 * u})`;
      ctx.beginPath(); ctx.ellipse(t.x, t.y, 52, 20, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = `rgba(220,20,15,${0.18 + 0.2 * u})`; ctx.beginPath(); ctx.ellipse(t.x, t.y, 52 * u, 20 * u, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,90,60,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(t.x - 14, t.y); ctx.lineTo(t.x + 14, t.y); ctx.moveTo(t.x, t.y - 6); ctx.lineTo(t.x, t.y + 6); ctx.stroke();
    }
    // 血影斩压暗
    if (dim > 0) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(10,0,0,${dim})`; ctx.fillRect(0, 0, cv.width, cv.height); ctx.restore(); }
    // 圆环
    for (const r of rings) {
      const u = r.age / r.life, rr = lerp(r.r0, r.r1, 1 - Math.pow(1 - u, 2.5));
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = r.col; ctx.globalAlpha = 1 - u; ctx.lineWidth = r.w * (1 - u * 0.6);
      ctx.beginPath(); ctx.ellipse(r.x, r.y, rr, rr * 0.42, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // 深度排序
    const list = [];
    for (const p of props) list.push([p.y, 0, p]);
    for (const m of mobs) list.push([m.y, 1, m]);
    list.push([hero.y, 2, hero]);
    for (const c of coins) list.push([c.y, 3, c]);
    for (const o of orbs) list.push([o.y + 2, 4, o]);
    for (const g of ghosts) list.push([g.y - 0.5, 5, g]);
    list.sort((a, b) => a[0] - b[0]);
    for (const [, k, e] of list) {
      if (k === 0) drawProp(e); else if (k === 1) drawMob(e); else if (k === 2) drawHero(); else if (k === 3) drawCoin(e); else if (k === 4) drawOrb(e);
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
      const g = ctx.createLinearGradient(0, q.y, 0, q.y - h); g.addColorStop(0, `rgba(200,255,245,${al})`); g.addColorStop(0.4, `rgba(70,240,216,${0.8 * al})`); g.addColorStop(1, 'rgba(10,90,80,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(q.x, q.y - h / 2, w, h / 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(240,255,252,${al})`; ctx.beginPath(); ctx.ellipse(q.x, q.y - h * 0.35, w * 0.3, h * 0.35, 0, 0, TAU); ctx.fill();
    }
    for (const q of lines) {
      const u = q.age / q.life, al = 1 - u;
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(200,20,20,${0.7 * al})`; ctx.lineWidth = 14 * (1 - u * 0.7); ctx.beginPath(); ctx.moveTo(q.x0, q.y0 - 34); ctx.lineTo(q.x1, q.y1 - 34); ctx.stroke();
      ctx.strokeStyle = `rgba(255,230,210,${al})`; ctx.lineWidth = 3 * (1 - u * 0.7); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // 火盆辉光
    for (const p of props) if (p.k === 'brazier') { const r = 46 + Math.sin(T * 11 + p.t) * 4, g = ctx.createRadialGradient(p.x, p.y - 64, 0, p.x, p.y - 64, r); g.addColorStop(0, 'rgba(90,255,225,.35)'); g.addColorStop(1, 'rgba(0,80,70,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 64, r, 0, TAU); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
    drawLighting();
    // 伤害数字与预警标记（在光照之上）
    worldT();
    for (const m of mobs) if (m.st === 'windup' || m.st === 'claw') {
      const k = Math.min(1, m.t / 0.12), y = m.y - 150 - Math.abs(Math.sin(T * 14)) * 4;
      ctx.save(); ctx.translate(m.x, y); ctx.scale(0.6 + 0.6 * k, 0.6 + 0.6 * k);
      ctx.fillStyle = '#0a0302'; ctx.beginPath(); ctx.moveTo(-9, -16); ctx.lineTo(9, -16); ctx.lineTo(4, 6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(0, 14, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff3526'; ctx.beginPath(); ctx.moveTo(-6, -13); ctx.lineTo(6, -13); ctx.lineTo(2.5, 3); ctx.lineTo(-2.5, 3); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(0, 14, 3.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const n of nums) {
      const u = n.age / n.life, pop = u < 0.15 ? 1 + (1 - u / 0.15) * (n.crit ? 0.9 : 0.5) : 1;
      const y = n.y - n.z - u * 34, x = n.x + n.vx * u;
      ctx.globalAlpha = Math.min(1, (1 - u) * 3);
      ctx.font = `900 ${(n.crit ? 22 : 16) * pop}px "STKaiti","KaiTi","Noto Serif CJK SC",serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = '#0a0503'; ctx.strokeText(n.v, x, y); ctx.fillStyle = n.col; ctx.fillText(n.v, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const f of flashes) { ctx.globalAlpha = f.a * (1 - f.age / f.life); ctx.fillStyle = f.col; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.globalAlpha = 1;
    drawUI();
  }

  // ---------- 界面 ----------
  const FONT = '"STKaiti","KaiTi","Noto Serif CJK SC","Songti SC",serif';
  const skillPos = () => [[W - 172, H - 86], [W - 112, H - 112], [W - 52, H - 86]];
  const stickHome = () => [86, H - 118];
  function frame(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function drawUI() {
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    // 暗角
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.65)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    const tg = ctx.createLinearGradient(0, 0, 0, 110); tg.addColorStop(0, 'rgba(0,0,0,.75)'); tg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = tg; ctx.fillRect(0, 0, W, 110);
    // 头像 + 血条
    const px = 46, py = 56;
    ctx.save(); ctx.beginPath(); ctx.arc(px, py, 30, 0, TAU); ctx.fillStyle = '#1a0f12'; ctx.fill(); ctx.clip(); ctx.drawImage(portrait, px - 32, py - 32, 64, 64); ctx.restore();
    ctx.strokeStyle = '#0b0705'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(px, py, 31, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#c9a054'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(px, py, 31, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#7a1410'; ctx.strokeStyle = '#c9a054'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px + 22, py + 22, 10, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffe9b8'; ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(hero.lv, px + 22, py + 22.5);
    ctx.textAlign = 'left'; ctx.font = `700 15px ${FONT}`; ctx.fillStyle = '#e9d6a6'; ctx.fillText('夜无痕', 86, 38);
    const bw = 150, hp = hero.hp / hero.maxhp;
    ctx.fillStyle = '#0a0606'; frame(84, 48, bw + 4, 14, 3); ctx.fill(); ctx.strokeStyle = '#8a6a34'; ctx.lineWidth = 1.2; ctx.stroke();
    const hg = ctx.createLinearGradient(0, 50, 0, 60); hg.addColorStop(0, '#e2463a'); hg.addColorStop(1, '#7a0f0c'); ctx.fillStyle = hg; ctx.fillRect(86, 50, bw * hp, 10);
    ctx.fillStyle = '#fff2dc'; ctx.font = `700 10px ${FONT}`; ctx.fillText(`${Math.ceil(hero.hp)} / ${hero.maxhp}`, 90, 55.5);
    ctx.fillStyle = '#0a0606'; frame(84, 66, bw * 0.75 + 4, 8, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2bc8b2'; ctx.fillRect(86, 68, bw * 0.75 * (0.55 + 0.45 * Math.sin(T * 0.7) ** 2), 4);
    // 自动攻击
    const ax = W - 112, ay = 24;
    ctx.fillStyle = 'rgba(14,8,8,.85)'; frame(ax, ay, 98, 32, 16); ctx.fill();
    ctx.strokeStyle = autoOn ? `rgba(230,180,80,${0.7 + 0.3 * Math.sin(T * 5)})` : '#555'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.save(); ctx.translate(ax + 20, ay + 16); ctx.rotate(-0.8); ctx.fillStyle = '#e9c46a'; ctx.fillRect(-1.5, -10, 3, 16); ctx.fillRect(-5, 5, 10, 2.5); ctx.restore();
    ctx.fillStyle = autoOn ? '#f3dca2' : '#888'; ctx.font = `700 14px ${FONT}`; ctx.fillText('自动攻击', ax + 34, ay + 16.5);
    // 斩杀/金币
    ctx.font = `700 13px ${FONT}`; ctx.textAlign = 'right';
    ctx.fillStyle = '#f0c34a'; ctx.fillText(`金 ${gold}`, W - 16, 74); if (goldPop > 0) { ctx.globalAlpha = goldPop; ctx.fillStyle = '#fff'; ctx.fillText(`金 ${gold}`, W - 16, 74); ctx.globalAlpha = 1; }
    ctx.fillStyle = '#d78bff'; ctx.fillText(`魂晶 ${gems}`, W - 16, 92);
    ctx.fillStyle = '#e8d9c0'; ctx.fillText(`斩尸 ${kills}`, W - 16, 110);
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(233,214,166,.8)'; ctx.font = `700 13px ${FONT}`; ctx.fillText(`镇妖塔 · 尸房 · 第${wave}波`, W / 2, 128);
    // 摇杆
    const [hx, hy] = stick.on ? [stick.bx, stick.by] : stickHome();
    const [vx, vy] = stick.vis || [0, 0];
    ctx.globalAlpha = stick.on ? 1 : 0.75;
    ctx.fillStyle = 'rgba(8,10,12,.55)'; ctx.beginPath(); ctx.arc(hx, hy, 58, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8a6a34'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy, 58, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(201,160,84,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hx, hy, 50, 0, TAU); ctx.stroke();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 - Math.PI / 2; ctx.save(); ctx.translate(hx + Math.cos(a) * 44, hy + Math.sin(a) * 44); ctx.rotate(a + Math.PI / 2); ctx.fillStyle = 'rgba(201,160,84,.6)'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(5, 2); ctx.lineTo(-5, 2); ctx.closePath(); ctx.fill(); ctx.restore(); }
    const kx = hx + vx * 34, ky = hy + vy * 34;
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

  // ---------- 输入 ----------
  function toLogical(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / ZOOM, (e.clientY - r.top) / ZOOM]; }
  cv.addEventListener('pointerdown', e => {
    const [x, y] = toLogical(e);
    if (y < 64 && x > W - 120) { autoOn = !autoOn; return; }
    if (stick.on || y < 140) return;
    if (x > W - 200 && y > H - 190) return; // 技能区（仅展示）
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
  window.addEventListener('resize', () => { if (CAPTURE) return; const oldRS = RS; resize(); if (RS !== oldRS) { SPR.hero = {}; SPR.js = {}; SPR.tiles = []; SPR.deco = {}; buildSprites(); props.length = 0; buildRoom(); } });
  resize();
  Promise.all([load('hero', SLICE.hero.file), load('js', SLICE.js.file), load('tiles', SLICE.tiles.file), load('deco', SLICE.deco.file)]).then(() => {
    buildSprites(); buildRoom(); cam.x = hero.x; cam.y = hero.y - 24;
    document.getElementById('loading').remove();
    if (CAPTURE) {
      window.__step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) update(dt); render(); };
      window.__frame = (q = 0.85) => cv.toDataURL('image/jpeg', q);
      window.DONE = true;
    } else requestAnimationFrame(ts => { last = ts; loop(ts); });
  }).catch(err => { document.getElementById('loading').textContent = '素材载入失败：' + err.message; });
})();

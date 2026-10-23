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
    if (o.flash > 0) { ctx.globalAlpha = Math.min(0.7, o.flash) * (o.alpha == null ? 1 : o.alpha); ctx.drawImage(o.flashImg || s.white, dx, dy, dw, dh); }
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
    m.hp -= dmg; m.flash = 1; num(m.x, m.y, dmg, crit);
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
    m.t += dt; m.flash = Math.max(0, m.flash - dt * 9); m.atkCd -= dt;
    const dh = isoD(m.x, m.y, hero.x, hero.y);
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
        if (p < rest) { m.z = 0; if (m.hopT - dt < Math.floor(m.hopT / cyc) * cyc + 0.001 || (p < dt)) { m.sx = m.x; m.sy = m.y; const a = Math.atan2((hero.y - m.y) * 2, hero.x - m.x) + R(-0.35, 0.35); const L = Math.min(46, Math.max(0, dh - 50)); m.tx = m.x + Math.cos(a) * L; m.ty = m.y + Math.sin(a) * L / 2; m.face = hero.x >= m.x ? 1 : -1; dust(m.x, m.y, 3, 30); } }
        else { const u = (p - rest) / air; m.z = Math.sin(u * Math.PI) * 17; m.x = lerp(m.sx, m.tx, u); m.y = lerp(m.sy, m.ty, u); }
        if (dh < 96 && m.atkCd <= 0 && p < rest) { m.st = 'windup'; m.t = 0; m.z = 0; m.face = hero.x >= m.x ? 1 : -1;
          m.tx = hero.x + hero.vx * 0.35; m.ty = hero.y + hero.vy * 0.35; const f = { x: m.tx, y: m.ty }; keepIn(f, LIM); m.tx = f.x; m.ty = f.y;
          teles.push({ m, x: m.tx, y: m.ty, age: 0, life: 0.95 }); }
        break;
      }
      case 'windup':
        m.z = 0; if (m.t > 0.5) { m.st = 'leap'; m.t = 0; m.sx = m.x; m.sy = m.y; dust(m.x, m.y, 6, 70); }
        break;
      case 'leap': {
        const u = Math.min(1, m.t / 0.42); m.x = lerp(m.sx, m.tx, u); m.y = lerp(m.sy, m.ty, u); m.z = Math.sin(u * Math.PI) * 52;
        if (u >= 1) {
          m.st = 'recover'; m.t = 0; m.z = 0; m.atkCd = R(1.4, 2.2);
          dust(m.x, m.y, 14, 120); ring(m.x, m.y, 8, 54, 0.35, '#c9a054', 3); addShake(4); decal(m.x, m.y, 14, '#05070a', 0.4);
          if (isoD(m.x, m.y, hero.x, hero.y) < 48 && hero.inv <= 0) hurtHero(10, m);
        }
        break;
      }
      case 'recover': m.z = 0; if (m.t > 0.5) { m.st = 'hop'; m.t = 0; m.hopT = 0; } break;
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
    hero.hp -= d; hero.inv = 0.6; hero.red = 1; addShake(7); num(hero.x, hero.y, d, false, '#ff5a48');
    const a = Math.atan2(hero.y - m.y, hero.x - m.x); hero.vx += Math.cos(a) * 220; hero.vy += Math.sin(a) * 110;
    ink(hero.x, hero.y, 8, a, 200); spark(hero.x, hero.y, 6, a, 1, 200, '#ff6a4a');
    if (hero.hp <= 0) { hero.hp = hero.maxhp; ring(hero.x, hero.y, 10, 160, 0.6, '#3fe6d0', 6); ghostFire(hero.x, hero.y, 30, 30, 80); num(hero.x, hero.y - 10, '回魂', true, '#46f0d8'); for (const o of mobs) if (o.st !== 'dead') hurtMob(o, 0, false, o.x - hero.x, o.y - hero.y, 1.6); }
  }

  // ---------- 主角动作 ----------
  const alive = () => mobs.filter(m => m.st !== 'dead' && m.st !== 'spawn');
  function nearest(range) { let b = null, bd = range; for (const m of alive()) { const d = isoD(hero.x, hero.y, m.x, m.y); if (d < bd) { bd = d; b = m; } } return b; }
  const countIn = r => alive().filter(m => isoD(hero.x, hero.y, m.x, m.y) < r).length;
  function rollDmg(base) { const crit = rnd() < 0.22; return [Math.round(base * R(0.9, 1.15) * (crit ? 1.8 : 1)), crit]; }

  function startAct(type, target) {
    const a = { type, t: 0, target, ang: Math.atan2((target.y - hero.y) * 2, target.x - hero.x), done: {} };
    if (type === 'atk') { hero.combo = hero.comboT > 0 ? (hero.combo % 3) + 1 : 1; a.n = hero.combo; a.dur = a.n === 3 ? 0.5 : 0.36; }
    if (type === 'palm') a.dur = 0.55;
    if (type === 'spin') a.dur = 0.72;
    if (type === 'dash') { a.dur = 0.62; const d = isoD(hero.x, hero.y, target.x, target.y), L = Math.min(250, d + 70); a.sx = hero.x; a.sy = hero.y; const e = { x: hero.x + Math.cos(a.ang) * L, y: hero.y + Math.sin(a.ang) * L / 2 }; keepIn(e, LIM); a.ex = e.x; a.ey = e.y; a.hit = new Set(); }
    hero.face = Math.cos(a.ang) >= 0 ? 1 : -1; hero.act = a;
  }
  function slashFx(x, y, ang, r, o = {}) { slashes.push({ x, y, ang, r, age: 0, life: o.life || 0.2, dir: o.dir || 1, w: o.w || 0.5, col: o.col || 'gold', arc: o.arc || 2.4 }); }
  function meleeHit(ang, range, half, base, kb) {
    let hit = 0;
    for (const m of alive()) {
      const dx = m.x - hero.x, dy = (m.y - hero.y) * 2, d = Math.hypot(dx, dy);
      if (d > range + m.r) continue;
      let da = Math.atan2(dy, dx) - ang; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > half && d > 26) continue;
      const [dmg, crit] = rollDmg(base); hurtMob(m, dmg, crit, dx, dy / 2, kb); hit++;
      if (crit) addShake(6);
    }
    return hit;
  }
  function updAct(dt) {
    const a = hero.act; a.t += dt;
    const ca = Math.cos(a.ang), sa = Math.sin(a.ang) / 2;
    if (a.type === 'atk') {
      if (a.t >= 0.06 && !a.done.hit) {
        a.done.hit = 1; const big = a.n === 3;
        hero.vx += ca * (big ? 320 : 200); hero.vy += sa * (big ? 320 : 200);
        slashFx(hero.x + ca * 26, hero.y + sa * 26, a.ang, big ? 74 : 60, { dir: a.n === 2 ? -1 : 1, w: big ? 0.62 : 0.5, life: big ? 0.24 : 0.19, arc: big ? 3 : 2.4 });
        const h = meleeHit(a.ang, big ? 100 : 86, big ? 1.3 : 1.1, big ? 30 : 18, big ? 1.4 : 0.8);
        if (h) { hitstop = Math.max(hitstop, big ? 0.085 : 0.05); addShake(big ? 6 : 3); }
        else spark(hero.x + ca * 40, hero.y + sa * 40, 3, a.ang, 0.4, 140);
      }
    } else if (a.type === 'palm') {
      const hx = hero.x + HAND[0] * SLICE.hero.scale * hero.face, hz = -HAND[1] * SLICE.hero.scale;
      if (a.t < 0.28) { for (let i = 0; i < 2; i++) { const an = R(0, TAU), rr = R(30, 50); parts.push({ t: 'gather', x: hx + Math.cos(an) * rr, y: hero.y + 0.5, z: hz + Math.sin(an) * rr, tx: hx, tz: hz, life: 0.25, age: 0 }); } }
      if (a.t >= 0.28 && !a.done.fire) {
        a.done.fire = 1; const tg = a.target.st === 'dead' ? nearest(400) || a.target : a.target;
        const an = Math.atan2((tg.y - hero.y) * 2, tg.x - hero.x);
        orbs.push({ x: hx, y: hero.y + 1, z: hz, vx: Math.cos(an) * 430, vy: Math.sin(an) * 215, tz: 34, age: 0, tx: tg.x, ty: tg.y });
        ring(hx, hero.y, 4, 30, 0.25, '#46f0d8', 3); hero.vx -= Math.cos(an) * 80; addShake(2);
      }
    } else if (a.type === 'spin') {
      if (Math.floor(a.t / 0.07) !== Math.floor((a.t - dt) / 0.07)) hero.face = -hero.face;
      for (const k of [0.12, 0.34, 0.56]) if (a.t >= k && !a.done[k]) {
        a.done[k] = 1; const an = a.t * 14;
        slashFx(hero.x, hero.y, an, 82, { life: 0.26, w: 0.42, arc: 3.6, dir: 1 }); slashFx(hero.x, hero.y, an + Math.PI, 82, { life: 0.26, w: 0.42, arc: 3.6, dir: 1 });
        const h = meleeHit(0, 112, 9, 16, 1.2); if (h) { hitstop = Math.max(hitstop, 0.04); addShake(4); }
        spark(hero.x, hero.y, 10, R(0, TAU), Math.PI, 300);
      }
    } else if (a.type === 'dash') {
      if (a.t < 0.09) { /* 蓄势 */ }
      else if (a.t < 0.27) {
        const u = (a.t - 0.09) / 0.18, px = hero.x, py = hero.y; hero.x = lerp(a.sx, a.ex, u * (2 - u)); hero.y = lerp(a.sy, a.ey, u * (2 - u)); hero.vx = hero.vy = 0;
        hero.trail += dt; if (hero.trail > 0.022) { hero.trail = 0; ghosts.push({ x: hero.x, y: hero.y, face: hero.face, pose: 'run', age: 0, life: 0.32 }); }
        for (const m of alive()) if (!a.hit.has(m) && isoD(m.x, m.y, hero.x, hero.y) < 46) { a.hit.add(m); const [dmg, crit] = rollDmg(36); hurtMob(m, dmg, crit, m.x - px, (m.y - py), 1.2); }
        dust(hero.x, hero.y, 1, 40);
      } else if (!a.done.fin) {
        a.done.fin = 1; hitstop = 0.09; addShake(10);
        slashFx(hero.x + ca * 26, hero.y + sa * 26, a.ang + 0.6, 76, { col: 'blood', life: 0.3, w: 0.6, arc: 2.6 });
        slashFx(hero.x + ca * 26, hero.y + sa * 26, a.ang - 0.6, 76, { col: 'blood', life: 0.3, w: 0.6, arc: 2.6, dir: -1 });
        meleeHit(a.ang, 104, 1.4, 34, 1.6); ink(hero.x + ca * 40, hero.y + sa * 40, 16, a.ang, 300); decal(hero.x + ca * 40, hero.y + sa * 20, 16, '#4a0808', 0.55);
      }
    }
    if (a.t >= a.dur) { hero.act = null; if (a.type === 'atk') { hero.atkCd = 0.04; hero.comboT = 0.55; } }
  }
  function heroPose() {
    const a = hero.act;
    if (a) {
      if (a.type === 'atk') return a.t < 0.06 ? 'idle' : a.t < (a.n === 3 ? 0.38 : 0.27) ? 'cleave' : 'idle';
      if (a.type === 'palm') return 'cast';
      if (a.type === 'spin') return 'cleave';
      if (a.type === 'dash') return a.t < 0.09 ? 'idle' : a.t < 0.27 ? 'run' : 'cleave';
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
    if (hitstop > 0) { hitstop -= dt; return; }

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
        if (s.id === 'spin' && (countIn(130) >= 2 || countIn(95) >= 1)) tg = nearest(130);
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
      ghostFire(o.x, o.y, o.z, 2, 18);
      let boom = o.age > 0.9 || Math.abs(o.x) / HW + Math.abs(o.y) / HH > 0.95;
      for (const m of alive()) if (isoD(o.x, o.y, m.x, m.y) < 30) boom = true;
      if (boom) {
        o.dead = true; ring(o.x, o.y, 10, 92, 0.42, '#46f0d8', 6); ring(o.x, o.y, 4, 60, 0.3, '#e9fffb', 3); ghostFire(o.x, o.y, 20, 34, 120); addShake(7); hitstop = Math.max(hitstop, 0.05);
        decal(o.x, o.y, 22, '#06110f', 0.5);
        for (const m of alive()) if (isoD(o.x, o.y, m.x, m.y) < 92) { const [dmg, crit] = rollDmg(34); hurtMob(m, dmg, crit, m.x - o.x, m.y - o.y, 1.5); }
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
  function drawSlash(s) {
    const u = s.age / s.life;
    const head = Math.min(1, u / 0.45), tail = Math.max(0, (u - 0.25) / 0.75);
    const a0 = -s.arc / 2, span = s.arc;
    const from = a0 + span * tail, to = a0 + span * head;
    if (to <= from) return;
    ctx.save(); ctx.translate(s.x, s.y - 30); ctx.scale(1, 0.55); ctx.rotate(s.ang); if (s.dir < 0) ctx.scale(1, -1);
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
  function drawHero() {
    const pose = heroPose(), s = SPR.hero[pose], a = hero.act;
    let ox = 0, oy = 0, rot = 0, sx = 1, sy = 1;
    if (pose === 'run' && !a) { oy = -Math.abs(Math.sin(hero.bob)) * 4; rot = 0.04 * hero.face; sy = 1 + Math.sin(hero.bob * 2) * 0.02; }
    if (pose === 'idle' && !a) { sy = 1 + Math.sin(T * 2.4) * 0.012; }
    if (a && a.type === 'atk' && a.t < 0.06) { ox = -hero.face * 4; rot = -0.07 * hero.face; sy = 0.97; }
    if (a && a.type === 'dash' && a.t < 0.09) { sy = 0.92; sx = 1.05; ox = -hero.face * 5; }
    if (a && a.type === 'palm') { const k = Math.min(1, a.t / 0.28); sy = 1 + k * 0.02; }
    shadow(hero.x, hero.y, 22, 0.55);
    if (hero.inv > 0 && Math.floor(T * 20) % 2 && hero.red < 0.3) ctx.globalAlpha = 0.6;
    drawSpr(s, hero.x + ox, hero.y + oy, hero.face, { rot, sx, sy, flash: hero.red * 0.7, flashImg: s.red });
    ctx.globalAlpha = 1;
  }
  function drawMob(m) {
    let pose = 'idle', sx = 1, sy = 1, rot = 0, ox = 0, alpha = 1;
    if (m.st === 'leap') pose = 'jump';
    if (m.st === 'hit' || m.st === 'dead') pose = 'hit';
    if (m.st === 'hop') { const p = m.hopT % 0.56; if (p < 0.16) { const k = Math.sin(p / 0.16 * Math.PI); sy = 1 - k * 0.07; sx = 1 + k * 0.04; } else sy = 1.03; }
    if (m.st === 'windup') { const k = Math.min(1, m.t / 0.5); sy = 1 - k * 0.12; sx = 1 + k * 0.06; ox = Math.sin(T * 60) * 1.5 * k; }
    if (m.st === 'recover') { const k = Math.max(0, 1 - m.t / 0.2); sy = 1 - k * 0.1; sx = 1 + k * 0.06; }
    if (m.st === 'hit') { rot = -0.08 * m.face * Math.max(0, 1 - m.t / 0.26); }
    if (m.st === 'dead') { rot = -m.face * Math.min(0.35, m.t * 0.8); alpha = Math.max(0, 1 - m.t / 0.9); }
    let rise = 0; if (m.st === 'spawn') { const k = Math.min(1, m.t / 0.8); rise = (1 - k * (2 - k)) * 120; alpha = Math.min(1, m.t * 2.5); }
    const s = SPR.js[pose];
    shadow(m.x, m.y, 22 * (1 - Math.min(0.4, m.z / 120)), 0.5 * alpha);
    if (rise > 0) { ctx.save(); ctx.beginPath(); ctx.rect(m.x - 90, m.y - 220, 180, 222); ctx.clip(); }
    drawSpr(s, m.x + ox, m.y - m.z + rise, m.face, { sx, sy, rot, alpha, flash: m.flash });
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
    const g = ctx.createRadialGradient(o.x, y, 0, o.x, y, 26); g.addColorStop(0, 'rgba(230,255,250,1)'); g.addColorStop(0.3, 'rgba(70,240,216,.9)'); g.addColorStop(1, 'rgba(10,80,70,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, y, 26, 0, TAU); ctx.fill();
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
    g.setTransform(k, 0, 0, k, (W / 2 - cam.x + shakeX) * k, (H * 0.5 - cam.y + shakeY) * k);
    g.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 0.75, 0, 0, TAU); g.fill(); };
    hole(hero.x, hero.y - 40, 190, 0.75);
    for (const p of props) if (p.k === 'brazier') hole(p.x, p.y - 60, 150 + Math.sin(T * 9 + p.t) * 8, 0.85);
    for (const o of orbs) hole(o.x, o.y - o.z, 110, 0.9);
    for (const r of rings) hole(r.x, r.y, r.r1 * 1.6, 0.6 * (1 - r.age / r.life));
    for (const s of slashes) hole(s.x, s.y - 30, 110, 0.7 * (1 - s.age / s.life));
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(lightCv, 0, 0, cv.width, cv.height);
  }
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = ctx.createRadialGradient(cv.width / 2, cv.height * 0.45, 0, cv.width / 2, cv.height * 0.45, cv.height * 0.7);
    bg.addColorStop(0, '#0d1a1b'); bg.addColorStop(1, '#020304'); ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(RS, 0, 0, RS, (W / 2 - cam.x + shakeX) * RS, (H * 0.5 - cam.y + shakeY) * RS);
    ctx.drawImage(groundCv, GB.x0, GB.y0, groundCv.width / RS, groundCv.height / RS);
    // 地面污迹
    for (const d of decals) {
      ctx.globalAlpha = d.a * Math.min(1, (14 - d.age) / 3); ctx.fillStyle = d.col;
      for (const [bx, by, br] of d.blobs) { ctx.beginPath(); ctx.ellipse(d.x + bx * d.s, d.y + by * d.s, d.s * br, d.s * br * 0.5, 0, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    // 跳尸落点预警
    for (const t of teles) {
      const u = Math.min(1, t.age / 0.5);
      ctx.strokeStyle = `rgba(255,50,40,${0.35 + 0.4 * u})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(t.x, t.y, 48, 18.5, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = `rgba(200,20,20,${0.22 * u})`; ctx.beginPath(); ctx.ellipse(t.x, t.y, 48 * u, 18.5 * u, 0, 0, TAU); ctx.fill();
    }
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
      else { const u = e.age / e.life; ctx.globalCompositeOperation = 'lighter'; drawSpr(SPR.hero[e.pose], e.x, e.y, e.face, { img: SPR.hero[e.pose].ghost, alpha: 0.5 * (1 - u) }); ctx.globalCompositeOperation = 'source-over'; }
    }
    drawParts('norm');
    for (const s of slashes) drawSlash(s);
    ctx.globalCompositeOperation = 'lighter'; drawParts('add');
    // 火盆辉光
    for (const p of props) if (p.k === 'brazier') { const r = 46 + Math.sin(T * 11 + p.t) * 4, g = ctx.createRadialGradient(p.x, p.y - 64, 0, p.x, p.y - 64, r); g.addColorStop(0, 'rgba(90,255,225,.35)'); g.addColorStop(1, 'rgba(0,80,70,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 64, r, 0, TAU); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
    drawLighting();
    // 伤害数字（在光照之上）
    ctx.setTransform(RS, 0, 0, RS, (W / 2 - cam.x + shakeX) * RS, (H * 0.5 - cam.y + shakeY) * RS);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const n of nums) {
      const u = n.age / n.life, pop = u < 0.15 ? 1 + (1 - u / 0.15) * (n.crit ? 0.9 : 0.5) : 1;
      const y = n.y - n.z - u * 34, x = n.x + n.vx * u;
      ctx.globalAlpha = Math.min(1, (1 - u) * 3);
      ctx.font = `900 ${(n.crit ? 22 : 16) * pop}px "STKaiti","KaiTi","Noto Serif CJK SC",serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = '#0a0503'; ctx.strokeText(n.v, x, y); ctx.fillStyle = n.col; ctx.fillText(n.v, x, y);
    }
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

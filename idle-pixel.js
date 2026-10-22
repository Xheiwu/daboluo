// ========== idle-pixel.js - 镇妖塔像素角色（程序绘制） ==========
// 每个角色用几何部件在小画布上逐像素画出：三阶明暗（左上受光）、自动描边（取相邻色的暗色）、
// 多帧动作（待机 2 帧、行走 4 帧、出招 2 帧、施法、受击）。普通角色 40×36，镇守 48×44。
// IdlePixel.frame(key, name) 返回该帧的 canvas；帧名：idle0 idle1 walk0-3 atk0 atk1 cast hurt。
(function (root) {
  // ---------- 调色板：每组 [高光, 基色, 暗部, 最暗] ----------
  const C = {
    skin: ['#ffe0c2', '#f0bd94', '#cf8a68', '#8f5541'],
    pale: ['#f4f1ea', '#d8d3cc', '#a9a2a6', '#6f6878'],
    corpse: ['#d6e0b8', '#a9b98e', '#7a8c6a', '#4c5a48'],
    ghostc: ['#f2fffd', '#bdeef0', '#7fc2d4', '#4c7f9e'],
    hair: ['#55506e', '#2e2a40', '#1d1a29', '#0f0d16'],
    whiteHair: ['#ffffff', '#e8e6f0', '#b8b4cc', '#7c7896'],
    blue: ['#9fd0f2', '#5a9bd4', '#386aa6', '#23426e'],
    navy: ['#5b6a96', '#3a4570', '#262e50', '#171c34'],
    white: ['#ffffff', '#eef0f5', '#c3c8d8', '#878ea6'],
    red: ['#ff9b86', '#e2483c', '#a92b31', '#691a25'],
    crimson: ['#ff7088', '#c8203f', '#86142d', '#4d0b1c'],
    brown: ['#d2a46c', '#a2703f', '#73492a', '#47291a'],
    leather: ['#b58457', '#83552f', '#5a3820', '#362012'],
    straw: ['#f6dc8c', '#d9b25c', '#a8803a', '#6d5024'],
    steel: ['#ffffff', '#d3dce8', '#8f9db2', '#58657c'],
    iron: ['#9aa7b0', '#66737e', '#444f5a', '#2a323b'],
    gold: ['#fff3ad', '#f4c34f', '#c88b2a', '#7d5317'],
    bronze: ['#f1c88a', '#c98f4e', '#8f5f30', '#573719'],
    bone: ['#fffbea', '#e9dfc0', '#bcae8a', '#7d7158'],
    bandage: ['#f6ecd0', '#d8c9a2', '#a89a76', '#6e634c'],
    green: ['#b6e88a', '#6fbf4f', '#3f8a3a', '#255a2a'],
    leaf: ['#c6f08a', '#7fcf54', '#4b9a3c', '#2b6230'],
    wood: ['#c79a6a', '#8f6440', '#62412a', '#3c2618'],
    purple: ['#d6a8ff', '#9a5fd8', '#6a3aa2', '#40216a'],
    violet: ['#b49ae0', '#7458b0', '#4c3780', '#2c1f52'],
    dark: ['#5a5070', '#3a3350', '#262136', '#151221'],
    fur: ['#e7a070', '#c0683e', '#8c432a', '#59291c'],
    fire: ['#fff7c0', '#ffc94a', '#ff7a2a', '#c43a1c'],
    teal: ['#9ff0dc', '#4cc4b0', '#2c8a86', '#1c5560'],
    orange: ['#ffc27a', '#f28a3a', '#b85a26', '#7a3618'],
  };
  const INK = '#1a1220';

  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };

  // ---------- 像素画布 ----------
  class Px {
    constructor(w, h) { this.w = w; this.h = h; this.c = new Array(w * h).fill(null); }
    px(x, y, col) { x = Math.round(x); y = Math.round(y); if (col && x >= 0 && y >= 0 && x < this.w && y < this.h) this.c[y * this.w + x] = col; }
    get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.c[y * this.w + x] : null; }
    // 渐变取色：v 越小越亮
    tone(r, v) { if (typeof r === 'string') return r; return v < -0.45 ? r[0] : v < 0.3 ? r[1] : v < 0.78 ? r[2] : r[3]; }
    ell(cx, cy, rx, ry, r, light = 1) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / (rx + 0.35), ny = (y - cy) / (ry + 0.35), d = nx * nx + ny * ny;
        if (d > 1) continue;
        this.px(x, y, this.tone(r, (nx * 0.6 + ny * 0.8) * light + d * 0.35 - 0.1));
      }
    }
    rect(x0, y0, w, h, r) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const tx = w > 1 ? i / (w - 1) : 0.5, ty = h > 1 ? j / (h - 1) : 0.5;
        this.px(x0 + i, y0 + j, this.tone(r, (tx - 0.4) * 1.5 + (ty - 0.5) * 0.7));
      }
    }
    // 多边形扫描填充，按包围盒做明暗
    poly(pts, r, light = 1) {
      const ys = pts.map(p => p[1]), xs = pts.map(p => p[0]);
      const minY = Math.floor(Math.min(...ys)), maxY = Math.ceil(Math.max(...ys)), minX = Math.min(...xs), maxX = Math.max(...xs);
      for (let y = minY; y <= maxY; y++) {
        const cross = [];
        for (let i = 0; i < pts.length; i++) {
          const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
          if ((y + 0.5 >= Math.min(y1, y2)) && (y + 0.5 < Math.max(y1, y2))) cross.push(x1 + (y + 0.5 - y1) / (y2 - y1) * (x2 - x1));
        }
        cross.sort((a, b) => a - b);
        for (let k = 0; k + 1 < cross.length; k += 2) for (let x = Math.round(cross[k]); x < Math.round(cross[k + 1]); x++) {
          const tx = (x - minX) / Math.max(1, maxX - minX), ty = (y - minY) / Math.max(1, maxY - minY);
          this.px(x, y, this.tone(r, ((tx - 0.42) * 1.6 + (ty - 0.5) * 0.6) * light));
        }
      }
    }
    line(x0, y0, x1, y1, col) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= n; i++) this.px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, col);
    }
    // 粗线（四肢）：外侧暗、内侧亮
    limb(x0, y0, x1, y1, th, r) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
        for (let a = 0; a < th; a++) for (let b = 0; b < th; b++) this.px(x - (th - 1) / 2 + a, y - (th - 1) / 2 + b, this.tone(r, a === 0 && b === 0 ? -0.6 : a + b >= th ? 0.5 : 0));
      }
    }
    // 自动描边：透明像素若挨着实色，就填该色的暗色（彩色描边比纯黑更柔和）
    outline() {
      const out = this.c.slice();
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        const n = this.get(x, y - 1) || this.get(x, y + 1) || this.get(x - 1, y) || this.get(x + 1, y);
        if (n) out[y * this.w + x] = mix(n, INK, 0.78);
      }
      this.c = out;
    }
    toCanvas() {
      const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(this.w, this.h) : Object.assign(document.createElement('canvas'), { width: this.w, height: this.h });
      const g = cv.getContext('2d'), img = g.createImageData(this.w, this.h);
      this.c.forEach((col, i) => {
        if (!col) return;
        const [r, gg, b] = hex(col.slice(0, 7));
        const a = col.length > 7 ? parseInt(col.slice(7, 9), 16) : 255;
        img.data.set([r, gg, b, a], i * 4);
      });
      g.putImageData(img, 0, 0);
      return cv;
    }
  }

  // ---------- 动作 ----------
  const FRAMES = {
    idle0: { bob: 0, t: 0 }, idle1: { bob: 1, t: 1 },
    walk0: { phase: 0, bob: 0, t: 0 }, walk1: { phase: 1, bob: -1, t: 1 }, walk2: { phase: 2, bob: 0, t: 0 }, walk3: { phase: 3, bob: -1, t: 1 },
    atk0: { atk: 1, bob: 0, t: 0 }, atk1: { atk: 2, bob: 0, t: 1 },
    cast: { cast: 1, bob: -1, t: 1 }, hurt: { hurt: 1, bob: 1, t: 0 },
  };
  const FRAME_NAMES = Object.keys(FRAMES);

  // 武器：从手部沿角度画出
  function sword(B, x, y, a, len = 10, blade = C.steel, hilt = C.gold) {
    const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    B.px(x - dx, y - dy, hilt[2]);
    for (let i = 1; i <= len; i++) {
      B.px(x + dx * i, y + dy * i, i === 1 ? hilt[1] : blade[i < len ? 1 : 0]);
      if (i > 1 && i < len) B.px(x + dx * i + nx * 0.6, y + dy * i + ny * 0.6, blade[i % 3 === 0 ? 0 : 2]);
    }
    B.px(x + dx + nx, y + dy + ny, hilt[1]); B.px(x + dx - nx, y + dy - ny, hilt[2]);
  }
  function stick(B, x, y, a, len, r) {
    for (let i = -3; i <= len; i++) B.px(x + Math.cos(a) * i, y + Math.sin(a) * i, r[i < 0 ? 2 : i % 4 === 0 ? 0 : 1]);
  }

  // 手部位置
  function handPos(P, S, front, ux, sy) {
    const sx = front ? ux + 3 : ux - 3;
    if (S.armsForward) return [sx + 7, sy + 2 + (front ? 0 : 1) + (P.t ? 1 : 0)];
    if (front) {
      if (P.atk === 1) return [ux, sy - 4];
      if (P.atk === 2) return [ux + 9, sy + 3];
      if (P.cast) return [ux + 8, sy];
      if (P.hurt) return [ux + 5, sy + 4];
      const sw = P.phase === 0 ? 2 : P.phase === 2 ? -2 : 0;
      return [ux + 4 + sw, sy + 7];
    }
    if (P.atk === 2) return [ux - 6, sy + 5];
    if (P.cast) return [ux - 6, sy + 2];
    const sw = P.phase === 0 ? -2 : P.phase === 2 ? 2 : 0;
    return [ux - 4 + sw, sy + 7];
  }
  function weaponAngle(P) {
    if (P.atk === 1) return -2.3;
    if (P.atk === 2) return 0.08;
    if (P.cast) return -0.9;
    if (P.hurt) return 1.9;
    return 1.15;
  }

  // ---------- 通用人形 ----------
  function humanoid(B, P, S) {
    const cx = S.cx != null ? S.cx : 19, foot = S.foot != null ? S.foot : 33;
    const lean = P.atk === 2 ? 1 : P.atk === 1 ? -1 : P.hurt ? -1 : 0;
    const by = P.bob + (S.hop ? (P.phase === 1 || P.phase === 3 ? -3 : 0) : 0);
    const legLen = S.legLen || 7, torso = S.torso || 10;
    const hip = foot - legLen, sy = hip - torso + by, ux = cx + lean;
    const sw = S.sw || 4, hw = S.hw || 5, hem = hip + by + (S.skirt != null ? S.skirt : 2);
    const ctx = { cx, ux, sy, hip: hip + by, foot, hem, by, sw, hw };
    if (S.back) S.back(B, P, ctx);
    // 后手
    if (!S.noArms) {
      const [bx, bhy] = handPos(P, S, false, ux, sy);
      B.limb(ux - sw + 1, sy + 2, bx, bhy, 2, (S.sleeve || S.robe).map(c => mix(c, INK, 0.25)));
      B.px(bx, bhy + 1, (S.hand || C.skin)[2]);
      if (S.backItem) S.backItem(B, P, bx, bhy + 1, ctx);
    }
    // 腿
    if (!S.noLegs) {
      let off = [0, 0], lift = [0, 0];
      if (!S.hop) {
        if (P.phase === 0) off = [2, -2]; else if (P.phase === 2) off = [-2, 2];
        else if (P.phase === 1) lift = [2, 0]; else if (P.phase === 3) lift = [0, 2];
      }
      if (P.atk === 2) off = [3, -2];
      const hy = hip + by - 1, legs = [[cx - 3 + off[1], lift[1], true], [cx + 1 + off[0], lift[0], false]];
      for (const [lx, lf, back] of legs) {
        const pants = back ? (S.pants || C.navy).map(c => mix(c, INK, 0.25)) : (S.pants || C.navy);
        const bottom = foot - lf - (S.hop ? Math.max(0, -by + P.bob) : 0);
        B.rect(lx, hy, S.legW || 3, Math.max(1, bottom - hy - 1), pants);
        B.rect(lx, bottom - 2, (S.legW || 3) + 1, 2, S.boots || C.leather);
      }
    }
    // 身躯（上窄下宽的袍子）
    B.poly([[ux - sw, sy], [ux + sw + 1, sy], [ux + hw + 1, hem], [ux - hw, hem]], S.robe);
    if (S.chest) S.chest(B, P, ctx);
    // 头
    const hr = S.headR || 5, hx = ux + 1, hyy = sy - hr + 1 + (S.headDrop || 0);
    if (S.neck !== false) B.rect(hx - 1, sy - 1, 3, 2, (S.skinR || C.skin));
    if (S.headBack) S.headBack(B, P, hx, hyy, ctx);
    if (!S.noFace) B.ell(hx, hyy, hr, hr - 0.3, S.skinR || C.skin);
    if (S.head) S.head(B, P, hx, hyy, ctx);
    if (!S.noFace && !S.noEyes) {
      const ey = hyy + (S.eyeY != null ? S.eyeY : 1), col = S.eye || INK;
      if (P.hurt) { B.px(hx + 1, ey, col); B.px(hx + 4, ey, col); B.px(hx + 2, ey + 1, col); }
      else { B.px(hx + 1, ey, col); B.px(hx + 1, ey + 1, col); B.px(hx + 4, ey, col); B.px(hx + 4, ey + 1, col); if (S.eyeShine) { B.px(hx + 1, ey, S.eyeShine); B.px(hx + 4, ey, S.eyeShine); } }
      if (S.blush) B.px(hx + 5, ey + 2, S.blush);
    }
    // 前手 + 武器
    if (!S.noArms) {
      const [fx, fy] = handPos(P, S, true, ux, sy);
      if (S.weapon && S.weaponBehind) S.weapon(B, P, fx, fy, weaponAngle(P), ctx);
      B.limb(ux + sw - 1, sy + 2, fx, fy, 2, S.sleeve || S.robe);
      if (S.weapon && !S.weaponBehind) S.weapon(B, P, fx, fy, weaponAngle(P), ctx);
      B.rect(fx, fy, 2, 2, S.hand || C.skin);
    }
    if (S.front) S.front(B, P, ctx);
  }

  // ---------- 角色定义 ----------
  const DEFS = {
    // 主角：束发少侠，红发带、青白长衫、长剑
    hero: { w: 40, h: 36, draw(B, P) {
      humanoid(B, P, {
        robe: C.blue, sleeve: C.blue, pants: C.navy, boots: C.leather, skirt: 3,
        back(B, P, k) { // 披风飘带
          const f = P.phase >= 0 && P.phase != null ? 2 : 0;
          B.poly([[k.ux - 3, k.sy + 1], [k.ux + 2, k.sy + 1], [k.ux - 1, k.hem + 1], [k.ux - 7 - f, k.hem - 1 + P.t]], C.navy);
        },
        chest(B, P, k) {
          B.line(k.ux - 2, k.sy, k.ux + 1, k.sy + 4, C.white[1]); B.line(k.ux + 4, k.sy, k.ux + 1, k.sy + 4, C.white[2]);
          B.rect(k.ux - 4, k.hip - 2, 10, 2, C.red); B.px(k.ux + 1, k.hip - 2, C.gold[0]);
          B.px(k.ux - 5, k.hip - 1, C.red[2]); B.px(k.ux - 6, k.hip + P.t, C.red[2]);
        },
        head(B, P, x, y) {
          B.ell(x - 0.8, y - 3.2, 6.2, 3.4, C.hair);           // 头发
          B.rect(x - 6, y - 2, 3, 6, C.hair);                    // 鬓发（后脑）
          B.px(x + 1, y - 1, C.hair[1]); B.px(x + 2, y - 1, C.hair[1]); B.px(x + 4, y - 1, C.hair[2]); B.px(x - 1, y - 1, C.hair[2]); // 刘海
          B.ell(x - 2, y - 8, 2.2, 1.8, C.hair);                 // 发髻
          B.rect(x - 4, y - 6, 8, 1, C.red);                     // 发带
          B.px(x - 5, y - 6, C.red[1]); B.px(x - 6, y - 5 + P.t, C.red[1]); B.px(x - 7, y - 5, C.red[2]); B.px(x - 8, y - 4 - P.t, C.red[2]);
        },
        eyeShine: '#3b5ea8', blush: '#f0907a', headR: 6, eyeY: 1,
        weapon(B, P, x, y, a) { sword(B, x + 1, y + 1, a, 11); },
      });
    } },

    // 山魈：红脸蓝颊的猿妖，长臂利爪
    melee: { w: 40, h: 36, draw(B, P) {
      const by = P.bob, lean = P.atk === 2 ? 2 : P.atk === 1 ? -1 : 0, cx = 19 + lean;
      const step = P.phase === 0 ? 1 : P.phase === 2 ? -1 : 0;
      B.limb(cx - 6, 20 + by, cx - 8 - step, 30, 3, C.fur.map(c => mix(c, INK, 0.3)));
      B.rect(cx - 4 - step, 27, 4, 5, C.fur.map(c => mix(c, INK, 0.25))); B.rect(cx + 2 + step, 27, 4, 5, C.fur);
      B.ell(cx, 21 + by, 8, 7, C.fur);                      // 躯干
      B.ell(cx + 1, 23 + by, 4, 4, C.straw);                  // 肚皮
      B.ell(cx + 2, 12 + by, 6, 5.5, C.fur);                  // 头
      B.ell(cx + 4, 13 + by, 3.6, 3.6, C.red);                // 红脸
      B.rect(cx + 4, 11 + by, 1, 5, C.red[0]);
      B.px(cx + 2, 13 + by, '#4f7fe0'); B.px(cx + 2, 14 + by, '#2f5fc0'); B.px(cx + 7, 13 + by, '#4f7fe0'); B.px(cx + 7, 14 + by, '#2f5fc0');
      B.px(cx + 3, 11 + by, '#ffe14d'); B.px(cx + 6, 11 + by, '#ffe14d');
      B.rect(cx + 3, 16 + by, 4, 1, '#3a1010'); B.px(cx + 3, 16 + by, C.bone[0]); B.px(cx + 6, 16 + by, C.bone[0]);
      B.px(cx - 2, 7 + by, C.fur[2]); B.px(cx - 3, 6 + by, C.fur[3]); B.px(cx + 6, 7 + by, C.fur[2]); // 耳
      const hx = P.atk === 1 ? cx + 2 : P.atk === 2 ? cx + 13 : cx + 8 + step, hy = P.atk === 1 ? 6 + by : P.atk === 2 ? 18 : 28;
      B.limb(cx + 5, 18 + by, hx, hy, 3, C.fur);
      B.px(hx + 2, hy - 1, C.bone[0]); B.px(hx + 2, hy + 1, C.bone[0]); B.px(hx + 3, hy, C.bone[1]);
    } },

    // 尸傀：清官帽、额贴黄符、双臂平伸、蹦跳
    zombie: { w: 40, h: 36, draw(B, P) {
      humanoid(B, P, {
        robe: C.navy, sleeve: C.navy, pants: C.dark, boots: C.dark, hand: C.corpse, skinR: C.corpse,
        armsForward: true, hop: true, legW: 3, skirt: 4, eye: '#e04040',
        chest(B, P, k) { B.rect(k.ux - 2, k.sy + 3, 6, 5, C.orange); B.ell(k.ux + 1, k.sy + 5, 1.5, 1.5, C.gold); B.rect(k.ux - 4, k.hip - 1, 10, 1, C.red[2]); },
        head(B, P, x, y) {
          B.ell(x, y - 3, 6, 2.5, C.dark); B.rect(x - 6, y - 2, 13, 2, C.dark);   // 帽
          B.ell(x, y - 6, 1.5, 1.5, C.red);                                         // 顶珠
          B.rect(x + 2, y - 1, 3, 7, C.straw);                                      // 黄符
          B.px(x + 3, y, C.red[1]); B.px(x + 3, y + 2, C.red[1]); B.px(x + 4, y + 3, C.red[2]); B.px(x + 3, y + 4, C.red[1]);
          B.px(x + 2, y + 6 + P.t, C.straw[2]);
        },
      });
    } },

    // 阴兵弓手：铁甲红缨，面甲下两点青光，持弓
    ranged: { w: 40, h: 36, draw(B, P) {
      humanoid(B, P, {
        robe: C.iron, sleeve: C.iron, pants: C.dark, boots: C.dark, hand: C.iron, skinR: C.dark, eye: '#7ff0ff', eyeShine: '#e0ffff', skirt: 2,
        chest(B, P, k) {
          for (let y = k.sy + 2; y < k.hip; y += 2) B.line(k.ux - 3, y, k.ux + 4, y, C.iron[3]);
          B.rect(k.ux - 4, k.hip - 1, 10, 2, C.leather);
          B.rect(k.ux - 6, k.hem - 1, 2, 3, C.red[2]); B.rect(k.ux + 6, k.hem - 1, 2, 3, C.red[2]);
        },
        head(B, P, x, y) {
          B.ell(x, y - 1.5, 5.6, 4, C.iron); B.rect(x - 5, y, 11, 1, C.iron[2]);
          B.rect(x, y - 7, 2, 3, C.gold); B.px(x - 1, y - 8, C.red[1]); B.px(x - 2, y - 8 + P.t, C.red[1]); B.px(x - 3, y - 7, C.red[2]); B.px(x - 4, y - 7 - P.t, C.red[2]);
        },
        backItem(B, P, x, y) { for (let i = 0; i < 4; i++) B.px(x - 2 + i, y - 10 + i, C.wood[1]); },
        weapon(B, P, x, y) { // 弓
          const draw = P.atk === 1 ? 2 : 0;
          for (let i = -6; i <= 6; i++) B.px(x + 2 + Math.round(Math.cos(i / 6 * 1.3) * 3), y + i, C.wood[i < 0 ? 0 : 1]);
          B.line(x + 2 - draw, y - 6, x + 2 - draw, y + 6, C.white[2]);
          if (P.atk) B.line(x - 3 - draw, y, x + 7, y, C.steel[1]);
        },
      });
    } },

    // 白骨卒：骷髅兵，锈刀圆盾
    skeleton: { w: 40, h: 36, draw(B, P) {
      humanoid(B, P, {
        robe: C.bone, sleeve: C.bone, pants: C.bone, boots: C.bone, hand: C.bone, skinR: C.bone, legW: 2, sw: 3, hw: 3, skirt: 0, eye: '#ff5a3a',
        chest(B, P, k) {
          B.poly([[k.ux - 3, k.sy], [k.ux + 4, k.sy], [k.ux + 4, k.hip - 3], [k.ux - 3, k.hip - 3]], C.dark);
          for (let y = k.sy + 1; y < k.hip - 3; y += 2) B.line(k.ux - 3, y, k.ux + 4, y, C.bone[1]);
          B.rect(k.ux, k.sy, 1, k.hip - k.sy, C.bone[2]);
          B.rect(k.ux - 3, k.hip - 2, 8, 2, C.leather);
        },
        head(B, P, x, y) { B.rect(x - 1, y + 3, 5, 2, C.bone); B.px(x, y + 4, C.dark[3]); B.px(x + 2, y + 4, C.dark[3]); B.px(x + 3, y + 2, C.dark[3]); },
        backItem(B, P, x, y) { B.ell(x - 1, y - 2, 4, 5, C.wood); B.ell(x - 1, y - 2, 1.5, 1.5, C.iron); },
        weapon(B, P, x, y, a) { sword(B, x + 1, y + 1, a, 9, C.bronze, C.leather); },
      });
    } },

    // 魈巫：鸟骨面具、羽毛斗篷、骷髅法杖紫焰
    shaman: { w: 40, h: 36, draw(B, P) {
      humanoid(B, P, {
        robe: C.green, sleeve: C.green, pants: C.leather, boots: C.leather, hand: C.fur, skinR: C.fur, torso: 9, legLen: 5, skirt: 3, hw: 7, eye: '#ffd24d', noEyes: false,
        back(B, P, k) { for (let i = 0; i < 6; i++) B.limb(k.ux - 2, k.sy + 1, k.ux - 6 - i % 3, k.hem - i, 2, i % 2 ? C.purple : C.green); },
        chest(B, P, k) { for (let i = -3; i <= 4; i += 2) { B.px(k.ux + i, k.sy + 2, C.bone[0]); B.px(k.ux + i, k.sy + 3, C.red[1]); } },
        head(B, P, x, y) {
          B.ell(x, y, 5, 4.4, C.bone);
          B.poly([[x + 3, y], [x + 9, y + 2], [x + 3, y + 3]], C.bone);   // 喙
          B.px(x - 2, y - 5, C.purple[1]); B.px(x - 3, y - 6, C.purple[0]); B.px(x, y - 6, C.red[1]); B.px(x + 1, y - 7, C.red[0]); B.px(x - 4, y - 4, C.green[0]);
          B.px(x + 1, y, INK); B.px(x + 3, y, INK);
        }, noEyes: true,
        weaponBehind: true,
        weapon(B, P, x, y) {
          stick(B, x + 1, y + 1, -1.57, 12, C.wood);
          B.ell(x + 1, y - 12, 2.2, 2, C.bone); B.px(x + 2, y - 12, INK);
          const f = P.cast || P.atk ? 3 : 2;
          for (let i = 0; i < f + 1; i++) B.px(x + 1 + (i % 2 ? 1 : -1) * (i > 1 ? 1 : 0), y - 15 - i, C.purple[i ? 0 : 1]);
        },
      });
    } },

    // 游魂：飘浮的白影，空洞双目
    ghost: { w: 40, h: 36, draw(B, P) {
      const by = P.bob * 2 - 2 + (P.phase === 1 || P.phase === 3 ? -1 : 0), cx = 19 + (P.atk === 2 ? 3 : 0);
      const R = C.ghostc.map(c => c + 'd8');
      for (let i = 0; i < 9; i++) B.ell(cx - i * 0.7 + Math.sin(i * 0.9 + P.t * 2) * 1.2, 20 + by + i * 1.3, 6 - i * 0.6, 2.5, R);
      B.ell(cx, 14 + by, 7, 7.5, R);
      const lx = P.atk ? cx + 9 : cx + 7;
      B.limb(cx + 4, 17 + by, lx, 20 + by - (P.atk ? 3 : 0), 2, R);
      B.ell(cx + 1, 13 + by, 1.3, 2, '#1d2a40'); B.ell(cx + 5, 13 + by, 1.3, 2, '#1d2a40');
      B.ell(cx + 3, 18 + by, 1, P.atk ? 1.6 : 1, '#1d2a40');
    } },

    // 幽冥使：兜帽黑袍、提绿灯笼、漂浮无足
    specter: { w: 40, h: 36, draw(B, P) {
      humanoid(B, P, {
        robe: C.violet, sleeve: C.violet, hand: C.pale, skinR: C.dark, noLegs: true, torso: 15, legLen: 2, foot: 31 - P.t, skirt: 2, hw: 7, sw: 4, eye: '#d29bff', eyeShine: '#ffffff',
        chest(B, P, k) {
          for (let i = 0; i < 5; i++) B.px(k.ux - 6 + i * 3, k.hem + (i + P.t) % 2, C.violet[2]);
          B.rect(k.ux, k.sy + 2, 1, k.hem - k.sy - 2, C.violet[3]);
        },
        headBack(B, P, x, y) { B.ell(x - 1, y - 1, 6.5, 6.5, C.violet); },
        head(B, P, x, y) { B.ell(x + 1, y - 2, 4, 2, C.violet[1]); },
        weapon(B, P, x, y) {
          B.line(x + 1, y + 1, x + 1, y + 4, C.iron[2]);
          B.rect(x - 1, y + 5, 5, 5, C.iron); B.rect(x, y + 6, 3, 3, ['#e8ffd0', '#9cff6a', '#5fd040', '#2f8a30']);
        },
      });
    } },

    // 缠尸：周身裹布，独眼红光
    mummy: { w: 40, h: 36, draw(B, P) {
      humanoid(B, P, {
        robe: C.bandage, sleeve: C.bandage, pants: C.bandage, boots: C.bandage, hand: C.bandage, skinR: C.bandage, sw: 5, hw: 5, skirt: 0, armsForward: P.atk !== 0 ? false : true,
        noEyes: true,
        chest(B, P, k) { for (let y = k.sy + 1; y < k.hem; y += 2) B.line(k.ux - 5 + (y % 4 ? 1 : 0), y, k.ux + 5, y + (y % 4 ? 1 : 0), C.bandage[2]); B.px(k.ux + 3, k.sy + 4, C.leather[2]); },
        head(B, P, x, y) {
          for (let yy = y - 4; yy <= y + 4; yy += 2) B.line(x - 4, yy, x + 4, yy + 1, C.bandage[2]);
          B.px(x + 3, y + 1, '#ff3a2a'); B.px(x + 4, y + 1, '#ffb0a0'); B.px(x - 4, y + 4 + P.t, C.bandage[1]); B.px(x - 5, y + 5 + P.t, C.bandage[2]);
        },
        weapon(B, P, x, y) { B.line(x + 1, y + 2, x - 1 + P.t, y + 6, C.bandage[2]); },
      });
    } },

    // 血魔：苍白面孔、背后高领血色披风、利爪
    vampire: { w: 40, h: 36, draw(B, P) {
      humanoid(B, P, {
        robe: C.dark, sleeve: C.dark, pants: C.dark, boots: C.dark, hand: C.pale, skinR: C.pale, eye: '#ff2a3a', eyeShine: '#ffb0b8',
        back(B, P, k) {
          const fl = P.phase === 0 || P.phase === 2 ? 2 : 0;
          B.poly([[k.ux - 6, k.sy - 4], [k.ux + 6, k.sy - 4], [k.ux + 7, k.hem + 1], [k.ux - 9 - fl, k.hem + 1 + P.t]], C.crimson);
        },
        chest(B, P, k) { B.poly([[k.ux - 1, k.sy], [k.ux + 2, k.sy], [k.ux + 1, k.sy + 5]], C.white); B.px(k.ux + 1, k.sy + 2, C.crimson[1]); },
        head(B, P, x, y) {
          B.ell(x - 0.5, y - 2, 5.4, 3, C.hair); B.px(x + 2, y - 2, C.hair[3]); B.px(x + 2, y - 1, C.hair[3]);
          B.px(x - 4, y - 5, C.hair[2]); B.px(x + 3, y - 5, C.hair[2]);
          B.px(x + 2, y + 4, C.white[0]); B.px(x + 4, y + 4, C.white[0]);
        },
        weapon(B, P, x, y) { B.px(x + 2, y - 1, C.white[1]); B.px(x + 3, y, C.white[1]); B.px(x + 2, y + 2, C.white[1]); },
      });
    } },

    // 游商：斗笠、大背篓、竹杖
    merchant: { w: 40, h: 36, draw(B, P) {
      humanoid(B, P, {
        robe: C.brown, sleeve: C.brown, pants: C.leather, boots: C.leather, skirt: 3,
        back(B, P, k) {
          B.rect(k.ux - 10, k.sy - 3, 8, 12, C.wood);
          for (let y = k.sy - 2; y < k.sy + 9; y += 3) B.line(k.ux - 10, y, k.ux - 3, y, C.wood[3]);
          B.rect(k.ux - 9, k.sy - 6, 3, 3, C.red); B.rect(k.ux - 6, k.sy - 5, 3, 2, C.gold); B.px(k.ux - 8, k.sy - 8, C.green[1]); B.px(k.ux - 7, k.sy - 9, C.green[0]);
        },
        chest(B, P, k) { B.rect(k.ux - 4, k.hip - 2, 10, 2, C.green); B.ell(k.ux + 4, k.hip + 1, 1.5, 2, C.gold); },
        head(B, P, x, y) { B.poly([[x - 9, y - 1], [x + 10, y - 1], [x + 1, y - 7]], C.straw); B.line(x - 8, y - 1, x + 9, y - 1, C.straw[2]); B.px(x + 5, y + 4, C.hair[1]); B.px(x + 3, y + 4, C.hair[1]); },
        eyeY: 1.5,
        weapon(B, P, x, y) { stick(B, x + 1, y + 1, 1.45, 10, C.straw); stick(B, x + 1, y + 1, -1.7, 6, C.straw); },
      });
    } },

    // ===== 镇守（48×44，前景更大） =====
    // 血衣罗刹：黑长发、血色广袖、双弯刀
    bloodRaven: { w: 48, h: 44, draw(B, P) {
      humanoid(B, P, {
        cx: 23, foot: 41, torso: 12, legLen: 8, sw: 5, hw: 8, skirt: 3, headR: 6,
        robe: C.crimson, sleeve: C.red, pants: C.dark, boots: C.dark, skinR: C.pale, hand: C.pale, eye: '#ff2040', eyeShine: '#ffd0d8',
        back(B, P, k) { B.poly([[k.ux - 6, k.sy - 6], [k.ux + 2, k.sy - 6], [k.ux - 2, k.hem - 2], [k.ux - 12, k.hem - 4 + P.t]], C.hair); },
        chest(B, P, k) { B.rect(k.ux - 5, k.hip - 3, 12, 2, C.gold); B.line(k.ux - 2, k.sy, k.ux + 1, k.sy + 5, C.gold[1]); B.line(k.ux + 5, k.sy, k.ux + 2, k.sy + 5, C.gold[2]); },
        head(B, P, x, y) { B.ell(x - 1, y - 2, 6.6, 4, C.hair); B.rect(x - 6, y - 1, 3, 9, C.hair); B.px(x + 3, y - 2, C.hair[2]); B.rect(x - 2, y - 6, 5, 1, C.gold); B.px(x + 3, y + 4, C.crimson[1]); B.px(x - 1, y - 7, C.red[0]); },
        backItem(B, P, x, y) { sword(B, x, y, P.atk === 2 ? 2.4 : 2.0, 10, C.crimson, C.gold); },
        weapon(B, P, x, y, a) { sword(B, x + 1, y + 1, a, 12, C.crimson, C.gold); },
      });
    } },

    // 白骨夫人：白发骨冠、素白长裙、骨杖
    countess: { w: 48, h: 44, draw(B, P) {
      humanoid(B, P, {
        cx: 23, foot: 41, torso: 12, legLen: 8, sw: 5, hw: 9, skirt: 7, headR: 6, noLegs: true,
        robe: C.white, sleeve: C.white, skinR: C.pale, hand: C.pale, eye: '#4ad0ff', eyeShine: '#e0ffff', weaponBehind: true,
        back(B, P, k) { B.poly([[k.ux - 7, k.sy - 6], [k.ux + 1, k.sy - 6], [k.ux - 3, k.hem - 3], [k.ux - 11, k.hem - 6 + P.t]], C.whiteHair); },
        chest(B, P, k) {
          B.rect(k.ux - 5, k.hip - 2, 12, 2, C.violet); B.ell(k.ux + 1, k.sy + 4, 2, 2, C.bone); B.px(k.ux, k.sy + 4, INK); B.px(k.ux + 2, k.sy + 4, INK);
          for (let i = 0; i < 6; i++) B.px(k.ux - 7 + i * 3, k.hem - 1, C.violet[1]);
        },
        head(B, P, x, y) {
          B.ell(x - 1, y - 2, 6.6, 4, C.whiteHair); B.rect(x - 6, y - 1, 3, 10, C.whiteHair);
          for (let i = -2; i <= 3; i++) { B.px(x + i, y - 6 - (i % 2 ? 2 : 0), C.bone[0]); B.px(x + i, y - 5, C.bone[2]); }
        },
        weapon(B, P, x, y) { stick(B, x + 1, y + 1, -1.6, 15, C.bone); B.ell(x + 1, y - 15, 2.6, 2.4, C.bone); B.px(x, y - 15, INK); B.px(x + 2, y - 15, INK); if (P.cast || P.atk) { B.px(x + 1, y - 19, '#9ff0ff'); B.px(x + 2, y - 18, '#4ad0ff'); } },
      });
    } },

    // 铜甲尸王：魁梧铜甲、青面獠牙、巨斧
    butcher: { w: 48, h: 44, draw(B, P) {
      humanoid(B, P, {
        cx: 22, foot: 41, torso: 13, legLen: 8, sw: 8, hw: 8, skirt: 2, headR: 6, legW: 5,
        robe: C.bronze, sleeve: C.bronze, pants: C.dark, boots: C.bronze, skinR: C.corpse, hand: C.corpse, eye: '#ffde3a', eyeShine: '#ffffff',
        chest(B, P, k) {
          B.ell(k.ux - 7, k.sy + 1, 4, 3, C.gold); B.ell(k.ux + 8, k.sy + 1, 4, 3, C.gold);   // 肩甲
          for (let y = k.sy + 4; y < k.hip; y += 3) B.line(k.ux - 6, y, k.ux + 7, y, C.bronze[3]);
          B.ell(k.ux + 1, k.sy + 6, 2.5, 2.5, C.teal);
          B.rect(k.ux - 7, k.hip - 1, 16, 2, C.leather);
        },
        head(B, P, x, y) {
          B.ell(x, y - 3, 6.5, 3, C.bronze); B.rect(x - 2, y - 9, 5, 4, C.gold); B.px(x, y - 10, C.red[1]);
          B.px(x + 2, y + 4, C.white[0]); B.px(x + 5, y + 4, C.white[0]); B.px(x + 2, y + 5, C.white[1]);
        },
        weapon(B, P, x, y, a) {
          stick(B, x + 1, y + 1, a, 14, C.wood);
          const ex = x + 1 + Math.cos(a) * 13, ey = y + 1 + Math.sin(a) * 13;
          B.ell(ex + Math.cos(a + 1.57) * 3, ey + Math.sin(a + 1.57) * 3, 3.4, 3.4, C.steel);
        },
      });
    } },

    // 千年树妖：树干身躯、树洞脸、枝臂、树冠
    duriel: { w: 48, h: 44, draw(B, P) {
      const by = P.bob, lean = P.atk === 2 ? 2 : P.atk === 1 ? -1 : 0, cx = 24 + lean;
      for (let i = -2; i <= 2; i++) B.limb(cx + i * 3, 34 + by, cx + i * 6 + (P.phase === 0 ? i : 0), 42, 2, C.wood);   // 根
      B.poly([[cx - 6, 10 + by], [cx + 6, 10 + by], [cx + 9, 38 + by], [cx - 9, 38 + by]], C.wood);
      for (let y = 14; y < 37; y += 4) B.line(cx - 5 + (y % 8 ? 1 : 0), y + by, cx - 4, y + 3 + by, C.wood[3]);
      const arm = P.atk === 1 ? [cx + 4, 2] : P.atk === 2 ? [cx + 20, 20] : [cx + 14, 26 + P.t];
      B.limb(cx + 5, 18 + by, arm[0], arm[1] + by, 3, C.wood);
      B.limb(arm[0], arm[1] + by, arm[0] + 3, arm[1] + by - 3, 1, C.wood); B.limb(arm[0], arm[1] + by, arm[0] + 3, arm[1] + by + 2, 1, C.wood);
      B.limb(cx - 5, 18 + by, cx - 15, 24 + by - P.t, 3, C.wood);
      B.ell(cx, 6 + by, 13, 7, C.leaf); B.ell(cx - 7, 9 + by, 6, 4, C.leaf); B.ell(cx + 8, 9 + by, 6, 4, C.leaf);
      for (let i = 0; i < 7; i++) B.px(cx - 9 + i * 3, 3 + by + (i % 2) * 3, C.leaf[0]);
      B.px(cx - 5, 8 + by, C.red[1]); B.px(cx + 6, 5 + by, C.red[1]);
      B.ell(cx - 3, 19 + by, 2, 2, INK); B.ell(cx + 3, 19 + by, 2, 2, INK);
      B.px(cx - 3, 19 + by, '#9cff6a'); B.px(cx + 3, 19 + by, '#9cff6a');
      B.ell(cx, 26 + by, 3, P.atk ? 3 : 2, INK);
    } },

    // 赤焰魔君：赤面巨角、烈焰发、黑甲火刃
    diablo: { w: 48, h: 44, draw(B, P) {
      humanoid(B, P, {
        cx: 22, foot: 41, torso: 13, legLen: 9, sw: 7, hw: 7, skirt: 2, headR: 6, legW: 4,
        robe: C.dark, sleeve: C.red, pants: C.red, boots: C.dark, skinR: C.red, hand: C.red, eye: '#fff36a', eyeShine: '#ffffff',
        headBack(B, P, x, y) { for (let i = 0; i < 9; i++) { const h = 5 + ((i * 7 + P.t * 3) % 5); B.line(x - 6 + i * 1.5, y - 3, x - 8 + i * 1.4, y - 3 - h, C.fire[i % 3]); } },
        chest(B, P, k) {
          B.ell(k.ux - 6, k.sy + 1, 3.5, 3, C.iron); B.ell(k.ux + 7, k.sy + 1, 3.5, 3, C.iron);
          B.poly([[k.ux - 2, k.sy + 3], [k.ux + 3, k.sy + 3], [k.ux + 1, k.sy + 9]], C.fire);
          B.rect(k.ux - 6, k.hip - 1, 14, 2, C.gold);
        },
        head(B, P, x, y) {
          B.limb(x - 3, y - 4, x - 7, y - 10, 2, C.bone); B.limb(x - 7, y - 10, x - 5, y - 13, 1, C.bone);
          B.limb(x + 4, y - 4, x + 8, y - 10, 2, C.bone); B.limb(x + 8, y - 10, x + 6, y - 13, 1, C.bone);
          B.rect(x + 1, y + 4, 4, 1, INK); B.px(x + 2, y + 4, C.white[0]);
        },
        weapon(B, P, x, y, a) { sword(B, x + 1, y + 1, a, 14, C.fire, C.iron); },
      });
    } },

    // 九幽冥王：高冠紫袍、长髯、幽冥宝珠
    baal: { w: 48, h: 44, draw(B, P) {
      humanoid(B, P, {
        cx: 23, foot: 41, torso: 14, legLen: 6, sw: 6, hw: 10, skirt: 5, headR: 6, noLegs: true,
        robe: C.purple, sleeve: C.purple, skinR: C.pale, hand: C.pale, eye: '#c070ff', eyeShine: '#ffffff',
        back(B, P, k) { B.poly([[k.ux - 8, k.sy - 2], [k.ux + 8, k.sy - 2], [k.ux + 11, k.hem + 1], [k.ux - 13, k.hem + 1 + P.t]], C.dark); },
        chest(B, P, k) {
          B.rect(k.ux, k.sy + 1, 2, k.hem - k.sy - 1, C.gold); B.rect(k.ux - 6, k.hip - 2, 14, 2, C.gold);
          for (let i = 0; i < 4; i++) B.px(k.ux - 8 + i * 5, k.hem - 2, C.gold[0]);
        },
        head(B, P, x, y) {
          B.rect(x - 4, y - 10, 10, 5, C.gold); B.rect(x - 5, y - 6, 12, 2, C.gold); B.px(x + 1, y - 9, C.purple[0]); B.px(x - 3, y - 11, C.gold[0]); B.px(x + 5, y - 11, C.gold[0]);
          B.poly([[x - 1, y + 3], [x + 6, y + 3], [x + 3, y + 11 + P.t]], C.whiteHair);
          B.rect(x - 5, y - 4, 2, 6, C.whiteHair);
        },
        weapon(B, P, x, y) {
          const glow = P.cast || P.atk ? 3.6 : 3;
          B.ell(x + 3, y - 3, glow, glow, ['#ffe0ff', '#c070ff', '#7a30c0', '#3a1060']);
          B.px(x + 2, y - 4, '#ffffff');
        },
      });
    } },
  };

  const cache = {};
  function build(key) {
    const d = DEFS[key];
    if (!d) return null;
    const out = {};
    for (const name of FRAME_NAMES) {
      const B = new Px(d.w, d.h);
      d.draw(B, Object.assign({ bob: 0, t: 0, phase: null, atk: 0, cast: 0, hurt: 0 }, FRAMES[name]));
      B.outline();
      out[name] = B;
    }
    return out;
  }
  const IdlePixel = {
    keys: Object.keys(DEFS),
    has(key) { return !!DEFS[key]; },
    size(key) { const d = DEFS[key]; return d ? [d.w, d.h] : null; },
    raw(key, name) { if (!(key in cache)) cache[key] = build(key); const f = cache[key]; return f && (f[name] || f.idle0); },
    frame(key, name) {
      const ck = key + ':' + name;
      if (cache[ck]) return cache[ck];
      const b = this.raw(key, name);
      return b ? (cache[ck] = b.toCanvas()) : null;
    },
    FRAMES: FRAME_NAMES,
  };
  root.IdlePixel = IdlePixel;
  if (typeof module !== 'undefined') module.exports = IdlePixel;
})(typeof window !== 'undefined' ? window : globalThis);

// ========== idle-sprites32.js - 镇妖塔 32×32 像素角色与技能特效 ==========
// 沿用第一版的配色（HOME_PALETTE，16 色）与平涂画风：每块颜色只有「本色 + 一级阴影」，外轮廓统一深色描边。
// 角色用几何部件逐像素拼出，按方向、动作生成多帧：
//   主角：S/SE/E/NE/N 五个方向（W/SW/NW 由镜像得到），每个方向 待机 2、行走 4、出招 3、运功 2、受击 1 帧；
//   妖物：侧身（镜像得另一侧），待机 2、行走 2、出招 2、受击 1 帧；镇守 48×48。
// 用法：IdleSprites.frame(key, frameName, dir) -> canvas；IdleSprites.fx(name, frame, dir) -> 特效帧。
(function (root) {
  const PAL = { k: '#1a1c2c', w: '#f4f4f4', g: '#94b0c2', G: '#566c86', D: '#333c57', r: '#b13e53', R: '#ef7d57', y: '#ffcd75', l: '#a7f070', e: '#38b764', E: '#257179', b: '#3b5dc9', B: '#41a6f6', c: '#73eff7', p: '#5d275d', n: '#8b5a2b', N: '#5a3a1e', t: '#d9a066', s: '#ffd8b1', P: '#ff9eb5', m: '#c8a0e0', o: '#f7a43a' };
  // 一级阴影（光从左上来，右下边缘压暗一格）
  const SH = { w: 'g', g: 'G', G: 'D', D: 'k', B: 'b', b: 'D', c: 'B', s: 't', t: 'n', n: 'N', N: 'k', R: 'r', r: 'p', P: 'r', y: 'o', o: 'n', l: 'e', e: 'E', E: 'D', m: 'p', p: 'k', k: 'k' };

  class Grid {
    constructor(w, h) { this.w = w; this.h = h; this.c = new Array(w * h).fill(null); }
    in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    px(x, y, col) { x = Math.round(x); y = Math.round(y); if (col && this.in(x, y)) this.c[y * this.w + x] = col; }
    get(x, y) { return this.in(x, y) ? this.c[y * this.w + x] : null; }
    // 把一组像素（mask）上色：本色 + 右下边缘阴影；ol=true 时先描一圈深色（部件之间的分隔线）
    paint(mask, col, opt = {}) {
      const key = (x, y) => y * 1000 + x, set = new Set(mask.map(([x, y]) => key(x, y)));
      if (opt.ol) for (const [x, y] of mask) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!set.has(key(x + dx, y + dy))) this.px(x + dx, y + dy, 'k');
      const sh = opt.flat ? col : (opt.sh || SH[col] || col);
      for (const [x, y] of mask) {
        const edge = !set.has(key(x + 1, y)) || !set.has(key(x, y + 1));
        const hi = opt.hi && !set.has(key(x - 1, y - 1)) && !set.has(key(x, y - 1));
        this.px(x, y, hi ? opt.hi : edge ? sh : col);
      }
    }
    ellMask(cx, cy, rx, ry) {
      const m = [];
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / (rx + 0.3), ny = (y - cy) / (ry + 0.3);
        if (nx * nx + ny * ny <= 1) m.push([x, y]);
      }
      return m;
    }
    polyMask(pts) {
      const m = [], ys = pts.map(p => p[1]);
      for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
          const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
          if (y + 0.5 >= Math.min(y1, y2) && y + 0.5 < Math.max(y1, y2)) xs.push(x1 + (y + 0.5 - y1) / (y2 - y1) * (x2 - x1));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) m.push([x, y]);
      }
      return m;
    }
    lineMask(x0, y0, x1, y1, th = 1) {
      const m = [], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1), seen = new Set();
      for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
        for (let a = 0; a < th; a++) for (let b = 0; b < th; b++) {
          const px = Math.round(x - (th - 1) / 2 + a), py = Math.round(y - (th - 1) / 2 + b), k = py * 1000 + px;
          if (!seen.has(k)) { seen.add(k); m.push([px, py]); }
        }
      }
      return m;
    }
    ell(cx, cy, rx, ry, col, opt) { this.paint(this.ellMask(cx, cy, rx, ry), col, opt); }
    poly(pts, col, opt) { this.paint(this.polyMask(pts), col, opt); }
    rect(x, y, w, h, col, opt) { this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], col, opt); }
    line(x0, y0, x1, y1, col, th = 1, opt = { flat: true }) { this.paint(this.lineMask(x0, y0, x1, y1, th), col, opt); }
    // 外轮廓：透明处挨着实色就描深色
    outline() {
      const out = this.c.slice();
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x + 1, y) || this.get(x - 1, y) || this.get(x, y + 1) || this.get(x, y - 1)) out[y * this.w + x] = 'k';
      }
      this.c = out;
    }
    toCanvas() {
      const cv = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: this.w, height: this.h }) : null;
      if (!cv) return null;
      const g = cv.getContext('2d'), img = g.createImageData(this.w, this.h);
      this.c.forEach((col, i) => {
        if (!col) return;
        const h = PAL[col] || col;
        img.data.set([parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255], i * 4);
      });
      g.putImageData(img, 0, 0);
      return cv;
    }
  }

  // 兵器：剑（刃白、锋灰、黄铜护手、褐柄）
  function sword(G, x, y, a, len = 9) {
    const dx = Math.cos(a), dy = Math.sin(a);
    G.px(x - dx * 2, y - dy * 2, 'n'); G.px(x - dx, y - dy, 'n');
    G.line(x + dx * 1 - dy * 1.5, y + dy * 1 + dx * 1.5, x + dx * 1 + dy * 1.5, y + dy * 1 - dx * 1.5, 'y');
    G.line(x + dx * 2, y + dy * 2, x + dx * len, y + dy * len, 'w');
    G.px(x + dx * (len + 1), y + dy * (len + 1), 'g');
  }

  // ---------- 主角：斗笠青衫、红围巾、长剑 ----------
  const DIRS = ['S', 'SE', 'E', 'NE', 'N'];
  const DV = { S: [0, 1], SE: [0.75, 0.66], E: [1, 0], NE: [0.75, -0.66], N: [0, -1] };
  // 各方向出招时持剑手的位置与剑的角度：[蓄力, 斩出, 收势]
  const HERO_ATK = {
    S: [[7, 13, -0.9], [3, 24, 2.3], [-5, 22, 2.9]],
    SE: [[7, 13, -1.2], [8, 22, 0.9], [2, 24, 2.2]],
    E: [[0, 12, -2.3], [8, 18, 0.1], [6, 22, 1.1]],
    NE: [[4, 21, 1.4], [8, 13, -0.8], [1, 12, -2.0]],
    N: [[5, 21, 1.5], [4, 12, -1.6], [-3, 12, -2.4]],
  };
  function heroDraw(G, P) {
    const d = P.dir, v = DV[d], back = d === 'N' || d === 'NE', side = d !== 'S' && d !== 'N';
    const lean = P.atk === 2 ? 1 : P.hurt ? -1 : 0;
    const cx = 16 + Math.round(v[0] * lean), by = P.bob + Math.round(v[1] * lean * 0.5);
    const foot = 30;
    // 红围巾飘带（在身后）
    const tailDir = side ? -1 : 1, flut = P.t ? 1 : 0;
    const scarfTail = () => {
      if (d === 'S') { G.line(cx + 3, 16 + by, cx + 6, 19 + by + flut, 'R', 2, {}); return; }
      if (d === 'N') { G.line(cx, 16 + by, cx + 1 + flut, 22 + by, 'R', 2, {}); return; }
      G.line(cx - 2, 15 + by, cx - 7, 17 + by - flut, 'R', 2, {}); G.px(cx - 8, 16 + by + flut, 'r');
    };
    if (!back) scarfTail();
    // 腿
    legs(G, P, cx, 23 + Math.max(0, by), foot, d, 'G', 'N');
    // 持剑手（背面时在身后先画）
    const atk = P.atk ? HERO_ATK[d][P.atk - 1] : null;
    const armOut = (front) => {
      let hx, hy, a;
      if (atk && front) [hx, hy, a] = [cx + atk[0], atk[1] + by, atk[2]];
      else if (P.cast && front) { const r = P.cast === 2 ? 9 : 4; hx = cx + Math.round(v[0] * r) + (d === 'S' || d === 'N' ? 3 : 0); hy = 19 + by + Math.round(v[1] * r * 0.8) - (P.cast === 2 ? 1 : 0); }
      else {
        const sw = P.phase === 0 ? 1 : P.phase === 2 ? -1 : 0;
        if (side) { hx = front ? cx + 3 + sw * 2 : cx - 3 - sw * 2; hy = 21 + by; }
        else { hx = front ? cx + 6 : cx - 6; hy = 21 + by + (front ? sw : -sw); }
        a = side ? 1.2 : 1.45;
      }
      const sx = side ? (front ? cx + 2 : cx - 2) : (front ? cx + 4 : cx - 4);
      G.line(sx, 16 + by, hx, hy, front ? 'B' : 'b', 2, { ol: true });
      G.rect(hx - 1, hy - 1, 2, 2, 's', { flat: true });
      if (front && !P.cast) sword(G, hx, hy, a, 9);
      if (P.cast) { G.px(hx, hy - 1, 'y'); G.px(hx - 1, hy, 'o'); if (P.cast === 2) { G.px(hx + Math.round(v[0] * 2), hy + Math.round(v[1] * 2), 'y'); } }
    };
    armOut(false);
    // 身躯：青衫
    const w0 = side ? 3 : 4, w1 = side ? 4 : 5;
    G.poly([[cx - w0, 15 + by], [cx + w0 + 1, 15 + by], [cx + w1 + 1, 24 + by], [cx - w1, 24 + by]], 'B', { ol: true });
    if (!back) {
      if (side) { G.line(cx + 1, 15 + by, cx + 2, 18 + by, 'w'); }
      else { G.line(cx - 2, 15 + by, cx, 18 + by, 'w'); G.line(cx + 2, 15 + by, cx + 1, 18 + by, 'w'); G.line(cx, 21 + by, cx, 23 + by, 'b'); }
    }
    G.rect(cx - w0, 20 + by, w0 * 2 + 1, 1, 'r', { flat: true });
    if (!back && !side) G.px(cx, 20 + by, 'y');
    if (side && !back) G.px(cx + 2, 20 + by, 'y');
    // 围巾领口
    G.rect(cx - 3, 14 + by, 7, 2, 'R', {});
    if (back) { armOut(true); scarfTail(); }
    // 头：面孔 + 斗笠
    const hy = 10 + by;
    if (back) G.ell(cx, hy, 4, 3.6, 'D', { ol: true });
    else {
      G.ell(cx + (side ? 1 : 0), hy, 4, 3.6, 's', { ol: true });
      G.rect(cx - 4 + (side ? -1 : 0), hy - 2, side ? 4 : 2, 4, 'D', { flat: true });  // 后脑/鬓发
      if (!side) G.rect(cx + 3, hy - 2, 2, 3, 'D', { flat: true });
      const eyes = d === 'S' ? [cx - 2, cx + 2] : d === 'SE' ? [cx, cx + 3] : [cx + 3];
      for (const ex of eyes) {
        if (P.hurt) { G.px(ex, hy + 1, 'k'); }
        else { G.px(ex, hy, 'k'); G.px(ex, hy + 1, 'k'); }
      }
      if (d === 'E') G.px(cx + 5, hy + 1, 't');
    }
    // 斗笠
    const hs = side ? 1 : 0;
    G.poly([[cx - 9 + hs, hy - 2], [cx + 10 + hs, hy - 2], [cx + 4 + hs, hy - 7], [cx - 3 + hs, hy - 7]], 't', { ol: true });
    G.line(cx - 8 + hs, hy - 2, cx + 9 + hs, hy - 2, 'n');
    G.line(cx - 2 + hs, hy - 6, cx + 3 + hs, hy - 6, 'y');
    G.px(cx + hs, hy - 8, 'n'); G.px(cx + 1 + hs, hy - 8, 'n');
    // 前手 + 剑
    if (!back) armOut(true);
  }

  // 双腿（通用人形）：S/N 正背面左右分开；侧身前后错开；斜向介于两者之间
  function legs(G, P, cx, hip, foot, d, pants, boots, wide = 0) {
    const side = d === 'E' || d === 'SE' || d === 'NE';
    let L = { x: cx - 3 - wide, lift: 0 }, R = { x: cx + 1 + wide, lift: 0 };
    if (P.phase != null) {
      if (side) {
        const s = d === 'E' ? 2 : 1;
        if (P.phase === 0) { L.x -= s; R.x += s; } else if (P.phase === 2) { L.x += s; R.x -= s; }
        else if (P.phase === 1) L.lift = 1; else R.lift = 1;
      } else {
        if (P.phase === 0) L.lift = 1; else if (P.phase === 2) R.lift = 1;
      }
    }
    if (P.atk === 2 && side) { R.x += 2; L.x -= 1; }
    for (const [lg, dark] of [[L, true], [R, false]]) {
      const bottom = foot - lg.lift;
      G.rect(lg.x, hip, 3, bottom - hip - 1, dark ? SH[pants] || pants : pants, { ol: true });
      G.rect(lg.x + (side ? 0 : 0), bottom - 2, side ? 4 : 3, 2, boots, { ol: true, flat: true });
    }
  }

  // ---------- 妖物（侧身朝右） ----------
  // 通用人形妖：spec 决定颜色与头部/武器
  function mobHuman(G, P, S) {
    const lean = P.atk === 2 ? 2 : P.atk === 1 ? -1 : P.hurt ? -1 : 0;
    const hop = S.hop ? (P.phase === 1 ? -3 : 0) : 0;
    const cx = 15 + lean, by = P.bob + hop, foot = 30 + (S.hop ? hop : 0);
    if (S.back) S.back(G, P, cx, by);
    if (!S.noLegs) legs(G, Object.assign({}, P, { phase: S.hop ? null : P.phase === 1 ? 0 : P.phase === 0 ? 2 : null }), cx, 23 + Math.max(0, P.bob), foot, 'E', S.pants, S.boots);
    // 后臂
    const arm = (front) => {
      let hx, hy;
      if (S.armsForward) { hx = cx + 8; hy = 17 + by + (front ? 0 : 1); }
      else if (front && P.atk === 1) { hx = cx + 1; hy = 11 + by; }
      else if (front && P.atk === 2) { hx = cx + 9; hy = 18 + by; }
      else { hx = front ? cx + 3 : cx - 3; hy = 21 + by; }
      G.line(front ? cx + 2 : cx - 2, 16 + by, hx, hy, front ? S.sleeve : SH[S.sleeve] || S.sleeve, 2, { ol: true });
      G.rect(hx - 1, hy - 1, 2, 2, S.hand, { flat: true });
      if (front && S.weapon) S.weapon(G, P, hx, hy);
    };
    arm(false);
    G.poly([[cx - 3, 15 + by], [cx + 4, 15 + by], [cx + 5 + (S.hem || 0), 24 + by], [cx - 4 - (S.hem || 0), 24 + by]], S.robe, { ol: true });
    if (S.chest) S.chest(G, P, cx, by);
    const hy = 10 + by;
    G.ell(cx + 1, hy, 4, 3.6, S.skin, { ol: true });
    if (S.head) S.head(G, P, cx, hy);
    if (S.eye !== false) { G.px(cx + 3, hy, S.eye || 'k'); G.px(cx + 3, hy + 1, S.eye || 'k'); }
    if (S.front) S.front(G, P, cx, by);
    arm(true);
  }

  const MOBS = {
    // 山魈：红脸獠牙的猿妖
    mob_melee: { w: 32, h: 32, draw(G, P) {
      const lean = P.atk === 2 ? 2 : P.atk === 1 ? -1 : 0, cx = 15 + lean, by = P.bob, st = P.phase === 0 ? 1 : P.phase === 1 ? -1 : 0;
      G.line(cx - 4, 21 + by, cx - 6 - st, 29, 'n', 3, { ol: true });
      G.rect(cx - 2 - st, 25, 3, 5, 'N', { ol: true }); G.rect(cx + 2 + st, 25, 3, 5, 'n', { ol: true });
      G.ell(cx, 20 + by, 7, 6, 'n', { ol: true });
      G.ell(cx + 1, 22 + by, 3.5, 3, 't', {});
      G.ell(cx + 3, 12 + by, 5, 4.6, 'n', { ol: true });
      G.ell(cx + 5, 13 + by, 3, 3, 'R', {});
      G.line(cx + 5, 11 + by, cx + 5, 15 + by, 'w');
      G.px(cx + 3, 13 + by, 'b'); G.px(cx + 7, 13 + by, 'b');
      G.px(cx + 4, 11 + by, 'y'); G.px(cx + 6, 11 + by, 'y');
      G.line(cx + 3, 16 + by, cx + 7, 16 + by, 'k'); G.px(cx + 4, 16 + by, 'w'); G.px(cx + 7, 16 + by, 'w');
      G.px(cx - 1, 8 + by, 'N'); G.px(cx + 6, 7 + by, 'N');
      const [hx, hy] = P.atk === 1 ? [cx + 3, 6 + by] : P.atk === 2 ? [cx + 12, 17 + by] : [cx + 7 + st, 26];
      G.line(cx + 5, 18 + by, hx, hy, 'n', 3, { ol: true });
      G.px(hx + 2, hy - 1, 'w'); G.px(hx + 2, hy + 1, 'w'); G.px(hx + 3, hy, 'w');
    } },
    // 跳尸：清官帽、额贴黄符、双臂平伸，蹦着走
    mob_zombie: { w: 32, h: 32, draw(G, P) {
      mobHuman(G, P, {
        robe: 'D', sleeve: 'D', pants: 'D', boots: 'k', hand: 'l', skin: 'l', hop: true, armsForward: true, eye: 'r',
        chest(G, P, cx, by) { G.rect(cx - 1, 17 + by, 5, 4, 'o', {}); G.px(cx + 1, 18 + by, 'y'); G.line(cx - 3, 22 + by, cx + 4, 22 + by, 'r'); },
        head(G, P, cx, hy) {
          G.ell(cx + 1, hy - 3, 5, 2, 'k', {}); G.rect(cx - 4, hy - 3, 10, 1, 'D', { flat: true });
          G.ell(cx + 1, hy - 6, 1.2, 1.2, 'r', { ol: true });
          G.rect(cx + 3, hy - 1, 2, 7, 'y', { flat: true }); G.px(cx + 3, hy + 1, 'r'); G.px(cx + 4, hy + 3, 'r'); G.px(cx + 3, hy + 5 + (P.t ? 1 : 0), 'o');
        },
      });
    } },
    // 纸人：白纸扎的人偶，腮红、黑发髻，飘着放纸钱
    mob_ranged: { w: 32, h: 32, draw(G, P) {
      const by = P.bob - 1 + (P.phase === 1 ? -1 : 0);
      mobHuman(G, Object.assign({}, P, { bob: by }), {
        robe: 'w', sleeve: 'w', hand: 'w', skin: 'w', noLegs: true, hem: 1, eye: 'k',
        back(G, P, cx, by) { G.line(cx - 1, 24 + by, cx - 1, 29 + by, 'g'); },
        chest(G, P, cx, by) { G.line(cx - 3, 19 + by, cx + 4, 19 + by, 'r'); G.px(cx, 21 + by, 'r'); G.px(cx + 2, 23 + by, 'g'); G.px(cx - 2, 22 + by, 'g'); },
        head(G, P, cx, hy) { G.ell(cx, hy - 3, 4, 2, 'k', {}); G.ell(cx - 1, hy - 5, 1.6, 1.4, 'k', {}); G.px(cx + 4, hy + 2, 'P'); G.px(cx + 2, hy + 3, 'r'); },
        weapon(G, P, x, y) { if (P.atk) { G.rect(x + 1, y - 2, 3, 3, 'y', { ol: true }); G.px(x + 2, y - 1, 'o'); } },
      });
    } },
    // 毒蛛：紫背红纹的大蜘蛛
    mob_skeleton: { w: 32, h: 32, draw(G, P) {
      const by = P.bob, lean = P.atk === 2 ? 2 : P.atk === 1 ? -1 : 0, cx = 15 + lean;
      for (let i = 0; i < 4; i++) {
        const k = (i + (P.phase === 1 ? 1 : 0)) % 2 ? 1 : -1;
        G.line(cx - 2 + i, 22 + by, cx - 9 + i * 2, 18 + by - k, 'p', 1, { flat: true }); G.line(cx - 9 + i * 2, 18 + by - k, cx - 11 + i * 3, 29, 'p', 1, { flat: true });
        G.line(cx + 2 + i, 22 + by, cx + 9 + i, 18 + by + k, 'p', 1, { flat: true }); G.line(cx + 9 + i, 18 + by + k, cx + 9 + i * 2, 29, 'p', 1, { flat: true });
      }
      G.ell(cx - 3, 20 + by, 7, 5.5, 'p', { ol: true });
      G.ell(cx - 4, 19 + by, 3, 2.5, 'r', {}); G.px(cx - 4, 18 + by, 'R');
      G.ell(cx + 5, 22 + by, 4, 3.5, 'm', { ol: true });
      for (const [ex, ey] of [[cx + 6, 21], [cx + 8, 21], [cx + 7, 23]]) G.px(ex, ey + by, 'R');
      const f = P.atk === 2 ? 2 : 0;
      G.px(cx + 9 + f, 25 + by, 'w'); G.px(cx + 8 + f, 26 + by, 'w');
    } },
    // 狐妖：粉衣狐耳女妖，身后狐尾，掌心狐火
    mob_shaman: { w: 32, h: 32, draw(G, P) {
      mobHuman(G, P, {
        robe: 'P', sleeve: 'P', pants: 'r', boots: 'r', hand: 's', skin: 's', hem: 1, eye: 'r',
        back(G, P, cx, by) { G.ell(cx - 7, 20 + by + (P.t ? 1 : 0), 4, 3, 'o', { ol: true }); G.ell(cx - 10, 18 + by + (P.t ? 0 : 1), 2, 2, 'w', {}); },
        chest(G, P, cx, by) { G.line(cx - 3, 20 + by, cx + 4, 20 + by, 'y'); G.line(cx + 1, 15 + by, cx + 2, 18 + by, 'w'); },
        head(G, P, cx, hy) {
          G.ell(cx, hy - 2, 4.4, 2.4, 'o', {}); G.rect(cx - 4, hy - 2, 3, 6, 'o', { flat: true });
          G.poly([[cx - 3, hy - 3], [cx - 1, hy - 3], [cx - 3, hy - 8]], 'o', { ol: true }); G.poly([[cx + 2, hy - 3], [cx + 4, hy - 3], [cx + 3, hy - 8]], 'o', { ol: true });
          G.px(cx + 4, hy + 2, 'P');
        },
        weapon(G, P, x, y) { if (P.atk || P.t) { G.ell(x + 1, y - 2, 1.5, 1.8, 'c', {}); G.px(x + 1, y - 4, 'w'); } },
      });
    } },
    // 游魂：白影，空洞眼窝
    mob_ghost: { w: 32, h: 32, draw(G, P) {
      const by = P.bob - 2 + (P.phase === 1 ? -1 : 0), cx = 15 + (P.atk === 2 ? 3 : 0);
      G.poly([[cx - 6, 14 + by], [cx + 6, 14 + by], [cx + 4, 24 + by], [cx - 2 + (P.t ? 1 : 0), 28 + by], [cx - 6, 25 + by]], 'w', { ol: true, sh: 'c' });
      G.ell(cx, 12 + by, 6, 6, 'w', { ol: true, sh: 'c' });
      G.ell(cx - 1, 12 + by, 1.2, 1.8, 'D', { flat: true }); G.ell(cx + 3, 12 + by, 1.2, 1.8, 'D', { flat: true });
      G.ell(cx + 1, 16 + by, 0.8, P.atk ? 1.6 : 0.8, 'D', { flat: true });
      G.line(cx + 4, 16 + by, cx + (P.atk ? 9 : 7), 19 + by - (P.atk ? 3 : 0), 'w', 2, { ol: true, sh: 'c' });
    } },
    // 鬼火：一团幽蓝的骷髅火
    mob_specter: { w: 32, h: 32, draw(G, P) {
      const by = P.bob - 3, cx = 15 + (P.atk === 2 ? 2 : 0), f = P.t;
      G.poly([[cx - 6, 18 + by], [cx - 4, 8 + by + f], [cx - 1, 12 + by], [cx + 1, 4 + by - f], [cx + 3, 11 + by], [cx + 6, 7 + by + f], [cx + 7, 18 + by], [cx + 1, 25 + by]], 'B', { ol: true, sh: 'b' });
      G.poly([[cx - 3, 18 + by], [cx - 1, 12 + by], [cx + 1, 9 + by], [cx + 3, 13 + by], [cx + 4, 18 + by], [cx + 1, 22 + by]], 'c', { flat: true });
      G.ell(cx + 1, 17 + by, 3, 2.6, 'w', { sh: 'g' });
      G.px(cx, 17 + by, 'k'); G.px(cx + 2, 17 + by, 'k'); G.px(cx + 1, 19 + by, 'k');
      G.px(cx - 7, 24 + by - f, 'c'); G.px(cx + 8, 22 + by + f, 'c');
    } },
    // 机关铜人：铜皮木骨的机关傀儡
    mob_mummy: { w: 32, h: 32, draw(G, P) {
      mobHuman(G, P, {
        robe: 'o', sleeve: 'o', pants: 'n', boots: 'N', hand: 'o', skin: 'o', hem: 0, eye: 'c',
        chest(G, P, cx, by) { G.ell(cx + 1, 18 + by, 2, 2, 'E', { ol: true }); G.px(cx + 1, 18 + by, 'c'); G.line(cx - 3, 22 + by, cx + 4, 22 + by, 'n'); G.px(cx - 2, 16 + by, 'y'); G.px(cx + 3, 16 + by, 'y'); },
        head(G, P, cx, hy) { G.rect(cx - 3, hy - 4, 8, 2, 'n', { ol: true }); G.px(cx + 1, hy - 6, 'y'); G.px(cx + 1, hy - 5, 'n'); G.line(cx + 2, hy + 3, cx + 5, hy + 3, 'n'); },
        weapon(G, P, x, y) { G.rect(x, y - 1, 3, 3, 'g', { ol: true }); },
      });
    } },
    // 蛇妖：青鳞蛇尾，上身披发
    mob_vampire: { w: 32, h: 32, draw(G, P) {
      const by = P.bob, lean = P.atk === 2 ? 2 : P.atk === 1 ? -1 : 0, cx = 16 + lean, wv = P.phase === 1 || P.t ? 1 : 0;
      G.poly([[cx - 3, 22 + by], [cx + 4, 22 + by], [cx + 6, 27], [cx - 4, 30], [cx - 12, 29 - wv], [cx - 13, 27 - wv], [cx - 6, 27]], 'e', { ol: true });
      for (let x = cx - 10; x < cx + 4; x += 3) G.px(x, 28 - (x < cx - 6 ? wv : 0), 'l');
      G.poly([[cx - 3, 14 + by], [cx + 3, 14 + by], [cx + 4, 23 + by], [cx - 3, 23 + by]], 'E', { ol: true });
      G.px(cx, 17 + by, 'e'); G.px(cx + 2, 19 + by, 'e'); G.px(cx - 1, 20 + by, 'e');
      G.ell(cx + 1, 10 + by, 4, 3.6, 'l', { ol: true });
      G.rect(cx - 4, 8 + by, 3, 9, 'D', { ol: true }); G.ell(cx, 7 + by, 4, 1.6, 'D', {});
      G.px(cx + 3, 10 + by, 'y'); G.px(cx + 3, 11 + by, 'k');
      if (P.atk) { G.line(cx + 4, 12 + by, cx + 7, 12 + by, 'r'); G.px(cx + 8, 11 + by, 'r'); G.px(cx + 8, 13 + by, 'r'); }
      const [hx, hy] = P.atk === 2 ? [cx + 9, 16 + by] : [cx + 4, 21 + by];
      G.line(cx + 2, 16 + by, hx, hy, 'l', 2, { ol: true });
    } },
    // 游商：斗笠背篓
    npc_merchant: { w: 32, h: 32, draw(G, P) {
      mobHuman(G, P, {
        robe: 'n', sleeve: 'n', pants: 'N', boots: 'N', hand: 's', skin: 's', hem: 1,
        back(G, P, cx, by) { G.rect(cx - 10, 11 + by, 7, 10, 'n', { ol: true }); for (let y = 13; y < 21; y += 3) G.line(cx - 10, y + by, cx - 4, y + by, 'N'); G.rect(cx - 9, 8 + by, 2, 2, 'r', { ol: true }); G.rect(cx - 6, 9 + by, 2, 2, 'y', { ol: true }); },
        chest(G, P, cx, by) { G.line(cx - 3, 20 + by, cx + 4, 20 + by, 'e'); G.ell(cx + 4, 22 + by, 1, 1.4, 'y', { ol: true }); },
        head(G, P, cx, hy) { G.poly([[cx - 6, hy - 2], [cx + 8, hy - 2], [cx + 2, hy - 7]], 'y', { ol: true }); G.line(cx - 5, hy - 2, cx + 7, hy - 2, 'o'); G.px(cx + 4, hy + 3, 'G'); },
        weapon(G, P, x, y) { G.line(x, y - 6, x, y + 8, 't'); },
      });
    } },
  };

  // ---------- 镇守（48×48） ----------
  function bossHuman(G, P, S) {
    const lean = P.atk === 2 ? 2 : P.atk === 1 ? -1 : P.hurt ? -1 : 0;
    const cx = 23 + lean, by = P.bob, foot = 46;
    if (S.back) S.back(G, P, cx, by);
    if (!S.noLegs) {
      const st = P.phase === 0 ? 2 : P.phase === 1 ? -2 : 0;
      G.rect(cx - 5 - st, 34, 4, 11, SH[S.pants], { ol: true }); G.rect(cx - 6 - st, 43, 6, 3, S.boots, { ol: true, flat: true });
      G.rect(cx + 2 + st, 34, 4, 11, S.pants, { ol: true }); G.rect(cx + 2 + st, 43, 6, 3, S.boots, { ol: true, flat: true });
    }
    const arm = (front) => {
      let hx, hy;
      if (front && P.atk === 1) { hx = cx + 2; hy = 13 + by; } else if (front && P.atk === 2) { hx = cx + 15; hy = 25 + by; }
      else { hx = front ? cx + 7 : cx - 7; hy = 31 + by; }
      G.line(front ? cx + 5 : cx - 5, 21 + by, hx, hy, front ? S.sleeve : SH[S.sleeve], 3, { ol: true });
      G.rect(hx - 1, hy - 1, 3, 3, S.hand, { flat: true });
      if (front && S.weapon) S.weapon(G, P, hx, hy);
    };
    arm(false);
    G.poly([[cx - 6, 19 + by], [cx + 7, 19 + by], [cx + 9 + (S.hem || 0), 36 + by], [cx - 8 - (S.hem || 0), 36 + by]], S.robe, { ol: true });
    if (S.chest) S.chest(G, P, cx, by);
    const hy = 12 + by;
    G.ell(cx + 1, hy, 6, 5.5, S.skin, { ol: true });
    if (S.head) S.head(G, P, cx, hy);
    if (S.eye !== false) for (const ex of [cx + 2, cx + 5]) { G.px(ex, hy, S.eye || 'k'); G.px(ex, hy + 1, S.eye || 'k'); }
    arm(true);
  }
  const BOSSES = {
    // 血蝠妖：张开肉翼的蝙蝠妖王
    boss_bat: { w: 48, h: 48, draw(G, P) {
      const by = P.bob - 3 + (P.phase === 1 ? -2 : 0), cx = 24 + (P.atk === 2 ? 3 : 0), flap = P.t || P.phase === 1 ? 4 : 0;
      for (const s of [-1, 1]) G.poly([[cx + s * 4, 16 + by], [cx + s * 21, 8 + by + flap], [cx + s * 20, 24 + by - flap / 2], [cx + s * 15, 21 + by], [cx + s * 11, 28 + by], [cx + s * 5, 24 + by]], 'r', { ol: true });
      G.ell(cx, 23 + by, 7, 9, 'p', { ol: true });
      G.ell(cx, 13 + by, 6, 5, 'p', { ol: true });
      G.poly([[cx - 5, 10 + by], [cx - 2, 9 + by], [cx - 5, 2 + by]], 'p', { ol: true }); G.poly([[cx + 2, 9 + by], [cx + 5, 10 + by], [cx + 5, 2 + by]], 'p', { ol: true });
      G.px(cx - 2, 13 + by, 'R'); G.px(cx + 2, 13 + by, 'R'); G.px(cx - 1, 17 + by, 'w'); G.px(cx + 1, 17 + by, 'w');
      G.line(cx - 3, 31 + by, cx - 4, 37 + by, 'p', 2, { ol: true }); G.line(cx + 3, 31 + by, cx + 4, 37 + by, 'p', 2, { ol: true });
    } },
    // 白骨夫人：素衣白发、骨冠、白骨杖
    boss_bone: { w: 48, h: 48, draw(G, P) {
      bossHuman(G, P, {
        robe: 'w', sleeve: 'w', pants: 'g', boots: 'g', hand: 'w', skin: 'w', hem: 3, eye: 'B', noLegs: true,
        back(G, P, cx, by) { G.poly([[cx - 6, 8 + by], [cx + 2, 8 + by], [cx - 3, 32 + by], [cx - 11, 30 + by + (P.t ? 1 : 0)]], 'g', { ol: true }); },
        chest(G, P, cx, by) { G.line(cx - 6, 28 + by, cx + 7, 28 + by, 'm'); G.ell(cx + 1, 23 + by, 2, 2, 'g', { ol: true }); G.px(cx + 1, 23 + by, 'k'); for (let x = cx - 7; x < cx + 9; x += 3) G.px(x, 35 + by, 'm'); },
        head(G, P, cx, hy) { G.ell(cx, hy - 3, 6, 3, 'g', {}); for (let i = -3; i <= 4; i += 2) G.line(cx + i, hy - 6, cx + i, hy - 9 - (i % 4 ? 1 : 0), 'w'); G.px(cx + 5, hy + 3, 'r'); },
        weapon(G, P, x, y) { G.line(x, y + 8, x, y - 16, 'g', 1); G.ell(x, y - 17, 2.4, 2.4, 'w', { ol: true }); G.px(x - 1, y - 17, 'k'); G.px(x + 1, y - 17, 'k'); },
      });
    } },
    // 铜甲尸王：魁梧铜甲、青面、开山斧
    boss_corpse: { w: 48, h: 48, draw(G, P) {
      bossHuman(G, P, {
        robe: 'o', sleeve: 'o', pants: 'D', boots: 'N', hand: 'l', skin: 'l', hem: 2, eye: 'y',
        chest(G, P, cx, by) {
          G.ell(cx - 7, 20 + by, 4, 3, 'y', { ol: true }); G.ell(cx + 8, 20 + by, 4, 3, 'y', { ol: true });
          for (let y = 24; y < 35; y += 3) G.line(cx - 6, y + by, cx + 7, y + by, 'n');
          G.ell(cx + 1, 26 + by, 2, 2, 'E', { ol: true }); G.px(cx + 1, 26 + by, 'c');
        },
        head(G, P, cx, hy) { G.rect(cx - 5, hy - 6, 12, 3, 'o', { ol: true }); G.rect(cx - 1, hy - 10, 4, 4, 'y', { ol: true }); G.px(cx + 1, hy - 11, 'r'); G.line(cx + 2, hy + 4, cx + 6, hy + 4, 'k'); G.px(cx + 3, hy + 4, 'w'); G.px(cx + 6, hy + 4, 'w'); },
        weapon(G, P, x, y) {
          const a = P.atk === 1 ? -2.0 : P.atk === 2 ? 0.2 : 1.3, dx = Math.cos(a), dy = Math.sin(a);
          G.line(x - dx * 3, y - dy * 3, x + dx * 14, y + dy * 14, 'n', 2, { ol: true });
          const ex = x + dx * 13, ey = y + dy * 13;
          G.poly([[ex, ey], [ex - dy * 7 + dx * 2, ey + dx * 7 + dy * 2], [ex - dy * 7 - dx * 4, ey + dx * 7 - dy * 4], [ex - dx * 3, ey - dy * 3]], 'g', { ol: true });
        },
      });
    } },
    // 千年树妖：树干身躯、树洞脸、枝臂与树冠
    boss_tree: { w: 48, h: 48, draw(G, P) {
      const by = P.bob, cx = 24 + (P.atk === 2 ? 2 : P.atk === 1 ? -1 : 0);
      for (let i = -2; i <= 2; i++) G.line(cx + i * 3, 38 + by, cx + i * 6 + (P.phase === 0 ? i : 0), 46, 'N', 2, { ol: true });
      G.poly([[cx - 7, 12 + by], [cx + 7, 12 + by], [cx + 10, 40 + by], [cx - 10, 40 + by]], 'n', { ol: true });
      for (let y = 16; y < 38; y += 5) G.line(cx - 6, y + by, cx - 5, y + 3 + by, 'N');
      const arm = P.atk === 1 ? [cx + 6, 4] : P.atk === 2 ? [cx + 22, 22] : [cx + 16, 30 + P.t];
      G.line(cx + 6, 20 + by, arm[0], arm[1] + by, 'n', 3, { ol: true });
      G.line(arm[0], arm[1] + by, arm[0] + 3, arm[1] + by - 3, 'N', 1); G.line(arm[0], arm[1] + by, arm[0] + 3, arm[1] + by + 2, 'N', 1);
      G.line(cx - 6, 20 + by, cx - 16, 27 + by - P.t, 'n', 3, { ol: true });
      G.ell(cx, 8 + by, 14, 7, 'e', { ol: true, hi: 'l' }); G.ell(cx - 8, 11 + by, 6, 4, 'e', { ol: true, hi: 'l' }); G.ell(cx + 9, 11 + by, 6, 4, 'e', { ol: true, hi: 'l' });
      G.px(cx - 5, 9 + by, 'r'); G.px(cx + 6, 6 + by, 'r'); G.px(cx + 1, 4 + by, 'r');
      G.ell(cx - 3, 21 + by, 2, 2, 'k', { flat: true }); G.ell(cx + 3, 21 + by, 2, 2, 'k', { flat: true });
      G.px(cx - 3, 21 + by, 'l'); G.px(cx + 3, 21 + by, 'l');
      G.ell(cx, 29 + by, 3, P.atk ? 3 : 2, 'k', { flat: true });
    } },
    // 九尾天狐：白狐身，九条尾巴扇开
    boss_fox: { w: 48, h: 48, draw(G, P) {
      const by = P.bob, cx = 24 + (P.atk === 2 ? 3 : P.atk === 1 ? -1 : 0), sw = P.t ? 1 : 0;
      for (let i = 0; i < 9; i++) { const a = -2.6 + i * 0.22 + (i % 2 ? sw * 0.05 : 0); G.ell(cx - 6 + Math.cos(a) * 12, 26 + by + Math.sin(a) * 12, 3, 3, i % 2 ? 'w' : 'g', { ol: true }); G.px(cx - 6 + Math.cos(a) * 15, 26 + by + Math.sin(a) * 15, 'c'); }
      const st = P.phase === 0 ? 2 : P.phase === 1 ? -2 : 0;
      for (const [lx, c] of [[cx - 6 - st, 'g'], [cx + 5 + st, 'w'], [cx - 2 + st, 'g'], [cx + 9 - st, 'w']]) G.rect(lx, 34 + by, 3, 46 - 34 - by, c, { ol: true });
      G.ell(cx + 1, 30 + by, 11, 6, 'w', { ol: true });
      G.ell(cx + 12, 22 + by, 6, 5, 'w', { ol: true });
      G.poly([[cx + 9, 18 + by], [cx + 12, 18 + by], [cx + 9, 11 + by]], 'w', { ol: true }); G.poly([[cx + 13, 18 + by], [cx + 16, 18 + by], [cx + 15, 11 + by]], 'w', { ol: true });
      G.px(cx + 10, 16 + by, 'P'); G.px(cx + 15, 16 + by, 'P');
      G.poly([[cx + 16, 22 + by], [cx + 21, 24 + by], [cx + 16, 26 + by]], 'w', { ol: true }); G.px(cx + 21, 24 + by, 'k');
      G.px(cx + 13, 21 + by, 'r'); G.px(cx + 14, 21 + by, 'k');
      G.line(cx + 9, 25 + by, cx + 12, 27 + by, 'r');
      if (P.atk || P.cast) { G.ell(cx + 22, 20 + by, 2, 2.4, 'c', {}); G.px(cx + 22, 17 + by, 'w'); }
    } },
    // 魔蛟：盘身昂首的青黑蛟龙
    boss_jiao: { w: 48, h: 48, draw(G, P) {
      const by = P.bob, cx = 22 + (P.atk === 2 ? 3 : P.atk === 1 ? -1 : 0), wv = P.t || P.phase === 1 ? 1 : 0;
      G.ell(cx - 4, 39, 15, 6, 'E', { ol: true }); G.ell(cx - 4, 39, 9, 3, 'e', {});
      for (let x = cx - 16; x < cx + 10; x += 4) G.px(x, 35 + wv, 'c');
      G.line(cx + 4, 37, cx + 8, 26 + by, 'E', 6, { ol: true });
      G.line(cx + 8, 26 + by, cx + 6, 16 + by, 'E', 5, { ol: true });
      for (let y = 18; y < 36; y += 3) G.px(cx + 8 - (y > 26 ? 0 : 1), y + by, 't');
      G.ell(cx + 10, 12 + by, 7, 5, 'E', { ol: true });
      G.poly([[cx + 14, 10 + by], [cx + 22, 12 + by + (P.atk ? 2 : 0)], [cx + 14, 15 + by]], 'E', { ol: true });
      G.line(cx + 6, 8 + by, cx + 2, 1 + by, 'y', 1); G.line(cx + 9, 7 + by, cx + 7, 0 + by, 'y', 1);
      G.px(cx + 12, 10 + by, 'y'); G.px(cx + 13, 10 + by, 'k');
      G.line(cx + 15, 14 + by, cx + 20, 18 + by + wv, 'y'); G.line(cx + 14, 9 + by, cx + 19, 4 + by - wv, 'y');
      for (let i = 0; i < 4; i++) G.px(cx + 4 - i * 2, 14 + by + i * 4, 'R');
      if (P.atk) { G.px(cx + 21, 13 + by, 'w'); G.px(cx + 19, 13 + by, 'w'); }
    } },
  };

  // ---------- 技能与命中特效（像素帧） ----------
  const FX = {
    // 剑气弧：沿出招方向的月牙，3 帧（展开→满→消散）
    slash(G, f, ang) {
      const cx = 16, cy = 16, R = 11, span = [0.8, 1.6, 1.8][f], th = [2, 3, 1][f];
      const cols = f === 2 ? ['g', 'G'] : ['w', 'c'];
      for (let i = 0; i <= 24; i++) {
        const a = ang - span / 2 + span * i / 24, rr = R - (Math.abs(i - 12) / 12) * 2;
        for (let t = 0; t < th; t++) G.px(cx + Math.cos(a) * (rr - t), cy + Math.sin(a) * (rr - t), t === 0 ? cols[0] : cols[1]);
      }
    },
    // 命中火花：4 帧星形
    spark(G, f) {
      const c = 8, r = [2, 4, 5, 6][f], col = ['w', 'y', 'o', 'r'][f];
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const r0 = i % 2 ? r * 0.6 : r; if (f < 3 || i % 2 === 0) G.line(c + Math.cos(a) * Math.max(0, f - 1), c + Math.sin(a) * Math.max(0, f - 1), c + Math.cos(a) * r0, c + Math.sin(a) * r0, col); }
      if (f < 2) G.rect(c - 1, c - 1, 2, 2, 'w', { flat: true });
    },
    // 烈焰掌：火焰掌印（2 帧闪烁）
    palm(G, f) {
      G.ell(8, 8, 5 + f * 0.4, 5, 'r', { flat: true }); G.ell(8, 8, 3.6, 3.8, 'R', { flat: true }); G.ell(8, 8, 2.2, 2.6, 'o', { flat: true });
      for (let i = 0; i < 4; i++) G.rect(5 + i * 2, 3 - (i % 2) - f, 1, 3, 'y', { flat: true });
      G.rect(7, 7, 2, 2, 'y', { flat: true }); G.px(8, 8, 'w');
    },
    // 爆炎：5 帧
    blast(G, f) {
      const c = 12, r = [3, 6, 9, 10, 11][f];
      const ring = [['w', 'y'], ['y', 'o'], ['o', 'R'], ['R', 'r'], ['r', 'p']][f];
      G.ell(c, c, r, r * 0.8, ring[1], { flat: true });
      if (f < 3) G.ell(c, c, r * 0.6, r * 0.5, ring[0], { flat: true });
      else for (const [x, y] of G.ellMask(c, c, r * 0.65, r * 0.5)) G.c[y * G.w + x] = null;
      for (let i = 0; i < 6; i++) { const a = i * 1.05 + f; G.px(c + Math.cos(a) * (r + 2), c + Math.sin(a) * (r * 0.8 + 2), f < 3 ? 'y' : 'G'); }
    },
    // 金钟罩：金色大钟 3 帧（落下→罩住→余光）
    bell(G, f) {
      const top = [2, 4, 4][f], col = f === 2 ? 'o' : 'y';
      G.poly([[11, top], [21, top], [24, top + 6], [26, top + 22], [6, top + 22], [8, top + 6]], col, { ol: true, sh: 'o' });
      for (const [x, y] of G.polyMask([[12, top + 3], [20, top + 3], [23, top + 20], [9, top + 20]])) G.c[y * G.w + x] = null;
      G.line(6, top + 18, 26, top + 18, 'w'); G.rect(14, top - 2, 4, 2, col, { ol: true });
      if (f === 1) for (let i = 0; i < 4; i++) G.px(4 + i * 8, top + 25, 'w');
    },
    // 暗器飞镖
    dart(G, f) { G.line(2, 4, 9, 4, f ? 'g' : 'G'); G.poly([[9, 2], [13, 4], [9, 6]], 'w', { ol: true }); },
  };
  const FX_SIZE = { slash: 32, spark: 16, palm: 16, blast: 24, bell: 32, dart: 16 };
  const FX_FRAMES = { slash: 3, spark: 4, palm: 2, blast: 5, bell: 3, dart: 2 };

  // ---------- 帧表 ----------
  const HERO_FRAMES = {
    idle0: { bob: 0, t: 0 }, idle1: { bob: 1, t: 1 },
    walk0: { phase: 0, bob: 0, t: 0 }, walk1: { phase: 1, bob: -1, t: 1 }, walk2: { phase: 2, bob: 0, t: 0 }, walk3: { phase: 3, bob: -1, t: 1 },
    atk0: { atk: 1, bob: 0, t: 0 }, atk1: { atk: 2, bob: 0, t: 1 }, atk2: { atk: 3, bob: 0, t: 1 },
    cast0: { cast: 1, bob: 0, t: 0 }, cast1: { cast: 2, bob: 0, t: 1 }, hurt: { hurt: 1, bob: 1, t: 0 },
  };
  const MOB_FRAMES = {
    idle0: { bob: 0, t: 0 }, idle1: { bob: 1, t: 1 },
    walk0: { phase: 0, bob: 0, t: 0 }, walk1: { phase: 1, bob: -1, t: 1 },
    atk0: { atk: 1, bob: 0, t: 0 }, atk1: { atk: 2, bob: 0, t: 1 }, hurt: { hurt: 1, bob: 1, t: 0 },
  };
  const DEFS = Object.assign({ hero: { w: 32, h: 32, draw: heroDraw, dirs: true } }, MOBS, BOSSES);

  const cache = {};
  function grid(key, frame, dir) {
    const d = DEFS[key]; if (!d) return null;
    const table = d.dirs ? HERO_FRAMES : MOB_FRAMES;
    const P = Object.assign({ bob: 0, t: 0, phase: null, atk: 0, cast: 0, hurt: 0, dir: dir || 'E' }, table[frame] || table.idle0);
    const G = new Grid(d.w, d.h);
    d.draw(G, P);
    G.outline();
    return G;
  }
  // 8 方向 -> [绘制方向, 是否镜像]
  const DIR8 = { S: ['S', false], SE: ['SE', false], E: ['E', false], NE: ['NE', false], N: ['N', false], SW: ['SE', true], W: ['E', true], NW: ['NE', true] };
  const IdleSprites = {
    PAL, DIRS, DIR8,
    has: key => !!DEFS[key],
    size: key => DEFS[key] ? [DEFS[key].w, DEFS[key].h] : null,
    heroFrames: Object.keys(HERO_FRAMES), mobFrames: Object.keys(MOB_FRAMES),
    grid,
    frame(key, frame, dir = 'E') {
      const k = key + '|' + frame + '|' + dir;
      if (!(k in cache)) { const G = grid(key, frame, dir); cache[k] = G ? G.toCanvas() : null; }
      return cache[k];
    },
    fxGrid(name, f, ang = 0) {
      const S = FX_SIZE[name]; if (!S) return null;
      const G = new Grid(S, S); FX[name](G, f, ang);
      if (name === 'palm' || name === 'dart') G.outline();
      return G;
    },
    fx(name, f, ang = 0) {
      const k = 'fx|' + name + '|' + f + '|' + (name === 'slash' ? Math.round(ang * 4) : 0);
      if (!(k in cache)) { const G = this.fxGrid(name, f, Math.round(ang * 4) / 4); cache[k] = G ? G.toCanvas() : null; }
      return cache[k];
    },
    fxFrames: FX_FRAMES, fxSize: FX_SIZE,
  };
  root.IdleSprites = IdleSprites;
  if (typeof module !== 'undefined') module.exports = IdleSprites;
})(typeof window !== 'undefined' ? window : globalThis);

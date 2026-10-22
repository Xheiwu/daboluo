// ========== idle-render.js - 镇妖塔 HD-2D 渲染 ==========
// 「像素立绘 + 现代光影」：
//   · 角色/妖物/镇守/游商复用主游戏手绘立绘（ArtSamples / EnvironmentArt，四方向多帧动画），主角约 64px 高；
//   · 地砖与墙面用主游戏贴图（art/brand-terrain、floor_tiles.png），墙体有立面与墙顶、接地阴影（AO）；
//   · 道具来自 art/idle/props-data.js（tools/build-idle-art.py 生成）；
//   · 动态光照（乘法光照贴图：主角灯笼、火把、火盆、法阵、技能闪光）、泛光、场景调色、上下景深模糊、暗角、浮尘/火星粒子；
//   · 画布内部按 2 倍分辨率绘制，文字与立绘在手机上清晰。
// 需在 idle-mode.js 之后加载；覆盖 IdleMode 的渲染方法，逻辑与存档不受影响。
(function () {
  if (typeof IdleMode === 'undefined') return;

  const R = 2;                // 画布内部分辨率倍数（世界 1px = 2 个画布像素）
  const HERO_D = 96;          // 主角立绘格子绘制尺寸（世界 px），身体约 60px
  const MOB_D = { normal: 78, elite: 88, nemesis: 112, boss: 132 };

  const SCENE_STYLE = {
    tomb: {
      floor: ['terrain', 1], wall: 0, floorTint: 'rgba(70,58,30,0.22)', wallTint: null,
      ambient: [70, 60, 78], grade: 'rgba(255,186,110,0.10)', mote: '#ffe2a8', faceTop: '#8c8466',
      props: ['bones', 'skulls', 'grave', 'pot', 'rock', 'roots', 'mushroom', 'barrel', 'crate', 'sack', 'twigs', 'candles'],
      tall: ['lamp', 'shrine', 'banner', 'cage', 'rack', 'statue', 'torch'],
      lights: { candles: ['#ffb060', 46], lamp: ['#ffb060', 70], shrine: ['#ffb060', 56], torch: ['#ff9a40', 84] }
    },
    water: {
      floor: ['terrain', 1], wall: 1, floorTint: 'rgba(30,80,130,0.30)', wallTint: null,
      ambient: [46, 62, 92], grade: 'rgba(110,200,255,0.10)', mote: '#a8e8ff', faceTop: '#8fb6d8',
      props: ['icerock', 'frostbones', 'icepile', 'ice3', 'bones', 'rock', 'bucket', 'icecrate'],
      tall: ['icepillar', 'runestone', 'ice2', 'icespikes', 'bluefire', 'ice1', 'torch'],
      lights: { bluefire: ['#5ab0ff', 80], runestone: ['#5ab0ff', 50], ice1: ['#80d0ff', 40], ice2: ['#80d0ff', 40], torch: ['#ff9a40', 84] }
    },
    lava: {
      floor: ['lava', 2], wall: 2, floorTint: 'rgba(60,20,10,0.25)', wallTint: null,
      ambient: [86, 46, 40], grade: 'rgba(255,120,60,0.12)', mote: '#ffa040', faceTop: '#a0604a',
      props: ['lavarock', 'skulls2', 'bone2', 'debris', 'coal', 'lavacrack'],
      tall: ['obsidian', 'horns', 'brazier', 'redcrystal', 'demonskull', 'runeslab', 'campfire'],
      lights: { lavacrack: ['#ff6a20', 50], brazier: ['#ff8a30', 96], campfire: ['#ff8a30', 96], redcrystal: ['#ff4a40', 60], runeslab: ['#ff5030', 50] }
    },
    abyss: {
      floor: ['terrain', 2], wall: 2, floorTint: 'rgba(60,24,100,0.32)', wallTint: 'rgba(70,30,130,0.40)',
      ambient: [54, 42, 78], grade: 'rgba(190,120,255,0.12)', mote: '#d0a0ff', faceTop: '#8a70b0',
      props: ['skulls', 'bones', 'demonskull', 'debris', 'blood', 'candles', 'skulls2'],
      tall: ['bluefire', 'runestone', 'obsidian', 'statue', 'cage', 'altar'],
      lights: { bluefire: ['#9070ff', 84], candles: ['#c080ff', 46], runestone: ['#9070ff', 54], altar: ['#c080ff', 56] }
    }
  };

  const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const hash2 = (x, y, s = 0) => { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };

  Object.assign(IdleMode, {
    art: null,

    // ---------- 素材 ----------
    loadArt() {
      if (this.art) return this.art;
      const art = this.art = { ready: 0, total: 0, imgs: {}, glows: {} };
      const load = (key, src) => {
        art.total++;
        const im = new Image();
        im.onload = () => { art.ready++; art.imgs[key] = im; this.bgCache = {}; };
        im.onerror = () => { art.ready++; console.warn('[镇妖塔美术] 加载失败', src); };
        im.src = src;
      };
      // 道具图集以 data URI 存在 art/idle/props-data.js，按需注入
      if (typeof window !== 'undefined' && window.IDLE_PROPS_DATA) load('props', window.IDLE_PROPS_DATA);
      else if (typeof document !== 'undefined') {
        art.total++;
        const sc = document.createElement('script');
        sc.src = 'art/idle/props-data.js?v=2026102601';
        sc.onload = () => { art.ready++; if (window.IDLE_PROPS_DATA) load('props', window.IDLE_PROPS_DATA); };
        sc.onerror = () => { art.ready++; console.warn('[镇妖塔美术] 加载失败', sc.src); };
        document.head.appendChild(sc);
      }
      load('terrain', 'art/brand-terrain/floors.webp?v=2026090803');
      load('walls', 'art/brand-terrain/walls.webp?v=2026090803');
      load('lava', 'floor_tiles.png?v=2026090801');
      return art;
    },

    monsterArtKey(e) {
      if (!e) return null;
      if (e.tier === 'boss') return (typeof IDLE_BOSS_ART !== 'undefined' && IDLE_BOSS_ART[e.baseName]) || 'diablo';
      return (typeof IDLE_MONSTER_ART !== 'undefined' && IDLE_MONSTER_ART[e.type]) || null;
    },

    ensureMapArt(map) {
      if (typeof ArtSamples === 'undefined' || !map || map.uid === this._artMapUid) return;
      this._artMapUid = map.uid;
      const keys = new Set();
      for (const p of map.packs) for (const e of p.enemies) { const k = this.monsterArtKey(e); if (k) keys.add(k); }
      try { ArtSamples.ensureMonsters([...keys]).catch(() => {}); } catch (err) { /* 未知图集：退回像素图 */ }
    },

    // 彩色柔光贴图（光照与泛光共用）
    glowTex(color) {
      const art = this.loadArt();
      if (art.glows[color]) return art.glows[color];
      const c = mk(64, 64), g = c.getContext('2d');
      const [r, gg, b] = hexRgb(color);
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, `rgba(${r},${gg},${b},1)`);
      grd.addColorStop(0.35, `rgba(${r},${gg},${b},0.55)`);
      grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      return (art.glows[color] = c);
    },

    style(floor) { return SCENE_STYLE[this.themeFor(floor).deco] || SCENE_STYLE.tomb; },

    // ---------- 画布尺寸 ----------
    resize() {
      if (!this.canvas) return;
      if (this.canvas.width !== this.W * R) { this.canvas.width = this.W * R; this.canvas.height = this.H * R; }
      const stage = this.canvas.parentElement;
      const r = stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const s = Math.min(r.width / this.W, r.height / this.H);
      this.canvas.style.width = Math.floor(this.W * s) + 'px';
      this.canvas.style.height = Math.floor(this.H * s) + 'px';
    },

    // ---------- 地图预渲染：贴图地砖 + 立体墙面 + 接地阴影 + 道具 ----------
    mapCanvas(map) {
      if (this.bgCache.uid === map.uid && this.bgCache.artReady === (this.art ? this.art.ready : 0)) return this.bgCache;
      const art = this.loadArt();
      const T = this.T, theme = this.themeFor(map.floor), st = this.style(map.floor);
      const c = mk(map.cols * T * R, map.rows * T * R);
      const g = c.getContext('2d');
      g.setTransform(R, 0, 0, R, 0, 0);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      const rng = IdleCore.createRng(map.seed + 99);
      const wall = (x, y) => !IdleCore.walkable(map, x, y);
      const torches = [], lights = [];
      const floorImg = art.imgs[st.floor[0]], wallImg = art.imgs.walls;
      g.fillStyle = '#07060a'; g.fillRect(0, 0, map.cols * T, map.rows * T);

      // 1) 地面
      for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
        if (wall(x, y)) continue;
        const px = x * T, py = y * T;
        if (floorImg) {
          const cell = floorImg.width / 3, half = cell / 2;
          const v = Math.floor(hash2(x >> 1, y >> 1, 3) * 3);
          const row = st.floor[0] === 'lava' ? 2 : st.floor[1];
          const sx = st.floor[0] === 'lava' ? (x % 2) * 60 : v * cell + (x % 2) * half;
          const sy = st.floor[0] === 'lava' ? row * 120 + (y % 2) * 60 : row * cell + (y % 2) * half;
          const sw = st.floor[0] === 'lava' ? 60 : half;
          g.drawImage(floorImg, sx, sy, sw, sw, px, py, T + 0.5, T + 0.5);
        } else {
          g.fillStyle = theme.floor[(x + y) % 2]; g.fillRect(px, py, T, T);
        }
        if (st.floorTint) { g.fillStyle = st.floorTint; g.fillRect(px, py, T, T); }
        // 细微明暗变化，打破重复感
        const n = hash2(x, y, 7);
        g.fillStyle = n > 0.5 ? `rgba(255,240,210,${(n - 0.5) * 0.08})` : `rgba(0,0,0,${(0.5 - n) * 0.18})`;
        g.fillRect(px, py, T, T);
      }
      // 水牢：积水倒影
      if (theme.deco === 'water') {
        for (let i = 0; i < map.cols * map.rows * 0.05; i++) {
          const x = Math.floor(rng() * map.cols), y = Math.floor(rng() * map.rows);
          if (wall(x, y)) continue;
          const cx = x * T + 16, cy = y * T + 18, rw = 10 + rng() * 14;
          const grd = g.createRadialGradient(cx, cy, 1, cx, cy, rw);
          grd.addColorStop(0, 'rgba(120,200,255,0.30)'); grd.addColorStop(1, 'rgba(120,200,255,0)');
          g.fillStyle = grd; g.beginPath(); g.ellipse(cx, cy, rw, rw * 0.45, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(220,245,255,0.25)'; g.fillRect(cx - rw * 0.4, cy - 1, rw * 0.5, 1);
        }
      }

      // 2) 墙顶（深色屋脊）
      for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
        if (!wall(x, y)) continue;
        const px = x * T, py = y * T;
        if (wallImg) {
          const cell = wallImg.width / 3, half = cell / 2, v = Math.floor(hash2(x >> 1, y >> 1, 5) * 3);
          g.drawImage(wallImg, v * cell + (x % 2) * half, st.wall * cell + (y % 2) * half, half, half, px, py, T + 0.5, T + 0.5);
        }
        g.fillStyle = 'rgba(6,5,10,0.80)'; g.fillRect(px, py, T, T);
        if (st.wallTint) { g.fillStyle = st.wallTint; g.fillRect(px, py, T, T); }
        // 与地面相邻的墙顶边缘提亮
        g.fillStyle = 'rgba(255,240,210,0.10)';
        if (x > 0 && !wall(x - 1, y)) g.fillRect(px, py, 2, T);
        if (x + 1 < map.cols && !wall(x + 1, y)) g.fillRect(px + T - 2, py, 2, T);
        if (y > 0 && !wall(x, y - 1)) g.fillRect(px, py, T, 2);
      }

      // 3) 墙立面：下方是地面的墙画成 1.5 格高的砖墙，带纵向明暗
      const faceH = T * 1.5;
      for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
        if (!wall(x, y) || y + 1 >= map.rows || wall(x, y + 1)) continue;
        const px = x * T, top = y * T + T - faceH;
        if (wallImg) {
          const cell = wallImg.width / 3, v = Math.floor(hash2(x, y, 9) * 3);
          g.drawImage(wallImg, v * cell + (x % 2) * cell / 2, st.wall * cell, cell / 2, cell * 0.75, px, top, T + 0.5, faceH);
        } else {
          g.fillStyle = theme.brick; g.fillRect(px, top, T, faceH);
        }
        if (st.wallTint) { g.fillStyle = st.wallTint; g.fillRect(px, top, T, faceH); }
        const grd = g.createLinearGradient(0, top, 0, top + faceH);
        grd.addColorStop(0, 'rgba(255,245,220,0.10)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.10)'); grd.addColorStop(1, 'rgba(0,0,0,0.55)');
        g.fillStyle = grd; g.fillRect(px, top, T, faceH);
        // 墙檐
        g.fillStyle = st.faceTop; g.globalAlpha = 0.55; g.fillRect(px, top, T, 2); g.globalAlpha = 1;
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(px, top + 2, T, 1);
        // 侧边转角阴影
        if (x > 0 && !wall(x - 1, y)) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px, top, 3, faceH); }
        if (x + 1 < map.cols && !wall(x + 1, y)) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px + T - 3, top, 3, faceH); }
        // 立面装饰：镇妖黄符 / 锁链 / 壁挂火把 / 场景细节
        const d = rng();
        if (d < 0.13) this.paintTalisman(g, px + 10 + rng() * 10, top + 12, rng);
        else if (d < 0.2) this.paintChain(g, px + 8 + rng() * 16, top + 3, faceH - 10);
        else if (d < 0.3 && !torches.some(t => Math.abs(t.x - px) < T * 3 && Math.abs(t.y - top) < T)) torches.push({ x: px + 16, y: top + 16 });
        else if (d < 0.45) this.paintWallDetail(g, theme.deco, px, top, faceH, rng);
      }
      // 4) 接地阴影（AO）
      for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
        if (wall(x, y)) continue;
        const px = x * T, py = y * T;
        if (wall(x, y - 1)) {
          const grd = g.createLinearGradient(0, py, 0, py + 14);
          grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd; g.fillRect(px, py, T, 14);
        }
        if (wall(x - 1, y)) { const grd = g.createLinearGradient(px, 0, px + 10, 0); grd.addColorStop(0, 'rgba(0,0,0,0.42)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(px, py, 10, T); }
        if (wall(x + 1, y)) { const grd = g.createLinearGradient(px + T, 0, px + T - 10, 0); grd.addColorStop(0, 'rgba(0,0,0,0.42)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(px + T - 10, py, 10, T); }
        if (wall(x, y + 1)) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px, py + T - 4, T, 4); }
      }

      // 5) 入口石台、下行法阵、镇守殿封印
      const ex = map.entry.x * T, ey = map.entry.y * T + 8;
      this.paintProp(g, 'seal', ex, ey + 8, 30, 1);
      const sx = map.stairs.x * T, sy = map.stairs.y * T + 10;
      this.paintProp(g, 'portal', sx, sy + 8, 34, 1);
      lights.push({ x: sx, y: sy - 4, color: '#5ab0ff', r: 90, flicker: 0.1 });
      const bossPack = map.packs.find(p => p.kind === 'boss');
      if (bossPack) this.paintSeal(g, bossPack.x * T, bossPack.y * T + 12, 44);

      // 6) 道具：靠墙放高的，空地偶尔放小的；避开怪群、宝箱、出入口
      const keep = [map.entry, map.stairs, map.chest, map.treasure, map.merchant].filter(Boolean).concat(map.packs);
      const free = (x, y) => !keep.some(k => Math.hypot(k.x - (x + 0.5), k.y - (y + 0.5)) < 1.6);
      const placed = [];
      for (let y = 1; y < map.rows - 1; y++) for (let x = 1; x < map.cols - 1; x++) {
        if (wall(x, y) || !free(x, y)) continue;
        const backWall = wall(x, y - 1), side = wall(x - 1, y) || wall(x + 1, y);
        const r = rng();
        let name = null, h = 0;
        if (backWall && r < 0.16) { name = st.tall[Math.floor(rng() * st.tall.length)]; h = 40 + rng() * 10; }
        else if ((backWall || side) && r < 0.30) { name = st.props[Math.floor(rng() * st.props.length)]; h = 18 + rng() * 8; }
        else if (r < 0.025) { name = st.props[Math.floor(rng() * st.props.length)]; h = 15 + rng() * 6; }
        if (!name) continue;
        const ox = x * T + 16 + (side && !backWall ? (wall(x - 1, y) ? -7 : 7) : (rng() - 0.5) * 10);
        const oy = y * T + (backWall ? 14 : 18 + rng() * 8);
        placed.push({ name, x: ox, y: oy, h });
      }
      placed.sort((a, b) => a.y - b.y);
      for (const p of placed) {
        this.paintProp(g, p.name, p.x, p.y, p.h, 0);
        const L = st.lights[p.name];
        if (L) lights.push({ x: p.x, y: p.y - p.h * 0.6, color: L[0], r: L[1], flicker: p.name === 'torch' || p.name === 'brazier' || p.name === 'campfire' ? 0.25 : 0.08, flame: p.name === 'torch' ? { x: p.x, y: p.y - p.h + 6 } : null });
      }
      for (const t of torches) lights.push({ x: t.x, y: t.y - 4, color: '#ff9a40', r: 92, flicker: 0.25 });
      this.bgCache = { uid: map.uid, canvas: c, torches, lights, artReady: art.ready };
      return this.bgCache;
    },

    // 画道具：按高度等比缩放，脚底对齐 (x, y)
    paintProp(g, name, x, y, h, mode) {
      const img = this.art && this.art.imgs.props, r = typeof IDLE_PROPS !== 'undefined' && IDLE_PROPS[name];
      if (!img || !r) return false;
      const [sx, sy, sw, sh] = r;
      let w = h * sw / sh;
      if (mode === 1) { w = h; h = h * sh / sw; } // mode 1：按宽度
      if (mode !== 1) { g.fillStyle = 'rgba(0,0,0,0.30)'; g.beginPath(); g.ellipse(x, y - 1, w * 0.42, Math.max(2, w * 0.13), 0, 0, Math.PI * 2); g.fill(); }
      g.drawImage(img, sx, sy, sw, sh, x - w / 2, y - h, w, h);
      return true;
    },

    paintTalisman(g, x, y, rng) {
      g.save();
      g.translate(x, y); g.rotate((rng() - 0.5) * 0.12);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(1, 1, 8, 17);
      const grd = g.createLinearGradient(0, 0, 0, 17);
      grd.addColorStop(0, '#f0d27a'); grd.addColorStop(1, '#c79a3e');
      g.fillStyle = grd; g.fillRect(0, 0, 8, 17);
      g.strokeStyle = '#a3263a'; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(4, 2); g.lineTo(4, 15); g.moveTo(1.5, 5); g.lineTo(6.5, 5); g.moveTo(2, 9); g.lineTo(6, 11); g.moveTo(6, 9); g.lineTo(2, 12); g.stroke();
      g.fillStyle = '#a3263a'; g.fillRect(2.5, 13.5, 3, 2);
      g.restore();
    },

    paintChain(g, x, y, len) {
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.6;
      for (let cy = 0; cy < len; cy += 4) { g.beginPath(); g.ellipse(x + 0.6, y + cy + 2.6, 1.4, 2.2, 0, 0, Math.PI * 2); g.stroke(); }
      g.strokeStyle = '#8d8d96'; g.lineWidth = 1;
      for (let cy = 0; cy < len; cy += 4) { g.beginPath(); g.ellipse(x, y + cy + 2, 1.4, 2.2, 0, 0, Math.PI * 2); g.stroke(); }
    },

    paintWallDetail(g, deco, px, top, h, rng) {
      if (deco === 'tomb') {
        g.fillStyle = 'rgba(70,140,60,0.55)';
        for (let i = 0; i < 3; i++) { const x = px + rng() * 28; g.fillRect(x, top + 2, 2, 4 + rng() * 10); }
      } else if (deco === 'water') {
        g.fillStyle = 'rgba(200,240,255,0.6)';
        for (let i = 0; i < 4; i++) { const x = px + rng() * 28, l = 3 + rng() * 6; g.beginPath(); g.moveTo(x, top + 3); g.lineTo(x + 2, top + 3); g.lineTo(x + 1, top + 3 + l); g.fill(); }
      } else if (deco === 'lava') {
        g.strokeStyle = 'rgba(255,110,40,0.75)'; g.lineWidth = 1;
        g.beginPath(); let x = px + 4 + rng() * 20, y = top + 6; g.moveTo(x, y);
        for (let i = 0; i < 4; i++) { x += (rng() - 0.5) * 8; y += 5 + rng() * 5; g.lineTo(x, y); }
        g.stroke();
      } else {
        g.fillStyle = 'rgba(190,140,255,0.55)'; g.font = '9px serif'; g.textAlign = 'center';
        g.fillText('卍封镇冥'[Math.floor(rng() * 4)], px + 16, top + h * 0.55);
      }
    },

    paintSeal(g, x, y, r) {
      g.save();
      g.translate(x, y); g.scale(1, 0.5);
      g.strokeStyle = 'rgba(200,50,60,0.7)'; g.lineWidth = 2.2;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, r * 0.78, 0, Math.PI * 2); g.stroke();
      g.beginPath();
      for (let i = 0; i <= 8; i++) { const a = i * Math.PI * 2 * 3 / 8; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78); }
      g.stroke();
      g.fillStyle = 'rgba(220,70,70,0.75)'; g.font = 'bold 10px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      '镇妖伏魔封印'.split('').forEach((ch, i) => { const a = i / 6 * Math.PI * 2; g.fillText(ch, Math.cos(a) * r * 0.89, Math.sin(a) * r * 0.89); });
      g.restore();
    },

    // ---------- 立绘 ----------
    // 画手绘立绘帧：(x, feetY) 为脚底中心，D 为 128px 格子的绘制尺寸
    drawSample(g, s, x, feetY, D, flip, alpha = 1, flash = 0) {
      const d = D * (s.renderScale || 1);
      const dy = feetY - d * 124 / 128;
      g.save();
      g.globalAlpha = alpha;
      g.translate(Math.round(x * R) / R, 0);
      if (flip) g.scale(-1, 1);
      g.drawImage(s.source, s.x, s.y, s.width, s.height, -d / 2, dy, d, d);
      if (flash > 0) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = Math.min(1, flash) * alpha * 0.8;
        g.drawImage(s.source, s.x, s.y, s.width, s.height, -d / 2, dy, d, d);
      }
      g.restore();
    },

    drawSprite(g, id, x, y, scale, alpha = 1, flip = false) {
      const sp = typeof HomeArt !== 'undefined' && HomeArt.canvas(id, scale);
      if (!sp) return null;
      g.save();
      g.imageSmoothingEnabled = false;
      g.globalAlpha = alpha;
      if (flip) { g.translate(Math.round(x), 0); g.scale(-1, 1); g.drawImage(sp, Math.round(-sp.width / 2), Math.round(y - sp.height)); }
      else g.drawImage(sp, Math.round(x - sp.width / 2), Math.round(y - sp.height));
      g.restore();
      return sp;
    },

    shadow(g, x, y, w) {
      const grd = g.createRadialGradient(x, y, 0, x, y, w);
      grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.save(); g.translate(x, y); g.scale(1, 0.32); g.translate(-x, -y);
      g.beginPath(); g.arc(x, y, w, 0, Math.PI * 2); g.fill();
      g.restore();
    },

    // 主角动作与朝向
    heroPose(dt) {
      const run = this.run, v = this.view;
      const p = v.pose || (v.pose = { dir: 'front', t: 0, px: run.hx, py: run.hy, atk: 0, cast: 0, hurt: 0, dead: 0 });
      p.t += dt;
      const dx = run.hx - p.px, dy = run.hy - p.py;
      p.px = run.hx; p.py = run.hy;
      const moving = Math.hypot(dx, dy) > 0.0004 && run.phase === 'walk';
      if (moving) {
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax > ay * 2) p.dir = dx > 0 ? 'right' : 'left';
        else if (ay > ax * 2) p.dir = dy > 0 ? 'front' : 'back';
        else p.dir = (dy > 0 ? 'front' : 'back') + (dx > 0 ? 'Right' : 'Left');
      } else if (run.pack) {
        p.dir = run.pack.x * this.T >= run.hx * this.T ? 'right' : 'left';
      }
      if (v.lunge > 0.9 && p.atk <= 0.05) p.atk = 0.34;
      p.atk = Math.max(0, p.atk - dt); p.cast = Math.max(0, p.cast - dt); p.hurt = Math.max(0, p.hurt - dt);
      p.dead = run.phase === 'dead' ? p.dead + dt : 0;
      return { p, moving };
    },

    drawHero(g, now, dt) {
      const run = this.run, v = this.view;
      const { x: hx, y: hy } = this.heroPx();
      const { p, moving } = this.heroPose(dt);
      // 宠物跟在身后
      const pet = typeof player !== 'undefined' && player.home && player.home.activePet;
      const fx = p.dir.includes('Left') || p.dir === 'left' ? -1 : 1;
      if (pet) {
        const px = hx - 26 * fx, py = Math.round(hy - 2 + Math.sin(now * (moving ? 10 : 3)) * 2);
        this.shadow(g, px, hy, 10);
        this.drawSprite(g, 'pet_' + pet, px, py, 2, 1, fx < 0);
      }
      this.shadow(g, hx, hy + 1, 18);
      let s = null;
      if (typeof ArtSamples !== 'undefined') {
        if (p.dead > 0) s = ArtSamples.deathFrame('hero', p.dead, 0.9, fx > 0);
        if (!s) {
          let action = 'idle', frame = Math.floor(p.t * 5) % 4;
          const dir = p.dir;
          if (p.cast > 0) { action = 'cast'; frame = Math.min(3, Math.floor((1 - p.cast / 0.4) * 4)); }
          else if (p.atk > 0) { action = 'attack'; frame = Math.min(3, Math.floor((1 - p.atk / 0.34) * 4)); }
          else if (p.hurt > 0) { action = 'hurt'; frame = 1; }
          else if (moving) { action = 'walk'; frame = Math.floor(p.t * 9) % 4; }
          const sideDir = action === 'walk' ? dir : (dir.includes('Left') ? 'left' : dir.includes('Right') ? 'right' : dir);
          s = ArtSamples.heroFrame(action, sideDir, frame);
        }
      }
      const alpha = run.phase === 'dead' && p.dead > 1.2 ? 0.6 : 1;
      if (s) this.drawSample(g, s, hx, hy + 2, HERO_D, false, alpha, v.heroFlash > 0 ? v.heroFlash * 4 : 0);
      else this.drawSprite(g, v.lunge > 0.3 ? 'idle_hero_atk' : 'idle_hero', hx, hy, 3, alpha, run.facing < 0);
      if (run.shield > 0) {
        g.save(); g.globalCompositeOperation = 'lighter';
        g.strokeStyle = 'rgba(255,210,77,0.75)'; g.lineWidth = 2;
        g.beginPath(); g.ellipse(hx, hy - 28, 26 + Math.sin(now * 8), 34 + Math.sin(now * 8), 0, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 0.25; g.drawImage(this.glowTex('#ffd24d'), hx - 40, hy - 70, 80, 80);
        g.restore();
      }
    },

    drawEnemy(g, ve, now) {
      const e = ve.ref, run = this.run;
      const tier = e.tier === 'boss' ? 'boss' : e.nemesis ? 'nemesis' : e.tier === 'elite' ? 'elite' : 'normal';
      const D = MOB_D[tier];
      const key = this.monsterArtKey(e);
      const hp = this.heroPx();
      const flip = !ve.idle && hp.x < ve.x;
      let lx = 0, ly = 0;
      if (ve.lunge > 0) {
        const dx = hp.x - ve.x, dy = hp.y - ve.y, d = Math.hypot(dx, dy) || 1;
        lx = dx / d * ve.lunge * 10; ly = dy / d * ve.lunge * 10;
      }
      const x = ve.x + lx, y = ve.y + ly;
      let alpha = 1;
      if (ve.dying > 0) alpha = ve.dying > 0.6 ? Math.max(0, 1 - (ve.dying - 0.6) / 0.3) : 1;
      // 光环：精英蓝、宿敌红、镇守橙
      if (tier !== 'normal' && !(ve.dying > 0)) {
        const col = tier === 'boss' ? '#ff8a3d' : tier === 'nemesis' ? '#ff3030' : '#4f8cff';
        const r = D * 0.42 + Math.sin(now * 4 + ve.uid) * 3;
        g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = tier === 'elite' ? 0.35 : 0.5;
        g.translate(ve.x, ve.y + 1); g.scale(1, 0.35);
        g.drawImage(this.glowTex(col), -r, -r, r * 2, r * 2);
        g.restore();
      }
      this.shadow(g, ve.x, ve.y + 1, D * 0.2);
      let s = null;
      if (key && typeof ArtSamples !== 'undefined') {
        if (ve.dying > 0) s = ArtSamples.deathFrame(key, ve.dying, 0.45, flip);
        if (!s) {
          let row = 0, col = Math.floor(now * 5 + ve.uid) % 4;
          if (ve.lunge > 0) { row = 2; col = Math.min(3, Math.floor((1 - ve.lunge) * 4)); }
          else if (ve.flash > 0) { row = 3; col = 1; }
          s = ArtSamples.frame(key, row, col + (ve.idle ? 0 : 4), flip);
        }
      }
      if (s) this.drawSample(g, s, x, y + 2, D, s.flipX, alpha, ve.flash > 0 ? ve.flash * 6 : 0);
      else {
        const sprite = (typeof IDLE_MONSTER_SPRITE !== 'undefined' && IDLE_MONSTER_SPRITE[e.type]) || 'mob_melee';
        this.drawSprite(g, sprite, x, y, tier === 'boss' || tier === 'nemesis' ? 4 : 3, alpha, flip);
      }
      if (ve.dying > 0) return;
      const top = y - D * 0.62 - (tier === 'boss' ? 6 : 0);
      if (!ve.idle) {
        const bw = tier === 'boss' ? 64 : tier === 'nemesis' ? 50 : 30;
        g.fillStyle = 'rgba(10,8,14,0.85)'; g.fillRect(x - bw / 2 - 1, top - 1, bw + 2, 5);
        g.fillStyle = e.nemesis ? '#ff4d4d' : tier === 'boss' ? '#ff8a3d' : tier === 'elite' ? '#5fa8ff' : '#d0405a';
        g.fillRect(x - bw / 2, top, Math.max(0, bw * e.hp / e.maxHp), 3);
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x - bw / 2, top, Math.max(0, bw * e.hp / e.maxHp), 1);
      }
      if (tier !== 'normal') {
        const name = e.nemesis ? `☠ ${e.name}` : e.name;
        this.label(g, name, x, top - 4, e.nemesis ? '#ff5a5a' : tier === 'boss' ? '#ffa04d' : '#a9cbff', tier === 'boss' ? 10 : 9);
      }
    },

    label(g, text, x, y, color, size = 9) {
      g.font = `bold ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.lineWidth = 3; g.strokeStyle = 'rgba(10,8,14,0.9)'; g.lineJoin = 'round';
      g.strokeText(text, x, y);
      g.fillStyle = color; g.fillText(text, x, y);
    },

    drawChest(g, x, y, opened, now, big) {
      const w = big ? 46 : 30;
      if (!opened) {
        const r = (big ? 56 : 30) + Math.sin(now * 3) * 4;
        g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = big ? 0.55 : 0.35;
        g.drawImage(this.glowTex('#ffd860'), x - r, y - 12 - r, r * 2, r * 2); g.restore();
      }
      g.save();
      if (opened) { g.globalAlpha = 0.55; g.filter = 'grayscale(0.6) brightness(0.7)'; }
      const ok = this.paintProp(g, 'chest', x, y, w * 86 / 92, 0);
      g.restore();
      if (!ok) { g.fillStyle = '#8a5a2b'; g.fillRect(x - w / 2, y - w * 0.7, w, w * 0.7); }
      if (!opened) {
        g.save(); g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < (big ? 5 : 3); i++) {
          const k = (now * 0.7 + i / (big ? 5 : 3)) % 1;
          g.globalAlpha = 1 - k;
          g.drawImage(this.glowTex('#fff0a0'), x - w * 0.4 + (i / (big ? 4 : 2)) * w * 0.8 - 3, y - w * 0.7 - k * 22 - 3, 6, 6);
        }
        g.restore();
      }
    },

    drawTreasure(g, x, y, opened, now) {
      this.drawChest(g, x, y, opened, now, true);
      this.label(g, opened ? '藏宝洞（已空）' : '藏宝洞', x, y - 50, opened ? '#94b0c2' : '#ffe14d', 10);
    },

    drawMerchant(g, mc, now) {
      const x = mc.x * this.T, y = mc.y * this.T + 10;
      this.shadow(g, x, y + 1, 16);
      const s = typeof EnvironmentArt !== 'undefined' && EnvironmentArt.npc('merchant');
      if (s && s.contentBounds) {
        const b = s.contentBounds, h = 62, w = h * b.sw / b.sh;
        g.save();
        if (this.run.hx < mc.x) { g.translate(x, 0); g.scale(-1, 1); g.translate(-x, 0); }
        g.drawImage(s.source, b.sx, b.sy, b.sw, b.sh, x - w / 2, y + 2 - h + Math.sin(now * 2) * 0.6, w, h);
        g.restore();
      } else this.drawSprite(g, 'npc_merchant', x, y, 3, 1, this.run.hx < mc.x);
      this.label(g, '游商', x, y - 66, '#f7a43a', 10);
    },

    // ---------- 特效（加色混合，自带泛光） ----------
    drawFx(g, f) {
      const k = Math.max(0, f.t) / f.life;
      if (f.t < 0) return;
      g.save();
      g.globalCompositeOperation = 'lighter';
      if (f.kind === 'slash') {
        const a = 1 - k;
        g.strokeStyle = f.crit ? `rgba(255,214,120,${a})` : `rgba(240,248,255,${a})`;
        g.lineWidth = (f.crit ? 4 : 3) * (1 - k * 0.5); g.lineCap = 'round';
        g.beginPath(); g.arc(f.x, f.y, 16 + k * 10, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
        g.lineWidth = 1; g.beginPath(); g.arc(f.x, f.y, 12 + k * 10, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
        g.globalAlpha = a * 0.6; g.drawImage(this.glowTex(f.crit ? '#ffcd75' : '#cfe8ff'), f.x - 22, f.y - 22, 44, 44);
      } else if (f.kind === 'fireball') {
        const m = Math.min(1, k * 1.4);
        const x = f.x0 + (f.x1 - f.x0) * m, y = f.y0 + (f.y1 - f.y0) * m;
        if (k < 0.7) {
          for (let i = 4; i >= 0; i--) {
            const t = Math.max(0, m - i * 0.06), tx = f.x0 + (f.x1 - f.x0) * t, ty = f.y0 + (f.y1 - f.y0) * t;
            g.globalAlpha = 0.5 - i * 0.08; g.drawImage(this.glowTex('#ff7a30'), tx - 12 + i, ty - 12 + i, 24 - i * 2, 24 - i * 2);
          }
          g.globalAlpha = 1; g.drawImage(this.glowTex('#ffe0a0'), x - 8, y - 8, 16, 16);
        } else {
          const e = (k - 0.7) / 0.3, r = 18 + e * 40;
          g.globalAlpha = 1 - e; g.drawImage(this.glowTex('#ff6a20'), x - r, y - r, r * 2, r * 2);
          g.drawImage(this.glowTex('#ffd080'), x - r * 0.5, y - r * 0.5, r, r);
        }
      } else if (f.kind === 'lightning') {
        const a = 1 - k;
        const pts = [[f.x0, f.y0]];
        const seg = 7;
        for (let i = 1; i <= seg; i++) {
          const tt = i / seg, j = i === seg ? 0 : ((Math.sin((f.seed * 100 + i) * 12.9898) * 43758.5453) % 1) * 16;
          pts.push([f.x0 + (f.x1 - f.x0) * tt + j, f.y0 + (f.y1 - f.y0) * tt]);
        }
        const path = () => { g.beginPath(); pts.forEach(([px, py], i) => g[i ? 'lineTo' : 'moveTo'](px, py)); };
        g.lineJoin = 'round';
        path(); g.strokeStyle = `rgba(80,200,255,${a * 0.5})`; g.lineWidth = 7; g.stroke();
        path(); g.strokeStyle = `rgba(150,240,255,${a})`; g.lineWidth = 2.5; g.stroke();
        path(); g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 1; g.stroke();
        g.globalAlpha = a; g.drawImage(this.glowTex('#9fe8ff'), f.x1 - 26, f.y1 - 26, 52, 52);
      } else if (f.kind === 'dart' || f.kind === 'bolt') {
        const x = f.x0 + (f.x1 - f.x0) * k, y = f.y0 + (f.y1 - f.y0) * k;
        const ang = Math.atan2(f.y1 - f.y0, f.x1 - f.x0);
        const col = f.color || '#ffcd75';
        g.strokeStyle = col; g.lineWidth = 2; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x - Math.cos(ang) * 12, y - Math.sin(ang) * 12); g.lineTo(x, y); g.stroke();
        g.globalAlpha = 0.7; g.drawImage(this.glowTex(col), x - 8, y - 8, 16, 16);
      } else if (f.kind === 'bell') {
        const hp = this.heroPx(), a = 1 - k;
        g.strokeStyle = `rgba(255,210,77,${a})`; g.lineWidth = 3;
        g.beginPath(); g.ellipse(hp.x, hp.y - 26, 18 + k * 40, (18 + k * 40) * 1.2, 0, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = a * 0.6; g.drawImage(this.glowTex('#ffd24d'), hp.x - 60, hp.y - 86, 120, 120);
      } else if (f.kind === 'spark') {
        g.globalAlpha = 1 - k;
        g.drawImage(this.glowTex(f.color), f.x + f.vx * k - 4, f.y + f.vy * k + 30 * k * k - 4, 8, 8);
      }
      g.restore();
    },

    fxSlash(ve, crit) {
      const v = this.view;
      v.fx.push({ kind: 'slash', x: ve.x, y: ve.y - 26, t: 0, life: 0.2, crit });
      for (let i = 0; i < (crit ? 7 : 4); i++) {
        const a = Math.random() * Math.PI * 2, sp = 14 + Math.random() * 22;
        v.fx.push({ kind: 'spark', x: ve.x, y: ve.y - 26, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10, color: crit ? '#ffd27a' : '#ffffff', t: 0, life: 0.35 });
      }
      if (crit) v.shake = Math.max(v.shake, 0.08);
    },

    // ---------- 光照 ----------
    // 低分辨率光照贴图：环境暗色 + 各光源加色，再以「正片叠底」盖到画面上
    lightPass(g, camX, camY, now, bg) {
      const v = this.view, run = this.run, map = run.map, st = this.style(map.floor), fx = map.fx || {};
      const LW = this.W / 2, LH = this.H / 2;
      if (!v.lightCanvas) { v.lightCanvas = mk(LW, LH); v.lightCtx = v.lightCanvas.getContext('2d'); }
      const lc = v.lightCtx;
      const depth = Math.max(0.62, 1 - run.floor * 0.006) * (fx.light < 1 ? 0.78 : 1);
      const [ar, ag, ab] = st.ambient.map(c => Math.round(c * depth));
      lc.globalCompositeOperation = 'source-over';
      lc.globalAlpha = 1;
      lc.fillStyle = `rgb(${ar},${ag},${ab})`; lc.fillRect(0, 0, LW, LH);
      lc.globalCompositeOperation = 'lighter';
      const add = (x, y, r, color, a = 1) => {
        const sx = (x - camX) / 2, sy = (y - camY) / 2, rr = r / 2;
        if (sx < -rr || sy < -rr || sx > LW + rr || sy > LH + rr) return;
        lc.globalAlpha = Math.max(0, Math.min(1, a));
        lc.drawImage(this.glowTex(color), sx - rr, sy - rr, rr * 2, rr * 2);
      };
      const hp = this.heroPx();
      const lantern = Math.max(150, 230 - run.floor * 1.5) * (fx.light || 1);
      add(hp.x, hp.y - 24, lantern * 2, '#fff0d8', 1);
      add(hp.x, hp.y - 24, lantern * 1.1, '#ffe6c0', 0.6);
      for (const L of bg.lights) {
        if (!this.seen(L.x / this.T, L.y / this.T + 0.5)) continue;
        const fl = 1 - L.flicker * 0.5 + Math.sin(now * 13 + L.x) * L.flicker * 0.3 + Math.sin(now * 7.3 + L.y) * L.flicker * 0.2;
        add(L.x, L.y, L.r * 2 * fl, L.color, 0.9);
      }
      const chest = map.chest;
      if (chest && !chest.opened && this.seen(chest.x, chest.y)) add(chest.x * this.T, chest.y * this.T, 80, '#ffd860', 0.6);
      const tr = map.treasure;
      if (tr && !tr.opened && this.seen(tr.x, tr.y)) add(tr.x * this.T, tr.y * this.T, 150, '#ffd860', 0.8);
      const mc = map.merchant;
      if (mc && this.seen(mc.x, mc.y)) add(mc.x * this.T - 10, mc.y * this.T - 20, 110, '#ffb050', 0.8);
      const boss = map.packs.find(p => p.kind === 'boss' && !p.cleared);
      if (boss && this.seen(boss.x, boss.y)) add(boss.x * this.T, boss.y * this.T + 10, 150 + Math.sin(now * 3) * 12, '#ff3a3a', 0.6);
      for (const ve of v.enemies.values()) if (ve.ref.nemesis && !ve.dying) add(ve.x, ve.y - 20, 120, '#ff3030', 0.7);
      for (const f of v.fx) {
        if (f.t < 0) continue;
        const k = f.t / f.life;
        if (f.kind === 'fireball') { const m = Math.min(1, k * 1.4); add(f.x0 + (f.x1 - f.x0) * m, f.y0 + (f.y1 - f.y0) * m, k < 0.7 ? 90 : 200 * (1.3 - k), '#ff8a40', 1); }
        else if (f.kind === 'lightning') add((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, 260, '#a0e8ff', 1 - k);
        else if (f.kind === 'bell') add(hp.x, hp.y - 26, 200, '#ffd24d', 1 - k);
        else if (f.kind === 'slash' && f.crit) add(f.x, f.y, 90, '#ffd27a', 1 - k);
      }
      g.save();
      g.setTransform(R, 0, 0, R, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.imageSmoothingEnabled = true;
      g.drawImage(v.lightCanvas, 0, 0, LW, LH, 0, 0, this.W, this.H);
      g.restore();
    },

    // 火焰与光源的泛光（加色，在光照之后画，不被压暗）
    bloomPass(g, now, bg) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const t of bg.torches) {
        if (!this.seen(t.x / this.T, t.y / this.T + 1)) continue;
        this.paintFlame(g, t.x, t.y, now, 1);
      }
      for (const L of bg.lights) {
        if (!L.flame || !this.seen(L.x / this.T, L.y / this.T + 0.5)) continue;
        this.paintFlame(g, L.flame.x, L.flame.y, now, 0.8);
      }
      for (const L of bg.lights) {
        if (!this.seen(L.x / this.T, L.y / this.T + 0.5)) continue;
        g.globalAlpha = 0.16 + Math.sin(now * 9 + L.x) * 0.03;
        g.drawImage(this.glowTex(L.color), L.x - 22, L.y - 22, 44, 44);
      }
      g.restore();
    },

    paintFlame(g, x, y, now, s) {
      // 壁挂火把：铁托 + 跳动的火苗
      g.save();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#2a2420'; g.fillRect(x - 1.5, y, 3, 9 * s);
      g.fillStyle = '#4a3e34'; g.fillRect(x - 4 * s, y, 8 * s, 2);
      g.restore();
      const f1 = Math.sin(now * 17 + x) * 0.5 + 0.5, f2 = Math.sin(now * 11 + y) * 0.5 + 0.5;
      g.globalAlpha = 0.9; g.drawImage(this.glowTex('#ff7a20'), x - 9 * s, y - 15 * s - f1 * 2, 18 * s, 20 * s);
      g.globalAlpha = 1; g.drawImage(this.glowTex('#ffd070'), x - 5 * s, y - 11 * s - f2 * 2, 10 * s, 13 * s);
      g.globalAlpha = 0.9; g.drawImage(this.glowTex('#fff6d0'), x - 2.5 * s, y - 7 * s, 5 * s, 6 * s);
      g.globalAlpha = 0.22; g.drawImage(this.glowTex('#ff9a40'), x - 30, y - 34, 60, 60);
      g.globalAlpha = 1;
    },

    // 浮尘 / 水汽 / 火星 / 幽火：屏幕空间粒子，加色
    motesPass(g, dt, now) {
      const v = this.view, st = this.style(this.run.floor), deco = this.themeFor(this.run.floor).deco;
      if (!v.motes) v.motes = [];
      const want = deco === 'lava' ? 34 : 26;
      while (v.motes.length < want) v.motes.push({ x: Math.random() * this.W, y: Math.random() * this.H, s: 1 + Math.random() * 2.2, ph: Math.random() * 6.28, sp: 0.4 + Math.random() });
      const rise = deco === 'lava' || deco === 'abyss';
      g.save(); g.globalCompositeOperation = 'lighter';
      const tex = this.glowTex(st.mote);
      for (const m of v.motes) {
        m.y += (rise ? -14 : 4) * m.sp * dt;
        m.x += Math.sin(now * 0.8 + m.ph) * 6 * dt;
        if (m.y < -6) { m.y = this.H + 6; m.x = Math.random() * this.W; }
        if (m.y > this.H + 6) { m.y = -6; m.x = Math.random() * this.W; }
        g.globalAlpha = (0.25 + 0.35 * (Math.sin(now * 2 + m.ph) * 0.5 + 0.5)) * (rise ? 1 : 0.7);
        g.drawImage(tex, m.x - m.s * 2, m.y - m.s * 2, m.s * 4, m.s * 4);
      }
      g.restore();
    },

    // 上下景深：把画面缩小再放大得到模糊版本，按渐变蒙版叠在上下边缘（HD-2D 的移轴感）
    dofPass(g) {
      const v = this.view, c = this.canvas;
      // 自适应：设备上景深太贵（平均 >6ms）就自动关掉
      if (IdleMode.dofOff) return;
      const t0 = performance.now();
      this.dofDraw(g, v, c);
      const dt = performance.now() - t0;
      IdleMode.dofCost = IdleMode.dofCost == null ? dt : IdleMode.dofCost * 0.9 + dt * 0.1;
      IdleMode.dofN = (IdleMode.dofN || 0) + 1;
      if (IdleMode.dofN > 30 && IdleMode.dofCost > 6) IdleMode.dofOff = true;
    },

    dofDraw(g, v, c) {
      if (!v.dofSmall) {
        v.dofSmall = mk(this.W / 4, this.H / 4); v.dofSmallCtx = v.dofSmall.getContext('2d');
        v.dofBand = mk(this.W, 100); v.dofBandCtx = v.dofBand.getContext('2d');
      }
      const sc = v.dofSmallCtx, bc = v.dofBandCtx, sw = this.W / 4, sh = this.H / 4;
      // 只缩采上下两条景深带，且隔帧刷新，避免整屏回读
      v.dofTick = (v.dofTick || 0) + 1;
      if (v.dofTick % 2 === 1 || !v.dofReady) {
        sc.imageSmoothingEnabled = true;
        sc.drawImage(c, 0, 0, c.width, 70 * R, 0, 0, sw, 70 / 4);
        sc.drawImage(c, 0, (this.H - 80) * R, c.width, 80 * R, 0, (this.H - 80) / 4, sw, 80 / 4);
        v.dofReady = true;
      }
      const band = (y0, h, fromTop) => {
        bc.globalCompositeOperation = 'source-over';
        bc.clearRect(0, 0, this.W, 100);
        bc.imageSmoothingEnabled = true;
        bc.drawImage(v.dofSmall, 0, y0 / 4, sw, h / 4, 0, 0, this.W, h);
        bc.globalCompositeOperation = 'destination-in';
        const grd = bc.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, `rgba(0,0,0,${fromTop ? 0.9 : 0})`);
        grd.addColorStop(1, `rgba(0,0,0,${fromTop ? 0 : 0.9})`);
        bc.fillStyle = grd; bc.fillRect(0, 0, this.W, h);
        g.drawImage(v.dofBand, 0, 0, this.W, h, 0, y0, this.W, h);
      };
      g.save(); g.setTransform(R, 0, 0, R, 0, 0);
      band(0, 70, true);
      band(this.H - 80, 80, false);
      g.restore();
    },

    vignette(g) {
      const v = this.view;
      if (!v.vig) {
        v.vig = mk(this.W, this.H);
        const vg = v.vig.getContext('2d');
        const grd = vg.createRadialGradient(this.W / 2, this.H * 0.48, this.H * 0.28, this.W / 2, this.H * 0.48, this.H * 0.68);
        grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.6)');
        vg.fillStyle = grd; vg.fillRect(0, 0, this.W, this.H);
      }
      g.drawImage(v.vig, 0, 0);
    },

    // 柔边战争迷雾：每格 1 像素的小图放大，自带渐变边缘
    fogPass(g, map) {
      const v = this.view;
      if (!v.fogCanvas || v.fogCanvas.width !== map.cols || v.fogCanvas.height !== map.rows) {
        v.fogCanvas = mk(map.cols, map.rows); v.fogImg = v.fogCanvas.getContext('2d').createImageData(map.cols, map.rows); v.fogSig = -1;
      }
      let sig = 0;
      for (let i = 0; i < v.fog.length; i++) sig += v.fog[i] * (i % 97 + 1);
      if (sig !== v.fogSig) {
        v.fogSig = sig;
        const d = v.fogImg.data;
        for (let i = 0; i < v.fog.length; i++) { d[i * 4] = 7; d[i * 4 + 1] = 6; d[i * 4 + 2] = 10; d[i * 4 + 3] = v.fog[i] ? 0 : 255; }
        v.fogCanvas.getContext('2d').putImageData(v.fogImg, 0, 0);
      }
      g.save();
      g.imageSmoothingEnabled = true;
      g.drawImage(v.fogCanvas, -0.5, -0.5, map.cols, map.rows, -this.T / 2, -this.T / 2, map.cols * this.T, map.rows * this.T);
      g.restore();
    },

    // ---------- 主绘制 ----------
    draw() {
      const g = this.ctx;
      if (!g || !this.run || !this.run.map) return;
      const run = this.run, v = this.view, W = this.W, H = this.H, T = this.T, map = run.map;
      if (v.mapUid !== map.uid) this.revealFog();
      this.ensureMapArt(map);
      const nowMs = performance.now(), now = nowMs / 1000;
      const dt = Math.min(0.1, v.lastDraw ? (nowMs - v.lastDraw) / 1000 : 0.016);
      v.lastDraw = nowMs;
      const bg = this.mapCanvas(map);
      const camX = Math.round((v.camX || 0) * R) / R, camY = Math.round((v.camY || 0) * R) / R;
      g.setTransform(R, 0, 0, R, 0, 0);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.fillStyle = '#07060a'; g.fillRect(0, 0, W, H);
      g.save();
      if (v.shake > 0) g.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
      g.drawImage(bg.canvas, camX * R, camY * R, W * R, H * R, 0, 0, W, H);
      g.translate(-camX, -camY);
      const inView = (x, y, m = 70) => x > camX - m && x < camX + W + m && y > camY - m && y < camY + H + m;

      // 镇守殿封印的呼吸红光
      const bossPack = map.packs.find(p => p.kind === 'boss' && !p.cleared);
      if (bossPack && this.seen(bossPack.x, bossPack.y)) {
        g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.25 + Math.sin(now * 3) * 0.12;
        g.translate(bossPack.x * T, bossPack.y * T + 12); g.scale(1, 0.5);
        g.drawImage(this.glowTex('#ff2a2a'), -60, -60, 120, 120); g.restore();
      }
      // 下行法阵旋转光点
      if (this.seen(map.stairs.x, map.stairs.y)) {
        const sx = map.stairs.x * T, sy = map.stairs.y * T + 14;
        g.save(); g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 6; i++) {
          const a = now * 1.5 + i * Math.PI / 3;
          g.globalAlpha = 0.7; g.drawImage(this.glowTex('#7ac8ff'), sx + Math.cos(a) * 13 - 3, sy + Math.sin(a) * 5 - 3 - (now * 20 + i * 7) % 18, 6, 6);
        }
        g.restore();
      }

      // 需要按 y 排序的物体：宝箱、藏宝洞、游商、妖物、主角
      const items = [];
      const chest = map.chest;
      if (chest && this.seen(chest.x, chest.y)) items.push({ y: chest.y * T + 10, draw: () => this.drawChest(g, chest.x * T, chest.y * T + 10, chest.opened, now) });
      const tr = map.treasure;
      if (tr && this.seen(tr.x, tr.y)) items.push({ y: tr.y * T + 12, draw: () => this.drawTreasure(g, tr.x * T, tr.y * T + 12, tr.opened, now) });
      const mc = map.merchant;
      if (mc && this.seen(mc.x, mc.y)) items.push({ y: mc.y * T + 10, draw: () => this.drawMerchant(g, mc, now) });
      for (const p of map.packs) {
        if (p.cleared || p === run.pack || !this.seen(p.x, p.y)) continue;
        p.enemies.forEach((e, i) => {
          if (e.hp <= 0) return;
          const [ox, oy] = this.packOffset(i, p.kind === 'boss' || p.kind === 'nemesis');
          const ve = { idle: true, ref: e, x: p.x * T + ox, y: p.y * T + 10 + oy, uid: e.uid, boss: e.tier === 'boss' || !!e.nemesis, flash: 0, lunge: 0, dying: 0 };
          if (inView(ve.x, ve.y)) items.push({ y: ve.y, draw: () => this.drawEnemy(g, ve, now) });
        });
      }
      for (const ve of v.enemies.values()) if (inView(ve.x, ve.y)) items.push({ y: ve.y, draw: () => this.drawEnemy(g, ve, now) });
      const hp = this.heroPx();
      items.push({ y: hp.y, draw: () => this.drawHero(g, now, dt) });
      items.sort((a, b) => a.y - b.y);
      for (const it of items) it.draw();
      g.restore();

      // 光照 → 迷雾 → 泛光/特效 → 粒子 → 调色 → 景深 → 暗角
      this.lightPass(g, camX, camY, now, bg);
      g.save();
      if (v.shake > 0) g.translate((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
      g.translate(-camX, -camY);
      this.fogPass(g, map);
      this.bloomPass(g, now, bg);
      for (const f of v.fx) this.drawFx(g, f);
      // 飘字
      for (const t of v.texts) {
        const k = t.t / t.life;
        const pop = k < 0.12 ? 1 + (0.12 - k) * 4 : 1;
        const y = t.y - k * (t.fixed ? 12 : 26);
        g.globalAlpha = Math.min(1, (1 - k) * 2.2);
        const size = (t.big ? 13 : 10) * pop;
        g.font = `bold ${size.toFixed(1)}px "PingFang SC","Microsoft YaHei",sans-serif`;
        g.textAlign = 'center'; g.lineJoin = 'round';
        g.lineWidth = 3.2; g.strokeStyle = 'rgba(12,8,16,0.95)';
        g.strokeText(t.text, t.x, y);
        g.fillStyle = t.color; g.fillText(t.text, t.x, y);
      }
      g.globalAlpha = 1;
      g.restore();
      this.motesPass(g, dt, now);
      const st = this.style(map.floor);
      g.save(); g.globalCompositeOperation = 'overlay'; g.fillStyle = st.grade; g.fillRect(0, 0, W, H); g.restore();
      this.drawAffixAtmos(g, map, now);
      this.dofPass(g);
      this.vignette(g);

      this.drawMinimap(g);
      if (v.banner) this.drawBanner(g, v.banner);
      if (run.phase === 'dead') { g.fillStyle = 'rgba(90,10,24,0.32)'; g.fillRect(0, 0, W, H); }
      if (run.phase === 'descend') { g.fillStyle = `rgba(0,0,0,${Math.min(1, 1 - run.phaseTimer / 0.8)})`; g.fillRect(0, 0, W, H); }
    },

    drawBanner(g, b) {
      const W = this.W;
      const a = Math.max(0, Math.min(1, b.t * 4, (b.life - b.t) * 3));
      g.save();
      g.globalAlpha = a;
      const h = b.sub ? 40 : 26, y = 104;
      const grd = g.createLinearGradient(0, 0, W, 0);
      grd.addColorStop(0, 'rgba(10,8,14,0)'); grd.addColorStop(0.2, 'rgba(10,8,14,0.82)'); grd.addColorStop(0.8, 'rgba(10,8,14,0.82)'); grd.addColorStop(1, 'rgba(10,8,14,0)');
      g.fillStyle = grd; g.fillRect(0, y, W, h);
      const line = g.createLinearGradient(0, 0, W, 0);
      line.addColorStop(0, 'rgba(199,163,90,0)'); line.addColorStop(0.5, 'rgba(230,196,120,0.9)'); line.addColorStop(1, 'rgba(199,163,90,0)');
      g.fillStyle = line; g.fillRect(0, y, W, 1); g.fillRect(0, y + h - 1, W, 1);
      g.textAlign = 'center';
      g.font = 'bold 14px "PingFang SC","Microsoft YaHei",serif';
      g.shadowColor = b.color; g.shadowBlur = 8;
      g.fillStyle = b.color; g.fillText(b.text, W / 2, y + 18);
      g.shadowBlur = 0;
      if (b.sub) { g.font = '10px "PingFang SC","Microsoft YaHei",sans-serif'; g.fillStyle = b.subColor || '#d6c696'; g.fillText(b.sub, W / 2, y + 33); }
      g.restore();
    },

    // 右上角小地图
    drawMinimap(g) {
      const run = this.run, map = run.map, v = this.view, S = 2;
      const mw = map.cols * S, mh = map.rows * S, ox = this.W - mw - 6, oy = 6;
      g.save();
      g.fillStyle = 'rgba(7,6,10,0.72)'; g.fillRect(ox - 3, oy - 3, mw + 6, mh + 6);
      g.strokeStyle = 'rgba(214,180,110,0.75)'; g.lineWidth = 1; g.strokeRect(ox - 3.5, oy - 3.5, mw + 7, mh + 7);
      g.fillStyle = 'rgba(214,198,150,0.55)';
      for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
        const i = y * map.cols + x;
        if (v.fog[i] && map.tiles[i]) g.fillRect(ox + x * S, oy + y * S, S, S);
      }
      const dot = (x, y, c, r = 2) => { g.fillStyle = c; g.beginPath(); g.arc(ox + x * S, oy + y * S, r, 0, Math.PI * 2); g.fill(); };
      for (const p of map.packs) if (!p.cleared && this.seen(p.x, p.y)) dot(p.x, p.y, p.kind === 'boss' ? '#ff8a3d' : p.kind === 'nemesis' ? '#ff4d4d' : p.kind === 'elite' ? '#5fa8ff' : '#d0405a', p.kind === 'normal' ? 1.4 : 2);
      if (map.chest && !map.chest.opened && this.seen(map.chest.x, map.chest.y)) dot(map.chest.x, map.chest.y, '#ffe14d');
      if (map.treasure && !map.treasure.opened) dot(map.treasure.x, map.treasure.y, '#ffe14d', 2.6);
      if (map.merchant && this.seen(map.merchant.x, map.merchant.y)) dot(map.merchant.x, map.merchant.y, '#f7a43a');
      if (this.seen(map.stairs.x, map.stairs.y)) dot(map.stairs.x, map.stairs.y, '#7ac8ff', 2.2);
      if (Math.floor(performance.now() / 300) % 2) dot(run.hx, run.hy, '#ffffff', 1.8);
      g.restore();
    },

    // 异象氛围：整屏淡淡的色调 + 飘散光点
    drawAffixAtmos(g, map, now) {
      const affs = (map.affixes || []).map(id => IdleCore.AFFIXES[id]).filter(Boolean);
      if (!affs.length) return;
      g.save();
      affs.forEach((a, j) => {
        const rgb = hexRgb(a.color).join(',');
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = `rgba(${rgb},0.05)`; g.fillRect(0, 0, this.W, this.H);
        g.globalCompositeOperation = 'lighter';
        const up = a.burn || a.name === '灵气充盈' ? -1 : 1, tex = this.glowTex(a.color);
        for (let i = 0; i < 12; i++) {
          const seed = i * 97.13 + j * 31.7;
          const k = ((now * (0.05 + (i % 5) * 0.012)) + (seed % 1)) % 1;
          const px = ((seed * 13.7 + Math.sin(now * 0.7 + i) * 12) % this.W + this.W) % this.W;
          const py = up < 0 ? this.H * (1 - k) : this.H * k;
          g.globalAlpha = 0.35 + 0.4 * Math.sin(k * Math.PI);
          g.drawImage(tex, px - 4, py - 4, 8, 8);
        }
      });
      g.restore();
    }
  });
})();

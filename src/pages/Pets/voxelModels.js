// Code-generated voxel models and growth tracks from the approved pet studies.
export function createVoxelModels() {
  const families = [
    {
      id: 'unicorn',
      name: '彩虹独角兽',
      move: '抬前蹄 · 点头 · 摆动彩虹尾巴',
      notes: ['短角 · 短鬃 · 短腿', '角增长 · 鬃尾展开', '长角 · 完整彩虹鬃尾'],
    },
    {
      id: 'mecha',
      name: '铁豆豆',
      move: '伺服转头 · 抬臂招呼',
      notes: ['小肩甲 · 基础胸核', '肩甲加宽 · 增加护腿', 'V 形头冠 · 完整护甲'],
    },
    {
      id: 'kaiju',
      name: '背鳍巨兽',
      move: '抬头张口 · 举爪 · 摆尾',
      notes: ['圆头 · 短尾 · 小背鳍', '体格加厚 · 背鳍增多', '粗尾 · 大背鳍 · 宽下颌'],
    },
    {
      id: 'fox',
      name: '九尾狐',
      move: '歪头 · 抬前爪 · 展开尾扇',
      notes: ['三束短尾', '六束尾巴', '九尾扇形展开'],
    },
    {
      id: 'alien',
      name: '外星人',
      move: '眨眼歪头 · 抬手招呼',
      notes: ['大头短肢', '头身比例拉长', '长触角 · 高挑身形'],
    },
    {
      id: 'kangaroo',
      name: '袋鼠先生',
      move: '小跳 · 鞠躬 · 礼帽致意',
      notes: ['小耳 · 短尾', '马甲 · 腹部口袋', '长耳 · 礼帽 · 领结'],
    },
  ];
  const ages = ['幼体', '成长体', '成体'];
  const P = {
    ink: '#293945',
    white: '#eee8d6',
    pink: '#dba2a5',
    cream: '#e9cba0',
    red: '#cc7f7b',
    orange: '#dfaa70',
    yellow: '#dfca78',
    mint: '#91bfa5',
    blue: '#88b5cf',
    purple: '#b7a4cb',
    navy: '#4c6380',
    steel: '#8e9fa8',
    cyan: '#7fc8cd',
    gold: '#d3b675',
    metal: '#dce1d9',
    beast: '#627e80',
    beastDark: '#425e65',
    spine: '#a5c3c8',
    fox: '#cc8752',
    foxDark: '#945f40',
    green: '#99b99a',
    greenDark: '#6e917e',
    roo: '#b58d65',
    rooDark: '#886a51',
    vest: '#6b8390',
    shell: '#dfdfcc',
    speckle: '#99b8ac',
    crack: '#667f78',
  };
  const rainbow = [P.red, P.orange, P.yellow, P.mint, P.blue, P.purple];
  const key = (x, y, z) => `${x},${y},${z}`;
  function buildDefinition(kind, s) {
    const d = { id: kind + '-' + s, kind, age: s, parts: [], owners: new Map() },
      parts = new Map();
    let current;
    function part(name, pivot, parent = null) {
      const p = { name, pivot, parent, voxels: new Map() };
      parts.set(name, p);
      d.parts.push(p);
      current = p;
    }
    function use(name) {
      current = parts.get(name);
    }
    function box(x, y, z, w, h, depth, color) {
      for (let i = 0; i < w; i++)
        for (let j = 0; j < h; j++)
          for (let k = 0; k < depth; k++) {
            const v = { x: x + i, y: y + j, z: z + k, color },
              id = key(v.x, v.y, v.z),
              previous = d.owners.get(id);
            if (previous) parts.get(previous).voxels.delete(id);
            current.voxels.set(id, v);
            d.owners.set(id, current.name);
          }
    }
    function pair(x, y, z, w, h, depth, color) {
      box(x, y, z, w, h, depth, color);
      box(-x - w, y, z, w, h, depth, color);
    }
    function line(a, b, size, color) {
      const steps = Math.max(...a.map((v, i) => Math.abs(v - b[i]))) * 2;
      let previous = null;
      for (let t = 0; t <= steps; t++) {
        const p = a.map(
          (v, i) => Math.round(v + (b[i] - v) * (steps ? t / steps : 0)) - Math.floor(size / 2)
        );
        if (previous)
          for (let axis = 0; axis < 3; axis++)
            while (previous[axis] !== p[axis]) {
              previous[axis] += Math.sign(p[axis] - previous[axis]);
              box(previous[0], previous[1], previous[2], size, size, size, color);
            }
        box(p[0], p[1], p[2], size, size, size, color);
        previous = [...p];
      }
    }
    if (kind === 'unicorn') {
      const leg = [2, 3, 4][s],
        bw = [4, 5, 6][s],
        bl = [6, 8, 10][s],
        by = leg,
        bh = [3, 3, 4][s],
        bz = -Math.floor(bl / 2),
        front = bz + bl - 2,
        hy = by + bh - 1,
        hh = [3, 4, 4][s];
      part('body', [0, by + 1, 0]);
      box(-Math.floor(bw / 2), by, bz, bw, bh, bl, P.white);
      for (const side of [-1, 1])
        for (const end of ['front', 'back']) {
          const w = s === 2 ? 2 : 1,
            x = side > 0 ? Math.floor(bw / 2) - w : -Math.floor(bw / 2),
            z = end === 'front' ? front : bz + 1,
            name = (side > 0 ? 'right' : 'left') + '-' + end;
          part(name, [x + w / 2, leg, z + 1]);
          box(x, 0, z, w, leg + 1, 2, P.white);
          box(x, 0, z, w, 1, 2, P.pink);
        }
      part('head', [0, hy, front], 'body');
      box(-2, hy, front, 4, hh, 4, P.white);
      box(-2, hy, front + 3, 4, 2, 2, P.cream);
      pair(1, hy + hh, front + 1, 1, [1, 2, 2][s], 1, P.white);
      box(-1, hy + hh, front + 2, 1, s + 1, 1, P.gold);
      for (let i = 0; i < 3 + s; i++) box(-1, hy + hh - i, front - 1, 2, 1, 1, rainbow[i]);
      part('eyes', [0, hy + hh - 1.5, front + 4.5], 'head');
      pair(1, hy + hh - 2, front + 4, 1, 1, 1, P.ink);
      part('tail', [0, by + 1, bz], 'body');
      for (let i = 0; i < 3 + s; i++)
        box(-1, by + 1 - Math.floor(i / 2), bz - i - 1, 2, 2, 1, rainbow[i % 6]);
    }
    if (kind === 'mecha') {
      const leg = 2 + s,
        by = leg + 1,
        bh = 3 + (s > 0 ? 1 : 0),
        bw = 4 + s,
        bd = 3 + (s === 2 ? 1 : 0),
        bz = -Math.floor(bd / 2),
        front = bz + bd,
        hy = by + bh + 1;
      part('body', [0, by + 1, 0]);
      box(-Math.floor(bw / 2), by, bz, bw, bh, bd, P.metal);
      box(-2, by - 1, -1, 4, 2, 3, P.navy);
      box(-1, by + bh, -1, 2, 2, 2, P.navy);
      box(-1, by + 1, front, 2, 2, 1, P.navy);
      box(0, by + 1, front + 1, 1, 1, 1, P.cyan);
      for (const side of [-1, 1]) {
        const x = side > 0 ? 1 : -3;
        part(side > 0 ? 'right-leg' : 'left-leg', [x + 1, leg + 1, 0]);
        box(x, 1, -1, 2, leg + 1, 2, P.navy);
        box(x, 0, -1, 2, 1, 4, P.metal);
        if (s > 0) box(x, leg - 1, 1, 2, 2, 1, P.blue);
        const ax = side > 0 ? Math.floor(bw / 2) : -Math.floor(bw / 2) - 2,
          ay = by + bh - 1;
        part(side > 0 ? 'right-arm' : 'left-arm', [ax + 1, ay, 0], 'body');
        box(ax, ay - 2 - s, -1, 2, 4 + s, 2, P.navy);
        box(ax, ay, -1, 2, 2, 3, P.blue);
        box(ax, ay - 2 - s, 1, 2, 2, 1, P.metal);
        if (s === 2) box(ax, ay, 2, 2, 2, 1, P.gold);
      }
      part('head', [0, hy, 0], 'body');
      box(-2, hy, -1, 4, 3, 3, P.metal);
      box(-2, hy + 2, -1, 4, 1, 3, P.blue);
      if (s > 0) {
        pair(2, hy + 2, 0, 1, 2, 1, P.gold);
        if (s === 2) pair(3, hy + 3, 0, 1, 2, 1, P.gold);
      }
      part('eyes', [0, hy + 1.5, 2.5], 'head');
      box(-1, hy + 1, 2, 2, 1, 1, P.cyan);
    }
    if (kind === 'kaiju') {
      const leg = 2 + s,
        by = leg - 1,
        bh = 5 + s,
        bw = 4 + s,
        bz = -2,
        bd = 4 + s,
        hy = by + bh - 1,
        hd = 4,
        hw = 4 + (s === 2 ? 1 : 0),
        hx = -Math.floor(hw / 2),
        headZ = 1;
      part('body', [0, by + 2, 0]);
      box(-Math.floor(bw / 2), by, bz, bw, bh, bd, P.beast);
      box(-1, by + 1, bz + bd, 2, bh - 2, 1, P.cream);
      for (const side of [-1, 1]) {
        const x = side > 0 ? 1 : -3;
        part(side > 0 ? 'right-leg' : 'left-leg', [x + 1, leg + 1, 0]);
        box(x, 0, -1, 2, leg + 2, 3, P.beastDark);
        box(x, 0, 1, 2, 1, 3, P.beastDark);
        const ax = side > 0 ? Math.floor(bw / 2) : -Math.floor(bw / 2) - 1,
          ay = by + bh - 2;
        part(side > 0 ? 'right-arm' : 'left-arm', [ax + 0.5, ay, 2], 'body');
        box(ax, ay - 2, 2, 1, 3 + s, 2, P.beastDark);
        box(ax, ay - 2, 4, 1, 1, 1, P.cream);
      }
      part('head', [0, hy, headZ], 'body');
      box(hx, hy, headZ, hw, 3 + (s === 2 ? 1 : 0), hd, P.beast);
      box(hx, hy, headZ + 3, hw, 2, 2, P.beast);
      part('jaw', [0, hy, headZ + 3], 'head');
      box(hx, hy - 1, headZ + 2, hw, 1, 3, P.beastDark);
      pair(1, hy, headZ + 4, 1, 1, 1, P.cream);
      part('eyes', [0, hy + 1.5, headZ + 4.5], 'head');
      pair(1, hy + 1, headZ + 4, 1, 1, 1, P.gold);
      part('spines', [0, by + 2, bz], 'body');
      for (let i = 0; i < 3 + s; i++) box(-1, by + i * 2, bz - 1 - (i % 2), 2, 2, 2, P.spine);
      part('tail', [0, by + 1, bz], 'body');
      line([0, by + 1, bz], [0, by, bz - 3 - s], 2, P.beastDark);
      line([0, by, bz - 3 - s], [2, by + 1, bz - 5 - s * 2], s === 0 ? 1 : 2, P.beast);
    }
    if (kind === 'fox') {
      const leg = 1 + s,
        by = leg,
        bw = 4 + (s === 2 ? 1 : 0),
        bl = 5 + s,
        bz = -Math.floor(bl / 2),
        front = bz + bl - 1,
        hy = by + 2,
        hh = 3;
      part('body', [0, by + 1, 0]);
      box(-Math.floor(bw / 2), by, bz, bw, 3, bl, P.fox);
      box(-1, by, front, 2, 2, 1, P.cream);
      for (const side of [-1, 1])
        for (const end of ['front', 'back']) {
          const x = side > 0 ? 1 : -2,
            z = end === 'front' ? front - 1 : bz;
          part((side > 0 ? 'right' : 'left') + '-' + end, [x + 0.5, leg, z + 0.5]);
          box(x, 0, z, 1, leg + 1, 2, P.foxDark);
        }
      part('head', [0, hy, front], 'body');
      box(-2, hy, front, 4, hh, 3, P.fox);
      box(-2, hy, front + 2, 4, 2, 2, P.cream);
      box(-1, hy + 1, front + 4, 2, 1, 1, P.ink);
      pair(1, hy + hh, front, 1, 2 + (s === 2 ? 1 : 0), 1, P.foxDark);
      part('eyes', [0, hy + 2.5, front + 3.5], 'head');
      pair(1, hy + 2, front + 3, 1, 1, 1, P.ink);
      const count = [3, 6, 9][s];
      d.tailCount = count;
      for (let i = 0; i < count; i++) {
        const x = Math.round((i - (count - 1) / 2) * 2),
          ty = by + 5 + s * 2 - Math.round(Math.abs(x) * 0.32),
          tz = bz - 4 - s - (i % 2),
          base = [0, by + 1, bz];
        part('tail-' + i, base, 'body');
        line(base, [Math.round(x * 0.5), by + 3, Math.round((bz + tz) / 2)], 1, P.fox);
        line([Math.round(x * 0.5), by + 3, Math.round((bz + tz) / 2)], [x, ty, tz], 1, P.fox);
        box(x, ty - 1, tz, 1, 3, 1, P.cream);
      }
    }
    if (kind === 'alien') {
      const leg = 2 + s,
        by = leg + 1,
        bh = 2 + s,
        hy = by + bh + 1,
        hw = 6 + (s === 2 ? 2 : 0),
        hx = -hw / 2,
        hh = 4 + (s === 2 ? 1 : 0),
        hd = 4;
      part('body', [0, by + 1, 0]);
      box(-1, by, -1, 2, bh, 3, P.greenDark);
      box(-1, by + 1, 2, 2, 1, 1, P.gold);
      box(-1, by + bh, -1, 2, 2, 2, P.greenDark);
      for (const side of [-1, 1]) {
        const x = side > 0 ? 1 : -2;
        part(side > 0 ? 'right-leg' : 'left-leg', [x + 0.5, leg + 1, 0]);
        box(x, 0, 0, 1, leg + 2, 1, P.greenDark);
        box(x, 0, 0, 1, 1, 2, P.green);
        const ax = side > 0 ? 1 : -2,
          ay = by + bh - 1;
        part(side > 0 ? 'right-arm' : 'left-arm', [ax + 0.5, ay, 0], 'body');
        box(ax, ay - 2 - s, 0, 1, 3 + s, 1, P.green);
        box(ax, ay - 2 - s, 1, 1, 2, 1, P.green);
      }
      part('head', [0, hy, 0], 'body');
      box(hx, hy, -1, hw, hh, hd, P.green);
      pair(hw / 2, hy + 1, 0, 1, 2, 1, P.greenDark);
      pair(1, hy + hh, 0, 1, s, 1, P.greenDark);
      if (s > 0) pair(1, hy + hh + s, 0, 1, 1, 1, P.gold);
      part('eyes', [0, hy + hh / 2, 3.5], 'head');
      pair(1, hy + 1, 3, 2, 2, 1, P.ink);
    }
    if (kind === 'kangaroo') {
      const leg = 2 + s,
        by = leg,
        bh = 4 + s,
        bw = 3 + s,
        bz = -2,
        bd = 4,
        hy = by + bh - 1,
        front = 2,
        hh = 3;
      part('body', [0, by + 1, 0]);
      box(-Math.floor(bw / 2), by, bz, bw, bh, bd, P.roo);
      box(-1, by + 1, front, 2, 1 + s, 1, P.cream);
      if (s > 0) {
        pair(1, by + 1, front, 1, bh - 1, 1, P.vest);
        if (s === 2) pair(0, by + bh - 1, front + 1, 1, 1, 1, P.ink);
      }
      for (const side of [-1, 1]) {
        const x = side > 0 ? 1 : -3;
        part(side > 0 ? 'right-leg' : 'left-leg', [x + 1, leg + 1, 0]);
        box(x, 0, -1, 2, leg + 2, 2, P.rooDark);
        box(x, 0, 0, 2, 1, 3 + s, P.rooDark);
        const ax = side > 0 ? Math.ceil(bw / 2) : -Math.floor(bw / 2) - 1,
          ay = by + bh - 2;
        part(side > 0 ? 'right-arm' : 'left-arm', [ax + 0.5, ay, 1], 'body');
        box(ax, ay - 2, 1, 1, 3, 1, P.rooDark);
        box(ax, ay - 2, 2, 1, 1, 1, P.cream);
      }
      part('head', [0, hy, front], 'body');
      box(-2, hy, front, 4, hh, 3, P.roo);
      box(-2, hy, front + 2, 4, 2, 2, P.cream);
      box(-1, hy + 1, front + 4, 2, 1, 1, P.rooDark);
      pair(1, hy + hh, front, 1, 2 + s, 1, P.rooDark);
      part('eyes', [0, hy + 2.5, front + 3.5], 'head');
      pair(1, hy + 2, front + 3, 1, 1, 1, P.ink);
      if (s === 2) {
        part('hat', [0, hy + hh, front + 1], 'head');
        box(-2, hy + hh, front, 4, 1, 3, P.ink);
        box(-1, hy + hh + 1, front, 2, 2, 2, P.ink);
      }
      part('tail', [0, by + 1, bz], 'body');
      line([0, by + 1, bz], [0, 1, bz - 3 - s * 2], 2, P.rooDark);
    }
    d.voxels = new Map();
    for (const p of d.parts) for (const [id, v] of p.voxels) d.voxels.set(id, v);
    const values = Array.from(d.voxels.values());
    d.min = [0, 1, 2].map((a) => Math.min(...values.map((v) => [v.x, v.y, v.z][a])));
    d.max = [0, 1, 2].map((a) => Math.max(...values.map((v) => [v.x, v.y, v.z][a])) + 1);
    d.center = d.min.map((v, i) => (v + d.max[i]) / 2);
    d.height = d.max[1] - d.min[1];
    return d;
  }
  const definitions = families.flatMap((f) => [0, 1, 2].map((s) => buildDefinition(f.id, s)));
  const egg = new Map(),
    cracked = new Map(),
    shells = [new Map(), new Map(), new Map()];
  for (let x = -6; x < 6; x++)
    for (let y = 0; y < 14; y++)
      for (let z = -6; z < 6; z++) {
        const fy = (y + 0.5 - 7) / 7,
          r = 5.3 - fy * 0.8,
          iy = (y + 0.5 - 7) / 5.7,
          ir = 4.1 - iy * 0.8;
        if (
          ((x + 0.5) / r) ** 2 + fy * fy + ((z + 0.5) / r) ** 2 > 1 ||
          ((x + 0.5) / ir) ** 2 + iy * iy + ((z + 0.5) / ir) ** 2 < 1
        )
          continue;
        const color =
          (x - 2) ** 2 + (y - 9) ** 2 + (z - 3) ** 2 < 4 ||
          (x + 3) ** 2 + (y - 4) ** 2 + (z - 2) ** 2 < 4
            ? P.speckle
            : P.shell;
        egg.set(key(x, y, z), { x, y, z, color });
      }
  const directions = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const regions = new Map(
    Array.from(egg, ([id, v]) => [
      id,
      v.y >= 8 + (Math.floor((v.x + v.z + 24) / 2) % 2)
        ? 2
        : v.x >= Math.floor((v.y + v.z + 24) / 2) % 2
          ? 1
          : 0,
    ])
  );
  const region = (v) => regions.get(key(v.x, v.y, v.z));
  for (const [id, v] of egg) {
    const neighbors = directions
      .map(([x, y, z]) => egg.get(key(v.x + x, v.y + y, v.z + z)))
      .filter(Boolean);
    if (!neighbors.some((n) => region(n) === region(v))) regions.set(id, region(neighbors[0]));
  }
  for (const [id, v] of egg) {
    const part = region(v),
      seam = directions.some(([x, y, z]) => {
        const n = egg.get(key(v.x + x, v.y + y, v.z + z));
        return n && region(n) < part;
      });
    const next = { ...v, color: seam ? P.crack : v.color };
    cracked.set(id, next);
    shells[part].set(id, next);
  }
  const smooth = (a, b, t) => {
    const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return u * u * u * (u * (u * 6 - 15) + 10);
  };
  const durations = { hatch: 2600, grow: 2600, action: 1400 };
  function growthPhase(t) {
    return t <= 0.5
      ? { step: 0, amount: smooth(0.06, 0.44, t) }
      : { step: 1, amount: smooth(0.56, 0.94, t) };
  }
  function growthTracks(from, to) {
    const position = (v, d) => [
      v.x + 0.5 - d.center[0],
      v.y + 0.5 - d.min[1],
      v.z + 0.5 - d.center[2],
    ];
    const bounds = (cells) =>
      [0, 1, 2].map((a) => [
        Math.min(...cells.map((v) => v.p[a])),
        Math.max(...cells.map((v) => v.p[a])),
      ]);
    const sample = (part, d) =>
      Array.from(part.voxels.values(), (v) => ({ p: position(v, d), color: v.color }));
    const project = (p, a, b) =>
      p.map(
        (v, i) => b[i][0] + ((v - a[i][0]) / Math.max(1, a[i][1] - a[i][0])) * (b[i][1] - b[i][0])
      );
    const distance = (a, b) => a.reduce((n, v, i) => n + (v - b[i]) ** 2, 0);
    const tracks = [],
      names = new Set([...from.parts, ...to.parts].map((p) => p.name));
    for (const name of names) {
      const pa = from.parts.find((p) => p.name === name),
        pb = to.parts.find((p) => p.name === name);
      const a = pa ? sample(pa, from) : [],
        b = pb ? sample(pb, to) : [];
      const add = (v, w, sa, sb) =>
        tracks.push({
          part: name,
          a: v.p,
          b: w.p,
          ca: v.color,
          cb: w.color,
          sa,
          sb,
          delay:
            name === 'hat'
              ? 0.16
              : name.startsWith('tail')
                ? 0.1
                : name === 'head' || name === 'eyes'
                  ? 0.06
                  : 0,
        });
      if (a.length && b.length) {
        const ba = bounds(a),
          bb = bounds(b),
          small = a.length <= b.length ? a : b,
          large = a.length <= b.length ? b : a,
          used = new Set(),
          forward = a.length <= b.length;
        for (const v of small) {
          const target = project(v.p, forward ? ba : bb, forward ? bb : ba);
          let best = -1,
            score = Infinity;
          for (let i = 0; i < large.length; i++)
            if (!used.has(i)) {
              const n = distance(target, large[i].p) + (v.color === large[i].color ? 0 : 0.4);
              if (n < score) {
                score = n;
                best = i;
              }
            }
          used.add(best);
          if (forward) add(v, large[best], 1, 1);
          else add(large[best], v, 1, 1);
        }
        for (let i = 0; i < large.length; i++)
          if (!used.has(i)) {
            const v = large[i],
              target = project(v.p, forward ? bb : ba, forward ? ba : bb);
            const anchor = small.reduce((best, p) =>
              distance(p.p, target) < distance(best.p, target) ? p : best
            );
            if (forward) add(anchor, v, 0, 1);
            else add(v, anchor, 1, 0);
          }
      } else {
        const growing = !!b.length,
          existing = growing ? from : to,
          destination = growing ? to : from,
          part = growing ? pb : pa;
        const parent =
          existing.parts.find((p) => p.name === part.parent) ||
          existing.parts.find((p) => p.name === 'body');
        const anchors = sample(parent, existing),
          wholeA = Array.from(destination.voxels.values(), (v) => ({
            p: position(v, destination),
          })),
          wholeB = Array.from(existing.voxels.values(), (v) => ({ p: position(v, existing) }));
        const ba = bounds(wholeA),
          bb = bounds(wholeB);
        for (const v of growing ? b : a) {
          const target = project(v.p, ba, bb),
            anchor = anchors.reduce((best, p) =>
              distance(p.p, target) < distance(best.p, target) ? p : best
            );
          if (growing) add(anchor, v, 0, 1);
          else add(v, anchor, 1, 0);
        }
      }
    }
    return { kind: from.kind, step: from.age, tracks };
  }
  const transitions = families.flatMap((f) =>
    [0, 1].map((s) =>
      growthTracks(
        definitions.find((d) => d.kind === f.id && d.age === s),
        definitions.find((d) => d.kind === f.id && d.age === s + 1)
      )
    )
  );
  function growthCell(track, amount) {
    const u = smooth(track.delay, 1, amount);
    const scale =
      track.sa === track.sb
        ? 1 + 0.08 * Math.sin(Math.PI * u)
        : track.sa === 0
          ? smooth(0, 0.68, u)
          : 1 - smooth(0.32, 1, u);
    const p = track.a.map((v, i) => v + (track.b[i] - v) * u);
    p[1] = Math.max(scale / 2, p[1]);
    return { p, scale, u };
  }

  return {
    families,
    P,
    definitions,
    egg,
    cracked,
    shells,
    smooth,
    durations,
    growthPhase,
    transitions,
    growthCell,
    key,
  };
}

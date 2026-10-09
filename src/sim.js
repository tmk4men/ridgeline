// RIDGELINE のロジック。three に依存しない。固定60Hzで進める。
// 地形・木・廃屋・弾道（重力・空気抵抗・風）・視認（見通し・距離・姿勢・動き）・敵の狙撃手 CPU

export const STEP = 1 / 60
export const HALF = 800              // 戦える範囲は 1.6km 四方
export const G = 9.81
export const LADDER = { up: 3.0, down: 4.0, reach: 0.9 } // はしご: 登る・降りる速さ（m/s）、取り付ける距離
export const WEATHER_VIS = { clear: 1, haze: 0.72, overcast: 0.9 } // 天気ごとの見える距離の倍率
export const JUMP_V = 3.3              // 跳ぶ速さ（約0.55m の高さ。主要FPSの小さな跳び上がりと同じくらい）
export const MUZZLE_V = 820          // 銃口初速 m/s
export const DRAG = 0.12             // 空気抵抗（速度に比例。1秒で約1割落ちる）
export const SOUND_V = 343           // 音速
export const BOLT_T = 1.4            // ボルトを引いて次弾を込める時間
export const MAG = 5                 // 弾倉
export const RELOAD_T = 3.2
export const RELOAD_START = 0.5, RELOAD_ROUND = 0.6 // 装填: 構え直しに0.5秒、そのあと1発0.6秒ずつ込める（途中で撃てる）
export const ZERO_MIN = 100, ZERO_MAX = 800, ZERO_STEP = 50
export const EYE = { stand: 1.62, crouch: 1.05, prone: 0.32 }
export const SPEED = { stand: 3.6, crouch: 1.8, prone: 0.7, sprint: 6.2 }
export const SWAY = { stand: 0.0032, crouch: 0.0018, prone: 0.0007 } // 呼吸で揺れる量（rad）
export const BREATH_MAX = 6          // 息を止めていられる秒数
export const PLAYER_HP = 100
export const DMG = { head: 100, body: 60 }
export const ENEMY_N = 6
// 安全地帯: 一定時間ごとに円が縮む。外にいると EN（体力）が減る
export const ZONE = { first: 45, wait: 40, shrink: 20, ratio: 0.62, minR: 70, dps: 4 }

// ---------------------------------------------------------------- 乱数とノイズ
export function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 }
function hash(i, j, seed) { let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
function vnoise(x, z, seed) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  const a = hash(i, j, seed), b = hash(i + 1, j, seed), c = hash(i, j + 1, seed), d = hash(i + 1, j + 1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
export function fbm(x, z, seed, oct = 5) { let s = 0, a = 0.5, f = 1; for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, z * f, seed + o * 17); f *= 2.03; a *= 0.5 } return s }

// ---------------------------------------------------------------- 地形
// 谷を挟んで東西に尾根が走り、外周は山で囲む。中央の谷底に小川の跡と廃村
const TSEED = 4242
export let STAGE = 'valley'
export function heightAt(x, z) { return STAGE === 'city' ? cityHeight(x, z) : valleyHeight(x, z) }
function cityHeight(x, z) { return 6 + fbm(x / 700, z / 700, 77, 3) * 10 + Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - 560) ** 1.4 * 0.04 }
function valleyHeight(x, z) {
  const base = fbm(x / 520, z / 520, TSEED) * 70
  const ridge = Math.pow(1 - Math.abs(2 * fbm(x / 260 + 7, z / 260 - 3, TSEED + 9, 4) - 1), 2) * 38 // 尾根筋
  const valley = Math.exp(-((x + 40 * Math.sin(z / 230)) ** 2) / (2 * 150 * 150)) * 46            // 南北に走る谷
  const rim = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - 640) ** 1.5 * 0.022                 // 外周の山（端まで行くと約45m）
  return Math.max(0, base + ridge - valley + rim + 8)
}
export function slopeAt(x, z) { const e = 2; return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e) }

// ---------------------------------------------------------------- 木・岩・廃屋（決まった配置。描画と当たりで共有）
function buildWorld() {
  const r = rng(777)
  const trees = []
  for (let k = 0; k < 30000 && trees.length < 3600; k++) {
    const x = (r() * 2 - 1) * (HALF - 10), z = (r() * 2 - 1) * (HALF - 10)
    const forest = fbm(x / 160, z / 160, 99, 3)
    if (forest < 0.43 + r() * 0.08) continue
    if (slopeAt(x, z) > 0.75) continue
    const h = 9 + r() * 9
    trees.push({ x, z, y: heightAt(x, z), h, r: 1.6 + r() * 1.4, kind: r() < 0.7 ? 'pine' : 'broad' })
  }
  const rocks = []
  for (let k = 0; k < 600; k++) {
    const x = (r() * 2 - 1) * (HALF - 10), z = (r() * 2 - 1) * (HALF - 10)
    if (slopeAt(x, z) < 0.35 && r() < 0.7) continue
    const s = 0.8 + r() * 2.6
    rocks.push({ x, z, y: heightAt(x, z), s })
  }
  // 廃屋: 谷底の村と、尾根の見張り小屋。壁は弾も視線も止める
  const huts = []
  const place = (cx, cz, n, spread) => {
    for (let i = 0; i < n; i++) {
      const x = cx + (r() * 2 - 1) * spread, z = cz + (r() * 2 - 1) * spread
      if (huts.some(h => Math.abs(h.x - x) < 14 && Math.abs(h.z - z) < 14)) continue
      const w = 6 + Math.floor(r() * 3) * 2, d = 5 + Math.floor(r() * 3) * 2
      huts.push({ x, z, w, d, y: Math.min(heightAt(x - w / 2, z - d / 2), heightAt(x + w / 2, z + d / 2), heightAt(x, z)), h: 3.2 + r() * 1.5, ruin: r() < 0.5 })
    }
  }
  place(-30, 40, 9, 70); place(60, -260, 4, 40); place(-320, 380, 3, 30); place(360, 420, 3, 30)
  return finishWorld({ trees, rocks, huts, buildings: [], boxes: huts.map(h => ({ x: h.x, z: h.z, w: h.w, d: h.d, y: h.y - 1, h: h.h + 1 })) })
}
// 市街地: 60m の街区に建物を並べる。屋上は平らで、縁に手すり壁（1m）。建物は弾も視線も通さない
function buildCity() {
  const r = rng(909)
  const trees = [], rocks = [], huts = [], buildings = []
  const B = 64, ST = 16 // 街区の間隔と道路の幅
  for (let gx = -8; gx <= 8; gx++) for (let gz = -8; gz <= 8; gz++) {
    const cx = gx * B, cz = gz * B
    if (Math.max(Math.abs(cx), Math.abs(cz)) > 520) continue
    if (r() < 0.12) { // 公園: 木を植える
      for (let i = 0; i < 6; i++) { const x = cx + (r() - 0.5) * (B - ST - 6), z = cz + (r() - 0.5) * (B - ST - 6); trees.push({ x, z, y: heightAt(x, z), h: 8 + r() * 6, r: 1.8 + r() * 1.2, kind: 'broad' }) }
      continue
    }
    const inner = B - ST
    const n = r() < 0.5 ? 1 : 2
    for (let i = 0; i < n; i++) {
      const w = n === 1 ? inner - 4 - r() * 8 : inner / 2 - 3, d = inner - 4 - r() * 10
      const x = n === 1 ? cx : cx + (i ? 1 : -1) * (inner / 4 + 0.5), z = cz
      const center = 1 - Math.min(1, Math.hypot(cx, cz) / 520)
      const floors = 2 + Math.floor(r() * (4 + center * 10))
      const y = Math.min(heightAt(x - w / 2, z - d / 2), heightAt(x + w / 2, z + d / 2), heightAt(x - w / 2, z + d / 2), heightAt(x + w / 2, z - d / 2)) - 0.5
      const h = floors * 3.2 + 0.5
      buildings.push({ x, z, w, d, y, h, floors, tint: r() })
    }
  }
  // 箱: 建物本体と、屋上の縁の手すり壁（外を見張れる高さ。伏せると隠れる）
  const boxes = []
  for (const b of buildings) {
    boxes.push({ x: b.x, z: b.z, w: b.w, d: b.d, y: b.y, h: b.h })
    const top = b.y + b.h, t = 0.35, ph = 0.9 // しゃがむと目（1.05m）が出て、伏せると隠れる高さ
    boxes.push({ x: b.x, z: b.z + b.d / 2 - t / 2, w: b.w, d: t, y: top, h: ph, wall: true }, { x: b.x, z: b.z - b.d / 2 + t / 2, w: b.w, d: t, y: top, h: ph, wall: true },
      { x: b.x + b.w / 2 - t / 2, z: b.z, w: t, d: b.d, y: top, h: ph, wall: true }, { x: b.x - b.w / 2 + t / 2, z: b.z, w: t, d: b.d, y: top, h: ph, wall: true })
  }
  // はしご: 建物ごとに1本、道路に面した長い壁（±z 側）の外に付ける。地面から屋上の縁まで
  const ladders = []
  for (const [bi, b] of buildings.entries()) {
    const nz = r() < 0.5 ? 1 : -1, x = b.x + (r() * 2 - 1) * Math.max(0, b.w / 2 - 3), z = b.z + nz * b.d / 2
    ladders.push({ x, z, nx: 0, nz, y0: heightAt(x, z + nz * 0.6), top: b.y + b.h, b: bi })
  }
  for (let i = 0; i < 300; i++) { const x = (r() * 2 - 1) * 520, z = (r() * 2 - 1) * 520; if (boxes.some(b => Math.abs(x - b.x) < b.w / 2 + 2 && Math.abs(z - b.z) < b.d / 2 + 2)) continue; if (r() < 0.6) trees.push({ x, z, y: heightAt(x, z), h: 6 + r() * 4, r: 1.4 + r() * 0.8, kind: 'broad' }); else rocks.push({ x, z, y: heightAt(x, z), s: 0.8 + r() * 0.8, car: true, yaw: r() * 3 }) }
  return finishWorld({ trees, rocks, huts, buildings, boxes, ladders })
}
function finishWorld(w) {
  const CELL = 40, grid = new Map(), bgrid = new Map()
  for (const [i, t] of w.trees.entries()) { const key = Math.floor(t.x / CELL) + ',' + Math.floor(t.z / CELL); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(i) }
  // 箱の格子（箱が掛かるマスすべてに入れる）
  for (const [i, b] of w.boxes.entries()) for (let gx = Math.floor((b.x - b.w / 2) / CELL); gx <= Math.floor((b.x + b.w / 2) / CELL); gx++) for (let gz = Math.floor((b.z - b.d / 2) / CELL); gz <= Math.floor((b.z + b.d / 2) / CELL); gz++) { const key = gx + ',' + gz; if (!bgrid.has(key)) bgrid.set(key, []); bgrid.get(key).push(i) }
  return { ladders: [], ...w, grid, bgrid, CELL }
}
const WORLDS = {}
export let WORLD = null
export function setStage(k) {
  STAGE = k === 'city' ? 'city' : 'valley'
  if (!WORLDS[STAGE]) WORLDS[STAGE] = STAGE === 'city' ? buildCity() : buildWorld()
  WORLD = WORLDS[STAGE]
  return WORLD
}
setStage('valley')
const nearTrees = (x, z) => WORLD.grid.get(Math.floor(x / WORLD.CELL) + ',' + Math.floor(z / WORLD.CELL)) || []
// その場所が木の陰（樹冠の下）か: 見つかりにくくなる
export function concealment(x, z) {
  let c = 0
  for (const i of nearTrees(x, z)) { const t = WORLD.trees[i], d = Math.hypot(t.x - x, t.z - z); if (d < t.r * 1.3) c = Math.max(c, 1 - d / (t.r * 1.3)) }
  return c
}
const nearBoxes = (x, z) => WORLD.bgrid.get(Math.floor(x / WORLD.CELL) + ',' + Math.floor(z / WORLD.CELL)) || []
function inHut(x, y, z) { for (const i of nearBoxes(x, z)) { const b = WORLD.boxes[i]; if (y < b.y + b.h && y > b.y && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return b } return null }
// 立てる高さ: 地面か、足元より下にある屋上・箱の上面のうち一番高いもの
export function supportAt(x, z, y) {
  let g = heightAt(x, z)
  for (const i of nearBoxes(x, z)) { const b = WORLD.boxes[i], top = b.y + b.h; if (top > g && top <= y + 0.6 && Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) g = top }
  return g
}
// 線分が箱を横切るか（薄い手すり壁も見落とさない）
function segBox(ax, ay, az, bx, by, bz, b) {
  const o = [ax, ay, az], d = [bx - ax, by - ay, bz - az], mn = [b.x - b.w / 2, b.y, b.z - b.d / 2], mx = [b.x + b.w / 2, b.y + b.h, b.z + b.d / 2]
  let t0 = 0, t1 = 1
  for (let i = 0; i < 3; i++) { if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return -1; continue } let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i]; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return -1 }
  return t0
}
function segHitsBoxes(ax, ay, az, bx, by, bz) {
  const seen = new Set(); let best = -1, bb = null
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (WORLD.CELL * 0.5)))
  for (let k = 0; k <= n; k++) { const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n
    for (const i of nearBoxes(x, z)) { if (seen.has(i)) continue; seen.add(i); const t = segBox(ax, ay, az, bx, by, bz, WORLD.boxes[i]); if (t >= 0 && (best < 0 || t < best)) { best = t; bb = WORLD.boxes[i] } } }
  return best < 0 ? null : { t: best, b: bb }
}

// 見通し: 地形・樹冠・幹・廃屋の壁がさえぎる。dens は樹冠を何割で通すか（0=全部さえぎる）
export function lineOfSight(ax, ay, az, bx, by, bz, foliage = 0.35) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz)
  if (segHitsBoxes(ax, ay, az, bx, by, bz)) return 0
  const n = Math.max(2, Math.ceil(len / 3))
  let thru = 1
  const seen = new Set()
  for (let i = 1; i < n; i++) {
    const t = i / n, x = ax + dx * t, y = ay + dy * t, z = az + dz * t
    if (y < heightAt(x, z) + 0.15) return 0
    for (const k of nearTrees(x, z)) {
      if (seen.has(k)) continue
      const tr = WORLD.trees[k], hd = Math.hypot(tr.x - x, tr.z - z)
      if (hd < 0.35 && y < tr.y + tr.h * 0.6) return 0 // 幹
      const cy = tr.y + tr.h * 0.62, rr = tr.r * (tr.kind === 'pine' ? 0.9 : 1.15)
      if (hd < rr && Math.abs(y - cy) < tr.h * 0.42) { seen.add(k); thru *= foliage } // 樹冠（葉の間から少し見える）
    }
    if (thru < 0.05) return 0
  }
  return thru
}

// ---------------------------------------------------------------- 弾道
// 撃つ向き（yaw, pitch）とゼロイン距離から、実際に弾を出す仰角の上乗せを求める（風なし・平地で、その距離で照準の高さに戻る角度）
const zeroCache = new Map()
export function zeroAngle(dist) {
  if (zeroCache.has(dist)) return zeroCache.get(dist)
  let lo = 0, hi = 0.02
  for (let it = 0; it < 30; it++) {
    const m = (lo + hi) / 2
    let x = 0, y = 0, vx = Math.cos(m) * MUZZLE_V, vy = Math.sin(m) * MUZZLE_V
    const dt = 1 / 600
    while (x < dist) { vx -= DRAG * vx * dt; vy -= (G + DRAG * vy) * dt; x += vx * dt; y += vy * dt }
    if (y > 0) hi = m; else lo = m
  }
  zeroCache.set(dist, (lo + hi) / 2)
  return (lo + hi) / 2
}
// 弾を1ステップ進める（細かく刻む）。当たりを返す
function stepBullet(st, b) {
  const sub = 8, dt = STEP / sub
  for (let s = 0; s < sub; s++) {
    const ox = b.x, oy = b.y, oz = b.z
    const rvx = b.vx - st.wind.x, rvz = b.vz - st.wind.z // 空気に対する速さで抵抗を受ける（風に流される）
    b.vx -= DRAG * rvx * dt; b.vz -= DRAG * rvz * dt; b.vy -= (G + DRAG * b.vy) * dt
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.t += dt
    b.dist += Math.hypot(b.x - ox, b.y - oy, b.z - oz)
    // 人に当たったか（頭は球、胴は縦の線分）
    for (const u of st.units) {
      if (!u.alive || u.id === b.owner) continue
      const hit = hitUnit(u, ox, oy, oz, b.x, b.y, b.z)
      if (hit) return { kind: 'unit', u, part: hit.part, x: hit.x, y: hit.y, z: hit.z }
    }
    if (b.y < heightAt(b.x, b.z)) return { kind: 'ground', x: b.x, y: heightAt(b.x, b.z), z: b.z }
    const hb = segHitsBoxes(ox, oy, oz, b.x, b.y, b.z); if (hb) return { kind: 'hut', x: ox + (b.x - ox) * hb.t, y: oy + (b.y - oy) * hb.t, z: oz + (b.z - oz) * hb.t }
    for (const k of nearTrees(b.x, b.z)) { const t = WORLD.trees[k]; if (Math.hypot(t.x - b.x, t.z - b.z) < 0.35 && b.y < t.y + t.h * 0.6) return { kind: 'tree', x: b.x, y: b.y, z: b.z } }
    if (Math.abs(b.x) > HALF + 200 || Math.abs(b.z) > HALF + 200 || b.t > 4) return { kind: 'lost' }
  }
  return null
}
// 線分と人の当たり。頭: 中心は目の高さ＋5cm・半径13cm。胴: 足元〜肩の線分・半径28cm（伏せは地面に沿って寝る）
function segPointDist(ax, ay, az, bx, by, bz, px, py, pz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz || 1
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2))
  return { d: Math.hypot(ax + dx * t - px, ay + dy * t - py, az + dz * t - pz), t }
}
export function bodyPoints(u) {
  const e = EYE[u.stance]
  if (u.stance === 'prone') {
    const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw)
    return { head: [u.x + fx * 0.35, u.y + e, u.z + fz * 0.35], a: [u.x - fx * 1.3, u.y + 0.2, u.z - fz * 1.3], b: [u.x + fx * 0.1, u.y + 0.25, u.z + fz * 0.1] }
  }
  return { head: [u.x, u.y + e + 0.05, u.z], a: [u.x, u.y + 0.1, u.z], b: [u.x, u.y + e - 0.22, u.z] }
}
function hitUnit(u, ax, ay, az, bx, by, bz) {
  const p = bodyPoints(u)
  const hh = segPointDist(ax, ay, az, bx, by, bz, ...p.head)
  if (hh.d < 0.13) return { part: 'head', x: ax + (bx - ax) * hh.t, y: ay + (by - ay) * hh.t, z: az + (bz - az) * hh.t }
  // 胴: 弾の線分と胴の線分の最短距離（細かく刻んであるので弾側の点で近似）
  for (let i = 0; i <= 6; i++) {
    const t = i / 6, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t
    if (segPointDist(...p.a, ...p.b, x, y, z).d < 0.28) return { part: 'body', x, y, z }
  }
  return null
}

// ---------------------------------------------------------------- 状態
const ENEMY_NAMES = ['アルファ', 'ブラボー', 'チャーリー', 'デルタ', 'エコー', 'フォックス']
export function createState(seed = Date.now(), opts = {}) {
  const r = rng(seed)
  const st = {
    rand: r, t: 0, phase: 'play', result: null,
    wind: { x: 0, z: 0, speed: 0, dir: 0 }, windT: 0,
    units: [], bullets: [], events: [], stats: { shots: 0, hits: 0, kills: 0, longest: 0, headshots: 0 },
    enemyN: opts.enemies ?? ENEMY_N, difficulty: opts.difficulty ?? 1, noZone: !!opts.noZone,
    weather: opts.weather ?? ['clear', 'clear', 'haze', 'overcast'][Math.floor(hash(seed, 3, 1) * 4)], // 試合ごとの天気（乱数の並びは変えない）
  }
  setStage(opts.stage)
  st.stage = STAGE
  st.zone = { x: 0, z: 0, r: STAGE === 'city' ? 760 : 1150, from: null, to: null, t: ZONE.first, phase: 'wait', stage: 0 } // 最初は全域
  setWind(st, true)
  // 自分: 谷は南の尾根の上。市街地は南の中くらいの高さの建物の屋上
  const ps = STAGE === 'city' ? roofSpot(st, b => b.z < -200 && b.z > -330 && Math.abs(b.x) < 260 && b.h > 10 && b.h < 30) : findSpot(st, 0, -560, 120, s => s.h)
  st.units.push(makeUnit(0, ps.x, ps.z, true, 'あなた'))
  st.units[0].y = supportAt(ps.x, ps.z, 999)
  st.units[0].yaw = 0
  // 敵: 自分から350m 以上離れた高い所・木の近くに散らす
  const spots = []
  for (let i = 0; i < st.enemyN; i++) {
    let best = null
    for (let k = 0; k < 60; k++) {
      const x = (r() * 2 - 1) * (HALF - 80), z = -400 + r() * (HALF - 80 + 400)
      const dd = Math.hypot(x - ps.x, z - ps.z)
      if (dd < 350 || dd > 750 || spots.some(s => Math.hypot(s.x - x, s.z - z) < 140)) continue
      if (STAGE === 'city') {
        // 市街地: 屋上（7割）か通り
        let rx = x, rz = z
        const roof = WORLD.buildings.filter(b => Math.abs(b.x - x) < b.w / 2 - 1.5 && Math.abs(b.z - z) < b.d / 2 - 1.5)[0]
        if (!roof && (inHut(x, heightAt(x, z) + 1, z) || r() < 0.7)) continue
        // 屋上なら、自分の側の縁まで寄せる（手すり壁越しに見張る）
        if (roof) { const sz = Math.sign(ps.z - roof.z) || -1; rz = roof.z + sz * (roof.d / 2 - 1.2) }
        const ey = (roof ? roof.y + roof.h : heightAt(rx, rz)) + EYE.crouch
        const view = lineOfSight(rx, ey, rz, ps.x, supportAt(ps.x, ps.z, 999) + 1.5, ps.z, 1) > 0.5 ? 40 : 0
        const sc = (roof ? roof.h * 0.4 : 0) + view + r() * 20
        if (!best || sc > best.sc) best = { x: rx, z: rz, sc }
        continue
      }
      if (slopeAt(x, z) > 0.55 || inHut(x, heightAt(x, z) + 1, z)) continue
      const sc = heightAt(x, z) * 0.6 + concealment(x, z) * 30 + r() * 20
      if (!best || sc > best.sc) best = { x, z, sc }
    }
    if (!best) best = { x: (r() * 2 - 1) * 400, z: 200 + r() * 400 }
    spots.push(best)
    const e = makeUnit(i + 1, best.x, best.z, false, ENEMY_NAMES[i % ENEMY_NAMES.length])
    e.y = supportAt(e.x, e.z, 999)
    e.stance = STAGE === 'city' ? 'crouch' : r() < 0.6 ? 'prone' : 'crouch' // 市街地の屋上は手すり壁越しにしゃがんで見張る
    e.yaw = Math.atan2(ps.x - e.x, ps.z - e.z) + (r() - 0.5) * 1.6
    e.ai = { awareness: 0, aimT: -1, cool: 2 + r() * 4, lastKnown: null, moveTo: null, scanYaw: e.yaw, scanT: 0, err: 0, idle: r() * 15 }
    st.units.push(e)
  }
  return st
}
function makeUnit(id, x, z, player, name) {
  return { id, name, player, x, z, y: heightAt(x, z), vx: 0, vz: 0, yaw: 0, pitch: 0, stance: 'stand', hp: PLAYER_HP, alive: true,
    ammo: MAG, boltT: 0, reloadT: 0, breath: BREATH_MAX, holding: false, swayX: 0, swayY: 0, moved: 0, zero: 300, recoil: 0 }
}
function roofSpot(st, pick) {
  const cand = WORLD.buildings.filter(pick)
  const b = cand.length ? cand[Math.floor(st.rand() * cand.length)] : WORLD.buildings[0]
  return { x: b.x + (st.rand() - 0.5) * (b.w - 4), z: b.z + (st.rand() - 0.5) * (b.d - 4) }
}
function findSpot(st, cx, cz, rad, score) {
  let best = { x: cx, z: cz, sc: -1e9 }
  for (let k = 0; k < 80; k++) {
    const x = cx + (st.rand() * 2 - 1) * rad, z = cz + (st.rand() * 2 - 1) * rad
    if (slopeAt(x, z) > 0.5 || inHut(x, heightAt(x, z) + 1, z)) continue
    const sc = score({ h: heightAt(x, z), x, z })
    if (sc > best.sc) best = { x, z, sc }
  }
  return best
}
// 風: 2〜9 m/s、ゆっくり向きと強さが変わる
function setWind(st, first) {
  const r = st.rand
  st.windTarget = { dir: (first ? r() : st.wind.dir / (Math.PI * 2) + (r() - 0.5) * 0.15) * Math.PI * 2, speed: 2 + r() * 7 }
  if (first) { st.wind.dir = st.windTarget.dir; st.wind.speed = st.windTarget.speed }
  st.windT = 25 + r() * 25
}

// ---------------------------------------------------------------- 1ステップ
// input: { mx, mz（自分基準の前後左右）, yaw, pitch, fire, stance('stand'|'crouch'|'prone'|undefined), scoped, hold, sprint, zero(+1/-1), reload }
export function step(st, input = {}) {
  const dt = STEP
  st.t += dt
  // 風
  st.windT -= dt; if (st.windT <= 0) setWind(st)
  st.wind.dir += (st.windTarget.dir - st.wind.dir) * dt * 0.05
  st.wind.speed += (st.windTarget.speed - st.wind.speed) * dt * 0.05
  st.wind.x = Math.sin(st.wind.dir) * st.wind.speed; st.wind.z = Math.cos(st.wind.dir) * st.wind.speed
  if (st.phase === 'play' && !st.noZone) stepZone(st)
  if (st.phase === 'play') {
    stepPlayer(st, st.units[0], input)
    for (const u of st.units) if (!u.player && u.alive) stepEnemy(st, u)
  }
  for (let i = st.bullets.length - 1; i >= 0; i--) {
    const b = st.bullets[i], hit = stepBullet(st, b)
    if (!hit) continue
    st.bullets.splice(i, 1)
    if (hit.kind === 'unit') applyHit(st, b, hit)
    else if (hit.kind !== 'lost') st.events.push({ type: 'impact', kind: hit.kind, x: hit.x, y: hit.y, z: hit.z, owner: b.owner })
    // 敵の弾が自分の近くをかすめた（衝撃波の音）
  }
  // 自分の近くを通る敵弾: かすめた音を出す
  const me = st.units[0]
  for (const b of st.bullets) if (b.owner !== 0 && !b.snapped && Math.hypot(b.x - me.x, b.y - (me.y + 1), b.z - me.z) < 6) { b.snapped = true; st.events.push({ type: 'snap', x: b.x, y: b.y, z: b.z }) }
  if (st.phase === 'play') {
    if (!me.alive) end(st, 'lose')
    else if (st.units.every(u => u.player || !u.alive)) end(st, 'win')
  }
}
function stepZone(st) {
  const z = st.zone, dt = STEP
  z.t -= dt
  if (z.phase === 'wait' && z.t <= 0) {
    // 次の円: 今の円の中に、小さい円を決めて縮み始める
    const nr = Math.max(ZONE.minR, z.r * ZONE.ratio), a = st.rand() * Math.PI * 2, off = st.rand() * (z.r - nr) * 0.8
    const nx = Math.max(-HALF + nr * 0.5, Math.min(HALF - nr * 0.5, z.x + Math.cos(a) * off)), nz = Math.max(-HALF + nr * 0.5, Math.min(HALF - nr * 0.5, z.z + Math.sin(a) * off))
    z.from = { x: z.x, z: z.z, r: z.r }; z.to = { x: nx, z: nz, r: nr }; z.phase = 'shrink'; z.t = ZONE.shrink; z.stage++
    st.events.push({ type: 'zone', phase: 'shrink' })
  } else if (z.phase === 'shrink') {
    const k = 1 - Math.max(0, z.t) / ZONE.shrink
    z.x = z.from.x + (z.to.x - z.from.x) * k; z.z = z.from.z + (z.to.z - z.from.z) * k; z.r = z.from.r + (z.to.r - z.from.r) * k
    if (z.t <= 0) { z.phase = 'wait'; z.t = z.r <= ZONE.minR + 0.1 ? 1e9 : ZONE.wait; z.next = null; st.events.push({ type: 'zone', phase: 'wait' }) }
  }
  // 外にいる者は減る（縮むほど強く）
  for (const u of st.units) {
    if (!u.alive) continue
    u.outside = Math.hypot(u.x - z.x, u.z - z.z) > z.r
    if (!u.outside) continue
    u.hp -= ZONE.dps * (1 + z.stage * 0.5) * dt
    if (u.hp <= 0) { u.alive = false; st.events.push({ type: 'kill', id: u.id, by: -1, part: 'zone', dist: 0 }) }
  }
}
// 敵が向かう先: 安全地帯（次の円が決まっていればその中）
export function zoneTarget(st) { const z = st.zone; return z.phase === 'shrink' ? z.to : z }
function end(st, result) { st.phase = 'over'; st.result = result; st.events.push({ type: 'over', result }) }

function stepPlayer(st, u, input) {
  const dt = STEP
  if (!u.alive) return
  if (input.stance && input.stance !== u.stance) { u.stance = input.stance; u.moved = Math.max(u.moved, 0.6) }
  if (u.ladder != null) { stepLadder(st, u, input); return }
  if (tryLadder(st, u, input)) return
  // ジャンプ: 地面にいるときだけ。しゃがみ・伏せからは立ち上がるだけ（他のFPSと同じ）
  const g0j = supportAt(u.x, u.z, u.y), grounded = u.y <= g0j + 0.05 && !(u.vy > 0)
  if (input.jump && grounded) {
    if (u.stance !== 'stand') { u.stance = 'stand'; u.moved = Math.max(u.moved, 0.6) }
    else { u.vy = JUMP_V; u.y = g0j + 0.06; u.moved = 1; st.events.push({ type: 'jump', id: u.id }) }
  }
  if (input.zero) u.zero = Math.max(ZERO_MIN, Math.min(ZERO_MAX, u.zero + input.zero * ZERO_STEP))
  if (input.yaw !== undefined) u.yaw = input.yaw
  if (input.pitch !== undefined) u.pitch = Math.max(-1.2, Math.min(1.2, input.pitch))
  // 移動（地形に沿う。急な斜面は登れない）
  const sprint = input.sprint && u.stance === 'stand' && !input.scoped
  const sp = sprint ? SPEED.sprint : SPEED[u.stance] * (input.scoped ? 0.5 : 1)
  let mx = input.mx || 0, mz = input.mz || 0
  const m = Math.hypot(mx, mz); if (m > 1) { mx /= m; mz /= m }
  const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw), rx = -fz, rz = fx
  const wx = (fx * -mz + rx * mx) * sp, wz = (fz * -mz + rz * mx) * sp
  const air = u.y > g0j + 0.05 || u.vy > 0, acc = air ? 1.2 : 10 // 空中ではほとんど向きを変えられない
  u.vx += (wx - u.vx) * Math.min(1, dt * acc); u.vz += (wz - u.vz) * Math.min(1, dt * acc)
  const nx = Math.max(-HALF, Math.min(HALF, u.x + u.vx * dt)), nz = Math.max(-HALF, Math.min(HALF, u.z + u.vz * dt))
  const g0 = supportAt(u.x, u.z, u.y), g1 = supportAt(nx, nz, u.y), runLen = Math.hypot(nx - u.x, nz - u.z)
  if (!(runLen > 0 && (g1 - g0) / runLen > 1.1) && !inHut(nx, u.y + 0.7, nz) && !inHut(nx, u.y + 1.4, nz)) { u.x = nx; u.z = nz }
  // 足場: 段差を下りるときは落ちる（屋上から飛び降りられる）
  const g = supportAt(u.x, u.z, u.y)
  if (u.y > g + 0.05 || u.vy > 0) { u.vy = (u.vy || 0) - G * dt; u.y = Math.max(g, u.y + u.vy * dt); if (u.y <= g) { if (u.vy < -2) { u.moved = Math.max(u.moved, Math.min(1, -u.vy / 5)); st.events.push({ type: 'land', id: u.id, v: -u.vy }); if (-u.vy > 9) { u.hp -= (-u.vy - 9) * 9; if (u.hp <= 0) { u.alive = false; st.events.push({ type: 'kill', id: u.id, by: -1, part: 'fall', dist: 0 }) } } } u.vy = 0 } } else { u.y = g; u.vy = 0 }
  u.air = u.y > g + 0.05
  const speed = Math.hypot(u.vx, u.vz)
  u.moved = Math.max(0, Math.max(u.moved - dt * 0.8, speed / SPEED.sprint))
  // 息: スコープ中に押している間止める。尽きたら苦しくて大きく揺れる。離すと戻る
  // 息が切れたら（gasp）、いったん離して2秒ぶん戻るまでは止められない
  if (u.breath <= 0) u.gasp = true
  if (u.gasp && !input.hold && u.breath > 2) u.gasp = false
  u.holding = !!(input.hold && input.scoped && u.breath > 0 && !u.gasp)
  if (u.holding) u.breath = Math.max(0, u.breath - dt)
  else u.breath = Math.min(BREATH_MAX, u.breath + dt * (input.hold ? 0.3 : 1.2))
  // 揺れ: 呼吸（ゆっくりした8の字）＋ 動いた後の乱れ ＋ 撃った後の跳ね上がり
  const base = SWAY[u.stance] * (1 + u.moved * 3) * (u.holding ? 0.12 : u.gasp ? 2.2 : 1)
  const w = st.t * 0.9
  u.swayX = Math.sin(w) * base + Math.sin(st.t * 2.3) * base * 0.25
  u.swayY = Math.sin(w * 2) * base * 0.6 + u.recoil
  u.recoil = Math.max(0, u.recoil - dt * 0.12)
  // 撃つ・ボルト・装填
  u.boltT = Math.max(0, u.boltT - dt)
  // 装填: 1発ずつ込める。弾が1発でもあれば撃って中断できる
  if (u.reloadT > 0) {
    u.reloadT -= dt
    if (u.reloadT <= 0) { u.ammo++; st.events.push({ type: 'round', ammo: u.ammo }); u.reloadT = u.ammo < MAG ? RELOAD_ROUND : 0; if (!u.reloadT) st.events.push({ type: 'reloaded' }) }
  }
  if (input.reload && u.ammo < MAG && u.reloadT <= 0 && u.boltT <= 0) { u.reloadT = RELOAD_START + RELOAD_ROUND; st.events.push({ type: 'reload' }) }
  if (input.fire && u.reloadT > 0 && u.ammo > 0) { u.reloadT = 0; st.events.push({ type: 'reloaded' }) } // 込めている途中で撃つ
  if (input.fire && u.boltT <= 0 && u.reloadT <= 0) {
    if (u.ammo <= 0) { st.events.push({ type: 'dry' }); u.reloadT = RELOAD_START + RELOAD_ROUND; st.events.push({ type: 'reload' }) }
    else {
      fire(st, u, u.yaw + u.swayX, u.pitch + u.swayY + zeroAngle(u.zero))
      u.ammo--; u.boltT = BOLT_T; u.recoil = 0.035; u.moved = Math.max(u.moved, 0.35)
      st.stats.shots++
      alertEnemies(st, u)
    }
  }
}
// はしごに取り付く: 下からは壁に向かって前進、屋上からは縁のはしごへ外向きに前進（Battlefield・CoD と同じ）
function tryLadder(st, u, input) {
  if (!(input.mz < -0.3) || !WORLD.ladders.length) return false
  const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw)
  for (const [i, L] of WORLD.ladders.entries()) {
    if (Math.abs(L.x - u.x) > 3 || Math.abs(L.z - u.z) > 3) continue
    const face = fx * L.nx + fz * L.nz // 外向きなら +1、壁向きなら -1
    const bx = L.x + L.nx * 0.5, bz = L.z + L.nz * 0.5
    if (face < -0.5 && Math.hypot(u.x - bx, u.z - bz) < LADDER.reach && u.y < L.top - 1) { attach(st, u, i, Math.max(u.y, L.y0), false); return true }
    const ix = L.x - L.nx * 0.7, iz = L.z - L.nz * 0.7
    if (face > 0.5 && Math.hypot(u.x - ix, u.z - iz) < 1.1 && Math.abs(u.y - L.top) < 0.4) { attach(st, u, i, L.top - 0.9, true); return true }
  }
  return false
}
function attach(st, u, i, y, fromTop) {
  const L = WORLD.ladders[i]
  u.ladder = i; u.ladderLock = fromTop // 上から乗ったら、前進をいったん離すまで登らない（乗った瞬間に登り返さない）
  u.x = L.x + L.nx * 0.6; u.z = L.z + L.nz * 0.6; u.y = y; u.vx = u.vz = u.vy = 0; u.stance = 'stand'
  st.events.push({ type: 'ladder', id: u.id, on: true, yaw: Math.atan2(-L.nx, -L.nz), fromTop })
}
function detach(st, u, kind) { u.ladder = null; st.events.push({ type: 'ladder', id: u.id, on: false, kind }) }
function stepLadder(st, u, input) {
  const dt = STEP, L = WORLD.ladders[u.ladder]
  if (!u.alive) { detach(st, u, 'dead'); return }
  u.stance = 'stand'
  if (u.ladderLock && !(input.mz < -0.3)) u.ladderLock = false
  const dir = input.mz < -0.3 && !u.ladderLock ? 1 : input.mz > 0.3 ? -1 : 0
  const y0 = u.y
  u.y += dir > 0 ? LADDER.up * dt : dir < 0 ? -LADDER.down * dt : 0
  u.climb = (u.climb || 0) + Math.abs(u.y - y0)
  if (u.climb > 0.6) { u.climb = 0; st.events.push({ type: 'rung', id: u.id }) }
  u.moved = Math.max(u.moved - dt * 0.8, 0.8); u.vx = u.vz = 0
  u.breath = Math.min(BREATH_MAX, u.breath + dt); u.holding = false
  u.boltT = Math.max(0, u.boltT - dt) // 手がふさがっているので撃てない・装填しない
  const base = SWAY.stand * 4, w = st.t * 0.9
  u.swayX = Math.sin(w) * base; u.swayY = Math.sin(w * 2) * base * 0.6
  if (input.jump) { detach(st, u, 'jump'); u.vx = L.nx * 2; u.vz = L.nz * 2; u.vy = 1; u.y += 0.06; return } // 手を離す
  if (u.y >= L.top) { u.x = L.x - L.nx * 1.0; u.z = L.z - L.nz * 1.0; u.y = L.top; detach(st, u, 'top'); return } // 手すり壁を越えて屋上へ
  const ground = Math.max(L.y0, heightAt(u.x, u.z))
  if (u.y <= ground) { u.y = ground; u.x = L.x + L.nx * 0.9; u.z = L.z + L.nz * 0.9; detach(st, u, 'bottom') }
}
export function eyeOf(u) { return { x: u.x, y: u.y + EYE[u.stance], z: u.z } }
function fire(st, u, yaw, pitch) {
  const e = eyeOf(u)
  const dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch)
  st.bullets.push({ x: e.x + dx * 0.8, y: e.y + dy * 0.8 - 0.04, z: e.z + dz * 0.8, vx: dx * MUZZLE_V, vy: dy * MUZZLE_V, vz: dz * MUZZLE_V, owner: u.id, t: 0, dist: 0, fx: e.x, fy: e.y, fz: e.z })
  st.events.push({ type: 'shot', id: u.id, x: e.x, y: e.y, z: e.z, dx, dy, dz })
}
function applyHit(st, b, hit) {
  const u = hit.u, shooter = st.units[b.owner]
  const dist = Math.hypot(hit.x - b.fx, hit.z - b.fz)
  const dmg = DMG[hit.part]
  u.hp -= dmg
  st.events.push({ type: 'hit', id: u.id, part: hit.part, by: b.owner, dist, x: hit.x, y: hit.y, z: hit.z, dmg })
  if (b.owner === 0) { st.stats.hits++; if (hit.part === 'head') st.stats.headshots++ }
  if (u.hp <= 0 && u.alive) {
    u.alive = false
    st.events.push({ type: 'kill', id: u.id, by: b.owner, part: hit.part, dist })
    if (b.owner === 0) { st.stats.kills++; st.stats.longest = Math.max(st.stats.longest, dist) }
  } else if (!u.player && u.ai) { u.ai.awareness = 1; u.ai.lastKnown = { x: shooter.x, z: shooter.z }; u.ai.moveTo = null; u.ai.cool = 0.6 } // 撃たれて生きていたら反撃に移る
}

// ---------------------------------------------------------------- 敵の狙撃手
// 見つける: 見通しが通り、距離が「姿勢と動きで決まる見える距離」の内側なら、気づき度がたまる。
// 気づいたら構えて（スコープが光る）、狙いの誤差つきで撃つ。撃ったら場所を変える。銃声を聞くとそちらを探す
export function visibleRange(u) {
  const base = { stand: 750, crouch: 500, prone: 280 }[u.stance]
  return base * (1 + Math.min(1, u.moved) * 0.8) * (1 - concealment(u.x, u.z) * 0.55)
}
function alertEnemies(st, shooter) {
  for (const e of st.units) {
    if (e.player || !e.alive) continue
    const d = Math.hypot(e.x - shooter.x, e.z - shooter.z)
    if (d > 1100) continue
    // 音が届くまでの遅れの後に、おおよその場所が分かる（遠いほど誤差が大きい）
    const err = d * 0.12
    e.ai.heard = { at: st.t + d / SOUND_V, x: shooter.x + (st.rand() - 0.5) * err, z: shooter.z + (st.rand() - 0.5) * err }
  }
}
function stepEnemy(st, e) {
  const dt = STEP, ai = e.ai, me = st.units[0]
  const diff = st.difficulty
  if (ai.heard && st.t >= ai.heard.at) { ai.lastKnown = { x: ai.heard.x, z: ai.heard.z }; ai.awareness = Math.max(ai.awareness, 0.45); ai.heard = null }
  // 安全地帯の外か縁に近ければ、中へ移る（市街地の屋上なら屋上を下りて通りを歩く）
  const zt = zoneTarget(st), zd = Math.hypot(e.x - zt.x, e.z - zt.z)
  if (zd > zt.r * 0.85 && (!ai.moveTo || !ai.toZone)) {
    const a = st.rand() * Math.PI * 2, rr = st.rand() * zt.r * 0.5
    let tx = zt.x + Math.cos(a) * rr, tz = zt.z + Math.sin(a) * rr
    if (STAGE === 'city') { const b = WORLD.buildings.find(b => Math.abs(b.x - tx) < b.w / 2 + 1 && Math.abs(b.z - tz) < b.d / 2 + 1); if (b) { tx = b.x + b.w / 2 + 5; } }
    ai.moveTo = { x: tx, z: tz }; ai.toZone = true; e.stance = 'stand'
    if (STAGE === 'city' && e.y > heightAt(e.x, e.z) + 2) { e.y = heightAt(e.x, e.z) } // 屋上から階段で下りた扱い（下りる途中は見えない）
  }
  // 移動中
  if (ai.moveTo) {
    const dx = ai.moveTo.x - e.x, dz = ai.moveTo.z - e.z, d = Math.hypot(dx, dz)
    if (d < 1.5) { ai.moveTo = null; ai.toZone = false; e.stance = STAGE === 'city' || st.rand() >= 0.65 ? 'crouch' : 'prone'; e.moved = 0.3 }
    else {
      // 歩く（遠い移動は立って歩く: 動く的になる。偏差＝相手の進む先を狙う必要がある）
      const sp = e.stance === 'stand' ? SPEED.stand : SPEED.crouch * 1.1
      const nx = e.x + dx / d * sp * dt, nz = e.z + dz / d * sp * dt
      if (STAGE === 'city' && inHut(nx, e.y + 0.8, nz)) { ai.moveTo = { x: e.x + (st.rand() - 0.5) * 30, z: e.z + (st.rand() - 0.5) * 30 }; return } // 建物にぶつかったら回り込む
      e.x = nx; e.z = nz; e.y = supportAt(e.x, e.z, e.y + 0.5); e.yaw = Math.atan2(dx, dz); e.moved = 0.7; return }
  }
  e.moved = Math.max(0, e.moved - dt * 0.5)
  const ee = eyeOf(e)
  const me_c = { x: me.x, y: me.y + EYE[me.stance] * 0.7, z: me.z }
  const d = Math.hypot(me.x - e.x, me.z - e.z)
  // 見張る向き: 知っている場所か、ゆっくり左右を見回す
  const toMe = Math.atan2(me.x - e.x, me.z - e.z)
  let look = ai.lastKnown ? Math.atan2(ai.lastKnown.x - e.x, ai.lastKnown.z - e.z) : ai.scanYaw + Math.sin(st.t * 0.25 + e.id) * 0.9
  const facing = Math.cos(toMe - look) // 自分の方を向いているほど見つけやすい
  let seen = 0
  if (me.alive && d < 1200 && facing > -0.2) {
    const range = visibleRange(me) * (0.75 + 0.35 * Math.max(0, facing)) * (0.8 + 0.2 * diff) * WEATHER_VIS[st.weather] // もやが濃いと遠くは見えない（お互いさま）
    if (d < range) {
      // 胴が隠れていても頭が出ていれば見える（手すり壁の陰からのぞいたとき）。見えた方を狙う
      seen = lineOfSight(ee.x, ee.y, ee.z, me_c.x, me_c.y, me_c.z); ai.aimHead = false
      if (seen <= 0.15) { const hp = bodyPoints(me).head; const sh = lineOfSight(ee.x, ee.y, ee.z, hp[0], hp[1], hp[2]) * 0.6; if (sh > 0.15) { seen = sh; ai.aimHead = true } }
    }
  }
  if (seen > 0.15) { ai.awareness = Math.min(1, ai.awareness + dt * (0.35 + 0.5 * seen) * (1 + (1 - d / 1200)) * diff * Math.min(1, st.t / 12)); ai.lastKnown = { x: me.x, z: me.z } } // 出撃直後の12秒は気づきにくい（構える時間をくれる）
  else ai.awareness = Math.max(0, ai.awareness - dt * 0.04)
  e.yaw += (((look - e.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 1.5)
  ai.cool = Math.max(0, ai.cool - dt)
  // 構える → 撃つ
  if (ai.aimT >= 0) {
    ai.aimT -= dt
    e.aiming = true
    if (seen <= 0.15 && ai.aimT > 0.4) { ai.aimT = -1; e.aiming = false; return } // 見失ったらやめる
    if (ai.aimT <= 0) {
      e.aiming = false; ai.aimT = -1
      // 狙い: 自分の胴へ弾道を合わせ（ゼロインを距離に合わせる）、誤差を乗せる。距離・相手の動き・伏せで外れやすい
      const tgt = { x: me.x + me.vx * (d / MUZZLE_V), y: ai.aimHead ? bodyPoints(me).head[1] : me.y + EYE[me.stance] * (me.stance === 'prone' ? 0.6 : 0.62), z: me.z + me.vz * (d / MUZZLE_V) }
      const dx = tgt.x - ee.x, dy = tgt.y - ee.y, dz = tgt.z - ee.z, hd = Math.hypot(dx, dz)
      const sigma = (0.0007 + hd / 1000 * 0.0008 + Math.min(1, me.moved) * 0.003 + (me.stance === "prone" ? 0.0004 : 0)) / diff
      const g = () => (st.rand() + st.rand() + st.rand() - 1.5) * 1.15
      // 風の読み: 横風の分をだいたい補正する（読み違いで少しずれる）
      const tof = hd / (MUZZLE_V * 0.94)
      const cross = (st.wind.x * dz - st.wind.z * dx) / (hd || 1)
      const windComp = -cross * DRAG * tof * tof * 0.5 * (0.7 + st.rand() * 0.6) / hd // 空気抵抗で流される量（弾道と同じ式）。読みは±3割ずれる
      fire(st, e, Math.atan2(dx, dz) + windComp + g() * sigma, Math.atan2(dy, hd) + zeroAngle(Math.max(100, Math.min(1200, Math.round(hd / 25) * 25))) + g() * sigma)
      ai.cool = 4 + st.rand() * 4
      ai.awareness = 0.7
      // 撃ったら少し離れた場所へ移る（40〜90m）
      if (st.rand() < 0.75) {
        const a = st.rand() * Math.PI * 2, rr = 40 + st.rand() * 50
        const nx = Math.max(-HALF + 20, Math.min(HALF - 20, e.x + Math.cos(a) * rr)), nz = Math.max(-HALF + 20, Math.min(HALF - 20, e.z + Math.sin(a) * rr))
        const ok = STAGE === 'city' ? Math.abs(supportAt(nx, nz, e.y + 0.5) - e.y) < 0.3 && !inHut(nx, e.y + 0.7, nz) && segHitsBoxes(e.x, e.y + 0.7, e.z, nx, e.y + 0.7, nz) === null : slopeAt(nx, nz) < 0.6
        if (ok) { ai.moveTo = { x: nx, z: nz }; e.stance = 'crouch' }
      }
    }
    return
  }
  e.aiming = false
  // 気づかない時間が続いたら、知っている場所（無ければ自分のいる方面）へ、高い所・木の陰を選んで詰める
  ai.idle = seen > 0.15 ? 0 : ai.idle + dt
  if (ai.idle > 22 + e.id * 3 && !ai.moveTo) {
    ai.idle = 0
    const tx = ai.lastKnown ? ai.lastKnown.x : me.x + (st.rand() - 0.5) * 300, tz = ai.lastKnown ? ai.lastKnown.z : me.z + (st.rand() - 0.5) * 300
    const dd = Math.hypot(tx - e.x, tz - e.z)
    if (dd > 220) {
      let best = null
      for (let k = 0; k < 14; k++) {
        const step = 60 + st.rand() * 60, a = Math.atan2(tx - e.x, tz - e.z) + (st.rand() - 0.5) * 1.4
        const nx = Math.max(-HALF + 20, Math.min(HALF - 20, e.x + Math.sin(a) * step)), nz = Math.max(-HALF + 20, Math.min(HALF - 20, e.z + Math.cos(a) * step))
        if (STAGE === 'city' ? (Math.abs(supportAt(nx, nz, e.y + 0.5) - e.y) > 0.3 || segHitsBoxes(e.x, e.y + 0.7, e.z, nx, e.y + 0.7, nz) !== null) : (slopeAt(nx, nz) > 0.6 || inHut(nx, heightAt(nx, nz) + 1, nz))) continue
        const sc = heightAt(nx, nz) * 0.3 + concealment(nx, nz) * 25 + st.rand() * 8
        if (!best || sc > best.sc) best = { x: nx, z: nz, sc }
      }
      if (best) { ai.moveTo = best; e.stance = dd > 400 ? 'stand' : 'crouch' }
    }
    return
  }
  if (ai.awareness >= 1 && ai.cool <= 0 && seen > 0.15) { ai.aimT = (2.4 + st.rand() * 1.8) / diff; st.events.push({ type: 'aim', id: e.id }) }
}

export function drainEvents(st) { const ev = st.events; st.events = []; return ev }

// ゲームの外から使う: 目の位置から見た方向の先で、最初に当たる距離（距離計）
export function rangeFind(st, u, yaw, pitch, max = 1500) {
  const e = eyeOf(u)
  const dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch)
  for (let t = 2; t < max; t += t < 200 ? 1 : 2.5) {
    const x = e.x + dx * t, y = e.y + dy * t, z = e.z + dz * t
    if (y < heightAt(x, z) || inHut(x, y, z)) return t
    for (const k of nearTrees(x, z)) { const tr = WORLD.trees[k]; const hd = Math.hypot(tr.x - x, tr.z - z); if ((hd < 0.35 && y < tr.y + tr.h * 0.6) || (hd < tr.r * 0.8 && Math.abs(y - (tr.y + tr.h * 0.62)) < tr.h * 0.35)) return t }
    for (const o of st.units) if (o !== u && o.alive) { const p = bodyPoints(o); if (Math.hypot(x - p.b[0], z - p.b[2]) < 0.4 && y > o.y && y < o.y + EYE[o.stance] + 0.2) return t }
  }
  return null
}

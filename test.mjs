// ロジックの検証。node test.mjs
import * as S from './src/sim.js'
let pass = 0, fail = 0
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'OK  ' : 'FAIL'} ${name}${info !== '' ? '  ' + info : ''}`) }
const calm = st => { st.wind = { x: 0, z: 0, speed: 0, dir: 0 }; st.windTarget = { dir: 0, speed: 0 }; st.windT = 1e9 }
// 見通しの通る、距離 d の敵の位置を探す（自分は動かさない）
function placeClear(st, e, d, stance = 'stand') {
  const me = st.units[0], eye = S.eyeOf(me)
  for (let k = 0; k < 2000; k++) {
    const a = (k * 0.6173) % 6.283, x = me.x + Math.sin(a) * d, z = me.z + Math.cos(a) * d
    if (Math.abs(x) > 790 || Math.abs(z) > 790) continue
    e.x = x; e.z = z; e.y = S.heightAt(x, z); e.stance = stance
    const p = S.bodyPoints(e)
    if (S.lineOfSight(eye.x, eye.y, eye.z, p.b[0], p.b[1] - 0.25, p.b[2], 0) > 0.99 && S.lineOfSight(eye.x, eye.y, eye.z, ...p.head, 0) > 0.99) return true
  }
  return false
}
const freeze = e => { e.ai.awareness = 0; e.ai.cool = 1e9; e.ai.idle = -1e9; e.ai.moveTo = null }
function aim(st, e, part = 'body') {
  const me = st.units[0], eye = S.eyeOf(me), p = S.bodyPoints(e)
  const t = part === 'head' ? p.head : [p.b[0], p.b[1] - 0.25, p.b[2]]
  const dx = t[0] - eye.x, dy = t[1] - eye.y, dz = t[2] - eye.z, hd = Math.hypot(dx, dz)
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, hd), hd }
}
function shootOnce(st, inp) {
  S.step(st, { ...inp, fire: true, scoped: true, hold: true })
  let res = null
  for (let i = 0; i < 300 && st.bullets.length; i++) { S.step(st, { ...inp, scoped: true, hold: true }); for (const ev of S.drainEvents(st)) if (ev.type === 'hit' && ev.by === 0) res = ev }
  return res
}
const fresh = seed => { const st = S.createState(seed); calm(st); st.units.slice(2).forEach(u => { u.alive = false; u.x = 5000 }); const e = st.units[1]; freeze(e); return { st, me: st.units[0], e } }

{ // 世界
  ok(S.WORLD.trees.length > 3000, '木が3000本以上', S.WORLD.trees.length)
  let mx = 0; for (let x = -800; x <= 800; x += 25) for (let z = -800; z <= 800; z += 25) mx = Math.max(mx, S.heightAt(x, z))
  ok(mx < 180, '外周の山が壁のように高くない（最高180m 未満）', mx.toFixed(0))
  ok(S.WORLD.huts.length >= 10, '廃屋がある', S.WORLD.huts.length)
}
{ // 弾道: ゼロインした距離で、照準どおりに当たる（風なし・息止め）
  for (const d of [300, 500]) {
    const { st, me, e } = fresh(11 + d)
    me.stance = 'prone'
    if (!placeClear(st, e, d, 'stand')) { ok(false, `${d}m の見通しが取れない`); continue }
    const a = aim(st, e)
    me.zero = Math.round(a.hd / 50) * 50
    for (let i = 0; i < 300; i++) S.step(st, { stance: 'prone', scoped: true, hold: true, yaw: a.yaw, pitch: a.pitch }) // 息が戻るまで待つ
    const r = shootOnce(st, { yaw: a.yaw, pitch: a.pitch, stance: 'prone' })
    ok(r && r.id === 1, `${d}m: ゼロインを合わせて息を止めれば胴に当たる`, r ? `${r.part} ${r.dist.toFixed(0)}m` : '外れ')
  }
}
{ // ゼロインが合っていないと外れる（500m 先を100m ゼロで撃つと下に落ちる）
  const { st, me, e } = fresh(21)
  me.stance = 'prone'
  placeClear(st, e, 500, 'crouch')
  const a = aim(st, e); me.zero = 100
  for (let i = 0; i < 300; i++) S.step(st, { stance: 'prone', scoped: true, hold: true, yaw: a.yaw, pitch: a.pitch })
  S.step(st, { yaw: a.yaw, pitch: a.pitch, stance: 'prone', fire: true, scoped: true, hold: true })
  const b = st.bullets[0]; let minDy = 0, hit = false
  for (let i = 0; i < 200 && st.bullets.length; i++) { S.step(st, { yaw: a.yaw, pitch: a.pitch, scoped: true }); for (const ev of S.drainEvents(st)) if (ev.type === 'hit') hit = true }
  ok(!hit, '500m 先を100m ゼロのまま撃つと当たらない（弾が落ちる）')
}
{ // 風: 横風で弾が流される（約500m・風速8m/s で数十cm）
  const drift = wind => {
    const st = S.createState(31); st.units.slice(2).forEach(u => { u.alive = false; u.x = 5000 }); st.units[1].x = 5000; st.units[1].z = 5000; freeze(st.units[1]) // 1人は遠くに残す（全滅で試合が終わらないように）
    st.wind = { x: wind, z: 0, speed: Math.abs(wind), dir: Math.PI / 2 }; st.windTarget = { dir: Math.PI / 2, speed: Math.abs(wind) }; st.windT = 1e9
    st.units[0].stance = 'prone'
    for (let i = 0; i < 300; i++) S.step(st, { stance: 'prone', scoped: true, hold: true, yaw: 0, pitch: 0.02 })
    S.step(st, { yaw: 0, pitch: 0.02, fire: true, scoped: true, hold: true, stance: 'prone' })
    const b = st.bullets[0], x0 = st.units[0].x
    while (st.bullets.includes(b) && b.z - st.units[0].z < 500) { S.step(st, { yaw: 0, pitch: 0.02, scoped: true, hold: true, stance: 'prone' }) }
    return b.x - x0
  }
  const calmX = drift(0), windX = drift(8)
  ok(windX - calmX > 0.1 && windX - calmX < 1.5, '風下へ流される（500m・風速8m/s）', `${(windX - calmX).toFixed(2)}m`)
}
{ // 揺れ: 息を止めると揺れが小さくなる。伏せは立ちより揺れない
  const amp = (stance, hold) => { const st = S.createState(41); st.units.slice(2).forEach(u => { u.alive = false }); st.units[1].x = 5000; freeze(st.units[1]); let m = 0; for (let i = 0; i < 330; i++) { S.step(st, { stance, scoped: true, hold }); if (i > 100) m = Math.max(m, Math.hypot(st.units[0].swayX, st.units[0].swayY)) } return m }
  const stand = amp('stand', false), prone = amp('prone', false), held = amp('stand', true)
  ok(prone < stand * 0.4, '伏せは立ちより揺れが小さい', `${(stand * 1000).toFixed(2)} → ${(prone * 1000).toFixed(2)} mrad`)
  ok(held < stand * 0.3, '息を止めると揺れが小さくなる', `${(held * 1000).toFixed(2)} mrad`)
  const st = S.createState(42); st.units.slice(1).forEach(u => { u.x = 5000; u.z = 5000; freeze(u) }); for (let i = 0; i < 60 * 8; i++) S.step(st, { stance: 'stand', scoped: true, hold: true })
  ok(!st.units[0].holding && st.units[0].gasp, `息は${S.BREATH_MAX}秒までしか止められない（切れたら離すまで止められない）`)
}
{ // ボルトと弾倉
  const { st, me } = fresh(51)
  S.step(st, { fire: true }); S.step(st, { fire: true })
  ok(st.events.filter(e => e.type === 'shot').length === 1 && me.boltT > 0, 'ボルトを引くまで次は撃てない')
  for (let n = 0; n < 6; n++) { for (let i = 0; i < 90; i++) S.step(st, {}); S.step(st, { fire: true }) }
  ok(me.ammo === 0 || me.reloadT > 0, '5発で弾切れ・装填に入る', `ammo=${me.ammo} reload=${me.reloadT.toFixed(1)}`)
}
{ // 見つかりやすさ: 伏せ・木の陰・止まっていると見える距離が短い
  const st = S.createState(61), me = st.units[0]
  me.stance = 'stand'; me.moved = 0; const st0 = S.visibleRange(me)
  me.stance = 'prone'; const pr = S.visibleRange(me)
  me.stance = 'stand'; me.moved = 1; const mv = S.visibleRange(me)
  ok(pr < st0 * 0.5 && mv > st0 * 1.5, '伏せると見つかりにくく、動くと見つかりやすい', `立ち${st0.toFixed(0)} 伏せ${pr.toFixed(0)} 動き${mv.toFixed(0)}m`)
}
{ // 敵: 見通しの通る300m 先に立っている相手には、やがて撃ってくる。撃たれると減る
  const { st, me, e } = fresh(71)
  placeClear(st, e, 300, 'crouch'); e.ai = { awareness: 0, aimT: -1, cool: 0, lastKnown: null, moveTo: null, scanYaw: Math.atan2(me.x - e.x, me.z - e.z), idle: 0 }
  e.yaw = e.ai.scanYaw
  let shot = -1
  for (let i = 0; i < 60 * 60 && shot < 0; i++) { S.step(st, { stance: 'stand' }); for (const ev of S.drainEvents(st)) if (ev.type === 'shot' && ev.id === 1) shot = st.t }
  ok(shot > 0 && shot < 30, '見通しの通る300m 先の立っている相手を見つけて撃つ', shot > 0 ? `${shot.toFixed(1)}秒` : '撃たない')
}
{ // 撃つと位置がばれる: 900m 以内の敵が、音の遅れの後に撃った場所を知る
  const { st, me, e } = fresh(81)
  e.x = me.x + 500; e.z = me.z; e.y = S.heightAt(e.x, e.z); e.ai.idle = 0
  S.step(st, { fire: true, yaw: 1, pitch: 0.1 })
  for (let i = 0; i < 60 * 2; i++) S.step(st, {})
  ok(e.ai.lastKnown && Math.hypot(e.ai.lastKnown.x - me.x, e.ai.lastKnown.z - me.z) < 100, '銃声で500m 先の敵が、だいたいの位置を知る（約1.5秒後）', e.ai.lastKnown ? `誤差${Math.hypot(e.ai.lastKnown.x - me.x, e.ai.lastKnown.z - me.z).toFixed(0)}m` : '知らない')
}
{ // 頭は1発、胴も1発で倒れる。全滅させたら勝ち
  const { st, me, e } = fresh(91)
  me.stance = 'prone'; placeClear(st, e, 250, 'stand')
  const a = aim(st, e, 'head'); me.zero = 250
  for (let i = 0; i < 300; i++) S.step(st, { stance: 'prone', scoped: true, hold: true, yaw: a.yaw, pitch: a.pitch })
  const r = shootOnce(st, { yaw: a.yaw, pitch: a.pitch, stance: 'prone' })
  ok(r && r.part === 'head' && !e.alive, '250m のヘッドショットで倒れる', r ? r.part : '外れ')
  for (let i = 0; i < 5; i++) S.step(st, {})
  ok(st.phase === 'over' && st.result === 'win', '全員倒すと勝ち')
}
{ // 自分が撃たれて倒れると負け
  const { st, me } = fresh(95)
  me.hp = 1; st.units[1].alive = true
  st.bullets.push({ x: me.x + 5, y: me.y + 1.1, z: me.z, vx: -820, vy: 0, vz: 0, owner: 1, t: 0, dist: 0, fx: me.x + 300, fz: me.z })
  for (let i = 0; i < 10; i++) S.step(st, {})
  ok(st.phase === 'over' && st.result === 'lose', '撃たれて倒れると負け')
}
{ // 試合の流れ: 立ったまま動かない相手は、4分のうちに倒されることが多い。伏せていれば見つかりにくい
  let deadStand = 0, deadProne = 0
  for (let s = 0; s < 8; s++) {
    for (const [stance, inc] of [['stand', () => deadStand++], ['prone', () => deadProne++]]) {
      const st = S.createState(200 + s); for (let i = 0; i < 60 * 240 && st.phase === 'play'; i++) S.step(st, { stance })
      if (!st.units[0].alive) inc()
    }
  }
  ok(deadStand >= 4 && deadProne <= 2, '立ちっぱなしは危険、伏せは見つかりにくい', `立ち${deadStand}/8 伏せ${deadProne}/8 が倒された`)
}
{ // 装填は1発ずつ。途中で撃って中断できる
  const { st, me } = fresh(301)
  me.ammo = 0
  S.step(st, { reload: true })
  const counts = []; for (let i = 0; i < 60 * 4; i++) { S.step(st, {}); if (counts[counts.length - 1] !== me.ammo) counts.push(me.ammo) }
  ok(counts.join(',') === '0,1,2,3,4,5', '弾が1発ずつ増える', counts.join(','))
  me.ammo = 1; S.step(st, { reload: true }); for (let i = 0; i < 80; i++) S.step(st, {})
  const before = me.ammo; S.step(st, { fire: true })
  ok(before === 2 && me.ammo === 1 && me.reloadT === 0, '込めている途中でも撃てる（装填は止まる）', `${before} → ${me.ammo}`)
}
{ // 市街地: 屋上で伏せると手すり壁に隠れ、しゃがむと外が見える。建物は弾を止める
  const st = S.createState(302, { stage: 'city' }), me = st.units[0]
  ok(S.WORLD.buildings.length > 200, '市街地に建物がある', S.WORLD.buildings.length)
  const roof = S.WORLD.buildings.find(b => Math.abs(b.x - me.x) < b.w / 2 && Math.abs(b.z - me.z) < b.d / 2)
  ok(roof && Math.abs(me.y - (roof.y + roof.h)) < 0.05, '自分は屋上から始まる', me.y.toFixed(1))
  // 自分の屋上の南の縁へ寄り、外の点を見る
  me.x = roof.x; me.z = roof.z - roof.d / 2 + 1.0
  const out = { x: me.x, y: me.y + 1.0, z: me.z - 60 }
  me.stance = 'prone'; let e = S.eyeOf(me); const hidden = S.lineOfSight(e.x, e.y, e.z, out.x, out.y, out.z, 0)
  me.stance = 'crouch'; e = S.eyeOf(me); const seen = S.lineOfSight(e.x, e.y, e.z, out.x, out.y, out.z, 0)
  ok(hidden === 0 && seen > 0.9, '伏せると手すり壁に隠れ、しゃがむと外が見える', `伏せ=${hidden} しゃがみ=${seen}`)
  // 屋上から歩いても手すり壁で落ちない
  me.stance = 'stand'; for (let i = 0; i < 200; i++) S.step(st, { mx: 0, mz: 1, yaw: Math.PI })
  ok(Math.abs(me.y - (roof.y + roof.h)) < 0.05, '手すり壁があるので屋上から落ちない', me.y.toFixed(1))
}
{ // 市街地: しゃがんで顔を出していると撃たれることがあり、伏せていれば撃たれない
  let crouch = 0, prone = 0
  for (let s = 0; s < 6; s++) for (const [stance, inc] of [['crouch', () => crouch++], ['prone', () => prone++]]) { const st = S.createState(400 + s, { stage: 'city' }); for (let i = 0; i < 60 * 180 && st.phase === 'play'; i++) S.step(st, { stance }); if (!st.units[0].alive) inc() }
  ok(crouch >= 1 && prone === 0, '市街地: 顔を出すと危険、伏せると安全', `しゃがみ${crouch}/6 伏せ${prone}/6`)
}
console.log(`\n${pass} OK / ${fail} FAIL`)
process.exit(fail ? 1 : 0)

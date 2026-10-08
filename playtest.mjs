// 実時間で1試合。node playtest.mjs [webkit] [844x390] [秒]
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const ROOT = import.meta.dirname, useWebkit = process.argv.includes('webkit')
const size = process.argv.find(a => /^\d+x\d+$/.test(a)) || '1280x800', [W, H] = size.split('x').map(Number)
const secs = +(process.argv.find(a => /^\d+$/.test(a)) || 90)
const OUT = join(ROOT, '検証', 'playtest-' + (useWebkit ? 'webkit-' : '') + size + (process.argv.includes('city') ? '-city' : '')); await mkdir(OUT, { recursive: true })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: '5192' } })
await new Promise(r => setTimeout(r, 400))
const b = useWebkit ? await webkit.launch() : await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage(); const errs = []
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()) }); p.on('requestfailed', r => errs.push('fail ' + r.url()))
await p.goto('http://localhost:5192/'); await p.waitForFunction(() => window.__rlReady); await p.waitForTimeout(800)
const city = process.argv.includes('city')
if (city) { await p.click('.sopt[data-s="city"]'); await p.waitForTimeout(1500) }
await p.click('#startBtn'); await p.waitForTimeout(300)
let shot = 1, last = Date.now(), fired = 0
const t0 = Date.now()
while (Date.now() - t0 < secs * 1000) {
  const s = await p.evaluate(() => {
    const st = rl.raw(); if (!st) return null
    const me = st.units[0]
    // 見通しの通る一番近い敵を選んで、その胴へ向ける（ゼロインは距離に合わせる）
    let best = null
    for (const e of st.units) { if (e.player || !e.alive) continue; const d = Math.hypot(e.x - me.x, e.z - me.z); if (d > 750) continue; const eye = { x: me.x, y: me.y + 1.05, z: me.z }; const los = window.__rlLos(eye, { x: e.x, y: e.y + 0.8, z: e.z }); if (los > 0.5 && (!best || d < best.d)) best = { e, d } }
    const res = { mode: rl.mode, phase: st.phase, result: st.result, hp: me.hp, kills: st.stats.kills, shots: st.stats.shots, alive: st.units.filter(u => !u.player && u.alive).length, target: best ? best.e.id : -1, dist: best ? best.d : 0, zero: me.zero, bolt: me.boltT, cov: rl.coverage() }
    if (best) { rl.aimAt(best.e.id); rl.scope(true) }
    else {
      // 見える敵がいなければ、一番近い敵の方へ向いて歩く
      rl.scope(false)
      let near = null; for (const e of st.units) if (!e.player && e.alive) { const d = Math.hypot(e.x - me.x, e.z - me.z); if (!near || d < near.d) near = { e, d } }
      if (near) rl.look(Math.atan2(near.e.x - me.x, near.e.z - me.z), -0.02)
    }
    res.stance = me.stance
    return res
  })
  if (!s) { await p.waitForTimeout(100); continue }
  if (s.mode === 'result' || s.mode === 'over') { if (s.mode === 'result') break }
  if (s.target < 0 && s.mode === 'play' && !city) { if (s.stance === 'prone') await p.keyboard.press('KeyZ'); if (s.stance === 'crouch') await p.keyboard.press('KeyC'); await p.keyboard.down('KeyW') } else await p.keyboard.up('KeyW')
  const want = city ? 'crouch' : 'prone'
  if (s.target >= 0 && s.mode === 'play' && s.stance !== want) { await p.keyboard.press(city ? 'KeyC' : 'KeyZ'); await p.waitForTimeout(500) }
  if (s.target >= 0 && s.mode === 'play') {
    const want = Math.max(100, Math.min(800, Math.round(s.dist / 50) * 50))
    if (want > s.zero) await p.keyboard.press('KeyE'); else if (want < s.zero) await p.keyboard.press('KeyQ')
    else if (s.bolt <= 0) { await p.keyboard.down('ShiftLeft'); await p.waitForTimeout(600); await p.evaluate(id => rl.aimAt(id), s.target); await p.mouse.click(W / 2, H / 2); fired++; await p.keyboard.up('ShiftLeft') }
  }
  if (Date.now() - last > 4000) { await p.screenshot({ path: join(OUT, String(shot++).padStart(2, '0') + '.png') }); last = Date.now() }
  await p.waitForTimeout(60)
}
await p.waitForTimeout(3500)
await p.screenshot({ path: join(OUT, '99-end.png') })
const fps = await p.evaluate(() => new Promise(r => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 1000) requestAnimationFrame(f); else r(n) }; requestAnimationFrame(f) }))
const end = await p.evaluate(() => ({ pingsNow: rl.pings(), zoneR: Math.round(rl.raw().zone.r), mode: rl.mode, result: rl.raw().result, stats: rl.raw().stats, hp: rl.raw().units[0].hp, t: +rl.raw().t.toFixed(0) }))
console.log(JSON.stringify({ out: OUT, fps, fired, end, errors: errs.slice(0, 6), errorCount: errs.length }))
await b.close(); server.kill()

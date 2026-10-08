// 1場面ずつ撮る。node shot.mjs <title|play|scope|scope12|enemy|land> [幅x高さ] [webkit]
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
const ROOT = import.meta.dirname, scene = process.argv[2] || 'title'
const size = process.argv.find(a => /^\d+x\d+$/.test(a)) || '1280x800', [W, H] = size.split('x').map(Number)
const useWebkit = process.argv.includes('webkit')
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: '5191' } })
await new Promise(r => setTimeout(r, 400))
const b = useWebkit ? await webkit.launch() : await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: W, height: H }, ...(useWebkit && W > H && H < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) })
const p = await ctx.newPage(); const errs = []
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) }); p.on('requestfailed', r => errs.push('fail ' + r.url()))
await p.goto('http://localhost:5191/'); await p.waitForFunction(() => window.__rlReady, null, { timeout: 30000 }); await p.waitForTimeout(1500)
if (process.argv.includes('city')) { await p.click('.sopt[data-s="city"]'); await p.waitForTimeout(1500) }
let extra = {}
if (scene !== 'title') {
  extra = await p.evaluate(sc => {
    rl.start({ seed: 7 }); rl.pause(true); rl.run(10)
    const st = rl.raw()
    if (sc === 'play' || sc === 'land') { rl.look(0, -0.03); rl.run(5) }
    if (sc === 'roof') { rl.look(0, -0.02); rl.run(10, { stance: 'crouch' }) }
    if (sc === 'roofprone') { rl.look(0, -0.02); rl.run(40, { stance: 'prone' }) }
    if (sc === 'result') { st.units.forEach(u => { if (!u.player) u.alive = false }); st.stats = { shots: 9, hits: 6, kills: 6, longest: 612.4, headshots: 2 }; rl.pause(false) }
    if (['close', 'enemyfire', 'impact', 'hurt', 'killed', 'death'].includes(sc)) {
      const me = st.units[0], e = st.units[1]; st.units.slice(2).forEach(u => { u.alive = false; u.x = 9999 })
      const R = sc === 'close' ? 90 : 230
      for (let k = 0; k < 800; k++) { const a = Math.random() * 6.28, r = R + Math.random() * 30; e.x = me.x + Math.sin(a) * r; e.z = me.z + Math.cos(a) * r; e.y = rl.h(e.x, e.z); e.stance = sc === 'close' ? 'crouch' : 'stand'
        const eye = { x: me.x, y: me.y + 1.62, z: me.z }; if (window.__rlLos(eye, { x: e.x, y: e.y + 0.9, z: e.z }) > 0.98 && window.__rlLos(eye, { x: e.x, y: e.y + 0.3, z: e.z }) > 0.98) break }
      e.ai.cool = 1e9; e.ai.idle = -1e9; e.yaw = Math.atan2(me.x - e.x, me.z - e.z)
      rl.aimAt(e.id); rl.scope(sc !== 'hurt'); rl.zoom(sc === 'close' ? 0 : 1); rl.run(20); rl.aimAt(e.id)
      if (sc === 'enemyfire') { e.ai.awareness = 1; e.ai.cool = 0; e.ai.aimT = 0.05; rl.run(6) }
      if (sc === 'impact') { const me2 = me; me2.zero = 100; rl.run(1, { fire: true }); rl.run(34) } // ゼロインが合っていないので手前に落ちる
      if (sc === 'hurt') { me.hp = 100; e.ai.awareness = 1; st.bullets.push({ x: e.x, y: e.y + 1.5, z: e.z, vx: (me.x - e.x) / 230 * 820, vy: 0, vz: (me.z - e.z) / 230 * 820, owner: 1, t: 0, dist: 0, fx: e.x, fz: e.z }); rl.run(25); rl.look(rl.raw().units[0].yaw + 1.6, 0); rl.run(2) }
      if (sc === 'killed') { me.zero = Math.round(Math.hypot(e.x - me.x, e.z - me.z) / 50) * 50; st.wind = { x: 0, z: 0, speed: 0, dir: 0 }; st.windTarget = { dir: 0, speed: 0 }; rl.run(200, { stance: 'stand', hold: true }); rl.aimAt(e.id); rl.run(1, { fire: true, hold: true }); rl.run(40) }
      if (sc === 'death') { rl.scope(false); rl.look(me.yaw + 2.2, 0); me.hp = 1; st.bullets.push({ x: e.x, y: e.y + 1.5, z: e.z, vx: (me.x - e.x) / 240 * 820, vy: (me.y + 1.0 - e.y - 1.5) / 240 * 820, vz: (me.z - e.z) / 240 * 820, owner: 1, t: 0, dist: 0, fx: e.x, fz: e.z }); rl.pause(false) }
      return { dist: Math.hypot(e.x - me.x, e.z - me.z).toFixed(0), alive: e.alive }
    }
    if (sc === 'target' || sc === 'target-glint') {
      // 開けた場所で、約200m 先に敵を立たせる（見通しが通る位置を探す）
      const me = st.units[0], e = st.units[1]; st.units.slice(2).forEach(u => { u.alive = false; u.x = 9999 })
      for (let k = 0; k < 600; k++) { const a = Math.random() * 6.28, r = 180 + Math.random() * 60; e.x = me.x + Math.sin(a) * r; e.z = me.z + Math.cos(a) * r; e.y = rl.h(e.x, e.z); e.stance = 'crouch'
        const eye = { x: me.x, y: me.y + 1.62, z: me.z }; if (window.__rlLos(eye, { x: e.x, y: e.y + 0.9, z: e.z }) > 0.98 && window.__rlLos(eye, { x: e.x, y: e.y + 0.3, z: e.z }) > 0.98) break }
      e.ai.aimT = 99; e.ai.awareness = 1; e.ai.moveTo = null; e.yaw = Math.atan2(me.x - e.x, me.z - e.z)
      rl.aimAt(e.id); rl.scope(true); rl.zoom(sc === 'target-glint' ? 0 : 1); rl.run(30); rl.aimAt(e.id); rl.run(2)
      return { dist: Math.hypot(e.x - me.x, e.z - me.z).toFixed(0) }
    }
    if (sc.startsWith('scope') || sc === 'enemy') {
      // 一番近い敵を、見通しの通る位置から狙う
      // 見通しの通る場所に自分を置き直す（敵の近くの開けた高い所を探す）
      const me = st.units[0], e = st.units[1]
      let spot = null
      for (let k = 0; k < 400 && !spot; k++) { const a = Math.random() * 6.28, r = 250 + Math.random() * 250, x = e.x + Math.sin(a) * r, z = e.z + Math.cos(a) * r; me.x = x; me.z = z; me.y = 0; rl.run(1, { stance: 'prone' }); const ee = { x: e.x, y: e.y + 1.0, z: e.z }; const mm = me; const eye = { x: mm.x, y: mm.y + 0.32, z: mm.z }; if (window.__rlLos(eye, ee) > 0.95) spot = { x, z } }
      const best = { e, d: Math.hypot(e.x - me.x, e.z - me.z) }; e.stance = 'crouch'; e.ai.aimT = 99; e.ai.awareness = 1; e.yaw = Math.atan2(me.x - e.x, me.z - e.z)
      const d = rl.aimAt(e.id)
      if (sc !== 'enemy') { rl.scope(true); rl.zoom(sc === 'scope12' ? 1 : 0) }
      rl.run(40, { stance: 'prone' }); rl.aimAt(e.id); rl.run(30)
      return { dist: d.toFixed(0), enemy: e.name }
    }
    return {}
  }, scene)
}
await p.waitForTimeout(scene === 'title' ? 2500 : scene === 'result' ? 3500 : scene === 'death' ? 2600 : 300)
const out = join(ROOT, '検証', `${scene}-${size}${useWebkit ? '-webkit' : ''}${process.argv.includes('city') ? '-city' : ''}.png`)
await p.screenshot({ path: out })
console.log(out.split('/').pop(), JSON.stringify({ ...extra, cov: await p.evaluate(() => rl.coverage()), info: await p.evaluate(() => rl.info()) }), errs.length ? 'ERR ' + errs.join(' | ') : 'no errors')
await b.close(); server.kill()

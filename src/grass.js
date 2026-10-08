// 足元の草: 自分のまわり（半径 R）だけに草の株を並べ、動いたら並べ直す。風でなびく
import * as THREE from 'three'

function tuftGeometry(rand) {
  // 1株 = 細い葉を9本。根元は濃く、先は乾いた色。法線は上向きにして地面と同じ明るさで照らす
  const pos = [], col = [], nor = []
  const base = new THREE.Color('#3f4d27'), tip = new THREE.Color('#7f8448')
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, h = 0.12 + rand() * rand() * 0.5, w = 0.018 + rand() * 0.016
    const ox = (rand() - 0.5) * 0.22, oz = (rand() - 0.5) * 0.22, lean = 0.08 + rand() * 0.16
    const cx = Math.cos(a), sz = Math.sin(a), lx = Math.cos(a + 1.57) * lean, lz = Math.sin(a + 1.57) * lean
    const p = (u, v) => [ox + cx * w * u + lx * v * v, h * v, oz + sz * w * u + lz * v * v]
    const quads = [[p(-1, 0), p(1, 0), p(0.6, 0.5)], [p(-1, 0), p(0.6, 0.5), p(-0.6, 0.5)], [p(-0.6, 0.5), p(0.6, 0.5), p(0, 1)]]
    for (const tri of quads) for (const v of tri) {
      pos.push(...v); nor.push(0, 1, 0)
      const k = v[1] / h, c = base.clone().lerp(tip, k * (0.7 + rand() * 0.3)); col.push(c.r, c.g, c.b)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

export function createGrass({ count, radius, heightAt, slopeAt, allow, rng }) {
  const rand = rng(77)
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide })
  const uni = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) } }
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni)
    sh.vertexShader = 'uniform float uTime; uniform vec2 uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp = instanceMatrix * vec4(0., 0., 0., 1.);
      float sway = (sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.21) * 0.6 + sin(uTime * 3.1 + wp.x * 0.9) * 0.25) * position.y * position.y;
      transformed.xz += uWind * sway;`)
  }
  const mesh = new THREE.InstancedMesh(tuftGeometry(rand), mat, count)
  mesh.receiveShadow = true; mesh.castShadow = false; mesh.frustumCulled = false
  // 株ごとの固定の置き場所（R 四方の中の位置）と大きさ
  const off = Array.from({ length: count }, () => ({ x: (rand() * 2 - 1) * radius, z: (rand() * 2 - 1) * radius, s: 0.7 + rand() * 0.7, r: rand() * 6.28 }))
  const d = new THREE.Object3D(), c = new THREE.Color()
  let cx = 1e9, cz = 1e9, lastProne = null
  function place(px, pz, prone) {
    cx = px; cz = pz; lastProne = prone
    const span = radius * 2
    for (let i = 0; i < count; i++) {
      const o = off[i]
      // 自分を中心に巻き戻す（タイル状にずらす）
      const x = px + ((((o.x - px) % span) + span * 1.5) % span - radius), z = pz + ((((o.z - pz) % span) + span * 1.5) % span - radius)
      const dist = Math.hypot(x - px, z - pz)
      let s = o.s * Math.min(1, Math.max(0, (radius - dist) / (radius * 0.55))) // 縁は小さくして境目を見せない
      if (prone && dist < 8) s *= 0.15 + 0.85 * Math.max(0, (dist - 5) / 3) // 伏せたとき草で何も見えなくならないよう、まわりだけ踏み倒す（敵の視線は草を通る）
      if (s > 0 && (!allow(x, z) || slopeAt(x, z) > 0.75)) s = 0
      d.position.set(x, heightAt(x, z) - 0.02, z); d.rotation.set(0, o.r, 0); d.scale.set(s, s * (0.8 + (o.r % 1) * 0.5), s)
      d.updateMatrix(); mesh.setMatrixAt(i, d.matrix)
      const k = 0.85 + (o.r % 0.3); c.setRGB(k, k, k * 0.95); mesh.setColorAt(i, c)
    }
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }
  return {
    mesh,
    update(px, pz, prone, t, wx, wz) {
      if (Math.hypot(px - cx, pz - cz) > 2.5 || prone !== lastProne) place(px, pz, prone)
      uni.uTime.value = t
      const sp = Math.hypot(wx, wz) || 1, k = 0.04 + Math.min(1, sp / 10) * 0.12 // 風下へなびく。強いほど大きく
      uni.uWind.value.set(wx / sp * k, wz / sp * k)
    },
    reset() { cx = cz = 1e9 },
  }
}

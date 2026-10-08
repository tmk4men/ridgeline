// RIDGELINE の描画・入力・音・画面。ロジックは sim.js（固定60Hz）
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import * as S from './sim.js?v=202610081101'
import { buildRifle, animateBolt } from './rifle.js?v=202610081101'
import { createGrass } from './grass.js?v=202610081101'

const $ = id => document.getElementById(id)
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
if (isTouch) document.body.classList.add('touch')

// ================================================================ 描画の土台
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(isTouch ? 1.5 : 2, devicePixelRatio || 1))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.AgXToneMapping // 色が飽和しにくく、実写に近い階調
renderer.toneMappingExposure = 1.05
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
document.body.prepend(renderer.domElement)
const scene = new THREE.Scene()
const HAZE = new THREE.Color('#b9c4c6')
scene.fog = new THREE.FogExp2(HAZE, 0.0011) // 遠い尾根ほど霞む（空気遠近）
const BASE_FOV = 70
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 4000)
scene.add(camera)

// 空: 地平は霞の色、上は淡い青、太陽のまわりが明るい
const SUN = new THREE.Vector3(-0.45, 0.42, 0.78).normalize()
const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sun: { value: SUN }, hz: { value: HAZE }, top: { value: new THREE.Color('#6f8fae') } },
  vertexShader: 'varying vec3 vP0; void main(){ vP0 = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: ['uniform vec3 sun; uniform vec3 hz; uniform vec3 top; varying vec3 vP0;', // 方向は画素ごとに正規化する（太陽が引き伸ばされない）
    'void main(){ vec3 vP = normalize(vP0); float h = smoothstep(-0.05, 0.5, vP.y); vec3 c = mix(hz, top, pow(h, 0.7));',
    ' float s = max(dot(vP, sun), 0.); c += vec3(1.,.93,.8) * (pow(s, 6.) * .3 + pow(s, 400.) * .25 + smoothstep(.99985, .99993, s) * 6.);',
    ' gl_FragColor = vec4(c, 1.);',
    '#include <colorspace_fragment>',
    '}'].join('\n'),
}))
sky.renderOrder = -1
{
  // 空の明るさを映り込みと環境光に使う（金属やレンズが空を映す）
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene(); es.add(sky)
  scene.environment = pm.fromScene(es, 0, 0.1, 5000).texture; scene.environmentIntensity = 0.35; pm.dispose()
}
scene.add(sky)
scene.add(new THREE.HemisphereLight('#dfe8f0', '#6b6a4c', 1.05)) // 逆光でも木が黒くつぶれないよう、空と地面の照り返しを強めに
const sun = new THREE.DirectionalLight('#ffeed6', 3.0)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 })
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05
scene.add(sun, sun.target)

// ================================================================ ステージ（地形・木・岩・建物）。ステージを変えたら作り直す
function noiseTex(size, f) {
  const c = document.createElement('canvas'); c.width = c.height = size
  const x = c.getContext('2d'), img = x.createImageData(size, size)
  for (let i = 0; i < size * size; i++) { const v = f(i % size, Math.floor(i / size)); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255 }
  x.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace
  return t
}
let wg = null, grassF = null
function buildScene() {
  if (wg) { scene.remove(wg); wg.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => { if (m.map && m.map !== ghillieTex) m.map.dispose(); m.dispose() }) }) }
  wg = new THREE.Group(); scene.add(wg)
{
  const SIZE = 2400, SEG = isTouch ? 300 : 420 // スマホは地形の細かさを落として軽く
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2)
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3)
  const c = new THREE.Color(), grass = new THREE.Color('#5d6b3a'), dry = new THREE.Color('#8f8a58'), rock = new THREE.Color('#77736a'), dirt = new THREE.Color('#6b5a43'), dark = new THREE.Color('#3f4a2a')
  const r = S.rng(5)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = S.heightAt(x, z), sl = S.slopeAt(x, z)
    pos.setY(i, h)
    // 色むら: 大きな枯れ草の帯、中くらいの濃い草地、細かいまだら（どれも不規則な雑音）
    const n = S.fbm(x / 260, z / 260, 11, 3), n2 = S.fbm(x / 60, z / 60, 23, 3), n3 = S.fbm(x / 14, z / 14, 37, 2)
    c.copy(grass).lerp(dry, Math.max(0, Math.min(1, (n - 0.42) * 2.6 + (h - 40) / 200)))
    c.lerp(dark, Math.max(0, (n2 - 0.55) * 1.8))
    c.multiplyScalar(0.9 + n3 * 0.2)
    if (S.STAGE === 'city' && Math.max(Math.abs(x), Math.abs(z)) < 540) {
      // 市街地: 道路はアスファルト、街区の中は舗装。64m ごとの通り（幅16m）
      const mx = ((x % 64) + 96) % 64 - 32, mz = ((z % 64) + 96) % 64 - 32
      const road = Math.abs(mx) > 24 || Math.abs(mz) > 24
      c.set(road ? '#55585b' : '#8d8a83')
    }
    c.lerp(dark, Math.max(0, S.concealment(x, z) * 0.6))
    if (h < 12) c.lerp(dirt, (12 - h) / 12 * 0.6)
    c.lerp(rock, Math.max(0, Math.min(1, (sl - 0.45) * 2.2)))
    c.multiplyScalar(0.92 + r() * 0.14)
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  // 近くで見たときの草のざらつき（白黒の細かい模様を色に掛ける）
  const r2 = S.rng(9)
  const fb = (i, j) => S.fbm(i / 18, j / 18, 3, 4), N = 256
  const seam = (i, j) => (fb(i, j) * (N - i) * (N - j) + fb(i - N, j) * i * (N - j) + fb(i, j - N) * (N - i) * j + fb(i - N, j - N) * i * j) / (N * N) // 端どうしが繋がるように混ぜる
  const detail = noiseTex(N, (i, j) => Math.max(0, Math.min(255, 150 + (seam(i, j) - 0.5) * 200 + 55 + r2() * 30)))
  detail.repeat.set(SIZE / 4, SIZE / 4)
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 1, metalness: 0 })
  // 模様を2つの大きさで重ねる（同じ模様の繰り返しが遠くで目立たないように）
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
    vec4 t1 = texture2D(map, vMapUv), t2 = texture2D(map, vMapUv * 0.071 + 0.37), t3 = texture2D(map, vMapUv * 0.0093);
    diffuseColor.rgb *= t1.rgb * mix(vec3(0.82), vec3(1.12), t2.r) * mix(vec3(0.85), vec3(1.1), t3.g);`) }
  const ground = new THREE.Mesh(g, m)
  ground.receiveShadow = true
  wg.add(ground)
  grassF = S.STAGE === 'city' ? null : createGrass({ count: isTouch ? 4000 : 14000, radius: isTouch ? 22 : 32, heightAt: S.heightAt, slopeAt: S.slopeAt, allow: () => true, rng: S.rng })
  if (grassF) wg.add(grassF.mesh)
}

// ================================================================ 木・岩・廃屋（まとめて描く）
const dummy = new THREE.Object3D()
{
  const W = S.WORLD
  const pines = W.trees.filter(t => t.kind === 'pine'), broads = W.trees.filter(t => t.kind !== 'pine')
  const trunkM = new THREE.MeshStandardMaterial({ color: '#4a3b2c', roughness: 1 })
  const needleM = new THREE.MeshStandardMaterial({ color: '#4d6a40', roughness: 0.95, vertexColors: true })
  const leafM = new THREE.MeshStandardMaterial({ color: '#6a7f42', roughness: 0.95, vertexColors: true })
  const bushM = new THREE.MeshStandardMaterial({ color: '#61753c', roughness: 0.95, flatShading: true })
  // 400m 四方ずつに分けて描く。見えていない区画（と影の範囲外）は描かずに済む
  const inst = (geo, mat, list, set, cast = true) => {
    const tiles = new Map()
    for (const t of list) { const k = Math.floor(t.x / 400) + ',' + Math.floor(t.z / 400); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(t) }
    const c = new THREE.Color(), r = S.rng(list.length)
    for (const part of tiles.values()) {
      const m = new THREE.InstancedMesh(geo, mat, part.length)
      part.forEach((t, i) => { set(t, dummy); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); const k = 0.78 + r() * 0.34; c.setRGB(k * (0.95 + r() * 0.1), k, k * (0.9 + r() * 0.1)); m.setColorAt(i, c) }) // 木ごとに明るさを少し変える
      m.computeBoundingSphere(); m.castShadow = cast; m.receiveShadow = true
      wg.add(m)
    }
  }
  inst(new THREE.CylinderGeometry(0.18, 0.32, 1, 6), trunkM, W.trees, (t, d) => { d.position.set(t.x, t.y + t.h * 0.35, t.z); d.scale.set(1, t.h * 0.7, 1); d.rotation.set(0, 0, 0) })
  // 松: 枝先が垂れてぎざぎざの段を6つ重ねた1つの形。広葉樹: こぶの寄り集まった樹冠。下ほど暗い（自分の影）
  const tg = treeGeoms()
  inst(tg.pine, needleM, pines, (t, d) => { d.position.set(t.x, t.y + t.h * 0.2, t.z); d.scale.set(t.r * 1.05, t.h * 0.82, t.r * 1.05); d.rotation.set(0, (t.x * 13) % 6.28, 0) })
  inst(tg.broad, leafM, broads, (t, d) => { d.position.set(t.x, t.y + t.h * 0.64, t.z); d.scale.set(t.r * 1.2, t.h * 0.4, t.r * 1.2); d.rotation.set(0, t.z % 6.28, 0) })
  // 岩
  const rockM = new THREE.MeshStandardMaterial({ color: '#7d786d', roughness: 0.95, flatShading: true })
  if (W.rocks.length && W.rocks[0].car) { const carM = new THREE.MeshStandardMaterial({ color: '#6d7480', roughness: 0.4, metalness: 0.5 }); inst(new THREE.BoxGeometry(1.8, 1.4, 4.3), carM, W.rocks, (t, d) => { d.position.set(t.x, t.y + 0.7, t.z); d.scale.set(1, 1, 1); d.rotation.set(0, t.yaw, 0) }) }
  else inst(new THREE.DodecahedronGeometry(1, 0), rockM, W.rocks, (t, d) => { d.position.set(t.x, t.y + t.s * 0.25, t.z); d.scale.set(t.s, t.s * 0.6, t.s * 0.85); d.rotation.set(t.x % 1, t.z % 6, 0) })
  // 低い茂み（見た目だけ。草原の手前を埋める）
  const r3 = S.rng(31), bushes = []
  for (let k = 0; k < (S.STAGE === 'city' ? 0 : 2600); k++) { const x = (r3() * 2 - 1) * 790, z = (r3() * 2 - 1) * 790; if (S.slopeAt(x, z) > 0.6) continue; bushes.push({ x, z, y: S.heightAt(x, z), s: 0.4 + r3() * 0.7 }) }
  inst(new THREE.IcosahedronGeometry(1, 0), bushM, bushes, (t, d) => { d.position.set(t.x, t.y + t.s * 0.3, t.z); d.scale.set(t.s * 1.3, t.s * 0.6, t.s); d.rotation.set(0, t.x % 6, 0) }, false)
  // 廃屋: 石の壁（崩れた屋根なし・屋根あり）
  const stoneM = new THREE.MeshStandardMaterial({ color: '#9a9284', roughness: 0.95 })
  const roofM = new THREE.MeshStandardMaterial({ color: '#5b4a3a', roughness: 0.9 })
  for (const h of W.huts) {
    const g = new THREE.Group()
    const wall = (w, hh, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), stoneM); m.position.set(x, hh / 2, z); m.castShadow = m.receiveShadow = true; g.add(m) }
    const t = 0.5, hh = h.h + 1
    wall(h.w, hh, t, 0, h.d / 2 - t / 2); wall(h.w, h.ruin ? hh * 0.6 : hh, t, 0, -h.d / 2 + t / 2)
    wall(t, hh, h.d - t * 2, h.w / 2 - t / 2, 0); wall(t, h.ruin ? hh * 0.5 : hh, h.d - t * 2, -h.w / 2 + t / 2, 0)
    if (!h.ruin) for (const s of [1, -1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(h.w + 0.6, 0.18, h.d / 2 + 0.9), roofM); m.position.set(0, hh + 0.9, s * h.d / 4); m.rotation.x = s * 0.55; m.castShadow = true; g.add(m) }
    g.position.set(h.x, h.y - 1, h.z)
    wg.add(g)
  }
}

  if (S.STAGE === 'city') buildCity()
}
// 木の形（1本ぶん、高さ・半径とも 1 の大きさ）。頂点を揺らしてでこぼこにし、下と内側を暗くする
let _tg = null
function treeGeoms() {
  if (_tg) return _tg
  const r = S.rng(41)
  const shade = (g, f) => { const p = g.attributes.position, col = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const k = f(p.getX(i), p.getY(i), p.getZ(i)); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g }
  // 松
  const layers = []
  for (let k = 0; k < 5; k++) {
    const y0 = k / 5 * 0.76, rr = 1 - k / 5 * 0.8, hh = 0.36 - k * 0.03
    const c = new THREE.ConeGeometry(rr, hh, 9, 1, true), p = c.attributes.position
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) { const j = 0.78 + r() * 0.4; p.setXYZ(i, p.getX(i) * j, p.getY(i) - r() * hh * 0.35, p.getZ(i) * j) } // 枝先をばらつかせ、垂らす
    c.translate(0, y0 + hh / 2, 0); c.rotateY(r() * 6.28); layers.push(c.toNonIndexed())
    const u = new THREE.CircleGeometry(rr * 0.85, 9).rotateX(Math.PI / 2); u.translate(0, y0 + 0.02, 0); layers.push(u.toNonIndexed()) // 段の裏（下から見ても抜けない）
  }
  for (const l of layers) l.deleteAttribute('uv')
  const pine = mergeGeometries(layers); pine.computeVertexNormals()
  shade(pine, (x, y, z) => 0.55 + Math.min(1, y) * 0.35 + Math.hypot(x, z) * 0.25)
  // 広葉樹
  const blobs = []
  for (let k = 0; k < 6; k++) {
    const b = new THREE.IcosahedronGeometry(0.42 + r() * 0.25, 1), p = b.attributes.position, ph = r() * 9
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), j = 1 + Math.sin(x * 9 + ph) * Math.cos(y * 8 - ph) * Math.sin(z * 7 + ph * 2) * 0.16; p.setXYZ(i, x * j, y * j, z * j) } // 同じ位置の頂点は同じだけ動かす（面が割れない）
    const a = k / 5 * 6.28, rad = k ? 0.48 : 0
    b.translate(Math.cos(a) * rad, (k ? -0.15 + r() * 0.5 : 0.3), Math.sin(a) * rad); b.deleteAttribute("uv"); blobs.push(b) // 正二十面体は最初から頂点を共有していない
  }
  const broad = mergeGeometries(blobs); broad.computeVertexNormals()
  shade(broad, (x, y, z) => 0.5 + (y + 0.7) * 0.3 + Math.hypot(x, z) * 0.18)
  return (_tg = { pine, broad })
}
// 市街地の建物: 窓の並ぶ外壁（階ごと）、平らな屋上、縁の手すり壁
let _winTex = null, _roofTex = null
function windowTex() {
  // 外壁 4列 x 4階ぶん。窓ごとにガラスの色・映り込み・ブラインドを変え、繰り返しを目立たせない
  if (_winTex) return _winTex
  const c = document.createElement('canvas'); c.width = c.height = 256
  const x = c.getContext('2d'), r = S.rng(19)
  x.fillStyle = '#d8d2c6'; x.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.05})`; x.fillRect(r() * 256, r() * 256, 2 + r() * 6, 1 + r() * 3) } // 壁のむら
  for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) {
    const X = fx * 64, Y = fy * 64
    x.fillStyle = 'rgba(0,0,0,.16)'; x.fillRect(X, Y + 58, 64, 6) // 階の継ぎ目
    x.fillStyle = '#9a968e'; x.fillRect(X + 8, Y + 12, 48, 38) // 窓枠
    const t = r(), g = x.createLinearGradient(X, Y + 14, X + 30, Y + 48)
    const base = t < 0.3 ? ['#5d6f80', '#2b3640'] : t < 0.75 ? ['#3e4b56', '#1f262c'] : ['#8a9aa6', '#4a5862']
    g.addColorStop(0, base[0]); g.addColorStop(1, base[1]); x.fillStyle = g; x.fillRect(X + 10, Y + 14, 44, 34)
    x.fillStyle = '#9a968e'; x.fillRect(X + 31, Y + 14, 2, 34) // 真ん中の桟
    if (r() < 0.3) { x.fillStyle = `rgba(225,220,205,${0.6 + r() * 0.3})`; x.fillRect(X + 10, Y + 14, 44, 6 + r() * 26) } // ブラインド
    x.fillStyle = 'rgba(255,255,255,.12)'; x.beginPath(); x.moveTo(X + 10, Y + 14); x.lineTo(X + 26, Y + 14); x.lineTo(X + 10, Y + 34); x.fill() // 斜めの映り込み
    x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(X + 8, Y + 50, 48, 2) // 窓台の影
  }
  _winTex = new THREE.CanvasTexture(c); _winTex.wrapS = _winTex.wrapT = THREE.RepeatWrapping; _winTex.colorSpace = THREE.SRGBColorSpace; _winTex.anisotropy = 8
  return _winTex
}
function roofTex() {
  // 屋上のコンクリート: 目地と雨のしみ
  if (_roofTex) return _roofTex
  const c = document.createElement('canvas'); c.width = c.height = 256
  const x = c.getContext('2d'), r = S.rng(29)
  x.fillStyle = '#8e8c87'; x.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 260; i++) { const rr = 4 + r() * 30; const g = x.createRadialGradient(0, 0, 0, 0, 0, rr); g.addColorStop(0, `rgba(${r() < 0.6 ? '40,38,34' : '230,228,220'},${0.04 + r() * 0.08})`); g.addColorStop(1, 'rgba(0,0,0,0)'); x.save(); x.translate(r() * 256, r() * 256); x.fillStyle = g; x.fillRect(-rr, -rr, rr * 2, rr * 2); x.restore() }
  x.strokeStyle = 'rgba(40,40,38,.18)'; x.lineWidth = 1
  for (let k = 0; k <= 256; k += 64) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, 256); x.moveTo(0, k); x.lineTo(256, k); x.stroke() }
  _roofTex = new THREE.CanvasTexture(c); _roofTex.wrapS = _roofTex.wrapT = THREE.RepeatWrapping; _roofTex.colorSpace = THREE.SRGBColorSpace; _roofTex.anisotropy = 8
  return _roofTex
}
function buildCity() {
  const W = S.WORLD, r = S.rng(53)
  const wallMs = ['#ffffff', '#e6ebf0', '#f0e2cc', '#dcd6cc'].map(col => new THREE.MeshStandardMaterial({ map: windowTex(), color: col, roughness: 0.85 }))
  const roofM = new THREE.MeshStandardMaterial({ map: roofTex(), roughness: 0.95 })
  const parM = new THREE.MeshStandardMaterial({ map: roofTex(), color: '#d4d0c8', roughness: 0.9 })
  const capM = new THREE.MeshStandardMaterial({ color: '#c4c0b6', roughness: 0.8 })
  const unitM = new THREE.MeshStandardMaterial({ color: '#b9bcbd', roughness: 0.55, metalness: 0.35 })
  const darkM = new THREE.MeshStandardMaterial({ color: '#3b3d3f', roughness: 0.6, metalness: 0.5 })
  // 色ごと・屋上・手すり壁・屋上の機械をそれぞれ1つの形にまとめて描く（建物ごとに描くと重い）
  const walls = [[], [], [], []], roofs = [], pars = [], caps = [], units = [], darks = []
  const box = (list, w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y + h / 2, z); list.push(g.toNonIndexed()) }
  for (const b of W.buildings) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d), uv = g.attributes.uv
    for (let v = 0; v < uv.count; v++) { const f = Math.floor(v / 4); const fw = f < 2 ? b.d : b.w; uv.setXY(v, uv.getX(v) * Math.max(1, Math.round(fw / 3.2)) / 4 + (b.x % 7) / 4, uv.getY(v) * b.floors / 4) }
    const ni = g.toNonIndexed(); ni.translate(b.x, b.y + b.h / 2, b.z)
    // 上下の面（6面中の3・4番目 = 頂点 12〜23）は取り除き、屋上は別の板にする
    const pos = ni.attributes.position.array, nor = ni.attributes.normal.array, uvs = ni.attributes.uv.array, keep = []
    for (let t = 0; t < pos.length / 9; t++) if (Math.abs(nor[t * 9 + 1]) < 0.5) keep.push(t)
    const pick = (arr, n) => { const o = new Float32Array(keep.length * 3 * n); keep.forEach((t, k) => o.set(arr.subarray(t * 3 * n, t * 3 * n + 3 * n), k * 3 * n)); return o }
    const wg2 = new THREE.BufferGeometry(); wg2.setAttribute('position', new THREE.BufferAttribute(pick(pos, 3), 3)); wg2.setAttribute('normal', new THREE.BufferAttribute(pick(nor, 3), 3)); wg2.setAttribute('uv', new THREE.BufferAttribute(pick(uvs, 2), 2))
    walls[Math.floor(b.tint * 4)].push(wg2)
    const rf = new THREE.PlaneGeometry(b.w, b.d).rotateX(-Math.PI / 2), ruv = rf.attributes.uv
    for (let v = 0; v < ruv.count; v++) ruv.setXY(v, ruv.getX(v) * b.w / 8, ruv.getY(v) * b.d / 8)
    rf.translate(b.x, b.y + b.h + 0.01, b.z); roofs.push(rf.toNonIndexed())
    // 屋上の機械（手すり壁より低いものだけ。弾や視線の判定には入れない）: 室外機・換気口・天窓・アンテナ
    const top = b.y + b.h, ix = b.w / 2 - 3, iz = b.d / 2 - 3
    if (ix > 1 && iz > 1) {
      const n = 2 + Math.floor(r() * 5), ux = b.x + (r() * 2 - 1) * ix * 0.7, uz = b.z + (r() * 2 - 1) * iz * 0.7
      for (let k = 0; k < n; k++) { const ox = ux + (k % 3) * 1.2, oz = uz + Math.floor(k / 3) * 1.4; box(units, 0.95, 0.72, 0.42, ox, top, oz); box(darks, 0.5, 0.02, 0.02, ox, top + 0.36, oz + 0.215) }
      for (let k = 0; k < 2 + r() * 3; k++) { const v = new THREE.CylinderGeometry(0.18, 0.18, 0.5, 10); v.translate(b.x + (r() * 2 - 1) * ix, top + 0.25, b.z + (r() * 2 - 1) * iz); darks.push(v.toNonIndexed()) }
      if (r() < 0.5) box(units, Math.min(4, ix), 0.55, Math.min(2.5, iz), b.x + (r() * 2 - 1) * ix * 0.4, top, b.z + (r() * 2 - 1) * iz * 0.4)
      for (let k = 0; k < Math.floor(r() * 3); k++) { const a = new THREE.CylinderGeometry(0.03, 0.04, 3 + r() * 4, 5); a.translate(b.x + (r() * 2 - 1) * ix, top + 2.5, b.z + (r() * 2 - 1) * iz); darks.push(a.toNonIndexed()) }
    }
    // 1階の帯（店の入口や庇の暗い帯）
    box(darks, b.w + 0.04, 0.35, b.d + 0.04, b.x, b.y + 3.1, b.z)
  }
  for (const bx of W.boxes) { if (!bx.wall) continue; const g = new THREE.BoxGeometry(bx.w, bx.h, bx.d), pu = g.attributes.uv; for (let v = 0; v < pu.count; v++) { const f = Math.floor(v / 4), fw = f < 2 ? bx.d : bx.w; pu.setXY(v, pu.getX(v) * fw / 8, pu.getY(v) * (f === 2 || f === 3 ? bx.d : bx.h) / 8) } g.translate(bx.x, bx.y + bx.h / 2, bx.z); pars.push(g.toNonIndexed()); box(caps, bx.w + 0.08, 0.07, bx.d + 0.08, bx.x, bx.y + bx.h, bx.z) }
  const add = (list, m) => { if (!list.length) return; for (const g of list) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)) } const mesh = new THREE.Mesh(mergeGeometries(list, false), m); mesh.castShadow = mesh.receiveShadow = true; wg.add(mesh) }
  walls.forEach((l, i) => add(l, wallMs[i])); add(roofs, roofM); add(pars, parM); add(caps, capM); add(units, unitM); add(darks, darkM)
}

// 安全地帯の壁: 青い半透明の筒（中から見ても外から見ても分かる）
const zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128, 1, true), new THREE.MeshBasicMaterial({ color: '#4aa8ff', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, fog: false }))
zoneWall.visible = false
scene.add(zoneWall)

// ================================================================ 敵の狙撃手（ギリースーツ）・スコープの光
buildScene()
const ghillieTex = noiseTex(64, (() => { const r = S.rng(3); return () => 90 + r() * 120 })())
ghillieTex.repeat.set(2, 2)
const enemyViews = []
function makeEnemyView() {
  const g = new THREE.Group()
  const suit = new THREE.MeshStandardMaterial({ color: '#5b6640', map: ghillieTex, roughness: 1 })
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2d26', roughness: 0.7 })
  const body = new THREE.Group(); g.add(body)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.6, 3, 8), suit); torso.position.y = 1.05; body.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), suit); head.position.y = 1.6; body.add(head)
  for (const s of [1, -1]) { const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.65, 3, 6), suit); leg.position.set(0.13 * s, 0.42, 0); body.add(leg) }
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 1.2), dark); rifle.position.set(0.15, 1.32, 0.5); body.add(rifle)
  // 毛羽立ち（ギリースーツのぼさぼさ）
  const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({ color: '#4c5636', roughness: 1, flatShading: true })); tuft.position.y = 1.25; tuft.scale.set(1, 0.9, 0.7); body.add(tuft)
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  // スコープの光: 遠くても見える大きさの光（構えている間だけ、こちらを向いているときに強く）
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex(), color: '#fff6e0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false, fog: false }))
  glint.scale.set(0.035, 0.035, 1); glint.visible = false
  scene.add(glint)
  scene.add(g)
  return { g, body, glint }
}
let _glint = null
function glintTex() {
  if (_glint) return _glint
  const c = document.createElement('canvas'); c.width = c.height = 64
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,240,200,.8)'); gr.addColorStop(1, 'rgba(255,240,200,0)')
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64)
  x.fillStyle = 'rgba(255,255,255,.7)'; x.fillRect(0, 31, 64, 2); x.fillRect(31, 0, 2, 64)
  _glint = new THREE.CanvasTexture(c); return _glint
}

// ================================================================ 自分の銃（構えていないとき画面の右下）・弾道の筋・土煙
const rifle = buildRifle(), viewRifle = rifle.g
viewRifle.scale.setScalar(0.5)
const brass = { m: new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.072, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 1, roughness: 0.28 })), v: new THREE.Vector3(), t: 0, out: true }
brass.m.visible = false; viewRifle.add(brass.m)
viewRifle.position.set(0.15, -0.17, -0.36)
camera.add(viewRifle)
const trails = [], dust = []
const puffTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c) })()
function addPuff(x, y, z, color, size, life, op = 0.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color, transparent: true, depthWrite: false }))
  s.position.set(x, y, z); s.scale.setScalar(size); scene.add(s)
  dust.push({ s, t: 0, life, size, op })
}

// ================================================================ 音（その場で合成）
let actx = null, master = null, verb = null, noiseBuf = null
function ensureAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return }
  try { actx = new (window.AudioContext || window.webkitAudioContext)() } catch { return }
  master = actx.createGain(); master.gain.value = 0.9
  const comp = actx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5
  master.connect(comp).connect(actx.destination)
  // 谷に響く残響（長い尾）
  const conv = actx.createConvolver(), len = actx.sampleRate * 3.2, ir = actx.createBuffer(2, len, actx.sampleRate)
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * 0.5; for (const t of [0.18, 0.41, 0.77, 1.3]) d[Math.floor((t + ch * 0.03) * actx.sampleRate)] += 0.5 }
  conv.buffer = ir; verb = actx.createGain(); verb.gain.value = 0.5; verb.connect(conv).connect(master)
  noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  // 風の音と、ときどき鳥
  const src = actx.createBufferSource(); src.buffer = noiseBuf; src.loop = true
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; windGain = actx.createGain(); windGain.gain.value = 0.03
  src.connect(f).connect(windGain).connect(master); src.start(); windFilter = f
  const bird = () => { if (mode === 'play' || mode === 'title') { const f0 = 2400 + Math.random() * 1800; for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) tone(f0, 0.08, 'sine', 0.01, f0 * 1.3, i * 0.12, 0, 0.6) } setTimeout(bird, 5000 + Math.random() * 9000) }
  setTimeout(bird, 3000)
}
let windGain = null, windFilter = null
function out(pan = 0, far = 0, wet = 0.3) {
  const p = actx.createStereoPanner ? actx.createStereoPanner() : null
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 18000 - far * 16500
  const dry = actx.createGain(); dry.gain.value = 1 - far * 0.5
  const send = actx.createGain(); send.gain.value = Math.min(1, wet + far * 0.5)
  if (p) { p.pan.value = pan; p.connect(lp) }
  lp.connect(dry).connect(master); lp.connect(send).connect(verb)
  return p || lp
}
function tone(f, dur, type, vol, to, delay = 0, pan = 0, far = 0) {
  if (!actx) return
  const t0 = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain()
  o.type = type; o.frequency.setValueAtTime(f, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(out(pan, far)); o.start(t0); o.stop(t0 + dur + 0.05)
}
function noise(dur, vol, freq, type = 'bandpass', delay = 0, to = null, pan = 0, far = 0, q = 1, wet = 0.3) {
  if (!actx) return
  const t0 = actx.currentTime + delay, s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain()
  s.buffer = noiseBuf; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t0); if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  s.connect(f).connect(g).connect(out(pan, far, wet)); s.start(t0, Math.random()); s.stop(t0 + dur + 0.05)
}
// こだま: 谷は遠い斜面から遅れて何度も返る。市街地はビルの壁で短く何度も跳ね返る。左右に散らす
function echoes(vol, delay = 0, pan = 0) {
  const city = S.STAGE === 'city'
  const list = city ? [[0.07, 0.4], [0.13, 0.32], [0.22, 0.26], [0.34, 0.2], [0.5, 0.14], [0.75, 0.09]] : [[0.38, 0.32], [0.82, 0.24], [1.35, 0.18], [1.9, 0.12], [2.7, 0.07]]
  list.forEach(([t, v], i) => noise(city ? 0.18 : 0.42, vol * v, city ? 1300 : 650, 'lowpass', delay + t + Math.random() * 0.05, city ? 400 : 180, Math.max(-1, Math.min(1, pan * 0.5 + (i % 2 ? 0.6 : -0.6) * Math.random())), 0.5, 0.7, 0.9))
}
const SFX = {
  // 自分の銃声: 鋭い破裂・胸に来る低音・機関部の金属音。そのあと地形から返ってくるこだま
  shot: () => { noise(0.05, 1, 4200, 'highpass', 0, null, 0, 0, 0.7, 0.1); noise(0.35, 0.75, 1400, 'lowpass', 0, 160, 0, 0, 0.7, 0.5); tone(62, 0.5, 'sine', 0.6, 28); noise(0.04, 0.12, 5200, 'bandpass', 0.01, null, 0, 0, 8, 0); echoes(1) },
  bolt: () => { noise(0.05, 0.25, 2500, 'bandpass', 0.35, null, 0, 0, 4, 0.05); noise(0.06, 0.25, 1800, 'bandpass', 0.6, null, 0, 0, 4, 0.05); noise(0.05, 0.3, 3200, 'bandpass', 0.95, null, 0, 0, 5, 0.05) },
  dry: () => noise(0.04, 0.2, 3000, 'bandpass', 0, null, 0, 0, 6, 0.05),
  reload: () => {},
  round: (d = 0) => { noise(0.05, 0.22, 2200, 'bandpass', d, null, 0, 0, 5, 0.05); noise(0.04, 0.18, 3400, 'bandpass', d + 0.12, null, 0, 0, 6, 0.05) }, // 1発押し込む音
  // 遠くの銃声: 距離のぶん遅れて、高い音が削れて届く
  far: (d, pan) => { const far = Math.min(1, d / 1100), dl = d / S.SOUND_V; noise(0.12, 0.8 * (1 - far * 0.6), 2400, 'lowpass', dl, 300, pan, far, 0.7, 0.7); tone(55, 0.6, 'sine', 0.3 * (1 - far * 0.5), 30, dl, pan, far); echoes(0.45 * (1 - far * 0.5), dl, pan) },
  snap: (pan) => { noise(0.03, 0.9, 5000, 'highpass', 0, null, pan, 0, 0.7, 0.1); tone(1800, 0.05, 'square', 0.15, 600, 0, pan) },
  hitMark: (d) => { tone(900, 0.12, 'triangle', 0.25, 500, d / S.SOUND_V); noise(0.08, 0.3, 700, 'lowpass', d / S.SOUND_V) }, // 着弾の音は遅れて返ってくる
  impact: (d, pan) => noise(0.15, 0.25 * Math.max(0.2, 1 - d / 800), 1200, 'bandpass', d / S.SOUND_V, 300, pan, Math.min(1, d / 800)),
  hurt: () => { noise(0.25, 0.7, 400, 'lowpass', 0, 90); tone(120, 0.4, 'sawtooth', 0.15, 60) },
  breathIn: () => noise(0.5, 0.06, 800, 'bandpass', 0, 1500, 0, 0, 1, 0.02),
  breathOut: () => noise(0.7, 0.07, 1200, 'bandpass', 0, 500, 0, 0, 1, 0.02),
  kill: () => tone(520, 0.25, 'sine', 0.12, 780, 0.05),
  // 足音: 草・土は低くこもった音、市街地は硬い音。遠いほど小さく、左右に振る
  step: (vol, pan, far) => { if (state && state.stage === 'city') noise(0.06, 0.35 * vol, 1400 + Math.random() * 400, 'bandpass', 0, null, pan, far, 2, 0.1); else noise(0.09, 0.4 * vol, 500 + Math.random() * 250, 'lowpass', 0, 180, pan, far, 1, 0.08) },
}

// ================================================================ 入力
let mode = 'loading', state = null, paused = false
let yaw = 0, pitch = 0, scoped = false, zoomI = 0
const ZOOMS = [8, 16]
const keys = new Set(), pressed = {}
let mouseHold = { fire: false }, pointerLocked = false
addEventListener('keydown', e => {
  if (['Space', 'Tab'].includes(e.code)) e.preventDefault()
  if (e.repeat) return
  keys.add(e.code)
  if (mode !== 'play') { if (e.code === 'Enter' && mode !== 'loading') start(); return }
  if (e.code === 'KeyC') pressed.stance = state.units[0].stance === 'crouch' ? 'stand' : 'crouch'
  if (e.code === 'KeyZ') pressed.stance = state.units[0].stance === 'prone' ? 'crouch' : 'prone'
  if (e.code === 'Space') { pressed.jump = true; if (scoped && state.units[0].stance === 'stand') setScope(false) } // 跳ぶと構えが解ける
  if (e.code === 'KeyQ' || e.code === 'PageDown') pressed.zero = -1
  if (e.code === 'KeyE' || e.code === 'PageUp') pressed.zero = 1
  if (e.code === 'KeyR') pressed.reload = true
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && scoped) SFX.breathIn()
})
addEventListener('keyup', e => { keys.delete(e.code); if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && scoped) SFX.breathOut() })
addEventListener('blur', () => keys.clear())
const canvas = renderer.domElement
canvas.addEventListener('contextmenu', e => e.preventDefault())
canvas.addEventListener('pointerdown', e => {
  if (mode !== 'play' || e.pointerType !== 'mouse') return
  ensureAudio()
  if (!pointerLocked) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}) } catch {} }
  if (e.button === 0) pressed.fire = true
  if (e.button === 2) setScope(!scoped)
})
canvas.addEventListener('wheel', e => { if (mode === 'play' && scoped) { e.preventDefault(); zoomI = e.deltaY < 0 ? 1 : 0 } }, { passive: false })
document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === canvas })
addEventListener('mousemove', e => {
  if (mode !== 'play' || !pointerLocked) return
  const k = 0.0022 * (camera.fov / BASE_FOV) // 倍率が高いほどゆっくり回る
  yaw -= e.movementX * k; pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * k))
})
function setScope(v) { scoped = v; $('scope').hidden = !v; $('xhair').hidden = v; viewRifle.visible = !v; if (v) zoomI = zoomI || 0 }
// スマホ: 左スティックで移動、空いている所をなぞって視点、右下のボタン
const stick = { x: 0, y: 0, id: null }, look = { id: null, x: 0, y: 0 }
let touchHold = false
if (isTouch) {
  const el = $('stick'), knob = $('knob'), R = 52
  const set = e => { const r = el.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d } knob.style.transform = `translate(${dx}px,${dy}px)`; stick.x = dx / R; stick.y = dy / R }
  el.addEventListener('pointerdown', e => { stick.id = e.pointerId; el.setPointerCapture(e.pointerId); set(e); ensureAudio() })
  el.addEventListener('pointermove', e => { if (e.pointerId === stick.id) set(e) })
  const end = e => { if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knob.style.transform = '' }
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end)
  canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || look.id !== null) return; look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; ensureAudio() })
  canvas.addEventListener('pointermove', e => { if (e.pointerId !== look.id) return; const k = 0.0045 * (camera.fov / BASE_FOV); yaw -= (e.clientX - look.x) * k; pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - look.y) * k)); look.x = e.clientX; look.y = e.clientY })
  const endLook = e => { if (e.pointerId === look.id) look.id = null }
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook)
  const btn = (id, down, up) => { const b = $(id); b.addEventListener('pointerdown', e => { e.preventDefault(); ensureAudio(); down(); b.classList.add('on') }); const u = () => { b.classList.remove('on'); up && up() }; b.addEventListener('pointerup', u); b.addEventListener('pointercancel', u); b.addEventListener('pointerleave', u) }
  btn('tFire', () => { pressed.fire = true })
  btn('tScope', () => setScope(!scoped))
  btn('tBreath', () => { touchHold = true; if (scoped) SFX.breathIn() }, () => { if (touchHold && scoped) SFX.breathOut(); touchHold = false })
  btn('tStance', () => { pressed.stance = state.units[0].stance === 'crouch' ? 'stand' : 'crouch' })
  btn('tProne', () => { pressed.stance = state.units[0].stance === 'prone' ? 'crouch' : 'prone' })
  btn('tReload', () => { pressed.reload = true })
  btn('tJump', () => { pressed.jump = true; if (scoped && state.units[0].stance === 'stand') setScope(false) })
  btn('tZoomUp', () => { pressed.zero = 1 }); btn('tZoomDn', () => { pressed.zero = -1 })
}
function readInput() {
  let x = stick.x, z = stick.y
  if (keys.has('KeyA')) x -= 1; if (keys.has('KeyD')) x += 1; if (keys.has('KeyW')) z -= 1; if (keys.has('KeyS')) z += 1
  const shift = keys.has('ShiftLeft') || keys.has('ShiftRight')
  return { mx: x, mz: z, yaw, pitch, scoped, hold: (shift || touchHold) && scoped, sprint: shift && !scoped }
}

// ================================================================ HUD
const N_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
{
  // 方位の帯: 0〜720度ぶんの目盛り（ずらして使う）
  let h = ''
  for (let d = -360; d <= 720; d += 15) { const n = ((d % 360) + 360) % 360; h += `<span style="position:absolute;left:${(d + 360) * 4}px;transform:translateX(-50%);font-size:${n % 45 ? 9 : 12}px;color:${n % 45 ? 'rgba(233,228,214,.45)' : '#e9e4d6'}">${n % 45 ? '|' : N_DIRS[n / 45]}</span>` }
  $('compassStrip').innerHTML = h
}
function drawRing() {
  // スコープの縁と十字・ミルドット（1目盛り = 1ミル）。今の倍率での1ミルの画面上の長さで描く
  const w = innerWidth, h = innerHeight, r = Math.min(w, h) * 0.46
  const pxPerRad = (h / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const mil = pxPerRad * 0.001
  let dots = ''
  const every = mil < 7 ? 2 : 1 // 目盛りが詰まりすぎるときは2ミルおき
  for (let i = -10; i <= 10; i++) { if (!i || i % every) continue; const p = i * mil; if (Math.abs(p) > r * 0.9) continue; dots += `<circle cx="${w / 2 + p}" cy="${h / 2}" r="1.8" fill="#111"/><circle cx="${w / 2}" cy="${h / 2 + p}" r="1.8" fill="#111"/>`; if (i > 0 && i % 2 === 0) dots += `<text x="${w / 2 + 6}" y="${h / 2 + p + 4}" font-size="9" fill="#111" font-family="Chakra Petch">${i}</text>` }
  // 接眼部の影: 目の位置がずれると縁から黒い三日月が入る（止まっていれば見えない）
  $('scopeShadow').style.background = `radial-gradient(circle at center, rgba(0,0,0,0) ${Math.round(r * 0.9)}px, rgba(0,0,0,.96) ${Math.round(r * 1.02)}px)`
  ringR = r
  $('ringSvg').setAttribute('viewBox', `0 0 ${w} ${h}`)
  $('ringSvg').innerHTML = `<defs><mask id="m"><rect width="${w}" height="${h}" fill="#fff"/><circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="#000"/></mask>
    <radialGradient id="v" cx="50%" cy="50%" r="50%"><stop offset="80%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".75"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="#000" mask="url(#m)"/>
    <circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="url(#v)"/>
    <path d="M${w / 2 - r} ${h / 2}H${w / 2 - 14}M${w / 2 + 14} ${h / 2}H${w / 2 + r}M${w / 2} ${h / 2 - r}V${h / 2 - 14}M${w / 2} ${h / 2 + 14}V${h / 2 + r}" stroke="#111" stroke-width="1.4"/>
    <path d="M${w / 2 - r} ${h / 2}H${w / 2 - r * 0.55}M${w / 2 + r * 0.55} ${h / 2}H${w / 2 + r}M${w / 2} ${h / 2 + r * 0.55}V${h / 2 + r}" stroke="#111" stroke-width="5"/>
    ${dots}<circle cx="${w / 2}" cy="${h / 2}" r="1.2" fill="#c0392b"/>`
}
let hud = {}, ringR = 300
const mini = $('mini'), mctx = mini.getContext('2d')
let miniN = 0
function drawMini(st) {
  if (++miniN % 3) return
  const me = st.units[0], W = mini.width, R = W / 2, range = 450, sc = R / range, x = mctx
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, W)
  x.save(); x.beginPath(); x.arc(R, R, R, 0, 7); x.clip()
  x.fillStyle = 'rgba(13,18,16,.72)'; x.fillRect(0, 0, W, W)
  // 自分を中心に、向いている方を上に（画面右 = カメラの右）
  x.translate(R, R); x.rotate(Math.PI + yaw); x.scale(sc, sc); x.translate(-me.x, -me.z) // 前が上・カメラの右が右（4方向で検算済み）
  x.fillStyle = 'rgba(200,205,195,.35)'
  for (const b of S.WORLD.buildings) x.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d)
  x.fillStyle = 'rgba(160,140,110,.55)'
  for (const h of S.WORLD.huts) x.fillRect(h.x - h.w / 2, h.z - h.d / 2, h.w, h.d)
  // 安全地帯（今の円と、縮む先の円）
  const z = st.zone
  if (z) {
    x.lineWidth = 3 / sc; x.strokeStyle = 'rgba(80,170,255,.9)'; x.beginPath(); x.arc(z.x, z.z, z.r, 0, 7); x.stroke()
    if (z.phase === 'shrink' && z.to) { x.setLineDash([10 / sc, 8 / sc]); x.strokeStyle = 'rgba(255,255,255,.75)'; x.beginPath(); x.arc(z.to.x, z.to.z, z.to.r, 0, 7); x.stroke(); x.setLineDash([]) }
  }
  // 撃った敵（時間で薄くなる）
  for (const p of pings) { const k = 1 - p.t / PING_T; x.fillStyle = `rgba(217,72,59,${k.toFixed(2)})`; x.beginPath(); x.arc(p.x, p.z, 7 / sc, 0, 7); x.fill(); x.strokeStyle = `rgba(255,140,120,${(k * 0.8).toFixed(2)})`; x.lineWidth = 1.5 / sc; x.beginPath(); x.arc(p.x, p.z, (8 + (1 - k) * 14) / sc, 0, 7); x.stroke() }
  x.restore()
  // 自分（真ん中の三角）と、外周の方角 N
  x.fillStyle = '#e9e4d6'; x.beginPath(); x.moveTo(R, R - 8); x.lineTo(R + 6, R + 6); x.lineTo(R - 6, R + 6); x.closePath(); x.fill()
  x.fillStyle = '#f2b33d'; x.font = '700 20px Chakra Petch'; x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText('N', R + Math.sin(yaw) * (R - 16), R - Math.cos(yaw) * (R - 16)) // 北（+z）は上の回転で (sin yaw, -cos yaw) に来る
}
function drawHud(st) {
  const me = st.units[0]
  drawMini(st)
  if (st.zone) {
    const z = st.zone, t = Math.max(0, Math.ceil(z.t)), mmss = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
    const txt = z.phase === 'shrink' ? `安全地帯 縮小中 ${mmss}` : z.t > 1e8 ? '安全地帯 最終' : `次の縮小まで ${mmss}`
    if (hud.zone !== txt) { hud.zone = txt; $('zoneInfo').textContent = txt; $('zoneInfo').classList.toggle('shrink', z.phase === 'shrink') }
    if (hud.out !== !!me.outside) { hud.out = !!me.outside; $('outWarn').hidden = !me.outside }
  }
  const bdeg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360 // 北（+z）を0度、時計回り（東 = -x 側を見る向き）
  $('compassStrip').style.transform = `translateX(${-((bdeg + 360) * 4) + $('compass').clientWidth / 2}px)`
  $('bearing').textContent = String(Math.round(bdeg) % 360).padStart(3, '0') + '°'
  // 風: 自分の向きから見た風向き
  const rel = st.wind.dir - yaw
  $('windArrow').setAttribute('transform', `rotate(${-rel * 180 / Math.PI + 180})`)
  $('windTxt').textContent = st.wind.speed.toFixed(1) + ' m/s'
  // 体力・姿勢・弾・ゼロイン
  const hp = Math.min(1, Math.max(0, me.hp) / S.PLAYER_HP)
  if (hud.hp !== hp) { hud.hp = hp; $('hpBar').firstElementChild.style.transform = `scaleX(${hp})`; $('hpBar').classList.toggle('low', hp < 0.5) }
  if (hud.st !== me.stance) { hud.st = me.stance; $('stanceUse').setAttribute('href', '#s-' + me.stance); $('stanceTxt').textContent = { stand: '立ち', crouch: 'しゃがみ', prone: '伏せ' }[me.stance] }
  const ammo = me.ammo + '/' + me.reloadT
  if (hud.ammo !== ammo) { hud.ammo = ammo; $('rounds').innerHTML = Array.from({ length: S.MAG }, (_, i) => `<i class="${i < me.ammo ? '' : 'out'}"></i>`).join('') }
  $('bolt').textContent = me.reloadT > 0 ? `装填中 ${me.ammo}/${S.MAG}` : me.boltT > 0 ? 'ボルト操作' : me.ammo === 0 ? '弾切れ R' : ''
  if (hud.zero !== me.zero) { hud.zero = me.zero; $('zeroBig').textContent = me.zero; $('zeroTxt').textContent = 'ZERO ' + me.zero }
  const enemies = st.units.filter(u => !u.player).map(u => u.alive ? 1 : 0).join('')
  if (hud.en !== enemies) { hud.en = enemies; $('enemies').innerHTML = [...enemies].map(a => `<i class="${a === '1' ? '' : 'dead'}"></i>`).join('') + `<span class="tag mono" style="margin-left:6px">${[...enemies].filter(a => a === '1').length} 残り</span>` }
  if (scoped) {
    const r = S.rangeFind(st, me, yaw + me.swayX, pitch + me.swayY)
    $('rangeTxt').textContent = r ? Math.round(r) + ' m' : '--- m'
    $('zoomTxt').textContent = 'x' + ZOOMS[zoomI]
    $('breath').firstElementChild.style.transform = `scaleX(${me.breath / S.BREATH_MAX})`
    $('breath').classList.toggle('low', me.breath < 1.5)
  }
  $('hint').hidden = !(st.t < 14) || scoped // 構えている間は下の数字と重なるので出さない
}
function feed(html, bad) { const d = document.createElement('div'); d.className = 'feed' + (bad ? ' bad' : ''); d.innerHTML = html; $('feed').prepend(d); setTimeout(() => d.remove(), 3200); while ($('feed').children.length > 3) $('feed').lastElementChild.remove() }

// ================================================================ 試合の進行
let difficulty = 1, stage = 'valley'
try { if (localStorage.getItem('rl-stage') === 'city') stage = 'city' } catch {}
function setStageOpt(k) { stage = k; try { localStorage.setItem('rl-stage', k) } catch {} for (const b of document.querySelectorAll('.sopt')) b.setAttribute('aria-pressed', String(b.dataset.s === k)); if (mode === 'title' && S.STAGE !== k) { S.setStage(k); buildScene() } }
try { difficulty = +localStorage.getItem('rl-diff') || 1 } catch {}
function setDiff(d) { difficulty = d; try { localStorage.setItem('rl-diff', d) } catch {} for (const b of document.querySelectorAll('.opt:not(.sopt)')) b.setAttribute('aria-pressed', String(+b.dataset.d === d)) }
for (const b of document.querySelectorAll('.opt:not(.sopt)')) b.addEventListener('click', () => setDiff(+b.dataset.d))
for (const b of document.querySelectorAll('.sopt')) b.addEventListener('click', () => setStageOpt(b.dataset.s))
setDiff(difficulty)
setStageOpt(stage)
function start() {
  ensureAudio()
  for (const v of enemyViews) if (v) scene.remove(v.g, v.glint) // 0番（自分）は空き
  enemyViews.length = 0
  for (const t of trails) scene.remove(t.l); trails.length = 0
  pings.length = 0
  for (const d of dust) scene.remove(d.s); dust.length = 0
  if (S.STAGE !== stage) { S.setStage(stage); buildScene() }
  state = S.createState(Date.now() % 100000, { difficulty, stage })
  for (const u of state.units) if (!u.player) enemyViews[u.id] = makeEnemyView()
  const me = state.units[0]
  yaw = 0; pitch = -0.05; setScope(false); zoomI = 0; viewRifle.visible = true; killcam = null
  mode = 'play'
  $('title').hidden = true; $('result').hidden = true; $('hud').hidden = false; $('touch').hidden = !isTouch
  updateRotate()
  hud = {}
  drawRing()
  if (isTouch) { try { const el = document.documentElement; const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); if (p && p.then) p.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {}) } catch {} }
}
function showResult() {
  mode = 'result'
  const st = state, s = st.stats, win = st.result === 'win'
  $('resEye').textContent = win ? 'MISSION COMPLETE' : 'KILLED IN ACTION'
  $('resTitle').textContent = win ? 'CLEAR' : 'DOWN'
  $('resTitle').className = win ? '' : 'lose'
  $('rKills').textContent = `${s.kills} / ${st.enemyN}`
  $('rLong').textContent = Math.round(s.longest) + ' m'
  $('rAcc').textContent = s.shots ? Math.round(s.hits / s.shots * 100) + '%' : '-'
  $('rHead').textContent = s.headshots
  $('hud').hidden = true; $('touch').hidden = true; $('result').hidden = false
  if (pointerLocked) document.exitPointerLock()
}
$('startBtn').addEventListener('click', start)
$('againBtn').addEventListener('click', start)
const portraitQ = matchMedia('(orientation: portrait)')
function updateRotate() { $('rotate').hidden = !(isTouch && portraitQ.matches && mode === 'play') }
portraitQ.addEventListener?.('change', updateRotate)

function handleEvents(evs) {
  const me = state.units[0]
  for (const e of evs) {
    const dx = (e.x ?? me.x) - me.x, dz = (e.z ?? me.z) - me.z, d = Math.hypot(dx, dz)
    const rgt = { x: -Math.cos(yaw), z: Math.sin(yaw) }, pan = d > 1 ? Math.max(-1, Math.min(1, (dx * rgt.x + dz * rgt.z) / d)) : 0
    switch (e.type) {
      case 'shot':
        if (e.id === 0) {
          SFX.shot(); SFX.bolt(); kick = 1
          addPuff(e.x + e.dx * 1.2, e.y + e.dy * 1.2 - 0.1, e.z + e.dz * 1.2, '#cfc8b8', 0.8, 0.6)
          // 弾の筋（空気の揺らぎ）: 遠くまで薄く
          const pts = [new THREE.Vector3(e.x, e.y - 0.05, e.z), new THREE.Vector3(e.x + e.dx * 4, e.y + e.dy * 4 - 0.05, e.z + e.dz * 4)]
          const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#e8e2d0', transparent: true, opacity: 0.35, fog: false }))
          l.frustumCulled = false; scene.add(l); trails.push({ l, t: 0, bullet: state.bullets[state.bullets.length - 1], pts: [pts[0]] })
        } else {
          SFX.far(d, pan)
          pings.push({ id: e.id, x: e.x, z: e.z, t: 0 })
          // 銃口の光と煙（遠くでも見える）
          const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex(), color: '#ffd38a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false, fog: false }))
          fl.position.set(e.x + e.dx, e.y + e.dy, e.z + e.dz); fl.scale.set(0.05, 0.05, 1); scene.add(fl); dust.push({ s: fl, t: 0, life: 0.09, size: 0.05, flash: true })
          addPuff(e.x + e.dx * 1.5, e.y, e.z + e.dz * 1.5, '#d8d2c2', 1.6, 1.4)
        }
        break
      case 'impact':
        {
          // 着弾の土煙: 自分の弾は遠くでも読めるよう大きく長く（外れた方向を見て修正できる）
          const own = e.owner === 0, col = e.kind === 'ground' ? '#4e3d2b' : e.kind === 'hut' ? '#b8b0a2' : '#6f7d4c'
          addPuff(e.x, e.y + 0.25, e.z, col, own ? 1.8 : 1.0, own ? 2.4 : 1.2, 1); if (own) addPuff(e.x, e.y + 0.9, e.z, '#c9b99a', 1.2, 1.8, 0.7) // 濃い土と、舞い上がる明るい砂ぼこり
          if (own) { addPuff(e.x, e.y + 0.6, e.z, col, 0.8, 1.6, 0.8); for (let i = 0; i < 6; i++) addPuff(e.x + (Math.random() - 0.5), e.y + 0.4 + Math.random() * 1.2, e.z + (Math.random() - 0.5), '#5c4a36', 0.25, 0.7, 1) }
        }
        if (e.owner === 0) SFX.impact(d, pan); else if (d < 60) SFX.impact(d, pan)
        break
      case 'snap': SFX.snap(pan); break
      case 'hit':
        if (e.by === 0) { $('hit').classList.remove('on'); void $('hit').offsetWidth; $('hit').classList.add('on'); SFX.hitMark(e.dist) ; addPuff(e.x, e.y, e.z, '#8a2a20', 0.7, 0.5) }
        if (e.id === 0) {
          SFX.hurt(); $('dmg').classList.add('on'); setTimeout(() => $('dmg').classList.remove('on'), 120)
          const shooter = state.units[e.by], a = Math.atan2(shooter.x - me.x, shooter.z - me.z) - yaw
          $('dmgArc').setAttribute('d', `M ${Math.sin(-a - 0.3) * 95} ${-Math.cos(-a - 0.3) * 95} A 95 95 0 0 1 ${Math.sin(-a + 0.3) * 95} ${-Math.cos(-a + 0.3) * 95}`)
          $('dmgDir').style.transition = 'none'; $('dmgDir').style.opacity = 1; requestAnimationFrame(() => { $('dmgDir').style.transition = 'opacity 1.6s'; $('dmgDir').style.opacity = 0 })
          if (scoped) setScope(false)
        }
        break
      case 'kill':
        if (e.by < 0 && e.id !== 0 && e.part !== 'fall') feed(`${state.units[e.id].name} が安全地帯の外で倒れた`)
        if (e.id === 0 && e.part === 'fall') { feed('<b>高い所から落ちた</b>', true); break }
        if (e.by === 0) { SFX.kill(); feed(`${e.part === 'head' ? 'ヘッドショット' : '命中'}　<b>${Math.round(e.dist)} m</b>　${state.units[e.id].name} を倒した`) }
        if (e.id === 0 && e.by < 0) feed('<b>安全地帯の外で倒れた</b>', true)
        if (e.id === 0 && e.by >= 0) {
          feed(`<b>撃たれた</b>　${Math.round(e.dist)} m 先の ${state.units[e.by].name}`, true)
          // 倒された相手を見せる: 撃った敵の方へ向き、スコープで寄る（銃口の煙が見える）
          const k = state.units[e.by]; killcam = { yaw: Math.atan2(k.x - me.x, k.z - me.z), pitch: Math.atan2(k.y + 1 - (me.y + 0.5), Math.hypot(k.x - me.x, k.z - me.z)), t: 0 }
        }
        break
      case 'aim': break
      case 'zone': if (e.phase === 'shrink') feed('安全地帯が <b>縮み始めた</b>'); break
      case 'reload': SFX.round(0.15); break
      case 'round': SFX.round(); break
      case 'dry': SFX.dry(); break
      case 'jump': if (e.id === 0) SFX.step(0.5, 0, 0); break
      case 'land': if (e.id === 0) { SFX.step(Math.min(1.2, 0.5 + e.v / 6), 0, 0); kick = Math.max(kick, Math.min(1, e.v / 8)); if (e.v > 9) { SFX.hurt(); $('dmg').classList.add('on'); setTimeout(() => $('dmg').classList.remove('on'), 160) } } break
      case 'over': setTimeout(showResult, e.result === 'lose' ? 4200 : 2600); if (scoped && e.result === 'win') setScope(false); break
    }
  }
}

// ================================================================ 毎フレーム
let kick = 0, swayView = { x: 0, y: 0 }, killcam = null
const pose = { run: 0, rel: 0 }, eyeOff = { x: 0, y: 0, px: 0, py: 0 }
const pings = [] // 撃った敵: ミニマップに一定時間出す
const PING_T = 10
const stepAcc = {}
function fixedStep() {
  const input = { ...readInput(), ...pressed }
  for (const k in pressed) delete pressed[k]
  if (input.fire && scoped) {} // 構え中の発射はそのまま
  S.step(state, input)
  handleEvents(S.drainEvents(state))
}
function updateViews(dt) {
  const st = state, me = st.units[0]
  for (const u of st.units) {
    if (u.player) continue
    const v = enemyViews[u.id]
    v.g.position.set(u.x, u.y, u.z); v.g.rotation.y = u.yaw
    // 姿勢: 伏せは前に倒し、しゃがみは低く。倒れたら横たわる
    const tilt = !u.alive ? -Math.PI / 2 : u.stance === 'prone' ? Math.PI / 2 : 0
    v.body.rotation.x += (tilt - v.body.rotation.x) * Math.min(1, dt * (u.alive ? 6 : 3))
    v.body.position.y = u.alive && u.stance === 'prone' ? 0.25 : 0
    v.body.scale.y = u.alive && u.stance === 'crouch' ? 0.66 : 1
    v.body.position.z = u.alive && u.stance === 'prone' ? -0.8 : 0
    // スコープの光: 構えていて、こちらを向いているほど強い（日の向きでもちらつく）
    const e = S.eyeOf(u), toMe = Math.atan2(me.x - u.x, me.z - u.z), face = Math.cos(toMe - u.yaw)
    const on = u.alive && u.aiming && face > 0.8
    v.glint.visible = on
    if (on) { v.glint.position.set(e.x + Math.sin(u.yaw) * 0.4, e.y + 0.02, e.z + Math.cos(u.yaw) * 0.4); const k = (face - 0.8) * 5 * (0.6 + 0.4 * Math.sin(performance.now() / 90)); v.glint.material.opacity = Math.min(1, k); v.glint.scale.setScalar(0.006 + 0.008 * Math.min(1, k)) } // 小さくきらっと光る程度
  }
  if (grassF) grassF.update(me.x, me.z, me.stance === 'prone', st.t, st.wind.x, st.wind.z)
  // 弾の筋は弾を追いかけて伸び、薄れて消える
  for (let i = trails.length - 1; i >= 0; i--) {
    const t = trails[i]; t.t += dt
    if (t.bullet && st.bullets.includes(t.bullet) && t.pts.length < 60) { t.pts.push(new THREE.Vector3(t.bullet.x, t.bullet.y, t.bullet.z)); t.l.geometry.dispose(); t.l.geometry = new THREE.BufferGeometry().setFromPoints(t.pts) }
    t.l.material.opacity = 0.35 * Math.max(0, 1 - t.t / 1.6)
    if (t.t > 1.6) { scene.remove(t.l); t.l.geometry.dispose(); trails.splice(i, 1) }
  }
  for (let i = dust.length - 1; i >= 0; i--) {
    const d = dust[i]; d.t += dt
    const k = d.t / d.life
    if (!d.flash) { d.s.scale.setScalar(d.size * (1 + k * 2.5)); d.s.position.y += dt * 0.6 }
    d.s.material.opacity = (d.flash ? 1 : d.op ?? 0.6) * Math.max(0, 1 - k * k)
    if (d.t > d.life) { scene.remove(d.s); d.s.material.dispose(); dust.splice(i, 1) }
  }
  // 足音（自分と、70m 以内で動いている敵）
  if (actx) for (const u of st.units) {
    if (!u.alive) continue
    const sp = u.player ? Math.hypot(u.vx, u.vz) : (u.ai && u.ai.moveTo ? (u.stance === 'stand' ? S.SPEED.stand : S.SPEED.crouch) : 0)
    if (sp < 0.3) continue
    const dx = u.x - me.x, dz = u.z - me.z, d = Math.hypot(dx, dz)
    if (!u.player && d > 70) continue
    stepAcc[u.id] = (stepAcc[u.id] || 0) + sp * dt
    const stride = u.stance === 'prone' ? 1.2 : u.stance === 'crouch' ? 0.65 : 0.8
    if (stepAcc[u.id] < stride) continue
    stepAcc[u.id] = 0
    const rgt = { x: -Math.cos(yaw), z: Math.sin(yaw) }, pan = u.player ? 0 : Math.max(-1, Math.min(1, (dx * rgt.x + dz * rgt.z) / (d || 1)))
    const vol = u.player ? 0.35 : Math.max(0, 1 - d / 70) * (u.stance === 'stand' ? 1 : 0.55)
    SFX.step(vol, pan, u.player ? 0 : Math.min(1, d / 90))
  }
  for (let i = pings.length - 1; i >= 0; i--) if ((pings[i].t += dt) > PING_T) pings.splice(i, 1)
  // 安全地帯の壁
  if (st.zone) { const edge = Math.abs(Math.hypot(me.x - st.zone.x, me.z - st.zone.z) - st.zone.r); zoneWall.visible = edge < 220; zoneWall.material.opacity = 0.22 * Math.max(0, 1 - edge / 220); zoneWall.position.set(st.zone.x, 60, st.zone.z); zoneWall.scale.set(st.zone.r, 240, st.zone.r) } // 壁は縁に近いときだけ見せる（遠くの壁が空に帯のように映るため）
  if (windGain && actx) { windGain.gain.setTargetAtTime(0.012 + st.wind.speed * 0.006, actx.currentTime, 0.5); windFilter.frequency.setTargetAtTime(250 + st.wind.speed * 60, actx.currentTime, 0.5) }
}
function applyCamera(dt) {
  const st = state, me = st.units[0]
  const eye = S.eyeOf(me)
  // 視点は目の高さ。歩くと少し揺れる
  const bob = Math.sin(st.t * 9) * Math.min(1, Math.hypot(me.vx, me.vz) / 4) * 0.04
  camera.position.set(eye.x, eye.y + bob, eye.z)
  // 構えているときは息の揺れ（ロジックと同じ値）をそのまま画面に出す。見えている所に弾が出る
  swayView.x += ((scoped ? me.swayX : me.swayX * 0.3) - swayView.x) * Math.min(1, dt * 20)
  swayView.y += ((scoped ? me.swayY : me.swayY * 0.3) - swayView.y) * Math.min(1, dt * 20)
  if (scoped) {
    // 揺れの速さ・歩き・反動で目と接眼レンズの位置がずれる
    const vx = (swayView.x - eyeOff.px) / Math.max(dt, 1e-3), vy = (swayView.y - eyeOff.py) / Math.max(dt, 1e-3)
    const mv = Math.min(1, Math.hypot(me.vx, me.vz) / 2)
    const tx = -vx * ringR * 1.6 + Math.sin(st.t * 7) * mv * ringR * 0.12, ty = vy * ringR * 1.6 + kick * ringR * 0.28 + Math.abs(Math.sin(st.t * 7)) * mv * ringR * 0.1
    const lim = ringR * 0.35, k = Math.min(1, dt * 10)
    eyeOff.x += (Math.max(-lim, Math.min(lim, tx)) - eyeOff.x) * k; eyeOff.y += (Math.max(-lim, Math.min(lim, ty)) - eyeOff.y) * k
    $('scopeShadow').style.transform = `translate(${eyeOff.x.toFixed(1)}px,${eyeOff.y.toFixed(1)}px)`
  }
  eyeOff.px = swayView.x; eyeOff.py = swayView.y
  const ly = yaw + swayView.x, lp = pitch + swayView.y + kick * 0.02
  camera.lookAt(eye.x + Math.sin(ly) * Math.cos(lp), eye.y + bob + Math.sin(lp), eye.z + Math.cos(ly) * Math.cos(lp))
  kick = Math.max(0, kick - dt * 5)
  if (killcam) { killcam.t += dt; if (killcam.t > 0.6) { yaw += ((killcam.yaw - yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 3); pitch += (killcam.pitch - pitch) * Math.min(1, dt * 3); if (killcam.t > 1.1 && !scoped) { setScope(true); zoomI = 0 } } }
  const want = scoped ? BASE_FOV / ZOOMS[zoomI] : BASE_FOV
  if (Math.abs(camera.fov - want) > 0.01) { camera.fov += (want - camera.fov) * Math.min(1, dt * 18); camera.updateProjectionMatrix(); if (scoped) drawRing() }
  // 手元の銃: 撃ったあとのボルト操作、装填中は開いて傾ける、走ると銃口を下げる、止まっていても呼吸でわずかに揺れる
  const open = me.reloadT > 0, be = me.boltT > 0 ? S.BOLT_T - me.boltT : 99, cyc = animateBolt(rifle, be, open)
  // 薬莢: ボルトを引き切ったところで右へ飛び出す
  if (be >= 0.62 && be < 2 && !brass.out) { brass.out = true; brass.m.visible = true; brass.m.position.set(0.04, 0.03, -0.1); brass.v.set(1.1 + Math.random() * 0.4, 1.0 + Math.random() * 0.4, 0.3); brass.t = 0 }
  if (be < 0.62) brass.out = false
  if (brass.m.visible) { brass.t += dt; brass.v.y -= 9.8 * dt * 0.6; brass.m.position.addScaledVector(brass.v, dt); brass.m.rotation.x += dt * 22; brass.m.rotation.z += dt * 9; if (brass.t > 0.7) brass.m.visible = false }
  const sp = Math.hypot(me.vx, me.vz)
  pose.run += ((sp > 4.5 ? 1 : 0) - pose.run) * Math.min(1, dt * 7)
  pose.rel += ((open ? 1 : 0) - pose.rel) * Math.min(1, dt * 6)
  const br = Math.sin(st.t * 1.3) * 0.004, run = pose.run
  viewRifle.position.set(0.15 + Math.sin(st.t * 4.5) * bob * 0.6 - run * 0.02, -0.17 + bob * 0.5 + br - kick * 0.025 - cyc * 0.015 - run * 0.05 - pose.rel * 0.03, -0.36 + kick * 0.06 + pose.rel * 0.04)
  viewRifle.rotation.set(kick * 0.14 - run * 0.32 + pose.rel * 0.18 + br * 0.5, run * 0.55 + pose.rel * 0.15, cyc * 0.22 + pose.rel * 0.55)
  sun.target.position.set(me.x, me.y, me.z)
  sun.position.set(me.x + SUN.x * 200, me.y + SUN.y * 200, me.z + SUN.z * 200)
  sky.position.copy(camera.position)
}
function render() { renderer.render(scene, camera) }
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (scoped) drawRing() }
addEventListener('resize', resize)
resize()

let last = performance.now(), acc = 0, titleT = 0
function frame(now) {
  requestAnimationFrame(frame)
  let dt = Math.min(0.25, (now - last) / 1000); last = now
  if (mode === 'title') {
    // タイトル: 谷をゆっくり見渡す
    titleT += dt
    viewRifle.visible = false // タイトルでは自分の銃を写さない
    camera.fov = BASE_FOV; camera.updateProjectionMatrix()
    const a = titleT * 0.03, x = Math.sin(a) * 320, z = -420 + Math.cos(a) * 120
    camera.position.set(x, S.heightAt(x, z) + (S.STAGE === 'city' ? 70 : 24), z); camera.lookAt(0, S.STAGE === 'city' ? 30 : 40, 150)
    sun.target.position.set(x, 0, z); sun.position.set(x + SUN.x * 200, SUN.y * 200, z + SUN.z * 200); sky.position.copy(camera.position)
    render(); return
  }
  if (mode === 'play' || mode === 'over') {
    if (!paused) { acc += dt; let n = 0; while (acc >= S.STEP && n++ < 8) { fixedStep(); acc -= S.STEP } }
    if (state.phase === 'over' && mode === 'play') mode = 'over'
    updateViews(dt); applyCamera(dt); render(); if (mode === 'play') drawHud(state)
    return
  }
  render()
}
mode = 'title'
$('loading').hidden = true
$('title').hidden = false
window.__rlReady = true
requestAnimationFrame(frame)

// ================================================================ 検証用 API
window.__rlLos = (a, b) => S.lineOfSight(a.x, a.y, a.z, b.x, b.y, b.z, 0)
window.rl = {
  get mode() { return mode },
  raw: () => state,
  zoom(i) { zoomI = i },
  pings: () => pings.length,
  h: (x, z) => S.heightAt(x, z),
  start(opts = {}) { start(); if (opts.enemies !== undefined || opts.seed) { state = S.createState(opts.seed ?? 7, { difficulty, stage, ...opts }); for (const v of enemyViews) if (v) scene.remove(v.g, v.glint); enemyViews.length = 0; for (const u of state.units) if (!u.player) enemyViews[u.id] = makeEnemyView() } },
  pause(v = true) { paused = v },
  look(y, p) { yaw = y; pitch = p },
  scope(v) { setScope(v) },
  run(n, input = {}) { for (let i = 0; i < n; i++) { Object.assign(pressed, i === 0 ? input : {}); const keep = { ...input }; delete keep.fire; delete keep.jump; delete keep.stance; delete keep.zero; delete keep.reload; const inp = { ...readInput(), ...keep, ...pressed }; for (const k in pressed) delete pressed[k]; S.step(state, inp); handleEvents(S.drainEvents(state)) } updateViews(1 / 60); applyCamera(1 / 60); render(); drawHud(state) },
  // 敵の胴へ弾道どおりに狙う向きを返す（風は無視）。テスト用
  aimAt(id) { const me = state.units[0], e = state.units[id], eye = S.eyeOf(me), p = S.bodyPoints(e).b; const dx = p[0] - eye.x, dy = p[1] - 0.25 - eye.y, dz = p[2] - eye.z, hd = Math.hypot(dx, dz); yaw = Math.atan2(dx, dz); pitch = Math.atan2(dy, hd); return hd },
  coverage() { if (state && mode !== "title") { updateViews(0); applyCamera(0) } render(); const c = document.createElement('canvas'); c.width = 64; c.height = 40; const x = c.getContext('2d'); x.drawImage(renderer.domElement, 0, 0, 64, 40); const d = x.getImageData(0, 0, 64, 40).data; let s = 0, s2 = 0; for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; s += v; s2 += v * v } const n = d.length / 4, m = s / n; return { mean: +m.toFixed(1), std: +Math.sqrt(s2 / n - m * m).toFixed(1) } },
  info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles } },
  render() { updateViews(1 / 60); applyCamera(1 / 60); render() },
}

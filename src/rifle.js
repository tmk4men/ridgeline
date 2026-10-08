// 自分のボルトアクション狙撃銃（手に持った姿）。寸法は実銃に近いメートル単位。前が -z
import * as THREE from 'three'

function grainTex() {
  // 木目: 細い縞を揺らがせ、ところどころ濃い節を入れる
  const c = document.createElement('canvas'); c.width = 512; c.height = 128
  const x = c.getContext('2d'), img = x.createImageData(512, 128)
  for (let j = 0; j < 128; j++) for (let i = 0; i < 512; i++) {
    const w = Math.sin(j * 0.55 + Math.sin(i * 0.013) * 3 + Math.sin(i * 0.051 + j * 0.02) * 0.8)
    const v = 0.78 + w * 0.1 + (Math.random() - 0.5) * 0.06
    const k = (j * 512 + i) * 4
    img.data[k] = 150 * v; img.data[k + 1] = 104 * v; img.data[k + 2] = 66 * v; img.data[k + 3] = 255
  }
  x.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8
  return t
}

export function buildRifle() {
  const g = new THREE.Group()
  const steel = new THREE.MeshStandardMaterial({ color: '#1d1f22', metalness: 0.85, roughness: 0.32 })
  const matte = new THREE.MeshStandardMaterial({ color: '#17181a', metalness: 0.55, roughness: 0.55 })
  const wood = new THREE.MeshStandardMaterial({ map: grainTex(), color: '#9c8068', roughness: 0.5, metalness: 0 })
  const glass = new THREE.MeshStandardMaterial({ color: '#284052', metalness: 1, roughness: 0.04, envMapIntensity: 2.2 })
  const glove = new THREE.MeshStandardMaterial({ color: '#45473c', roughness: 0.95 })
  const add = (geo, m, x = 0, y = 0, z = 0, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o }
  const cylZ = (r1, r2, len, seg = 20) => new THREE.CylinderGeometry(r1, r2, len, seg).rotateX(-Math.PI / 2) // r1 が奥(-z)側

  // 銃床: 横から見た輪郭を押し出す（床尾・頬当て・握り・先台）。x = 前方向、y = 高さ
  const s = new THREE.Shape()
  s.moveTo(-0.40, -0.075)            // 床尾の下
  s.lineTo(-0.40, 0.035)             // 床尾の上
  s.quadraticCurveTo(-0.30, 0.045, -0.16, 0.03) // 頬当て
  s.quadraticCurveTo(-0.10, 0.02, -0.075, -0.005)
  s.lineTo(-0.05, -0.01)
  s.lineTo(0.36, -0.005)             // 先台の上辺
  s.quadraticCurveTo(0.40, -0.01, 0.40, -0.03)
  s.lineTo(0.38, -0.045)             // 先台の先
  s.lineTo(0.02, -0.045)
  s.quadraticCurveTo(-0.02, -0.05, -0.04, -0.1) // 握りの前
  s.lineTo(-0.075, -0.115)
  s.quadraticCurveTo(-0.11, -0.06, -0.17, -0.055) // 握りの後ろから細い首へ
  s.quadraticCurveTo(-0.30, -0.065, -0.40, -0.075)
  const stock = new THREE.ExtrudeGeometry(s, { depth: 0.036, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 10 })
  stock.translate(0, 0, -0.018).rotateY(Math.PI / 2) // 前 → -z、厚み → x
  const uv = stock.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.4, uv.getY(i) * 2.5)
  add(stock, wood)
  add(new THREE.BoxGeometry(0.05, 0.115, 0.018), matte, 0, -0.02, 0.405) // 床尾のゴム
  // 機関部・ボルト
  add(cylZ(0.017, 0.017, 0.24), steel, 0, 0.012, -0.11)
  add(new THREE.BoxGeometry(0.034, 0.012, 0.2), steel, 0, -0.002, -0.11)
  const bolt = new THREE.Group(); bolt.position.set(0, 0.012, 0); g.add(bolt) // 機関部の軸で回る
  add(cylZ(0.0085, 0.0085, 0.13), steel, 0, 0, 0.03, bolt)
  const handle = new THREE.Group(); handle.position.set(0, 0, 0.05); bolt.add(handle)
  add(new THREE.CylinderGeometry(0.004, 0.004, 0.055, 8).rotateZ(Math.PI / 2 - 0.5), steel, 0.024, -0.012, 0, handle)
  add(new THREE.SphereGeometry(0.0095, 14, 10), steel, 0.046, -0.026, 0, handle)
  // 銃身（根元が太く先が細い）と制退器
  add(cylZ(0.0085, 0.0125, 0.62, 18), steel, 0, 0.01, -0.54)
  add(cylZ(0.012, 0.012, 0.05, 12), matte, 0, 0.01, -0.875)
  for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.026, 0.004, 0.008), steel, 0, 0.01, -0.86 - i * 0.012)
  // 用心がね・引き金・弾倉の底板
  const guard = add(new THREE.TorusGeometry(0.026, 0.0035, 6, 18, Math.PI), matte, 0, -0.045, -0.035)
  guard.rotation.set(0, Math.PI / 2, Math.PI)
  add(new THREE.BoxGeometry(0.004, 0.022, 0.006), steel, 0, -0.055, -0.03).rotation.x = 0.3
  add(new THREE.BoxGeometry(0.032, 0.006, 0.08), matte, 0, -0.047, -0.11)
  // スコープ: 筒・対物側の太い部分・接眼部・ダイヤル・リング
  const sy = 0.068
  add(cylZ(0.0127, 0.0127, 0.2), matte, 0, sy, -0.12)
  add(cylZ(0.026, 0.0127, 0.06), matte, 0, sy, -0.25)
  add(cylZ(0.026, 0.026, 0.07), matte, 0, sy, -0.315)
  add(cylZ(0.0127, 0.019, 0.04), matte, 0, sy, -0.003)
  add(cylZ(0.019, 0.02, 0.07), matte, 0, sy, 0.05)
  add(new THREE.CircleGeometry(0.023, 24).rotateY(Math.PI), glass, 0, sy, -0.3505) // 対物レンズ
  add(new THREE.CircleGeometry(0.017, 20), glass, 0, sy, 0.0855)
  add(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 16), matte, 0, sy + 0.022, -0.12) // 上下ダイヤル
  add(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 16).rotateZ(Math.PI / 2), matte, 0.022, sy, -0.12) // 左右
  add(new THREE.CylinderGeometry(0.0118, 0.0118, 0.004, 16), steel, 0, sy + 0.038, -0.12)
  for (const z of [-0.2, -0.04]) { add(new THREE.CylinderGeometry(0.0155, 0.0155, 0.016, 16).rotateX(Math.PI / 2), steel, 0, sy, z); add(new THREE.BoxGeometry(0.02, 0.04, 0.016), steel, 0, sy - 0.03, z) }
  // 手: 右手は握り、左手は先台の下（手袋）
  // 腕は手首から肘へ向けて伸ばす（肘は画面の外）
  const hand = (x, y, z, rz, ex, ey, ez) => {
    const h = add(new THREE.BoxGeometry(0.048, 0.07, 0.09), glove, x, y, z); h.rotation.z = rz
    const a = new THREE.Vector3(x, y - 0.01, z), e = new THREE.Vector3(ex, ey, ez), len = a.distanceTo(e)
    const arm = add(new THREE.CapsuleGeometry(0.036, len, 3, 12).rotateX(Math.PI / 2).translate(0, 0, len / 2), glove, a.x, a.y, a.z)
    arm.lookAt(e) // g はまだどこにも付いていないので、ワールド座標 = 銃の座標
  }
  hand(0.03, -0.085, -0.06, -0.25, 0.2, -0.36, 0.22)
  hand(-0.012, -0.075, -0.42, 0.45, -0.3, -0.42, -0.02)
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false } })
  return { g, bolt, handle }
}

// ボルト操作の動き。e = 撃ってからの秒数（BOLT_T まで）。返り値は銃全体の傾き用
export function animateBolt(r, e, open) {
  // 0.30〜0.42 起こす / 0.50〜0.66 引く / 0.84〜0.98 押す / 1.00〜1.12 倒す（音と同じ時刻）
  const k = (a, b) => Math.min(1, Math.max(0, (e - a) / (b - a)))
  let lift = k(0.30, 0.42) - k(1.00, 1.12), back = k(0.50, 0.66) - k(0.84, 0.98)
  if (open) { lift = 1; back = 1 }
  r.bolt.rotation.z = lift * 1.25
  r.bolt.position.z = back * 0.09
  return Math.max(lift, back)
}

// 公開の前に、読み込むファイルへキャッシュバスター（?v=日時）を付け直す。node release.mjs
import { readFileSync, writeFileSync } from 'node:fs'
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12)
for (const [f, re] of [['index.html', /(\.\/src\/main\.js)\?v=\w+/g], ['src/main.js', /(\.\/sim\.js)\?v=\w+/g]]) {
  const s = readFileSync(f, 'utf8'); writeFileSync(f, s.replace(re, `$1?v=${v}`)); console.log(f, '->', v)
}

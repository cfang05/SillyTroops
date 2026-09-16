// 对话存档回归测试运行器（P5）
//
// 把 TypeScript 入口用 esbuild 打包成 CJS 后在当前进程里执行。
// 之所以要打包：被测模块（conversationManager.js）会 import adapter.ts，
// Node 无法直接 require TypeScript。
//
// 运行：npm run smoke:store
const esbuild = require('esbuild')
const path = require('path')
const fs = require('fs')

const entry = path.join(__dirname, 'smoke-conversation-store.ts')
const outfile = path.join(__dirname, '.smoke-conversation-store.out.cjs')

try {
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'warning'
  })

  require(outfile)
} finally {
  // 打包产物不入库
  try { fs.unlinkSync(outfile) } catch (e) { /* ignore */ }
}

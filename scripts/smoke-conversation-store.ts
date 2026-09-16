// 对话存档回归测试（P5：存档格式 v1→v2 迁移 + IndexedDB 分页 + 增量写入）
//
// 为什么要有这个脚本：P5 是整轮改造里风险最高的一步 —— 它同时改了**存档结构**与**存储介质**，
// 出错就是"用户存档丢失"。这里通过桩掉 uni 的同步存储（Node 里没有 IndexedDB → 管理器自动
// 退回 localAdapter），把 init()/迁移/load()/save()/clear() 整条路径在内存里跑通，
// 并断言分页行数与"只重写尾部页"的增量行为。
//
// 运行：npm run smoke:store   （esbuild 打包后执行，运行器见同名 .js；esbuild 由 vite 间接提供）

const store = new Map<string, any>()
const writeLog: string[] = []

;(globalThis as any).uni = {
  getStorageSync: (k: string) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k: string, v: any) => { store.set(k, v); writeLog.push(k) },
  removeStorageSync: (k: string) => { store.delete(k) },
  getStorageInfoSync: () => ({ keys: [...store.keys()] })
}

import conversationManager from '../src/utils/account/conversationManager'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: any) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '') }
}

function msg(i: number) {
  return { role: i % 2 === 0 ? 'user' : 'assistant', content: '消息' + i, swipes: ['消息' + i], swipe_id: 0 }
}

async function main() {
  console.log('\n[1] 预置一条 v1 老档（250 条消息）+ 旧列表键')
  const legacyMessages = Array.from({ length: 250 }, (_, i) => msg(i))
  legacyMessages[0].segments = [{ type: 'narrative', text: '派生数据不应被迁移写入' }] as any
  store.set('u_guest_conversation_list', [{ cardId: 'c1', cardName: '老档', updatedAt: 1, messageCount: 250, lastMessagePreview: '' }])
  store.set('u_guest_conversation_c1', {
    cardId: 'c1', cardName: '老档', presetId: 'p1', regexPresetId: 'system', personaId: '',
    messages: legacyMessages, localVariables: { a: '1' },
    worldInfoState: { sticky: { k: 1 }, cooldown: {}, round: 5 }, trpgState: { hp: 10 }, updatedAt: 111
  })
  check('老档已就位', store.has('u_guest_conversation_c1'))

  console.log('\n[2] init() 应触发 v1→v2 迁移')
  writeLog.length = 0
  await conversationManager.init()
  check('旧数据键已删除', !store.has('u_guest_conversation_c1'))
  check('旧列表键已删除', !store.has('u_guest_conversation_list'))
  check('新 header 已写入', store.has('u_guest_conv_c1'), [...store.keys()].filter(k => k.includes('conv')))
  check('列表缓存可读', conversationManager.getList().length === 1, conversationManager.getList())
  check('has(c1) 为真', conversationManager.has('c1') === true)

  console.log('\n[3] 分页：250 条 → 3 页（100/100/50）')
  const p0 = store.get('u_guest_conv_c1_p0')
  const p1 = store.get('u_guest_conv_c1_p1')
  const p2 = store.get('u_guest_conv_c1_p2')
  check('p0 = 100 条', Array.isArray(p0) && p0.length === 100, p0 && p0.length)
  check('p1 = 100 条', Array.isArray(p1) && p1.length === 100, p1 && p1.length)
  check('p2 = 50 条', Array.isArray(p2) && p2.length === 50, p2 && p2.length)
  const header = store.get('u_guest_conv_c1')
  check('header.schemaVersion = 2', header.schemaVersion === 2, header.schemaVersion)
  check('header 记录 messageCount/pageCount', header.messageCount === 250 && header.pageCount === 3, header)
  check('header 是 header（不含 messages 字段）', header.messages === undefined, Object.keys(header))
  check('元数据搬进 header', header.worldInfoState.round === 5 && header.localVariables.a === '1' && header.trpgState.hp === 10, header)
  check('segments 未落盘（P1.4）', p0[0].segments === undefined, p0[0])

  console.log('\n[4] load() 应还原 250 条并保留元数据')
  const rec = await conversationManager.load('c1')
  check('消息数 250', rec && rec.messages.length === 250, rec && rec.messages.length)
  check('presetId 保留', rec && rec.presetId === 'p1', rec && rec.presetId)
  check('worldInfoState 保留', rec && rec.worldInfoState.round === 5, rec && rec.worldInfoState)
  check('首条内容正确', rec && rec.messages[0].content === '消息0', rec && rec.messages[0].content)

  console.log('\n[5] 增量写入：追加 1 条只应重写最后一页 + 列表键')
  writeLog.length = 0
  await conversationManager.save({
    cardId: 'c1', cardName: '老档', presetId: 'p1', messages: [...rec.messages, msg(250)],
    localVariables: rec.localVariables, worldInfoState: rec.worldInfoState, trpgState: rec.trpgState
  })
  const touched = writeLog.filter(k => k !== 'u_guest_conv_list')
  // 期望：只重写最后一页 + header（header 要更新 messageCount/revision）；
  // 关键断言是**前两页没有被重写**。
  check('未重写 p0/p1', !touched.includes('u_guest_conv_c1_p0') && !touched.includes('u_guest_conv_c1_p1'), touched)
  check('重写了 p2', touched.includes('u_guest_conv_c1_p2'), touched)
  check('重写了 header', touched.includes('u_guest_conv_c1'), touched)
  check('列表键也更新了', writeLog.includes('u_guest_conv_list'), writeLog)
  const rec2 = await conversationManager.load('c1')
  check('追加后可读 251 条', rec2 && rec2.messages.length === 251, rec2 && rec2.messages.length)
  check('revision 递增', (store.get('u_guest_conv_c1').revision || 0) >= 2, store.get('u_guest_conv_c1').revision)

  console.log('\n[6] 截断：合并成 150 条后，多出来的第 3 页应被删除')
  await conversationManager.save({
    cardId: 'c1', cardName: '老档', presetId: 'p1', messages: rec2.messages.slice(0, 150),
    localVariables: {}, worldInfoState: {}, trpgState: null
  })
  check('p2 已删除', !store.has('u_guest_conv_c1_p2'), [...store.keys()].filter(k => k.includes('_p')))
  const rec3 = await conversationManager.load('c1')
  check('可读 150 条', rec3 && rec3.messages.length === 150, rec3 && rec3.messages.length)
  check('列表里的条数同步', conversationManager.getList()[0].messageCount === 150, conversationManager.getList()[0])

  console.log('\n[7] clear() 应删掉 header 与全部分页')
  await conversationManager.clear('c1')
  check('header 已删', !store.has('u_guest_conv_c1'))
  check('分页已删', !store.has('u_guest_conv_c1_p0') && !store.has('u_guest_conv_c1_p1'))
  check('has() 为假', conversationManager.has('c1') === false)
  check('列表为空', conversationManager.getList().length === 0)

  console.log('\n[8] 空消息边界：0 条也要能存取')
  await conversationManager.save({ cardId: 'c2', cardName: '空', messages: [] })
  const empty = await conversationManager.load('c2')
  check('空档可读', empty !== null && Array.isArray(empty.messages) && empty.messages.length === 0, empty && empty.messages)

  // ═══════════════════════════════════════════════════════════
  // P5.3 cachedStore：角色卡/预设/Persona 的"内存缓存 + IndexedDB"
  //
  // 前面用的是"无 IndexedDB → 退回本地存储"的降级路径；
  // 这里装一个**最小 fake IndexedDB**，验证真正要走的那条路：
  // 迁移动 + 清理本地副本（把 5MB 配额腾出来）+ 写穿透。
  // ═══════════════════════════════════════════════════════════
  console.log('\n[9] cachedStore：IDB 迁移 + 同步读回退 + 清理本地副本')

  const fake = _installFakeIndexedDB()

  // 注意：要在装 fake 之后再创建 store（适配器是懒创建的）
  const { createCachedStore } = await import('../src/utils/storage/cachedStore')
  const kvStore = createCachedStore({
    name: 'smokeCards',
    dbName: 'smoke_kv',
    match: (k: string) => k.indexOf('u_guest_card_') === 0 || k === 'u_guest_active_card'
  })

  // 本地存储里预置：两张"卡片"、一个激活项、以及一个**不属于本 store** 的键
  store.set('u_guest_card_a', { id: 'a', name: '卡片A', avatar: 'x'.repeat(50) })
  store.set('u_guest_card_b', { id: 'b', name: '卡片B' })
  store.set('u_guest_active_card', 'a')
  store.set('u_guest_other_key', { keep: true })

  // ① 同步读回退：hydrate 还没跑完也必须能读到（这是"保持同步 API"的关键）
  check('hydrate 前同步可读（回落本地存储）', kvStore.get('u_guest_card_a')?.name === '卡片A', kvStore.get('u_guest_card_a'))

  // ② hydrate：迁到 IndexedDB
  await kvStore.ensureReady()
  const idbTables = fake.dump()
  check('IDB 里已有该库', !!idbTables['smoke_kv'], Object.keys(idbTables))
  const table = idbTables['smoke_kv'] || {}
  check('卡片 A 已迁入 IDB', !!table['u_guest_card_a'] && table['u_guest_card_a'].name === '卡片A', Object.keys(table))
  check('卡片 B 已迁入 IDB', !!table['u_guest_card_b'], Object.keys(table))
  check('激活项已迁入 IDB', table['u_guest_active_card'] === 'a', table['u_guest_active_card'])
  check('本地存储副本已清理', !store.has('u_guest_card_a') && !store.has('u_guest_card_b') && !store.has('u_guest_active_card'), [...store.keys()])
  check('不属于本 store 的键未被清理', store.has('u_guest_other_key'), [...store.keys()])
  check('hydrate 后仍可读', kvStore.get('u_guest_card_b')?.name === '卡片B', kvStore.get('u_guest_card_b'))

  // ③ 写入穿透：hydrate 之后只写 IDB（内存同步可见）
  kvStore.set('u_guest_card_c', { id: 'c', name: '卡片C' })
  check('同步可见', kvStore.get('u_guest_card_c')?.name === '卡片C', kvStore.get('u_guest_card_c'))
  await new Promise(r => setTimeout(r, 5))
  check('已异步落盘 IDB', fake.dump()['smoke_kv']['u_guest_card_c']?.name === '卡片C', fake.dump()['smoke_kv'])
  check('不再写本地存储', !store.has('u_guest_card_c'), [...store.keys()])

  // ④ 删除
  kvStore.remove('u_guest_card_c')
  check('缓存已删', kvStore.get('u_guest_card_c') === null, kvStore.get('u_guest_card_c'))
  await new Promise(r => setTimeout(r, 5))
  check('IDB 已删', fake.dump()['smoke_kv']['u_guest_card_c'] === undefined, Object.keys(fake.dump()['smoke_kv']))

  // ⑤ keys() 只包含本 store 的键
  const ks = kvStore.keys().sort()
  check('keys() 范围正确', ks.length === 3 && ks.indexOf('u_guest_other_key') < 0, ks)

  // ⑥ 账号切换：uid 变化后缓存作废，读操作回到"新用户"的本地存储
  store.set('sillytroops_current_user_id', 'u2')
  store.set('u_u2_card_x', { id: 'x', name: 'U2卡片' })
  check('切换用户后读到新用户数据', (kvStore.get('u_u2_card_x') as any)?.name === 'U2卡片', kvStore.get('u_u2_card_x'))
  check('不会串到上一个用户', kvStore.get('u_guest_card_a') === null || (kvStore.get('u_guest_card_a') as any)?.name !== '卡片A', kvStore.get('u_guest_card_a'))
  store.delete('sillytroops_current_user_id')
}

// ═══════════════════════════════════════════════════════════
// P6.4：文本编码思考（COT）的切分
// ═══════════════════════════════════════════════════════════
async function checkReasoningSplit() {
  const { splitReasoning } = await import('../src/engine/ReasoningHandler')

  console.log('\n[10] splitReasoning：文本思考切分（含流式未闭合）')
  const on = { enabled: true, prefix: ' thinking', suffix: ' response' }
  const off = { enabled: false, prefix: ' thinking', suffix: ' response' }

  const d = splitReasoning('正文。 thinking我在想 response', off)
  check('未启用时原样返回', d.reasoning === '' && d.content === '正文。 thinking我在想 response', d)

  const np = splitReasoning('没有思考的正文', on)
  check('无前缀时不动', np.reasoning === '' && np.content === '没有思考的正文', np)

  const full = splitReasoning('前面。 thinking推理内容 response后面。', on)
  check('成对：切出思考', full.reasoning === '推理内容', full)
  check('成对：正文去掉思考块', full.content === '前面。后面。', full)
  check('成对：标记为已完成', full.incomplete === false, full)

  // 关键：流式中间态（只有前缀、后缀还没到）
  const partial = splitReasoning('前面。 thinking推理还在继', on)
  check('未闭合：后半段算思考', partial.reasoning === '推理还在继', partial)
  check('未闭合：正文只保留前缀之前', partial.content === '前面。', partial)
  check('未闭合：标记 incomplete', partial.incomplete === true, partial)

  const emptyTmpl = splitReasoning('前面。 thinkingx', { enabled: true, prefix: '', suffix: '' })
  check('模板为空时视为未启用', emptyTmpl.content === '前面。 thinkingx' && emptyTmpl.reasoning === '', emptyTmpl)
}

/**
 * 最小 fake IndexedDB —— 只实现本项目 adapter 用到的那一小块 API
 * （open / transaction / objectStore.get|put|delete|getAllKeys / oncomplete）。
 * 目的：让 P5.3 的"真正迁到 IndexedDB"这条路径也能在 Node 里被断言，而不是只测降级路径。
 */
function _installFakeIndexedDB() {
  const dbs = new Map<string, Map<string, Map<any, any>>>()

  function makeRequest<T>(result: T) {
    return { result, onerror: null as any }
  }

  function makeStore(table: Map<any, any>) {
    return {
      get: (k: any) => makeRequest(table.get(k)),
      put: (v: any, k: any) => { table.set(k, v); return makeRequest(k) },
      delete: (k: any) => { table.delete(k); return makeRequest(undefined) },
      getAllKeys: () => makeRequest([...table.keys()])
    }
  }

  const fake = {
    open(name: string, _version?: number) {
      const req: any = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null }
      setTimeout(() => {
        let stores = dbs.get(name)
        if (!stores) {
          stores = new Map()
          dbs.set(name, stores)
        }
        req.result = {
          objectStoreNames: { contains: (n: string) => stores!.has(n) },
          createObjectStore: (n: string) => { stores!.set(n, new Map()); return {} },
          transaction: (storeName: string) => {
            const table = stores!.get(storeName) || new Map()
            const tx: any = { oncomplete: null, onerror: null, onabort: null, objectStore: () => makeStore(table) }
            // 操作是同步完成的；complete 放到宏任务里触发，保证调用方已经挂上 oncomplete
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete() }, 0)
            return tx
          }
        }
        if (req.onupgradeneeded) req.onupgradeneeded()
        if (req.onsuccess) req.onsuccess()
      }, 0)
      return req
    }
  }

  ;(globalThis as any).indexedDB = fake

  return {
    /** 导出各库各表的当前内容（供断言） */
    dump(): Record<string, Record<string, any>> {
      const out: Record<string, Record<string, any>> = {}
      dbs.forEach((stores, dbName) => {
        out[dbName] = {}
        stores.forEach((table, storeName) => {
          const rows: Record<string, any> = {}
          table.forEach((v, k) => { rows[String(k)] = v })
          out[dbName][storeName] = rows
        })
        // 给断言用的扁平视图：库名 → 键值
        out[dbName] = out[dbName]['kv'] || {}
      })
      return out
    }
  }
}

main()
  .then(() => checkReasoningSplit())
  .then(() => {
    console.log(`\n最终结果：pass=${pass} fail=${fail}`)
    if (fail > 0) process.exit(1)
  })
  .catch(e => { console.error('运行失败:', e); process.exit(1) })

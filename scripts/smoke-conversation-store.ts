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

/** fake IndexedDB 的句柄（main() 里装上，后续用例共享） */
let fakeRef: any = null

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
  fakeRef = fake

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
// P6.4 / D21：正文思考定界符的**自动识别**（用户不再配置前后缀）
// ═══════════════════════════════════════════════════════════
async function checkReasoningSplit() {
  const { splitReasoning, combineReasoning, defaultReasoningConfig, REASONING_DELIMITERS } =
    await import('../src/engine/ReasoningHandler')

  console.log('\n[10] 思考解析（D21：只留开关 + 硬编码定界符自动识别）')
  const on = { enabled: true }
  const off = { enabled: false }

  // 防回归：旧版本的默认值 suffix 是空串，导致"打开开关却什么都不发生"
  check('默认配置是关闭的', defaultReasoningConfig().enabled === false)
  check('硬编码定界符表非空', REASONING_DELIMITERS.length > 0, REASONING_DELIMITERS.length)

  const d = splitReasoning('正文。<think>我在想</think>', off)
  check('未启用时原样返回（含定界符）', d.reasoning === '' && d.content === '正文。<think>我在想</think>', d)

  const np = splitReasoning('没有定界符的正文', on)
  check('无定界符时不动', np.reasoning === '' && np.content === '没有定界符的正文', np)

  const full = splitReasoning('前面。<think>推理内容</think>后面。', on)
  check('自动识别 <think>：切出思考', full.reasoning === '推理内容', full)
  check('自动识别 <think>：正文去掉整段（含标记）', full.content === '前面。后面。', full)
  check('已闭合：incomplete = false', full.incomplete === false, full)

  const ana = splitReasoning('<analysis>想了 B</analysis>答案 B', on)
  check('自动识别 <analysis>（无需配置）', ana.reasoning === '想了 B' && ana.content === '答案 B', ana)

  const cn = splitReasoning('<思考>想了 C</思考>答案 C', on)
  check('自动识别中文尖括号 <思考>', cn.reasoning === '想了 C' && cn.content === '答案 C', cn)

  const br = splitReasoning('[思考]想了 D[/思考]答案 D', on)
  check('自动识别方括号 [思考]', br.reasoning === '想了 D' && br.content === '答案 D', br)

  const two = splitReasoning('A<analysis>x</analysis>B<think>y</think>C', on)
  check('多组同时出现时取开头最早的那组', two.reasoning === 'x' && two.content === 'AB<think>y</think>C', two)

  // 关键：流式中间态（只有开标记、闭标记还没到）
  const partial = splitReasoning('前面。<think>推理还在继', on)
  check('未闭合：后半段算思考', partial.reasoning === '推理还在继', partial)
  check('未闭合：正文只保留开标记之前', partial.content === '前面。', partial)
  check('未闭合：incomplete = true', partial.incomplete === true, partial)

  // 向后兼容：旧版本存过 { enabled, prefix, suffix }，新代码只认 enabled
  const legacy = splitReasoning('前面。<think>x</think>后面', { enabled: true, prefix: '', suffix: '' } as any)
  check('旧配置（带空前后缀）也能自动识别', legacy.reasoning === 'x' && legacy.content === '前面。后面', legacy)

  console.log('\n[10b] 折叠块显示两份思考的并集（combineReasoning）')
  check('只有上游思考', combineReasoning('原生', '') === '原生')
  check('只有正文切出的思考', combineReasoning('', '切出') === '切出')
  check('两份都有 → 都保留（原生在前）', combineReasoning('原生', '切出') === '原生\n\n切出', combineReasoning('原生', '切出'))
  check('内容完全重复时不显示两遍', combineReasoning('同一段', '同一段') === '同一段')
  check('一方包含另一方时只留更长的', combineReasoning('原始思考', '原始思考加上更多') === '原始思考加上更多')
  check('都为空的边界', combineReasoning('', '') === '')
}

// ═══════════════════════════════════════════════════════════
// 本轮修复：台词必须保留引号 + 平滑输出速率算法
// ═══════════════════════════════════════════════════════════
async function checkFixes() {
  const { applyRegexScripts } = await import('../src/engine/RegexScriptEngine')
  const { createSystemRegexScripts } = await import('../src/engine/systemRegex')
  const { nextShownLength, charsPerFrame, normalizePacingConfig } = await import('../src/utils/streamPacing')

  console.log('\n[11] 台词引号必须保留（用户实测反馈）')
  const out = applyRegexScripts('她握紧了刀。“我不会退。”她说。', createSystemRegexScripts(), 0, { isMarkdown: true })
  check('成对引号被保留', out.includes('<span class="say">“我不会退。”</span>'), out)
  const outOpen = applyRegexScripts('她说：“我不会退', createSystemRegexScripts(), 0, { isMarkdown: true })
  check('未闭合时保留开引号', outOpen.includes('<span class="say">“我不会退</span>'), outOpen)
  const outCorner = applyRegexScripts('「这是一句足够长的台词。」', createSystemRegexScripts(), 0, { isMarkdown: true })
  check('直角引号也保留', outCorner.includes('<span class="say">「这是一句足够长的台词。」</span>'), outCorner)
  const shortOut = applyRegexScripts('他说：“好”然后走了。', createSystemRegexScripts(), 0, { isMarkdown: true })
  check('短引用仍不包装（门槛未被破坏）', !shortOut.includes('class="say"'), shortOut)

  console.log('\n[12] 平滑输出速率算法')
  check('80 字/秒 @33ms ≈ 每帧 3 字', charsPerFrame(80, 33) === 3, charsPerFrame(80, 33))
  check('每帧至少 1 字', charsPerFrame(1, 33) === 1, charsPerFrame(1, 33))
  check('速率非法 = 不限制', charsPerFrame(0, 33) === Number.MAX_SAFE_INTEGER, charsPerFrame(0, 33))
  check('推进受限速约束', nextShownLength(0, 100, 80, 33) === 3, nextShownLength(0, 100, 80, 33))
  check('到达末尾即停（不越界）', nextShownLength(99, 100, 80, 33) === 100, nextShownLength(99, 100, 80, 33))
  check('速率非法时直接放行全文', nextShownLength(0, 100, 0, 33) === 100, nextShownLength(0, 100, 0, 33))

  // 用户改版要求：去掉"平滑输出"开关，只留 10~100 的显示速度滑条（步进 5），
  // 最右 100 = 全速 = 等价于原来的"关闭平滑输出"。enabled 由速率派生，旧配置要能平滑迁移。
  console.log('\n[12b] 流式速度归一化（10~100 / 步进 5 / 100 = 全速）')
  const p80 = normalizePacingConfig({ enabled: true, charsPerSec: 80 })
  check('80 保持启用', p80.charsPerSec === 80 && p80.enabled === true, p80)
  const p100 = normalizePacingConfig({ enabled: true, charsPerSec: 100 })
  check('100 = 全速（enabled 派生为 false）', p100.charsPerSec === 100 && p100.enabled === false, p100)
  const pOldOff = normalizePacingConfig({ enabled: false, charsPerSec: 80 })
  check('旧配置"平滑已关闭" → 全速 100', pOldOff.charsPerSec === 100 && pOldOff.enabled === false, pOldOff)
  check('低于下限钳到 10', normalizePacingConfig({ enabled: true, charsPerSec: 3 }).charsPerSec === 10)
  check('高于上限钳到 100（旧默认 160 不再越界）', normalizePacingConfig({ enabled: true, charsPerSec: 160 }).charsPerSec === 100)
  check('吸附到 5 的倍数', normalizePacingConfig({ enabled: true, charsPerSec: 42 }).charsPerSec === 40)
  check('非法速率回落默认 80', normalizePacingConfig({ enabled: true, charsPerSec: NaN }).charsPerSec === 80)

  // 用户要求：自动回复的几个开关"默认全部打开"，开箱即用（不必先去保存一次设置）。
  // 所以判定口径必须是 `!== false`（缺字段 = 开），这里把这条不变量钉死。
  const { normalizeAutoReply, DEFAULT_AUTO_REPLY_TEXT } = await import('../src/types/preset')
  console.log('\n[12c] 自动回复默认值（几个开关默认打开）')
  const arEmpty = normalizeAutoReply(undefined)
  check('缺字段 = 打开自动输入', arEmpty.enabled === true, arEmpty)
  check('缺字段 = 打开自定义文本', arEmpty.useCustomText === true, arEmpty)
  check('文本默认「继续」', arEmpty.customText === DEFAULT_AUTO_REPLY_TEXT, arEmpty)
  const arExplicitOff = normalizeAutoReply({ enabled: false, useCustomText: false, customText: '走' })
  check('显式 false 才是关闭', arExplicitOff.enabled === false && arExplicitOff.useCustomText === false, arExplicitOff)
  check('自定义文本被保留', arExplicitOff.customText === '走', arExplicitOff)
  check('空文本原样保留（使用侧再回落默认）', normalizeAutoReply({ customText: '' }).customText === '', normalizeAutoReply({ customText: '' }).customText)
}

// ═══════════════════════════════════════════════════════════
// D20：全账号旧档一次性迁移（跨账号迁移）
//
// 为什么必须断言：这一步会**按 uid 写到别人名下**，写错了就是账号之间串数据；
// 而且它同时修了一个"迁移覆盖已有列表"的顺序 bug，都属于"错了就丢档"的级别。
// 注：此处 conversationManager 的适配器在 main() 早期已绑定为"本地存储"（那时还没装
// fake IndexedDB），所以这一段的 key 断言看的是本地存储 —— 迁移动用的写入逻辑与
// IndexedDB 路径完全同一套，介质差异已由 [9] 的 cachedStore 用例覆盖。
// ═══════════════════════════════════════════════════════════
async function checkMigration() {
  // main() 末尾那次"账号切换"触发的 hydrate 是**未被 await 的后台任务**，它的异步尾巴
  // 会在下面几个 await 之间跑完，并按自己的 match 规则搬走测试夹具（表现为"键莫名被删"）。
  // 这里先把所有已注册 store 的 hydrate 排干，保证用例之间没有在飞的任务。
  const cached = await import('../src/utils/storage/cachedStore')
  for (const s of cached.listCachedStores()) {
    try { await s.ensureReady() } catch (e) { /* ignore */ }
  }

  console.log('\n[13] 跨账号迁移：其他账号的 v1 存档搬进它自己的 v2 键')
  store.set('u_user_other_conversation_list', [
    { cardId: 'cx', cardName: '他人老档', updatedAt: 99, messageCount: 120, lastMessagePreview: '' }
  ])
  store.set('u_user_other_conversation_cx', {
    cardId: 'cx', cardName: '他人老档', messages: Array.from({ length: 120 }, (_, i) => msg(i)),
    worldInfoState: { sticky: {}, cooldown: {}, round: 3 }, updatedAt: 99
  })
  const listBefore = conversationManager.getList().map(i => i.cardId).join(',')
  const r = await conversationManager.migrateForeignLegacy()
  check('迁移计数 = 1', r.migrated === 1 && r.failed === 0, r)
  check('写到"他人 uid"名下（不是当前账号）', store.has('u_user_other_conv_cx'))
  check('没有写到当前账号名下', !store.has('u_guest_conv_cx'))
  check('分页按 100 条切（100 + 20）',
    (store.get('u_user_other_conv_cx_p0') || []).length === 100 &&
    (store.get('u_user_other_conv_cx_p1') || []).length === 20,
    [store.get('u_user_other_conv_cx_p0')?.length, store.get('u_user_other_conv_cx_p1')?.length])
  check('header 元信息随迁', store.get('u_user_other_conv_cx').worldInfoState.round === 3)
  check('他人的对话列表已建立', (store.get('u_user_other_conv_list') || [])[0]?.cardId === 'cx',
    store.get('u_user_other_conv_list'))
  check('旧数据键已删', !store.has('u_user_other_conversation_cx'))
  check('旧列表键已删', !store.has('u_user_other_conversation_list'))
  check('当前账号列表未被污染', conversationManager.getList().map(i => i.cardId).join(',') === listBefore,
    conversationManager.getList())
  check('当前账号存档未被改动', store.has('u_guest_conv_c2'))

  console.log('\n[14] 迁移失败必须保留旧档，且不留"半吊子存档"')
  store.set('u_user_bad_conversation_list', [{ cardId: 'cy', cardName: '待迁', updatedAt: 5, messageCount: 3 }])
  store.set('u_user_bad_conversation_cy', {
    cardId: 'cy', cardName: '待迁', messages: [msg(0), msg(1), msg(2)], updatedAt: 5
  })
  const origSet = (globalThis as any).uni.setStorageSync
  ;(globalThis as any).uni.setStorageSync = (k: string, v: any) => {
    if (k === 'u_user_bad_conv_cy') throw new Error('模拟 header 写入失败')
    origSet(k, v)
  }
  const r2 = await conversationManager.migrateForeignLegacy()
  ;(globalThis as any).uni.setStorageSync = origSet
  check('失败计数 = 1', r2.failed === 1, r2)
  check('旧档仍在（没丢数据）', store.has('u_user_bad_conversation_cy'))
  check('header 未写入（header 最后写，不留半吊子）', !store.has('u_user_bad_conv_cy'))
  check('旧列表键保留（下次还能重试）', store.has('u_user_bad_conversation_list'))
  const r3 = await conversationManager.migrateForeignLegacy()
  check('修好后重试成功', r3.migrated === 1, r3)
  check('重试后旧档已删', !store.has('u_user_bad_conversation_cy'))
  check('重试后存档完整', store.get('u_user_bad_conv_cy')?.messageCount === 3)

  console.log('\n[15] cachedStore：其他账号的键搬进 IDB，当前账号的留给 hydrate')
  store.delete('u_u2_card_x') // 清掉 [6] 账号切换用例的残留，避免干扰计数
  const { createCachedStore, migrateForeignUserKeys } = await import('../src/utils/storage/cachedStore')
  const foreignStore = createCachedStore({
    name: 'smokeForeign',
    dbName: 'smoke_kv2',
    match: (k: string) => k.indexOf('u_guest_card_') === 0,
    uidOf: (k: string) => { const m = k.match(/^u_(.+)_card_.+$/); return m ? m[1] : null }
  })
  store.set('u_user_other2_card_a', { id: 'a', name: '他人卡片' })
  store.set('u_guest_card_home', { id: 'home', name: '本账号卡片' })
  store.set('u_user_other2_card_dup', { v: 1 })
  await migrateForeignUserKeys()
  const t2 = fakeRef.dump()['smoke_kv2'] || {}
  check('他人的键已搬进 IDB', t2['u_user_other2_card_a']?.name === '他人卡片', Object.keys(t2))
  check('他人键的本地副本已删', !store.has('u_user_other2_card_a'))
  check('当前账号的键被跳过（留给 hydrate）', store.has('u_guest_card_home'))
  check('当前账号的键没被写进 IDB', t2['u_guest_card_home'] === undefined)
  check('不属于任何 store 的键未被动', store.has('u_guest_other_key'))
  check('内存缓存不含他人数据', foreignStore.get('u_user_other2_card_a') === null)
  // 两边都有（例如旧版本在迁移之后又写了一份本地副本）→ 保守保留，不删
  store.set('u_user_other2_card_dup', { v: 2 })
  const m2 = await migrateForeignUserKeys()
  check('两边都有时保留本地副本', store.has('u_user_other2_card_dup'))
  check('kept 计数 = 1', m2.kept === 1, m2)

  console.log('\n[16] init 顺序：迁移不得覆盖已有列表 + 孤儿档也能救回')
  store.set('u_guest_conv_keep', {
    schemaVersion: 2, revision: 1, cardId: 'keep', cardName: '保留', updatedAt: 100,
    messageCount: 2, pageCount: 1, pageSize: 100
  })
  store.set('u_guest_conv_keep_p0', [msg(0), msg(1)])
  store.set('u_guest_conv_list', [{ cardId: 'keep', cardName: '保留', updatedAt: 100, messageCount: 2, lastMessagePreview: '' }])
  // 孤儿档：有数据键、但列表里没有它（改造前只认列表 → 永远不会被迁移）
  store.set('u_guest_conversation_orphan', { cardId: 'orphan', cardName: '孤儿档', messages: [msg(0)], updatedAt: 200 })
  await conversationManager.reload()
  const ids = conversationManager.getList().map(i => i.cardId).sort()
  check('已有列表项没被迁移覆盖', ids.indexOf('keep') >= 0, ids)
  check('孤儿档被救回并进入列表', ids.indexOf('orphan') >= 0, ids)
  check('孤儿旧键已删', !store.has('u_guest_conversation_orphan'))

  console.log('\n[17] 账号切换：不得把上一个账号的列表/存档给下一个账号看')
  // 为什么必须断言：scopedKey 让**存档本身**不串号，但列表是内存态（_listCache）；
  // 换账号后若不作废，页面就会把上一个账号的对话列表渲染给下一个账号（跨账号可见）。
  const guestIds = conversationManager.getList().map(i => i.cardId)
  check('前置：guest 自己的列表已就绪', guestIds.indexOf('keep') >= 0, guestIds)

  store.set('sillytroops_current_user_id', 'u2')
  check('切到 u2 后同步读不到 guest 的列表（宁可空，也不能串号）',
    conversationManager.getList().length === 0, conversationManager.getList())

  store.set('u_u2_conv_list', [{ cardId: 'z', cardName: 'U2 对话', updatedAt: 999, messageCount: 0, lastMessagePreview: '' }])
  await conversationManager.init()
  const u2Ids = conversationManager.getList().map(i => i.cardId)
  check('重新 init 后读到的是 u2 自己的列表', u2Ids.length === 1 && u2Ids[0] === 'z', u2Ids)

  await conversationManager.save({ cardId: 'z', cardName: 'U2 对话', messages: [msg(0)] })
  check('u2 的存档写在 u2 名下（不是 guest）',
    store.has('u_u2_conv_z') && !store.has('u_guest_conv_z'),
    [...store.keys()].filter(k => k.indexOf('conv_z') > 0))

  store.delete('sillytroops_current_user_id')
  await conversationManager.init()
  const backIds = conversationManager.getList().map(i => i.cardId)
  check('切回 guest 后恢复 guest 自己的列表', backIds.indexOf('keep') >= 0 && backIds.indexOf('z') < 0, backIds)
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
  .then(() => checkMigration())
  .then(() => checkReasoningSplit())
  .then(() => checkFixes())
  .then(() => {
    console.log(`\n最终结果：pass=${pass} fail=${fail}`)
    if (fail > 0) process.exit(1)
  })
  .catch(e => { console.error('运行失败:', e); process.exit(1) })

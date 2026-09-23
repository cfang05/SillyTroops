/**
 * scripts/smoke-wi-and-regex-runtime.mjs
 *
 * 端到端验证「世界书扫描深度 / 递归默认值 / 输入侧正则双层包裹」三处修复。
 *
 * 直接 import 真实的 src/engine 源码（WorldInfoEngine / RegexScriptEngine），
 * 用 esbuild 现场打包成临时 ESM 再执行，避免"复刻逻辑"和真实代码漂移。
 *
 * 运行： node scripts/smoke-wi-and-regex-runtime.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) {
    console.log('   expected:', JSON.stringify(expected));
    console.log('   actual  :', JSON.stringify(actual));
  }
}

// ── 准备「桩件 + 改写 import」的源码副本目录 ─────────────────────────
// 为什么不用 esbuild 的 alias / 插件：
//   · CLI 的 --alias 只接受包名，相对路径会被判为 "Invalid alias name"；
//   · JS API 的插件模式需要 esbuild 起一个常驻子进程走管道通信，在当前沙箱下是
//     `spawn EPERM`（而 CLI 是直接 spawn esbuild.exe 并继承 stdio，可用）。
// 所以这里把 src 平铺复制一份，再把指向运行时依赖的相对 import 改写成桩件路径，
// 由 CLI 打包——测的仍然是 PromptBuilder/WorldInfoEngine/RegexScriptEngine 的真实源码。
const stageRoot = path.join(os.tmpdir(), `wi-regex-stage-${process.pid}`);
const stageSrc = path.join(stageRoot, 'src');
fs.rmSync(stageRoot, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'src'), stageSrc, { recursive: true });

// 把整份副本里对这四个模块的 import 路径改写成"**同目录下**的桩件"：
// 直接写成 './xxx' 后，只要在"每个引用到它的目录里"各放一份桩件就能解析，
// 不用去推算相对层级（engine/ 下是 ../，utils/llm/ 下是 ../../ …）。
const STUB_BODIES = {
  'storage.js': `
const mem = {};
export default {
  get: (k) => mem[k],
  set: (k, v) => { mem[k] = v },
  remove: (k) => { delete mem[k] },
  STORAGE_KEYS: {}
};
`,
  'userScope.js': `
export function scopedKey(k) { return 'u_test_' + k }
`,
  'runtimeStore.js': `
export function useRuntimeStore() {
  return {
    messages: [],
    localVariables: {},
    setLocalVariable(k, v) { this.localVariables[k] = v },
    getLocalVariable(k) { return this.localVariables[k] ?? '' }
  };
}
`,
  'dice-helper.js': `
export default { parseDiceCommand: () => ({ success: true, total: 0 }) };
`
};
const REWRITES = [
  [/from\s+'(?:\.\.\/)+(?:utils\/)?storage\.js'/g, "from './storage.js'"],
  [/from\s+'(?:\.\.\/)+(?:utils\/)?account\/userScope\.js'/g, "from './userScope.js'"],
  [/from\s+'(?:\.\.\/)+stores\/runtimeStore'/g, "from './runtimeStore.js'"],
  [/from\s+'(?:\.\.\/)+(?:utils\/)?dice-helper\.js'/g, "from './dice-helper.js'"]
];

/** 递归收集 stage 里的源码文件 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

let rewrittenFiles = 0;
for (const p of walk(stageSrc)) {
  const before = fs.readFileSync(p, 'utf8');
  let after = before;
  const neededStubs = new Set();
  after = after.replace(REWRITES[0][0], () => { neededStubs.add('storage.js'); return REWRITES[0][1]; });
  after = after.replace(REWRITES[1][0], () => { neededStubs.add('userScope.js'); return REWRITES[1][1]; });
  after = after.replace(REWRITES[2][0], () => { neededStubs.add('runtimeStore.js'); return REWRITES[2][1]; });
  after = after.replace(REWRITES[3][0], () => { neededStubs.add('dice-helper.js'); return REWRITES[3][1]; });
  if (after === before) continue;
  fs.writeFileSync(p, after);
  rewrittenFiles++;
  // 在每个引用目录里放好所需的桩件
  const dir = path.dirname(p);
  for (const name of neededStubs) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) fs.writeFileSync(target, STUB_BODIES[name]);
  }
}

const entry = path.join(stageRoot, 'entry.ts');
const outfile = path.join(stageRoot, 'bundle.mjs');
const fromStage = (rel) => path.join(stageRoot, rel).replace(/\\/g, '/');
fs.writeFileSync(entry, `
export { scan, createEmptySessionState } from '${fromStage('src/engine/WorldInfoEngine.ts')}';
export { applyRegexScripts } from '${fromStage('src/engine/RegexScriptEngine.ts')}';
export { buildMessages } from '${fromStage('src/engine/PromptBuilder.ts')}';
export { collectStopStrings } from '${fromStage('src/utils/llm/stopStrings.ts')}';
export { importFromSillyTavern } from '${fromStage('src/adapters/preset/PresetImporter.ts')}';
export { createDefaultPreset } from '${fromStage('src/adapters/preset/defaultPreset.ts')}';
export { normalizeAuthorsNote } from '${fromStage('src/types/note.ts')}';
export { countMessageTokens, sumMessageTokens, countMessagesTokens, countTokens, estimateTokenCount, TOKENS_PER_MESSAGE, TOKENS_PER_NAME, TOKENS_PER_REQUEST_PADDING } from '${fromStage('src/engine/tokenizer.ts')}';
`);

try {
  execFileSync(process.execPath, [
    path.join(ROOT, 'node_modules/esbuild/bin/esbuild'),
    entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${outfile}`, '--log-level=warning'
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
} catch (e) {
  console.error('esbuild 打包失败（stage 改写文件数:', rewrittenFiles, '）');
  throw e;
}

const mod = await import(pathToFileURL(outfile).href);
const {
  scan, applyRegexScripts, buildMessages, collectStopStrings, importFromSillyTavern,
  createDefaultPreset, normalizeAuthorsNote,
  countMessageTokens, sumMessageTokens, countMessagesTokens, countTokens, estimateTokenCount,
  TOKENS_PER_MESSAGE, TOKENS_PER_NAME, TOKENS_PER_REQUEST_PADDING
} = mod;
fs.rmSync(stageRoot, { recursive: true, force: true });

// ─────────────────────────────────────────────────────────────
// T4 世界书扫描深度（defaultScanDepth）
// 酒馆默认 world_info_depth = 2，只扫最近 2 条消息 + 当前输入
// ─────────────────────────────────────────────────────────────
function entryFixture(id, keys, content) {
  return {
    id, keys, secondaryKeys: [], content, enabled: true, constant: false,
    selective: false, useProbability: false, probability: 100,
    position: 'before_context', depth: 4, role: 'system',
    caseSensitive: null, matchWholeWords: null
  };
}

const history = [
  { role: 'user', content: '最开头提到过 老钥匙' },   // 第 0 条（最旧）
  { role: 'assistant', content: '中间闲聊' },
  { role: 'user', content: '最近提到 破盾' },          // 倒数第 2 条
  { role: 'assistant', content: '最近一条' }           // 倒数第 1 条
];

const entries = [
  entryFixture('old', ['老钥匙'], '【旧条目：只在最开头出现过】'),
  entryFixture('recent', ['破盾'], '【新条目：倒数第二条出现】')
];

const depth2 = scan({ entries, chatHistory: history, userMessage: '这次输入没有关键词', defaultScanDepth: 2, recursive: false });
check('T4a 深度=2 时：倒数第 2 条命中的条目激活', depth2.activatedIds.includes('recent'), true);
check('T4b 深度=2 时：只出现在第 0 条的条目**不**激活（改造前会激活）', depth2.activatedIds.includes('old'), false);

const depthAll = scan({ entries, chatHistory: history, userMessage: '这次输入没有关键词', defaultScanDepth: 0, recursive: false });
check('T4c 深度=0（显式全历史）时两条都激活', [...depthAll.activatedIds].sort(), ['old', 'recent']);

const currentMsgHit = scan({ entries, chatHistory: history, userMessage: '我拿起 老钥匙', defaultScanDepth: 2, recursive: false });
check('T4d 当前输入永远参与扫描（不受深度限制）', currentMsgHit.activatedIds.includes('old'), true);

// ─────────────────────────────────────────────────────────────
// T5 递归默认关闭
// A 命中后把内容写进递归缓冲区，B 只在缓冲区里出现 → 只有开递归才会被激活
// ─────────────────────────────────────────────────────────────
const chainEntries = [
  entryFixture('A', ['引子'], '这段内容里藏着 暗号'),
  entryFixture('B', ['暗号'], '【B：只在递归缓冲区里能被匹配到】')
];
const noRecurse = scan({ entries: chainEntries, chatHistory: [], userMessage: '引子', recursive: false });
check('T5a recursive=false 时不做递归', noRecurse.activatedIds, ['A']);

const withRecurse = scan({ entries: chainEntries, chatHistory: [], userMessage: '引子', recursive: true });
check('T5b recursive=true 时才递归激活 B', [...withRecurse.activatedIds].sort(), ['A', 'B']);

const capped = scan({ entries: chainEntries, chatHistory: [], userMessage: '引子', recursive: true, maxRecursionSteps: 1 });
check('T5c maxRecursionSteps=1 时仍能走到第 1 步（step<=maxSteps）', capped.activatedIds.includes('B'), true);

// ─────────────────────────────────────────────────────────────
// T4e~T4g 扫描文本是否带说话人名字（对齐酒馆 world_info_include_names 默认 true）
// ─────────────────────────────────────────────────────────────
const nameEntry = [entryFixture('byName', ['贝丝'], '【按角色名命中的条目】')];
const noName = scan({
  entries: nameEntry,
  chatHistory: [{ role: 'assistant', content: '这里完全没有关键词' }],
  userMessage: '', defaultScanDepth: 2, recursive: false, includeNames: false
});
check('T4e includeNames=false 时，仅靠角色名命中的条目不激活', noName.activatedIds, []);
const withName = scan({
  entries: nameEntry,
  chatHistory: [{ role: 'assistant', content: '这里完全没有关键词', name: '贝丝' }],
  userMessage: '', defaultScanDepth: 2, recursive: false, includeNames: true
});
check('T4f includeNames=true 时，`名字: 内容` 让条目命中', withName.activatedIds, ['byName']);
const fallbackName = scan({
  entries: nameEntry,
  chatHistory: [{ role: 'assistant', content: '这里完全没有关键词' }],
  userMessage: '', defaultScanDepth: 2, recursive: false, includeNames: true, characterName: '贝丝'
});
check('T4g 历史项没带 name 时用 characterName 兜底（assistant 侧）', fallbackName.activatedIds, ['byName']);

// ─────────────────────────────────────────────────────────────
// T6 输入侧正则（真实引擎）
// ─────────────────────────────────────────────────────────────
const stScript = {
  id: 'r1', scriptName: '正则',
  findRegex: '^([\\s\\S]*)$',
  replaceString: '<user_input>\n$1\n</user_input>',
  trimStrings: [], placement: [1], disabled: false,
  markdownOnly: false, promptOnly: true, runOnEdit: true,
  substituteRegex: 0
};

const RAW = '你好，{{char}}。';
const once = applyRegexScripts(RAW, [stScript], 1, { isPrompt: true });
const twice = applyRegexScripts(once, [stScript], 1, { isPrompt: true });
check('T6a 真实引擎复现：连续两次应用 → 两层 <user_input>',
  (twice.match(/<user_input>/g) || []).length, 2);
check('T6b 修复后（只应用一次）→ 一层',
  (once.match(/<user_input>/g) || []).length, 1);
check('T6c 一层的内容', once, `<user_input>\n${RAW}\n</user_input>`);
check('T6d 显示态（isMarkdown）不套 promptOnly 脚本',
  applyRegexScripts(RAW, [stScript], 1, { isMarkdown: true }), RAW);

// ─────────────────────────────────────────────────────────────
// T7 buildMessages 端到端：role 透传 / 示例消息 / squash / wi_format / atDepth 合并
// ─────────────────────────────────────────────────────────────
const CHARACTER = {
  spec: 'chara_card_v2',
  data: {
    name: '贝丝',
    description: '【角色描述】',
    personality: '【性格】',
    scenario: '【场景】',
    mes_example: [
      '<START>',
      'This is how 贝丝 should talk',
      '{{user}}: 早上好',
      '{{char}}: 早上好呀。',
      '{{char}}: 今天也要一起冒险吗？',
      '<START>',
      'This is how 贝丝 should talk',
      '{{user}}: 我要走了',
      '贝丝: 别走。'
    ].join('\n')
  }
};

/** 造一个最小预设：角色卡 markers 全用 role:'user'（酒馆预设的常见写法） */
function presetFixture(extraGen = {}, extraPrompts = []) {
  const prompts = [
    { identifier: 'main', name: 'main', enabled: true, role: 'system', content: '主提示词', injectionPosition: 0, injectionDepth: 4, injectionOrder: 100 },
    { identifier: 'worldInfoBefore', name: 'wi', enabled: true, role: 'user', content: '', injectionPosition: 0, injectionDepth: 4, injectionOrder: 100 },
    { identifier: 'charDescription', name: 'desc', enabled: true, role: 'user', content: '', injectionPosition: 0, injectionDepth: 4, injectionOrder: 100 },
    { identifier: 'dialogueExamples', name: 'ex', enabled: true, role: 'system', content: '', injectionPosition: 0, injectionDepth: 4, injectionOrder: 100 },
    { identifier: 'chatHistory', name: 'hist', enabled: true, role: 'system', content: '', injectionPosition: 0, injectionDepth: 4, injectionOrder: 100 },
    ...extraPrompts
  ];
  const order = ['main', 'worldInfoBefore', 'charDescription', 'dialogueExamples', 'chatHistory', ...extraPrompts.map(p => p.identifier)]
  return {
    id: 'p1', name: '测试预设', prompts, promptOrder: order.map(identifier => ({ identifier, enabled: true })),
    globalVariables: {}, regexScripts: [],
    generationParams: {
      temperature: 1, topP: 0.9, maxTokens: 500, presencePenalty: 0, frequencyPenalty: 0,
      maxContext: 32000, stream: false, seed: -1, n: 1, namesBehavior: 0,
      squashSystemMessages: false, continuePrefill: false,
      worldInfoDepth: 2, worldInfoRecursive: false, worldInfoMaxRecursionSteps: 0,
      worldInfoFormat: '{0}', customStopStrings: [],
      ...extraGen
    }
  };
}

function build(preset, opts = {}) {
  return buildMessages({
    character: CHARACTER,
    preset,
    chatHistory: opts.chatHistory || [],
    userMessage: opts.userMessage !== undefined ? opts.userMessage : '你好',
    variables: { char: '贝丝', user: '旅人' },
    lorebookEntries: opts.lorebookEntries || [],
    ...opts.ctx
  });
}

// T7a/T7b：role 透传（酒馆 marker 常写 role:'user'）
const built = build(presetFixture());
const byName = (msgs, name) => msgs.filter(m => m.name === name);
check('T7a charDescription（预设 role=user）以 user 身份发出',
  built.messages.find(m => m.content === '【角色描述】')?.role, 'user');
check('T7b main（预设 role=system）以 system 身份发出',
  built.messages.find(m => m.content === '主提示词')?.role, 'system');

// T7c/T7d/T7e：对话示例 → 多条带 name 的 system 消息，且剥掉名字前缀
// 期望 5 条：{{char}} 连续说了两句（flush 后仍是独立消息，与酒馆 add_msg 一致），
// 最后一块用的是真实角色名「贝丝:」，用来验证"实际名字前缀也能识别"。
const examples = built.messages.filter(m => m.name === 'example_user' || m.name === 'example_assistant');
check('T7c 示例展开为 5 条独立消息（连续发言不合并）', examples.length, 5);
check('T7d 示例 role 恒为 system', [...new Set(examples.map(m => m.role))], ['system']);
check('T7e 示例正文剥掉「名字:」前缀，且真实名字前缀同样能识别',
  examples.map(m => m.content),
  ['早上好', '早上好呀。', '今天也要一起冒险吗？', '我要走了', '别走。']);
check('T7e2 说话人 name 交替正确',
  examples.map(m => m.name),
  ['example_user', 'example_assistant', 'example_assistant', 'example_user', 'example_assistant']);
check('T7f 不再出现自造的 [Example messages] 头',
  built.messages.some(m => m.content.includes('[Example messages]')), false);

// T7g/T7h：squashSystemMessages 只合并"**连续**且无 name"的 system 消息。
// 注意 fixture 里 main(system) 与 charDescription(user) 之间夹了 user 角色的条目，
// 它们**不应该**被合并 —— 这正是酒馆 shouldSquash 的语义（要求上一条也是可合并的 system）。
const squashed = build(presetFixture({ squashSystemMessages: true }));
const sysBefore = built.messages.filter(m => m.role === 'system').length;
const sysAfter = squashed.messages.filter(m => m.role === 'system').length;
check('T7g 开启 squash 后 system 消息被合并（条数减少）', sysAfter < sysBefore, true);
check('T7h squash 不会吞掉带 name 的示例消息',
  squashed.messages.filter(m => m.name === 'example_user' || m.name === 'example_assistant').length, 5);
check('T7h2 被 user 消息隔开的两条 system 不合并（酒馆同款语义）',
  squashed.messages.some(m => m.content.includes('主提示词')) &&
  !squashed.messages.some(m => m.content.includes('主提示词') && m.content.includes('【角色描述】')), true);

// T7g2：把两条 system 排在一起时，必须真正合并成一条（对照用例）
const adjacentPreset = presetFixture({ squashSystemMessages: true }, [
  { identifier: 'enhanceDefinitions', name: 'enh', enabled: true, role: 'system', content: '增强定义', injectionPosition: 0, injectionDepth: 4, injectionOrder: 100 }
]);
// 让 enhanceDefinitions 紧跟在 main 之后：重建 promptOrder 顺序
adjacentPreset.promptOrder = [
  { identifier: 'main', enabled: true },
  { identifier: 'enhanceDefinitions', enabled: true },
  { identifier: 'worldInfoBefore', enabled: true },
  { identifier: 'charDescription', enabled: true },
  { identifier: 'dialogueExamples', enabled: true },
  { identifier: 'chatHistory', enabled: true }
];
const adjacent = build(adjacentPreset);
check('T7g2 相邻的两条 system 被合并为一条',
  adjacent.messages.some(m => m.content === '主提示词\n增强定义'), true);

// T7j：wi_format 包装
const wiEntry = {
  id: 'w1', keys: [], secondaryKeys: [], content: '【世界书条目】', enabled: true, constant: true,
  selective: false, useProbability: false, probability: 100,
  position: 'before_context', depth: 4, role: 'system',
  caseSensitive: null, matchWholeWords: null
};
const wiDefault = build(presetFixture(), { lorebookEntries: [wiEntry] });
check('T7j 默认 wi_format("{0}") 不额外包装',
  wiDefault.messages.some(m => m.content === '【世界书条目】'), true);
const wiWrapped = build(presetFixture({ worldInfoFormat: '<world_info>\n{0}\n</world_info>' }), { lorebookEntries: [wiEntry] });
check('T7k 自定义 wi_format 生效',
  wiWrapped.messages.some(m => m.content === '<world_info>\n【世界书条目】\n</world_info>'), true);

// T7l：atDepth 条目按 (depth, role) 合并成一条
const depthEntries = [
  { id: 'd1', keys: [], secondaryKeys: [], content: '深度条目A', enabled: true, constant: true, selective: false, useProbability: false, probability: 100, position: 'at_depth', depth: 2, role: 'system', caseSensitive: null, matchWholeWords: null },
  { id: 'd2', keys: [], secondaryKeys: [], content: '深度条目B', enabled: true, constant: true, selective: false, useProbability: false, probability: 100, position: 'at_depth', depth: 2, role: 'system', caseSensitive: null, matchWholeWords: null },
  { id: 'd3', keys: [], secondaryKeys: [], content: '深度条目C', enabled: true, constant: true, selective: false, useProbability: false, probability: 100, position: 'at_depth', depth: 2, role: 'user', caseSensitive: null, matchWholeWords: null }
];
const depthBuilt = build(presetFixture(), {
  lorebookEntries: depthEntries,
  chatHistory: [
    { role: 'user', content: '历史1' },
    { role: 'assistant', content: '历史2' },
    { role: 'user', content: '历史3' },
    { role: 'assistant', content: '历史4' }
  ]
});
check('T7l 同 (depth, role) 的条目合并成一条（system）',
  depthBuilt.messages.some(m => m.role === 'system' && m.content === '深度条目A\n深度条目B'), true);
check('T7m 不同 role 的条目各自成条（user）',
  depthBuilt.messages.some(m => m.role === 'user' && m.content === '深度条目C'), true);

// T7n：本次用户消息过宏替换（对齐酒馆 sendMessageAsUser 的 substituteParams）
const userBuilt = build(presetFixture(), { userMessage: '你好 {{char}}，我是 {{user}}' });
check('T7n 用户消息里的宏被替换',
  userBuilt.messages.some(m => m.content === '你好 贝丝，我是 旅人'), true);

// ─────────────────────────────────────────────────────────────
// T8 停止串整理（对齐酒馆 getCustomStoppingStrings(4)）
// ─────────────────────────────────────────────────────────────
check('T8a 空数组 → null（不下发 stop）', collectStopStrings([]), null);
check('T8b 非数组 → null', collectStopStrings('["a"]'), null);
check('T8c 全空/超长被丢弃 → null', collectStopStrings(['  ', 'x'.repeat(17)]), null);
check('T8d 正常整理 + trim', collectStopStrings([' User: ', 'Assistant:']), ['User:', 'Assistant:']);
check('T8e 超过 4 条时截断', collectStopStrings(['a', 'b', 'c', 'd', 'e']), ['a', 'b', 'c', 'd']);
check('T8f 去掉 \\r', collectStopStrings(['a\r\nb']), ['a\nb']);

// ─────────────────────────────────────────────────────────────
// T9 预设导入：role / system_prompt / injection_trigger 保真 + 新字段默认值
// ─────────────────────────────────────────────────────────────
const imported = importFromSillyTavern({
  name: '导入测试',
  prompts: [
    { identifier: 'charDescription', name: 'desc', role: 'user', system_prompt: true, marker: true },
    { identifier: 'custom1', name: 'c1', role: 'assistant', system_prompt: false, content: 'x', injection_trigger: ['continue', 'normal'] }
  ],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'charDescription', enabled: true }, { identifier: 'custom1', enabled: true }] }],
  custom_stopping_strings: '["User:","Assistant:"]',
  extensions: { regex_scripts: [] }
}, 'test.json');
const importedDesc = imported.prompts.find(p => p.identifier === 'charDescription');
const importedCustom = imported.prompts.find(p => p.identifier === 'custom1');
check('T9a marker 的 role=user 被保真', importedDesc?.role, 'user');
check('T9b system_prompt 被保真', importedDesc?.systemPrompt, true);
check('T9c assistant role 被保真', importedCustom?.role, 'assistant');
check('T9d injection_trigger 被保真', importedCustom?.injectionTrigger, ['continue', 'normal']);
check('T9e world_info_* 缺失时补酒馆默认值',
  [imported.generationParams.worldInfoDepth, imported.generationParams.worldInfoRecursive, imported.generationParams.worldInfoMaxRecursionSteps],
  [2, false, 0]);
check('T9f wi_format 缺失时补 "{0}"', imported.generationParams.worldInfoFormat, '{0}');
check('T9g 预设里的停止串（JSON 字符串形态）被解析', imported.generationParams.customStopStrings, ['User:', 'Assistant:']);
check('T9g2 预设没有停止串时为空数组',
  importFromSillyTavern({ name: 'x', prompts: [], prompt_order: [], extensions: {} }).generationParams.customStopStrings, []);

// T9h：默认预设也带齐新字段
const dp = createDefaultPreset();
check('T9h 默认预设带齐新增字段',
  [dp.generationParams.worldInfoDepth, dp.generationParams.worldInfoRecursive, dp.generationParams.worldInfoFormat, dp.generationParams.customStopStrings],
  [2, false, '{0}', []]);

// ─────────────────────────────────────────────────────────────
// T10 作者注字段迁移（旧 prompt → 新 promptText）
// ─────────────────────────────────────────────────────────────
check('T10a 旧字段 prompt 被迁移到 promptText',
  normalizeAuthorsNote({ prompt: '旧正文', interval: 3 }).promptText, '旧正文');
check('T10b 新字段优先', normalizeAuthorsNote({ prompt: '旧', promptText: '新' }).promptText, '新');
check('T10c 非法值回落默认', normalizeAuthorsNote({ interval: 0, depth: 'x', position: 9, role: 'nope' }),
  { promptText: '', interval: 1, depth: 4, position: 1, role: 'system' });

// ─────────────────────────────────────────────────────────────
// T11 逐条消息的 token 计数
// 逐字对齐酒馆服务端 src/endpoints/tokenizers.js:998-1017：
//   tokensPerMessage = 3（仅 gpt-3.5-turbo-0301 为 4）、tokensPerName = 1、tokensPadding = 3
//   每条消息：tokensPerMessage + Σ encode(消息对象每个字段的值) +（name 字段时）+1
// ─────────────────────────────────────────────────────────────
check('T11a 空消息计 0（与酒馆 getChat 跳过空消息一致）',
  countMessageTokens({ role: 'system', content: '' }), 0);
check('T11b 常量与酒馆服务端一致（3 / 1 / 3）',
  [TOKENS_PER_MESSAGE, TOKENS_PER_NAME, TOKENS_PER_REQUEST_PADDING], [3, 1, 3]);
check('T11c 非空消息 = tokensPerMessage + encode(role) + encode(content)',
  countMessageTokens({ role: 'user', content: 'hi' }),
  TOKENS_PER_MESSAGE + countTokens('user') + countTokens('hi'));
check('T11d name 字段额外计 encode(name) + tokensPerName',
  countMessageTokens({ role: 'assistant', content: 'hi', name: '贝丝' })
  - countMessageTokens({ role: 'assistant', content: 'hi' }),
  TOKENS_PER_NAME + countTokens('贝丝'));
check('T11e 遍历所有字段（与 Object.entries 一致）',
  countMessageTokens({ role: 'system', content: 'a', name: 'n' })
  - countMessageTokens({ role: 'system', content: 'a' }),
  countTokens('n') + TOKENS_PER_NAME);
check('T11f sumMessageTokens 不含请求级 padding',
  sumMessageTokens([{ role: 'system', content: 'a' }, { role: 'user', content: 'bb' }]),
  countMessageTokens({ role: 'system', content: 'a' }) + countMessageTokens({ role: 'user', content: 'bb' }));
check('T11g countMessagesTokens = sum + tokensPadding（每请求一次）',
  countMessagesTokens([{ role: 'system', content: 'a' }]),
  countMessageTokens({ role: 'system', content: 'a' }) + TOKENS_PER_REQUEST_PADDING);
// 未加载真实 tokenizer 时走启发式：中文 ≈ 1 token/字
check('T11h 无真实 tokenizer 时回退启发式（中文按字估算）', estimateTokenCount('你好世界'), 4);

// buildMessages 的预算口径：padding 每请求只算一次，且进入 used
const budgeted = build(presetFixture());
check('T11i promptInfo.used 为计数之和（含请求级 padding）',
  budgeted.promptInfo.used,
  sumMessageTokens(budgeted.messages.filter(m => m.role === 'system' || m.role === 'user')) + TOKENS_PER_REQUEST_PADDING);
check('T11j promptInfo.sections 里出现「消息框架开销」项',
  budgeted.promptInfo.sections.some(s => s.name === '消息框架开销' && s.tokens === TOKENS_PER_REQUEST_PADDING), true);
check('T11k 有对话示例时 name 开销被计入（示例带 name 字段）',
  budgeted.messages.some(m => m.name) && countMessageTokens({ role: 'system', content: 'x', name: 'example_user' }) > countMessageTokens({ role: 'system', content: 'x' }), true);

// ─────────────────────────────────────────────────────────────
// T12 namesBehavior = 1（COMPLETION）：assistant 走独立 name 字段
// ─────────────────────────────────────────────────────────────
const historyForNames = [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '你好呀。' }
];
const nbDefault = build(presetFixture({ namesBehavior: 0 }), { chatHistory: historyForNames });
check('T12a namesBehavior=0 时 assistant 无 name 字段',
  nbDefault.messages.filter(m => m.role === 'assistant').every(m => !m.name), true);

const nbName = build(presetFixture({ namesBehavior: 1 }), { chatHistory: historyForNames });
check('T12b namesBehavior=1 时 assistant 带 name=角色名',
  nbName.messages.filter(m => m.role === 'assistant').map(m => m.name), ['贝丝']);
check('T12c namesBehavior=1 时正文不被改写',
  nbName.messages.some(m => m.role === 'assistant' && m.content === '你好呀。'), true);
check('T12d namesBehavior=1 不给 user 消息加 name',
  nbName.messages.filter(m => m.role === 'user').every(m => !m.name), true);

const nbContent = build(presetFixture({ namesBehavior: 2 }), { chatHistory: historyForNames });
check('T12e namesBehavior=2 时名字拼进正文（不加 name 字段）',
  nbContent.messages.some(m => m.role === 'assistant' && m.content === '贝丝: 你好呀。'), true);

// ─────────────────────────────────────────────────────────────
// T13 思考链回灌：只带「最近一轮有思考的」消息（对齐酒馆 max_additions=1）
// ─────────────────────────────────────────────────────────────
const asst = (msgs) => msgs.filter(m => m.role === 'assistant').map(m => m.content);

// T13a：只有最近一轮带思考 → 只有那条被拼上思考
const r1 = build(presetFixture(), {
  chatHistory: [
    { role: 'user', content: 'U1' },
    { role: 'assistant', content: 'A1', reasoning: '<think>思考1</think>' },
    { role: 'user', content: 'U2' },
    { role: 'assistant', content: 'A2', reasoning: '<think>思考2</think>' }
  ]
});
const a1 = asst(r1.messages);
check('T13a 最近一轮带思考时被拼上', a1.includes('<think>思考2</think>\n\nA2'), true);
check('T13b 更早那轮**不**被拼上（不是每轮都带）', a1.includes('<think>思考1</think>\n\nA1'), false);

// T13c：最近一条没有思考 → 往前找「最近一条有思考的」，且跳过的不消耗配额
const r2 = build(presetFixture(), {
  chatHistory: [
    { role: 'user', content: 'U1' },
    { role: 'assistant', content: 'A1', reasoning: '<think>思考1</think>' },
    { role: 'user', content: 'U2' },
    { role: 'assistant', content: 'A2' }   // ← 无思考
  ]
});
const a2 = asst(r2.messages);
check('T13c 最近一条无思考时继续往前找（跳过错位消息）', a2.includes('<think>思考1</think>\n\nA1'), true);
check('T13d 无思考的那条保持原样', a2.includes('A2') && !a2.includes('<think>思考2</think>'), true);

// T13e：完全没有思考时行为不变
const r3 = build(presetFixture(), { chatHistory: historyForNames });
check('T13e 没有任何思考时不改动历史', asst(r3.messages), ['你好呀。']);

// T13f：思考不算进"正文"，但仍计入 token（它在 prompt 里）
const withR = build(presetFixture(), {
  chatHistory: [{ role: 'user', content: 'U1' }, { role: 'assistant', content: 'A1', reasoning: '<think>很长的一段思考内容</think>' }]
});
const withoutR = build(presetFixture(), {
  chatHistory: [{ role: 'user', content: 'U1' }, { role: 'assistant', content: 'A1' }]
});
check('T13f 思考回灌后 prompt 估算 token 变多',
  withR.promptInfo.used > withoutR.promptInfo.used, true);

// T13g：user 消息上的 reasoning 不会被当成 assistant 思考注入
const r4 = build(presetFixture(), {
  chatHistory: [
    { role: 'user', content: 'U1', reasoning: '<think>用户侧思考</think>' },
    { role: 'assistant', content: 'A1' }
  ]
});
check('T13g user 消息的 reasoning 不注入', asst(r4.messages), ['A1']);

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);

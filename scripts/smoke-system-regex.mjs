/**
 * scripts/smoke-system-regex.mjs
 *
 * 系统正侧（台词识别）回归：验证「名字 + 台词」的顺序与幂等性。
 *
 * 背景：真实调用链会对同一段文本跑**两遍**输出态正则（存档态 MessageProcessor、
 * 显示态 chat.vue._segmentsFor），所以规则必须幂等；同时说话人名字必须渲染在
 * 台词**之前**（BlockParser 把正则产出的 HTML 片段渲染成独立块，落在片段之后的
 * 名字会跑到台词下面一行 —— 就是那个错位 bug）。
 *
 * 运行： node scripts/smoke-system-regex.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

// 打包真实源码
const stage = path.join(os.tmpdir(), `sysregex-${process.pid}`);
fs.mkdirSync(stage, { recursive: true });
const entry = path.join(stage, 'e.ts');
const out = path.join(stage, 'b.mjs');
const j = (p) => path.join(ROOT, p).replace(/\\/g, '/');
fs.writeFileSync(entry, `
export { createSystemRegexScripts } from '${j('src/engine/systemRegex.ts')}';
export { applyRegexScripts } from '${j('src/engine/RegexScriptEngine.ts')}';
export { parseBlocks } from '${j('src/engine/BlockParser.ts')}';
`);
execFileSync(process.execPath, [path.join(ROOT, 'node_modules/esbuild/bin/esbuild'), entry,
  '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, '--log-level=warning'
], { stdio: ['ignore', 'inherit', 'inherit'] });
const { createSystemRegexScripts, applyRegexScripts, parseBlocks } = await import(pathToFileURL(out).href);
fs.rmSync(stage, { recursive: true, force: true });

const scripts = createSystemRegexScripts();
/** 模拟真实链路：存档态跑一次、显示态再跑一次 */
const twice = (text) => applyRegexScripts(applyRegexScripts(text, scripts, 0, {}), scripts, 0, { isMarkdown: true });
const once = (text) => applyRegexScripts(text, scripts, 0, { isMarkdown: true });

/** 取出「块顺序」：台词块用 TEXT、其余用纯文本 */
function blockOrder(text) {
  return parseBlocks(text).map(n => (n.type === 'html-inline' ? 'TEXT:' + (n.text || '') : (n.text || '').trim()));
}

const Q = '“绿谷同学，一次问这么多太失礼了！”';
const Q2 = '“哇——时间诶！”';
const Q3 = '“能改变时间流速……这要练好了绝对是超硬核的个性啊。”';

// ── T1 名字在引号之后（截图里的形态）────────────────────────────
check('T1a 名字在引号后：渲染顺序为「名字 → 台词」',
  blockOrder(twice(`${Q} 饭田:`)), ['饭田:', `TEXT:${Q}`]);
check('T1b 名字在引号后的下一行，同样归位',
  blockOrder(twice(`${Q}\n饭田:`)), ['饭田:', `TEXT:${Q}`]);

// ── T2 名字在引号之前 ───────────────────────────────────────────
check('T2a 名字在引号前（同一行）', blockOrder(twice(`饭田: ${Q}`)), ['饭田:', `TEXT:${Q}`]);
check('T2b 名字在引号前（下一行）', blockOrder(twice(`饭田:\n${Q}`)), ['饭田:', `TEXT:${Q}`]);

// ── T3 多行连续对话（截图里的真实场景）──────────────────────────
check('T3 多行连续对话，三组全部「名字 → 台词」',
  blockOrder(twice(`${Q} 饭田:\n${Q2} 芦户:\n${Q3} 切岛:`)),
  ['饭田:', `TEXT:${Q}`, '芦户:', `TEXT:${Q2}`, '切岛:', `TEXT:${Q3}`]);

// ── T4 直角引号 ─────────────────────────────────────────────────
check('T4 直角引号 + 名字在后', blockOrder(twice(`「座位在那边，坐吧。」 Aizawa:`)),
  ['Aizawa:', 'TEXT:「座位在那边，坐吧。」']);

// ── T5 不该被误搬 ───────────────────────────────────────────────
check('T5 台词后跟旁白（不是名字）保持原样',
  blockOrder(twice(`“时间控制。稀有是稀有。”\n他把下巴往教室中间一抬。`)),
  ['TEXT:“时间控制。稀有是稀有。”', '他把下巴往教室中间一抬。']);

// ── T6 幂等性：跑第二遍不得再改变文本 ───────────────────────────
for (const [label, raw] of Object.entries({
  '名字在后': `${Q} 饭田:`,
  '名字在前': `饭田: ${Q}`,
  '多行': `${Q} 饭田:\n${Q2} 芦户:`,
  '直角引号': `「座位在那边，坐吧。」 Aizawa:`,
  '旁白在后': `“时间控制。稀有是稀有。”\n他把下巴往教室中间一抬。`
})) {
  const a = once(raw);
  const b = applyRegexScripts(a, scripts, 0, { isMarkdown: true });
  check(`T6 幂等（${label}）：第二遍不再改动`, b, a);
  check(`T6 幂等（${label}）：标签不成对重复`, (a.match(/<span class="say">/g) || []).length,
    (a.match(/<\/span>/g) || []).length);
}

// ── T7 短引用仍然不当台词（原门槛不能被破坏）────────────────────
check('T7 短引用「“好”」不套台词样式', once('“好”'), '“好”');
check('T7b 带标点的短引用仍按门槛通过', /<span class="say">/.test(once('“好，走吧”')), true);

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);

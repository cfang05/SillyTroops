// scripts/smoke-cardpool-utils.mjs
// 卡池展示层纯函数测试（评分/下载量/相对时间/URL 拼接）。
// 这些函数决定"卡片上显示什么数字"，口径错了会静默显示错数据，所以单独测一遍。
//
// 跑法：node scripts/smoke-cardpool-utils.mjs
import assert from 'assert';

// 工具模块用了 uni.* （仅 getStorageSync/setStorageSync），这里给个最小桩
globalThis.uni = {
  _s: {},
  getStorageSync(k) { return this._s[k] === undefined ? '' : this._s[k]; },
  setStorageSync(k, v) { this._s[k] = v; },
  request() {}
};

const mod = await import('../src/pages/cardpool/utils/cardpool_stats.js');
const { r2Url, averageRating, ratingText, downloadText, relativeTime, getMyRating, setMyRating, displayTags } = mod;

const out = [];
function check(name, fn) {
  try { fn(); out.push('  ✅ ' + name); }
  catch (e) { out.push('  ❌ ' + name + ' → ' + e.message); process.exitCode = 1; }
}

// ── 卡片 tag 展示口径（tagsZh 优先，缺字段回退 tags） ────────
check('有 tagsZh 时用中文 tag', () => {
  const card = { tags: ['adventure', 'anime', 'rpg'], tagsZh: ['冒险', '动漫', '角色扮演'] };
  assert.deepStrictEqual(displayTags(card), ['冒险', '动漫', '角色扮演']);
});
check('没有 tagsZh 字段时回退到英文 tags（老 manifest 不会整片丢标签）', () => {
  assert.deepStrictEqual(displayTags({ tags: ['adventure', 'rpg'] }), ['adventure', 'rpg']);
});
check('tagsZh 是空数组时也回退（上传脚本可能产出空值）', () => {
  assert.deepStrictEqual(displayTags({ tags: ['rpg'], tagsZh: [] }), ['rpg']);
});
check('tagsZh 不是数组时回退（脏数据不炸页面）', () => {
  assert.deepStrictEqual(displayTags({ tags: ['rpg'], tagsZh: '冒险,动漫' }), ['rpg']);
});
check('两个字段都缺时返回空数组', () => {
  assert.deepStrictEqual(displayTags({}), []);
  assert.deepStrictEqual(displayTags(null), []);
});
check('中文 tag 与英文 tag 长度可以不一一对应（按 tagsZh 自己的长度返回）', () => {
  assert.deepStrictEqual(displayTags({ tags: ['a'], tagsZh: ['甲', '乙', '丙'] }), ['甲', '乙', '丙']);
});

// ── URL 拼接 ────────────────────────────────────────────────
check('r2Url 拼出 R2 公开域名', () => {
  assert.strictEqual(r2Url('manifest.json'), 'https://cardpool.sillytroops.com/manifest.json');
});
check('r2Url 容忍前导斜杠（不会拼出 //）', () => {
  assert.strictEqual(r2Url('/a-thumb.webp'), 'https://cardpool.sillytroops.com/a-thumb.webp');
});
check('r2Url 对已是绝对地址的值原样返回', () => {
  assert.strictEqual(r2Url('https://cdn.example.com/x.webp'), 'https://cdn.example.com/x.webp');
});
check('r2Url 对空值返回空串', () => {
  assert.strictEqual(r2Url(''), '');
  assert.strictEqual(r2Url(null), '');
  assert.strictEqual(r2Url(undefined), '');
});

// ── 平均分：ratingSum / ratingCount，保留 1 位小数 ──────────
check('无评分 → null（前端显示「暂无评分」）', () => {
  assert.strictEqual(averageRating({ ratingSum: 0, ratingCount: 0 }), null);
  assert.strictEqual(averageRating({}), null);
  assert.strictEqual(averageRating(null), null);
  assert.strictEqual(ratingText({ ratingCount: 0 }), '暂无评分');
});
check('23/5 = 4.6', () => {
  assert.strictEqual(averageRating({ ratingSum: 23, ratingCount: 5 }), 4.6);
  assert.strictEqual(ratingText({ ratingSum: 23, ratingCount: 5 }), '4.6');
});
check('四舍五入到 1 位小数：10/3 = 3.3', () => {
  assert.strictEqual(ratingText({ ratingSum: 10, ratingCount: 3 }), '3.3');
});
check('满分为 5.0（保留 1 位小数，不显示成 5）', () => {
  assert.strictEqual(ratingText({ ratingSum: 5, ratingCount: 1 }), '5.0');
});
check('计数器缺失时按 0 处理，不抛错', () => {
  assert.strictEqual(ratingText({ ratingSum: 5 }), '暂无评分');
});

// ── 下载量 ──────────────────────────────────────────────────
check('下载量原样显示', () => {
  assert.strictEqual(downloadText({ downloadCount: 135 }), '135');
  assert.strictEqual(downloadText({ downloadCount: 0 }), '0');
});
check('stats 为 null（API 失败）→ 显示 --', () => {
  assert.strictEqual(downloadText(null), '--');
});

// ── 相对时间 ────────────────────────────────────────────────
check('相对时间档位正确', () => {
  const now = Date.now();
  assert.strictEqual(relativeTime(now - 10 * 1000), '刚刚');
  assert.strictEqual(relativeTime(now - 3 * 60 * 1000), '3 分钟前');
  assert.strictEqual(relativeTime(now - 2 * 3600 * 1000), '2 小时前');
  assert.strictEqual(relativeTime(now - 3 * 24 * 3600 * 1000), '3 天前');
});
check('超过 30 天回落到日期格式，且空值返回空串', () => {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(relativeTime(Date.now() - 60 * 24 * 3600 * 1000)));
  assert.strictEqual(relativeTime(0), '');
  assert.strictEqual(relativeTime(null), '');
});

// ── 本地评分记录（rated_cards） ─────────────────────────────
check('我的评分可写入并读回', () => {
  setMyRating('card_a', 4);
  assert.strictEqual(getMyRating('card_a'), 4);
  assert.strictEqual(getMyRating('card_never_rated'), 0);
});
check('写入不影响其他卡片', () => {
  setMyRating('card_b', 2);
  assert.strictEqual(getMyRating('card_a'), 4);
  assert.strictEqual(getMyRating('card_b'), 2);
});
check('脏数据（越界/非数字）按未评分处理', () => {
  setMyRating('card_bad', 9);
  assert.strictEqual(getMyRating('card_bad'), 0);
  uni._s['rated_cards'] = 'not-an-object';
  assert.strictEqual(getMyRating('card_a'), 0);
});

console.log('卡池展示层纯函数测试\n');
console.log(out.join('\n'));
console.log('\n' + (process.exitCode ? '存在失败用例' : '全部通过 ✅'));

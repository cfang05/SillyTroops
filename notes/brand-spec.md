# 无限旅团 · 设计规范 v2.0

**一句话总结：** 暗色「高级游戏感」——现代极简的精密克制为基底，叠加幻想游戏层（琥珀金主色、稀有度状态色、等宽数据字、衬线幻想标题），让跑团助手读起来既高级又有游戏性；所有页面以 H5 手机浏览器场景呈现（地址栏 + 系统状态栏，而非原生 App 全面屏）。

本版本基于最终定稿的 7 屏高保真 `wuxian-lvtuan-core-pages.html` 重新提取，是迁移到 `sillytroops-uni` 项目真实页面的唯一取值依据。迁移时按 §7 逐条核对，不要回翻高保真源文件里的中间态。

---

## 1. 核心令牌（OKLch）

| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg` | `oklch(17% 0.012 70)` | 页面主背景（暖调近黑，非蓝黑） |
| `--bg-deep` | `oklch(13.5% 0.011 70)` | 最深背景 / 浮层底 |
| `--surface` | `oklch(22% 0.014 70)` | 卡片 / 列表项 / 输入框 |
| `--surface-2` | `oklch(26.5% 0.016 70)` | 悬浮层 / 芯片底 / hover 背景 |
| `--raised` | `oklch(31% 0.018 70)` | 抬升面（开关关闭态、消息头像底） |
| `--fg` | `oklch(95% 0.008 70)` | 主文字 |
| `--fg-soft` | `oklch(88% 0.01 70)` | 次级主文字 |
| `--muted` | `oklch(67% 0.012 70)` | 说明文字 |
| `--faint` | `oklch(56% 0.012 70)` | 弱化文字（≥4.5:1 对比度下限） |
| `--border` | `oklch(31% 0.015 70)` | 发丝线边框 |
| `--border-strong` | `oklch(42% 0.02 70)` | 强调边框 / hover 边框 |
| `--accent` | `oklch(81% 0.13 84)` | 品牌强调 · 琥珀金（一屏至多 2 处） |
| `--accent-strong` | `oklch(71% 0.15 74)` | 主按钮 / CTA 渐变深端 |
| `--accent-soft` | `oklch(81% 0.13 84 / 0.14)` | 强调色浅底（激活 chip、选中态） |
| `--danger` | `oklch(64% 0.19 26)` | 危险 / 删除 / 未读红点 |
| `--success` | `oklch(74% 0.14 152)` | 完成 / 已勾选状态 |
| `--info` | `oklch(72% 0.11 235)` | 信息提示 |

**卡片强调色**（`--t-*`，每个模块/卡片独立身份色，通过 CSS 变量 `--tc` 注入到组件，同一中性面之上互不压制）：

| 变量 | 值 | 语义示例 |
|---|---|---|
| `--t-amber` | `oklch(78% 0.13 80)` | 开始冒险 / 主线功能 |
| `--t-violet` | `oklch(72% 0.12 295)` | 角色卡库 / 人物特性 |
| `--t-gold` | `oklch(82% 0.13 95)` | 传奇收藏 / 携带物品 |
| `--t-teal` | `oklch(74% 0.10 195)` | 酒馆导入 |
| `--t-emerald` | `oklch(74% 0.13 158)` | 我的角色 / 出场角色 |
| `--t-rose` | `oklch(72% 0.12 15)` | 游戏规则 / 其他辅助模块 |

暗金边框（所有手机屏幕四周描边，H5 场景下用于模拟设备边界，迁移到真实 H5 页面时**不需要**，仅高保真展示用）：`inset 0 0 0 1px oklch(60% 0.10 76 / 0.85)`。

## 2. 字体栈

```css
--font-display: 'Cinzel', 'Noto Serif SC', 'Songti SC', serif;   /* 拉丁大写标题，中文场景基本不触发 */
--font-serif: 'Noto Serif SC', 'Songti SC', 'SimSun', serif;     /* 中文展示标题 / Hero 大字 */
--font-body: 'Noto Sans SC', -apple-system, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif; /* 正文、导航、按钮、卡片描述 */
--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace; /* 仅用于数值/时间/技术性眉题 */
```

**字体使用边界（重要，避免误用）：**

- `--font-serif`：页面主标题 / Hero 大标题 / 头像字母（如 h1、`.sess-hero h1`、`.cover h1`）。
- `--font-body`：所有正文、导航栏标题、tabbar 标签、按钮文字、卡片描述——**默认字体**，不显式声明时页面继承的就是它。
- `--font-mono`：**只用于**数值型或技术性内容——等级数字、XP、时间戳、状态栏时间、地址栏 URL、大写字距的技术眉题（如 `STEP 1/2`）。不要用在导航标签、按钮文案、卡片正文等自然语言文案上（v1.0 曾把 tabbar 标签误用 mono，已在迁移前修正为 body 字体）。

**字号阶梯（按组件角色，非任意取值）：**

| 角色 | 字号 | 字体 | 示例 |
|---|---|---|---|
| Hero / Cover 大标题 | 32px | serif, 900 | 品牌封面 `h1` |
| 页面级标题 | 16–18px | serif, 900 | 设置页/session Hero `h1` |
| 导航栏标题 | 14–15px | body, 700 | chat-nav / sess-nav `h2` |
| 卡片名称 / 强调数字 | 12–15px | body 700 或 mono 700 | `.card-item .cname`、`.sess-stat b` |
| 正文说明 | 10–13.5px | body/serif 常规 | 描述文字、表单说明 |
| 小标签 / meta | 8.5–9.5px | body 500 | tabbar 标签、conv 时间/条数 |
| mono 技术眉题 | 7–11px | mono, 大写 + 宽字距 | 状态栏、地址栏、STEP 标签 |

- 展示字号紧字距：标题 `letter-spacing: .01–.02em`；mono 眉题 `letter-spacing: .08–.26em` + 大写（用 `.mono` 类）。

## 3. 视觉语言规则

1. **一屏一强调**：品牌金只出现在「激活态 + 主 CTA + 等级/奖励」；其余全部走中性面与模块强调色，禁止整屏渐变。
2. **发丝线优先**：边框用 `--border`，阴影只留给弹层、Tab 悬浮球与主 CTA 的发光。
3. **游戏元素成体系**：XP 药丸（tint 15% 底 + tint 文字）、等级丝带（玻璃拟态 + 金渐变进度条）、奖励印章（旋转描边徽章）——所有数值统一等宽字。
4. **图标全部内联 SVG 线性描边**（stroke 1.6–2.4、圆角端点），禁用 emoji 图标。
5. **状态成对定义**：hover 移动背景 L 通道 ±0.06–0.12 或描边/位移动画，前景色永远不得变淡；所有可聚焦元素必须有 `:focus-visible` 金环（2px `--accent` 或 `--fg` 描边，2–3px 偏移）；`prefers-reduced-motion` 下关闭位移/滚动动画，仅保留透明度过渡。
6. **动效纪律**：微交互 150–200ms 曲线过渡；跑马灯 3–4 个循环后停、悬停暂停；奖励动效一次性触发，不循环。
7. **滚动条**：所有可滚动区域统一使用细滚动条（4px，WebKit）+ 透明轨道 + 暗金混合色滑块（`color-mix(in oklch, var(--accent) 38%, var(--border-strong) 62%)`），横向内边距要与该容器视觉留白一致（不能因为把 padding 放在父容器而导致滚动条内缩）。

## 4. 通用组件规格

### 导航栏（返回键 + 居中标题）
所有需要返回的页面统一用这套结构，标题必须真正居中（返回键与右侧占位等宽）：
```
<返回键 34×34px 圆角10px> <标题列 flex:1 text-align:center> <占位 34px>
```
- 容器高度 54px，横向 padding 16px。
- 返回键：`.back-btn`，背景 `--surface`，边框 `--border`，hover 边框转 `--border-strong` + 背景 `--surface-2`。
- 标题：14–16px，700–900。若有副标题（如设置页），标题列内纵向堆叠标题+副标题（10px `--muted`）。

### 底部 Tab 栏
- 高度 55px，`padding: 13px 8px 0`，背景 `oklch(15% 0.012 70 / 0.85)` + 18px 毛玻璃模糊，顶部发丝线。
- 每个 tab：图标 17×17px + 标签 9.5px（`--font-body`，非 mono），默认色 `--faint`，hover `--fg-soft`，激活 `--accent`。
- 中央 CTA（如"新建"）用悬浮圆角方形按钮 `.fab`：36×36px，圆角12px，上移 20px，金色渐变背景。

### 卡片 / Chip 类
- **info-card / setn-section**：`--surface` 背景，`--border` 描边，圆角 13–16px。
- **equip-chip（装备格）**：flex 列，图标 chip（26×26px，`--tc` 15% 底色+`--tc` 图标色）+ 粗标题（10.5px）+ mono 说明（8px），hover 边框转 `--tc` 混合色并上移1px。
- **quest-tile / card-item（网格卡）**：圆角14–15px，选中态用 `--accent` 描边 + 渐变底；hover 上移1px。

### 列表项（checklist / 对话历史）
- **step（清单步骤）**：圆角14px，`idx` 圆角方形（25×25px）承载序号/勾选图标；`done` 态用 `--success` 系描边+图标色，`pending` 态用虚线描边+`--accent` 图标色。
- **conv-item（历史对话）**：头像40×40px圆角12px渐变底 + 名称/预览两行 + 右侧时间/条数/删除按钮，hover 边框转 `--border-strong` 并右移2px。

### 按钮
- **主 CTA（`.cta` / `.btn-primary`）**：高度44–48px，圆角对半（药丸形），金色渐变背底 + 深色文字 `#171104`，禁止一屏内出现第二个同功能主按钮。
- **次级（`.btn-ghost`）**：`--surface` 背景 + `--border` 描边，用于"取消/返回修改"等次要动作。
- **开关（`.sw`）**：36×21px 胶囊，关闭态 `--raised` 底 + `--border-strong` 描边，开启态金色渐变 + 深色圆点。

### 表单
- input/textarea：`--surface` 背景，`--border` 描边，focus 时描边转 `--accent` + 背景转 `--surface-2`；错误态描边 `--danger`，错误文案 11px `--danger` + 图标。

## 4b. 布局与响应式（PC 宽屏 / 导航栏间距 / 内容留白）

本项目所有页面只面向 H5 手机浏览器场景设计（§1 已说明），但用户可能在 PC 端用宽屏浏览器直接打开，此时必须保持手机视口比例，不能让内部元素被横向拉伸变形。以下规则统一写入 `App.vue` 全局样式，页面自身不需要单独处理：

- **设备画布定宽**：页面内容整体限宽 `480px`（覆盖主流手机 + 小平板宽度），超出的视口宽度部分左右用比 `--bg-deep` 更深的纯黑（`oklch(9% 0.006 70)`）填充，画布本体用 `margin: 0 auto` 居中，不做拉伸缩放（不是 `transform: scale`，而是限宽+居中，保证字号/元素实际尺寸不失真）。视口宽度 ≤480px 时画布自动退回 100% 宽度贴合真实视口，不产生额外留白。
- **画布描边**：画布左右两侧各加 1px 亮金描边（`oklch(84% 0.15 88)`），用 viewport 固定定位的覆盖层实现（宽度同样限定 480px 并居中，`pointer-events: none`），保证任何视口宽度下都贴着画布实际左右边缘、永远盖在所有页面自身元素之上，不被任何页面的 `z-index` 覆盖，也不接收点击事件。
- **fixed 定位元素必须跟随画布宽度**：`position: fixed; left:0; right:0`（自定义导航栏、聊天输入栏、全屏弹层遮罩等）默认相对浏览器视口撑满，不受页面限宽居中影响；宽屏下会撑到浏览器窗口边缘、和画布左右边缘不对齐，窄屏下也可能因为忽略了画布宽度约束而在极端场景超出可视区域。这类元素必须额外加 `max-width: 480px; margin: 0 auto`（保留 `fixed` 定位本身，不改变随内容滚动的行为），使其可视宽度收窄到画布宽度并居中，与画布左右边缘始终对齐对称。新增此类全屏固定元素时必须补上这条规则，不要遗漏。
- **导航栏与内容间距**：所有使用自定义 `NavBar` 的页面，内容区顶部间距统一为 `navBarHeight + 32rpx`（即导航栏高度之外再留 16px 呼吸间距），不能只留 `navBarHeight` 让内容贴着导航栏下边缘。`utils/navbar.js` 的 `getNavBarHeight()` 只返回导航栏本身高度，页面内负责这段间距时统一按这个公式加，不要各自取不同的额外值。
- **内容区左右留白对称**：所有页面的可滚动内容容器（`scroll-view` / 内容 `view`）统一使用左右对称的内边距（`padding: 0 32rpx` 或 `24rpx`，同一页面内左右必须相等），横向排列的子元素（标签组、chip 组、按钮组等）超出该内边距宽度时必须换行（`flex-wrap: wrap`）而不是横向溢出裁切或撑破布局；不允许出现"左边有留白、右边贴边甚至超出画布"的不对称情况。同一容器内共享同一 CSS 类的多个输入框/元素，如果只有部分实例需要额外单侧内边距（例如给右侧图标让位），必须拆出独立的修饰类（如 `.input-with-icon`），不能让不需要该留白的实例也被迫牺牲对称性。
- **flex 子项防溢出**：任何 `display:flex` 行内如果某个子项设置了 `flex:1` 并且内部文字使用 `white-space:nowrap`/`text-overflow:ellipsis`，必须同时给该子项加 `min-width: 0`（flex item 默认 `min-width:auto` 会阻止其收缩，导致长文本把整行撑出容器造成横向溢出，这是 uni-app H5 编译后的 `<text>` 标签上最容易触发的一类 bug）。

## 5. 迁移单位换算

高保真使用 px（面向桌面/H5 预览），真实项目 uni-app 页面使用 `rpx`。换算基准 **750rpx = 375px**（即 1px = 2rpx）：

| 高保真 px | 项目 rpx |
|---|---|
| 8px | 16rpx |
| 10px | 20rpx |
| 12px | 24rpx |
| 14px | 28rpx |
| 16px | 32rpx |
| 20px | 40rpx |
| 34px | 68rpx |
| 44px | 88rpx |
| 54px | 108rpx |

字号可保留 px 或直接乘 2 转 rpx，两者在 750rpx 设计稿基准下等价；项目现有代码用的是 rpx（如 `new-conversation.vue` 里的 `30rpx`），迁移时统一用 rpx 以保持项目内一致性。

## 6. uni.scss 移植片段

```scss
$bg: oklch(17% 0.012 70);
$bg-deep: oklch(13.5% 0.011 70);
$surface: oklch(22% 0.014 70);
$surface-2: oklch(26.5% 0.016 70);
$raised: oklch(31% 0.018 70);
$fg: oklch(95% 0.008 70);
$fg-soft: oklch(88% 0.01 70);
$muted: oklch(67% 0.012 70);
$faint: oklch(56% 0.012 70);
$border: oklch(31% 0.015 70);
$border-strong: oklch(42% 0.02 70);
$accent: oklch(81% 0.13 84);
$accent-strong: oklch(71% 0.15 74);
$danger: oklch(64% 0.19 26);
$success: oklch(74% 0.14 152);
$info: oklch(72% 0.11 235);

$t-amber: oklch(78% 0.13 80);
$t-violet: oklch(72% 0.12 295);
$t-gold: oklch(82% 0.13 95);
$t-teal: oklch(74% 0.10 195);
$t-emerald: oklch(74% 0.13 158);
$t-rose: oklch(72% 0.12 15);

$font-display: 'Cinzel', 'Noto Serif SC', serif;
$font-serif: 'Noto Serif SC', 'Songti SC', serif;
$font-body: 'Noto Sans SC', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
$font-mono: 'JetBrains Mono', ui-monospace, monospace;
```

> 注意：`oklch()` 与 `color-mix()` 需要较新的 WebView / H5 运行环境；如需兼容旧内核，可在构建期用 PostCSS 插件（postcss-oklch）降级为十六进制。uni-app H5 编译目标（`npm run dev:h5`）基于现代浏览器内核，可直接使用。

## 7. 页面组件映射（迁移对照表）

7 屏高保真与真实项目路由的对应关系，迁移时逐项核对：

| 高保真 Phone | 真实页面路径 | 核心结构 | 关键组件 |
|---|---|---|---|
| 01 首页 | `pages/index/index.vue` | 打招呼行 + 等级丝带 + 功能宫格 + tabbar | `.greet-row` `.ribbon` `.quest-grid`（正方形卡片，纵向拉长20%） |
| 02 登录/注册 | `pages/login/login.vue` | 品牌头 + 登录/注册分段 + 表单 + 测试账号提示 | `.auth-crest` `.field` `.auth-hint` |
| 03 当前冒险 | `pages/chat/chat.vue` | 毛玻璃导航 + 消息流 + 输入栏 | `.chat-nav` `.msg-row`（`.user` 靠右需 `justify-content:flex-start` 配合 `row-reverse`）`.bubble` `.chat-inputbar` |
| 04 模型设置 | `pages/settings/settings.vue` | 返回导航（居中标题）+ 使用说明 + 模型列表 + 开关分组 + 底部双按钮 | `.setn-head`（含 back-btn）`.model-list` `.sw` `.setn-footer` |
| 05 开始冒险 | `pages/session/session.vue` | 返回导航 + 新建对话CTA + 概览统计 + 历史对话列表 | `.sess-nav` `.sess-stats` `.conv-item` |
| 06 新建对话 | `pages/session/new-conversation.vue` | 返回导航 + Hero + 装备格(出场角色/携带物品/人物特性) + 出发清单(绑定角色卡/API检查/预设检查/正侧配置) + 开始冒险CTA | `.sess-hero` `.equip-row` `.step` `.cta` |
| 07 品牌封面 | 无对应真实路由，早期方向探索，仅供品牌语言参考 | Hero文案 + 今日冒险预览跑马灯 | `.cover` `.teaser` |

**待补充高保真**（未纳入本轮 7 屏，仍按方向文字说明执行）：

- 角色卡库 `pages/characters/index.vue`：卡片化，渐变头像 + 标签 + 悬停位移 + 激活金边。
- 传奇收藏 `pages/collect/collect.vue`：稀有度色体系（常见→青 / 稀有→蓝 / 史诗→紫 / 传奇→金），网格卡片 + 稀有度角标。
- 全局导航栏 `pages.json`：`#2c3e50` 蓝色需替换为 `--bg-deep` + 金激活色，`navigationBarTextStyle: white`。

## 8. 迁移检查清单（每页迁移后自检）

- [ ] 颜色值全部来自 §1 token，没有硬编码十六进制。
- [ ] 字体用途符合 §2 边界（导航/按钮/正文不使用 mono）。
- [ ] px→rpx 换算正确（§5），视觉比例与高保真一致。
- [ ] 返回导航居中、tabbar 尺寸/字体统一（若该页有）。
- [ ] hover/focus/active/disabled 状态都已实现，对比度不低于默认态。
- [ ] uni-app 标签替换正确（`div`→`view`，文本包在 `text` 里，`button`保留原生）。
- [ ] 导航栏与内容区间距符合 §4b（`navBarHeight + 32rpx`），不贴边。
- [ ] 内容区左右留白对称（§4b），横向排列元素超宽会换行，不会溢出画布或撑破布局。
- [ ] flex:1 子项若配合 white-space:nowrap 使用，已加 min-width:0（§4b），无横向撑破。
- [ ] 新增的全屏 `position:fixed` 元素已加入 App.vue 的画布宽度约束选择器列表（§4b）。
- [ ] 用 `npm run dev:h5` 实跑验证，无横向滚动、无遮挡、无溢出，且在宽屏浏览器打开时画布保持手机比例、不被拉伸。


<template>
  <view class="container">
    <NavBar title="设置" subtitle="模型 / 显示 / 数据 与备份" />

    <scroll-view class="content" scroll-y="true" :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <view class="section info-section">
        <view class="info-card">
          <view class="info-icon-wrap">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.2"/><path d="M10 13.4V9.6M10 6.8h.01"/></svg>
          </view>
          <view class="info-text">
            <text class="info-title">使用说明</text>
            <!-- #ifdef MP-WEIXIN -->
            <text class="info-desc">小程序端的内置默认模型已失效下线，请选择一种模型并填写对应的 API Key 后再开始对话。</text>
            <!-- #endif -->
            <!-- #ifndef MP-WEIXIN -->
            <text class="info-desc">测试账号（含 admin）可直接使用内置测试 API；其他账号请填写 API Key（支持 DeepSeek 等 OpenAI 兼容接口）再开始对话。</text>
            <!-- #endif -->
          </view>
        </view>
      </view>

      <view class="section">
        <text class="section-title">选择模型</text>
        <view class="model-list">
          <view
            v-for="item in modelList"
            :key="item.id"
            :class="['model-item', currentModel === item.id ? 'active' : '']"
            @tap="onSelectModel"
            :data-id="item.id"
          >
            <view class="model-info">
              <text class="model-name">{{ item.name }}</text>
              <text class="model-desc">{{ item.desc }}</text>
            </view>
            <view class="model-check">
              <svg v-if="currentModel === item.id" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>
            </view>
          </view>
        </view>

        <!-- 测试 API 通道：只有选中「测试 API（内置）」时才出现。
             三条通道的 Key / 地址 / 模型名全部由服务端变量决定，前端只上报通道 id。
             点选即生效（立即写盘），不需要页面底部的"保存"。 -->
        <view v-if="currentModel === 'test'" class="test-api-block">
          <text class="test-api-title">测试 API 通道</text>
          <text class="test-api-hint">Key / 地址 / 模型由服务端配置；点一下即生效，无需保存</text>
          <view v-if="testApis.length === 0" class="empty-hint">
            <text>服务端没有提供任何测试通道，请检查服务端变量</text>
          </view>
          <view
            v-for="api in testApis"
            :key="api.id"
            :class="['test-api-item', selectedTestApiId === api.id ? 'active' : '', api.enabled ? '' : 'unavailable']"
            @tap="onSelectTestApi(api)"
          >
            <view class="test-api-info">
              <view class="test-api-head">
                <text class="test-api-name">{{ api.label }}</text>
                <text v-if="!api.enabled" class="test-api-badge">未配置</text>
              </view>
              <text class="test-api-desc">提供商：{{ api.provider || '—' }}</text>
              <text class="test-api-desc">模型：{{ api.model || '—' }}</text>
            </view>
            <view class="model-check">
              <svg v-if="selectedTestApiId === api.id && api.enabled" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>
            </view>
          </view>
        </view>
      </view>

      <view class="section" v-if="currentModel !== 'test'" >
        <text class="section-title">API配置</text>

        <view class="form-item">
          <text class="label required">API Key</text>
          <input
            class="input input-with-icon"
            type="text"
            placeholder="请输入API Key"
            :value="apiKey"
            @input="onApiKeyInput"
            :password="!showApiKey"
          />
          <view class="toggle-password" @tap="toggleApiKeyVisibility">
            <svg v-if="showApiKey" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 10S4.5 4.5 10 4.5 18.2 10 18.2 10 15.5 15.5 10 15.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.4"/></svg>
            <svg v-else viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 10S4.5 4.5 10 4.5 18.2 10 18.2 10 15.5 15.5 10 15.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.4"/><path d="M3 17L17 3"/></svg>
          </view>
        </view>

        <view class="form-item" v-if="currentModel === 'openai' || currentModel === 'custom'">
          <text class="label">API URL</text>
          <input
            class="input"
            type="text"
            placeholder="请输入API地址（可选）"
            :value="apiUrl"
            @input="onApiUrlInput"
          />
        </view>

        <view class="form-item" v-if="currentModel === 'custom'">
          <text class="label">模型名称</text>
          <input
            class="input"
            type="text"
            placeholder="请输入模型名称"
            :value="modelName"
            @input="onModelNameInput"
          />
        </view>
      </view>

      <!-- 测试通道的当前状态：只读展示，切换在上面的「选择模型 → 测试 API 通道」里点选 -->
      <view class="section" v-if="currentModel === 'test'">
        <text class="section-subtitle" v-if="selectedTestApi && selectedTestApi.enabled">
          当前测试通道：{{ selectedTestApi.label }} · {{ selectedTestApi.provider || '—' }} · {{ selectedTestApi.model || '—' }}
          —— Key / 地址 / 模型由服务端统一配置，无需填写
        </text>
        <!-- 选中的通道服务端没配 Key（或已关闭）时必须说清"不可用"，
             否则这行会显示成"当前测试通道：xxx"，看着像能用、一发消息就报错。 -->
        <text class="section-subtitle" v-else-if="selectedTestApi">
          当前选中的测试通道「{{ selectedTestApi.label }}」在服务端未配置（或已关闭），暂时不可用：请在上面换一条通道，或选择其他模型并填写自己的 API Key
        </text>
        <text class="section-subtitle" v-else>测试通道当前不可用，请选择其他模型并填写自己的 API Key</text>
      </view>

      <!-- 没有测试权限时的说明：新注册账号默认没有测试权限（is_test=false），
           上面列表里不会出现「测试 API（内置）」。这里明确说清"为什么没有"和"怎么拿到"，
           否则用户会以为功能坏了（这个选项以前是人人都有的）。 -->
      <view class="section" v-if="!isTestAccount && testApiInfo.enabled">
        <text class="section-subtitle">「测试 API（内置）」需要管理员开通测试权限后才会出现在上方列表；开通后重新进入本页即可选择。你也可以直接填写自己的 API Key 使用其他模型。</text>
      </view>

      <!-- 自定义 CSS（P4.3 / D2）：正侧产出 class，这里决定外观 -->
      <view class="section">
        <text class="section-title">自定义 CSS</text>
        <text class="section-subtitle">配合正则脚本产出的 class 使用（系统正侧的台词样式为 .say）。仅 H5 生效；留空即用系统默认。</text>
        <textarea
          class="css-input"
          v-model="customCss"
          placeholder=".say { color: #e8c46a; font-style: italic; }"
          auto-height
        />
        <view class="quick-preset-row">
          <button class="btn-secondary quick-btn" @tap="onResetCustomCss">恢复默认</button>
          <button class="btn-primary quick-btn" @tap="onSaveCustomCss">保存并应用</button>
        </view>
      </view>

      <!-- 流式输出（改版）：去掉"平滑输出"开关，只留一个 10~100 的显示速度滑条。
           最左 10 = 最慢；最右 100 = 全速（等价于关闭平滑输出，完全跟上游速度）。每次只能调整 5。 -->
      <view class="section">
        <text class="section-title">流式输出</text>
        <text class="section-subtitle">控制文字"逐字释放"的速度。滑到最右侧 100 为全速：不限制显示速度，完全跟上游速度（高速模型会一屏字瞬间涌出）</text>
        <view class="form-item">
          <view class="pacing-head">
            <text class="label">显示速度</text>
            <text class="pacing-value">{{ pacingLabel }}</text>
          </view>
          <slider
            class="pacing-slider"
            :value="pacingCfg.charsPerSec"
            :min="PACING_MIN"
            :max="PACING_FULL_SPEED"
            :step="PACING_STEP"
            :show-value="false"
            activeColor="#c9a84a"
            backgroundColor="#3a332a"
            block-size="20"
            @change="onPacingRateChange"
          />
          <view class="pacing-scale">
            <text class="pacing-scale-text">慢 {{ PACING_MIN }}</text>
            <text class="pacing-scale-text">全速 {{ PACING_FULL_SPEED }}</text>
          </view>
        </view>
      </view>

      <!-- 思考内容（P6.6 / P6.1 / P6.4 / D17） -->
      <view class="section">
        <text class="section-title">思考内容</text>
        <text class="section-subtitle">思考与正文严格分离：只会显示在可折叠的「思考过程」块里，不写进存档正文、也不会回灌上下文</text>
        <view class="switch-item">
          <text class="switch-label">启用模型思考（更慢、更费 token）</text>
          <switch :checked="thinkingEnabled" @change="onToggleThinking" color="#c9a84a" />
        </view>
        <view class="switch-item">
          <text class="switch-label">解析正文里的思考（自动识别定界符）</text>
          <switch
            :checked="reasoningCfg.enabled"
            @change="(e) => { reasoningCfg.enabled = !!(e.detail && e.detail.value); onSaveReasoningCfg() }"
            color="#c9a84a"
          />
        </view>
        <text class="section-subtitle">打开后自动识别正文里的思考定界符（无需配置）：命中就把这段内容从正文移除、放进上面的「思考过程」折叠块；折叠块里会同时显示上游思考与这里切出来的思考，点标题可收起/展开。支持的定界符：{{ reasoningDelimiterHint }}</text>
      </view>

      <!-- 上下文详情（P3.4 / D14）：诊断类入口，和"数据与存储"一起放到页面靠后位置，
           不占用模型/显示这些日常要改的设置的位置。 -->
      <view class="section">
        <text class="section-title">上下文详情</text>
        <text class="section-subtitle">查看最近几次请求实际发送了什么、各段占多少 token、有没有省略历史</text>
        <button class="btn-secondary" @tap="showContextInspector = true">打开上下文详情</button>
      </view>

      <!-- 数据与存储（P5.4 / D8）：对话存档在 IndexedDB，这里只留"导入 / 导出备份"两个按键。
           持久化存储改为进页面时自动申请（见 onLoad 的 _autoRequestPersist），不再需要用户点。 -->
      <view class="section">
        <text class="section-title">数据与存储</text>
        <text class="section-subtitle">对话存档已改用 IndexedDB（容量更大、写入不阻塞界面）；本地数据可能被浏览器清理，建议定期导出备份</text>
        <text class="storage-line">已用空间：{{ storageUsageText }}</text>
        <text class="storage-line">持久化存储：{{ storagePersisted ? '已启用' : '未启用（已自动申请，浏览器未授予）' }}</text>
        <view class="quick-preset-row">
          <button class="btn-secondary quick-btn" @tap="onImportBackup">导入备份</button>
          <button class="btn-primary quick-btn" @tap="onExportBackup">导出备份</button>
        </view>
      </view>

      <!-- 作者注（Author's Note） -->
      <view class="section">
        <text class="section-title">作者注</text>
        <text class="section-subtitle">定时注入的全局提示，用于强调设定 / 风格 / 状态（对齐酒馆 Author's Note）</text>
        <view class="form-item">
          <text class="label">作者注内容</text>
          <textarea class="input textarea" placeholder="例如：{{char}} 正保持谨慎，注意周围环境…" :value="noteConfig.promptText" @input="onNotePromptInput" maxlength="2000" />
        </view>
        <view class="form-item">
          <text class="label">注入频率（每 N 条用户消息）</text>
          <input class="input" type="number" :value="noteConfig.interval" @input="onNoteIntervalInput" />
        </view>
        <view class="form-item">
          <text class="label">注入深度（IN_CHAT 时，倒数第 N 条之前）</text>
          <input class="input" type="number" :value="noteConfig.depth" @input="onNoteDepthInput" />
        </view>
        <view class="form-item">
          <text class="label">注入位置</text>
          <view class="chip-row">
            <view v-for="p in notePositions" :key="p.value" :class="['chip', noteConfig.position === p.value ? 'active' : '']" @tap="onNotePosition(p.value)">{{ p.label }}</view>
          </view>
        </view>
        <view class="form-item">
          <text class="label">注入角色（IN_CHAT）</text>
          <view class="chip-row">
            <view v-for="r in noteRoles" :key="r.value" :class="['chip', noteConfig.role === r.value ? 'active' : '']" @tap="onNoteRole(r.value)">{{ r.label }}</view>
          </view>
        </view>
      </view>
      <!-- 渲染开关（用户要求：折叠 + 下移到页面靠后位置）
           只保留真正生效的四项；原来的"音乐播放器"是死开关（代码里没有任何地方读取它），已删除。 -->
      <view class="section">
        <view class="section-header" @tap="renderersExpanded = !renderersExpanded">
          <text class="section-title">渲染开关</text>
          <text class="collapse-arrow">{{ renderersExpanded ? '▲ 收起' : '▼ 展开' }}</text>
        </view>
        <text class="section-subtitle">控制 AI 回复中特殊标签是否渲染为交互组件（默认收起）</text>
        <view v-if="renderersExpanded">
          <view class="switch-item" v-for="item in rendererSwitches" :key="item.key">
            <view class="switch-text">
              <text class="switch-label">{{ item.label }}</text>
              <text class="switch-desc">{{ item.desc }}</text>
            </view>
            <switch :checked="pluginRenderers[item.key]" @change="onToggleRenderer(item.key, $event)" color="#c9a84a" :disabled="item.key === 'html' && isMpWeixin" />
          </view>
        </view>
      </view>

    </scroll-view>

    <!-- 底部按钮 -->
    <view class="footer">
      <button class="btn-secondary" @tap="onReset">重置默认</button>
      <button class="btn-primary" @tap="onSave">保存设置</button>
    </view>

    <!-- 上下文详情弹窗（P3.4 / D14） -->
    <ContextInspector :visible="showContextInspector" @close="showContextInspector = false" />
  </view>
</template>

<script>
import storage from '../../utils/storage.js'
import { scopedKey } from '../../utils/account/userScope.js'
import userManager from '../../utils/account/userManager.js'
import { usePluginStore } from '../../stores/pluginStore'
import { useNoteStore } from '../../stores/noteStore'
import { getNavBarHeight } from '../../utils/navbar.js'
import { getTestApiConfig, getSelectedTestApiId, DEFAULT_TEST_API_CHANNEL_ID } from '../../utils/llm/client.js'
import NavBar from '../../components/common/NavBar.vue'
import ContextInspector from '../../components/render/ContextInspector.vue'
import { loadCustomCss, saveCustomCss, initCustomCss } from '../../utils/customCss'
import { exportBackup, pickBackupFile, restoreBackup } from '../../services/backupService'
import { loadReasoningConfig, saveReasoningConfig, REASONING_DELIMITERS } from '../../engine/ReasoningHandler'
import { loadPacingConfig, savePacingConfig, PACING_MIN, PACING_FULL_SPEED, PACING_STEP } from '../../utils/streamPacing'

// LLM 配置改为按当前用户隔离存储（原全局 STORAGE_KEYS.LLM_CONFIG 键名不变，但加上用户前缀）
function llmConfigKey() {
  return scopedKey('ai_model_settings')
}

export default {
  components: { NavBar, ContextInspector },
  computed: {
    /** 支持的思考定界符（D21：硬编码自动识别，这里只是把清单展示给用户看） */
    reasoningDelimiterHint() {
      return REASONING_DELIMITERS.map(pair => pair[0] + ' … ' + pair[1]).join('、')
    },
    /** 存储用量文案（P5.4）：不支持查询的环境给出明确说明而不是空白 */
    storageUsageText() {
      const u = this.storageUsage
      if (!u || !u.quota) return '（当前环境不支持查询）'
      const mb = (n) => (n / 1024 / 1024).toFixed(1)
      return `${mb(u.usage)} MB / ${mb(u.quota)} MB`
    },
    /** 流式速度文案：最右侧 = 全速（等价于关闭平滑输出） */
    pacingLabel() {
      const r = this.pacingCfg.charsPerSec
      return r >= PACING_FULL_SPEED ? '全速（不限速）' : `${r} 字/秒`
    },
    /** 当前选中的测试通道（用于只读状态行）；找不到返回 null */
    selectedTestApi() {
      if (!this.testApis.length) return null
      return this.testApis.find(a => a.id === this.selectedTestApiId) || null
    }
  },
  data() {
    return {
      // 滑条的边界常量（模板里用，避免魔法数字散落）
      PACING_MIN,
      PACING_FULL_SPEED,
      PACING_STEP,
      navBarHeight: 0,
      // 上下文详情弹窗（P3.4 / D14）
      showContextInspector: false,
      // 自定义 CSS（P4.3 / D2）
      customCss: '',
      // 数据与存储（P5.4）
      storageUsage: null,      // { usage, quota } | null
      storagePersisted: false,
      // 思考内容（P6.6 / P6.4）
      thinkingEnabled: false,
      reasoningCfg: { enabled: false },
      // 流式输出节奏：10~100，100 = 全速
      pacingCfg: { enabled: true, charsPerSec: 80 },
      modelList: [],
      currentModel: '',
      /** 没有测试权限、也没选过模型时的回落项（按平台不同） */
      fallbackModel: 'openai',
      apiKey: '',
      apiUrl: '',
      modelName: '',
      showApiKey: false,
      isTestAccount: false,
      // 渲染开关（默认收起，见模板里的 renderersExpanded）
      renderersExpanded: false,
      pluginRenderers: { branch: true, summary: true, time: true, html: false },
      rendererSwitches: [
        { key: 'branch', label: '选项按钮（branches）', desc: 'AI 给出 <branches>A.… B.…</branches> 时渲染成可点按钮，点一下即作为你的发言发送' },
        { key: 'summary', label: '摘要卡片（meow_FM）', desc: 'AI 输出 <meow_FM>…</meow_FM> 时渲染成摘要卡片；关闭则按纯文本显示' },
        { key: 'time', label: '时间卡片（time_format）', desc: 'AI 输出 <time_format date="…" time="…" scene="…"/> 时渲染成时间卡片' },
        { key: 'html', label: '自定义 HTML（仅 H5）', desc: '把 ```html 代码块用 iframe 渲染出来，默认关闭（有安全与性能风险）' }
      ],
      // 作者注（字段名与 types/note.ts 的 AuthorsNoteConfig 对齐：promptText / interval）
      noteConfig: { promptText: '', interval: 1, depth: 4, position: 1, role: 'system' },
      notePositions: [
        { value: 0, label: '场景后(IN_PROMPT)' },
        { value: 1, label: '历史深处(IN_CHAT)' },
        { value: 2, label: '提示词前(BEFORE)' }
      ],
      noteRoles: [
        { value: 'system', label: 'system' },
        { value: 'user', label: 'user' },
        { value: 'assistant', label: 'assistant' }
      ],
      isMpWeixin: false,
      // 内置测试通道的公开信息（无密钥）：可用性与展示名都来自服务端，
      // 这样官方调整模型名/换厂商时只需改服务端变量，前端无需改代码/重新发版
      testApiInfo: { enabled: false, label: '', model: '' },
      /** 服务端提供的测试通道清单（api1 / api2 / api3） */
      testApis: [],
      /** 当前选中的测试通道 id（与对话请求共用同一份配置） */
      selectedTestApiId: ''
    }
  },

  onLoad() {
    // 需要登录：未登录会被 reLaunch 到登录页（守卫实现在 App.vue 的 checkUserLogin）
    if (!getApp().checkUserLogin()) return
    this.navBarHeight = getNavBarHeight().navBarHeight
    this._initModelList()
    this.loadSettings()
    // 测试权限可能刚被管理员打开/关闭：向服务端核一次并据此重建模型列表。
    // 新账号注册时默认没有测试权限，用户"等管理员开权限"期间不必重新登录/清缓存。
    this._refreshTestPermission()
    this._loadTestApiInfo()
    this._initPluginStore()
    this._initNoteStore()
    // 自定义 CSS（P4.3 / D2）：载入用户样式并确保默认样式已注入
    this.customCss = loadCustomCss()
    initCustomCss()
    // 数据与存储信息（P5.4）：读取用量后自动申请持久化（不再需要用户手点按钮）
    this._loadStorageInfo().then(() => this._autoRequestPersist())
    // 思考内容（P6.6 / P6.4）
    this.thinkingEnabled = storage.get(scopedKey('ai_thinking_enabled')) === true
    this.reasoningCfg = loadReasoningConfig()
    // 流式输出节奏：读取时归一化（老配置里"平滑输出关闭"等价于全速 100）
    this.pacingCfg = loadPacingConfig()
    // #ifdef MP-WEIXIN
    this.isMpWeixin = true
    // #endif
  },

  methods: {
    /**
     * 显示速度滑条（改版）：10~100，步进 5。
     * 100 = 全速（等价于原来的"关闭平滑输出"），因此 enabled 由速率派生，不再单独存开关。
     */
    onPacingRateChange(e) {
      const v = Number(e && e.detail && e.detail.value)
      this.pacingCfg = { enabled: v < PACING_FULL_SPEED, charsPerSec: v }
      savePacingConfig(this.pacingCfg)
    },

    /** 启用/关闭模型思考（P6.6）：默认关（省 token、降首字延迟） */
    onToggleThinking(e) {
      const on = !!(e && e.detail && e.detail.value)
      this.thinkingEnabled = on
      try {
        storage.set(scopedKey('ai_thinking_enabled'), on)
        uni.showToast({ title: on ? '已开启模型思考（更慢更贵）' : '已关闭模型思考', icon: 'none', duration: 2500 })
      } catch (err) {
        uni.showToast({ title: '保存失败', icon: 'none' })
      }
    },
    /** 保存文本思考解析配置（P6.4 / D21：只存一个开关，定界符由代码内置自动识别） */
    onSaveReasoningCfg() {
      const ok = saveReasoningConfig(this.reasoningCfg)
      uni.showToast({ title: ok ? '已保存' : '保存失败', icon: 'none' })
    },

    /** 读取存储用量与持久化状态（P5.4；仅 H5 有标准 API，其它端静默跳过） */
    async _loadStorageInfo() {
      try {
        const s = (typeof navigator !== 'undefined' && navigator.storage) || null
        if (s && typeof s.estimate === 'function') {
          const est = await s.estimate()
          this.storageUsage = { usage: est.usage || 0, quota: est.quota || 0 }
        }
        if (s && typeof s.persisted === 'function') {
          this.storagePersisted = !!(await s.persisted())
        }
      } catch (e) { /* 忽略：不支持的端就不显示 */ }
    },
    /**
     * 自动申请持久化存储（用户要求：这件事默认自动做，不再放按键）
     *
     * 只做一次静默申请：浏览器授予就更新状态，不授予（隐私模式 / 已拒绝）也不弹窗打扰，
     * 页面上的「持久化存储」一行会如实显示结果。
     */
    async _autoRequestPersist() {
      try {
        const s = (typeof navigator !== 'undefined' && navigator.storage) || null
        if (!s || typeof s.persist !== 'function') return
        if (typeof s.persisted === 'function' && await s.persisted()) {
          this.storagePersisted = true
          return
        }
        this.storagePersisted = !!(await s.persist())
      } catch (e) { /* 静默：申请失败不影响设置页任何功能 */ }
    },
    /** 导出备份（P5.4）：H5 直接下载 JSON；其它端复制到剪贴板 */
    async onExportBackup() {
      uni.showToast({ title: '正在整理数据…', icon: 'none', duration: 1200 })
      const ok = await exportBackup()
      if (ok) uni.showToast({ title: '已导出备份', icon: 'none' })
    },
    /** 导入备份（P5.4）：覆盖同名键，导入前二次确认 */
    async onImportBackup() {
      const text = await pickBackupFile()
      if (!text) return
      uni.showModal({
        title: '确认导入备份',
        content: '导入会覆盖同名的现有数据（对话/角色卡/预设等）。建议先导出当前数据。是否继续？',
        success: async (res) => {
          if (!res.confirm) return
          const r = await restoreBackup(text)
          uni.showToast({
            title: r.ok ? `已导入（对话 ${r.kvCount} 项 / 本地 ${r.lsCount} 项）` : (r.message || '导入失败'),
            icon: 'none',
            duration: 3000
          })
          if (r.ok) this._loadStorageInfo()
        }
      })
    },

    /** 保存并立即应用自定义 CSS（P4.3 / D2） */
    onSaveCustomCss() {
      const ok = saveCustomCss(this.customCss)
      uni.showToast({ title: ok ? '已应用' : '保存失败', icon: 'none' })
    },
    /** 清空用户自定义 CSS（系统默认样式仍会保留） */
    onResetCustomCss() {
      this.customCss = ''
      saveCustomCss('')
      uni.showToast({ title: '已恢复默认', icon: 'none' })
    },

    /** 读取内置测试通道的公开配置（无密钥，仅用于显示可用性与展示名） */
    async _loadTestApiInfo() {
      try {
        const cfg = await getTestApiConfig(true)
        this.testApiInfo = cfg
        this.testApis = Array.isArray(cfg.apis) ? cfg.apis : []
        this.selectedTestApiId = getSelectedTestApiId()
        this._healSelectedTestApi()
      } catch (e) {
        console.warn('[Settings] 读取内置测试通道配置失败:', e && e.message)
      }
    },

    /**
     * 选中的通道与服务端清单对不上时（换过部署、回滚版本、本地存了脏 id），
     * 自动落到第一条可用的通道并写盘 —— 否则用户的对话会一直打在一条不存在的通道上。
     */
    _healSelectedTestApi() {
      if (!this.testApis.length) return
      if (this.testApis.some(a => a.id === this.selectedTestApiId)) return
      const fallback = this.testApis.find(a => a.enabled) || this.testApis[0]
      if (!fallback) return
      this.selectedTestApiId = fallback.id
      this._patchLlmSettings({ testApiId: fallback.id })
    },

    /**
     * 只补写指定的几个字段，不动用户还没保存的表单内容
     * （apiKey/apiUrl/modelName 那些仍然遵循"点保存才生效"的原有约定）
     */
    _patchLlmSettings(patch) {
      try {
        const cur = storage.get(llmConfigKey()) || {}
        storage.set(llmConfigKey(), { ...cur, ...patch, updatedAt: Date.now() })
        return true
      } catch (e) {
        console.error('[Settings] 写入设置失败:', e)
        return false
      }
    },

    /**
     * 选中一条测试 API 通道 —— **立即生效，不需要点页面底部的"保存"**
     *
     * 只写 testApiId 一个字段：对话请求会带上它，服务端据此注入该通道的 Key/地址/模型。
     */
    onSelectTestApi(api) {
      if (!api) return
      if (!api.enabled) {
        uni.showToast({ title: `「${api.label}」服务端未配置，暂不可用`, icon: 'none', duration: 2500 })
        return
      }
      if (api.id === this.selectedTestApiId) return
      this.selectedTestApiId = api.id
      this._patchLlmSettings({ testApiId: api.id })
      const parts = [api.label, api.provider, api.model].filter(Boolean)
      uni.showToast({ title: `测试API已切换到「${parts.join(' · ')}」`, icon: 'none', duration: 2500 })
    },

    /**
     * 向服务端核验测试权限，并据此重建模型列表。
     *
     * 为什么需要：新注册账号默认 is_test=false，用户往往是在"等管理员开权限"的状态下
     * 打开设置页的。权限判定以服务端为权威（见 userManager.isTestAccountChecked），
     * 这样管理员一打开开关，用户重进设置页就能看到「测试 API（内置）」，不必重新登录。
     */
    async _refreshTestPermission() {
      const before = this.isTestAccount
      let after = before
      try {
        after = await userManager.isTestAccountChecked()
      } catch (e) {
        return // 服务端不可达：保留本地缓存值，不打断设置页
      }
      if (after === before) return
      this.isTestAccount = after
      this._initModelList()
      this.loadSettings()
    },

    _initModelList() {
      this.isTestAccount = userManager.isTestAccount()
      // 没有测试权限、也没选过模型时的回落项：所有端都回落到需要自配 Key 的 OpenAI GPT。
      // （小程序端原来的「默认模型」走的是内置云开发通道，该通道已失效，按要求一并删除。）
      this.fallbackModel = 'openai'
      // #ifdef MP-WEIXIN
      this.modelList = [
        { id: 'openai', name: 'OpenAI GPT', desc: 'GPT系列模型（需要API Key）' },
        { id: 'claude', name: 'Claude', desc: 'Anthropic的Claude系列（需要API Key）' },
        { id: 'custom', name: '自定义API', desc: '使用自己的API接口' }
      ]
      this.currentModel = this.fallbackModel
      // #endif
      // #ifndef MP-WEIXIN
      // 腾讯混元已按要求下线：它的接口按 OpenAI 兼容格式调用，与「OpenAI GPT / 自定义API」重复，
      // 留着只会让用户在四个几乎一样的选项里纠结。
      this.modelList = [
        { id: 'openai', name: 'OpenAI GPT', desc: 'GPT系列模型（需要API Key）' },
        { id: 'claude', name: 'Claude', desc: 'Anthropic的Claude系列（需要API Key）' },
        { id: 'custom', name: '自定义API', desc: '使用自己的API接口' }
      ]
      // 内置测试 API 仅测试账号可见（无需配置 Key）
      if (this.isTestAccount) {
        this.modelList.push({ id: 'test', name: '测试 API（内置）', desc: '使用内置 DeepSeek 测试接口，无需配置 Key' })
      }
      this.currentModel = this.isTestAccount ? 'test' : this.fallbackModel
      // #endif
    },

    /**
     * 把任意来源（本地存档 / 旧配置）的模型 id 归一到"当前列表里真实存在的一项"
     *
     * 需要它的原因：
     *   · 腾讯混元、小程序端「默认模型」两个选项都已下线，但老用户本地还存着
     *     model='hunyuan' / 'default'；原样使用的话模型列表里没有任何一项是选中态，
     *     用户会以为设置页坏了。
     *   · 'test' 只对测试账号且只在该端支持时才存在于列表里（小程序端没有内置测试通道）。
     */
    _normalizeModelId(id) {
      const has = (mid) => this.modelList.some(x => x.id === mid)
      let m = (id === 'hunyuan' || id === 'default') ? this.fallbackModel : id
      if (m === 'test' && !has('test')) m = this.fallbackModel
      if (!m || !has(m)) m = has('test') ? 'test' : this.fallbackModel
      return m
    },

    loadSettings() {
      try {
        // 测试通道选择与"模型选择"在同一份配置里：这里一并读回，保证界面显示的
        // 就是对话请求真正会用的那条通道。
        this.selectedTestApiId = getSelectedTestApiId()
        const settings = storage.get(llmConfigKey())
        if (settings) {
          this.currentModel = this._normalizeModelId(settings.model)
          this.apiKey = settings.apiKey || ''
          this.apiUrl = settings.apiUrl || ''
          this.modelName = settings.modelName || ''
        } else {
          this.currentModel = this._normalizeModelId('')
        }
      } catch (error) {
        console.error('加载设置失败:', error)
      }
    },

    onSelectModel(e) {
      const modelId = e.currentTarget.dataset.id
      if (modelId === 'test' && !this.isTestAccount) {
        uni.showToast({ title: '内置测试 API 需要管理员开通测试权限', icon: 'none' })
        return
      }
      this.currentModel = modelId
    },

    onApiKeyInput(e) {
      this.apiKey = e.detail.value
    },

    onApiUrlInput(e) {
      this.apiUrl = e.detail.value
    },

    onModelNameInput(e) {
      this.modelName = e.detail.value
    },

    toggleApiKeyVisibility() {
      this.showApiKey = !this.showApiKey
    },

    onSave() {
      const { currentModel, apiKey, apiUrl, modelName, isTestAccount } = this

      // 作者注独立持久化（不随模型校验失败而丢失）
      if (this._noteStore) {
        this._noteStore.update(this.noteConfig)
      }

      if (currentModel === 'test' && !isTestAccount) {
        uni.showToast({ title: '内置测试 API 需要管理员开通测试权限', icon: 'none' })
        return
      }

      // 测试模型走内置 Key，无需用户填 Key（其余选项一律需要自配 Key）
      if (currentModel !== 'test' && !apiKey) {
        uni.showToast({ title: '请输入API Key', icon: 'none' })
        return
      }

      try {
        const settings = {
          model: currentModel,
          apiKey,
          apiUrl,
          modelName,
          // ⚠️ 必须带上：测试通道的选择是"点选即生效"写进同一份配置的，
          // 保存时漏掉它会把用户刚选的通道又抹回默认值。
          testApiId: this.selectedTestApiId || DEFAULT_TEST_API_CHANNEL_ID,
          updatedAt: Date.now()
        }

        const success = storage.set(llmConfigKey(), settings)

        if (success) {
          uni.showToast({ title: '设置已保存', icon: 'success' })
          setTimeout(() => { uni.navigateBack() }, 1500)
        } else {
          throw new Error('存储失败')
        }
      } catch (error) {
        console.error('保存设置失败:', error)
        uni.showToast({ title: '保存失败', icon: 'error' })
      }
    },

    onReset() {
      uni.showModal({
        title: '确认重置',
        content: '将恢复为默认设置，是否继续？',
        success: (res) => {
          if (res.confirm) {
            try {
              storage.remove(llmConfigKey())
              this.currentModel = this._normalizeModelId('')
              this.apiKey = ''
              this.apiUrl = ''
              this.modelName = ''
              // 测试通道选择也回到默认通道（配置被整份清掉了）
              this.selectedTestApiId = DEFAULT_TEST_API_CHANNEL_ID
              this._healSelectedTestApi()
              uni.showToast({ title: '已重置为默认', icon: 'success' })
            } catch (error) {
              console.error('重置失败:', error)
            }
          }
        }
      })
    },

    onShareAppMessage() {
      return {
        title: '无限旅团 - 设置',
        path: '/pages/index/index'
      }
    },

    // ── 渲染开关（Sprint 6.8）──────────────────────────────────
    _initPluginStore() {
      try {
        this._pluginStore = usePluginStore()
        this._pluginStore.load()
        this.pluginRenderers = { ...this._pluginStore.renderers }
      } catch (e) { console.warn('[Settings] pluginStore 初始化失败:', e) }
    },

    onToggleRenderer(key, e) {
      if (!this._pluginStore) return
      this._pluginStore.toggle(key)
      this.pluginRenderers = { ...this._pluginStore.renderers }
    },

    // ── 作者注 ────────────────────────────────────────────────
    _initNoteStore() {
      try {
        this._noteStore = useNoteStore()
        this._noteStore.load()
        this.noteConfig = { ...this._noteStore.config }
      } catch (e) { console.warn('[Settings] noteStore 初始化失败:', e) }
    },

    onNotePromptInput(e) {
      this.noteConfig.promptText = e.detail.value
    },
    onNoteIntervalInput(e) {
      const n = parseInt(e.detail.value, 10)
      this.noteConfig.interval = isNaN(n) || n < 1 ? 1 : n
    },
    onNoteDepthInput(e) {
      const n = parseInt(e.detail.value, 10)
      this.noteConfig.depth = isNaN(n) || n < 0 ? 0 : n
    },
    onNotePosition(v) {
      this.noteConfig.position = v
    },
    onNoteRole(v) {
      this.noteConfig.role = v
    }
  }
}
</script>

<style scoped>
.container {
  min-height: 100vh;
  background: var(--bg-deep);
  display: flex;
  flex-direction: column;
}

.content {
  flex: 1;
  padding: 8rpx 32rpx 20rpx;
}

.section {
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 26rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
  overflow: hidden;
  box-sizing: border-box;
}

.section-title {
  font-family: var(--font-body);
  font-size: 26rpx;
  font-weight: 700;
  color: var(--fg);
  margin-bottom: 20rpx;
  display: block;
}

.info-section {
  background: color-mix(in oklch, var(--t-gold) 9%, var(--surface));
  border: 1rpx solid color-mix(in oklch, var(--t-gold) 28%, transparent);
}

.info-card {
  display: flex;
  align-items: flex-start;
  gap: 18rpx;
}

.info-icon-wrap {
  width: 44rpx; height: 44rpx; border-radius: 14rpx; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in oklch, var(--t-gold) 18%, transparent);
  color: var(--t-gold);
}
.info-icon-wrap svg { width: 24rpx; height: 24rpx; }

.info-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.info-title {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--t-gold);
}

.info-desc {
  font-size: 21rpx;
  color: var(--fg-soft);
  line-height: 1.55;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.model-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 22rpx 24rpx;
  background: var(--raised);
  border-radius: 20rpx;
  border: 1rpx solid var(--border);
  transition: border-color 0.2s ease, background 0.2s ease;
}

.model-item.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.model-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.model-name {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--fg);
  white-space: normal;
  word-break: break-word;
}

.model-desc {
  font-size: 20rpx;
  color: var(--faint);
  line-height: 1.4;
  white-space: normal;
  word-break: break-word;
}

.model-check {
  width: 36rpx; height: 36rpx; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--accent);
}
.model-check svg { width: 20rpx; height: 20rpx; }

.form-item {
  margin-bottom: 22rpx;
  position: relative;
}

.label {
  display: block;
  font-size: 23rpx;
  color: var(--fg-soft);
  margin-bottom: 12rpx;
}

.label.required::after {
  content: '*';
  color: var(--danger);
  margin-left: 6rpx;
}

.input {
  width: 100%;
  background: var(--surface-2);
  border: 1rpx solid var(--border);
  border-radius: 16rpx;
  padding: 22rpx;
  font-size: 24rpx;
  color: var(--fg);
  box-sizing: border-box;
}

.input-with-icon {
  padding-right: 68rpx;
}

.input::placeholder {
  color: var(--faint);
}

.toggle-password {
  position: absolute;
  right: 20rpx;
  bottom: 20rpx;
  width: 40rpx; height: 40rpx;
  display: flex; align-items: center; justify-content: center;
  color: var(--faint);
}
.toggle-password svg { width: 22rpx; height: 22rpx; }

.setting-item {
  margin-bottom: 32rpx;
}

.setting-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.setting-name {
  font-size: 24rpx;
  color: var(--fg-soft);
  font-weight: 500;
}

.setting-desc {
  font-size: 20rpx;
  color: var(--faint);
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.setting-value {
  font-family: var(--font-mono);
  font-size: 24rpx;
  font-weight: 700;
  color: var(--accent);
  min-width: 80rpx;
  text-align: center;
}

.slider {
  flex: 1;
}

.btn-test {
  width: 100%;
  height: 72rpx;
  background: color-mix(in oklch, var(--success) 14%, transparent);
  border: 1rpx solid var(--success);
  border-radius: 20rpx;
  color: var(--success);
  font-size: 24rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
}

.footer {
  display: flex;
  gap: 20rpx;
  padding: 20rpx 32rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  background: oklch(18% 0.013 70 / 0.92);
  border-top: 1rpx solid var(--border);
  flex-shrink: 0;
}

.btn-secondary,
.btn-primary {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 42rpx;
  font-size: 25rpx;
  font-weight: 700;
  border: none;
}

.btn-secondary {
  background: var(--surface);
  border: 1rpx solid var(--border);
  color: var(--fg-soft);
}

.btn-primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  color: #171104;
  box-shadow: 0 20rpx 44rpx -18rpx oklch(75% 0.14 80 / 0.6);
}

.section-subtitle {
  display: block;
  font-size: 19rpx;
  color: var(--faint);
  margin-bottom: 16rpx;
  margin-top: -8rpx;
}

.switch-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx;
  padding: 14rpx 0;
  border-bottom: 1rpx solid var(--border);
}
.switch-item:last-of-type { border-bottom: none; }

.empty-hint {
  padding: 20rpx 0;
  font-size: 22rpx;
  color: var(--faint);
  text-align: center;
}

.switch-label {
  font-size: 22rpx;
  color: var(--fg-soft);
}

/* 渲染开关（折叠区块）：标题行 + 每一项的两行说明 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.section-header .section-title { margin-bottom: 0; }
.collapse-arrow {
  font-size: 21rpx;
  color: var(--faint);
  flex-shrink: 0;
  padding-left: 16rpx;
}
.switch-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding-right: 16rpx;
}
.switch-desc {
  font-size: 18rpx;
  color: var(--faint);
  line-height: 1.45;
}

/* 测试 API 通道（选中"测试 API（内置）"后出现在模型列表下方）
   紧凑排版：内边距/间距都收窄，提供商与模型再小一号（用户要求），
   避免这块把「选择模型」区撑得太长。 */
.test-api-block {
  margin-top: 12rpx;
  padding-top: 12rpx;
  border-top: 1rpx dashed var(--border);
}
.test-api-title {
  display: block;
  font-size: 21rpx;
  font-weight: 700;
  color: var(--fg);
  margin-bottom: 4rpx;
}
.test-api-hint {
  display: block;
  font-size: 17rpx;
  color: var(--faint);
  line-height: 1.4;
  margin-bottom: 8rpx;
}
.test-api-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10rpx;
  padding: 11rpx 16rpx;
  margin-top: 8rpx;
  background: var(--raised);
  border: 1rpx solid var(--border);
  border-radius: 14rpx;
  transition: border-color 0.2s ease, background 0.2s ease;
}
.test-api-item.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.test-api-item.unavailable { opacity: 0.55; }
.test-api-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1rpx;
}
.test-api-head {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.test-api-name {
  font-size: 21rpx;
  font-weight: 700;
  color: var(--fg);
  line-height: 1.35;
}
.test-api-badge {
  font-size: 15rpx;
  padding: 1rpx 8rpx;
  border-radius: 6rpx;
  flex-shrink: 0;
  color: var(--faint);
  background: var(--surface-2);
  border: 1rpx solid var(--border);
}
/* 提供商 / 模型：比通道名再小一号，别抢主标题的视觉重心 */
.test-api-desc {
  font-size: 17rpx;
  color: var(--faint);
  line-height: 1.32;
  word-break: break-all;
}

/* 流式输出速度滑条 */
.pacing-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.pacing-value {
  font-family: var(--font-mono);
  font-size: 22rpx;
  font-weight: 700;
  color: var(--accent);
}
.pacing-slider { margin: 6rpx 0 0; }
.pacing-scale {
  display: flex;
  justify-content: space-between;
  margin-top: -6rpx;
}
.pacing-scale-text {
  font-family: var(--font-mono);
  font-size: 17rpx;
  color: var(--faint);
  letter-spacing: 0.04em;
}

.quick-preset-row {
  display: flex;
  gap: 14rpx;
  margin-top: 16rpx;
}

.quick-btn {
  flex: 1;
  height: 60rpx;
  line-height: 60rpx;
  font-size: 21rpx;
}

/* 数据与存储（P5.4） */
.storage-line {
  display: block;
  margin-top: 10rpx;
  font-family: var(--font-mono);
  font-size: 21rpx;
  color: var(--fg-soft);
}

/* 自定义 CSS 输入框（P4.3） */.css-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 160rpx;
  margin-top: 12rpx;
  padding: 14rpx 16rpx;
  background: var(--bg-deep);
  border: 1rpx solid var(--border);
  border-radius: 12rpx;
  font-family: var(--font-mono);
  font-size: 20rpx;
  line-height: 1.6;
  color: var(--fg-soft);
}

.avatar-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.avatar-preview {
  width: 96rpx;
  height: 96rpx;
  border-radius: 20rpx;
}

.avatar-placeholder {
  width: 96rpx;
  height: 96rpx;
  border-radius: 20rpx;
  background: linear-gradient(160deg, var(--accent), var(--accent-strong));
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-placeholder-text {
  font-family: var(--font-serif);
  font-size: 32rpx;
  color: #171104;
  font-weight: 900;
}

.avatar-pick-btn {
  padding: 12rpx 22rpx;
  background: var(--accent-soft);
  border-radius: 16rpx;
}

.avatar-pick-text {
  font-size: 21rpx;
  color: var(--accent);
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.chip {
  padding: 11rpx 20rpx;
  border-radius: 16rpx;
  background: var(--surface-2);
  border: 1rpx solid var(--border);
  font-size: 20rpx;
  color: var(--fg-soft);
}

.chip.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
}

.textarea {
  height: 150rpx;
  padding-top: 18rpx;
  line-height: 1.5;
  width: 100%;
}
</style>

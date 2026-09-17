<template>
  <view class="container">
    <NavBar title="模型设置" subtitle="配置 AI 模型参数" />

    <scroll-view class="content" scroll-y="true" :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <!-- 使用说明 -->
      <view class="section info-section">
        <view class="info-card">
          <view class="info-icon-wrap">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.2"/><path d="M10 13.4V9.6M10 6.8h.01"/></svg>
          </view>
          <view class="info-text">
            <text class="info-title">使用说明</text>
            <!-- #ifdef MP-WEIXIN -->
            <text class="info-desc">如果不配置API，将使用小程序内置的腾讯混元模型。配置后将优先使用您的API进行内容生成。</text>
            <!-- #endif -->
            <!-- #ifndef MP-WEIXIN -->
            <text class="info-desc">测试账号（含 admin）可直接使用内置测试 API；其他账号请填写 API Key（支持 DeepSeek 等 OpenAI 兼容接口）再开始对话。</text>
            <!-- #endif -->
          </view>
        </view>
      </view>

      <!-- 模型选择 -->
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
      </view>

      <!-- API配置 -->
      <view class="section" v-if="currentModel !== 'default' && currentModel !== 'test'" >
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

        <view class="form-item" v-if="currentModel === 'openai' || currentModel === 'custom' || currentModel === 'hunyuan'">
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

      <!-- 说明：生成参数（temperature/top_p/惩罚项等）不再在此配置，统一改为在"预设编辑"页里调整，
           避免出现两个地方都能改生成参数、互相打架、又没有一个是实际生效的来源这种情况。
           这里只负责"用什么模型 / 用什么接口地址 / 用什么 Key"这类连接层配置。 -->
      <view class="section" v-if="currentModel === 'test'">
        <text class="section-subtitle" v-if="testApiInfo.enabled">已使用内置测试接口（{{ testApiInfo.label }}）：模型与 Key 由服务端统一配置，无需填写</text>
        <text class="section-subtitle" v-else>内置测试接口当前不可用，请选择其他模型并填写自己的 API Key</text>
      </view>

      <!-- 渲染开关 -->
      <view class="section">
        <text class="section-title">渲染开关</text>
        <text class="section-subtitle">控制 AI 回复中特殊标签是否渲染为交互组件</text>
        <view class="switch-item" v-for="item in rendererSwitches" :key="item.key">
          <text class="switch-label">{{ item.label }}</text>
          <switch :checked="pluginRenderers[item.key]" @change="onToggleRenderer(item.key, $event)" color="#c9a84a" :disabled="item.key === 'html' && isMpWeixin" />
        </view>
      </view>

      <!-- 上下文详情（P3.4 / D14）：入口藏在这里，不占用聊天主界面 -->
      <view class="section">
        <text class="section-title">上下文详情</text>
        <text class="section-subtitle">查看最近几次请求实际发送了什么、各段占多少 token、有没有省略历史</text>
        <button class="btn-secondary" @tap="showContextInspector = true">打开上下文详情</button>
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

      <!-- 流式输出（本轮新增）：控制"逐字释放"的节奏 -->
      <view class="section">
        <text class="section-title">流式输出</text>
        <text class="section-subtitle">开启平滑输出后，即使模型是真流式，界面也会按下面的速度逐字显示；关掉则完全跟上游速度（高速模型会一屏字瞬间涌出）</text>
        <view class="switch-item">
          <text class="switch-label">平滑输出（限制显示速度）</text>
          <switch :checked="pacingCfg.enabled" @change="onTogglePacing" color="#c9a84a" />
        </view>
        <view class="form-item">
          <text class="label">显示速度（字/秒）</text>
          <input class="input" type="number" :value="String(pacingCfg.charsPerSec)" @input="onPacingRateInput" />
        </view>
        <view class="quick-preset-row">
          <button class="btn-secondary quick-btn" @tap="onPacingPreset(40)">慢 40</button>
          <button class="btn-secondary quick-btn" @tap="onPacingPreset(80)">中 80</button>
          <button class="btn-secondary quick-btn" @tap="onPacingPreset(160)">快 160</button>
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

      <!-- 数据与存储（P5.4 / D8）：对话存档已改用 IndexedDB，这里看用量与做备份 -->
      <view class="section">
        <text class="section-title">数据与存储</text>
        <text class="section-subtitle">对话存档已改用 IndexedDB（容量更大、写入不阻塞界面）；本地数据可能被浏览器清理，建议定期导出备份</text>
        <text class="storage-line">已用空间：{{ storageUsageText }}</text>
        <text class="storage-line">持久化存储：{{ storagePersisted ? '已启用' : '未启用' }}</text>
        <view class="quick-preset-row">
          <button class="btn-secondary quick-btn" @tap="onRequestPersist">申请持久化</button>
          <button class="btn-primary quick-btn" @tap="onExportBackup">导出备份</button>
        </view>
        <view class="quick-preset-row">
          <button class="btn-secondary quick-btn" @tap="onImportBackup">导入备份</button>
        </view>
      </view>

      <!-- 功能模块开关 -->
      <view class="section">
        <text class="section-title">功能模块</text>
        <text class="section-subtitle">开启后在对话页显示对应的 TRPG 游戏机制面板</text>
        <view class="switch-item" v-for="item in moduleSwitches" :key="item.key">
          <text class="switch-label">{{ item.label }}</text>
          <switch :checked="moduleFlags[item.key]" @change="onToggleModule(item.key, $event)" color="#c9a84a" />
        </view>
        <view class="quick-preset-row">
          <button class="btn-secondary quick-btn" @tap="onApplyModulePreset('chat')">自由聊天模式</button>
          <button class="btn-secondary quick-btn" @tap="onApplyModulePreset('trpg')">TRPG 模式</button>
        </view>
      </view>

      <!-- 作者注（Author's Note） -->
      <view class="section">
        <text class="section-title">作者注</text>
        <text class="section-subtitle">定时注入的全局提示，用于强调设定 / 风格 / 状态（对齐酒馆 Author's Note）</text>
        <view class="form-item">
          <text class="label">作者注内容</text>
          <textarea class="input textarea" placeholder="例如：{{char}} 正保持谨慎，注意周围环境…" :value="noteConfig.prompt" @input="onNotePromptInput" maxlength="2000" />
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
      <!-- 全局正则（正侧）：对齐酒馆 GLOBAL 类型正则脚本来源，跨角色/跨预设一直生效 -->
      <view class="section">
        <text class="section-title">全局正则（正侧）</text>
        <text class="section-subtitle">勾选"全局"的正侧文件会跨角色/跨预设一直生效，和角色卡自带、预设自带的正则合并执行，互不覆盖</text>
        <view v-if="regexPresets.length === 0" class="empty-hint">
          <text>暂无已导入的正侧文件，请到"酒馆导入"页导入</text>
        </view>
        <view class="switch-item" v-for="rp in regexPresets" :key="rp.id">
          <text class="switch-label">{{ rp.fileName || rp.name }}（{{ rp.scripts.length }} 条）</text>
          <switch :checked="!!rp.enabledGlobal" @change="onToggleGlobalRegex(rp.id, $event)" color="#c9a84a" />
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
import { useModuleStore } from '../../stores/moduleStore'
import { useCharacterCardStore } from '../../stores/characterCardStore'
import { useNoteStore } from '../../stores/noteStore'
import { useRegexPresetStore } from '../../stores/regexPresetStore'
import { getNavBarHeight } from '../../utils/navbar.js'
import { getTestApiConfig } from '../../utils/llm/client.js'
import NavBar from '../../components/common/NavBar.vue'
import ContextInspector from '../../components/render/ContextInspector.vue'
import { loadCustomCss, saveCustomCss, initCustomCss } from '../../utils/customCss'
import { exportBackup, pickBackupFile, restoreBackup } from '../../services/backupService'
import { loadReasoningConfig, saveReasoningConfig, REASONING_DELIMITERS } from '../../engine/ReasoningHandler'
import { loadPacingConfig, savePacingConfig } from '../../utils/streamPacing'

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
    }
  },
  data() {
    return {
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
      // 流式输出节奏（本轮新增）
      pacingCfg: { enabled: true, charsPerSec: 80 },
      modelList: [],
      currentModel: '',
      apiKey: '',
      apiUrl: '',
      modelName: '',
      showApiKey: false,
      isTestAccount: false,
      // 渲染开关
      pluginRenderers: { branch: true, summary: true, time: true, html: false, music: false },
      rendererSwitches: [
        { key: 'branch', label: '选项按钮（branches）' },
        { key: 'summary', label: '摘要卡片（meow_FM）' },
        { key: 'time', label: '时间卡片（time_format）' },
        { key: 'html', label: '自定义 HTML（仅 H5）' },
        { key: 'music', label: '音乐播放器' }
      ],
      // 模块开关（字段与 TrpgModules 对齐，默认全关）
      moduleFlags: { intentDetection: false, combat: false, inventory: false, characterStatus: false, dicePanel: false, stats: false, adventure: false },
      moduleSwitches: [
        { key: 'intentDetection', label: '意图识别' },
        { key: 'combat', label: '战斗面板' },
        { key: 'inventory', label: '背包系统' },
        { key: 'characterStatus', label: '角色属性面板' },
        { key: 'dicePanel', label: '骰子快捷栏' },
        { key: 'stats', label: '数值系统' },
        { key: 'adventure', label: '任务/剧情' }
      ],
      // 作者注
      noteConfig: { prompt: '', interval: 1, depth: 4, position: 1, role: 'system' },
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
      // 这样官方调整模型名时只需改服务端变量，前端无需改代码/重新发版
      testApiInfo: { enabled: false, label: '' },
      // 全局正则（正侧）
      regexPresets: []
    }
  },

  onLoad() {
    // 需要登录：未登录会被 reLaunch 到登录页（守卫实现在 App.vue 的 checkUserLogin）
    if (!getApp().checkUserLogin()) return
    this.navBarHeight = getNavBarHeight().navBarHeight
    this._initModelList()
    this.loadSettings()
    this._loadTestApiInfo()
    this._initPluginAndModuleStores()
    this._initNoteStore()
    this._initRegexPresetStore()
    // 自定义 CSS（P4.3 / D2）：载入用户样式并确保默认样式已注入
    this.customCss = loadCustomCss()
    initCustomCss()
    // 数据与存储信息（P5.4）
    this._loadStorageInfo()
    // 思考内容（P6.6 / P6.4）
    this.thinkingEnabled = storage.get(scopedKey('ai_thinking_enabled')) === true
    this.reasoningCfg = loadReasoningConfig()
    // 流式输出节奏（本轮新增）
    this.pacingCfg = loadPacingConfig()
    // #ifdef MP-WEIXIN
    this.isMpWeixin = true
    // #endif
  },

  methods: {
    /** 平滑输出开关（本轮新增）：真流式下也按速率逐字释放，避免"疯狂涌出" */
    onTogglePacing(e) {
      const on = !!(e && e.detail && e.detail.value)
      this.pacingCfg = { ...this.pacingCfg, enabled: on }
      savePacingConfig(this.pacingCfg)
      uni.showToast({ title: on ? '已开启平滑输出' : '已关闭（完全跟上游速度）', icon: 'none', duration: 2500 })
    },
    onPacingRateInput(e) {
      const v = Number(e && e.detail && e.detail.value)
      this.pacingCfg = { ...this.pacingCfg, charsPerSec: Number.isFinite(v) && v > 0 ? v : 80 }
      savePacingConfig(this.pacingCfg)
    },
    onPacingPreset(rate) {
      this.pacingCfg = { enabled: true, charsPerSec: rate }
      savePacingConfig(this.pacingCfg)
      uni.showToast({ title: `已设为 ${rate} 字/秒`, icon: 'none' })
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
    /** 申请持久化存储：避免浏览器在磁盘紧张时清理用户数据 */
    async onRequestPersist() {
      try {
        const s = (typeof navigator !== 'undefined' && navigator.storage) || null
        if (!s || typeof s.persist !== 'function') {
          uni.showToast({ title: '当前环境不支持该能力', icon: 'none' })
          return
        }
        const ok = await s.persist()
        this.storagePersisted = !!ok
        uni.showToast({ title: ok ? '已启用持久化存储' : '浏览器未授予（可能已在隐私模式）', icon: 'none', duration: 3000 })
      } catch (e) {
        uni.showToast({ title: '申请失败', icon: 'none' })
      }
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
        this.testApiInfo = await getTestApiConfig()
      } catch (e) {
        console.warn('[Settings] 读取内置测试通道配置失败:', e && e.message)
      }
    },

    _initModelList() {
      this.isTestAccount = userManager.isTestAccount()
      // #ifdef MP-WEIXIN
      this.modelList = [
        { id: 'default', name: '默认模型', desc: '使用小程序内置的腾讯混元模型' },
        { id: 'hunyuan', name: '腾讯混元', desc: '腾讯自研的大语言模型（需要API Key）' },
        { id: 'openai', name: 'OpenAI GPT', desc: 'GPT系列模型（需要API Key）' },
        { id: 'claude', name: 'Claude', desc: 'Anthropic的Claude系列（需要API Key）' },
        { id: 'custom', name: '自定义API', desc: '使用自己的API接口' }
      ]
      this.currentModel = 'default'
      // #endif
      // #ifndef MP-WEIXIN
      this.modelList = [
        { id: 'hunyuan', name: '腾讯混元', desc: '腾讯自研的大语言模型（需要API Key）' },
        { id: 'openai', name: 'OpenAI GPT', desc: 'GPT系列模型（需要API Key）' },
        { id: 'claude', name: 'Claude', desc: 'Anthropic的Claude系列（需要API Key）' },
        { id: 'custom', name: '自定义API', desc: '使用自己的API接口' }
      ]
      // 内置测试 API 仅测试账号可见（无需配置 Key）
      if (this.isTestAccount) {
        this.modelList.push({ id: 'test', name: '测试 API（内置）', desc: '使用内置 DeepSeek 测试接口，无需配置 Key' })
      }
      this.currentModel = this.isTestAccount ? 'test' : 'hunyuan'
      // #endif
    },

    loadSettings() {
      try {
        const settings = storage.get(llmConfigKey())
        if (settings) {
          // #ifdef MP-WEIXIN
          // 小程序端不支持内置测试 API（没有 /api 代理，Key 也无法放在服务端），
          // 若本地残留 model='test' 则回落到默认模型，避免对话页一直报「不支持」
          this.currentModel = (settings.model && settings.model !== 'test') ? settings.model : 'default'
          // #endif
          // #ifndef MP-WEIXIN
          this.currentModel = settings.model || (this.isTestAccount ? 'test' : 'hunyuan')
          // #endif
          this.apiKey = settings.apiKey || ''
          this.apiUrl = settings.apiUrl || ''
          this.modelName = settings.modelName || ''
        }
      } catch (error) {
        console.error('加载设置失败:', error)
      }
    },

    onSelectModel(e) {
      const modelId = e.currentTarget.dataset.id
      if (modelId === 'test' && !this.isTestAccount) {
        uni.showToast({ title: '内置测试 API 仅测试账号可用', icon: 'none' })
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
        uni.showToast({ title: '内置测试 API 仅测试账号可用', icon: 'none' })
        return
      }

      // 测试模型走内置 Key，无需用户填 Key
      if (currentModel !== 'default' && currentModel !== 'test' && !apiKey) {
        uni.showToast({ title: '请输入API Key', icon: 'none' })
        return
      }

      try {
        const settings = {
          model: currentModel,
          apiKey,
          apiUrl,
          modelName,
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
              // #ifdef MP-WEIXIN
              this.currentModel = 'default'
              // #endif
              // #ifndef MP-WEIXIN
              this.currentModel = this.isTestAccount ? 'test' : 'hunyuan'
              // #endif
              this.apiKey = ''
              this.apiUrl = ''
              this.modelName = ''
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
        title: '无限旅团 - 模型设置',
        path: '/pages/index/index'
      }
    },

    // ── 渲染开关 / 功能模块开关（Sprint 6.8） ──────────────────
    _initPluginAndModuleStores() {
      try {
        this._pluginStore = usePluginStore()
        this._pluginStore.load()
        this.pluginRenderers = { ...this._pluginStore.renderers }
      } catch (e) { console.warn('[Settings] pluginStore 初始化失败:', e) }

      try {
        // 先加载角色卡库，使 moduleStore（卡片投影）有"当前卡"可读写
        useCharacterCardStore().loadAll()
        this._moduleStore = useModuleStore()
        this._moduleStore.load()
        this.moduleFlags = { ...this._moduleStore.modules }
      } catch (e) { console.warn('[Settings] moduleStore 初始化失败:', e) }
    },

    onToggleRenderer(key, e) {
      if (!this._pluginStore) return
      this._pluginStore.toggle(key)
      this.pluginRenderers = { ...this._pluginStore.renderers }
    },

    onToggleModule(key, e) {
      if (!this._moduleStore) return
      this._moduleStore.toggle(key)
      this.moduleFlags = { ...this._moduleStore.modules }
    },

    onApplyModulePreset(profile) {
      if (!this._moduleStore) return
      this._moduleStore.applyPreset(profile)
      this.moduleFlags = { ...this._moduleStore.modules }
      uni.showToast({ title: profile === 'trpg' ? '已切换为 TRPG 模式' : '已切换为自由聊天模式', icon: 'none' })
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
      this.noteConfig.prompt = e.detail.value
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
    },

    // ── 全局正则（正侧）：对齐酒馆 GLOBAL 类型来源 ─────────────────
    _initRegexPresetStore() {
      try {
        this._regexPresetStore = useRegexPresetStore()
        this._regexPresetStore.load()
        this.regexPresets = [...this._regexPresetStore.presets]
      } catch (e) { console.warn('[Settings] regexPresetStore 初始化失败:', e) }
    },

    onToggleGlobalRegex(id, e) {
      if (!this._regexPresetStore) return
      const enabled = !!e.detail.value
      this._regexPresetStore.toggleGlobal(id, enabled)
      this.regexPresets = [...this._regexPresetStore.presets]
      uni.showToast({ title: enabled ? '已设为全局正则' : '已取消全局正则', icon: 'none' })
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

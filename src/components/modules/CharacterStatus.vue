<template>
  <view class="status-modal" v-if="visible" @tap="handleClose">
    <view class="status-content" @tap.stop="() => {}">
      <view class="status-header">
        <text class="status-title">📋 角色状态</text>
        <text class="status-close" @tap="handleClose">✕</text>
      </view>
      <scroll-view class="status-body" scroll-y>
        <view class="status-inner">
          <view class="status-section">
            <view class="status-section-title">核心属性</view>
            <view class="combatant-block">
              <view class="combatant-meta">
                <text class="combatant-name">❤️ HP</text>
                <text class="combatant-stat">{{ charStatus.hp }} / {{ charStatus.maxHp }}</text>
              </view>
              <view class="hp-bar-wrap">
                <view class="hp-bar-fill enemy-hp" :style="'width:' + (charStatus.maxHp > 0 ? (charStatus.hp / charStatus.maxHp * 100) : 0) + '%'"></view>
              </view>
            </view>
            <view class="combatant-block">
              <view class="combatant-meta">
                <text class="combatant-name">💙 MP</text>
                <text class="combatant-stat">{{ charStatus.mp }} / {{ charStatus.maxMp }}</text>
              </view>
              <view class="hp-bar-wrap">
                <view class="hp-bar-fill mp-bar" :style="'width:' + (charStatus.maxMp > 0 ? (charStatus.mp / charStatus.maxMp * 100) : 0) + '%'"></view>
              </view>
            </view>
            <view class="combatant-block">
              <view class="combatant-meta">
                <text class="combatant-name">🧠 SAN</text>
                <text class="combatant-stat">{{ charStatus.san }} / {{ charStatus.maxSan }}</text>
              </view>
              <view class="hp-bar-wrap">
                <view class="hp-bar-fill san-bar" :style="'width:' + (charStatus.maxSan > 0 ? (charStatus.san / charStatus.maxSan * 100) : 0) + '%'"></view>
              </view>
            </view>
          </view>
          <view class="status-section">
            <view class="status-section-title">六维属性</view>
            <view class="attr-grid">
              <view class="attr-cell" v-for="a in attrDisplayList" :key="a.key">
                <text class="attr-name">{{ a.label }}</text>
                <text class="attr-value">{{ charStatus[a.key] }}</text>
                <text class="attr-mod">{{ charStatus[a.modKey] }}</text>
              </view>
            </view>
          </view>
          <view class="status-section">
            <view class="status-section-title">装备</view>
            <view class="equip-grid">
              <view class="equip-slot" v-for="slot in equipSlots" :key="slot.key">
                <text class="equip-slot-icon">{{ slot.icon }}</text>
                <view class="equip-slot-content">
                  <text class="equip-slot-label">{{ slot.label }}</text>
                  <text :class="['equip-slot-item', charStatus.equipment[slot.key] ? '' : 'equip-empty']">{{ charStatus.equipment[slot.key] || '—— 空 ——' }}</text>
                </view>
              </view>
            </view>
          </view>
          <view class="status-section">
            <view class="status-section-title">当前状态</view>
            <view v-if="charStatus.statusEffects && charStatus.statusEffects.length > 0" class="status-effects-list">
              <view v-for="effect in charStatus.statusEffects" :key="effect.name" :class="['status-effect-tag', effect.type === 'buff' ? 'effect-buff' : (effect.type === 'debuff' ? 'effect-debuff' : 'effect-neutral')]">
                <text class="effect-icon">{{ effect.icon || '✦' }}</text>
                <view class="effect-info">
                  <text class="effect-name">{{ effect.name }}</text>
                  <text class="effect-desc" v-if="effect.desc">{{ effect.desc }}</text>
                </view>
              </view>
            </view>
            <view v-else class="status-effects-empty">
              <text class="status-effects-empty-text">✅ 状态正常，无异常效果</text>
            </view>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup lang="ts">
interface EquipmentMap {
  head: string
  body: string
  feet: string
  mainWeapon: string
  offHand: string
  accessory1: string
  accessory2: string
  accessory3: string
}

interface StatusEffect {
  name: string
  desc?: string
  icon?: string
  type?: 'buff' | 'debuff' | 'neutral'
}

interface CharStatus {
  hp: number; maxHp: number
  mp: number; maxMp: number
  san: number; maxSan: number
  str: number; strMod: string
  dex: number; dexMod: string
  con: number; conMod: string
  int: number; intMod: string
  wis: number; wisMod: string
  cha: number; chaMod: string
  equipment: EquipmentMap
  statusEffects: StatusEffect[]
  [key: string]: any
}

defineProps<{
  visible: boolean
  charStatus: CharStatus
}>()

const emit = defineEmits<{
  close: []
}>()

function handleClose() {
  emit('close')
}

const attrDisplayList = [
  { key: 'str', modKey: 'strMod', label: '力量' },
  { key: 'dex', modKey: 'dexMod', label: '敏捷' },
  { key: 'con', modKey: 'conMod', label: '体质' },
  { key: 'int', modKey: 'intMod', label: '智力' },
  { key: 'wis', modKey: 'wisMod', label: '感知' },
  { key: 'cha', modKey: 'chaMod', label: '魅力' }
]

const equipSlots = [
  { key: 'mainWeapon', icon: '⚔️', label: '主武器' },
  { key: 'offHand', icon: '🗡️', label: '副手' },
  { key: 'head', icon: '🪖', label: '头部' },
  { key: 'body', icon: '🥋', label: '身体' },
  { key: 'feet', icon: '👟', label: '脚部' },
  { key: 'accessory1', icon: '💍', label: '饰品1' },
  { key: 'accessory2', icon: '📿', label: '饰品2' },
  { key: 'accessory3', icon: '🔮', label: '饰品3' }
]
</script>

<style scoped>
.status-modal { position:fixed; top:0;left:0;right:0;bottom:0; background:oklch(10% 0.01 70 / 0.7); display:flex; align-items:flex-end; z-index:1000; }
.status-content { width:100%; max-height:80vh; background:var(--bg-deep); border: 1rpx solid var(--border); border-radius:32rpx 32rpx 0 0; display:flex; flex-direction:column; }
.status-header { display:flex; justify-content:space-between; align-items:center; padding:28rpx 32rpx; border-bottom:1rpx solid var(--border); }
.status-title { font-family: var(--font-serif); font-size:25rpx; font-weight:900; color:var(--fg); }
.status-close { font-size:36rpx; color:var(--faint); line-height: 1; }
.status-body { flex:1; }
.status-inner { padding:24rpx; }
.status-section { margin-bottom:30rpx; }
.status-section-title { font-family: var(--font-body); font-size:22rpx; font-weight:700; color:var(--accent); margin-bottom:16rpx; }
.combatant-block { margin-bottom:16rpx; }
.combatant-meta { display:flex; justify-content:space-between; margin-bottom:8rpx; }
.combatant-name { font-size:22rpx; color:var(--fg); font-weight:700; }
.combatant-stat { font-family: var(--font-mono); font-size:20rpx; color:var(--faint); }
.hp-bar-wrap { height:12rpx; background:var(--surface-2); border-radius:6rpx; overflow:hidden; }
.hp-bar-fill { height:100%; border-radius:6rpx; transition:width 0.3s; }
.enemy-hp { background:linear-gradient(90deg, oklch(68% 0.17 26), oklch(56% 0.18 24)); }
.mp-bar { background:linear-gradient(90deg, var(--info), oklch(60% 0.11 235)); }
.san-bar { background:linear-gradient(90deg, var(--t-violet), oklch(58% 0.12 295)); }
.attr-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14rpx; }
.attr-cell { background:var(--surface); border: 1rpx solid var(--border); border-radius:14rpx; padding:16rpx; text-align:center; }
.attr-name { display:block; font-size:19rpx; color:var(--faint); margin-bottom:6rpx; }
.attr-value { display:block; font-family: var(--font-mono); font-size:26rpx; font-weight:700; color:var(--fg); }
.attr-mod { display:block; font-family: var(--font-mono); font-size:18rpx; color:var(--accent); }
.equip-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; }
.equip-slot { display:flex; align-items:center; gap:12rpx; padding:14rpx; background:var(--surface); border: 1rpx solid var(--border); border-radius:14rpx; }
.equip-slot-icon { font-size:30rpx; flex-shrink:0; }
.equip-slot-content { flex:1; min-width: 0; }
.equip-slot-label { display:block; font-size:18rpx; color:var(--faint); margin-bottom:4rpx; }
.equip-slot-item { display:block; font-size:21rpx; color:var(--fg-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.equip-empty { color:var(--faint); opacity: .6; }
.status-effects-list { display:flex; flex-direction:column; gap:10rpx; }
.status-effect-tag { display:flex; align-items:center; gap:12rpx; padding:14rpx; border-radius:14rpx; }
.effect-buff { background: color-mix(in oklch, var(--success) 14%, transparent); border:1rpx solid color-mix(in oklch, var(--success) 35%, transparent); }
.effect-debuff { background: color-mix(in oklch, var(--danger) 14%, transparent); border:1rpx solid color-mix(in oklch, var(--danger) 35%, transparent); }
.effect-neutral { background: var(--accent-soft); border:1rpx solid color-mix(in oklch, var(--accent) 35%, transparent); }
.effect-icon { font-size:26rpx; flex-shrink:0; }
.effect-info { flex:1; min-width: 0; }
.effect-name { display:block; font-size:21rpx; color:var(--fg); font-weight:700; }
.effect-desc { display:block; font-size:19rpx; color:var(--faint); margin-top:4rpx; }
.status-effects-empty { padding:24rpx; text-align:center; }
.status-effects-empty-text { font-size:21rpx; color:var(--success); }
</style>
<template>
  <view class="inventory-modal" v-if="visible" @tap="handleClose">
    <view class="inventory-content" @tap.stop="() => {}">
      <view class="inventory-header">
        <text class="inventory-title">背包</text>
        <text class="inventory-close" @tap="handleClose">✕</text>
      </view>
      <scroll-view class="inventory-body" scroll-y>
        <view class="inventory-section" v-if="legendaryItems.length > 0">
          <view class="section-title">✨ 传奇物品</view>
          <view class="item-list">
            <view class="inventory-item legendary" v-for="item in legendaryItems" :key="item.id">
              <view class="item-icon">{{ item.icon || '📦' }}</view>
              <view class="item-info">
                <view :class="['item-name', item.rarityClass]">{{ item.name }}<text v-if="item.equipped" class="equipped-tag"> [已装备]</text></view>
                <view class="item-desc">{{ item.description }}</view>
                <view class="item-effect">{{ item.effect }}</view>
              </view>
              <view class="item-actions">
                <button v-if="item.equipable && !item.equipped" class="action-btn equip-btn" @tap="handleEquip(item)">装备</button>
                <button v-if="item.equipable && item.equipped" class="action-btn equip-btn equip-btn-active" @tap="handleUnequip(item)">卸下</button>
                <button v-if="item.usable && !item.equipable" class="action-btn use-btn" @tap="handleUse(item)">使用</button>
              </view>
            </view>
          </view>
        </view>
        <view class="inventory-section" v-if="inventoryItems.length > 0">
          <view class="section-title">📦 物品</view>
          <view class="item-list">
            <view class="inventory-item" v-for="item in inventoryItems" :key="item.id">
              <view class="item-icon">{{ item.icon || '📦' }}</view>
              <view class="item-info">
                <view :class="['item-name', item.rarityClass]">{{ item.name }} ×{{ item.quantity }}</view>
                <view class="item-desc">{{ item.description }}</view>
                <view class="item-effect" v-if="item.effect">{{ item.effect }}</view>
              </view>
              <view class="item-actions" v-if="item.usable">
                <button class="action-btn use-btn" @tap="handleUse(item)">使用</button>
              </view>
            </view>
          </view>
        </view>
        <view class="inventory-empty" v-if="inventoryItems.length === 0 && legendaryItems.length === 0">
          <text>背包空空如也</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup lang="ts">
interface InventoryItem {
  id: string
  name: string
  icon?: string
  description?: string
  effect?: string
  quantity?: number
  rarityClass?: string
  equipable?: boolean
  equipped?: boolean
  equipSlot?: string
  usable?: boolean
}

defineProps<{
  visible: boolean
  legendaryItems: InventoryItem[]
  inventoryItems: InventoryItem[]
}>()

const emit = defineEmits<{
  close: []
  use: [item: InventoryItem]
  equip: [item: InventoryItem]
  unequip: [item: InventoryItem]
}>()

function handleClose() { emit('close') }
function handleUse(item: InventoryItem) { emit('use', item) }
function handleEquip(item: InventoryItem) { emit('equip', item) }
function handleUnequip(item: InventoryItem) { emit('unequip', item) }
</script>

<style scoped>
.inventory-modal { position: fixed; top:0;left:0;right:0;bottom:0; background:oklch(10% 0.01 70 / 0.7); display:flex; align-items:flex-end; z-index:1000; }
.inventory-content { width:100%; max-height:70vh; background:var(--bg-deep); border: 1rpx solid var(--border); border-radius:32rpx 32rpx 0 0; display:flex; flex-direction:column; }
.inventory-header { display:flex; justify-content:space-between; align-items:center; padding:28rpx 32rpx; border-bottom:1rpx solid var(--border); }
.inventory-title { font-family: var(--font-serif); font-size:25rpx; font-weight:900; color:var(--fg); }
.inventory-close { font-size:36rpx; color:var(--faint); line-height: 1; }
.inventory-body { flex:1; padding:24rpx; }
.inventory-section { margin-bottom:30rpx; }
.section-title { font-family: var(--font-body); font-size:22rpx; font-weight:700; color:var(--t-gold); margin-bottom:16rpx; }
.item-list { display:flex; flex-direction:column; gap:14rpx; }
.inventory-item { display:flex; align-items:center; gap:14rpx; padding:18rpx; background:var(--surface); border: 1rpx solid var(--border); border-radius:18rpx; }
.inventory-item.legendary { border:1rpx solid color-mix(in oklch, var(--t-gold) 45%, transparent); background: color-mix(in oklch, var(--t-gold) 8%, var(--surface)); }
.item-icon { font-size:48rpx; flex-shrink:0; }
.item-info { flex:1; min-width: 0; }
.item-name { font-size:23rpx; color:var(--fg); font-weight:700; margin-bottom:6rpx; }
.item-desc { font-size:20rpx; color:var(--faint); margin-bottom:4rpx; line-height: 1.4; }
.item-effect { font-size:20rpx; color:var(--accent); }
.equipped-tag { color:var(--success); font-size:19rpx; }
.item-actions { flex-shrink: 0; }
.action-btn { padding:10rpx 20rpx; border-radius:14rpx; font-size:20rpx; border:none; }
.equip-btn { background: var(--accent-soft); color:var(--accent); }
.equip-btn-active { background: color-mix(in oklch, var(--danger) 18%, transparent); color:var(--danger); }
.use-btn { background: color-mix(in oklch, var(--success) 18%, transparent); color:var(--success); }
.inventory-empty { padding:40rpx; text-align:center; color:var(--faint); font-size:23rpx; }
</style>
<template>
  <view>
    <!-- 命运骰面板 -->
    <view class="fate-panel" v-if="fateRollVisible">
      <view class="fate-overlay"></view>
      <view class="fate-card">
        <text class="fate-title">☠ 你已倒下</text>
        <text class="fate-desc">命运的齿轮转动，掷骰决定你的生死</text>
        <text class="fate-rule">结果 ≥ 11 → 生还　　结果 ≤ 10 → 死亡</text>
        <view class="fate-dice-btn" @tap="handleFateDice">
          <text class="fate-dice-icon">🎲</text>
          <text class="fate-dice-text">掷命运骰</text>
        </view>
      </view>
    </view>

    <!-- 骰子动画浮层 -->
    <view class="dice-animation" v-if="diceAnimVisible">
      <view class="dice-overlay"></view>
      <view class="dice-card">
        <view v-if="diceResult === null" class="dice-spinning-wrap">
          <image src="/static/images/icons/dice.png" class="dice-spin" mode="aspectFit" />
          <text class="dice-spin-emoji">🎲</text>
        </view>
        <view v-else class="dice-result-wrap">
          <text class="dice-result-number">{{ diceResult }}</text>
        </view>
        <text class="dice-caption">{{ diceResult === null ? '掷骰中...' : 'D20' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  fateRollVisible: boolean
  diceAnimVisible: boolean
  diceResult: number | string | null
}>()

const emit = defineEmits<{
  fateDice: []
}>()

function handleFateDice() {
  emit('fateDice')
}
</script>

<style scoped>
.fate-panel { position:fixed; top:0;left:0;right:0;bottom:0; z-index:2000; display:flex; align-items:center; justify-content:center; }
.fate-overlay { position:absolute; top:0;left:0;right:0;bottom:0; background:oklch(8% 0.01 70 / 0.88); }
.fate-card { position:relative; background:var(--bg-deep); border:1rpx solid var(--danger); border-radius:28rpx; padding:48rpx; text-align:center; width:580rpx; box-sizing: border-box; }
.fate-title { display:block; font-family: var(--font-serif); font-size:30rpx; color:var(--danger); font-weight:900; margin-bottom:20rpx; }
.fate-desc { display:block; font-size:24rpx; color:var(--fg-soft); margin-bottom:14rpx; line-height: 1.5; }
.fate-rule { font-family: var(--font-mono); display:block; font-size:19rpx; color:var(--faint); margin-bottom:32rpx; letter-spacing: .02em; }
.fate-dice-btn { display:flex; align-items:center; justify-content:center; gap:12rpx; padding:22rpx; background:linear-gradient(135deg, var(--t-violet), oklch(56% 0.13 295)); border-radius:20rpx; }
.fate-dice-icon { font-size:34rpx; }
.fate-dice-text { font-size:25rpx; color:#fff; font-weight:700; }
.dice-animation { position:fixed; top:0;left:0;right:0;bottom:0; z-index:3000; display:flex; align-items:center; justify-content:center; }
.dice-overlay { position:absolute; top:0;left:0;right:0;bottom:0; background:oklch(8% 0.01 70 / 0.8); }
.dice-card { position:relative; background:var(--bg-deep); border:1rpx solid var(--t-violet); border-radius:28rpx; padding:48rpx; text-align:center; width:400rpx; box-sizing: border-box; }
.dice-spinning-wrap { position:relative; height:160rpx; display:flex; align-items:center; justify-content:center; margin-bottom:16rpx; }
.dice-spin { width:120rpx; height:120rpx; animation:spin 0.5s linear infinite; }
.dice-spin-emoji { position:absolute; font-size:90rpx; }
.dice-result-wrap { height:160rpx; display:flex; align-items:center; justify-content:center; margin-bottom:16rpx; }
.dice-result-number { font-family: var(--font-mono); font-size:100rpx; font-weight:700; color:var(--accent); }
.dice-caption { font-family: var(--font-mono); font-size:20rpx; color:var(--faint); letter-spacing: .06em; }
@keyframes spin { to{transform:rotate(360deg)} }
</style>
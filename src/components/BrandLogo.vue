<template>
  <span class="brand-logo" role="img" :aria-label="siteSettings.brandName">
    <img v-if="resolvedSrc" :src="resolvedSrc" :alt="siteSettings.brandName" />
    <svg v-else viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#b9f7dd" />
          <stop offset="1" stop-color="#7fdfe8" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11" :fill="`url(#${gradientId})`" />
      <rect x="3.2" y="3.2" width="33.6" height="33.6" rx="9" fill="none" stroke="rgba(255,255,255,.78)" stroke-width="1.2" />
      <text x="20" y="25.4" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="14.5" font-weight="700" letter-spacing="-1.6" fill="#0b3d32">WW</text>
      <rect x="11.5" y="29.6" width="17" height="1.8" rx="0.9" fill="rgba(11,61,48,.48)" />
    </svg>
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { siteSettings } from '../site/siteSettings.js'

const props = defineProps({
  // 传 null 表示强制使用默认印章；不传则读取已保存的站点 logo。
  src: { type: String, default: undefined },
})
const gradientId = 'brand-seal-' + Math.random().toString(36).slice(2, 8)
const resolvedSrc = computed(() => (props.src !== undefined ? props.src : siteSettings.logoDataUrl))
</script>

<style scoped>
.brand-logo { display: block; }
.brand-logo img,
.brand-logo svg { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>

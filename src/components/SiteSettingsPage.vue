<template>
  <div :class="['settings-page', { 'is-embedded': embedded }]">
    <header v-if="!embedded" class="settings-topbar">
      <div class="settings-brand">
        <BrandLogo class="settings-mark" :src="form.logoDataUrl" />
        <div>
          <strong>站点设置</strong>
          <span>配置首页与沙盒的品牌、标题、图标与 SEO</span>
        </div>
      </div>
      <div class="settings-links">
        <a href="/">返回首页</a>
        <a class="is-primary" href="/admin">成员管理</a>
      </div>
    </header>

    <div class="settings-layout">
      <div class="settings-form">
        <section class="panel">
          <header>
            <h2>品牌名称</h2>
            <p>首页顶栏、沙盒顶栏和预览中显示的名称与副标题。</p>
          </header>
          <div class="field-grid">
            <label class="field">
              <span>首页品牌名</span>
              <input v-model="form.brandName" maxlength="60" />
              <small v-if="errors.brandName" class="error">{{ errors.brandName }}</small>
            </label>
            <label class="field">
              <span>沙盒品牌名</span>
              <input v-model="form.sandboxBrandName" maxlength="60" />
            </label>
            <label class="field">
              <span>首页副标题</span>
              <input v-model="form.brandSubtitle" maxlength="120" />
            </label>
            <label class="field">
              <span>沙盒副标题</span>
              <input v-model="form.sandboxBrandSubtitle" maxlength="120" />
            </label>
          </div>
        </section>

        <section class="panel">
          <header>
            <h2>页面标题与 SEO</h2>
            <p>保存后立即更新浏览器标签、页面 meta 和分享标题。</p>
          </header>
          <div class="field-grid">
            <label class="field">
              <span>首页标题</span>
              <input v-model="form.homepageTitle" maxlength="120" />
              <small v-if="errors.homepageTitle" class="error">{{ errors.homepageTitle }}</small>
            </label>
            <label class="field">
              <span>沙盒页标题</span>
              <input v-model="form.sandboxTitle" maxlength="120" />
              <small v-if="errors.sandboxTitle" class="error">{{ errors.sandboxTitle }}</small>
            </label>
            <label class="field">
              <span>设置页标题</span>
              <input v-model="form.settingsTitle" maxlength="60" />
            </label>
            <label class="field">
              <span>作者</span>
              <input v-model="form.author" maxlength="120" />
            </label>
          </div>
          <label class="field">
            <span>描述</span>
            <textarea v-model="form.description" rows="2" maxlength="500"></textarea>
          </label>
          <label class="field">
            <span>关键词</span>
            <input v-model="form.keywords" maxlength="300" />
            <small>用英文逗号分隔</small>
          </label>
          <div class="field-grid">
            <label class="field">
              <span>分享标题</span>
              <input v-model="form.ogTitle" maxlength="120" />
            </label>
            <label class="field">
              <span>主题色</span>
              <span class="color-field">
                <input v-model="form.themeColor" type="color" />
                <input v-model="form.themeColor" class="color-text" maxlength="7" />
                <small v-if="errors.themeColor" class="error">{{ errors.themeColor }}</small>
              </span>
            </label>
          </div>
          <label class="field">
            <span>分享描述</span>
            <textarea v-model="form.ogDescription" rows="2" maxlength="500"></textarea>
          </label>
        </section>

        <section class="panel">
          <header>
            <h2>站点图标</h2>
            <p>浏览器标签、收藏夹和首页顶栏共用。支持 SVG / PNG / JPEG / WebP，最大 512 KB。</p>
          </header>
          <div class="logo-row">
            <div class="logo-preview">
              <BrandLogo :src="form.logoDataUrl" />
            </div>
            <div class="logo-actions">
              <button type="button" class="btn primary-ghost" @click="triggerLogoUpload">上传 logo</button>
              <button type="button" class="btn" :disabled="!form.logoDataUrl" @click="useDefaultLogo">使用默认 logo</button>
              <span class="logo-meta">{{ logoSizeLabel }}</span>
            </div>
            <input ref="logoInput" type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" hidden @change="onLogoFile" />
          </div>
          <small v-if="errors.logoDataUrl" class="error">{{ errors.logoDataUrl }}</small>
        </section>

        <AboutPanel />
      </div>

      <aside class="settings-preview">
        <div class="preview-card">
          <span class="preview-label">浏览器预览</span>
          <div class="browser">
            <div class="browser-chrome">
              <span class="browser-dots"><i></i><i></i><i></i></span>
              <div class="browser-tab">
                <BrandLogo class="browser-favicon" :src="form.logoDataUrl" />
                <span>{{ previewTitle }}</span>
                <em>×</em>
              </div>
              <span class="browser-plus">+</span>
            </div>
            <div class="browser-address">
              <svg class="browser-lock" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3.2" y="7" width="9.6" height="6.2" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3" />
                <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" fill="none" stroke="currentColor" stroke-width="1.3" />
              </svg>
              <span class="browser-url">{{ previewUrl }}</span>
              <span class="browser-more">⋯</span>
            </div>
            <div class="browser-viewport">
              <div class="browser-scene" aria-hidden="true">
                <span class="scene-block scene-block--a"></span>
                <span class="scene-block scene-block--b"></span>
                <span class="scene-block scene-block--c"></span>
              </div>
              <div class="preview-island preview-brand-island">
                <BrandLogo class="browser-logo" :src="form.logoDataUrl" />
                <div>
                  <strong>{{ form.brandName || '品牌名称' }}</strong>
                  <span>{{ form.brandSubtitle }}</span>
                </div>
              </div>
              <div class="preview-island preview-actions-island">
                <span class="preview-pill">登录</span>
                <span class="preview-pill preview-pill--primary">申请加入团队</span>
              </div>
              <div class="preview-island preview-info-island">
                <span class="preview-status"><i></i>已发布世界</span>
                <strong>三维世界</strong>
                <span>由世界沙盒发布</span>
              </div>
              <div class="preview-island preview-controls-island">
                <span class="preview-chip active">2.5D</span>
                <span class="preview-chip">3D</span>
                <span class="preview-chip active">总览</span>
                <span class="preview-chip">跟随</span>
              </div>
            </div>
          </div>
          <p class="preview-note">保存后首页、沙盒和浏览器标签立即使用新配置；静态 index.html 仍作为首次加载与爬虫的兜底。</p>
        </div>
      </aside>
    </div>

    <footer class="settings-actions">
      <div class="settings-status" :class="statusType" role="status" aria-live="polite">
        {{ loading ? '正在读取配置…' : status }}
      </div>
      <div class="settings-buttons">
        <button class="btn danger" :disabled="saving || loading" @click="reset">{{ resetArmed ? '确认重置' : '重置为默认' }}</button>
        <button class="btn primary" :disabled="saving || loading" @click="save">{{ saving ? '保存中…' : '保存配置' }}</button>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import BrandLogo from './BrandLogo.vue'
import AboutPanel from './AboutPanel.vue'
import {
  DEFAULT_SITE_SETTINGS,
  MAX_LOGO_BYTES,
  dataUrlByteLength,
  loadSiteSettings,
  normalizeSiteSettings,
  resetSiteSettings,
  saveSiteSettings,
  siteSettings,
  validateSiteSettings,
} from '../site/siteSettings.js'

const props = defineProps({
  apiBase: { type: String, default: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1' },
  devUserId: { type: String, default: import.meta.env.VITE_DEV_USER_ID || 'map-editor-local' },
  embedded: { type: Boolean, default: false },
})

const form = reactive(normalizeSiteSettings({ ...DEFAULT_SITE_SETTINGS, ...siteSettings }))
const errors = ref({})
const status = ref('')
const statusType = ref('info')
const saving = ref(false)
const loading = ref(true)
const resetArmed = ref(false)
const logoInput = ref(null)
let resetTimer = null

const previewTitle = computed(() => form.homepageTitle || form.brandName || '页面标题')
const previewUrl = computed(() => {
  if (typeof location !== 'undefined' && location.origin) return location.origin + '/'
  return 'https://campus.example/'
})
const logoSizeLabel = computed(() => form.logoDataUrl ? Math.max(1, Math.ceil(dataUrlByteLength(form.logoDataUrl) / 1024)) + ' KB' : '当前使用默认 logo')

function setStatus(text, type = 'info') {
  status.value = text
  statusType.value = type
}

onMounted(async () => {
  try {
    const loaded = await loadSiteSettings({ apiBase: props.apiBase })
    Object.assign(form, normalizeSiteSettings(loaded))
  } catch (error) {
    setStatus(error?.message || '读取站点配置失败，已显示默认值', 'error')
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer)
})

async function save() {
  errors.value = validateSiteSettings(form)
  if (Object.keys(errors.value).length) {
    setStatus('请检查标红的配置项。', 'error')
    return
  }
  saving.value = true
  try {
    const result = await saveSiteSettings(form, { apiBase: props.apiBase, userId: props.devUserId })
    Object.assign(form, result.settings)
    setStatus(result.remote ? '已保存到服务器，首页与沙盒立即使用新配置。' : (result.warning || '已保存到本地缓存。'), result.remote ? 'success' : 'warning')
  } catch (error) {
    setStatus(error?.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function reset() {
  if (!resetArmed.value) {
    resetArmed.value = true
    setStatus('再次点击「确认重置」会恢复默认品牌配置。', 'warning')
    if (resetTimer) clearTimeout(resetTimer)
    resetTimer = setTimeout(() => { resetArmed.value = false }, 4000)
    return
  }
  resetArmed.value = false
  if (resetTimer) clearTimeout(resetTimer)
  saving.value = true
  try {
    const result = await resetSiteSettings({ apiBase: props.apiBase, userId: props.devUserId })
    Object.assign(form, result.settings)
    errors.value = {}
    setStatus(result.remote ? '已重置为默认配置。' : (result.warning || '已在本地重置。'), result.remote ? 'success' : 'warning')
  } catch (error) {
    setStatus(error?.message || '重置失败', 'error')
  } finally {
    saving.value = false
  }
}

function triggerLogoUpload() {
  logoInput.value?.click()
}

function onLogoFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    setStatus('请选择 SVG、PNG、JPEG 或 WebP 图片。', 'error')
    return
  }
  if (file.size > MAX_LOGO_BYTES) {
    setStatus('logo 不能超过 512 KB。', 'error')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    form.logoDataUrl = String(reader.result || '')
    errors.value = { ...errors.value, logoDataUrl: '' }
    setStatus('新 logo 已载入，保存后生效。', 'info')
  }
  reader.onerror = () => setStatus('读取图片失败，请重试。', 'error')
  reader.readAsDataURL(file)
}

function useDefaultLogo() {
  form.logoDataUrl = null
  setStatus('已选择默认 logo，保存后生效。', 'info')
}
</script>

<style scoped>
.settings-page {
  --ink: #0f2e26;
  --ink-soft: #3f5a4e;
  --ink-dim: #5d7a6c;
  --glass-border: rgba(255, 255, 255, 0.72);
  --mint: #7ff0c8;
  --aqua: #6fd8e6;
  --accent-ink: #073b2e;
  position: fixed;
  inset: 0;
  overflow-y: auto;
  color: var(--ink);
  background:
    radial-gradient(1200px 600px at 8% -10%, rgba(255, 255, 255, 0.9), transparent 60%),
    radial-gradient(900px 500px at 100% 0%, rgba(127, 240, 200, 0.22), transparent 60%),
    linear-gradient(160deg, #e8f0ea, #cddfd6 60%, #dce9e2);
  font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
}
.settings-page.is-embedded {
  position: static;
  inset: auto;
  overflow: visible;
  padding: 0;
  background: transparent;
}
.settings-page.is-embedded .settings-layout {
  max-width: none;
  margin: 0;
  padding: 0 0 90px;
}
.settings-page.is-embedded .settings-preview { top: 20px; }
.settings-topbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px clamp(16px, 3vw, 32px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.65);
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
}
.settings-brand { display: flex; align-items: center; gap: 10px; }
.settings-mark { width: 38px; height: 38px; flex: none; }
.settings-brand strong { display: block; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
.settings-brand span { display: block; margin-top: 2px; color: var(--ink-soft); font-size: 10.5px; }
.settings-links { display: flex; gap: 8px; flex: none; }
.settings-links a { padding: 8px 12px; border: 1px solid rgba(15, 46, 38, 0.16); border-radius: 12px; background: rgba(255, 255, 255, 0.4); color: var(--ink); text-decoration: none; font-size: 11px; }
.settings-links a:hover { background: rgba(255, 255, 255, 0.64); }
.settings-links a:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.settings-links a.is-primary { border-color: transparent; background: linear-gradient(135deg, var(--mint), var(--aqua)); color: var(--accent-ink); font-weight: 700; }
.settings-layout { max-width: 1180px; margin: 0 auto; padding: 24px clamp(16px, 3vw, 32px) 110px; display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start; }
.settings-form { display: grid; gap: 18px; }
.panel { padding: 20px 22px; border: 1px solid var(--glass-border); border-radius: 20px; background: linear-gradient(160deg, rgba(255, 255, 255, 0.66), rgba(255, 255, 255, 0.42)); backdrop-filter: blur(24px) saturate(1.5); -webkit-backdrop-filter: blur(24px) saturate(1.5); box-shadow: 0 22px 50px rgba(24, 64, 48, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.9); }
.panel > header { margin-bottom: 15px; }
.panel h2 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: 0.3px; }
.panel header p { margin: 5px 0 0; color: var(--ink-dim); font-size: 10.5px; line-height: 1.6; }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
.field { display: grid; gap: 6px; margin: 0 0 12px; color: var(--ink-soft); font-size: 11px; }
.field > span:first-child { font-weight: 600; }
.field input,
.field textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid rgba(15, 46, 38, 0.14); border-radius: 10px; background: rgba(255, 255, 255, 0.55); color: var(--ink); font: inherit; font-size: 12px; }
.field textarea { resize: vertical; min-height: 60px; }
.field input:focus,
.field textarea:focus { outline: 2px solid rgba(31, 157, 120, 0.35); outline-offset: 0; border-color: rgba(31, 157, 120, 0.4); }
.field small { color: var(--ink-dim); font-size: 9.5px; }
.error { color: #b04338 !important; font-size: 10px; }
.color-field { display: flex; align-items: center; gap: 8px; }
.color-field input[type=color] { width: 44px; height: 36px; padding: 3px; flex: none; }
.color-field .color-text { flex: 1; font-variant-numeric: tabular-nums; }
.logo-row { display: flex; align-items: center; gap: 16px; }
.logo-preview { width: 64px; height: 64px; flex: none; padding: 4px; border: 1px solid rgba(255, 255, 255, 0.8); border-radius: 16px; background: rgba(255, 255, 255, 0.4); }
.logo-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.logo-meta { color: var(--ink-dim); font-size: 10px; }
.btn { padding: 9px 14px; border: 1px solid rgba(15, 46, 38, 0.16); border-radius: 12px; background: rgba(255, 255, 255, 0.4); color: var(--ink); font: inherit; font-size: 11.5px; cursor: pointer; }
.btn:hover { background: rgba(255, 255, 255, 0.62); }
.btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.btn.primary { border-color: transparent; background: linear-gradient(135deg, var(--mint), var(--aqua)); color: var(--accent-ink); font-weight: 700; box-shadow: 0 10px 24px rgba(63, 214, 164, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.55); }
.btn.primary-ghost { border-color: rgba(31, 157, 120, 0.35); color: #0b3d32; }
.btn.danger { border-color: rgba(176, 67, 56, 0.28); color: #9b3b31; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.settings-preview { position: sticky; top: 96px; }
.preview-card { padding: 18px; border: 1px solid var(--glass-border); border-radius: 20px; background: linear-gradient(160deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.38)); backdrop-filter: blur(22px) saturate(1.5); -webkit-backdrop-filter: blur(22px) saturate(1.5); box-shadow: 0 22px 50px rgba(24, 64, 48, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.9); }
.preview-label { display: block; margin-bottom: 10px; color: var(--ink-dim); font-size: 10px; letter-spacing: 0.8px; }
.browser { overflow: hidden; border: 1px solid rgba(15, 46, 38, 0.14); border-radius: 13px; background: #e7eeea; box-shadow: 0 10px 26px rgba(24, 64, 48, 0.08); }
.browser-chrome { display: flex; align-items: flex-end; gap: 7px; padding: 8px 8px 0; background: linear-gradient(180deg, #dde6e1, #d4ded9); }
.browser-dots { display: flex; gap: 4px; padding: 0 4px 8px; flex: none; }
.browser-dots i { width: 7px; height: 7px; border-radius: 50%; background: #c4cfca; }
.browser-dots i:nth-child(1) { background: #e08a7a; }
.browser-dots i:nth-child(2) { background: #e3bd6f; }
.browser-dots i:nth-child(3) { background: #7fc296; }
.browser-tab { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid rgba(15, 46, 38, 0.08); border-bottom: 0; border-radius: 8px 8px 0 0; background: rgba(255, 255, 255, 0.82); color: var(--ink-soft); font-size: 9.5px; }
.browser-tab span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.browser-tab em { margin-left: auto; color: #8ea096; font-size: 11px; font-style: normal; }
.browser-favicon { width: 14px; height: 14px; flex: none; }
.browser-plus { padding: 0 3px 8px; color: #71877b; font-size: 13px; flex: none; }
.browser-address { display: flex; align-items: center; gap: 6px; margin: 0 8px; padding: 6px 9px; border: 1px solid rgba(15, 46, 38, 0.1); border-radius: 8px; background: rgba(255, 255, 255, 0.9); color: #5d7a6c; }
.browser-lock { width: 11px; height: 11px; flex: none; color: #3f8f72; }
.browser-url { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; color: var(--ink-soft); }
.browser-more { flex: none; color: #8ea096; font-size: 11px; }
.browser-viewport { position: relative; min-height: 250px; overflow: hidden; background: linear-gradient(160deg, #e4efe7, #c9dbd0 70%, #d6e4db); }
.browser-scene { position: absolute; inset: 0; }
.browser-scene::before {
  content: '';
  position: absolute;
  left: 9%;
  right: 9%;
  top: 30%;
  height: 46%;
  transform: perspective(360px) rotateX(54deg);
  transform-origin: center bottom;
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 6px;
  background:
    repeating-linear-gradient(90deg, transparent 0 23px, rgba(16, 58, 44, 0.06) 23px 24px),
    repeating-linear-gradient(0deg, transparent 0 23px, rgba(16, 58, 44, 0.06) 23px 24px),
    linear-gradient(180deg, rgba(199, 216, 196, 0.9), rgba(224, 235, 220, 0.92));
  box-shadow: 0 18px 30px rgba(24, 64, 48, 0.14);
}
.scene-block { position: absolute; border-radius: 3px; box-shadow: 0 8px 14px rgba(24, 64, 48, 0.18); }
.scene-block--a { left: 24%; top: 36%; width: 27%; height: 16%; background: linear-gradient(180deg, #e8d7b6 0 22%, #c96a4c 22% 100%); transform: skewY(-10deg); }
.scene-block--b { right: 20%; top: 50%; width: 19%; height: 12%; background: linear-gradient(180deg, #d9c9a5 0 24%, #a94b38 24% 100%); transform: skewY(7deg); }
.scene-block--c { left: 47%; top: 60%; width: 11%; height: 7%; background: linear-gradient(180deg, #8ea594, #6e8676); transform: skewY(-14deg); }
.preview-island { position: absolute; z-index: 2; border: 1px solid rgba(255, 255, 255, 0.8); border-radius: 10px; background: linear-gradient(135deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.44)); backdrop-filter: blur(14px) saturate(1.5); -webkit-backdrop-filter: blur(14px) saturate(1.5); box-shadow: 0 8px 20px rgba(24, 64, 48, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.92); }
.preview-brand-island { top: 8px; left: 8px; display: flex; align-items: center; gap: 5px; max-width: 58%; padding: 5px 8px 5px 5px; }
.preview-brand-island > div { min-width: 0; }
.browser-logo { width: 16px; height: 16px; flex: none; }
.preview-brand-island strong { display: block; overflow: hidden; color: #0f2e26; font-size: 8.5px; white-space: nowrap; text-overflow: ellipsis; }
.preview-brand-island span { display: block; margin-top: 1px; overflow: hidden; color: #5d7a6c; font-size: 6.5px; white-space: nowrap; text-overflow: ellipsis; }
.preview-actions-island { top: 8px; right: 8px; display: flex; align-items: center; gap: 4px; padding: 4px; border-radius: 11px; }
.preview-pill { padding: 4px 6px; border-radius: 7px; background: rgba(255, 255, 255, 0.5); color: #3f5a4e; font-size: 6.5px; white-space: nowrap; }
.preview-pill--primary { background: linear-gradient(135deg, #7ff0c8, #6fd8e6); color: #073b2e; font-weight: 700; }
.preview-info-island { left: 8px; bottom: 8px; display: grid; gap: 1px; max-width: 50%; padding: 6px 8px; }
.preview-status { display: flex; align-items: center; gap: 4px; color: #0f8a67; font-size: 6.5px; font-weight: 700; }
.preview-status i { width: 4px; height: 4px; border-radius: 50%; background: #2fc79b; box-shadow: 0 0 0 2px rgba(47, 199, 155, 0.16); }
.preview-info-island strong { color: #0f2e26; font-size: 9px; }
.preview-info-island > span:last-child { color: #5d7a6c; font-size: 6.5px; }
.preview-controls-island { right: 8px; bottom: 8px; display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 10px; }
.preview-chip { padding: 3px 5px; border-radius: 6px; color: #5d7a6c; font-size: 6.5px; white-space: nowrap; }
.preview-chip.active { background: linear-gradient(135deg, #7ff0c8, #6fd8e6); color: #073b2e; font-weight: 700; }
.preview-note { margin: 12px 0 0; color: var(--ink-dim); font-size: 9.5px; line-height: 1.6; }
.settings-actions { position: sticky; bottom: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px clamp(16px, 3vw, 32px); border-top: 1px solid rgba(255, 255, 255, 0.7); background: rgba(255, 255, 255, 0.5); backdrop-filter: blur(24px) saturate(1.6); -webkit-backdrop-filter: blur(24px) saturate(1.6); }
.settings-status { min-width: 0; font-size: 11px; color: var(--ink-soft); }
.settings-status.success { color: #147a58; }
.settings-status.warning { color: #916a2b; }
.settings-status.error { color: #b04338; }
.settings-buttons { display: flex; gap: 8px; flex: none; }
@media (max-width: 980px) {
  .settings-layout { grid-template-columns: 1fr; }
  .settings-preview { position: static; order: -1; }
}
@media (max-width: 640px) {
  .settings-topbar { flex-wrap: wrap; }
  .settings-brand span { display: none; }
  .field-grid { grid-template-columns: 1fr; }
  .settings-actions { flex-direction: column; align-items: stretch; }
  .settings-buttons { justify-content: flex-end; }
  .panel { padding: 16px; }
  .logo-row { align-items: flex-start; }
}
</style>

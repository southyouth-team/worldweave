<template>
  <main class="auth-page">
    <section class="auth-card">
      <div class="auth-brand">
        <BrandLogo class="auth-mark" />
        <div>
          <strong>{{ siteSettings.brandName }}</strong>
          <span>{{ siteSettings.brandSubtitle }}</span>
        </div>
      </div>
      <h1>登录</h1>
      <p class="auth-intro">使用管理员或团队成员账号进入沙盒编辑器。</p>
      <form @submit.prevent="submit">
        <label class="auth-field">
          <span>用户名</span>
          <input v-model="username" autocomplete="username" placeholder="输入用户名" />
        </label>
        <label class="auth-field">
          <span>密码</span>
          <input v-model="password" type="password" autocomplete="current-password" placeholder="输入密码" />
        </label>
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
        <button class="auth-primary" type="submit" :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button>
      </form>
      <div class="auth-links">
        <a href="/join">申请加入团队</a>
        <a href="/">返回首页</a>
      </div>
      <p class="auth-note">首次登录后需要修改临时密码。</p>
    </section>
  </main>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import BrandLogo from './BrandLogo.vue'
import { siteSettings } from '../site/siteSettings.js'
import { defaultLanding, loadCurrentUser, login } from '../auth/authStore.js'

const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  const user = await loadCurrentUser()
  if (!user) return
  // 已登录用户再打开登录页：成员进编辑器，管理员进后台，待改密先进改密页。
  window.location.assign(defaultLanding(user))
})

async function submit() {
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const user = await login(username.value.trim(), password.value)
    window.location.assign(defaultLanding(user))
  } catch (err) {
    error.value = err?.message || '登录失败'
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.auth-page {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  overflow-y: auto;
  padding: 24px 16px;
  color: #0f2e26;
  background:
    radial-gradient(1000px 520px at 10% 0%, rgba(255, 255, 255, 0.92), transparent 60%),
    radial-gradient(900px 520px at 100% 100%, rgba(127, 240, 200, 0.25), transparent 65%),
    linear-gradient(160deg, #e8f0ea, #cddfd6 60%, #dce9e2);
  font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
}
.auth-card {
  width: min(420px, 100%);
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 24px;
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.44));
  backdrop-filter: blur(28px) saturate(1.7);
  -webkit-backdrop-filter: blur(28px) saturate(1.7);
  box-shadow: 0 30px 80px rgba(24, 64, 48, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.92);
}
.auth-brand { display: flex; align-items: center; gap: 10px; }
.auth-mark { width: 36px; height: 36px; flex: none; }
.auth-brand strong { display: block; font-size: 14px; font-weight: 700; }
.auth-brand span { display: block; margin-top: 2px; color: #5d7a6c; font-size: 10px; }
.auth-card h1 { margin: 24px 0 6px; font-size: 25px; font-weight: 700; letter-spacing: 0.5px; }
.auth-intro { margin: 0 0 20px; color: #3f5a4e; font-size: 12px; line-height: 1.7; }
.auth-field { display: grid; gap: 6px; margin-bottom: 14px; color: #3f5a4e; font-size: 11px; }
.auth-field span { font-weight: 600; }
.auth-field input {
  width: 100%;
  box-sizing: border-box;
  padding: 11px 13px;
  border: 1px solid rgba(15, 46, 38, 0.14);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.55);
  color: #0f2e26;
  font: inherit;
  font-size: 13px;
}
.auth-field input:focus { outline: 2px solid rgba(31, 157, 120, 0.35); border-color: rgba(31, 157, 120, 0.4); }
.auth-error { margin: 4px 0 12px; color: #b04338; font-size: 11px; }
.auth-primary {
  width: 100%;
  padding: 11px 14px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: linear-gradient(135deg, #7ff0c8, #6fd8e6);
  color: #073b2e;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(63, 214, 164, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.55);
}
.auth-primary:disabled { opacity: 0.55; cursor: wait; }
.auth-primary:focus-visible { outline: 2px solid #0f2e26; outline-offset: 2px; }
.auth-links { display: flex; justify-content: space-between; margin-top: 16px; }
.auth-links a { color: #0f7a5c; font-size: 11px; text-decoration: underline; text-underline-offset: 3px; }
.auth-note { margin: 14px 0 0; color: #5d7a6c; font-size: 10px; }
</style>

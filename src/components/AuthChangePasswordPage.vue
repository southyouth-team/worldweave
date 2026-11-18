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
      <h1>{{ user?.mustChangePassword ? '设置新密码' : '修改密码' }}</h1>
      <p v-if="user?.mustChangePassword" class="auth-intro">这是你第一次登录，需要先设置自己的密码才能进入沙盒。</p>
      <p v-else class="auth-intro">修改密码后，其他设备上的会话会被注销。</p>
      <form @submit.prevent="submit">
        <label class="auth-field">
          <span>当前密码</span>
          <input v-model="currentPassword" type="password" autocomplete="current-password" />
        </label>
        <label class="auth-field">
          <span>新密码</span>
          <input v-model="newPassword" type="password" autocomplete="new-password" placeholder="至少 8 位" />
        </label>
        <label class="auth-field">
          <span>确认新密码</span>
          <input v-model="confirmPassword" type="password" autocomplete="new-password" />
        </label>
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
        <button class="auth-primary" type="submit" :disabled="busy">{{ busy ? '提交中…' : '保存新密码' }}</button>
      </form>
      <div class="auth-links">
        <a href="/">返回首页</a>
        <a href="#" @click.prevent="logout">退出登录</a>
      </div>
    </section>
  </main>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import BrandLogo from './BrandLogo.vue'
import { siteSettings } from '../site/siteSettings.js'
import { changePassword, currentUser, loadCurrentUser, logout } from '../auth/authStore.js'

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const busy = ref(false)
const error = ref('')
const user = currentUser

onMounted(async () => {
  if (!currentUser.value) await loadCurrentUser()
  if (!currentUser.value) window.location.assign('/login?next=/change-password')
})

async function submit() {
  error.value = ''
  if (!currentPassword.value || !newPassword.value) {
    error.value = '请填写当前密码和新密码'
    return
  }
  if (newPassword.value.length < 8) {
    error.value = '新密码至少需要 8 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致'
    return
  }
  if (newPassword.value === currentPassword.value) {
    error.value = '新密码不能与当前密码相同'
    return
  }
  busy.value = true
  try {
    await changePassword(currentPassword.value, newPassword.value)
    // 改密完成后按角色落地：成员进编辑器，管理员进后台。
    window.location.assign(currentUser.value?.role === 'admin' ? '/admin' : '/world-sandbox-mvp')
  } catch (err) {
    error.value = err?.message || '修改失败'
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
.auth-card h1 { margin: 22px 0 6px; font-size: 23px; font-weight: 700; letter-spacing: 0.5px; }
.auth-intro { margin: 0 0 18px; color: #3f5a4e; font-size: 12px; line-height: 1.7; }
.auth-field { display: grid; gap: 6px; margin-bottom: 13px; color: #3f5a4e; font-size: 11px; }
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
</style>

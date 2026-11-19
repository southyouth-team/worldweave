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
      <template v-if="submitted">
        <h1>申请已提交</h1>
        <p class="auth-intro">{{ resultMessage }}</p>
        <div class="auth-links auth-links--stack">
          <a class="auth-primary auth-primary--link" href="/login">返回登录</a>
          <a href="/">返回首页</a>
        </div>
      </template>
      <template v-else>
        <h1>申请加入团队</h1>
        <p class="auth-intro">提交后由管理员审核；通过后账号和临时密码会发送到你填写的邮箱。</p>
        <form @submit.prevent="submit">
          <label class="auth-field">
            <span>姓名</span>
            <input v-model="form.name" maxlength="120" placeholder="真实姓名或常用称呼" />
          </label>
          <label class="auth-field">
            <span>通知邮箱</span>
            <input v-model.trim="form.email" type="email" maxlength="254" autocomplete="email" placeholder="用于接收审核结果和临时密码" />
          </label>
          <label class="auth-field">
            <span>其他联系方式（可选）</span>
            <input v-model="form.contact" maxlength="200" placeholder="手机 / 微信，方便管理员联系" />
          </label>
          <label class="auth-field">
            <span>期望用户名</span>
            <input v-model="form.desiredUsername" maxlength="32" placeholder="3-32 位字母、数字、下划线或短横线" />
          </label>
          <label class="auth-field">
            <span>申请说明（可选）</span>
            <textarea v-model="form.reason" maxlength="1000" rows="3" placeholder="你打算负责哪些地块或内容" />
          </label>
          <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
          <button class="auth-primary" type="submit" :disabled="busy">{{ busy ? '提交中…' : '提交申请' }}</button>
        </form>
        <div class="auth-links">
          <a href="/login">已有账号，去登录</a>
          <a href="/">返回首页</a>
        </div>
      </template>
    </section>
  </main>
</template>

<script setup>
import { reactive, ref } from 'vue'
import BrandLogo from './BrandLogo.vue'
import { siteSettings } from '../site/siteSettings.js'
import { submitJoinApplication } from '../auth/authStore.js'

const form = reactive({ name: '', email: '', contact: '', desiredUsername: '', reason: '' })
const busy = ref(false)
const error = ref('')
const submitted = ref(false)
const resultMessage = ref('')

async function submit() {
  if (!form.name.trim() || !form.email.trim() || !form.desiredUsername.trim()) {
    error.value = '请填写姓名、通知邮箱和期望用户名'
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    error.value = '请输入合法的通知邮箱'
    return
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/.test(form.desiredUsername.trim())) {
    error.value = '用户名需为 3-32 位字母、数字、下划线或短横线'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await submitJoinApplication({
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      contact: form.contact.trim(),
      desiredUsername: form.desiredUsername.trim(),
      reason: form.reason.trim(),
    })
    submitted.value = true
    resultMessage.value = '审核结果会发送到 ' + form.email.trim() + '；通过后邮件里会包含账号和临时密码。'
  } catch (err) {
    error.value = err?.message || '提交失败'
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
  width: min(460px, 100%);
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
.auth-field { display: grid; gap: 6px; margin-bottom: 13px; color: #3f5a4e; font-size: 11px; }
.auth-field span { font-weight: 600; }
.auth-field input,
.auth-field textarea {
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
.auth-field textarea { resize: vertical; }
.auth-field input:focus,
.auth-field textarea:focus { outline: 2px solid rgba(31, 157, 120, 0.35); border-color: rgba(31, 157, 120, 0.4); }
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
.auth-primary--link { display: block; box-sizing: border-box; text-align: center; text-decoration: none; }
.auth-links { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; gap: 12px; }
.auth-links--stack { flex-direction: column; align-items: stretch; }
.auth-links a { color: #0f7a5c; font-size: 11px; text-decoration: underline; text-underline-offset: 3px; }
.auth-links .auth-primary { color: #073b2e; text-decoration: none; }
</style>

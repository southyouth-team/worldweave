<template>
  <main class="email-settings" :class="{ embedded }">
    <header class="email-settings__head">
      <div>
        <p class="email-settings__eyebrow">ADMIN · NOTIFICATIONS</p>
        <h1>邮件通知</h1>
        <p>独立配置 SMTP 与通知开关。新申请和新发布通知管理员；审核通过、驳回或过期会通知提交人。</p>
      </div>
      <button class="email-settings__ghost" type="button" :disabled="loading" @click="load">刷新</button>
    </header>

    <p v-if="error" class="email-settings__message error" role="alert">{{ error }}</p>
    <p v-if="status" class="email-settings__message success" role="status">{{ status }}</p>
    <p v-if="loading" class="email-settings__message">正在读取邮件配置…</p>

    <form class="email-settings__panel" @submit.prevent="save">
      <header>
        <div>
          <h2>SMTP 发件服务</h2>
          <p>支持普通 SMTP 与 SSL/TLS。密码保存后不会回传浏览器，留空表示保持原密码。</p>
        </div>
        <label class="email-settings__switch">
          <input v-model="form.enabled" type="checkbox">
          <span>{{ form.enabled ? '已启用' : '未启用' }}</span>
        </label>
      </header>

      <div class="email-settings__grid">
        <label class="email-settings__field email-settings__field--wide">
          <span>SMTP 主机</span>
          <input v-model.trim="form.host" maxlength="255" placeholder="smtp.example.com" autocomplete="off">
        </label>
        <label class="email-settings__field">
          <span>端口</span>
          <input v-model.number="form.port" type="number" min="1" max="65535" inputmode="numeric">
        </label>
        <label class="email-settings__switch email-settings__switch--inline">
          <input v-model="form.secure" type="checkbox">
          <span>直接使用 SSL/TLS（465 常用）</span>
        </label>
        <label class="email-settings__field">
          <span>SMTP 用户名</span>
          <input v-model.trim="form.username" maxlength="255" placeholder="通常与发件邮箱相同" autocomplete="username">
        </label>
        <label class="email-settings__field">
          <span>SMTP 密码</span>
          <input v-model="form.password" type="password" maxlength="500" :placeholder="form.passwordConfigured ? '已配置，留空保持不变' : '邮箱授权码或 SMTP 密码'" autocomplete="new-password">
        </label>
        <label class="email-settings__field">
          <span>发件人名称</span>
          <input v-model.trim="form.fromName" maxlength="120" placeholder="Worldweave">
        </label>
        <label class="email-settings__field">
          <span>发件邮箱</span>
          <input v-model.trim="form.fromEmail" type="email" maxlength="254" placeholder="noreply@example.com" autocomplete="email">
        </label>
      </div>

      <label v-if="form.passwordConfigured" class="email-settings__clear">
        <input v-model="form.clearPassword" type="checkbox">
        <span>清除已保存的 SMTP 密码</span>
      </label>

      <label class="email-settings__field">
        <span>管理员通知收件人</span>
        <textarea v-model.trim="form.adminRecipients" rows="2" maxlength="2000" placeholder="admin@example.com, ops@example.com"></textarea>
        <small>可用逗号、分号或换行分隔。团队成员里状态为启用的管理员邮箱也会自动加入收件人。</small>
      </label>

      <div class="email-settings__toggles">
        <label><input v-model="form.notifyJoinApplication" type="checkbox"><span>新加入申请通知管理员</span></label>
        <label><input v-model="form.notifyPublishRequest" type="checkbox"><span>新发布申请通知管理员</span></label>
        <label><input v-model="form.notifyReviewResult" type="checkbox"><span>审核结果通知提交人</span></label>
      </div>

      <div class="email-settings__actions">
        <button class="email-settings__primary" type="submit" :disabled="busy || loading">{{ busy ? '保存中…' : '保存邮件配置' }}</button>
        <input v-model.trim="testRecipient" type="email" maxlength="254" placeholder="测试收件人，可留空用管理员邮箱">
        <button class="email-settings__ghost" type="button" :disabled="busy || loading || !form.enabled" @click="test">{{ testing ? '发送中…' : '发送测试邮件' }}</button>
      </div>
      <p class="email-settings__hint">测试邮件使用已保存的配置，修改后请先保存。未启用 SMTP 时不会发送任何邮件；通知失败会写入下方发送记录，不影响申请和审核本身。</p>
    </form>

    <section class="email-settings__panel">
      <header>
        <div>
          <h2>最近发送记录</h2>
          <p>最多显示 30 条，包含成功、跳过和失败原因。</p>
        </div>
        <button class="email-settings__ghost" type="button" :disabled="loadingLog" @click="loadLog">刷新记录</button>
      </header>
      <div v-if="loadingLog" class="email-settings__empty">正在加载…</div>
      <div v-else-if="!logs.length" class="email-settings__empty">还没有发送记录</div>
      <div v-else class="email-settings__logs">
        <div v-for="item in logs" :key="item.id" class="email-settings__log" :class="'is-' + item.status">
          <span class="email-settings__log-status">{{ statusLabel(item.status) }}</span>
          <span class="email-settings__log-main">
            <b>{{ item.kind }}</b>
            <small>{{ item.recipient || '无收件人' }} · {{ formatTime(item.createdAt) }}</small>
            <em v-if="item.error">{{ item.error }}</em>
          </span>
        </div>
      </div>
    </section>
  </main>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import {
  emailSettingsClient,
  normalizeEmailSettingsForm,
} from '../email/emailSettings.js'

defineProps({
  embedded: { type: Boolean, default: false },
})

const form = reactive(normalizeEmailSettingsForm({}))
const loading = ref(true)
const busy = ref(false)
const testing = ref(false)
const loadingLog = ref(false)
const error = ref('')
const status = ref('')
const testRecipient = ref('')
const logs = ref([])

function applyPayload(payload) {
  const next = normalizeEmailSettingsForm(payload)
  Object.assign(form, next)
  form.password = ''
  form.clearPassword = false
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    applyPayload(await emailSettingsClient.load())
    await loadLog()
  } catch (failure) {
    error.value = failure?.message || '读取邮件配置失败'
  } finally {
    loading.value = false
  }
}

async function loadLog() {
  loadingLog.value = true
  try {
    logs.value = await emailSettingsClient.log()
  } catch {
    logs.value = []
  } finally {
    loadingLog.value = false
  }
}

async function save() {
  busy.value = true
  error.value = ''
  status.value = ''
  try {
    const payload = {
      enabled: form.enabled,
      host: form.host,
      port: Number(form.port) || 587,
      secure: form.secure,
      username: form.username,
      password: form.password,
      clearPassword: form.clearPassword,
      fromName: form.fromName,
      fromEmail: form.fromEmail,
      adminRecipients: form.adminRecipients,
      notifyJoinApplication: form.notifyJoinApplication,
      notifyPublishRequest: form.notifyPublishRequest,
      notifyReviewResult: form.notifyReviewResult,
    }
    applyPayload(await emailSettingsClient.save(payload))
    status.value = '邮件配置已保存'
  } catch (failure) {
    error.value = failure?.message || '保存邮件配置失败'
  } finally {
    busy.value = false
  }
}

async function test() {
  testing.value = true
  error.value = ''
  status.value = ''
  try {
    const result = await emailSettingsClient.test(testRecipient.value)
    status.value = '测试邮件已发送至 ' + (result?.recipient || testRecipient.value || '管理员邮箱')
    await loadLog()
  } catch (failure) {
    error.value = failure?.message || '测试邮件发送失败'
    await loadLog()
  } finally {
    testing.value = false
  }
}

function statusLabel(value) {
  return { sent: '已发送', skipped: '已跳过', failed: '失败' }[value] || value
}

function formatTime(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return String(value)
  }
}

onMounted(load)
</script>

<style scoped>
.email-settings {
  min-height: 100vh;
  padding: 34px max(16px, env(safe-area-inset-left)) 60px max(16px, env(safe-area-inset-right));
  color: #0f2e26;
  background:
    radial-gradient(1000px 540px at 8% 0%, rgba(255, 255, 255, 0.94), transparent 62%),
    radial-gradient(900px 540px at 100% 100%, rgba(127, 240, 200, 0.24), transparent 66%),
    linear-gradient(160deg, #e8f0ea, #cfe0d7 62%, #dce9e2);
  font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
}
.email-settings.embedded { min-height: 0; padding: 0; background: transparent; }
.email-settings__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; width: min(980px, 100%); margin: 0 auto 18px; }
.email-settings__eyebrow { margin: 0 0 6px; color: #0f7a5c; font-size: 10px; font-weight: 700; letter-spacing: 1.8px; }
.email-settings__head h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: 0.4px; }
.email-settings__head p { margin: 0; max-width: 680px; color: #3f5a4e; font-size: 12px; line-height: 1.7; }
.email-settings__panel {
  width: min(980px, 100%);
  margin: 0 auto 16px;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 22px;
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.68), rgba(255, 255, 255, 0.4));
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: 0 20px 54px rgba(24, 64, 48, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}
.email-settings__panel > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.email-settings__panel h2 { margin: 0 0 4px; font-size: 16px; }
.email-settings__panel header p { margin: 0; color: #5d7a6c; font-size: 11px; line-height: 1.6; }
.email-settings__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.email-settings__field { display: grid; gap: 6px; margin-bottom: 12px; color: #3f5a4e; font-size: 11px; }
.email-settings__field--wide { grid-column: 1 / -1; }
.email-settings__field span { font-weight: 600; }
.email-settings__field input,
.email-settings__field textarea,
.email-settings__actions input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid rgba(15, 46, 38, 0.14);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.58);
  color: #0f2e26;
  font: inherit;
  font-size: 12px;
}
.email-settings__field textarea { resize: vertical; }
.email-settings__field small { color: #7e9586; font-size: 10px; line-height: 1.5; }
.email-settings__field input:focus,
.email-settings__field textarea:focus,
.email-settings__actions input:focus { outline: 2px solid rgba(31, 157, 120, 0.3); border-color: rgba(31, 157, 120, 0.4); }
.email-settings__switch { display: inline-flex; align-items: center; gap: 7px; color: #3f5a4e; font-size: 11px; cursor: pointer; }
.email-settings__switch--inline { align-self: end; margin-bottom: 13px; }
.email-settings__switch input { accent-color: #1f9d78; }
.email-settings__clear { display: flex; align-items: center; gap: 7px; margin: -2px 0 12px; color: #8a5a3f; font-size: 10px; }
.email-settings__toggles { display: flex; flex-wrap: wrap; gap: 10px 18px; padding: 12px; border: 1px solid rgba(15, 46, 38, 0.1); border-radius: 12px; background: rgba(255, 255, 255, 0.36); }
.email-settings__toggles label { display: flex; align-items: center; gap: 6px; color: #3f5a4e; font-size: 11px; cursor: pointer; }
.email-settings__toggles input { accent-color: #1f9d78; }
.email-settings__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; }
.email-settings__actions input { flex: 1 1 220px; }
.email-settings__primary,
.email-settings__ghost {
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: 11px;
  color: #073b2e;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.email-settings__primary { background: linear-gradient(135deg, #7ff0c8, #6fd8e6); box-shadow: 0 10px 24px rgba(63, 214, 164, 0.24); }
.email-settings__ghost { border-color: rgba(15, 46, 38, 0.16); background: rgba(255, 255, 255, 0.4); color: #0f5f49; }
.email-settings__primary:disabled,
.email-settings__ghost:disabled { opacity: 0.5; cursor: wait; }
.email-settings__hint { margin: 10px 0 0; color: #7e9586; font-size: 10px; line-height: 1.6; }
.email-settings__message { width: min(980px, 100%); box-sizing: border-box; margin: 0 auto 12px; padding: 10px 13px; border-radius: 12px; font-size: 11px; }
.email-settings__message.error { border: 1px solid rgba(176, 67, 56, 0.28); color: #8f2f25; background: rgba(255, 235, 232, 0.7); }
.email-settings__message.success { border: 1px solid rgba(31, 157, 120, 0.26); color: #0f6b51; background: rgba(230, 250, 243, 0.72); }
.email-settings__empty { padding: 18px; color: #7e9586; font-size: 11px; text-align: center; }
.email-settings__logs { display: grid; gap: 7px; }
.email-settings__log { display: flex; gap: 10px; align-items: flex-start; padding: 9px 10px; border: 1px solid rgba(15, 46, 38, 0.08); border-radius: 11px; background: rgba(255, 255, 255, 0.32); }
.email-settings__log-status { flex: none; min-width: 46px; padding: 3px 6px; border-radius: 999px; font-size: 9px; text-align: center; }
.email-settings__log.is-sent .email-settings__log-status { color: #0f6b51; background: rgba(143, 211, 154, 0.28); }
.email-settings__log.is-skipped .email-settings__log-status { color: #7a5a1f; background: rgba(230, 196, 122, 0.3); }
.email-settings__log.is-failed .email-settings__log-status { color: #8f2f25; background: rgba(224, 122, 104, 0.24); }
.email-settings__log-main { display: grid; gap: 2px; min-width: 0; }
.email-settings__log-main b { font-size: 11px; }
.email-settings__log-main small { color: #5d7a6c; font-size: 10px; overflow-wrap: anywhere; }
.email-settings__log-main em { color: #9a4034; font-size: 10px; font-style: normal; overflow-wrap: anywhere; }
@media (max-width: 680px) {
  .email-settings { padding: 22px 12px 44px; }
  .email-settings__head { flex-direction: column; }
  .email-settings__grid { grid-template-columns: 1fr; }
  .email-settings__field--wide { grid-column: auto; }
  .email-settings__panel { padding: 16px; border-radius: 18px; }
  .email-settings__panel > header { flex-direction: column; }
}
</style>

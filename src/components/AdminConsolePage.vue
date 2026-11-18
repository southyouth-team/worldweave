<template>
  <main class="admin-page">
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <div class="admin-brand">
          <BrandLogo class="admin-mark" />
          <div>
            <strong>管理后台</strong>
            <span>成员、发布审核与站点配置</span>
          </div>
        </div>
        <nav class="admin-nav" aria-label="管理菜单">
          <button :class="{ active: view === 'overview' }" @click="setView('overview')">概览</button>
          <button :class="{ active: view === 'applications' }" @click="setView('applications')">
            加入申请
            <em v-if="overview.pendingApplications">{{ overview.pendingApplications }}</em>
          </button>
          <button :class="{ active: view === 'publish' }" @click="setView('publish')">
            发布审核
            <em v-if="overview.pendingPublish">{{ overview.pendingPublish }}</em>
          </button>
          <button :class="{ active: view === 'users' }" @click="setView('users')">团队成员</button>
          <button :class="{ active: view === 'settings' }" @click="setView('settings')">站点设置</button>
        </nav>
        <div class="admin-account">
          <strong>{{ currentUser?.displayName || currentUser?.username || '管理员' }}</strong>
          <small>@{{ currentUser?.username }}</small>
          <div class="admin-account-actions">
            <a href="/">返回首页</a>
            <button @click="doLogout">退出登录</button>
          </div>
        </div>
      </aside>

      <section class="admin-main">
        <header class="admin-main-head">
          <div>
            <h1>{{ viewTitle }}</h1>
            <p>{{ viewDescription }}</p>
          </div>
          <button v-if="view !== 'settings'" class="btn" :disabled="loadingView" @click="refreshView">刷新</button>
        </header>

        <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
        <p v-if="status" class="admin-status" :class="statusType" role="status">{{ status }}</p>

        <template v-if="view === 'overview'">
          <div class="overview-grid">
            <button class="stat-card" @click="setView('applications')">
              <span>待审核加入申请</span>
              <strong>{{ overview.pendingApplications }}</strong>
              <small>查看并处理成员申请</small>
            </button>
            <button class="stat-card" @click="setView('publish')">
              <span>待审核发布</span>
              <strong>{{ overview.pendingPublish }}</strong>
              <small>审核成员提交的沙盒版本</small>
            </button>
            <button class="stat-card" @click="setView('users')">
              <span>团队成员</span>
              <strong>{{ overview.users }}</strong>
              <small>角色、状态与密码管理</small>
            </button>
            <div class="stat-card stat-card--static">
              <span>当前首页版本</span>
              <strong>{{ overview.published?.models ?? '—' }}</strong>
              <small v-if="overview.published?.publishedAt">发布于 {{ formatTime(overview.published.publishedAt) }}</small>
              <small v-else>尚未发布版本</small>
            </div>
          </div>
          <section class="admin-card">
            <header class="admin-card-head">
              <div>
                <h2>工作流程</h2>
                <p>成员在沙盒里编辑并提交发布申请；这里审核预览后，通过即切换首页版本。</p>
              </div>
            </header>
            <ol class="workflow-list">
              <li><b>1</b><span>成员提交加入申请，管理员审核并创建账号。</span></li>
              <li><b>2</b><span>成员登录编辑器，编辑模型和地块，提交发布申请。</span></li>
              <li><b>3</b><span>管理员在「发布审核」查看缩略图和说明，通过后首页立即使用新版本。</span></li>
            </ol>
          </section>
        </template>

        <template v-else-if="view === 'applications'">
          <section class="admin-card">
            <header class="admin-card-head">
              <div>
                <h2>加入申请</h2>
                <p>审核通过后自动创建成员账号，并生成一次性临时密码。</p>
              </div>
              <div class="admin-tabs">
                <button v-for="tab in applicationTabs" :key="tab.value" :class="{ active: applicationTab === tab.value }" @click="switchApplications(tab.value)">{{ tab.label }}</button>
              </div>
            </header>
            <div v-if="loadingApplications" class="admin-empty">加载中…</div>
            <div v-else-if="!applications.length" class="admin-empty">暂无{{ applicationTab === 'pending' ? '待审核' : '' }}申请</div>
            <ul v-else class="application-list">
              <li v-for="item in applications" :key="item.id" class="application-item">
                <div class="application-main">
                  <strong>{{ item.name }}</strong>
                  <span>期望用户名：{{ item.desired_username }}</span>
                  <span>联系方式：{{ item.contact }}</span>
                  <span v-if="item.reason">申请说明：{{ item.reason }}</span>
                  <span class="application-meta">提交于 {{ formatTime(item.created_at) }}<template v-if="item.status !== 'pending'"> · {{ statusLabel(item.status) }}<template v-if="item.reviewed_by_username"> · 审核人 {{ item.reviewed_by_username }}</template></template></span>
                </div>
                <div v-if="item.status === 'pending'" class="application-actions">
                  <button class="btn primary" :disabled="busyId === item.id" @click="approve(item)">通过并创建账号</button>
                  <button class="btn danger" :disabled="busyId === item.id" @click="reject(item)">驳回</button>
                </div>
              </li>
            </ul>
          </section>
        </template>

        <template v-else-if="view === 'publish'">
          <section class="admin-card">
            <header class="admin-card-head">
              <div>
                <h2>发布审核</h2>
                <p>成员提交的是提交时冻结的沙盒快照；通过后首页切换到这份版本，其他待审版本会标记为已过期。</p>
              </div>
              <div class="admin-tabs">
                <button v-for="tab in publishTabs" :key="tab.value" :class="{ active: publishTab === tab.value }" @click="switchPublish(tab.value)">{{ tab.label }}</button>
              </div>
            </header>
            <div v-if="loadingPublish" class="admin-empty">加载中…</div>
            <div v-else-if="!publishRequests.length" class="admin-empty">暂无{{ publishTab === 'pending' ? '待审核' : '' }}发布申请</div>
            <ul v-else class="publish-list">
              <li v-for="item in publishRequests" :key="item.id" class="publish-item">
                <button class="publish-thumb" type="button" @click="openPreview(item)">
                  <img v-if="item.thumbnailDataUrl" :src="item.thumbnailDataUrl" alt="提交版本缩略图" />
                  <span v-else>无缩略图</span>
                </button>
                <div class="publish-main">
                  <strong>{{ item.requester?.displayName || item.requester?.username || '成员' }} <small>@{{ item.requester?.username }}</small></strong>
                  <span class="publish-meta">提交于 {{ formatTime(item.createdAt) }} · {{ item.modelCount }} 个模型 · {{ item.chunkCount }} 个地块 · {{ formatBytes(item.snapshotBytes) }}</span>
                  <p v-if="item.note">说明：{{ item.note }}</p>
                  <span v-if="item.status === 'approved'" class="publish-state approved">已发布 · {{ formatTime(item.publishedAt) }}</span>
                  <span v-else-if="item.status === 'rejected'" class="publish-state rejected">已驳回<template v-if="item.reviewNote">：{{ item.reviewNote }}</template></span>
                  <span v-else-if="item.status === 'stale'" class="publish-state stale">已过期<template v-if="item.reviewNote">：{{ item.reviewNote }}</template></span>
                </div>
                <div v-if="item.status === 'pending'" class="publish-actions">
                  <button class="btn primary" :disabled="busyId === item.id" @click="approvePublish(item)">通过并发布</button>
                  <button class="btn danger" :disabled="busyId === item.id" @click="rejectPublish(item)">驳回</button>
                </div>
              </li>
            </ul>
          </section>
        </template>

        <template v-else-if="view === 'users'">
          <section class="admin-card">
            <header class="admin-card-head">
              <div>
                <h2>团队成员</h2>
                <p>停用后该账号立即无法登录；重置密码会注销其全部会话。</p>
              </div>
            </header>
            <div v-if="loadingUsers" class="admin-empty">加载中…</div>
            <div v-else class="user-table">
              <div class="user-row user-row--head">
                <span>账号</span><span>角色</span><span>状态</span><span>最近登录</span><span>操作</span>
              </div>
              <div v-for="user in users" :key="user.id" class="user-row">
                <span class="user-identity">
                  <strong>{{ user.displayName }}</strong>
                  <small>@{{ user.username }}<template v-if="user.mustChangePassword"> · 待改密</template></small>
                </span>
                <span>
                  <select :value="user.role" :disabled="busyId === user.id" @change="updateRole(user, $event.target.value)">
                    <option value="member">成员</option>
                    <option value="admin">管理员</option>
                  </select>
                </span>
                <span>
                  <select :value="user.status" :disabled="busyId === user.id" @change="updateStatus(user, $event.target.value)">
                    <option value="active">启用</option>
                    <option value="disabled">停用</option>
                  </select>
                </span>
                <span class="user-time">{{ user.lastLoginAt ? formatTime(user.lastLoginAt) : '从未登录' }}</span>
                <span class="user-actions">
                  <button class="btn small" :disabled="busyId === user.id" @click="resetPassword(user)">重置密码</button>
                </span>
              </div>
            </div>
          </section>
        </template>

        <template v-else-if="view === 'settings'">
          <SiteSettingsPage embedded />
        </template>
      </section>
    </div>

    <div v-if="previewRequest" class="preview-overlay" @click.self="closePreview">
      <div class="preview-modal" role="dialog" aria-modal="true" aria-label="发布预览">
        <header>
          <div>
            <strong>发布预览</strong>
            <span>{{ previewRequest.requester?.displayName || previewRequest.requester?.username }} · {{ formatTime(previewRequest.createdAt) }}</span>
          </div>
          <button class="preview-close" aria-label="关闭" @click="closePreview">×</button>
        </header>
        <div class="preview-body">
          <div v-if="previewLoading" class="preview-placeholder">正在加载提交的沙盒数据…</div>
          <div v-else-if="previewError" class="preview-placeholder preview-error">{{ previewError }}</div>
          <div v-else class="preview-stage">
            <SnapshotPreview3D
              ref="previewRef"
              :snapshot="previewSnapshot"
              @ready="handlePreviewReady"
              @select="handlePreviewSelect"
            />
            <aside class="preview-models">
              <span class="preview-models-title">模型与位置</span>
              <button
                v-for="model in previewModels"
                :key="model.id"
                type="button"
                :class="{ active: selectedPreviewModelId === model.id }"
                @click="focusPreviewModel(model.id)"
              >
                <strong>{{ model.name }}</strong>
                <small>x {{ Number(model.position.x).toFixed(1) }} · z {{ Number(model.position.z).toFixed(1) }}</small>
              </button>
              <p v-if="!previewModels.length">快照中没有模型</p>
              <p v-if="previewWorld" class="preview-world-info">
                {{ previewWorld.chunks }} 个地块 · 范围 {{ Math.round(previewWorld.bounds.maxX - previewWorld.bounds.minX) }} × {{ Math.round(previewWorld.bounds.maxZ - previewWorld.bounds.minZ) }}
              </p>
            </aside>
          </div>
          <div class="preview-meta">
            <span>{{ previewRequest.modelCount }} 个模型 · {{ previewRequest.chunkCount }} 个地块 · {{ formatBytes(previewRequest.snapshotBytes) }}</span>
            <p v-if="previewRequest.note">说明：{{ previewRequest.note }}</p>
            <p v-if="previewRequest.reviewNote">审核意见：{{ previewRequest.reviewNote }}</p>
          </div>
        </div>
        <footer v-if="previewRequest.status === 'pending'">
          <button class="btn danger" :disabled="busyId === previewRequest.id" @click="rejectPublish(previewRequest)">驳回</button>
          <button class="btn primary" :disabled="busyId === previewRequest.id" @click="approvePublish(previewRequest)">通过并发布</button>
        </footer>
      </div>
    </div>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import BrandLogo from './BrandLogo.vue'
import SnapshotPreview3D from './SnapshotPreview3D.vue'
import SiteSettingsPage from './SiteSettingsPage.vue'
import {
  adminApproveApplication,
  adminListApplications,
  adminListUsers,
  adminRejectApplication,
  adminResetPassword,
  adminUpdateUser,
  currentUser,
  loadCurrentUser,
  logout,
} from '../auth/authStore.js'
import {
  adminApprovePublishRequest,
  adminFetchPublishSnapshot,
  adminListPublishRequests,
  adminRejectPublishRequest,
  fetchPublishedHomepage,
} from '../publish/publishRequests.js'

const applicationTabs = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
  { value: 'all', label: '全部' },
]
const publishTabs = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已发布' },
  { value: 'rejected', label: '已驳回' },
  { value: 'stale', label: '已过期' },
  { value: 'all', label: '全部' },
]

const initialView = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('view')
const view = ref(initialView === 'settings' ? 'settings' : 'overview')
const applicationTab = ref('pending')
const publishTab = ref('pending')
const applications = ref([])
const publishRequests = ref([])
const users = ref([])
const loadingApplications = ref(false)
const loadingUsers = ref(false)
const loadingPublish = ref(false)
const loadingOverview = ref(false)
const busyId = ref('')
const error = ref('')
const status = ref('')
const statusType = ref('info')
const previewRequest = ref(null)
const previewSnapshot = ref(null)
const previewLoading = ref(false)
const previewError = ref('')
const previewModels = ref([])
const previewWorld = ref(null)
const selectedPreviewModelId = ref('')
const previewRef = ref(null)
const overview = ref({ pendingApplications: 0, pendingPublish: 0, users: 0, published: null })

const loadingView = computed(() => {
  if (view.value === 'applications') return loadingApplications.value
  if (view.value === 'users') return loadingUsers.value
  if (view.value === 'publish') return loadingPublish.value
  if (view.value === 'settings') return false
  return loadingOverview.value
})
const viewTitle = computed(() => ({
  overview: '概览',
  applications: '加入申请',
  publish: '发布审核',
  users: '团队成员',
  settings: '站点设置',
}[view.value] || '概览'))
const viewDescription = computed(() => ({
  overview: '待处理事项与当前首页版本。',
  applications: '审核想加入沙盒的成员，通过后自动创建账号。',
  publish: '审核成员提交的沙盒版本，通过后切换首页内容。',
  users: '管理成员角色、启用状态和密码。',
  settings: '配置首页与沙盒的品牌、标题、图标和 SEO。',
}[view.value] || ''))

onMounted(async () => {
  const user = await loadCurrentUser()
  if (!user) {
    window.location.assign('/login?next=/admin')
    return
  }
  if (user.role !== 'admin') {
    window.location.assign('/')
    return
  }
  await loadOverview()
})

function setStatus(text, type = 'info') {
  status.value = text
  statusType.value = type
  if (type === 'success') setTimeout(() => { status.value = '' }, 7000)
}

function setError(message) {
  error.value = message
  setTimeout(() => { error.value = '' }, 8000)
}

async function setView(nextView) {
  view.value = nextView
  if (typeof history !== 'undefined' && typeof location !== 'undefined') {
    const url = new URL(location.href)
    if (nextView === 'settings') url.searchParams.set('view', 'settings')
    else url.searchParams.delete('view')
    history.replaceState({}, '', url)
  }
  if (nextView === 'applications') await loadApplications()
  else if (nextView === 'users') await loadUsers()
  else if (nextView === 'publish') await loadPublishRequests()
  else if (nextView === 'settings') return
  else await loadOverview()
}

async function refreshView() {
  await setView(view.value)
}

async function loadOverview() {
  loadingOverview.value = true
  try {
    const [pendingApplications, pendingPublish, memberList, published] = await Promise.all([
      adminListApplications('pending'),
      adminListPublishRequests('pending'),
      adminListUsers(),
      fetchPublishedHomepage().catch(() => ({ snapshot: null, publishedAt: null })),
    ])
    overview.value = {
      pendingApplications: Array.isArray(pendingApplications) ? pendingApplications.length : 0,
      pendingPublish: Array.isArray(pendingPublish) ? pendingPublish.length : 0,
      users: Array.isArray(memberList) ? memberList.length : 0,
      published: published?.snapshot
        ? {
            models: Array.isArray(published.snapshot.models) ? published.snapshot.models.length : 0,
            chunks: Array.isArray(published.snapshot.world?.chunks) ? published.snapshot.world.chunks.length : 0,
            publishedAt: published.publishedAt || published.snapshot.publishedAt || null,
          }
        : null,
    }
  } catch (err) {
    setError(err?.message || '读取概览失败')
  } finally {
    loadingOverview.value = false
  }
}

async function loadApplications() {
  loadingApplications.value = true
  try {
    applications.value = await adminListApplications(applicationTab.value)
  } catch (err) {
    setError(err?.message || '读取申请失败')
  } finally {
    loadingApplications.value = false
  }
}

async function switchApplications(tab) {
  applicationTab.value = tab
  await loadApplications()
}

async function loadUsers() {
  loadingUsers.value = true
  try {
    users.value = await adminListUsers()
  } catch (err) {
    setError(err?.message || '读取成员失败')
  } finally {
    loadingUsers.value = false
  }
}

async function loadPublishRequests() {
  loadingPublish.value = true
  try {
    publishRequests.value = await adminListPublishRequests(publishTab.value)
  } catch (err) {
    setError(err?.message || '读取发布申请失败')
  } finally {
    loadingPublish.value = false
  }
}

async function switchPublish(tab) {
  publishTab.value = tab
  await loadPublishRequests()
}

async function approve(item) {
  busyId.value = item.id
  try {
    const result = await adminApproveApplication(item.id, {})
    const temp = result?.temporaryPassword || ''
    setStatus('已创建成员账号 @' + (result?.user?.username || item.desired_username) + (temp ? '，临时密码：' + temp + '（请安全转交）' : ''), 'success')
    await Promise.all([loadApplications(), loadOverview()])
  } catch (err) {
    setError(err?.message || '审核失败')
  } finally {
    busyId.value = ''
  }
}

async function reject(item) {
  const note = window.prompt('驳回原因（可选）：') || ''
  busyId.value = item.id
  try {
    await adminRejectApplication(item.id, note)
    setStatus('已驳回 @' + item.desired_username + ' 的申请', 'info')
    await Promise.all([loadApplications(), loadOverview()])
  } catch (err) {
    setError(err?.message || '驳回失败')
  } finally {
    busyId.value = ''
  }
}

async function approvePublish(item) {
  busyId.value = item.id
  try {
    const result = await adminApprovePublishRequest(item.id)
    previewRequest.value = null
    setStatus('已发布到首页：' + (result?.models ?? item.modelCount) + ' 个模型' + (result?.staleRequests ? '；' + result.staleRequests + ' 个旧的待审版本已标记为过期' : ''), 'success')
    await Promise.all([loadPublishRequests(), loadOverview()])
  } catch (err) {
    setError(err?.message || '发布失败')
  } finally {
    busyId.value = ''
  }
}

async function rejectPublish(item) {
  const note = window.prompt('驳回原因（可选）：') || ''
  busyId.value = item.id
  try {
    await adminRejectPublishRequest(item.id, note)
    previewRequest.value = null
    setStatus('已驳回这次的发布申请', 'info')
    await Promise.all([loadPublishRequests(), loadOverview()])
  } catch (err) {
    setError(err?.message || '驳回失败')
  } finally {
    busyId.value = ''
  }
}

async function updateRole(user, role) {
  busyId.value = user.id
  try {
    await adminUpdateUser(user.id, { role })
    setStatus('已更新 @' + user.username + ' 的角色', 'success')
    await Promise.all([loadUsers(), loadOverview()])
  } catch (err) {
    setError(err?.message || '角色更新失败')
  } finally {
    busyId.value = ''
  }
}

async function updateStatus(user, statusValue) {
  busyId.value = user.id
  try {
    await adminUpdateUser(user.id, { status: statusValue })
    setStatus(statusValue === 'disabled' ? '已停用 @' + user.username : '已启用 @' + user.username, 'success')
    await Promise.all([loadUsers(), loadOverview()])
  } catch (err) {
    setError(err?.message || '状态更新失败')
  } finally {
    busyId.value = ''
  }
}

async function resetPassword(user) {
  busyId.value = user.id
  try {
    const result = await adminResetPassword(user.id)
    setStatus('@' + user.username + ' 的临时密码：' + (result?.temporaryPassword || '生成失败'), 'success')
  } catch (err) {
    setError(err?.message || '重置密码失败')
  } finally {
    busyId.value = ''
  }
}

async function openPreview(item) {
  previewRequest.value = item
  previewSnapshot.value = null
  previewModels.value = []
  previewWorld.value = null
  selectedPreviewModelId.value = ''
  previewError.value = ''
  previewLoading.value = true
  try {
    previewSnapshot.value = await adminFetchPublishSnapshot(item.id)
  } catch (err) {
    previewError.value = err?.message || '读取发布快照失败，无法渲染 3D 预览'
  } finally {
    previewLoading.value = false
  }
}

function handlePreviewReady(payload) {
  previewModels.value = Array.isArray(payload?.models) ? payload.models : []
  previewWorld.value = payload?.world || null
}

function handlePreviewSelect(payload) {
  selectedPreviewModelId.value = payload?.id ? String(payload.id) : ''
}

function focusPreviewModel(id) {
  selectedPreviewModelId.value = String(id)
  previewRef.value?.focusModel?.(String(id))
}

function closePreview() {
  previewRequest.value = null
  previewSnapshot.value = null
  previewModels.value = []
  previewWorld.value = null
  selectedPreviewModelId.value = ''
  previewError.value = ''
}

function formatTime(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(value)
  }
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function statusLabel(value) {
  return value === 'approved' ? '已通过' : value === 'rejected' ? '已驳回' : '待审核'
}

async function doLogout() {
  await logout()
  window.location.assign('/login')
}
</script>

<style scoped>
.admin-page {
  position: fixed;
  inset: 0;
  overflow-y: auto;
  color: #0f2e26;
  background:
    radial-gradient(1000px 520px at 8% -10%, rgba(255, 255, 255, 0.92), transparent 60%),
    radial-gradient(900px 500px at 100% 0%, rgba(127, 240, 200, 0.2), transparent 60%),
    linear-gradient(160deg, #e8f0ea, #cddfd6 60%, #dce9e2);
  font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
}
.admin-shell { display: flex; min-height: 100%; align-items: stretch; }
.admin-sidebar {
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: 100vh;
  width: 232px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px 14px;
  border-right: 1px solid rgba(255, 255, 255, 0.65);
  background: rgba(255, 255, 255, 0.46);
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
}
.admin-brand { display: flex; align-items: center; gap: 9px; padding: 4px; }
.admin-mark { width: 34px; height: 34px; flex: none; }
.admin-brand strong { display: block; font-size: 14px; font-weight: 700; }
.admin-brand span { display: block; margin-top: 2px; color: #5d7a6c; font-size: 9.5px; line-height: 1.4; }
.admin-nav { display: grid; gap: 4px; }
.admin-nav button,
.admin-nav a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: #3f5a4e;
  font: inherit;
  font-size: 12px;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.admin-nav button:hover,
.admin-nav a:hover { background: rgba(255, 255, 255, 0.55); color: #0f2e26; }
.admin-nav button.active { border-color: rgba(31, 157, 120, 0.28); background: rgba(127, 240, 200, 0.28); color: #0b3d32; font-weight: 700; }
.admin-nav button em { padding: 1px 7px; border-radius: 8px; background: rgba(31, 157, 120, 0.16); color: #0b3d32; font-size: 10px; font-style: normal; }
.admin-account { margin-top: auto; display: grid; gap: 2px; padding: 10px 12px; border: 1px solid rgba(255, 255, 255, 0.65); border-radius: 14px; background: rgba(255, 255, 255, 0.36); }
.admin-account strong { font-size: 12px; }
.admin-account small { color: #5d7a6c; font-size: 10px; }
.admin-account-actions { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; }
.admin-account-actions a,
.admin-account-actions button { padding: 0; border: 0; background: transparent; color: #0f7a5c; font: inherit; font-size: 10px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.admin-main { flex: 1; min-width: 0; padding: 22px clamp(16px, 3vw, 32px) 48px; }
.admin-main-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.admin-main-head h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.3px; }
.admin-main-head p { margin: 5px 0 0; color: #5d7a6c; font-size: 11px; line-height: 1.6; }
.admin-error,
.admin-status { position: fixed; right: 20px; z-index: 20; max-width: min(520px, calc(100vw - 40px)); margin: 0; padding: 10px 14px; border-radius: 12px; font-size: 11px; box-shadow: 0 12px 30px rgba(24, 64, 48, 0.16); word-break: break-word; }
.admin-error { top: 20px; color: #fff; background: rgba(176, 67, 56, 0.94); }
.admin-status { top: 20px; color: #0b3d32; background: rgba(127, 240, 200, 0.88); }
.admin-status.info { background: rgba(255, 255, 255, 0.86); color: #3f5a4e; }
.overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 18px; }
.stat-card { display: grid; gap: 4px; min-height: 118px; padding: 16px 18px; border: 1px solid rgba(255, 255, 255, 0.72); border-radius: 18px; background: linear-gradient(160deg, rgba(255, 255, 255, 0.66), rgba(255, 255, 255, 0.42)); backdrop-filter: blur(20px) saturate(1.5); -webkit-backdrop-filter: blur(20px) saturate(1.5); box-shadow: 0 18px 40px rgba(24, 64, 48, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.9); color: #3f5a4e; text-align: left; font: inherit; cursor: pointer; }
.stat-card--static { cursor: default; }
.stat-card:hover { border-color: rgba(31, 157, 120, 0.4); }
.stat-card span { font-size: 11px; font-weight: 600; }
.stat-card strong { font-size: 30px; font-weight: 700; line-height: 1.1; color: #0f2e26; font-variant-numeric: tabular-nums; }
.stat-card small { color: #5d7a6c; font-size: 10px; line-height: 1.5; }
.admin-card { padding: 20px 22px; border: 1px solid rgba(255, 255, 255, 0.72); border-radius: 20px; background: linear-gradient(160deg, rgba(255, 255, 255, 0.66), rgba(255, 255, 255, 0.42)); backdrop-filter: blur(24px) saturate(1.5); -webkit-backdrop-filter: blur(24px) saturate(1.5); box-shadow: 0 22px 50px rgba(24, 64, 48, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.9); }
.admin-card-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; flex-wrap: wrap; }
.admin-card h2 { margin: 0; font-size: 15px; font-weight: 700; }
.admin-card p { margin: 5px 0 0; color: #5d7a6c; font-size: 10.5px; line-height: 1.6; }
.admin-tabs { display: flex; gap: 4px; padding: 3px; border: 1px solid rgba(255, 255, 255, 0.7); border-radius: 12px; background: rgba(255, 255, 255, 0.35); flex-wrap: wrap; }
.admin-tabs button { padding: 6px 10px; border: 0; border-radius: 9px; background: transparent; color: #3f5a4e; font: inherit; font-size: 11px; cursor: pointer; }
.admin-tabs button.active { background: linear-gradient(135deg, #7ff0c8, #6fd8e6); color: #073b2e; font-weight: 700; }
.admin-empty { padding: 30px 0; color: #5d7a6c; font-size: 11px; text-align: center; }
.workflow-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.workflow-list li { display: flex; align-items: center; gap: 10px; color: #3f5a4e; font-size: 11px; }
.workflow-list b { display: grid; place-items: center; width: 22px; height: 22px; flex: none; border-radius: 50%; background: rgba(127, 240, 200, 0.4); color: #0b3d32; font-size: 11px; }
.application-list,
.publish-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.application-item { display: flex; justify-content: space-between; gap: 14px; padding: 13px 14px; border: 1px solid rgba(15, 46, 38, 0.1); border-radius: 14px; background: rgba(255, 255, 255, 0.4); }
.application-main { min-width: 0; display: grid; gap: 3px; font-size: 11px; color: #3f5a4e; }
.application-main strong { color: #0f2e26; font-size: 13px; }
.application-meta { color: #5d7a6c; font-size: 10px; }
.application-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.publish-item { display: flex; gap: 14px; align-items: flex-start; padding: 13px; border: 1px solid rgba(15, 46, 38, 0.1); border-radius: 16px; background: rgba(255, 255, 255, 0.4); }
.publish-thumb { width: 132px; height: 88px; flex: none; padding: 0; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.75); border-radius: 12px; background: rgba(15, 46, 38, 0.06); color: #5d7a6c; font: inherit; font-size: 10px; cursor: pointer; }
.publish-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.publish-main { flex: 1; min-width: 0; display: grid; gap: 4px; color: #3f5a4e; font-size: 11px; }
.publish-main strong { color: #0f2e26; font-size: 13px; }
.publish-main strong small { color: #5d7a6c; font-size: 10px; font-weight: 400; }
.publish-meta { color: #5d7a6c; font-size: 10px; }
.publish-main p { margin: 2px 0 0; color: #3f5a4e; font-size: 11px; line-height: 1.6; }
.publish-state { margin-top: 2px; font-size: 10px; }
.publish-state.approved { color: #147a58; }
.publish-state.rejected { color: #9b3b31; }
.publish-state.stale { color: #916a2b; }
.publish-actions { display: flex; flex-direction: column; gap: 6px; flex: none; }
.btn { padding: 8px 12px; border: 1px solid rgba(15, 46, 38, 0.16); border-radius: 11px; background: rgba(255, 255, 255, 0.42); color: #0f2e26; font: inherit; font-size: 11px; cursor: pointer; }
.btn:hover { background: rgba(255, 255, 255, 0.66); }
.btn.primary { border-color: transparent; background: linear-gradient(135deg, #7ff0c8, #6fd8e6); color: #073b2e; font-weight: 700; }
.btn.danger { border-color: rgba(176, 67, 56, 0.3); color: #9b3b31; }
.btn.small { padding: 6px 9px; font-size: 10px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.user-table { display: grid; gap: 6px; }
.user-row { display: grid; grid-template-columns: minmax(180px, 1.4fr) 120px 110px 150px 120px; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid rgba(15, 46, 38, 0.08); border-radius: 12px; background: rgba(255, 255, 255, 0.34); font-size: 11px; }
.user-row--head { background: transparent; border-color: transparent; color: #5d7a6c; font-weight: 600; }
.user-identity { display: grid; gap: 2px; min-width: 0; }
.user-identity strong { font-size: 12px; }
.user-identity small { color: #5d7a6c; }
.user-row select { width: 100%; padding: 6px 8px; border: 1px solid rgba(15, 46, 38, 0.14); border-radius: 9px; background: rgba(255, 255, 255, 0.55); color: #0f2e26; font: inherit; font-size: 11px; }
.user-time { color: #5d7a6c; font-size: 10px; }
.preview-overlay { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 20px; background: rgba(11, 32, 25, 0.42); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.preview-modal { width: min(1120px, 96vw); max-height: 94vh; overflow-y: auto; border: 1px solid rgba(255, 255, 255, 0.8); border-radius: 22px; background: linear-gradient(160deg, rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.68)); box-shadow: 0 30px 90px rgba(10, 30, 22, 0.3); }
.preview-modal header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid rgba(15, 46, 38, 0.1); }
.preview-modal header strong { display: block; font-size: 15px; }
.preview-modal header span { display: block; margin-top: 3px; color: #5d7a6c; font-size: 10px; }
.preview-close { width: 28px; height: 28px; padding: 0; border: 1px solid rgba(15, 46, 38, 0.16); border-radius: 50%; background: rgba(255, 255, 255, 0.5); color: #3f5a4e; font-size: 16px; line-height: 1; cursor: pointer; }
.preview-body { padding: 16px 18px; }
.preview-stage { display: grid; grid-template-columns: minmax(0, 1fr) 230px; gap: 12px; align-items: stretch; }
.preview-models { display: flex; flex-direction: column; gap: 6px; max-height: min(52vh, 520px); min-height: 300px; overflow: auto; padding: 8px; border: 1px solid rgba(255, 255, 255, 0.65); border-radius: 14px; background: rgba(255, 255, 255, 0.35); }
.preview-models-title { font-size: 10px; font-weight: 600; color: #5d7a6c; }
.preview-models button { display: grid; gap: 2px; padding: 8px 9px; border: 1px solid rgba(15, 46, 38, 0.1); border-radius: 9px; background: rgba(255, 255, 255, 0.46); color: #0f2e26; font: inherit; text-align: left; cursor: pointer; }
.preview-models button:hover { background: rgba(255, 255, 255, 0.72); }
.preview-models button.active { border-color: rgba(31, 157, 120, 0.4); background: rgba(127, 240, 200, 0.3); }
.preview-models button strong { font-size: 11px; overflow-wrap: anywhere; }
.preview-models button small { color: #5d7a6c; font-size: 9px; font-variant-numeric: tabular-nums; }
.preview-models p { margin: 4px 2px; color: #5d7a6c; font-size: 10px; line-height: 1.5; }
.preview-world-info { margin-top: auto !important; padding-top: 8px; border-top: 1px solid rgba(15, 46, 38, 0.1); font-size: 9px !important; }
.preview-placeholder { display: grid; place-items: center; min-height: 300px; border-radius: 14px; background: rgba(15, 46, 38, 0.06); color: #5d7a6c; font-size: 11px; }
.preview-error { color: #9b3b31; }
.preview-meta { margin-top: 12px; color: #3f5a4e; font-size: 11px; line-height: 1.6; }
.preview-meta p { margin: 6px 0 0; }
.preview-modal footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 18px; border-top: 1px solid rgba(15, 46, 38, 0.1); }
@media (max-width: 900px) {
  .admin-shell { flex-direction: column; }
  .admin-sidebar { position: static; height: auto; width: auto; border-right: 0; border-bottom: 1px solid rgba(255, 255, 255, 0.65); }
  .admin-nav { display: flex; overflow-x: auto; gap: 6px; }
  .admin-nav button,
  .admin-nav a { flex: none; }
  .admin-account { margin-top: 0; }
  .admin-main { padding-top: 16px; }
  .publish-item { flex-wrap: wrap; }
  .publish-actions { flex-direction: row; width: 100%; }
  .user-row { grid-template-columns: 1fr 1fr; }
  .user-row--head { display: none; }
  .application-item { flex-direction: column; }
  .preview-stage { grid-template-columns: 1fr; }
  .preview-models { max-height: 180px; min-height: 0; }
}
</style>

<template>
  <section class="about-panel">
    <header>
      <div>
        <h2>关于 {{ PROJECT.name }} · {{ PROJECT.nameZh }}</h2>
        <p>{{ PROJECT.tagline }}</p>
      </div>
      <span class="about-version">v{{ PROJECT.version }}</span>
    </header>
    <dl class="about-grid">
      <div>
        <dt>项目</dt>
        <dd>{{ PROJECT.name }}（{{ PROJECT.nameZh }}）</dd>
      </div>
      <div>
        <dt>许可证</dt>
        <dd><a :href="PROJECT.licenseUrl" target="_blank" rel="noreferrer">{{ PROJECT.license }}</a>（非商业）</dd>
      </div>
      <div>
        <dt>仓库</dt>
        <dd><a :href="PROJECT.repoUrl" target="_blank" rel="noreferrer">{{ PROJECT.repoUrl }}</a></dd>
      </div>
      <div>
        <dt>技术栈</dt>
        <dd>{{ PROJECT.techStack }}</dd>
      </div>
    </dl>
    <p class="about-note">{{ PROJECT.description }} 喜欢这个项目的话，欢迎在 GitHub 点一个 Star。</p>
    <a class="about-star" :href="PROJECT.repoUrl" target="_blank" rel="noreferrer">★ 在 GitHub 上 Star</a>
  </section>
</template>

<script setup>
import { PROJECT } from '../site/projectInfo.js'
</script>

<style scoped>
.about-panel {
  padding: 20px 22px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 20px;
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.66), rgba(255, 255, 255, 0.42));
  backdrop-filter: blur(24px) saturate(1.5);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  box-shadow: 0 22px 50px rgba(24, 64, 48, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  color: #0f2e26;
  font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
}
.about-panel header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.about-panel h2 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: 0.3px; }
.about-panel header p { margin: 5px 0 0; color: #5d7a6c; font-size: 10.5px; }
.about-version { flex: none; padding: 3px 8px; border: 1px solid rgba(15, 46, 38, 0.12); border-radius: 8px; color: #5d7a6c; font-size: 10px; font-variant-numeric: tabular-nums; }
.about-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin: 14px 0; }
.about-grid div { display: grid; gap: 3px; min-width: 0; }
.about-grid dt { color: #5d7a6c; font-size: 10px; }
.about-grid dd { margin: 0; color: #3f5a4e; font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.about-grid a { color: #0f7a5c; text-decoration: underline; text-underline-offset: 3px; }
.about-note { margin: 0 0 12px; color: #3f5a4e; font-size: 10.5px; line-height: 1.6; }
.about-star {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: linear-gradient(135deg, #7ff0c8, #6fd8e6);
  color: #073b2e;
  font-size: 11px;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 10px 22px rgba(63, 214, 164, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.55);
}
.about-star:hover { filter: brightness(1.04); }
.about-star:focus-visible { outline: 2px solid #0f2e26; outline-offset: 2px; }
@media (max-width: 640px) {
  .about-grid { grid-template-columns: 1fr; }
  .about-panel { padding: 16px; }
}
</style>

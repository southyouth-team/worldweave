export interface SiteSettings {
  brandName: string;
  brandSubtitle: string;
  sandboxBrandName: string;
  sandboxBrandSubtitle: string;
  homepageTitle: string;
  sandboxTitle: string;
  settingsTitle: string;
  description: string;
  keywords: string;
  author: string;
  ogTitle: string;
  ogDescription: string;
  themeColor: string;
  logoDataUrl: string | null;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  brandName: 'Worldweave',
  brandSubtitle: '织界 · 源码公开的 AI 世界构建器',
  sandboxBrandName: 'Worldweave',
  sandboxBrandSubtitle: '织界 · AI 三维世界构建与协作',
  homepageTitle: 'Worldweave · 织界',
  sandboxTitle: 'Worldweave · 世界编辑器',
  settingsTitle: '站点设置',
  description: 'Worldweave（织界）是源码公开的 AI 世界构建器：等距地块编辑、AI 模型生成、发布审核与团队协作。',
  keywords: 'Worldweave,织界,三维世界沙盒,等距世界,AI 建模,源码公开',
  author: 'Worldweave contributors',
  ogTitle: 'Worldweave · 织界',
  ogDescription: '源码公开的 AI 世界构建器：等距地块编辑、AI 模型生成、发布审核与团队协作。',
  themeColor: '#e8f0ea',
  logoDataUrl: null,
};

export const SITE_SETTING_TEXT_LIMITS: Record<
  Exclude<keyof SiteSettings, 'logoDataUrl' | 'themeColor'>,
  number
> = {
  brandName: 60,
  brandSubtitle: 120,
  sandboxBrandName: 60,
  sandboxBrandSubtitle: 120,
  homepageTitle: 120,
  sandboxTitle: 120,
  settingsTitle: 60,
  description: 500,
  keywords: 300,
  author: 120,
  ogTitle: 120,
  ogDescription: 500,
};

export const MAX_LOGO_BYTES = 512 * 1024;

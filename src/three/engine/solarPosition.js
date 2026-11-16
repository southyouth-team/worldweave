const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

// 风格化太阳轨迹：真实太阳沿「东 → 南天 → 西」的大圆弧运动，
// 日出/日落贴近地平线，正午最高但仍偏南（北半球观感）。
// 不使用天文星历，只保证轨迹形状符合常识：东升西落、过南天、夜间沉入地平线下。
const MAX_ELEVATION = 0.92 // 正午最大高度（归一化），留出南向分量
const EAST_WEST_WEIGHT = 0.95
const SOUTHWARD_WEIGHT = 0.55
const SUNRISE_MIN_HEIGHT = 0.02 // 日出瞬间略高于地平线，保证刚升起时可见

/**
 * Lightweight virtual day cycle for sandbox lighting.
 * Hour 6 is sunrise, 12 is solar noon, 18 is sunset.
 * This is intentionally not an astronomical ephemeris.
 */
export function getVirtualSunState(hour = 12) {
  const numericHour = Number(hour)
  const normalizedHour = ((Number.isFinite(numericHour) ? numericHour : 12) % 24 + 24) % 24
  const phase = ((normalizedHour - 6) / 12) * Math.PI
  const rawElevation = Math.sin(phase)
  const elevation = rawElevation * MAX_ELEVATION
  const cosElevation = Math.sqrt(Math.max(0, 1 - elevation * elevation))
  // 方位角 0→π：东 → 南天 → 西；π→2π：西 → 北天（地平线下）→ 东
  const azimuth = phase
  const eastWest = -Math.cos(azimuth) * EAST_WEST_WEIGHT // 东为 -x，西为 +x
  const southward = -Math.sin(azimuth) * SOUTHWARD_WEIGHT // 南为 -z
  const height = elevation >= 0
    ? Math.max(SUNRISE_MIN_HEIGHT, elevation)
    : elevation // 夜间真实落到地平线以下
  const rawDirection = [eastWest * cosElevation, height, southward * cosElevation]
  const length = Math.hypot(...rawDirection) || 1
  const sunDirection = rawDirection.map(value => value / length)
  const daylight = smoothstep(-0.08, 0.28, rawElevation)
  const isNight = daylight < 0.025
  // 夜间把光照方向翻到月亮一侧（月光从上方照下）
  const lightDirection = isNight
    ? [-sunDirection[0], Math.abs(sunDirection[1]), -sunDirection[2]]
    : sunDirection

  return {
    hour: normalizedHour,
    sunElevation: rawElevation,
    daylight,
    isNight,
    direction: lightDirection,
  }
}

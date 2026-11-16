/**
 * 内置人物预设：只有两个——默认角色（男）与默认角色（女）。
 * 两者共用同一套人形结构与走跳动作，女性版通过明显不同的剪影区分：
 * 更窄的肩/躯干、更长且带侧发的发型、更收的腿部间距。
 */
import { createCampusPlayer } from '../world/campus/createCampusPlayer.js'

export const PLAYER_PRESETS = Object.freeze({
  male: {
    label: '默认角色（男）',
    height: 1.8,
    gender: 'male',
    palette: {},
  },
  female: {
    label: '默认角色（女）',
    height: 1.8,
    gender: 'female',
    palette: {
      shirt: '#ec6f9c',
      shirtLight: '#f48fb4',
      shirtShade: '#c44f7c',
      pants: '#7a4a6b',
      pantsLight: '#956185',
      hair: '#6b4423',
      hairLight: '#8a5c33',
      skin: '#f6d2ad',
      skinShade: '#d6ab86',
      shoes: '#ffffff',
      sole: '#e7c9d2',
    },
  },
})

export function getPlayerPreset(presetId) {
  return PLAYER_PRESETS[presetId] || null
}

// 构建预设角色模型；gender 可由调用方覆盖，默认取预设自身性别。
export function createPlayerPresetModel(THREE, presetId, options = {}) {
  const preset = getPlayerPreset(presetId)
  if (!preset) return null
  const gender = options.gender === 'female' || options.gender === 'male'
    ? options.gender
    : (preset.gender || 'male')
  return createCampusPlayer(THREE, { palette: preset.palette, gender })
}

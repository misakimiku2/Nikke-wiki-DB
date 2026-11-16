/**
 * 统一的播放 / 暂停图标（内联 SVG）。
 *
 * 不用 Unicode 字符 ⏸ / ▶ 的原因：不同平台对 U+23F8 / U+25B6 的字形处理不一致，
 * 部分平板/系统会把它渲染成彩色 emoji，与站点黑白工具条的风格冲突。
 * SVG 用 currentColor 取色，自动跟随按钮文字色与主题。
 */
import type { CSSProperties } from 'react'

type IconProps = {
  playing: boolean
  /** 图标边长，默认 1em 跟随按钮字号 */
  size?: string | number
  className?: string
  style?: CSSProperties
}

export function PlayIcon({ size = '1em', className, style }: Omit<IconProps, 'playing'>) {
  return (
    <svg
      className={className}
      style={{ display: 'block', flex: 'none', ...style }}
      width={size} height={size} viewBox="0 0 24 24"
      fill="currentColor" aria-hidden="true" focusable="false"
    >
      {/* 右向三角，视觉重心略右移以对齐光学中心 */}
      <path d="M7 4.5c0-.83.9-1.34 1.61-.9l11 7.05a1.05 1.05 0 0 1 0 1.77l-11 7.05A1.05 1.05 0 0 1 7 18.6V4.5Z" />
    </svg>
  )
}

export function PauseIcon({ size = '1em', className, style }: Omit<IconProps, 'playing'>) {
  return (
    <svg
      className={className}
      style={{ display: 'block', flex: 'none', ...style }}
      width={size} height={size} viewBox="0 0 24 24"
      fill="currentColor" aria-hidden="true" focusable="false"
    >
      <rect x="5.5" y="4.5" width="4.5" height="15" rx="0.9" />
      <rect x="14" y="4.5" width="4.5" height="15" rx="0.9" />
    </svg>
  )
}

/** 播放中显示暂停图标，暂停时显示播放图标 */
export function PlayPauseIcon({ playing, size = '1em', className, style }: IconProps) {
  return playing
    ? <PauseIcon size={size} className={className} style={style} />
    : <PlayIcon size={size} className={className} style={style} />
}

export default PlayPauseIcon

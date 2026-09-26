import type { ReactNode, SVGProps } from 'react'
import type { UiState } from './uiState'

type IconProps = SVGProps<SVGSVGElement>

const base: IconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
}

export function IconCamera(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="1.5" y="4.2" width="9" height="7.6" rx="2" />
      <path d="M10.5 7.6 14.5 5.2v5.6l-4-2.4z" />
    </svg>
  )
}

export function IconCameraOff(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="1.5" y="4.2" width="9" height="7.6" rx="2" />
      <path d="M10.5 7.6 14.5 5.2v5.6l-4-2.4z" />
      <path d="M2.4 14 13.6 2.4" />
    </svg>
  )
}

export function IconSpinner(props: IconProps) {
  return (
    <svg {...base} {...props} className={`signly-spin ${props.className ?? ''}`.trim()}>
      <circle cx="8" cy="8" r="6" opacity="0.28" />
      <path d="M8 2a6 6 0 0 1 6 6" />
    </svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m5.2 8.3 2 2 3.6-4.2" />
    </svg>
  )
}

export function IconTarget(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="6.2" />
      <circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconMinusCircle(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M5 8h6" />
    </svg>
  )
}

export function IconWarning(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 2.6 14.6 13.6H1.4z" />
      <path d="M8 6.6v3" />
      <circle cx="8" cy="11.5" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconPause(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4.4" y="3.4" width="2.4" height="9.2" rx="1.1" fill="currentColor" stroke="none" />
      <rect x="9.2" y="3.4" width="2.4" height="9.2" rx="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconAlert(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.6v3.7" />
      <circle cx="8" cy="11.2" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Status icon per UI state; always rendered together with a text label. */
export function StatusIcon({ uiState }: { uiState: UiState }): ReactNode {
  switch (uiState) {
    case 'idle':
      return <IconCameraOff />
    case 'loading':
      return <IconSpinner />
    case 'ready':
      return <IconCamera />
    case 'no_hand':
      return <IconMinusCircle />
    case 'hand_detected':
      return <IconTarget />
    case 'result':
      return <IconCheck />
    case 'paused':
      return <IconPause />
    case 'error':
      return <IconAlert />
  }
}

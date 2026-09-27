import type { ReactNode } from 'react'

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
        <g stroke="#062019" strokeWidth="2.1" strokeLinecap="round">
          <path d="M8 13.4V7.6a1.4 1.4 0 0 1 2.8 0v4.6" />
          <path d="M10.8 12.2V6.2a1.4 1.4 0 0 1 2.8 0v6" />
          <path d="M13.6 12.4V8a1.4 1.4 0 0 1 2.8 0v5.4" />
          <path d="M6.6 13.6c0 3.9 2.4 6.2 5.4 6.2s5.4-2.3 5.4-6.2" />
        </g>
      </svg>
    </span>
  )
}

export function Brand() {
  return (
    <div className="brand">
      <BrandMark />
      <span className="brand-text">
        <h1 className="brand-name">Signly</h1>
        <span className="brand-tag">Isolierte ASL-Gebärden im Browser</span>
      </span>
    </div>
  )
}

export function PrototypeBadge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>
}

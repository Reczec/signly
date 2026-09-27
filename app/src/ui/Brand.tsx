import type { ReactNode } from 'react'

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <img src="/signly.svg" alt="" width="44" height="44" />
    </span>
  )
}

export function Brand() {
  return (
    <div className="brand">
      <BrandMark />
      <span className="brand-text">
        <span className="brand-name">signly<span className="brand-period">.</span></span>
        <span className="brand-tag">SIGN. CONNECT.</span>
      </span>
    </div>
  )
}

export function PrototypeBadge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>
}

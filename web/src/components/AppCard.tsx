import type { ReactNode } from 'react'

interface CardProps {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  padding?: 'sm' | 'md'
}

export function AppCard({ title, action, children, className = '', padding = 'md' }: CardProps) {
  return (
    <section className={`card card--${padding} ${className}`.trim()}>
      {(title || action) && (
        <header className="card__header">
          {title && <h3 className="card__title">{title}</h3>}
          {action}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  )
}

interface EmptyStateProps {
  children: React.ReactNode
  compact?: boolean
}

export function EmptyState({ children, compact }: EmptyStateProps) {
  return <p className={`empty-state${compact ? ' empty-state--compact' : ''}`}>{children}</p>
}

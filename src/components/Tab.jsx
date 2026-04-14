export default function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12, padding: '5px 14px',
        fontWeight: active ? 500 : 400,
        background: active ? 'var(--color-background-primary)' : undefined,
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        borderColor: active ? 'var(--color-border-secondary)' : 'var(--color-border-tertiary)',
        borderRadius: 'var(--border-radius-md)',
      }}
    >
      {children}
    </button>
  )
}

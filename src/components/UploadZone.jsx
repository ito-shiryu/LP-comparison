export default function UploadZone({ label, onFile, color }) {
  const onDrop = e => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }
  return (
    <label
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
      style={{
        display: 'block', cursor: 'pointer',
        border: `1.5px dashed ${color}88`,
        borderRadius: 'var(--border-radius-lg)',
        padding: '2.5rem 1rem', textAlign: 'center',
        background: 'var(--color-background-secondary)',
      }}
    >
      <input
        type="file" accept="image/*"
        onChange={e => e.target.files[0] && onFile(e.target.files[0])}
        style={{ display: 'none' }}
      />
      <div style={{ fontSize: 22, marginBottom: 6 }}>📁</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 3 }}>
        クリックまたはドラッグ＆ドロップ
      </div>
    </label>
  )
}

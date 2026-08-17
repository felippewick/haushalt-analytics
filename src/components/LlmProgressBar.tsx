interface Props {
  done: number
  total: number
  label?: string
}

export function LlmProgressBar({ done, total, label }: Props) {
  const safeTotal = Math.max(total, 0)
  const clamped = safeTotal === 0 ? 0 : Math.min(done, safeTotal)
  const percent = safeTotal === 0 ? 0 : Math.round((clamped / safeTotal) * 100)

  return (
    <div className="llm-progress-wrap">
      {label ? <p className="llm-progress-label">{label}</p> : null}
      <div
        className="llm-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label}
      >
        <div className="llm-progress-bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

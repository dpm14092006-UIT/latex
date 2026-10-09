import { ZoomIn, ZoomOut } from 'lucide-react'
import { formatShortcut } from '../services/KeyboardShortcuts.js'

export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export default function ZoomControls({ value, onChange, label, subject, fitLabel = '', className = '' }) {
  const currentIndex = Math.max(0, ZOOM_LEVELS.indexOf(value))
  const selectClassName = fitLabel ? 'studio-zoom-select studio-zoom-select-fit' : 'studio-zoom-select'

  return (
    <div className={`studio-zoom-controls ${className}`.trim()} role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Thu nhỏ ${subject}`}
        title={formatShortcut(`Thu nhỏ ${subject} (Ctrl+-)`)}
        disabled={currentIndex === 0}
        onClick={() => onChange(ZOOM_LEVELS[Math.max(0, currentIndex - 1)])}
      >
        <ZoomOut size={14} />
      </button>
      <select
        className={selectClassName}
        aria-label={label}
        title={fitLabel ? 'Tỷ lệ so với chế độ vừa chiều rộng' : 'Tỷ lệ hiển thị bản thảo'}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      >
        {ZOOM_LEVELS.map(level => (
          <option key={level} value={level}>
            {level === 1 && fitLabel ? fitLabel : `${Math.round(level * 100)}%`}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={`Phóng to ${subject}`}
        title={formatShortcut(`Phóng to ${subject} (Ctrl+=)`)}
        disabled={currentIndex === ZOOM_LEVELS.length - 1}
        onClick={() => onChange(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, currentIndex + 1)])}
      >
        <ZoomIn size={14} />
      </button>
    </div>
  )
}

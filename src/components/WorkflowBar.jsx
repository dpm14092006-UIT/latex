import { ArrowRight, Check, FileCode2, FilePenLine, FileText, LoaderCircle } from 'lucide-react'

export default function WorkflowBar({ mode, onModeChange, compileState, pdfStale, sourceEdited }) {
  const status = compileState === 'compiling' ? 'Đang tạo PDF' : compileState === 'error' ? 'PDF cần kiểm tra' : compileState === 'blocked' ? 'PDF chờ xác nhận' : pdfStale ? 'PDF cần cập nhật' : compileState === 'ready' ? 'PDF đã cập nhật' : 'PDF chưa được tạo'
  const tone = compileState === 'error' ? 'error' : compileState === 'ready' && !pdfStale ? 'ready' : compileState === 'compiling' ? 'busy' : 'waiting'
  return <div className="aurora-workflow" aria-label="Quy trình tài liệu">
    <nav aria-label="Chuyển bước tài liệu">
      <button type="button" aria-label="Bước 1: Soạn bản thảo" aria-pressed={mode === 'write' || mode === 'split'} onClick={() => onModeChange('write')}><span className="aurora-step-number">01</span><FilePenLine size={14} /><span>Bản thảo</span></button>
      <ArrowRight size={13} className="aurora-step-arrow" />
      <button type="button" aria-label="Bước 2: Xem mã LaTeX" aria-pressed={mode === 'source'} onClick={() => onModeChange('source')}><span className="aurora-step-number">02</span><FileCode2 size={14} /><span>LaTeX</span><small>{sourceEdited ? 'Đã chỉnh sửa' : 'Tự tạo'}</small></button>
      <ArrowRight size={13} className="aurora-step-arrow" />
      <button type="button" aria-label="Bước 3: Xem bản in PDF" aria-pressed={mode === 'preview'} onClick={() => onModeChange('preview')}><span className="aurora-step-number">03</span><FileText size={14} /><span>Bản in</span></button>
    </nav>
    <span className="aurora-workflow-status" data-tone={tone} role="status">{tone === 'busy' ? <LoaderCircle size={12} className="animate-spin" /> : tone === 'ready' ? <Check size={12} /> : <span className="aurora-status-dot" />}{status}</span>
  </div>
}

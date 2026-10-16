import { Check, FileCode2, LoaderCircle } from 'lucide-react'

export default function WorkflowBar({ compileState, pdfStale, sourceEdited }) {
  const status = compileState === 'compiling' ? 'Đang tạo PDF' : compileState === 'error' ? 'PDF cần kiểm tra' : compileState === 'blocked' ? 'PDF chờ xác nhận' : pdfStale ? 'PDF cần cập nhật' : compileState === 'ready' ? 'PDF đã cập nhật' : 'PDF chưa được tạo'
  const tone = compileState === 'error' ? 'error' : compileState === 'ready' && !pdfStale ? 'ready' : compileState === 'compiling' ? 'busy' : 'waiting'
  return <div className="aurora-workflow" aria-label="Trạng thái tài liệu">
    <span className="aurora-workflow-source"><FileCode2 size={12} />{sourceEdited ? 'LaTeX đã chỉnh sửa' : 'LaTeX tự tạo'}</span>
    <span className="aurora-workflow-status" data-tone={tone} role="status">{tone === 'busy' ? <LoaderCircle size={12} className="animate-spin" /> : tone === 'ready' ? <Check size={12} /> : <span className="aurora-status-dot" />}{status}</span>
  </div>
}

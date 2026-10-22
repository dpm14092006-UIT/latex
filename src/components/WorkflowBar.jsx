import { ArrowRight, Check, FileCode2, FilePenLine, LoaderCircle } from 'lucide-react'

export default function WorkflowBar({ compileState, pdfStale, sourceEdited }) {
  const status = compileState === 'compiling' ? 'Đang tạo PDF' : compileState === 'error' ? 'PDF cần kiểm tra' : compileState === 'blocked' ? 'PDF chờ xác nhận' : pdfStale ? 'PDF cần cập nhật' : compileState === 'ready' ? 'PDF đã cập nhật' : 'PDF chưa được tạo'
  const tone = compileState === 'error' ? 'error' : compileState === 'ready' && !pdfStale ? 'ready' : compileState === 'compiling' ? 'busy' : 'waiting'
  return <div className="aurora-workflow" aria-label="Trạng thái tài liệu">
    <span className="aurora-workflow-source"><span className="workflow-draft"><FilePenLine size={12} />Bản thảo</span><ArrowRight size={11} aria-hidden="true" /><FileCode2 size={12} />{sourceEdited ? 'LaTeX đã chỉnh sửa' : 'LaTeX tự tạo'}<ArrowRight size={11} aria-hidden="true" /></span>
    <span className="aurora-workflow-status" data-tone={tone} role="status">{tone === 'busy' ? <LoaderCircle size={12} className="animate-spin" /> : tone === 'ready' ? <Check size={12} /> : <span className="aurora-status-dot" />}{status}</span>
  </div>
}

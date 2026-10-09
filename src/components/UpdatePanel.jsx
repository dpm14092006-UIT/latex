import { useState } from 'react'

const isWindows = () => typeof window !== 'undefined' && window.desktopAPI?.platform === 'win32'

export const updateBusy = status => ['checking', 'downloading', 'installing'].includes(status?.status)

export function updateSummary(status) {
  if (!status) return 'Đang đọc trạng thái cập nhật…'
  switch (status.status) {
    case 'checking': return 'Đang kiểm tra bản mới…'
    case 'up-to-date': return `Bạn đang dùng bản mới nhất (${status.currentVersion}).`
    case 'available': return `Có bản ${status.version} (đang dùng ${status.currentVersion}).`
    case 'downloading': return `Đang tải bản ${status.version}… ${Math.round((status.progress || 0) * 100)}%`
    case 'ready': return `Bản ${status.version} đã tải và kiểm tra SHA-256, sẵn sàng cài.`
    case 'installing': return `Đang chuẩn bị cài bản ${status.version}; ứng dụng sẽ lưu, thoát rồi tự mở lại.`
    case 'error': return status.error
    default: return `Phiên bản hiện tại: ${status.currentVersion}.`
  }
}

export default function UpdatePanel({ updates }) {
  const { status, call } = updates
  const [message, setMessage] = useState('')
  const act = async (action, ...args) => {
    setMessage('')
    try {
      const result = await call(action, ...args)
      if (result?.manual) setMessage(isWindows() ? 'Đã mở bộ cài. Làm theo các bước cài đặt; dữ liệu tài liệu được giữ nguyên.' : 'Đã mở bộ cài. Kéo Viet Latex Studio vào Applications để thay bản cũ.')
    } catch (error) { setMessage(error.message || 'Không thực hiện được thao tác cập nhật.') }
  }
  const busy = updateBusy(status)
  return <section className="studio-project-card" aria-label="Cập nhật ứng dụng">
    <strong>Cập nhật ứng dụng</strong>
    <p role="status">{updateSummary(status)}</p>
    {status?.error && status.status !== 'error' && <p className="studio-notice" role="alert">{status.error}</p>}
    {message && <p className="studio-notice" role="status">{message}</p>}
    {status?.notes && ['available', 'downloading', 'ready'].includes(status.status) && <details><summary>Có gì mới trong {status.version}</summary><pre className="studio-update-notes">{status.notes}</pre></details>}
    <div className="studio-manager-actions">
      <button type="button" disabled={busy} onClick={() => act('check')}>Kiểm tra cập nhật</button>
      {status?.status === 'available' && (status.downloadable ? <button type="button" onClick={() => act('download')}>Tải bản {status.version}</button> : <button type="button" onClick={() => act('openPage')}>Mở trang phát hành</button>)}
      {status?.status === 'ready' && <button type="button" onClick={() => act('install')}>{status.canInstall ? 'Cài và khởi động lại' : 'Mở bộ cài'}</button>}
      {status?.status === 'available' && <button type="button" onClick={() => act('skip')}>Bỏ qua bản này</button>}
    </div>
    <label className="studio-checkbox"><input type="checkbox" checked={status?.autoCheck !== false} disabled={!status} onChange={event => act('setAutoCheck', event.target.checked)} />Tự kiểm tra bản mới khi mở app và mỗi 6 giờ</label>
    <p>{isWindows() ? 'Bản cập nhật tải từ GitHub Releases và được kiểm tra SHA-256. Tài liệu được lưu và tạo điểm khôi phục, app thoát rồi bộ cài chạy im lặng và mở lại app.' : 'Bản cập nhật tải từ GitHub Releases, được kiểm tra SHA-256, chữ ký và mã ứng dụng trước khi cài. Tài liệu được lưu và tạo điểm khôi phục trước khi thay app; bản cũ được giữ trong “VietLatex Upgrade Backups”.'}</p>
  </section>
}

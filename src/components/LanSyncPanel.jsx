import { useEffect, useState } from 'react'
import { lanSyncLabel, lanSyncResultMessage } from '../services/LanSyncStatus.js'

export default function LanSyncPanel({ status, onAction }) {
  const [pairing, setPairing] = useState(''), [address, setAddress] = useState(''), [invitation, setInvitation] = useState(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [showSyncResult, setShowSyncResult] = useState(false)
  useEffect(() => { if (!address && status?.addresses?.length) setAddress(status.addresses[0]) }, [address, status])
  const run = async (action, value) => {
    setBusy(true); setMessage(''); setShowSyncResult(false)
    try {
      const result = await onAction(action, value)
      if (action === 'invite') setInvitation(result)
      if (action === 'join') { setPairing(''); setMessage('Đã ghép máy. Dữ liệu tự kiểm tra mỗi 5 giây.'); setShowSyncResult(true) }
      if (action === 'sync' || action === 'resolve') setShowSyncResult(true)
      if (action === 'off') { setInvitation(null); setMessage('Đã tắt kết nối. Tài liệu vẫn được giữ trên máy.') }
    } catch (error) { setMessage(error.message || 'Không thể đồng bộ.') }
    finally { setBusy(false) }
  }
  if (!window.desktopAPI?.exchangeSync) return <p>Đồng bộ LAN có trong ứng dụng desktop macOS.</p>
  return <div className="lan-sync-panel">
    <p>Hai máy cùng Wi-Fi hoặc mạng nội bộ có thể làm tiếp các dự án của nhau. Mỗi máy giữ dữ liệu riêng và tiếp tục soạn thảo khi mất mạng. PDF đã biên dịch được chuyển sang để xem và xuất ngay. Biên dịch lại source từ máy khác cần xác nhận tin cậy.</p>
    <p role="status">{status?.mode === 'host' ? `Máy này làm máy chủ · cổng ${status.port}` : status?.mode === 'client' ? `Kết nối máy chủ ${status.host}` : 'Đồng bộ đang tắt'}</p>
    <p role="status">{lanSyncLabel(status)}{(status?.mode === 'host' ? status.lastPeerSyncAt : status?.lastSyncAt) ? ` · Trao đổi với máy khác lúc ${new Date(status.mode === 'host' ? status.lastPeerSyncAt : status.lastSyncAt).toLocaleTimeString('vi-VN')}` : ''}</p>
    {status?.error && <p className="studio-notice" role="alert">{status.error} Dữ liệu vẫn được lưu trên máy.</p>}
    {status?.pdfError && <p className="studio-notice" role="alert">{status.pdfError}</p>}
    {status?.mode === 'client' && status.connected && !status.pdfSupported && <p className="studio-notice" role="status">Máy chủ cần cập nhật lên 0.5.6 hoặc mới hơn để đồng bộ PDF.</p>}
    {(message || showSyncResult) && <p className="studio-notice" role="status">{message}{message && showSyncResult ? ' ' : ''}{showSyncResult ? lanSyncResultMessage(status) : ''}</p>}
    <fieldset disabled={busy}>
      <div className="studio-manager-actions">
        {status?.mode !== 'host' && <button type="button" onClick={() => run('host')}>Làm máy chủ LAN</button>}
        {status?.mode !== 'off' && <><button type="button" onClick={() => run('sync')}>Đồng bộ ngay</button><button type="button" onClick={() => run('off')}>Tắt đồng bộ</button></>}
      </div>
      {status?.mode === 'host' && <>
        <p>Giữ ứng dụng trên máy chủ đang chạy. Nếu hệ điều hành hỏi quyền truy cập mạng, cho phép trên mạng riêng. Mã ghép dùng một lần và hết hạn sau 10 phút.</p>
        <label>Địa chỉ máy chủ<select value={address} onChange={event => setAddress(event.target.value)}>{(status.addresses || []).map(ip => <option key={ip} value={ip}>{ip}</option>)}</select></label>
        {!status.addresses?.length && <p>Chưa tìm thấy địa chỉ mạng nội bộ. Kết nối Wi-Fi hoặc Ethernet rồi mở lại bảng này.</p>}
        <button type="button" disabled={!address} onClick={() => run('invite', address)}>Tạo mã ghép máy</button>
        {invitation && <div className="studio-notice"><label>Mã ghép máy<textarea readOnly rows={4} value={invitation.code} onFocus={event => event.target.select()} /></label><p>Hết hạn lúc {new Date(invitation.expiresAt).toLocaleTimeString('vi-VN')}. Chỉ gửi mã này cho máy bạn muốn ghép.</p><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(invitation.code); setMessage('Đã sao chép mã ghép.') } catch { setMessage('Chọn và sao chép mã trong ô trên.') } }}>Sao chép mã ghép</button></div>}
        {(status.peers || []).map(peer => <div className="studio-manager-row" key={peer.id}><span>{peer.name} · {peer.online ? 'Đang kết nối' : 'Chưa thấy kết nối'}{!peer.pdfSupported ? ' · Cần cập nhật máy này lên 0.5.6 để nhận PDF' : ' · Hỗ trợ PDF'}{peer.lastSeenAt ? ` · ${new Date(peer.lastSeenAt).toLocaleTimeString('vi-VN')}` : ''}</span><button type="button" onClick={() => run('revoke', peer.id)}>Ngắt quyền kết nối</button></div>)}
      </>}
      {status?.mode !== 'host' && <>
        <label>Mã ghép từ máy chủ<textarea rows={3} value={pairing} maxLength={2048} onChange={event => setPairing(event.target.value)} placeholder="Dán mã vietlatex-lan:… từ máy còn lại" /></label>
        <button type="button" disabled={!pairing.trim()} onClick={() => run('join', pairing)}>Ghép với máy chủ</button>
      </>}
      <p>Toàn bộ dự án, mẫu và tài nguyên trong workspace được chia sẻ với các máy đã ghép. PDF khớp phiên bản bản thảo được chia sẻ khi hai máy hỗ trợ. Tab đang mở và giao diện thuộc từng máy.</p>
      {!!status?.conflicts?.length && <>
        <h3>Xung đột cần xử lý ({status.conflicts.length})</h3>
        <p>Hai máy đã sửa khác nhau. Cả phiên bản đang chia sẻ và thay đổi từ máy gửi đều được giữ đến khi bạn chọn. “Giữ cả hai” tạo bản sao để xem và gộp thủ công.</p>
        {status.conflicts.map(item => <div className="studio-notice" key={item.id}><p><strong>{item.title}</strong> · từ {item.deviceName} · {item.deleted ? 'Yêu cầu xóa' : 'Có phiên bản khác'}</p>
          <details><summary>Xem hai phiên bản</summary><div className="lan-sync-compare">{[['Bản đang chia sẻ', item.current], ['Bản từ máy gửi', item.incoming]].map(([name, version]) => <div key={name}><strong>{name}: {version?.title}</strong><pre>{version?.text || 'Không có nội dung văn bản để xem trước.'}</pre><small>{version?.assets || 0} tệp tài nguyên · phần xem trước tối đa 1.600 ký tự</small></div>)}</div></details>
          <div className="studio-manager-actions">
          <button type="button" onClick={() => run('resolve', { ...item, choice: 'both' })}>Giữ cả hai</button>
          <button type="button" onClick={() => run('resolve', { ...item, choice: 'current' })}>Giữ bản đang chia sẻ</button>
          <button type="button" onClick={() => run('resolve', { ...item, choice: 'incoming' })}>{item.deleted ? 'Áp dụng xóa' : 'Dùng bản từ máy gửi'}</button>
        </div></div>)}
      </>}
    </fieldset>
  </div>
}

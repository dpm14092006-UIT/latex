import { useState } from 'react'

export default function ProjectSyncPanel({ status, workspace, onAction }) {
  const [projectId, setProjectId] = useState(workspace.activeProjectId)
  const [url, setUrl] = useState(status?.defaultRelayUrl || status?.projectSync?.[0]?.relayUrl || '')
  const [code, setCode] = useState(''), [invitation, setInvitation] = useState(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const run = async (action, value) => {
    setBusy(true); setMessage('')
    try {
      const result = await onAction(action, value)
      if (action === 'project-invite') setInvitation({ ...result, projectId: value })
      if (action === 'project-enable') setMessage('Đã bật đồng bộ cho project. Tạo mã để thêm thiết bị.')
      if (action === 'project-join') setCode('')
      if (action === 'project-disconnect') { setInvitation(null); setMessage('Đã ngắt đồng bộ project. Bản trên máy vẫn được giữ.') }
      if (action === 'sync') setMessage(result?.projectSync?.some(group => group.error || group.relayError || group.conflicts?.length) ? 'Một số project còn chờ kết nối hoặc xử lý xung đột. Xem trạng thái bên dưới.' : 'Đã kiểm tra đồng bộ. Project chờ thiết bị khác sẽ được gửi khi kết nối lại.')
    } catch (error) { setMessage(error.message || 'Không thể đồng bộ project.') }
    finally { setBusy(false) }
  }
  if (!window.desktopAPI?.enableProjectSync) return <p>Đồng bộ project có trong ứng dụng desktop macOS và Windows.</p>
  const groups = status?.projectSync || []
  const available = workspace.projects.filter(project => !groups.some(group => group.projectId === project.id))
  const selected = available.some(project => project.id === projectId) ? projectId : available[0]?.id || ''
  return <section className="project-sync-panel">
    <h3>Đồng bộ project giữa các thiết bị</h3>
    <p>Nhập mã một lần để làm tiếp project trên máy khác, kể cả khi dùng Wi-Fi khác nhau. Hai máy cần đang chạy ứng dụng và có mạng. Khi mất kết nối, bạn vẫn soạn thảo và lưu trên máy.</p>
    {!url && !groups.length && <p className="studio-notice" role="status">Để tạo mã kết nối qua Internet, cần cấu hình máy chủ HTTPS ở mục bên dưới. Nếu đã có mã từ máy khác, bạn có thể dán mã để kết nối ngay.</p>}
    {message && <p className="studio-notice" role="status">{message}</p>}
    {status?.mode !== 'off' && status?.mode && <p className="studio-notice">Đang bật đồng bộ LAN toàn workspace. Tắt kết nối đó trong mục bên dưới trước khi đồng bộ riêng từng project.</p>}
    <fieldset disabled={busy}>
      <details open={!groups.length && !status?.pendingJoin}><summary>Thêm project hoặc kết nối bằng mã</summary>
      {!!available.length && <div className="studio-notice">
        <label>Project cần đồng bộ<select value={selected} onChange={event => setProjectId(event.target.value)}>{available.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <details open={!url}><summary>Cài đặt kết nối</summary><label>Máy chủ đồng bộ<input type="url" value={url} maxLength={1000} placeholder="https://sync.example.com" onChange={event => setUrl(event.target.value)} /></label><p>Dùng địa chỉ máy chủ do bạn hoặc người quản lý ứng dụng cung cấp. Máy nhận lấy thông tin kết nối từ mã ghép.</p></details>
        <button type="button" disabled={!selected || !url.trim() || status?.mode !== 'off'} onClick={() => run('project-enable', { id: selected, url: url.trim() })}>Bật đồng bộ project</button>
      </div>}
      <div className="studio-notice">
        <label>Mã kết nối project<textarea rows={3} value={code} maxLength={4096} onChange={event => setCode(event.target.value)} placeholder="Dán mã vietlatex-sync:… từ máy đang có project" /></label>
        <button type="button" disabled={!code.trim() || Boolean(status?.pendingJoin) || status?.mode !== 'off'} onClick={() => run('project-join', code.trim())}>Kết nối project</button>
      </div>
      </details>
      {status?.pendingJoin && <div className="studio-notice" role="status"><p>{status.pendingJoin.error || 'Đang chờ máy giữ project xác nhận thiết bị này…'}</p><p>Mã hết hạn lúc {new Date(status.pendingJoin.expiresAt).toLocaleTimeString('vi-VN')}.</p><button type="button" onClick={() => run('project-cancel-join')}>Hủy yêu cầu ghép</button></div>}
      {!!groups.length && <button type="button" onClick={() => run('sync')}>Đồng bộ các project ngay</button>}
      {groups.map(group => <article className="studio-notice" key={group.projectId}>
        <h3>{workspace.projects.find(project => project.id === group.projectId)?.name || group.projectName}</h3>
        <p role="status">{group.mode === 'host' ? 'Máy này giữ kết nối project' : group.connected ? `Đã kết nối · ${group.via === 'lan' ? 'qua LAN' : 'qua Internet'}` : 'Đang chờ kết nối'}{group.lastSyncAt ? ` · Kiểm tra lúc ${new Date(group.lastSyncAt).toLocaleTimeString('vi-VN')}` : ''}</p>
        {(group.error || group.relayError) && <p role="alert">{group.error || group.relayError} Bản thảo vẫn được lưu trên máy.</p>}
        {group.pdfError && <p role="alert">{group.pdfError}</p>}
        <div className="studio-manager-actions"><button type="button" onClick={() => run('project-invite', group.projectId)}>Thêm thiết bị</button><button type="button" onClick={() => run('project-disconnect', group.projectId)}>Ngắt đồng bộ project</button></div>
        {group.mode === 'host' && <label className="studio-checkbox"><input type="checkbox" checked={Boolean(group.keepAwake)} onChange={event => run('project-keep-awake', { id: group.projectId, enabled: event.target.checked })} />Giữ máy này không ngủ khi đồng bộ (tốn điện hơn)</label>}
        {invitation?.projectId === group.projectId && <div><label>Mã mời thêm thiết bị<textarea rows={4} readOnly value={invitation.code} onFocus={event => event.target.select()} /></label><p>Mã dùng một lần, hết hạn lúc {new Date(invitation.expiresAt).toLocaleTimeString('vi-VN')}. Chỉ gửi cho thiết bị bạn muốn ghép.</p><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(invitation.code); setMessage('Đã sao chép mã mời.') } catch { setMessage('Chọn và sao chép mã trong ô trên.') } }}>Sao chép mã mời</button></div>}
        {group.pendingPairs?.map(peer => <div key={peer.id} role="status"><p><strong>{peer.name}</strong> muốn kết nối project này.</p><div className="studio-manager-actions"><button type="button" onClick={() => run('project-approve', { id: group.projectId, device: peer.id, allowed: true })}>Cho phép thiết bị</button><button type="button" onClick={() => run('project-approve', { id: group.projectId, device: peer.id, allowed: false })}>Từ chối</button></div></div>)}
        {group.mode === 'host' && group.peers?.map(peer => <div className="studio-manager-row" key={peer.id}><span>{peer.name} · {peer.online ? 'Đang kết nối' : 'Chờ thiết bị trực tuyến'}</span><button type="button" onClick={() => run('project-revoke', { id: group.projectId, device: peer.id })}>Thu hồi quyền</button></div>)}
        {!!group.conflicts?.length && <div><h4>Xung đột cần xử lý ({group.conflicts.length})</h4><p>Các phiên bản được giữ đến khi bạn chọn.</p>{group.conflicts.map(item => <div key={item.id}>
          <p><strong>{item.title}</strong> · từ {item.deviceName}</p>
          <details><summary>Xem hai phiên bản</summary><div className="lan-sync-compare">{[['Bản đang chia sẻ', item.current], ['Bản từ máy gửi', item.incoming]].map(([name, version]) => <div key={name}><strong>{name}: {version?.title}</strong><pre>{version?.text || 'Không có nội dung xem trước.'}</pre></div>)}</div></details>
          <div className="studio-manager-actions">{!item.key.startsWith('project:') && <button type="button" onClick={() => run('project-resolve', { ...item, projectId: group.projectId, choice: 'both' })}>Giữ cả hai</button>}<button type="button" onClick={() => run('project-resolve', { ...item, projectId: group.projectId, choice: 'current' })}>Giữ bản đang chia sẻ</button><button type="button" onClick={() => run('project-resolve', { ...item, projectId: group.projectId, choice: 'incoming' })}>{item.deleted ? 'Áp dụng xóa' : 'Dùng bản từ máy gửi'}</button></div>
        </div>)}</div>}
      </article>)}
      <p>Chỉ project đã chọn, tài nguyên và mẫu trang đang dùng được chia sẻ. Project khác, giao diện và quyết định tin cậy LaTeX thuộc từng máy. Máy giữ project cần trực tuyến để các thiết bị trao đổi thay đổi.</p>
    </fieldset>
  </section>
}

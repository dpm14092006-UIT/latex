export function lanSyncLabel(status) {
  if (!status) return 'LAN · đang kiểm tra'
  if (status.mode === 'off') return 'LAN · đang tắt'
  if (status.error) return 'LAN · mất kết nối'
  if (status.conflicts?.length) return `LAN · ${status.conflicts.length} xung đột`
  if (status.mode === 'host') {
    const online = (status.peers || []).filter(peer => peer.online).length
    return online ? `LAN · ${online} máy đang kết nối` : 'LAN · chờ máy kết nối'
  }
  return status.connected ? 'LAN · đã kết nối' : 'LAN · đang kết nối'
}

export function lanSyncResultMessage(status) {
  if (status?.error) return status.error
  if (status?.pdfError) return status.pdfError
  if (status?.conflicts?.length) return `Đã lưu trên máy. Còn ${status.conflicts.length} xung đột chưa đồng bộ; chọn phiên bản bên dưới.`
  if (status?.mode === 'host' && !(status.peers || []).some(peer => peer.online)) return 'Đã lưu trên máy chủ. Chưa có máy khác đang kết nối để nhận thay đổi.'
  return 'Đã đồng bộ và lưu trên máy.'
}

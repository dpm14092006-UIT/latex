export default function AbstractSettings({ settings, onSettings }) {
  return <section className="studio-abstract-settings" aria-label="Thiết lập Abstract">
    <label className="studio-checkbox"><input type="checkbox" checked={settings.abstractEnabled === true} onChange={event => onSettings({ ...settings, abstractEnabled: event.target.checked })} />Thêm Abstract vào tài liệu</label>
    {settings.abstractEnabled && <>
      <label>Tiêu đề phần tóm tắt<select className="field" value={settings.abstractTitle || 'Abstract'} onChange={event => onSettings({ ...settings, abstractTitle: event.target.value })}><option value="Abstract">Abstract</option><option value="Tóm tắt">Tóm tắt</option></select></label>
      <label>Nội dung Abstract<textarea className="field" rows={7} maxLength={20000} value={settings.abstract || ''} onChange={event => onSettings({ ...settings, abstract: event.target.value })} placeholder="Mục tiêu, phương pháp, kết quả và đóng góp. Có thể bổ sung sau khi tạo tài liệu." /></label>
      <p className="studio-dialog-note">Tiêu đề luôn căn giữa, in đậm; nội dung căn đều hai bên. Abstract nằm sau tiêu đề, tác giả và ngày, trước mục lục và nội dung chính.</p>
    </>}
  </section>
}

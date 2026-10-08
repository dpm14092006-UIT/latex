/* global document, innerWidth */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { mkdir } from 'node:fs/promises'
const server = await createServer({server:{host:'127.0.0.1',port:0}})
await server.listen()
await mkdir('artifacts/noir-ui',{recursive:true})
const browser = await chromium.launch({headless:true})
try {
 const page = await browser.newPage({viewport:{width:1600,height:1000}})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
 await page.locator('.tiptap').waitFor()
 await page.getByRole('button',{name:'Soạn + PDF',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'Cập nhật PDF',exact:true}).isVisible(),false)
 await page.getByRole('button',{name:'Mở công cụ PDF',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'Cập nhật PDF',exact:true}).isVisible(),true)
 await page.getByRole('button',{name:'LaTeX',exact:true}).click()
 await page.locator('.cm-content').waitFor()
 await page.getByRole('button',{name:'Soạn + PDF',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'Cập nhật PDF',exact:true}).isVisible(),true)
 await page.getByRole('button',{name:'Thu gọn công cụ PDF',exact:true}).click()
 const stage = page.locator('.studio-paper-stage')
 const before = (await stage.boundingBox()).height
 await page.getByRole('button',{name:'Thu gọn công cụ soạn thảo',exact:true}).click()
 assert.ok((await stage.boundingBox()).height > before)
 await page.getByRole('button',{name:'Mở công cụ soạn thảo',exact:true}).click()
 assert.equal(await page.getByRole('toolbar',{name:'Công cụ soạn thảo',exact:true}).isVisible(),true)
 const toolbar = page.getByRole('toolbar',{name:'Công cụ soạn thảo',exact:true})
 for(const [label,count] of [['Cơ bản',11],['Trang chủ',25],['Chèn',11],['Tham chiếu',4],['Bố cục',2],['Xem',4]]){
  const tab = page.getByRole('button',{name:label,exact:true})
  if(await tab.getAttribute('aria-expanded')!=='true')await tab.click()
  assert.equal(await toolbar.locator('button:visible,select:visible').count(),count,`Original tools retained: ${label}`)
 }
 await page.getByRole('button',{name:'Cơ bản',exact:true}).click()
 for(const width of [1600,1366,1120,901,900,768,390]){
  await page.setViewportSize({width,height:1000})
  for(const placement of ['top','bottom']){
   const current=await page.locator('html').getAttribute('data-dock')
   if(current!==placement)await page.locator('.noir-dock-placement').click()
   await page.waitForTimeout(150)
   const box=await page.locator('.mono-modebar').boundingBox()
   assert.ok(box.x>=0&&box.x+box.width<=width+1)
   assert.ok(box.height<=35)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   const editor=await page.locator('section[aria-label="Soạn thảo tài liệu"]').boundingBox()
   assert.ok(placement==='top'?box.y+box.height<=editor.y:box.y>=editor.y+editor.height)
   const tabs = await page.locator('.project-tabs').boundingBox()
   if(placement==='top'&&width>=1100)assert.ok(tabs.x+tabs.width<=box.x)
   console.log(JSON.stringify({width,placement,dock:box.height,editorHeight:editor.height}))
   if(width===1600)await page.screenshot({path:`artifacts/noir-ui/${placement}.png`})
  }
 }
 await page.setViewportSize({width:1600,height:1000})
 await page.getByRole('button',{name:'Đặt thanh chế độ bên trên',exact:true}).click()
 await page.reload()
 await page.locator('.tiptap').waitFor()
 assert.equal(await page.locator('html').getAttribute('data-dock'),'top')
 await page.getByRole('button',{name:'Chế độ tập trung',exact:true}).click()
 assert.equal(await page.locator('.mono-modebar').count(),0)
 await page.getByRole('button',{name:'Mở lại giao diện',exact:true}).click()
 await page.getByRole('button',{name:'Soạn + PDF',exact:true}).click()
 await page.evaluate(()=>{
  const notice=document.createElement('div');notice.className='studio-trust-banner';notice.textContent='Kiểm tra bố cục cảnh báo'
  document.querySelector('.mono-shell').insertBefore(notice,document.querySelector('.mono-shell>.flex'))
 })
 const noticeBox=await page.locator('.studio-trust-banner').boundingBox()
 const dockBox=await page.locator('.mono-modebar').boundingBox()
 assert.ok(dockBox.y+dockBox.height<=noticeBox.y)
 assert.deepEqual(errors,[])
 console.log('Noir production UI passed: original six tool groups, collapse, PDF controls, dock persistence, focus, notices and seven widths.')
}finally{await browser.close();await server.close()}

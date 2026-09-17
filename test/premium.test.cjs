const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {randomBytes}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const ExcelJS=require('exceljs');

test('current prices, stock, category management, live events, archives and real XLSX work together',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'auren-premium-test-'));
 for(const file of ['server.js','mail-service.js','shop-features.js','order-export.js','node_modules'])fs.cpSync(path.resolve(__dirname,'..',file),path.join(temp,file),{recursive:true});
 const port=35000+Math.floor(Math.random()*15000),base=`http://127.0.0.1:${port}`,password=randomBytes(24).toString('hex');
 const child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port),ADMIN_PASSWORD:password,MAIL_ENABLED:'false',GMAIL_APP_PASSWORD:''},stdio:'ignore'});
 let db,cookie='',streamController;
 async function request(url,body,auth=true){const response=await fetch(base+url,{method:body?'POST':'GET',redirect:'manual',headers:{Accept:'application/json',...(auth&&cookie?{cookie}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:body?new URLSearchParams(body):undefined});return{status:response.status,text:await response.text(),headers:response.headers};}
 try{
  for(let i=0;i<60;i++){try{if((await request('/health')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  db=new DatabaseSync(path.join(temp,'data/shop.sqlite'));
  const login=await request('/admin/login',{password});cookie=login.headers.get('set-cookie').split(';')[0];
  const admin=await request('/admin');const csrf=admin.text.match(/name="csrf" value="([^"]+)"/)[1];
  let categoryId,productId,currentQuote,form,created;
  await t.test('category create and product save are protected and visible to customers',async()=>{
   assert.equal((await request('/admin/categories',{name:'Test Donlar',csrf:'bad'})).status,403);
   assert.equal((await request('/admin/categories',{name:'Test Donlar',csrf})).status,303);
   categoryId=db.prepare('SELECT id FROM categories WHERE name=?').get('Test Donlar').id;
   assert.equal((await request('/admin/products',{csrf,name:'Test don',description:'Test',category_id:categoryId,sizes:'S, M',stocks:JSON.stringify({S:3,M:4}),price_azn:'17'})).status,303);
   productId=db.prepare('SELECT id FROM products WHERE name=?').get('Test don').id;
   assert.match((await request('/?category='+categoryId)).text,/Test don/);
  });
  const basket=[{productId,size:'S',quantity:2}];
  await t.test('quantity combines by size, and overstock warns without creating orders',async()=>{
   const excess=JSON.parse((await request('/api/cart',{items:JSON.stringify([{productId,size:'S',quantity:4}])})).text);assert.equal(excess.valid,false);assert.match(excess.items[0].error,/3 ədəd/);
   assert.equal((await request('/api/cart',{items:JSON.stringify([null])})).status,400);
   const dup=JSON.parse((await request('/api/cart',{items:JSON.stringify([...basket,...basket])})).text);assert.equal(dup.items[0].quantity,4);assert.equal(dup.valid,false);
   currentQuote=JSON.parse((await request('/api/cart',{items:JSON.stringify(basket)})).text);assert.equal(currentQuote.totalAzn,34);assert.equal(currentQuote.totalUsd,20);
  });
  await t.test('new price rejects an outdated quote and preserves stock',async()=>{
   const checkout=await request('/checkout');const token=checkout.text.match(/name="checkout_token" value="([^"]+)"/)[1];
   form={customer_name:'=SUM(1,2)',phone:'0501234567',email:'test@example.com',address:'Test address',items:JSON.stringify(basket),quote_signature:currentQuote.signature,checkout_token:token};
   db.prepare('UPDATE products SET price_azn=25 WHERE id=?').run(productId);
   const rejected=await request('/checkout',form);assert.equal(rejected.status,409);assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,0);assert.equal(db.prepare("SELECT stock FROM product_variants WHERE product_id=? AND size='S'").get(productId).stock,3);
   currentQuote=JSON.parse(rejected.text).quote;assert.equal(currentQuote.totalAzn,50);form.quote_signature=currentQuote.signature;
  });
  await t.test('new order emits event; duplicate submission creates one order and one email',async()=>{
   streamController=new AbortController();const stream=await fetch(base+'/admin/events',{headers:{cookie},signal:streamController.signal});assert.equal(stream.headers.get('content-type'),'text/event-stream');
   const reader=stream.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/event: orders/);
   created=JSON.parse((await request('/checkout',form)).text);assert.ok(created.orderId);
   const event=await Promise.race([reader.read(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('No SSE update')),3000);timer.unref();})]);assert.match(new TextDecoder().decode(event.value),/data: 1/);
   streamController.abort();streamController=null;
   const repeat=JSON.parse((await request('/checkout',form)).text);assert.equal(repeat.orderId,created.orderId);assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM email_outbox').get().n,1);
   assert.equal(db.prepare("SELECT stock FROM product_variants WHERE product_id=? AND size='S'").get(productId).stock,1);
   const confirm=await request(created.location);assert.match(confirm.text,/Gözəl seçim etdiniz/);assert.match(confirm.text,/50.00/);
  });
  await t.test('price-only edit preserves stock sold while the admin form was open',async()=>{
   const response=await request('/admin/products',{csrf,id:productId,name:'Test don',description:'Test',category_id:categoryId,sizes:'S, M',stocks:JSON.stringify({S:3,M:4}),stock_snapshot:JSON.stringify({S:3,M:4}),price_azn:'30'});
   assert.equal(response.status,303);assert.equal(db.prepare("SELECT stock FROM product_variants WHERE product_id=? AND size='S'").get(productId).stock,1);
   assert.equal(db.prepare('SELECT total_azn FROM orders WHERE id=?').get(created.orderId).total_azn,50);
  });
  await t.test('delivered and cancelled leave active list and remain searchable in their tabs',async()=>{
   await request(`/admin/orders/${created.orderId}/status`,{csrf,status:'delivered'});
   const active=JSON.parse((await request('/admin/orders-fragment?view=active')).text);assert.doesNotMatch(active.html,/data-order-id="1"/);
   const archived=JSON.parse((await request('/admin/orders-fragment?view=delivered&q=0501234567')).text);assert.match(archived.html,/data-order-id="1"/);
   await request(`/admin/orders/${created.orderId}/status`,{csrf,status:'cancelled'});
   const cancelled=JSON.parse((await request('/admin/orders-fragment?view=cancelled')).text);assert.match(cancelled.html,/data-order-id="1"/);
  });
  await t.test('XLSX retains identifiers as text, real amounts/dates, item rows and cancelled totals',async()=>{
   const denied=await request('/admin/export.xlsx',undefined,false);assert.equal(denied.status,303);
   const response=await fetch(base+'/admin/export.xlsx',{headers:{cookie}});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/spreadsheetml.sheet/);
   const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);
   const sheet=workbook.getWorksheet('Sifarişlər');assert.equal(sheet.getCell('H9').value,50);assert.equal(sheet.getCell('D9').value,'0501234567');assert.equal(sheet.getCell('C9').value,'=SUM(1,2)');assert.equal(sheet.getCell('C9').type,ExcelJS.ValueType.String);assert.ok(sheet.getCell('B9').value instanceof Date);assert.equal(sheet.getCell('D5').value.result,50);
   // ExcelJS reads a cached numeric zero as undefined. Verify the actual XLSX XML.
   const zip=await require('jszip').loadAsync(bytes);const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');assert.match(xml,/<c r="D6"[^>]*><f>D4-D5<\/f><v>0<\/v><\/c>/);
   const detail=workbook.getWorksheet('Məhsul detalları');assert.equal(detail.getCell('E5').value,2);assert.equal(detail.getCell('G5').value,50);assert.equal(detail.getCell('C5').value,'Test Donlar');assert.ok(sheet.autoFilter);assert.equal(sheet.views[0].ySplit,8);
  });
 }finally{streamController?.abort();db?.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});

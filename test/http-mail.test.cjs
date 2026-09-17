const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {DatabaseSync}=require('node:sqlite');
const {randomBytes}=require('node:crypto');
const {Script}=require('node:vm');

test('HTTP checkout and changes persist mail events; unchanged status and failed checkout do not',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'auren-mail-test-'));
 const project=path.resolve(__dirname,'..');
 for(const name of ['server.js','mail-service.js','shop-features.js','order-export.js','node_modules'])fs.cpSync(path.join(project,name),path.join(temp,name),{recursive:true});
 const port=32000+Math.floor(Math.random()*20000),base=`http://127.0.0.1:${port}`,password=randomBytes(24).toString('hex');
 let child,db,cookie='';
 async function request(route,data){const response=await fetch(base+route,{method:data?'POST':'GET',redirect:'manual',headers:{...(cookie?{cookie}:{}),...(data?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:data?new URLSearchParams(data):undefined});return{status:response.status,headers:response.headers,text:await response.text()};}
 async function start(){child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port),ADMIN_PASSWORD:password,MAIL_ENABLED:'false',GMAIL_APP_PASSWORD:''},stdio:'ignore'});for(let i=0;i<60;i++){if(child.exitCode!==null)throw Error('Server exited');try{if((await request('/health')).status===200)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Server did not start');}
 async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
 try{
  await start();db=new DatabaseSync(path.join(temp,'data/shop.sqlite'));
  const t=new Date().toISOString();const pid=Number(db.prepare('INSERT INTO products(name,description,sizes,price_azn,is_active,created_at,updated_at)VALUES(?,?,?,?,?,?,?)').run('Test shirt','','["M"]',17,1,t,t).lastInsertRowid);
  db.prepare('INSERT INTO product_variants(product_id,size,stock)VALUES(?,?,?)').run(pid,'M',5);
  const login=await request('/admin/login',{password});assert.equal(login.status,303);cookie=login.headers.get('set-cookie').split(';')[0];
  const admin=await request('/admin');const csrf=admin.text.match(/name="csrf" value="([^"]+)"/)[1];
  const form={customer_name:'Mail test',phone:'0501234567',email:'customer@example.com',address:'Test address',items:JSON.stringify([{productId:pid,size:'M',quantity:1}])};
  const placed=await request('/checkout',form);assert.equal(placed.status,303);
  const oid=db.prepare('SELECT MAX(id) id FROM orders').get().id;
  const getJobs=()=>db.prepare('SELECT * FROM email_outbox ORDER BY id').all();
  assert.equal(getJobs().length,1);assert.equal(getJobs()[0].recipient,form.email);assert.equal(getJobs()[0].state,'pending');
  assert.match(getJobs()[0].body,/17\.00 AZN \/ 10\.00 USD/);
  assert.equal((await request(`/admin/orders/${oid}/status`,{csrf,status:'shipped'})).status,303);
  assert.equal(getJobs().length,2);assert.match(getJobs()[1].subject,/Göndərildi/);
  await request(`/admin/orders/${oid}/status`,{csrf,status:'shipped'});assert.equal(getJobs().length,2);
  assert.equal((await request(`/admin/orders/${oid}/status`,{csrf:'wrong',status:'delivered'})).status,403);assert.equal(getJobs().length,2);
  assert.equal((await request('/checkout',{...form,email:''})).status,400);assert.equal(getJobs().length,2);
  db.prepare('UPDATE product_variants SET stock=0 WHERE product_id=?').run(pid);
  assert.equal((await request('/orders',form)).status,409);assert.equal(getJobs().length,2);
  const settings=await request('/admin/settings');assert.equal(settings.status,200);assert.match(settings.text,/E-poçt bildirişləri/);assert.match(settings.text,/customer@example.com/);
  for(const source of [...settings.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]))new Script(source);
  db.close();db=null;await stop();await start();db=new DatabaseSync(path.join(temp,'data/shop.sqlite'));assert.equal(getJobs().length,2);assert.equal(getJobs()[0].state,'pending');
 }finally{if(db)db.close();await stop();assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});

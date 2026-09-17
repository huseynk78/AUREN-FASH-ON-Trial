const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createMailService}=require('../mail-service');
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE orders(id INTEGER PRIMARY KEY,customer_name TEXT,email TEXT,total_azn REAL,total_usd REAL);CREATE TABLE order_items(order_id INTEGER, id INTEGER,product_name TEXT,selected_size TEXT,quantity INTEGER,line_total_azn REAL);INSERT INTO orders VALUES(1,'Test','recipient@example.com',17,10);INSERT INTO order_items VALUES(1,1,'Shirt','M',1,17);`);
 return db;
}
const env={MAIL_ENABLED:'true',GMAIL_USER:'sender@gmail.com',GMAIL_APP_PASSWORD:'test-only-secret'};
test('one event produces one message addressed to the order email, using saved totals',async()=>{
 const db=fixture(),messages=[];
 const service=createMailService(db,{env,transport:{sendMail:async message=>{messages.push(message);return{accepted:[message.to]};}}});
 service.enqueue(1,'new','order-1');service.enqueue(1,'new','order-1');
 await service.drain();await service.drain();
 assert.equal(messages.length,1);assert.equal(messages[0].to,'recipient@example.com');assert.match(messages[0].text,/17\.00 AZN \/ 10\.00 USD/);
 assert.equal(service.recent()[0].state,'submitted');db.close();
});
test('failure preserves event, backs off, and survives service recreation',async()=>{
 const db=fixture();let time=1000;
 const service=createMailService(db,{env,clock:()=>time,transport:{sendMail:async()=>{const e=Error('DO NOT STORE PRIVATE PROVIDER RESPONSE');e.code='EAUTH';throw e;}}});
 service.enqueue(1,'shipped','status-1');await service.drain();
 assert.equal(service.recent()[0].attempts,1);assert.equal(service.recent()[0].last_error,'EAUTH');
 await service.drain();assert.equal(service.recent()[0].attempts,1);
 time+=60000;
 const restarted=createMailService(db,{env,clock:()=>time,transport:{sendMail:async()=>({accepted:['recipient@example.com']})}});
 await restarted.drain();assert.equal(restarted.recent()[0].state,'submitted');assert.equal(restarted.recent()[0].attempts,2);db.close();
});
test('five failures require explicit retry; disabled service does not send',async()=>{
 const db=fixture();let time=0;
 const service=createMailService(db,{env,clock:()=>time,transport:{sendMail:async()=>{throw Error('failure');}}});
 service.enqueue(1,'cancelled','status-2');
 for(let i=0;i<5;i++){await service.drain();time+=3600000;}
 assert.equal(service.recent()[0].state,'failed');assert.equal(service.retryFailed(),1);
 assert.equal(service.recent()[0].state,'pending');
 const disabled=createMailService(db,{env:{...env,MAIL_ENABLED:'false'},transport:{sendMail:async()=>assert.fail('disabled service sent mail')}});
 await disabled.drain();assert.equal(disabled.recent()[0].attempts,0);db.close();
});
test('rollback discards email event; missing recipient is recorded without sending',()=>{
 const db=fixture(),service=createMailService(db,{env:{}});
 db.exec('BEGIN');service.enqueue(1,'new','rolled-back');db.exec('ROLLBACK');assert.equal(service.recent().length,0);
 db.prepare("UPDATE orders SET email='' WHERE id=1").run();service.enqueue(1,'shipped','no-address');assert.equal(service.recent()[0].state,'skipped');db.close();
});

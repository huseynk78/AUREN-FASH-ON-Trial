'use strict';
const ExcelJS = require('exceljs');

async function buildOrderWorkbook(orders,items,labels){
  const workbook=new ExcelJS.Workbook();
  workbook.creator='AUREN FASHION';workbook.created=new Date();workbook.calcProperties.fullCalcOnLoad=true;
  const sheet=workbook.addWorksheet('Sifarişlər');
  sheet.views=[{state:'frozen',ySplit:8,xSplit:1,showGridLines:false}];
  const widths=[14,23,28,21,34,44,22,20,20,18,23];widths.forEach((w,i)=>sheet.getColumn(i+1).width=w);
  sheet.getCell('A2').value='AUREN FASHION · Sifariş hesabatı';sheet.mergeCells('A2:F2');sheet.getCell('A2').font={name:'Arial',size:16,bold:true,color:{argb:'FF352D27'}};
  sheet.getCell('A3').value='Sifariş sayı';sheet.getCell('D3').value=orders.length;
  sheet.getCell('A4').value='Bütün sifarişlər (AZN)';
  sheet.getCell('A5').value='Ləğv edilmiş (AZN)';
  sheet.getCell('A6').value='Qəbul Olunmuş (AZN)';sheet.getColumn(1).width=29;
  const first=9,last=Math.max(first,8+orders.length),total=orders.reduce((s,o)=>s+o.total_azn,0),cancelled=orders.filter(o=>o.status==='cancelled').reduce((s,o)=>s+o.total_azn,0);
  sheet.getCell('D4').value={formula:`SUM(H${first}:H${last})`,result:total};
  sheet.getCell('D5').value={formula:`SUMIFS(H${first}:H${last},G${first}:G${last},"${labels.cancelled}")`,result:cancelled};
  sheet.getCell('D6').value={formula:'D4-D5',result:total-cancelled};
  ['D4','D5','D6'].forEach(c=>sheet.getCell(c).numFmt='#,##0.00 "AZN"');
  sheet.getCell('F4').value='Məbləğlər sifariş zamanı qeydə alınmış qiymət və məzənnə əsasında göstərilir.';
  sheet.mergeCells('F4:K4');sheet.getCell('F4').alignment={wrapText:true,vertical:'middle'};sheet.getRow(4).height=30;
  sheet.getCell('F5').value='Bu məbləğlər faktiki alınmış ödəniş demək deyil. Tarixlər UTC vaxtındadır.';sheet.mergeCells('F5:K5');sheet.getCell('F5').alignment={wrapText:true};sheet.getRow(5).height=30;
  sheet.getRow(8).values=['Sifariş №','Tarix (UTC)','Müştəri','Telefon','E-poçt','Ünvan','Status','Məbləğ (AZN)','Məbləğ (USD)','1 USD üçün AZN','Yenilənmə (UTC)'];
  for(const o of orders){const row=sheet.addRow([o.id,new Date(o.created_at),o.customer_name,String(o.phone),o.email||'',o.address,labels[o.status]||o.status,o.total_azn,o.total_usd,o.exchange_rate,new Date(o.updated_at)]);row.height=36;row.getCell(2).numFmt='dd.mm.yyyy hh:mm';row.getCell(11).numFmt='dd.mm.yyyy hh:mm';row.getCell(4).numFmt='@';row.getCell(8).numFmt='#,##0.00 "AZN"';row.getCell(9).numFmt='#,##0.00 "USD"';row.getCell(10).numFmt='0.00';row.getCell(6).alignment={wrapText:true,vertical:'middle'};}
  sheet.autoFilter={from:{row:8,column:1},to:{row:last,column:11}};
  const detail=workbook.addWorksheet('Məhsul detalları');
  detail.views=[{state:'frozen',ySplit:4,xSplit:1,showGridLines:false}];
  [15,40,26,14,13,22,22,18,22].forEach((w,i)=>detail.getColumn(i+1).width=w);
  detail.getCell('A2').value='Sifariş olunan məhsullar';detail.mergeCells('A2:D2');detail.getCell('A2').font={name:'Arial',size:16,bold:true,color:{argb:'FF352D27'}};
  detail.getRow(4).values=['Sifariş №','Məhsul','Kateqoriya','Bədən','Ədəd','Vahid qiymət (AZN)','Sətir məbləği (AZN)','1 USD üçün AZN','Sətir məbləği (USD)'];
  for(const item of items){const row=detail.addRow([item.order_id,item.product_name,item.category_name||'Qeydə alınmayıb',item.selected_size,item.quantity,item.unit_price_azn,item.line_total_azn,item.exchange_rate,null]);row.getCell(9).value={formula:`G${row.number}/H${row.number}`,result:item.line_total_azn/item.exchange_rate};row.height=32;row.getCell(4).numFmt='@';row.getCell(5).numFmt='0';for(const col of [6,7])row.getCell(col).numFmt='#,##0.00 "AZN"';row.getCell(8).numFmt='0.00';row.getCell(9).numFmt='#,##0.00 "USD"';row.getCell(2).alignment={wrapText:true,vertical:'middle'};}
  detail.autoFilter={from:{row:4,column:1},to:{row:Math.max(5,4+items.length),column:9}};
  for(const [ws,header] of [[sheet,8],[detail,4]]){
    ws.eachRow((row,n)=>row.eachCell(cell=>{if(n!==2)cell.font={name:'Arial',size:11,color:{argb:'FF352D27'}};cell.alignment={...cell.alignment,vertical:'middle'};if(n>header&&n%2===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF8F4ED'}};}));
    ws.getRow(header).height=34;ws.getRow(header).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF463C32'}};cell.font={name:'Arial',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.alignment={wrapText:true,vertical:'middle'};});
    ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};ws.pageSetup.printTitlesRow=`${header}:${header}`;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
module.exports={buildOrderWorkbook};

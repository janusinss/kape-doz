param(
    [Parameter(Mandatory)][uri]$StaffUrl,
    [Parameter(Mandatory)][uri]$PortalUrl,
    [Parameter(Mandatory)][uri]$FixtureHubUrl,
    [switch]$Cancellation,
    [switch]$Refund,
    [switch]$Amendment,
    [switch]$TakeoutCorrection
)

$ErrorActionPreference='Stop'
if (-not $StaffUrl.IsLoopback -or -not $PortalUrl.IsLoopback -or -not $FixtureHubUrl.IsLoopback) {
    throw 'Use local staff and admin previews with an isolated synthetic hub.'
}
$priorTarget=$env:URL
$priorHub=$env:KAPE_DOZ_TEST_APPROVAL_HUB
$priorPortal=$env:KAPE_DOZ_TEST_APPROVAL_PORTAL
$priorScenario=$env:KAPE_DOZ_TEST_APPROVAL_SCENARIO
Push-Location (Join-Path $PSScriptRoot '..\..')
try {
    $env:URL=$StaffUrl.AbsoluteUri
    $env:KAPE_DOZ_TEST_APPROVAL_HUB=$FixtureHubUrl.GetLeftPart([UriPartial]::Authority)
    $env:KAPE_DOZ_TEST_APPROVAL_PORTAL=$PortalUrl.AbsoluteUri
    $env:KAPE_DOZ_TEST_APPROVAL_SCENARIO=if ($TakeoutCorrection) { 'takeout-correction' } elseif ($Amendment) { 'amendment' } elseif ($Refund) { 'refund' } elseif ($Cancellation) { 'cancellation' } else { 'discount' }
    $common=@'
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const target=await helpers.resolveTargetUrl();
assert.ok(target);
const hub=process.env.KAPE_DOZ_TEST_APPROVAL_HUB;
const portal=process.env.KAPE_DOZ_TEST_APPROVAL_PORTAL;
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
const watch=page=>{
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text()+' '+message.location().url);});
};
const button=(page,name)=>page.getByRole('button',{name,exact:true}).and(page.locator(':not([aria-disabled="true"]):not([disabled])'));
const text=(page,value)=>page.getByText(value,{exact:false}).last();
const field=(page,name)=>page.getByRole('textbox',{name,exact:true});
async function enter(page,name,value){
  for(let attempt=0;attempt<3;attempt++){
    await field(page,name).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(value);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const current=await field(page,name).inputValue().catch(()=>null);
    if(current===null||current===value) break;
  }
}
async function staff(role,pin){
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  watch(page);
  await page.goto(target,{waitUntil:'domcontentloaded'});
  const semantics=page.locator('flt-semantics-placeholder');
  await semantics.waitFor({state:'attached',timeout:45000});
  await semantics.dispatchEvent('click');
  await enter(page,'Hub address',hub);
  await enter(page,'Enrolled device ID','transport-'+role+'-tablet');
  await enter(page,'Device key','Transport-Fixture-Device-Secret-32!');
  await button(page,'Connect').click();
  await enter(page,'Account ID','transport-'+role);
  await enter(page,'PIN',pin);
  await button(page,'Sign in').click();
  return page;
}
async function responsive(page,name){
  for(const [width,height]of [[375,667],[768,1024],[1280,900]]){
    await page.setViewportSize({width,height});
    if(name.startsWith('cashier') && width<950){
      await page.getByRole('tab',{name:'Ticket',exact:true}).click();
      await page.waitForTimeout(250);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,name+' overflow '+width);
    await page.screenshot({path:'scratch/approval-'+name+'-'+width+'.png'});
  }
  console.log('PASS '+name+' layout 375/768/1280');
}
'@
    $takeoutAudit=@'
async function takeoutCorrectionJourney(){
  const cashier=await staff('cashier','4826');
  const request=(page,path,method='POST',query)=>{
    const response=page.waitForResponse(r=>{
      const url=new URL(r.url());
      return url.pathname===path&&r.request().method()===method&&(!query||url.searchParams.get('status')===query);
    },{timeout:30000});
    response.catch(()=>{});
    return response;
  };
  const body=async response=>{
    const reply=await response;
    const data=await reply.json();
    assert.equal(reply.status(),200,JSON.stringify(data));
    return data;
  };
  const post=async(page,path,action)=>{
    const response=request(page,path);
    await action();
    return body(response);
  };
  const press=(page,name,path)=>post(page,path,()=>button(page,name).click());
  const cmd={};
  await button(cashier,'Open shift').click();
  await enter(cashier,'Opening cash (PHP)','1000');
  const opened=await post(cashier,'/api/v1/shifts/open',()=>button(cashier,'Open shift').last().click());
  cmd.open=opened.commandId;
  const shiftId=opened.shift.id;
  const createTakeout=async(name,note)=>{
    await cashier.getByRole('button',{name:new RegExp(name+'.*Add')}).click();
    await enter(cashier,'Preparation note',note);
    await button(cashier,'Add to order').click();
    const takeout=cashier.getByRole('radio',{name:'Takeout',exact:true});
    if(await takeout.getAttribute('aria-checked')!=='true')await takeout.click();
    await takeout.and(cashier.locator('[aria-checked="true"]')).waitFor();
    const created=await press(cashier,'Create order','/api/v1/orders');
    assert.equal(created.order.dineIn,false);
    assert.equal(created.order.released,false);
    return created;
  };
  const created=await createTakeout('Fixture Latte','Original takeout');
  cmd.createOriginal=created.commandId;
  const original=created.order;
  const orderPath='/api/v1/orders/'+original.id;
  await button(cashier,'Take payment').click();
  await enter(cashier,'Cash received (PHP)','100');
  const first=await press(cashier,'Confirm payment',orderPath+'/payments');
  cmd.cashOriginal=first.commandId;
  assert.equal(first.order.released,false);
  assert.equal(first.payment.amountCentavos,10000);
  await text(cashier,'Remaining Ã¢â€šÂ±65.00').waitFor();
  await button(cashier,'Payment method Cash').click();
  await cashier.getByRole('menuitem',{name:'GCash',exact:true})
    .or(cashier.getByRole('button',{name:'GCash',exact:true})).first().click();
  await enter(cashier,'Payment amount (PHP)','65');
  await enter(cashier,'Merchant reference','SYNTHETIC-X02-PAYMENT');
  const pending=await press(cashier,'Record pending payment',orderPath+'/payments');
  cmd.pending= pending.commandId;
  assert.equal(pending.payment.status,'pending');
  assert.equal(pending.order.paidCentavos,10000);
  assert.equal(pending.order.releasedAt,null);
  await text(cashier,'Merchant verification is pending').waitFor();
  assert.equal(await button(cashier,'Print receipt').isEnabled(),false);
  await responsive(cashier,'x02-pending-tender');

  const barista=await staff('barista','5937');
  const pendingPoll=request(barista,'/api/v1/orders','GET','active');
  await button(barista,'Refresh').click();
  assert.equal((await body(pendingPoll)).orders.some(o=>o.id===original.id),false);
  await text(barista,'Active orders Ã‚Â· 0').waitFor();
  await button(cashier,'Verify pending payment').click();
  const verified=await press(cashier,'I verified success',orderPath+'/payments/'+pending.payment.id+'/verify');
  cmd.verify=verified.commandId;
  assert.equal(verified.payment.id,pending.payment.id);
  assert.equal(verified.payment.status,'confirmed');
  assert.equal(verified.order.paidCentavos,16500);
  assert.ok(verified.order.releasedAt);
  await button(cashier,'Return to cashier').click();
  await barista.bringToFront();
  await barista.getByRole('group',{name:new RegExp('Order #'+original.orderNo+' Ã‚Â· Takeout')}).waitFor();
  const prepare=request(barista,orderPath+'/prepare');
  await button(barista,'Start preparation').click();
  const prepareReply=await prepare;
  const preparation=await body(prepareReply);
  cmd.prepare=preparation.commandId;
  const baristaAuthorization=await prepareReply.request().headerValue('authorization');
  assert.ok(baristaAuthorization);
  console.log('PASS X02 original takeout withheld until exact split confirmation, then released to the barista');

  await button(cashier,'Refresh').click();
  await text(cashier,'Kitchen: preparing').waitFor();
  await button(cashier,'Change sent order').click();
  await text(cashier,'For a price change, use a manager-approved cancellation or refund').waitFor();
  assert.equal(await cashier.getByRole('button',{name:/^Change type/}).count(),0);
  await button(cashier,'Back').click();
  const requestCancellation=async reason=>{
    await button(cashier,'Request cancellation').click();
    await enter(cashier,'Reason for cancellation',reason);
    return press(cashier,'Send cancellation request',orderPath+'/approvals');
  };
  const firstRequest=await requestCancellation('Customer may choose a lower priced espresso');
  cmd.requestDenied=firstRequest.commandId;
  const manager=await browser.newPage({viewport:{width:1280,height:900}});
  watch(manager);
  await manager.goto(portal,{waitUntil:'domcontentloaded'});
  await manager.getByLabel('Account ID',{exact:true}).fill('transport-manager');
  await manager.getByLabel('Password',{exact:true}).fill('Transport-Fixture-Manager-Password!');
  await button(manager,'Sign in').click();
  const navigate=name=>manager.getByRole('navigation').getByRole('button',{name,exact:true}).click();
  await navigate('Approvals');
  await manager.getByLabel('Decision note',{exact:true}).fill('Wait for the customer to confirm the change');
  const denied=await press(manager,'Deny request','/api/v1/approvals/'+firstRequest.approval.id+'/decision');
  cmd.deny=denied.commandId;
  assert.equal(denied.approval.status,'denied');
  await button(cashier,'Refresh').click();
  await text(cashier,'Cancellation denied').waitFor();
  await barista.bringToFront();
  await button(barista,'Mark ready').waitFor();
  assert.equal(await button(barista,'Resolve cancellation').count(),0);
  const secondRequest=await requestCancellation('Customer confirmed the replacement espresso');
  cmd.requestApproved=secondRequest.commandId;
  await button(manager,'Refresh').click();
  await text(manager,'Customer confirmed the replacement espresso').waitFor();
  await responsive(manager,'x02-manager-cancellation');
  const approved=await press(manager,'Approve cancellation','/api/v1/approvals/'+secondRequest.approval.id+'/decision');
  cmd.cancel=approved.commandId;
  assert.equal(approved.approval.cancellationStatus,'awaiting_disposition');

  await barista.bringToFront();
  await button(barista,'Resolve cancellation').waitFor();
  assert.equal(await button(barista,'Mark ready').count(),0);
  cmd.staleReady=randomUUID();
  const stale=await barista.request.post(hub+orderPath+'/ready',{
    headers:{authorization:baristaAuthorization},
    data:{commandId:cmd.staleReady,expectedVersion:preparation.order.version},
  });
  assert.equal(stale.status(),409);
  await responsive(barista,'x02-station-cancelled');
  await button(barista,'Resolve cancellation').click();
  await barista.getByRole('radio',{name:'Ingredients used',exact:true}).click();
  await enter(barista,'Fixture espresso beans used (g)','9');
  await enter(barista,'Disposition note','9 g discarded before the drink was completed');
  const disposed=await press(barista,'Record disposition',orderPath+'/cancellation/disposition');
  cmd.disposition=disposed.commandId;
  assert.equal(disposed.order.cancellation.status,'resolved');
  assert.equal(disposed.order.cancellation.actualUsed[0].quantityMilli,9000);
  console.log('PASS X02 denied request preserved preparation; approved cancellation reached the station and rejected stale Ready');

  await button(cashier,'Refresh').click();
  await text(cashier,'Disposition recorded').waitFor();
  await button(cashier,'Request refund').click();
  const item=cashier.getByRole('checkbox',{name:/Fixture Latte/});
  await item.click();
  await item.and(cashier.locator('[aria-checked="true"]')).waitFor();
  await enter(cashier,'Refund amount (PHP)','165');
  await enter(cashier,'Reason for refund','Approved correction of the original paid takeout');
  const refundRequest=await press(cashier,'Send refund request',orderPath+'/refunds');
  cmd.requestRefund=refundRequest.commandId;
  const refund=refundRequest.refund;
  assert.deepEqual(refund.lines.map(line=>line.lineNo),[0]);
  await navigate('Refunds');
  await manager.getByLabel('Refund from Cash ('+first.payment.id+')',{exact:true}).fill('100');
  await manager.getByLabel('Refund from GCash ('+pending.payment.id+')',{exact:true}).fill('65');
  await responsive(manager,'x02-manager-refund');
  const refundPath='/api/v1/refunds/'+refund.id;
  const approvedRefund=await press(manager,'Approve refund allocation',refundPath+'/decision');
  cmd.approveRefund=approvedRefund.commandId;
  const cashLeg=approvedRefund.refund.legs.find(leg=>leg.method==='cash');
  const gcashLeg=approvedRefund.refund.legs.find(leg=>leg.method==='gcash');
  await button(cashier,'Refresh').click();
  await button(cashier,'Record cash payout').click();
  const cashPayout=await press(cashier,'Record cash handed back',refundPath+'/legs/'+cashLeg.id);
  cmd.cashPayout=cashPayout.commandId;
  await manager.getByRole('combobox',{name:'Refund status',exact:true}).selectOption('approved');
  const external=manager.getByRole('listitem',{name:'GCash refund '+gcashLeg.id,exact:true});
  await external.getByRole('combobox',{name:'Refund payout action',exact:true}).selectOption('confirm_external');
  await external.getByLabel('Refund review note',{exact:true}).fill('Synthetic merchant refund record reviewed');
  await external.getByLabel('Verified refund reference',{exact:true}).fill('SYNTHETIC-X02-REFUND');
  const externalPayout=await post(manager,refundPath+'/legs/'+gcashLeg.id,()=>external.getByRole('button',{name:'Save payout review',exact:true}).click());
  cmd.externalPayout=externalPayout.commandId;
  await button(cashier,'Refresh').click();
  await text(cashier,'Refunded Ã¢â€šÂ±165.00').waitFor();

  await button(cashier,'+ New order').click();
  const replacement=await createTakeout('Fixture Espresso','Replacement takeout');
  cmd.createReplacement=replacement.commandId;
  assert.notEqual(replacement.order.id,original.id);
  assert.equal(replacement.order.totalCentavos,9000);
  const replacementPath='/api/v1/orders/'+replacement.order.id;
  await button(cashier,'Take payment').click();
  await enter(cashier,'Cash received (PHP)','90');
  const replacementPaid=await press(cashier,'Confirm payment',replacementPath+'/payments');
  cmd.payReplacement=replacementPaid.commandId;
  assert.equal(replacementPaid.order.paidCentavos,9000);
  await button(cashier,'Return to cashier').click();
  await barista.bringToFront();
  const replacementCard=barista.getByRole('group',{name:new RegExp('Order #'+replacement.order.orderNo+' Ã‚Â· Takeout')});
  await replacementCard.waitFor();
  const ready=await post(barista,replacementPath+'/ready',()=>replacementCard.getByRole('button',{name:'Mark ready',exact:true}).click());
  cmd.readyReplacement=ready.commandId;
  assert.equal(ready.order.ready,true);
  await text(barista,'Active orders Ã‚Â· 0').waitFor();
  await navigate('Sales & margin');
  const metric=name=>manager.getByText(name,{exact:true}).locator('..').locator('dd');
  for(const [name,amount] of [['Captured settled sales','Ã¢â€šÂ±255.00'],['Confirmed sales refunds','Ã¢â€šÂ±165.00'],['Final ingredient cost','Ã¢â€šÂ±7.20'],['Waste and dial-in cost','Ã¢â€šÂ±7.20']]){
    await metric(name).filter({hasText:amount}).waitFor();
    assert.equal(await metric(name).textContent(),amount);
  }
  await manager.getByRole('region',{name:'Sales by day',exact:true}).locator('.sales-value').filter({hasText:/^Ã¢â€šÂ±90\.00$/}).waitFor();
  await responsive(manager,'x02-sales');
  await button(cashier,'Shift closing').click();
  await enter(cashier,'Counted cash (PHP)','1090');
  cmd.count=(await press(cashier,'Submit count','/api/v1/shifts/'+shiftId+'/submit-count')).commandId;
  await navigate('Shift review');
  cmd.close=(await press(manager,'Approve close','/api/v1/shifts/'+shiftId+'/review')).commandId;
  await text(manager,'Shift closed.').waitFor();
  for(const page of [cashier,barista,manager])await button(page,'Sign out').click();
  await button(cashier,'Sign in').waitFor();
  await button(barista,'Sign in').waitFor();
  await manager.getByRole('heading',{name:'Administrator sign-in',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS X02 paid takeout correction through split refund, separate replacement, reporting and drawer closure '+JSON.stringify({originalId:original.id,replacementId:replacement.order.id,deniedApprovalId:firstRequest.approval.id,approvedApprovalId:secondRequest.approval.id,refundId:refund.id,cashPaymentId:first.payment.id,gcashPaymentId:pending.payment.id,replacementPaymentId:replacementPaid.payment.id,cashLegId:cashLeg.id,gcashLegId:gcashLeg.id,shiftId,cmd}));
}
await takeoutCorrectionJourney();
'@
    $approvalAudit=@'
async function amendmentJourney(){
  const cashier=await staff('cashier','4826');
  const posted=(page,path)=>{
    const response=page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST',{timeout:30000});
    response.catch(()=>{});
    return response;
  };
  async function read(response){
    const reply=await response;
    const body=await reply.json();
    assert.equal(reply.status(),200,JSON.stringify(body));
    return body;
  }
  await button(cashier,'Open shift').click();
  await enter(cashier,'Opening cash (PHP)','1000');
  const opening=posted(cashier,'/api/v1/shifts/open');
  await button(cashier,'Open shift').last().click();
  const {shift}=await read(opening);
  await cashier.getByRole('button',{name:/Fixture Latte.*Add/}).click();
  await button(cashier,'Increase quantity').click();
  await enter(cashier,'Preparation note','Before the change');
  await button(cashier,'Add to order').click();
  const created=posted(cashier,'/api/v1/orders');
  await button(cashier,'Create order').click();
  const {order}=await read(created);
  assert.equal(order.lines[0].quantity,2);
  const orderPath='/api/v1/orders/'+order.id;
  const sending=posted(cashier,orderPath+'/send');
  await button(cashier,'Send to bar').click();
  const sent=await read(sending);
  const barista=await staff('barista','5937');
  const starting=posted(barista,orderPath+'/prepare');
  await button(barista,'Start preparation').click();
  await read(starting);
  await button(cashier,'Refresh').click();
  await text(cashier,'Kitchen: preparing').waitFor();
  await button(cashier,'Change sent order').click();
  await cashier.getByRole('button',{name:/^Change type/}).click();
  await cashier.getByRole('menuitem',{name:'Change quantity',exact:true}).click();
  await enter(cashier,'Reason for change','Customer needs one latte');
  await field(cashier,'Quantity').click();
  await cashier.keyboard.press('Control+A');
  await cashier.keyboard.press('Backspace');
  await cashier.keyboard.press('1');
  await button(cashier,'Send for approval').waitFor();
  const request=posted(cashier,orderPath+'/amendments');
  await button(cashier,'Send for approval').click();
  const requested=await read(request);
  const amendment=requested.amendment;
  assert.equal(amendment.status,'awaiting_approval');
  assert.equal(amendment.totalBeforeCentavos,33000);
  assert.equal(amendment.totalAfterCentavos,16500);
  await text(cashier,'Change awaiting manager approval').waitFor();
  await responsive(cashier,'cashier-amendment-request');

  const manager=await browser.newPage({viewport:{width:1280,height:900}});
  watch(manager);
  await manager.goto(portal,{waitUntil:'domcontentloaded'});
  await manager.getByLabel('Account ID',{exact:true}).fill('transport-manager');
  await manager.getByLabel('Password',{exact:true}).fill('Transport-Fixture-Manager-Password!');
  await button(manager,'Sign in').click();
  const navigate=name=>manager.getByRole('navigation').getByRole('button',{name,exact:true}).click();
  await navigate('Approvals');
  await button(manager,'Approve item change').waitFor();
  await text(manager,'Customer needs one latte').waitFor();
  await responsive(manager,'amendment-manager-pending');
  await manager.getByLabel('Decision note',{exact:true}).fill('Approved the removal of one drink');
  const decision=posted(manager,'/api/v1/amendments/'+amendment.id+'/decision');
  await button(manager,'Approve item change').click();
  const approved=await read(decision);
  assert.equal(approved.amendment.status,'awaiting_station');
  assert.equal(approved.amendment.appliedAt,null);
  assert.equal(approved.amendment.recipe[0].quantityMilli,18000);
  await button(cashier,'Refresh').click();
  await text(cashier,'The station must review the order change before payment.').waitFor();
  assert.equal(await button(cashier,'Take payment').isEnabled(),false);

  await barista.bringToFront();
  await button(barista,'Review order change').waitFor();
  assert.equal(await button(barista,'Mark ready').count(),0);
  await responsive(barista,'amendment-station-notified');
  await button(barista,'Review order change').click();
  await barista.getByRole('button',{name:/^Preparation disposition/}).click();
  await barista.getByRole('menuitem',{name:'Ingredients discarded',exact:true}).click();
  await enter(barista,'Fixture espresso beans discarded (g)','9');
  await enter(barista,'Disposition note','Discarded 9 g while changing preparation');
  await responsive(barista,'amendment-station-disposition');
  const acknowledgment=posted(barista,orderPath+'/amendments/'+amendment.id+'/acknowledge');
  await button(barista,'Acknowledge change').click();
  const acknowledged=await read(acknowledgment);
  assert.equal(acknowledged.amendment.status,'resolved');
  assert.equal(acknowledged.amendment.before.quantity,2);
  assert.equal(acknowledged.amendment.after.quantity,1);
  assert.equal(acknowledged.amendment.after.unitPriceCentavos,undefined);
  assert.equal(acknowledged.amendment.totalAfterCentavos,undefined);
  const readiness=posted(barista,orderPath+'/ready');
  await button(barista,'Mark ready').click();
  const ready=await read(readiness);
  assert.equal(ready.order.ready,true);
  assert.equal(ready.order.lines[0].quantity,1);
  await button(cashier,'Refresh').click();
  await text(cashier,'Kitchen: ready').waitFor();
  await button(cashier,'Take payment').waitFor();
  await button(cashier,'Take payment').click();
  await enter(cashier,'Cash received (PHP)','200');
  const payment=posted(cashier,orderPath+'/payments');
  await button(cashier,'Confirm payment').click();
  const paid=await read(payment);
  assert.equal(paid.order.paidCentavos,16500);
  assert.equal(paid.payment.changeCentavos,3500);
  assert.equal(paid.order.releasedAt,sent.order.releasedAt);
  await button(cashier,'Print receipt').waitFor();
  await button(cashier,'Return to cashier').click();
  await navigate('Sales & margin');
  const metric=name=>manager.getByText(name,{exact:true}).locator('..').locator('dd');
  await metric('Waste and dial-in cost').filter({hasText:'Ã¢â€šÂ±7.20'}).waitFor();
  assert.equal(await metric('Waste and dial-in cost').textContent(),'Ã¢â€šÂ±7.20');
  await button(cashier,'Shift closing').click();
  await enter(cashier,'Counted cash (PHP)','1165');
  const count=posted(cashier,'/api/v1/shifts/'+shift.id+'/submit-count');
  await button(cashier,'Submit count').click();
  await read(count);
  await navigate('Shift review');
  await button(manager,'Approve close').click();
  await text(manager,'Shift closed.').waitFor();
  await button(manager,'Sign out').click();
  await button(cashier,'Sign out').click();
  await button(barista,'Sign out').click();
  assert.deepEqual(errors,[]);
  console.log('PASS cashier, manager and station amendment, 9 g waste, revised settlement and drawer closure '+JSON.stringify({orderId:order.id,amendmentId:amendment.id,requestId:requested.commandId,decisionId:approved.commandId,acknowledgmentId:acknowledged.commandId,readyId:ready.commandId,shiftId:shift.id}));
}
async function cancellationJourney(){
  const cashier=await staff('cashier','4826');
  await cashier.getByRole('button',{name:/Fixture Latte.*Add/}).click();
  await enter(cashier,'Preparation note','Synthetic cancellation rehearsal');
  await button(cashier,'Add to order').click();
  const orderSaved=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
  await button(cashier,'Create order').click();
  const orderResponse=await orderSaved;
  assert.equal(orderResponse.status(),200);
  const {order}=await orderResponse.json();
  await button(cashier,'Send to bar').click();
  const barista=await staff('barista','5937');
  await button(barista,'Start preparation').click();
  await barista.getByRole('group',{name:/Order #.*Preparing/}).waitFor();
  await button(cashier,'Refresh').click();
  await text(cashier,'Kitchen: preparing').waitFor();
  await button(cashier,'Request cancellation').click();
  await enter(cashier,'Reason for cancellation','Synthetic customer cancelled');
  const requested=cashier.waitForResponse(r=>r.url().endsWith('/approvals')&&r.request().method()==='POST');
  await button(cashier,'Send cancellation request').click();
  const requestResponse=await requested;
  assert.equal(requestResponse.status(),200);
  const {approval}=await requestResponse.json();
  assert.equal(approval.requestedKitchenState,'preparing');
  await text(cashier,'Cancellation awaiting approval').waitFor();
  const manager=await browser.newPage({viewport:{width:1280,height:900}});
  watch(manager);
  await manager.goto(portal,{waitUntil:'domcontentloaded'});
  await manager.getByLabel('Account ID',{exact:true}).fill('transport-manager');
  await manager.getByLabel('Password',{exact:true}).fill('Transport-Fixture-Manager-Password!');
  await button(manager,'Sign in').click();
  const navigate=name=>manager.getByRole('navigation').getByRole('button',{name,exact:true}).click();
  await navigate('Approvals');
  await button(manager,'Approve cancellation').waitFor();
  await text(manager,'Synthetic customer cancelled').waitFor();
  await responsive(manager,'cancellation-manager-pending');
  const decision=manager.waitForResponse(r=>r.url().endsWith('/approvals/'+approval.id+'/decision')&&r.request().method()==='POST');
  await button(manager,'Approve cancellation').click();
  const accepted=await decision;
  assert.equal(accepted.status(),200);
  assert.equal((await accepted.json()).approval.cancellationStatus,'awaiting_disposition');
  await text(manager,'Cancellation approved and order stopped.').waitFor();
  await button(cashier,'Refresh').click();
  await text(cashier,'Order cancelled').waitFor();
  assert.equal(await button(cashier,'Take payment').count(),0);
  await responsive(cashier,'cashier-cancellation');
  // The station receives the change through polling without manual Refresh.
  await barista.bringToFront();
  await button(barista,'Resolve cancellation').waitFor();
  assert.equal(await button(barista,'Mark ready').count(),0);
  await responsive(barista,'cancellation-station');
  await navigate('Sales & margin');
  await manager.getByRole('region',{name:'Cost and profit'}).waitFor();
  const metric=name=>manager.getByText(name,{exact:true}).locator('..').locator('dd');
  assert.equal(await metric('Estimated operating profit').textContent(),'Unavailable');
  await button(barista,'Resolve cancellation').click();
  await barista.getByRole('radio',{name:'Ingredients used',exact:true}).click();
  await enter(barista,'Fixture espresso beans used (g)','9');
  await enter(barista,'Disposition note','Synthetic 9 g partial preparation');
  const recorded=barista.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order.id+'/cancellation/disposition'&&r.request().method()==='POST');
  await button(barista,'Record disposition').click();
  const outcome=await recorded;
  assert.equal(outcome.status(),200);
  const {order:resolved}=await outcome.json();
  assert.equal(resolved.cancellation.status,'resolved');
  assert.equal(resolved.cancellation.actualUsed[0].quantityMilli,9000);
  await button(barista,'Resolve cancellation').waitFor({state:'hidden'});
  await button(cashier,'Refresh').click();
  await text(cashier,'Disposition recorded').waitFor();
  await button(manager,'Refresh').click();
  await metric('Waste and dial-in cost').filter({hasText:'Ã¢â€šÂ±7.20'}).waitFor();
  assert.equal(await metric('Waste and dial-in cost').textContent(),'Ã¢â€šÂ±7.20');
  await navigate('Approvals');
  await manager.getByRole('combobox',{name:'Status',exact:true}).selectOption('approved');
  await manager.getByRole('complementary',{name:'Selected approval'}).getByText('Resolved',{exact:true}).waitFor();
  await button(cashier,'Sign out').click();
  await button(barista,'Sign out').click();
  await button(manager,'Sign out').click();
  assert.deepEqual(errors,[]);
  console.log('PASS cancellation poll, stopped checkout and preparation, actual 9 g waste at Ã¢â€šÂ±7.20, resolved portal and sign-out '+JSON.stringify({orderId:order.id,approvalId:approval.id}));
}
async function refundJourney(){
  const cashier=await staff('cashier','4826');
  await button(cashier,'Open shift').click();
  await enter(cashier,'Opening cash (PHP)','1000');
  await button(cashier,'Open shift').last().click();
  await button(cashier,'Shift closing').waitFor();
  await cashier.getByRole('button',{name:/Fixture Latte.*Add/}).click();
  await enter(cashier,'Preparation note','Synthetic refund rehearsal');
  await button(cashier,'Add to order').click();
  const created=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
  await button(cashier,'Create order').click();
  const creation=await created;
  assert.equal(creation.status(),200);
  const {order}=await creation.json();
  await button(cashier,'Take payment').click();
  await enter(cashier,'Cash received (PHP)','100');
  const firstPayment=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order.id+'/payments'&&r.request().method()==='POST');
  await button(cashier,'Confirm payment').click();
  const cashResponse=await firstPayment;
  assert.equal(cashResponse.status(),200);
  const cashPayment=(await cashResponse.json()).payment;
  await text(cashier,'Remaining Ã¢â€šÂ±65.00').waitFor();
  await button(cashier,'Payment method Cash').click();
  await cashier.getByRole('button',{name:'GCash',exact:true})
    .or(cashier.getByText('GCash',{exact:true})).or(cashier.getByLabel('GCash',{exact:true})).first().click();
  await enter(cashier,'Payment amount (PHP)','65');
  await enter(cashier,'Merchant reference','SYNTHETIC-REFUND-SALE');
  await cashier.getByRole('checkbox').click();
  await cashier.getByRole('checkbox').and(cashier.locator('[aria-checked="true"]')).waitFor();
  const secondPayment=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order.id+'/payments'&&r.request().method()==='POST');
  await button(cashier,'Confirm payment').click();
  const externalResponse=await secondPayment;
  assert.equal(externalResponse.status(),200);
  const externalPayment=(await externalResponse.json()).payment;
  await button(cashier,'Return to cashier').click();
  const barista=await staff('barista','5937');
  await button(barista,'Mark ready').click();
  await text(barista,'Active orders Ã‚Â· 0').waitFor();
  await button(cashier,'Refresh').click();
  await button(cashier,'Request refund').click();
  await cashier.getByRole('checkbox',{name:/Fixture Latte/}).click();
  await cashier.getByRole('checkbox',{name:/Fixture Latte/}).and(cashier.locator('[aria-checked="true"]')).waitFor();
  await enter(cashier,'Refund amount (PHP)','50');
  await enter(cashier,'Reason for refund','Synthetic service adjustment');
  const requested=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order.id+'/refunds'&&r.request().method()==='POST');
  await button(cashier,'Send refund request').click();
  const requestResponse=await requested;
  assert.equal(requestResponse.status(),200);
  const {refund}=await requestResponse.json();
  assert.deepEqual(refund.lines.map(line=>line.lineNo),[0]);
  await text(cashier,'Refund awaiting approval').waitFor();
  await responsive(cashier,'cashier-refund-request');
  const manager=await browser.newPage({viewport:{width:1280,height:900}});
  watch(manager);
  await manager.goto(portal,{waitUntil:'domcontentloaded'});
  await manager.getByLabel('Account ID',{exact:true}).fill('transport-manager');
  await manager.getByLabel('Password',{exact:true}).fill('Transport-Fixture-Manager-Password!');
  await button(manager,'Sign in').click();
  const navigate=name=>manager.getByRole('navigation').getByRole('button',{name,exact:true}).click();
  await navigate('Refunds');
  await manager.getByLabel('Refund from Cash ('+cashPayment.id+')',{exact:true}).fill('20');
  await manager.getByLabel('Refund from GCash ('+externalPayment.id+')',{exact:true}).fill('30');
  await responsive(manager,'refund-manager-allocation');
  const approved=manager.waitForResponse(r=>r.url().endsWith('/refunds/'+refund.id+'/decision')&&r.request().method()==='POST');
  await button(manager,'Approve refund allocation').click();
  const approvalResponse=await approved;
  assert.equal(approvalResponse.status(),200);
  const approvedRefund=(await approvalResponse.json()).refund;
  const externalLeg=approvedRefund.legs.find(leg=>leg.method==='gcash');
  const cashLeg=approvedRefund.legs.find(leg=>leg.method==='cash');
  await manager.getByRole('combobox',{name:'Refund status',exact:true}).selectOption('approved');
  await button(cashier,'Refresh').click();
  await cashier.getByRole('group',{name:/^Refund approved/}).waitFor();
  // Close the selling shift before opening the shift that pays the refund.
  await button(cashier,'Shift closing').click();
  await enter(cashier,'Counted cash (PHP)','1100');
  const counted=cashier.waitForResponse(r=>r.url().endsWith('/submit-count')&&r.request().method()==='POST');
  await button(cashier,'Submit count').click();
  assert.equal((await counted).status(),200);
  await navigate('Shift review');
  await button(manager,'Approve close').click();
  await text(manager,'Shift closed.').waitFor();
  await button(cashier,'Refresh').click();
  await button(cashier,'Open shift').click();
  await enter(cashier,'Opening cash (PHP)','1000');
  await button(cashier,'Open shift').last().click();
  await button(cashier,'Record cash payout').click();
  const paidBack=cashier.waitForResponse(r=>r.url().endsWith('/refunds/'+refund.id+'/legs/'+cashLeg.id)&&r.request().method()==='POST');
  await button(cashier,'Record cash handed back').click();
  assert.equal((await paidBack).status(),200);
  await text(cashier,'Refunded Ã¢â€šÂ±20.00').waitFor();
  await navigate('Refunds');
  await manager.getByRole('combobox',{name:'Refund status',exact:true}).selectOption('approved');
  const external=()=>manager.getByRole('listitem',{name:'GCash refund '+externalLeg.id,exact:true});
  const recordExternal=async(action,note,reference)=>{
    await external().getByRole('combobox',{name:'Refund payout action',exact:true}).selectOption(action);
    await external().getByLabel('Refund review note',{exact:true}).fill(note);
    if(reference)await external().getByLabel('Verified refund reference',{exact:true}).fill(reference);
    const saved=manager.waitForResponse(r=>r.url().endsWith('/refunds/'+refund.id+'/legs/'+externalLeg.id)&&r.request().method()==='POST');
    await external().getByRole('button',{name:'Save payout review',exact:true}).click();
    assert.equal((await saved).status(),200);
  };
  await recordExternal('mark_unknown','Synthetic merchant evidence pending');
  await external().getByText('Outcome unknown',{exact:true}).waitFor();
  await responsive(manager,'refund-manager-unknown');
  await recordExternal('confirm_external','Synthetic merchant refund verified','SYNTHETIC-REFUND-CONFIRMED');
  await external().getByText('Completed',{exact:true}).first().waitFor();
  await button(cashier,'Refresh').click();
  await cashier.getByRole('group',{name:/^Refund completed/})
    .or(cashier.getByText('Refund completed',{exact:false})).last().waitFor();
  await text(cashier,'Refunded Ã¢â€šÂ±50.00').waitFor();
  await responsive(cashier,'cashier-refund-completed');
  await navigate('Sales & margin');
  const metric=name=>manager.getByText(name,{exact:true}).locator('..').locator('dd');
  await manager.getByRole('region',{name:'Cost and profit'}).waitFor();
  assert.equal(await metric('Confirmed sales refunds').textContent(),'Ã¢â€šÂ±50.00');
  await responsive(manager,'refund-manager-sales');
  await button(cashier,'Shift closing').click();
  await enter(cashier,'Counted cash (PHP)','980');
  const closedCount=cashier.waitForResponse(r=>r.url().endsWith('/submit-count')&&r.request().method()==='POST');
  await button(cashier,'Submit count').click();
  assert.equal((await closedCount).status(),200);
  await navigate('Shift review');
  await button(manager,'Approve close').click();
  await text(manager,'Shift closed.').waitFor();
  await button(cashier,'Sign out').click();
  await button(barista,'Sign out').click();
  await button(manager,'Sign out').click();
  await button(cashier,'Sign in').waitFor();
  await button(barista,'Sign in').waitFor();
  await manager.getByRole('heading',{name:'Administrator sign-in',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS refund50 from cash20 and GCash30, unknown external reconciled, later paying shift980, original shift1100, role sign-out '+JSON.stringify({orderId:order.id,refundId:refund.id,cashLegId:cashLeg.id,externalLegId:externalLeg.id}));
}
  if(process.env.KAPE_DOZ_TEST_APPROVAL_SCENARIO==='amendment'){
    await amendmentJourney();
  }else if(process.env.KAPE_DOZ_TEST_APPROVAL_SCENARIO==='refund'){
    await refundJourney();
  }else if(process.env.KAPE_DOZ_TEST_APPROVAL_SCENARIO==='cancellation'){
    await cancellationJourney();
  }else{
  const cashier=await staff('cashier','4826');
  await cashier.getByRole('button',{name:/^(Open shift|Shift closing)$/}).waitFor();
  if(await button(cashier,'Open shift').count()){
    await button(cashier,'Open shift').click();
    await enter(cashier,'Opening cash (PHP)','1000');
    await button(cashier,'Open shift').last().click();
  }
  await button(cashier,'Shift closing').waitFor();
  const create=async(note)=>{
    if(await button(cashier,'+ New order').count())await button(cashier,'+ New order').click();
    await cashier.getByRole('button',{name:/Fixture Latte.*Add/}).click();
    await enter(cashier,'Preparation note',note);
    await button(cashier,'Add to order').click();
    const saving=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
    await button(cashier,'Create order').click();
    const response=await saving;
    assert.equal(response.status(),200);
    return (await response.json()).order;
  };
  const request=async(amount,reason)=>{
    await button(cashier,'Request discount').click();
    await enter(cashier,'Discount amount (PHP)',amount);
    await enter(cashier,'Reason for discount',reason);
    const saving=cashier.waitForResponse(r=>r.url().endsWith('/approvals')&&r.request().method()==='POST');
    await button(cashier,'Send request').click();
    const response=await saving;
    assert.equal(response.status(),200);
    await text(cashier,'Discount awaiting approval').waitFor();
    return (await response.json()).approval;
  };
  const order=await create('Less sweet, synthetic approval rehearsal');
  await request('5.00','Synthetic denial request');
  await responsive(cashier,'cashier-pending');
  const manager=await browser.newPage({viewport:{width:1280,height:900}});
  watch(manager);
  await manager.goto(portal,{waitUntil:'domcontentloaded'});
  await manager.getByLabel('Account ID',{exact:true}).fill('transport-manager');
  await manager.getByLabel('Password',{exact:true}).fill('Transport-Fixture-Manager-Password!');
  const login=manager.waitForResponse(r=>r.url().endsWith('/api/v1/auth/admin')&&r.request().method()==='POST');
  await button(manager,'Sign in').click();
  const signed=await login;
  assert.equal(signed.status(),200);
  const managerToken=(await signed.json()).token;
  await manager.getByRole('navigation').getByRole('button',{name:'Approvals',exact:true}).click();
  await manager.getByRole('heading',{name:'Order #'+order.orderNo,exact:true}).waitFor();
  await text(manager,'Synthetic denial request').waitFor();
  await manager.getByLabel('Decision note',{exact:true}).fill('Synthetic policy restriction');
  await button(manager,'Deny request').click();
  await text(manager,'Discount request denied.').waitFor();
  await button(cashier,'Refresh').click();
  await text(cashier,'Discount denied').waitFor();
  await text(cashier,'Synthetic policy restriction').waitFor();
  const stale=await request('5.00','Synthetic stale version');
  await button(cashier,'Send to bar').click();
  await text(cashier,'Discount request expired').waitFor();
  await button(manager,'Refresh').click();
  await manager.getByRole('combobox',{name:'Status',exact:true}).selectOption('stale');
  await text(manager,'Synthetic stale version').waitFor();
  assert.equal(await button(manager,'Approve discount').count(),0);
  const refused=await manager.request.post(hub+'/api/v1/approvals/'+stale.id+'/decision',{headers:{Authorization:'Bearer '+managerToken},data:{commandId:randomUUID(),decision:'approve'}});
  assert.equal(refused.status(),409);
  console.log('PASS visible denial and stale order version with server-side refusal');
  const approval=await request('15.00','Synthetic service recovery');
  await button(manager,'Refresh').click();
  await manager.getByRole('combobox',{name:'Status',exact:true}).selectOption('pending');
  await text(manager,'Synthetic service recovery').waitFor();
  await responsive(manager,'manager-pending');
  const decision=manager.waitForResponse(r=>r.url().endsWith('/approvals/'+approval.id+'/decision')&&r.request().method()==='POST');
  await button(manager,'Approve discount').click();
  assert.equal((await decision).status(),200);
  await text(manager,'Discount approved and applied to the order.').waitFor();
  await button(cashier,'Refresh').click();
  await text(cashier,'Discount approved').waitFor();
  await text(cashier,'Discount Ã¢Ë†â€™Ã¢â€šÂ±15.00').waitFor();
  await responsive(cashier,'cashier-approved');
  await button(cashier,'Take payment').click();
  await field(cashier,'Cash received (PHP)').waitFor();
  await enter(cashier,'Cash received (PHP)','200');
  const settlement=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order.id+'/payments'&&r.request().method()==='POST');
  await button(cashier,'Confirm payment').click();
  const settled=await settlement;
  assert.equal(settled.status(),200);
  const paid=await settled.json();
  assert.equal(paid.order.totalCentavos,15000);
  assert.equal(paid.payment.changeCentavos,5000);
  await button(cashier,'Print receipt').waitFor();
  const receipt=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order.id+'/receipt'&&r.request().method()==='POST');
  await button(cashier,'Print receipt').click();
  assert.equal((await receipt).status(),200);
  await button(cashier,'Return to cashier').click();
  const barista=await staff('barista','5937');
  await text(barista,'Active orders Ã‚Â· 1').waitFor();
  await text(barista,'1 Ãƒâ€” Fixture Latte').waitFor();
  await text(barista,'Less sweet, synthetic approval rehearsal').waitFor();
  const ready=barista.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order.id+'/ready'&&r.request().method()==='POST');
  await button(barista,'Mark ready').click();
  assert.equal((await ready).status(),200);
  await text(barista,'Active orders Ã‚Â· 0').waitFor();
  console.log('PASS cashier request, manager approval, discounted cash/change, optional receipt and independent barista preparation');
  await manager.getByRole('navigation').getByRole('button',{name:'Sales & margin',exact:true}).click();
  await text(manager,'Gross settled sales').waitFor();
  const metric=name=>text(manager,name).locator('..').locator('dd');
  assert.equal(await metric('Gross settled sales').textContent(),'Ã¢â€šÂ±165.00');
  assert.equal(await metric('Approved discounts').textContent(),'Ã¢â€šÂ±15.00');
  await manager.getByRole('region',{name:'Sales by day',exact:true}).getByText('Ã¢â€šÂ±150.00',{exact:true}).first().waitFor();
  await responsive(manager,'manager-sales');
  await button(cashier,'Shift closing').click();
  await enter(cashier,'Counted cash (PHP)','1150');
  const countSaved=cashier.waitForResponse(r=>r.url().endsWith('/submit-count')&&r.request().method()==='POST');
  await button(cashier,'Submit count').click();
  assert.equal((await countSaved).status(),200);
  await manager.getByRole('navigation').getByRole('button',{name:'Shift review',exact:true}).click();
  await button(manager,'Approve close').click();
  await text(manager,'Shift closed.').waitFor();
  await button(manager,'Sign out').click();
  await button(cashier,'Sign out').click();
  await button(barista,'Sign out').click();
  assert.deepEqual(errors,[]);
  console.log('PASS gross 165 minus discount 15 equals net 150; actual drawer 1150 closes; separate users sign out; zero page or console errors');
  }
'@
    $diagnostics=@'
}catch(error){
  for(const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()){
    console.log('DIAGNOSTIC page '+index+' '+await page.locator('body').ariaSnapshot());
    await page.screenshot({path:'scratch/approval-failure-'+index+'.png'});
  }
  throw error;
}finally{await browser.close();}
'@
    $scenarioAudit=if ($TakeoutCorrection) { $takeoutAudit } else { $approvalAudit }
    # Pass only the chosen scenario to Node to stay inside Windows argument limits.
    $audit=@($common, 'try {', $scenarioAudit, $diagnostics) -join "`n"
    node .agents/skills/playwright-skill/run.js -e $audit
    $auditExit=$LASTEXITCODE
}finally{
    $env:URL=$priorTarget
    $env:KAPE_DOZ_TEST_APPROVAL_HUB=$priorHub
    $env:KAPE_DOZ_TEST_APPROVAL_PORTAL=$priorPortal
    $env:KAPE_DOZ_TEST_APPROVAL_SCENARIO=$priorScenario
    Pop-Location
}
exit $auditExit

param([Parameter(Mandatory)][uri]$StaffUrl,[Parameter(Mandatory)][uri]$PortalUrl,[Parameter(Mandatory)][uri]$FixtureHubUrl)
$ErrorActionPreference='Stop'
if (-not $StaffUrl.IsLoopback -or -not $PortalUrl.IsLoopback -or -not $FixtureHubUrl.IsLoopback) { throw 'Use isolated loopback fixtures.' }
$previous=@($env:URL,$env:KAPE_DOZ_TEST_APPROVAL_HUB,$env:KAPE_DOZ_TEST_APPROVAL_PORTAL)
Push-Location (Join-Path $PSScriptRoot '..\..')
try {
  $env:URL=$StaffUrl.AbsoluteUri
  $env:KAPE_DOZ_TEST_APPROVAL_HUB=$FixtureHubUrl.GetLeftPart([UriPartial]::Authority)
  $env:KAPE_DOZ_TEST_APPROVAL_PORTAL=$PortalUrl.AbsoluteUri
  $source=Get-Content -LiteralPath 'mobile/tools/rehearse-approvals.ps1' -Raw
  $match=[regex]::Match($source,'(?s)\$common=@''\r?\n(.*?)\r?\n''@')
  if (!$match.Success) { throw 'The shared staff rehearsal helpers could not be loaded.' }
  $common=$match.Groups[1].Value
  $scenario=@'
const manager=await browser.newPage({viewport:{width:1280,height:900}});
watch(manager);
await manager.goto(portal,{waitUntil:'domcontentloaded'});
await manager.getByLabel('Account ID',{exact:true}).fill('transport-manager');
await manager.getByLabel('Password',{exact:true}).fill('Transport-Fixture-Manager-Password!');
const logged=manager.waitForResponse(r=>r.url().endsWith('/api/v1/auth/admin')&&r.request().method()==='POST');
await button(manager,'Sign in').click();
const login=await logged;
assert.equal(login.status(),200);
await manager.getByRole('navigation').getByRole('button',{name:'Recipes',exact:true}).click();
await manager.getByRole('heading',{name:'Recipes',exact:true,level:1}).waitFor();
await manager.getByLabel('Product ID',{exact:true}).fill('fixture-americano');
await manager.getByLabel('Product name',{exact:true}).fill('Fixture Americano');
await manager.getByLabel('Retail price (PHP)',{exact:true}).fill('165');
await manager.locator('select[name=ingredient-1]').selectOption('beans');
await manager.getByLabel('Quantity',{exact:true}).fill('18');
const createdProduct=manager.waitForResponse(r=>r.url().endsWith('/api/v1/products')&&r.request().method()==='POST');
await button(manager,'Create recipe').click();
assert.equal((await createdProduct).status(),200);
await manager.getByText('Recipe created.',{exact:true}).waitFor();

const cashier=await staff('cashier','4826');
await button(cashier,'Open shift').click();
await enter(cashier,'Opening cash (PHP)','1000');
const opened=cashier.waitForResponse(r=>r.url().endsWith('/api/v1/shifts/open')&&r.request().method()==='POST');
await button(cashier,'Open shift').last().click();
assert.equal((await opened).status(),200);
await cashier.getByRole('button',{name:/Fixture Latte.*Add/}).click();
await enter(cashier,'Preparation note','Extra hot, availability rehearsal');
await button(cashier,'Add to order').click();
const takeout=cashier.getByRole('radio',{name:'Takeout',exact:true});
if(await takeout.getAttribute('aria-checked')!=='true') await takeout.click();
await takeout.and(cashier.locator('[aria-checked="true"]')).waitFor();
const createdOrder=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
await button(cashier,'Create order').click();
const order=(await (await createdOrder).json()).order;
assert.equal(order.dineIn,false);
assert.equal(order.released,false);

const orderPath='/api/v1/orders/'+order.id;
await button(cashier,'Take payment').click();
await enter(cashier,'Cash received (PHP)','100');
const firstPay=cashier.waitForResponse(r=>r.url()===hub+orderPath+'/payments'&&r.request().method()==='POST');
await button(cashier,'Confirm payment').click();
assert.equal((await firstPay).status(),200);
await text(cashier,'Remaining \u20b165.00').waitFor();
await button(cashier,'Payment method Cash').click();
await cashier.getByRole('menuitem',{name:'GCash',exact:true})
  .or(cashier.getByRole('button',{name:'GCash',exact:true})).first().click();
await enter(cashier,'Payment amount (PHP)','65');
await enter(cashier,'Merchant reference','SYNTHETIC-AVAILABILITY-GCASH');
const secondPay=cashier.waitForResponse(r=>r.url()===hub+orderPath+'/payments'&&r.request().method()==='POST');
await button(cashier,'Record pending payment').click();
const pendingPayment=(await (await secondPay).json()).payment;
assert.equal(pendingPayment.status,'pending');

await manager.getByLabel('Availability reason for Fixture Latte',{exact:true}).fill('Synthetic steamed milk outage');
const disabledResp=manager.waitForResponse(r=>r.url().endsWith('/api/v1/products/fixture-latte/availability')&&r.request().method()==='POST');
await manager.getByRole('listitem').filter({hasText:'Fixture Latte'}).getByRole('button',{name:'Mark unavailable',exact:true}).click();
const disabledProduct=(await (await disabledResp).json()).product;
assert.equal(disabledProduct.available,false);
assert.equal(disabledProduct.availabilityVersion,2);
await manager.getByText('Product marked unavailable.',{exact:true}).waitFor();
await responsive(manager,'manager-availability');

await button(cashier,'Refresh balance').click();
await text(cashier,'Replace the unavailable item before recording another payment. Pending payments can still be verified or rejected.').waitFor();
await button(cashier,'Verify pending payment').click();
const verifiedResp=cashier.waitForResponse(r=>r.url()===hub+orderPath+'/payments/'+pendingPayment.id+'/verify'&&r.request().method()==='POST');
await button(cashier,'I verified success').click();
const verifiedData=await (await verifiedResp).json();
assert.equal(verifiedData.order.paymentState,'paid');
assert.equal(verifiedData.order.paidCentavos,16500);
assert.equal(verifiedData.order.released,false);
assert.equal(verifiedData.order.unavailableLines.length,1);
await button(cashier,'Return to cashier').click();

await text(cashier,'A menu item is unavailable. Replace it before sending or recording another payment.').waitFor();
await responsive(cashier,'cashier-unavailable-held');
await button(cashier,'Replace').click();
await text(cashier,'Choose an item with the same price. For a different price, request manager cancellation or refund and enter a new order.').waitFor();
await cashier.getByRole('button',{name:/^Replacement item/}).click();
await cashier.getByRole('menuitem',{name:'Fixture Americano \u00b7 \u20b1165.00',exact:true})
  .or(cashier.getByText('Fixture Americano \u00b7 \u20b1165.00',{exact:true})).first().click();
await enter(cashier,'Reason for replacement','Customer selected Americano at same price');
const replacedResp=cashier.waitForResponse(r=>r.url()===hub+orderPath+'/replace-unavailable'&&r.request().method()==='POST');
await button(cashier,'Replace item').click();
const replacedOrder=(await (await replacedResp).json()).order;
assert.equal(replacedOrder.released,true);
assert.equal(replacedOrder.paymentState,'paid');
assert.equal(replacedOrder.paidCentavos,16500);
assert.deepEqual(replacedOrder.unavailableLines,[]);
assert.equal(replacedOrder.lines[0].productId,'fixture-americano');
await text(cashier,'1 \u00d7 Fixture Americano').waitFor();
await text(cashier,'Payment: paid \u00b7 Kitchen: queued').waitFor();

const barista=await staff('barista','5937');
await text(barista,'Active orders \u00b7 1').waitFor();
await text(barista,'1 \u00d7 Fixture Americano').waitFor();
await text(barista,'Extra hot, availability rehearsal').waitFor();
await responsive(barista,'barista-replaced-order');
const readyResp=barista.waitForResponse(r=>r.url()===hub+orderPath+'/ready'&&r.request().method()==='POST');
await button(barista,'Mark ready').click();
assert.equal((await readyResp).status(),200);
await text(barista,'Active orders \u00b7 0').waitFor();

await button(cashier,'Refresh').click();
await text(cashier,'Payment: paid \u00b7 Kitchen: ready').waitFor();
await button(cashier,'Shift closing').click();
await enter(cashier,'Counted cash (PHP)','1100');
const countResp=cashier.waitForResponse(r=>r.url().endsWith('/submit-count')&&r.request().method()==='POST');
await button(cashier,'Submit count').click();
assert.equal((await countResp).status(),200);

await manager.getByRole('navigation').getByRole('button',{name:'Shift review',exact:true}).click();
const closeResp=manager.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
await button(manager,'Approve close').click();
assert.equal((await closeResp).status(),200);
await manager.getByText('Shift closed.',{exact:true}).waitFor();

await button(manager,'Sign out').click();
await button(cashier,'Sign out').click();
await button(barista,'Sign out').click();
assert.deepEqual(errors,[]);
console.log('PASS catalog availability disable, same-price replacement without double charge, and barista completion '+JSON.stringify({orderId:order.id,pendingPaymentId:pendingPayment.id}));
'@
  $ending=@'
} catch(error) {
  for(const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()) {
    console.log('DIAGNOSTIC '+index+' '+await page.locator('body').ariaSnapshot());
    await page.screenshot({path:'scratch/catalog-availability-failure-'+index+'.png'});
  }
  throw error;
} finally { await browser.close(); }
'@
  $audit=@($common,'try {',$scenario,$ending) -join "`n"
  node .agents/skills/playwright-skill/run.js -e $audit
  $status=$LASTEXITCODE
} finally {
  $env:URL=$previous[0]; $env:KAPE_DOZ_TEST_APPROVAL_HUB=$previous[1]; $env:KAPE_DOZ_TEST_APPROVAL_PORTAL=$previous[2]
  Pop-Location
}
exit $status

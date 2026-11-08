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
const owner=await browser.newPage({viewport:{width:1280,height:900}});
watch(owner);
await owner.goto(portal,{waitUntil:'domcontentloaded'});
await owner.getByLabel('Account ID',{exact:true}).fill('transport-owner');
await owner.getByLabel('Password',{exact:true}).fill('Transport-Fixture-Owner-Password!');
const ownerLogin=owner.waitForResponse(r=>r.url().endsWith('/api/v1/auth/admin')&&r.request().method()==='POST');
await button(owner,'Sign in').click();
assert.equal((await ownerLogin).status(),200);

const ingredientId='oat-x01';
const productId='oat-latte-x01';
await owner.getByRole('navigation').getByRole('button',{name:'Inventory',exact:true}).click();
await owner.getByRole('heading',{name:'Inventory',exact:true,level:1}).waitFor();
await owner.getByLabel('Ingredient ID',{exact:true}).fill(ingredientId);
await owner.getByLabel('Ingredient name',{exact:true}).fill('Oat Drink X01');
await owner.locator('select[name=unit]').selectOption('ml');
const createdIng=owner.waitForResponse(r=>r.url().endsWith('/api/v1/ingredients')&&r.request().method()==='POST');
await button(owner,'Add ingredient').click();
assert.equal((await createdIng).status(),200);
await owner.getByText('Ingredient created.',{exact:true}).waitFor();
await owner.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(el=>el.textContent?.trim()==='Loading workspace\u2026'||el.textContent?.trim()==='Checking saved commands\u2026'));

await owner.locator('section.panel').filter({hasText:'Receive stock'}).locator('select[name=ingredient]').selectOption(ingredientId);
await owner.getByLabel('Supplier',{exact:true}).fill('Oat Co');
await owner.getByLabel('Packs received',{exact:true}).fill('2');
await owner.getByLabel('Units per pack',{exact:true}).fill('1000');
await owner.getByLabel('Total received cost (PHP)',{exact:true}).fill('240.00');
await owner.getByLabel('Receipt reference',{exact:true}).fill('SYNTHETIC-X01-RECEIPT');
const createdRec=owner.waitForResponse(r=>r.url().endsWith('/api/v1/inventory/receipts')&&r.request().method()==='POST');
await button(owner,'Save stock receipt').click();
assert.equal((await createdRec).status(),200);
await owner.getByText('Stock receipt saved.',{exact:true}).waitFor();

await owner.getByRole('navigation').getByRole('button',{name:'Recipes',exact:true}).click();
await owner.getByRole('heading',{name:'Recipes',exact:true,level:1}).waitFor();
await owner.getByLabel('Product ID',{exact:true}).fill(productId);
await owner.getByLabel('Product name',{exact:true}).fill('Oat Latte X01');
await owner.getByLabel('Retail price (PHP)',{exact:true}).fill('175');
await owner.locator('select[name=ingredient-1]').selectOption(ingredientId);
await owner.getByLabel('Quantity',{exact:true}).fill('150');
const createdProd=owner.waitForResponse(r=>r.url().endsWith('/api/v1/products')&&r.request().method()==='POST');
await button(owner,'Create recipe').click();
assert.equal((await createdProd).status(),200);
await owner.getByText('Recipe created.',{exact:true}).waitFor();
await responsive(owner,'x01-owner-setup');
const ownerLogout=owner.waitForResponse(r=>r.url().endsWith('/api/v1/auth/logout')&&r.request().method()==='POST');
await button(owner,'Sign out').click();
assert.equal((await ownerLogout).status(),204);

const cashier=await staff('cashier','4826');
await button(cashier,'Open shift').click();
await enter(cashier,'Opening cash (PHP)','1000');
const openedShift=cashier.waitForResponse(r=>r.url().endsWith('/api/v1/shifts/open')&&r.request().method()==='POST');
await button(cashier,'Open shift').last().click();
const shift=(await (await openedShift).json()).shift;

await enter(cashier,'Table number (optional)','08');
await cashier.getByRole('button',{name:/Oat Latte X01.*Add/}).click();
await enter(cashier,'Preparation note','X01 dine-in table 08');
await button(cashier,'Add to order').click();
const createdOrder=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
await button(cashier,'Create order').click();
const order=(await (await createdOrder).json()).order;
assert.equal(order.dineIn,true);
assert.equal(order.released,false);

const orderPath='/api/v1/orders/'+order.id;
const sentOrder=cashier.waitForResponse(r=>r.url()===hub+orderPath+'/send'&&r.request().method()==='POST');
await button(cashier,'Send to bar').click();
assert.equal((await sentOrder).status(),200);
await text(cashier,'Payment: unpaid \u00b7 Kitchen: queued').waitFor();
await responsive(cashier,'x01-cashier-sent');

const barista=await staff('barista','5937');
await text(barista,'Active orders \u00b7 1').waitFor();
await barista.getByRole('group',{name:/Order #1 \u00b7 Dine in.*Table 08 \u00b7 unpaid/}).waitFor();
await text(barista,'1 \u00d7 Oat Latte X01').waitFor();
await text(barista,'X01 dine-in table 08').waitFor();
await responsive(barista,'x01-barista-queue');
const readyResp=barista.waitForResponse(r=>r.url()===hub+orderPath+'/ready'&&r.request().method()==='POST');
await button(barista,'Mark ready').click();
assert.equal((await readyResp).status(),200);
await text(barista,'Active orders \u00b7 0').waitFor();

await button(cashier,'Refresh').click();
await text(cashier,'Payment: unpaid \u00b7 Kitchen: ready').waitFor();
await button(cashier,'Take payment').click();
await enter(cashier,'Cash received (PHP)','100');
const firstPay=cashier.waitForResponse(r=>r.url()===hub+orderPath+'/payments'&&r.request().method()==='POST');
await button(cashier,'Confirm payment').click();
const cashPay=(await (await firstPay).json()).payment;
assert.equal(cashPay.amountCentavos,10000);
await text(cashier,'Remaining \u20b175.00').waitFor();
assert.equal(await button(cashier,'Print receipt').isEnabled(),false);

await button(cashier,'Payment method Cash').click();
await cashier.getByRole('menuitem',{name:'GCash',exact:true})
  .or(cashier.getByRole('button',{name:'GCash',exact:true})).first().click();
await enter(cashier,'Payment amount (PHP)','75');
await enter(cashier,'Merchant reference','SYNTHETIC-X01-GCASH');
await cashier.getByRole('checkbox',{name:'I verified success in the merchant app or terminal',exact:true}).click();
const secondPay=cashier.waitForResponse(r=>r.url()===hub+orderPath+'/payments'&&r.request().method()==='POST');
await button(cashier,'Confirm payment').click();
const gcashPay=(await (await secondPay).json()).payment;
assert.equal(gcashPay.amountCentavos,7500);
assert.equal(gcashPay.status,'confirmed');
await text(cashier,'Remaining \u20b10.00').waitFor();
assert.equal(await button(cashier,'Print receipt').isEnabled(),true);

const receiptResp=cashier.waitForResponse(r=>r.url()===hub+orderPath+'/receipt'&&r.request().method()==='POST');
await button(cashier,'Print receipt').click();
const receiptData=await (await receiptResp).json();
assert.equal(receiptData.job.status,'unconfigured');
await text(cashier,'Printer not configured. No receipt was sent.').waitFor();
await responsive(cashier,'x01-cashier-settled-receipt');
await button(cashier,'Return to cashier').click();

await button(cashier,'Shift closing').click();
await enter(cashier,'Counted cash (PHP)','1100');
await enter(cashier,'Closing note','X01 exact blind count');
const countResp=cashier.waitForResponse(r=>r.url().endsWith('/submit-count')&&r.request().method()==='POST');
await button(cashier,'Submit count').click();
assert.equal((await countResp).status(),200);

await owner.getByLabel('Account ID',{exact:true}).fill('transport-manager');
await owner.getByLabel('Password',{exact:true}).fill('Transport-Fixture-Manager-Password!');
const managerLogin=owner.waitForResponse(r=>r.url().endsWith('/api/v1/auth/admin')&&r.request().method()==='POST');
await button(owner,'Sign in').click();
assert.equal((await managerLogin).status(),200);
await owner.getByRole('heading',{name:'Shift review',exact:true,level:1}).waitFor();
await owner.getByText('X01 exact blind count',{exact:true}).waitFor();
const closeResp=owner.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
await button(owner,'Approve close').click();
assert.equal((await closeResp).status(),200);
await owner.getByText('Shift closed.',{exact:true}).waitFor();
await responsive(owner,'x01-manager-closed');

await button(owner,'Sign out').click();
await button(cashier,'Sign out').click();
await button(barista,'Sign out').click();
assert.deepEqual(errors,[]);
console.log('PASS X01 owner setup, staff PIN, drawer open, dine-in send, barista ready, split settlement, optional receipt, cashier count, manager close '+JSON.stringify({
  orderId:order.id,
  shiftId:shift.id,
  productId,
  ingredientId,
  cashPaymentId:cashPay.id,
  gcashPaymentId:gcashPay.id,
}));
'@
  $ending=@'
} catch(error) {
  for(const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()) {
    console.log('DIAGNOSTIC '+index+' '+await page.locator('body').ariaSnapshot());
    await page.screenshot({path:'scratch/x01-failure-'+index+'.png'});
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

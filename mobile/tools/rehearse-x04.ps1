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

const ingredientId='beans-x04';
const productId='signature-latte-x04';
await owner.getByRole('navigation').getByRole('button',{name:'Inventory',exact:true}).click();
await owner.getByRole('heading',{name:'Inventory',exact:true,level:1}).waitFor();
await owner.getByLabel('Ingredient ID',{exact:true}).fill(ingredientId);
await owner.getByLabel('Ingredient name',{exact:true}).fill('Coffee Beans X04');
await owner.locator('select[name=unit]').selectOption('g');
const createdIng=owner.waitForResponse(r=>r.url().endsWith('/api/v1/ingredients')&&r.request().method()==='POST');
await button(owner,'Add ingredient').click();
assert.equal((await createdIng).status(),200);
await owner.getByText('Ingredient created.',{exact:true}).waitFor();
await owner.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(el=>el.textContent?.trim()==='Loading workspace\u2026'||el.textContent?.trim()==='Checking saved commands\u2026'));

await owner.locator('section.panel').filter({hasText:'Receive stock'}).locator('select[name=ingredient]').selectOption(ingredientId);
await owner.getByLabel('Quantity in ingredient units',{exact:true}).fill('5000');
await owner.getByLabel('Total received cost (PHP)',{exact:true}).fill('1000.00');
await owner.getByLabel('Receipt reference',{exact:true}).fill('SYNTHETIC-X04-RECEIPT');
const createdRec=owner.waitForResponse(r=>r.url().endsWith('/api/v1/inventory/receipts')&&r.request().method()==='POST');
await button(owner,'Save stock receipt').click();
assert.equal((await createdRec).status(),200);
await owner.getByText('Stock receipt saved.',{exact:true}).waitFor();

await owner.getByRole('navigation').getByRole('button',{name:'Recipes',exact:true}).click();
await owner.getByRole('heading',{name:'Recipes',exact:true,level:1}).waitFor();
await owner.getByLabel('Product ID',{exact:true}).fill(productId);
await owner.getByLabel('Product name',{exact:true}).fill('Signature Latte X04');
await owner.getByLabel('Retail price (PHP)',{exact:true}).fill('200');
await owner.locator('select[name=ingredient-1]').selectOption(ingredientId);
await owner.getByLabel('Quantity',{exact:true}).fill('20');
const createdProd=owner.waitForResponse(r=>r.url().endsWith('/api/v1/products')&&r.request().method()==='POST');
await button(owner,'Create recipe').click();
assert.equal((await createdProd).status(),200);
await owner.getByText('Recipe created.',{exact:true}).waitFor();
const ownerLogout=owner.waitForResponse(r=>r.url().endsWith('/api/v1/auth/logout')&&r.request().method()==='POST');
await button(owner,'Sign out').click();
assert.equal((await ownerLogout).status(),204);

await owner.getByLabel('Account ID',{exact:true}).fill('transport-manager');
await owner.getByLabel('Password',{exact:true}).fill('Transport-Fixture-Manager-Password!');
const managerLogin=owner.waitForResponse(r=>r.url().endsWith('/api/v1/auth/admin')&&r.request().method()==='POST');
await button(owner,'Sign in').click();
assert.equal((await managerLogin).status(),200);

const cashier=await staff('cashier','4826');
await button(cashier,'Open shift').click();
await enter(cashier,'Opening cash (PHP)','1000');
const openedShift=cashier.waitForResponse(r=>r.url().endsWith('/api/v1/shifts/open')&&r.request().method()==='POST');
await button(cashier,'Open shift').last().click();
assert.equal((await openedShift).status(),200);

await button(cashier,'Customers & loyalty').click();
await enter(cashier,'Customer name','Maria Clara');
await enter(cashier,'Customer phone','09171234567');
const enrolledResp=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/customers'&&r.request().method()==='POST');
await button(cashier,'Enroll customer').click();
const customer=(await (await enrolledResp).json()).customer;
await text(cashier,'Available: 0 pts \u00b7 Pending: 0 pts').waitFor();
await button(cashier,'Close').click();

await cashier.getByRole('button',{name:/Signature Latte X04.*Add/}).click();
await button(cashier,'Add to order').click();
const createdO1=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
await button(cashier,'Create order').click();
const order1=(await (await createdO1).json()).order;

const loadedCust1=cashier.waitForResponse(r=>r.url().startsWith(hub+'/api/v1/customers')&&r.request().method()==='GET');
await button(cashier,'Attach customer').click();
await loadedCust1;
await button(cashier,'Select customer Walk-in (no customer)').click();
await cashier.getByRole('menuitem',{name:'Maria Clara (0 pts)',exact:true})
  .or(cashier.getByRole('button',{name:'Maria Clara (0 pts)',exact:true})).first().click();
const setCust1=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/customer'&&r.request().method()==='POST');
await button(cashier,'Save customer').click();
assert.equal((await setCust1).status(),200);
await text(cashier,'Customer: Maria Clara').waitFor();

await button(cashier,'Take payment').click();
await enter(cashier,'Cash received (PHP)','200');
const paidO1=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/payments'&&r.request().method()==='POST');
await button(cashier,'Confirm payment').click();
assert.equal((await paidO1).status(),200);
await button(cashier,'Return to cashier').click();
await text(cashier,'Earned points: 2 pts').waitFor();

await button(cashier,'+ New order').click();
await cashier.getByRole('button',{name:/Signature Latte X04.*Add/}).click();
await button(cashier,'Add to order').click();
const createdO2=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
await button(cashier,'Create order').click();
const order2=(await (await createdO2).json()).order;

const loadedCust2=cashier.waitForResponse(r=>r.url().startsWith(hub+'/api/v1/customers')&&r.request().method()==='GET');
await button(cashier,'Attach customer').click();
await loadedCust2;
await button(cashier,'Select customer Walk-in (no customer)').click();
await cashier.getByRole('menuitem',{name:'Maria Clara (2 pts)',exact:true})
  .or(cashier.getByRole('button',{name:'Maria Clara (2 pts)',exact:true})).first().click();
const setCust2=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order2.id+'/customer'&&r.request().method()==='POST');
await button(cashier,'Save customer').click();
assert.equal((await setCust2).status(),200);

await button(cashier,'Request points redemption').click();
await enter(cashier,'Points to redeem','1');
await enter(cashier,'Reason for redemption','Use 1 loyalty point');
const reqRedeem=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order2.id+'/loyalty/redeem-request'&&r.request().method()==='POST');
await button(cashier,'Send redemption request').click();
const redemption=(await (await reqRedeem).json()).redemption;
await text(cashier,'Loyalty redemption awaiting approval').waitFor();

await owner.getByRole('navigation').getByRole('button',{name:'Customers',exact:true}).click();
await owner.getByRole('heading',{name:'Customers & loyalty',exact:true,level:1}).waitFor();
const decidedRedeem=owner.waitForResponse(r=>r.url().endsWith('/api/v1/loyalty/redemptions/'+redemption.id+'/decision')&&r.request().method()==='POST');
await button(owner,'Approve redemption').click();
assert.equal((await decidedRedeem).status(),200);
await owner.getByText('Loyalty redemption approved.',{exact:true}).waitFor();

await button(cashier,'Refresh').click();
await button(cashier,'Apply approved redemption').waitFor();
const validatedRedeem=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/loyalty/redemptions/'+redemption.id+'/validate-cloud'&&r.request().method()==='POST');
await button(cashier,'Apply approved redemption').click();
assert.equal((await validatedRedeem).status(),200);
await text(cashier,'Loyalty redemption \u2212\u20b11.00 (1 pts)').waitFor();
await text(cashier,'Total \u20b1199.00 \u00b7 Paid \u20b10.00').waitFor();
await responsive(cashier,'x04-cashier-redeemed');

await button(cashier,'Take payment').click();
await enter(cashier,'Cash received (PHP)','199');
const paidO2=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order2.id+'/payments'&&r.request().method()==='POST');
await button(cashier,'Confirm payment').click();
assert.equal((await paidO2).status(),200);
await button(cashier,'Return to cashier').click();
await text(cashier,'Earned points: 1 pts').waitFor();

const cloudOfflineResp=owner.waitForResponse(r=>r.url().endsWith('/api/v1/loyalty/cloud-mode')&&r.request().method()==='POST');
await button(owner,'Simulate cloud offline').click();
assert.equal((await cloudOfflineResp).status(),200);
await owner.getByText('Cloud loyalty set to offline.',{exact:true}).waitFor();

await button(cashier,'+ New order').click();
await cashier.getByRole('button',{name:/Signature Latte X04.*Add/}).click();
await button(cashier,'Add to order').click();
const createdO3=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
await button(cashier,'Create order').click();
const order3=(await (await createdO3).json()).order;

const loadedCust3=cashier.waitForResponse(r=>r.url().startsWith(hub+'/api/v1/customers')&&r.request().method()==='GET');
await button(cashier,'Attach customer').click();
await loadedCust3;
await button(cashier,'Select customer Walk-in (no customer)').click();
await cashier.getByRole('menuitem',{name:'Maria Clara (2 pts)',exact:true})
  .or(cashier.getByRole('button',{name:'Maria Clara (2 pts)',exact:true})).first().click();
const setCust3=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order3.id+'/customer'&&r.request().method()==='POST');
await button(cashier,'Save customer').click();
assert.equal((await setCust3).status(),200);

await button(cashier,'Take payment').click();
await enter(cashier,'Cash received (PHP)','200');
const paidO3=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order3.id+'/payments'&&r.request().method()==='POST');
await button(cashier,'Confirm payment').click();
assert.equal((await paidO3).status(),200);
await button(cashier,'Return to cashier').click();
await text(cashier,'Earned points: 2 pts').waitFor();

const cloudOnlineResp=owner.waitForResponse(r=>r.url().endsWith('/api/v1/loyalty/cloud-mode')&&r.request().method()==='POST');
await button(owner,'Set cloud online').click();
assert.equal((await cloudOnlineResp).status(),200);
await owner.getByText('Cloud loyalty set to online.',{exact:true}).waitFor();

const loadedLoyaltyDialog=cashier.waitForResponse(r=>r.url().endsWith('/api/v1/loyalty/cloud-state')&&r.request().method()==='GET');
await button(cashier,'Customers & loyalty').click();
await loadedLoyaltyDialog;
await text(cashier,'Cloud loyalty: Online \u00b7 Pending entries: 1').waitFor();
const syncedResp=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/loyalty/sync'&&r.request().method()==='POST');
await button(cashier,'Sync pending loyalty points').click();
assert.equal((await syncedResp).status(),200);
await text(cashier,'Available: 4 pts \u00b7 Pending: 0 pts').waitFor();
await button(cashier,'Close').click();

await button(cashier,'Request refund').click();
await cashier.getByRole('checkbox',{name:/Signature Latte X04/}).click();
await enter(cashier,'Refund amount (PHP)','100');
await enter(cashier,'Reason for refund','Partial refund half drink');
const reqRefund=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order3.id+'/refunds'&&r.request().method()==='POST');
await button(cashier,'Send refund request').click();
const refund=(await (await reqRefund).json()).refund;

await owner.getByRole('navigation').getByRole('button',{name:'Refunds',exact:true}).click();
await owner.getByRole('heading',{name:'Refunds',exact:true,level:1}).waitFor();
await owner.getByLabel(/Refund from Cash/).fill('100.00');
await owner.getByLabel('Decision note',{exact:true}).fill('Approved partial refund');
const decidedRefund=owner.waitForResponse(r=>r.url().endsWith('/api/v1/refunds/'+refund.id+'/decision')&&r.request().method()==='POST');
await button(owner,'Approve refund allocation').click();
assert.equal((await decidedRefund).status(),200);

await button(cashier,'Refresh').click();
await button(cashier,'Record cash payout').click();
const recordedPayout=cashier.waitForResponse(r=>r.url().includes('/api/v1/refunds/'+refund.id+'/legs/')&&r.request().method()==='POST');
await button(cashier,'Record cash handed back').click();
assert.equal((await recordedPayout).status(),200);
await text(cashier,'Refunded \u20b1100.00').waitFor();

await owner.getByRole('navigation').getByRole('button',{name:'Customers',exact:true}).click();
await owner.getByRole('heading',{name:'Customers & loyalty',exact:true,level:1}).waitFor();
await owner.getByLabel('Reverse earned points',{exact:true}).fill('1');
await owner.getByLabel('Loyalty adjustment reason',{exact:true}).fill('Deduct proportional 1 point');
const decidedCase=owner.waitForResponse(r=>r.url().includes('/api/v1/loyalty/refund-cases/')&&r.url().endsWith('/decision')&&r.request().method()==='POST');
await button(owner,'Record loyalty adjustment').click();
const refundCase=(await (await decidedCase).json()).refundCase;
await owner.getByText('Loyalty refund adjustment decision recorded.',{exact:true}).waitFor();

await owner.getByText('3 pts',{exact:true}).waitFor();
await owner.getByText('0 pts',{exact:true}).waitFor();
await responsive(owner,'x04-admin-customers');

await button(owner,'Sign out').click();
await button(cashier,'Sign out').click();
assert.deepEqual(errors,[]);
console.log('PASS X04 customer enrollment, approved online redemption, offline earning, reconnect sync, partial refund, point reconciliation '+JSON.stringify({
  customerId:customer.id,
  order1Id:order1.id,
  order2Id:order2.id,
  order3Id:order3.id,
  redemptionId:redemption.id,
  refundId:refund.id,
  refundCaseId:refundCase.id,
  productId,
}));
'@
  $ending=@'
} catch(error) {
  for(const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()) {
    console.log('DIAGNOSTIC '+index+' '+await page.locator('body').ariaSnapshot());
    await page.screenshot({path:'scratch/x04-failure-'+index+'.png'});
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

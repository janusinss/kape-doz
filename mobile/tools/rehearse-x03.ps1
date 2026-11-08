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
assert.equal((await logged).status(),200);

const oatId='oat-x03';
const cupId='cup-x03';
const productId='sig-latte-x03';
await manager.getByRole('navigation').getByRole('button',{name:'Inventory',exact:true}).click();
await manager.getByRole('heading',{name:'Inventory',exact:true,level:1}).waitFor();

for(const [id,name,unit] of [[oatId,'Oat Milk X03','ml'],[cupId,'Takeout Cup X03','piece']]) {
  await manager.getByLabel('Ingredient ID',{exact:true}).fill(id);
  await manager.getByLabel('Ingredient name',{exact:true}).fill(name);
  await manager.locator('select[name=unit]').selectOption(unit);
  const created=manager.waitForResponse(r=>r.url().endsWith('/api/v1/ingredients')&&r.request().method()==='POST');
  await button(manager,'Add ingredient').click();
  assert.equal((await created).status(),200);
  await manager.getByText('Ingredient created.',{exact:true}).waitFor();
  await manager.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(el=>el.textContent?.trim()==='Loading workspace\u2026'||el.textContent?.trim()==='Checking saved commands\u2026'));
}

for(const [id,supplier,packs,packSize,cost,ref] of [
  [oatId,'Oat Co','2','1000','240.00','SYNTHETIC-X03-OAT'],
  [cupId,'Cup Co','2','50','500.00','SYNTHETIC-X03-CUP'],
]) {
  await manager.locator('section.panel').filter({hasText:'Receive stock'}).locator('select[name=ingredient]').selectOption(id);
  await manager.getByLabel('Supplier',{exact:true}).fill(supplier);
  await manager.getByLabel('Packs received',{exact:true}).fill(packs);
  await manager.getByLabel('Units per pack',{exact:true}).fill(packSize);
  await manager.getByLabel('Total received cost (PHP)',{exact:true}).fill(cost);
  await manager.getByLabel('Receipt reference',{exact:true}).fill(ref);
  const rec=manager.waitForResponse(r=>r.url().endsWith('/api/v1/inventory/receipts')&&r.request().method()==='POST');
  await button(manager,'Save stock receipt').click();
  assert.equal((await rec).status(),200);
  await manager.getByText('Stock receipt saved.',{exact:true}).waitFor();
  await manager.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(el=>el.textContent?.trim()==='Loading workspace\u2026'||el.textContent?.trim()==='Checking saved commands\u2026'));
}

await manager.getByRole('navigation').getByRole('button',{name:'Recipes',exact:true}).click();
await manager.getByRole('heading',{name:'Recipes',exact:true,level:1}).waitFor();
await manager.getByLabel('Product ID',{exact:true}).fill(productId);
await manager.getByLabel('Product name',{exact:true}).fill('Signature Oat Latte');
await manager.getByLabel('Retail price (PHP)',{exact:true}).fill('180');
await manager.locator('select[name=ingredient-1]').selectOption('beans');
await manager.getByLabel('Quantity',{exact:true}).first().fill('18');
await button(manager,'Add ingredient line').click();
await manager.locator('select[name=ingredient-2]').selectOption(oatId);
await manager.getByLabel('Quantity',{exact:true}).last().fill('150');

await button(manager,'Add size').click();
await manager.getByLabel('Size ID',{exact:true}).fill('large');
await manager.getByLabel('Size name',{exact:true}).fill('Large 16oz');
await manager.getByLabel('Size price delta (PHP)',{exact:true}).fill('20');
await manager.locator('select[name=size-ingredient-1]').selectOption(oatId);
await manager.getByLabel('Size quantity',{exact:true}).fill('200');

await button(manager,'Add add-on').click();
await manager.getByLabel('Add-on ID',{exact:true}).fill('extra-shot');
await manager.getByLabel('Add-on name',{exact:true}).fill('Extra Espresso Shot');
await manager.getByLabel('Add-on price (PHP)',{exact:true}).fill('25');
await manager.locator('select[name=addon-ingredient-1]').selectOption('beans');
await manager.getByLabel('Add-on quantity',{exact:true}).fill('9');

await button(manager,'Add takeout packaging').click();
await manager.locator('select[name=takeout-ingredient-1]').selectOption(cupId);
await manager.getByLabel('Takeout packaging quantity',{exact:true}).fill('1');

const createdRecipe=manager.waitForResponse(r=>r.url().endsWith('/api/v1/products')&&r.request().method()==='POST');
await button(manager,'Create recipe').click();
assert.equal((await createdRecipe).status(),200);
await manager.getByText('Recipe created.',{exact:true}).waitFor();
await responsive(manager,'x03-manager-recipes');

const cashier=await staff('cashier','4826');
await button(cashier,'Open shift').click();
await enter(cashier,'Opening cash (PHP)','1000');
const openedShift=cashier.waitForResponse(r=>r.url().endsWith('/api/v1/shifts/open')&&r.request().method()==='POST');
await button(cashier,'Open shift').last().click();
assert.equal((await openedShift).status(),200);

const takeout=cashier.getByRole('radio',{name:'Takeout',exact:true});
if(await takeout.getAttribute('aria-checked')!=='true') await takeout.click();
await takeout.and(cashier.locator('[aria-checked="true"]')).waitFor();

await cashier.getByRole('button',{name:/Signature Oat Latte.*Add/}).click();
await cashier.getByRole('button',{name:/^Size/}).click();
await cashier.getByRole('menuitem',{name:'Large 16oz (+\u20b120.00)',exact:true})
  .or(cashier.getByText('Large 16oz (+\u20b120.00)',{exact:true})).first().click();
await cashier.getByRole('button',{name:'Increase Extra Espresso Shot',exact:true}).click();
await enter(cashier,'Preparation note','X03 large extra shot takeout');
await button(cashier,'Add to order').click();
await text(cashier,'Total \u20b1225.00').waitFor();

const createdOrder1=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
await button(cashier,'Create order').click();
const order1=(await (await createdOrder1).json()).order;
assert.equal(order1.totalCentavos,22500);

await manager.getByRole('listitem').filter({hasText:'Signature Oat Latte'}).getByRole('button',{name:'Edit recipe version',exact:true}).click();
await manager.getByLabel('Updated retail price for Signature Oat Latte (PHP)',{exact:true}).fill('200');
await manager.getByLabel('Updated Fixture espresso beans quantity (g)',{exact:true}).fill('20');
const updatedRecipe=manager.waitForResponse(r=>r.url().endsWith('/api/v1/products/'+productId+'/recipe')&&r.request().method()==='POST');
await button(manager,'Publish version 2').click();
assert.equal((await updatedRecipe).status(),200);
await manager.getByText('Recipe updated to version 2.',{exact:true}).waitFor();

await button(cashier,'Take payment').click();
await enter(cashier,'Cash received (PHP)','225');
const paidOrder1=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/payments'&&r.request().method()==='POST');
await button(cashier,'Confirm payment').click();
assert.equal((await paidOrder1).status(),200);
await button(cashier,'Return to cashier').click();

const barista=await staff('barista','5937');
await text(barista,'Active orders \u00b7 1').waitFor();
await barista.getByText(/1 \u00d7 Signature Oat Latte \(Large 16oz, 1\u00d7 Extra Espresso Shot\)/).first().waitFor();
const ready1=barista.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/ready'&&r.request().method()==='POST');
for(let i=0;i<5;i++){
  await button(barista,'Mark ready').click();
  if(await Promise.race([ready1.then(()=>true),new Promise(r=>setTimeout(()=>r(false),1500))])) break;
}
assert.equal((await ready1).status(),200);
await text(barista,'Active orders \u00b7 0').waitFor();

await barista.getByRole('button',{name:/^Waste/}).first().click();
await barista.getByRole('button',{name:/^Ingredient/}).click();
await barista.getByRole('menuitem',{name:'Oat Milk X03 (ml)',exact:true})
  .or(barista.getByText('Oat Milk X03 (ml)',{exact:true})).first().click();
await enter(barista,'Quantity in ingredient units','1700');
await enter(barista,'Note (optional)','X03 dial-in & spillage');
const savedWaste=barista.waitForResponse(r=>r.url()===hub+'/api/v1/waste'&&r.request().method()==='POST');
await button(barista,'Save waste').click();
assert.equal((await savedWaste).status(),200);
await text(barista,'Waste entry saved by the hub.').waitFor();
await barista.getByRole('button',{name:/^Station/}).first().click();

const cashierRefresh1=cashier.waitForResponse(r=>r.url().endsWith('/api/v1/refunds')&&r.request().method()==='GET');
await button(cashier,'Refresh').click();
await cashierRefresh1;
await button(cashier,'+ New order').click();
const dineIn=cashier.getByRole('radio',{name:'Dine in',exact:true});
if(await dineIn.getAttribute('aria-checked')!=='true') await dineIn.click();
await dineIn.and(cashier.locator('[aria-checked="true"]')).waitFor();
await cashier.getByRole('button',{name:/Signature Oat Latte.*Add/}).click();
await button(cashier,'Add to order').click();
await cashier.getByText(/Recorded stock is short/).first().waitFor();
await cashier.getByText(/Oat Milk X03: short 50 ml/).first().waitFor();
await text(cashier,'Total \u20b1200.00').waitFor();

const createdOrder2=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
await button(cashier,'Create order').click();
const order2=(await (await createdOrder2).json()).order;
assert.equal(order2.totalCentavos,20000);
assert.equal(order2.shortages[0].shortfallMilli,50000);
const sentOrder2=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order2.id+'/send'&&r.request().method()==='POST');
await button(cashier,'Send to bar').click();
assert.equal((await sentOrder2).status(),200);

await button(barista,'Refresh').click();
await text(barista,'Active orders \u00b7 1').waitFor();
await barista.getByText(/Oat Milk X03: short 50 ml/).first().waitFor();
const ready2=barista.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order2.id+'/ready'&&r.request().method()==='POST');
for(let i=0;i<5;i++){
  await button(barista,'Mark ready').click();
  if(await Promise.race([ready2.then(()=>true),new Promise(r=>setTimeout(()=>r(false),1500))])) break;
}
assert.equal((await ready2).status(),200);

const cashierRefresh2=cashier.waitForResponse(r=>r.url().endsWith('/api/v1/refunds')&&r.request().method()==='GET');
await button(cashier,'Refresh').click();
await cashierRefresh2;
await button(cashier,'Take payment').click();
await enter(cashier,'Cash received (PHP)','200');
const paidOrder2=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order2.id+'/payments'&&r.request().method()==='POST');
await button(cashier,'Confirm payment').click();
assert.equal((await paidOrder2).status(),200);
await button(cashier,'Return to cashier').click();

await manager.getByRole('navigation').getByRole('button',{name:'Inventory',exact:true}).click();
await manager.getByRole('heading',{name:'Inventory',exact:true,level:1}).waitFor();
await manager.getByRole('heading',{name:'Oat Milk X03 \u00b7 Stock shortage',exact:true}).waitFor();
await manager.locator('section.inventory-counts select[name=ingredient]').selectOption(oatId);
const startedCount=manager.waitForResponse(r=>r.url().endsWith('/api/v1/inventory/counts')&&r.request().method()==='POST');
await button(manager,'Start count').click();
const count=(await (await startedCount).json()).count;
await manager.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(el=>el.textContent?.trim()==='Loading workspace\u2026'||el.textContent?.trim()==='Checking saved commands\u2026'));

await manager.getByLabel('Counted quantity (ml)',{exact:true}).fill('200');
const observedCount=manager.waitForResponse(r=>r.url().endsWith('/api/v1/inventory/counts/'+count.id+'/observe')&&r.request().method()==='POST');
await button(manager,'Submit count').click();
assert.equal((await observedCount).status(),200);
await manager.getByText('Count submitted for review.',{exact:true}).waitFor();
await button(manager,'Approve adjustment').waitFor();

await manager.getByLabel('Stock count reason',{exact:true}).fill('Found unopened reserve oat milk');
const decidedCount=manager.waitForResponse(r=>r.url().endsWith('/api/v1/inventory/counts/'+count.id+'/decide')&&r.request().method()==='POST');
await button(manager,'Approve adjustment').click();
assert.equal((await decidedCount).status(),200);
await manager.getByText('Stock count approved. The adjustment is posted.',{exact:true}).waitFor();
await manager.getByLabel('Additional stock cost (PHP)',{exact:true}).waitFor();

await manager.getByLabel('Additional stock cost (PHP)',{exact:true}).fill('30.00');
await manager.getByLabel('Cost reference',{exact:true}).fill('Matches reserve carton invoice');
const confirmedCost=manager.waitForResponse(r=>r.url().endsWith('/api/v1/inventory/counts/'+count.id+'/confirm-cost')&&r.request().method()==='POST');
await button(manager,'Confirm count cost').click();
assert.equal((await confirmedCost).status(),200);
await manager.getByText('Additional stock cost confirmed.',{exact:true}).waitFor();

await manager.getByRole('navigation').getByRole('button',{name:'Sales & margin',exact:true}).click();
await manager.getByRole('heading',{name:'Sales & margin',exact:true,level:1}).waitFor();
await manager.getByText('\u20b1425.00',{exact:true}).first().waitFor();
await responsive(manager,'x03-manager-sales-report');

await button(cashier,'Shift closing').click();
await enter(cashier,'Counted cash (PHP)','1425');
const countShift=cashier.waitForResponse(r=>r.url().endsWith('/submit-count')&&r.request().method()==='POST');
await button(cashier,'Submit count').click();
assert.equal((await countShift).status(),200);

await manager.getByRole('navigation').getByRole('button',{name:'Shift review',exact:true}).click();
const closeShift=manager.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
await button(manager,'Approve close').click();
assert.equal((await closeShift).status(),200);
await manager.getByText('Shift closed.',{exact:true}).waitFor();

await button(manager,'Sign out').click();
await button(cashier,'Sign out').click();
await button(barista,'Sign out').click();
assert.deepEqual(errors,[]);
console.log('PASS X03 admin receiving, recipe publication, sale, ready/waste, shortage alert, count adjustment, reporting '+JSON.stringify({
  order1Id:order1.id,
  order2Id:order2.id,
  productId,
  oatId,
  cupId,
  countId:count.id,
}));
'@
  $ending=@'
} catch(error) {
  for(const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()) {
    console.log('DIAGNOSTIC '+index+' '+await page.locator('body').ariaSnapshot());
    await page.screenshot({path:'scratch/x03-failure-'+index+'.png'});
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

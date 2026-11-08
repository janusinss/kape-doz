param(
    [Parameter(Mandatory)][uri]$PortalUrl,
    [Parameter(Mandatory)][uri]$FixtureHubUrl
)

$ErrorActionPreference = 'Stop'
if (-not $PortalUrl.IsLoopback -or -not $FixtureHubUrl.IsLoopback) {
    throw 'Use a loopback portal and an isolated synthetic hub.'
}
$previousTarget = $env:URL
$previousHub = $env:KAPE_DOZ_TEST_ADMIN_RECOVERY_HUB
Push-Location (Join-Path $PSScriptRoot '..\..')
try {
    $env:URL = $PortalUrl.AbsoluteUri
    $env:KAPE_DOZ_TEST_ADMIN_RECOVERY_HUB = $FixtureHubUrl.GetLeftPart([UriPartial]::Authority)
    $audit = @'
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const target=await helpers.resolveTargetUrl();
assert.ok(target);
const hub=process.env.KAPE_DOZ_TEST_ADMIN_RECOVERY_HUB;
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:800}});
page.setDefaultTimeout(15000);
const unexpected=[];
const dropped=[];
const endpoint=new URL('/api/v1/ingredients',target).href;
page.on('pageerror',error=>unexpected.push(error.message));
page.on('console',message=>{
  if(message.type()==='error' && !(message.text().includes('net::ERR_FAILED') && message.location().url===endpoint)) {
    unexpected.push(message.text()+' '+message.location().url);
  }
});
const button=name=>page.getByRole('button',{name,exact:true});
const field=name=>page.getByLabel(name,{exact:true});
const audit=async name=>{
  for(const [width,height] of [[375,667],[768,1024],[1280,800]]) {
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,name+' overflow '+width);
    await page.screenshot({path:'scratch/terminal-admin-'+name+'-'+width+'.png'});
  }
  console.log('PASS '+name+' layout 375/768/1280');
};
try {
  await page.goto(target,{waitUntil:'domcontentloaded'});
  await field('Account ID').fill('transport-owner');
  await field('Password').fill('Transport-Fixture-Owner-Password!');
  await button('Sign in').click();
  await page.getByRole('navigation').getByRole('button',{name:'Inventory',exact:true}).click();
  const tag=randomUUID().slice(0,8);
  let postCount=0, dropNext=true;
  await page.route(endpoint,async route=>{
    if(route.request().method()!=='POST') return route.continue();
    postCount++;
    if(!dropNext) return route.continue();
    dropNext=false;
    const response=await route.fetch();
    dropped.push({payload:route.request().postDataJSON(),authorization:route.request().headers().authorization,status:response.status()});
    await route.abort('failed');
  });
  const create=async(id,name)=>{
    await field('Ingredient ID').fill(id);
    await field('Ingredient name').fill(name);
    await button('Add ingredient').click();
  };
  await create('recovery-'+tag,'Recovery ingredient '+tag);
  await button('Retry previous command').waitFor();
  assert.equal(dropped[0].status,200);
  await audit('pending');
  await button('Retry previous command').click();
  await button('Retry previous command').waitFor({state:'hidden'});
  await page.locator('button:not(:disabled)').filter({hasText:/^Add ingredient$/}).waitFor();
  assert.equal(await button('Add ingredient').isEnabled(),true);
  assert.equal(postCount,1);
  console.log('PASS admin recovered accepted ingredient command without duplicate POST '+JSON.stringify({commandId:dropped[0].payload.commandId,ingredientId:dropped[0].payload.ingredientId}));
  dropNext=true;
  await create('beans','Duplicate fixture ingredient');
  await button('Retry previous command').waitFor();
  assert.equal(dropped[1].status,409);
  await button('Retry previous command').click();
  await button('Retry previous command').waitFor({state:'hidden'});
  await page.getByText(/Previous command was not applied/).waitFor();
  await page.locator('button:not(:disabled)').filter({hasText:/^Add ingredient$/}).waitFor();
  assert.equal(await button('Add ingredient').isEnabled(),true);
  assert.equal(postCount,2);
  await audit('rejected');
  const rejected=dropped[1];
  const statusResponse=await page.request.get(hub+'/api/v1/commands/'+rejected.payload.commandId,{headers:{authorization:rejected.authorization}});
  assert.equal(statusResponse.status(),200);
  const status=await statusResponse.json();
  assert.equal(status.status,'rejected');
  assert.equal(status.action,'ingredient.create');
  const delayed=await page.request.post(hub+'/api/v1/ingredients',{headers:{authorization:rejected.authorization},data:rejected.payload});
  assert.equal(delayed.status(),409);
  await create('after-recovery-'+tag,'New ingredient after recovery '+tag);
  await page.getByText('Ingredient created.',{exact:true}).waitFor();
  assert.equal(postCount,3);
  await audit('usable');
  console.log('PASS admin rejected command remained fenced and new command succeeded '+JSON.stringify({commandId:rejected.payload.commandId,rejection:status,newIngredientId:'after-recovery-'+tag}));
  await button('Sign out').click();
  await page.getByRole('heading',{name:'Administrator sign-in',exact:true}).waitFor();
  assert.equal(await page.getByRole('navigation').count(),0);
  assert.deepEqual(unexpected,[]);
  console.log('PASS admin sign-out privacy and zero unexpected page/console errors');
} catch(error) {
  await page.screenshot({path:'scratch/terminal-admin-failure.png',fullPage:true});
  console.log('FAIL '+error.message);
  throw error;
} finally {await browser.close();}
'@
    node .agents/skills/playwright-skill/run.js -e $audit
    $auditExit = $LASTEXITCODE
} finally {
    $env:URL = $previousTarget
    $env:KAPE_DOZ_TEST_ADMIN_RECOVERY_HUB = $previousHub
    Pop-Location
}
exit $auditExit

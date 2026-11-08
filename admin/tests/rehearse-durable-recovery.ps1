param(
    [Parameter(Mandatory)][uri]$PortalUrl,
    [Parameter(Mandatory)][uri]$FixtureHubUrl
)
$ErrorActionPreference = 'Stop'
if (-not $PortalUrl.IsLoopback -or -not $FixtureHubUrl.IsLoopback) {
    throw 'Use an isolated local portal and a fresh synthetic hub.'
}
$previousTarget = $env:URL
$previousHub = $env:KAPE_DOZ_TEST_DURABLE_HUB
Push-Location (Join-Path $PSScriptRoot '..\..')
try {
    $env:URL = $PortalUrl.AbsoluteUri
    $env:KAPE_DOZ_TEST_DURABLE_HUB = $FixtureHubUrl.GetLeftPart([UriPartial]::Authority)
    $audit = @'
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const target=await helpers.resolveTargetUrl();
assert.ok(target);
const hub=process.env.KAPE_DOZ_TEST_DURABLE_HUB;
const scratch=path.resolve('scratch');
const profile=fs.mkdtempSync(path.join(scratch,'admin-durable-profile-'));
const endpoint=new URL('/api/v1/ingredients',target).href;
const unexpected=[];
const posts=[];
const outcomes=[];
let context,page,drop=null,authorityId;
const button=(p,name)=>p.getByRole('button',{name,exact:true});
const field=(p,name)=>p.getByLabel(name,{exact:true});
const enabledAdd=p=>p.locator('button:not(:disabled)').filter({hasText:/^Add ingredient$/});
async function attach(p) {
  p.setDefaultTimeout(15000);
  p.on('pageerror',error=>unexpected.push(error.message));
  p.on('console',message=>{
    if(message.type()==='error' && !(message.text().includes('net::ERR_FAILED') && message.location().url===endpoint)) {
      unexpected.push(message.text()+' '+message.location().url);
    }
  });
  await p.route(endpoint,async route=>{
    if(route.request().method()!=='POST') return route.continue();
    const request=route.request();
    const payload=request.postDataJSON();
    const headers=request.headers();
    assert.equal(headers['x-kape-doz-authority'],authorityId,'authenticated mutation must bind authority');
    posts.push({payload,authorization:headers.authorization});
    const mode=drop;
    drop=null;
    if(mode==='unrecorded') return route.abort('failed');
    if(mode) {
      const response=await route.fetch();
      assert.equal(response.status(),mode==='accepted'?200:409);
      outcomes.push({commandId:payload.commandId,mode,status:response.status()});
      return route.abort('failed');
    }
    return route.continue();
  });
}
async function launch() {
  context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:1280,height:800}});
  page=context.pages()[0]??await context.newPage();
  await attach(page);
  await page.goto(target,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Administrator sign-in',exact:true}).waitFor();
}
async function signIn(p,role='owner') {
  await field(p,'Account ID').fill('transport-'+role);
  await field(p,'Password').fill('Transport-Fixture-'+(role==='owner'?'Owner':'Manager')+'-Password!');
  const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/authority');
  await button(p,'Sign in').click();
  const result=await response;
  assert.equal(result.status(),200);
  const identity=await result.json();
  assert.equal(identity.branchId,'transport-branch');
  if(authorityId) assert.equal(identity.authorityId,authorityId);
  authorityId=identity.authorityId;
  await p.getByRole('navigation').waitFor();
}
async function inventory(p) {
  await p.getByRole('navigation').getByRole('button',{name:'Inventory',exact:true}).click();
  await field(p,'Ingredient ID').waitFor();
}
async function create(p,id,name) {
  await enabledAdd(p).waitFor();
  await field(p,'Ingredient ID').fill(id);
  await field(p,'Ingredient name').fill(name);
  await button(p,'Add ingredient').click();
}
async function audit(p,name) {
  for(const [width,height] of [[375,667],[768,1024],[1280,800]]) {
    await p.setViewportSize({width,height});
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,name+' overflow '+width);
    await p.screenshot({path:'scratch/admin-durable-'+name+'-'+width+'.png'});
  }
  console.log('PASS '+name+' layout 375/768/1280');
}
async function restart() {
  await context.close();
  context=null;
  await launch();
  assert.equal(await page.getByRole('navigation').count(),0,'session credentials must not survive restart');
}
async function storedJournal(p,changeVersion=false) {
  return p.evaluate(change=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('kape-doz-admin-recovery',1);
    open.onerror=()=>reject(new Error('Recovery database unavailable during audit'));
    open.onsuccess=()=>{
      const db=open.result;
      const tx=db.transaction(['keys','state'],change?'readwrite':'readonly');
      const key=tx.objectStore('keys').get('active');
      const record=tx.objectStore('state').get('journal');
      let result;
      record.onsuccess=()=>{
        const raw=record.result;
        if(change){const next=JSON.stringify({...JSON.parse(raw),schemaVersion:999});tx.objectStore('state').put(next,'journal');result={raw:next};}
        else result={raw,extractable:key.result.key.extractable,algorithm:key.result.key.algorithm.name,type:key.result.key.type};
      };
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onabort=tx.onerror=()=>{db.close();reject(new Error('Recovery database audit transaction failed'))};
    };
  }),changeVersion);
}
try {
  await launch();
  await signIn(page);
  await inventory(page);
  const tag=randomUUID().slice(0,8);
  drop='accepted';
  await create(page,'durable-'+tag,'Durable private ingredient '+tag);
  await button(page,'Retry previous command').waitFor();
  const accepted=posts.at(-1);
  const acceptedCount=posts.length;
  const encrypted=await storedJournal(page);
  assert.equal(encrypted.extractable,false);
  assert.equal(encrypted.algorithm,'AES-GCM');
  assert.equal(encrypted.type,'secret');
  assert.equal(encrypted.raw.includes('Durable private ingredient '+tag),false);
  assert.equal(encrypted.raw.includes(accepted.payload.commandId),false);
  assert.equal(JSON.parse(encrypted.raw).schemaVersion,1);
  console.log('PASS actual IndexedDB stores a nonextractable AES-GCM key and encrypted pending descriptor');
  await audit(page,'pending');
  await restart();
  assert.equal(await page.getByText('Durable private ingredient '+tag,{exact:true}).count(),0,'signed-out UI must hide journal payload');
  await signIn(page,'manager');
  await inventory(page);
  assert.equal(await button(page,'Retry previous command').count(),0,'different account must not replay');
  assert.equal(await button(page,'Add ingredient').isEnabled(),false);
  assert.equal(posts.length,acceptedCount);
  await audit(page,'wrong-account');
  await button(page,'Sign out').click();
  await signIn(page);
  await page.getByText(/Previous command confirmed by the hub/).waitFor();
  await inventory(page);
  await enabledAdd(page).waitFor();
  assert.equal(posts.length,acceptedCount,'accepted receipt recovery must not resend');
  console.log('PASS full browser restart and original-account recovery without duplicate POST '+JSON.stringify({authorityId,commandId:accepted.payload.commandId,ingredientId:accepted.payload.ingredientId}));

  drop='unrecorded';
  await create(page,'unrecorded-'+tag,'Unrecorded durable ingredient '+tag);
  await button(page,'Retry previous command').waitFor();
  const unrecorded=posts.at(-1);
  const beforeRetry=posts.length;
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Administrator sign-in',exact:true}).waitFor();
  await signIn(page);
  await button(page,'Retry previous command').waitFor();
  assert.equal(posts.length,beforeRetry,'sign-in must not silently retry an unrecorded command');
  await button(page,'Retry previous command').click();
  await page.getByText(/Previous command confirmed by the hub/).waitFor();
  await button(page,'Retry previous command').waitFor({state:'hidden'});
  await inventory(page);
  await enabledAdd(page).waitFor();
  assert.equal(posts.length,beforeRetry+1);
  assert.deepEqual(posts.at(-1).payload,unrecorded.payload,'retry must preserve exact ID and payload');
  console.log('PASS page reload retains unrecorded command for exact retry '+JSON.stringify({commandId:unrecorded.payload.commandId,ingredientId:unrecorded.payload.ingredientId}));

  drop='rejected';
  await create(page,'beans','Duplicate saved ingredient');
  await button(page,'Retry previous command').waitFor();
  const rejected=posts.at(-1);
  const beforeRejectedRestart=posts.length;
  await restart();
  await signIn(page);
  await page.getByText(/Previous command was not applied to the hub/).waitFor();
  await inventory(page);
  await enabledAdd(page).waitFor();
  assert.equal(posts.length,beforeRejectedRestart,'rejected receipt recovery must not resend');
  await audit(page,'rejected');
  console.log('PASS full browser restart recovers terminal rejection '+JSON.stringify({commandId:rejected.payload.commandId}));

  const other=await context.newPage();
  await attach(other);
  await other.goto(target,{waitUntil:'domcontentloaded'});
  await signIn(other);
  await inventory(other);
  await inventory(page);
  await enabledAdd(page).waitFor();
  await enabledAdd(other).waitFor();
  await field(page,'Ingredient ID').fill('tab-a-'+tag);
  await field(page,'Ingredient name').fill('Competing tab A '+tag);
  await field(other,'Ingredient ID').fill('tab-b-'+tag);
  await field(other,'Ingredient name').fill('Competing tab B '+tag);
  const beforeTabs=posts.length;
  drop='accepted';
  await Promise.allSettled([button(page,'Add ingredient').click({timeout:3000}),button(other,'Add ingredient').click({timeout:3000})]);
  await button(page,'Retry previous command').waitFor();
  await button(other,'Retry previous command').waitFor();
  assert.equal(posts.length,beforeTabs+1,'cross-tab journal must permit only one new command');
  const winner=posts.at(-1);
  await button(page,'Retry previous command').click();
  await button(page,'Retry previous command').waitFor({state:'hidden'});
  await button(other,'Retry previous command').waitFor({state:'hidden'});
  await enabledAdd(page).waitFor();
  await enabledAdd(other).waitFor();
  assert.equal(posts.length,beforeTabs+1);
  await audit(page,'recovered');
  console.log('PASS two browser tabs preserve one unresolved command '+JSON.stringify({commandId:winner.payload.commandId,ingredientId:winner.payload.ingredientId}));
  await button(other,'Sign out').click();
  await button(page,'Sign out').click();
  const corrupted=await storedJournal(page,true);
  const beforeCorruption=posts.length;
  await page.reload({waitUntil:'domcontentloaded'});
  await button(page,'Retry saved state').waitFor();
  assert.equal(await button(page,'Sign in').isEnabled(),false);
  await button(page,'Retry saved state').click();
  await button(page,'Retry saved state').waitFor();
  assert.deepEqual((await storedJournal(page)).raw,corrupted.raw,'unsupported state must not reset saved bytes');
  assert.equal(posts.length,beforeCorruption);
  await audit(page,'storage-error');
  console.log('PASS unsupported encrypted journal blocks changes and preserves stored bytes');
  assert.deepEqual(unexpected,[]);
  console.log('PASS fresh sign-in after browser restart, cross-tab notifications and zero unexpected page/console errors');
} catch(error) {
  if(page && !page.isClosed()) await page.screenshot({path:'scratch/admin-durable-failure.png',fullPage:true});
  console.log('FAIL '+error.message);
  throw error;
} finally {
  if(context) await context.close();
  const resolved=path.resolve(profile);
  assert.equal(path.dirname(resolved),scratch);
  assert.ok(path.basename(resolved).startsWith('admin-durable-profile-'));
  fs.rmSync(resolved,{recursive:true,force:true});
}
'@
    node .agents/skills/playwright-skill/run.js -e $audit
    $auditExit = $LASTEXITCODE
} finally {
    $env:URL = $previousTarget
    $env:KAPE_DOZ_TEST_DURABLE_HUB = $previousHub
    Pop-Location
}
exit $auditExit

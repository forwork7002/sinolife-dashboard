import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('/home/kali/Documents/ISH/.env','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,'')]}))
const PAGES=[['overview','/'],['leaderboard','/leaderboard'],['channels','/analytics/channels'],
  ['marketing','/marketing'],['warehouse','/warehouse'],['account','/account'],['calls','/calls']]
const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']})
const ctx=await b.newContext({viewport:{width:1440,height:900},colorScheme:'dark',locale:'uz-UZ'})
const p=await ctx.newPage()
const errs=[]
p.on('pageerror',e=>errs.push('PAGEERROR: '+String(e).slice(0,160)))
p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160))})
await p.goto('http://localhost:3000/login',{waitUntil:'networkidle'})
await p.fill('input[type="email"], input[name="email"]', env.ADMIN_EMAIL)
await p.fill('input[type="password"], input[name="password"]', env.ADMIN_PASSWORD)
await p.click('button[type="submit"]')
await p.waitForURL(u=>!u.pathname.includes('login'),{timeout:30000})
for(const [n,path] of PAGES){
  await p.goto('http://localhost:3000'+path,{waitUntil:'networkidle'})
  await p.waitForTimeout(2600)
  await p.screenshot({path:`shots/f-${n}.png`})
  console.log('ok', n)
}
console.log('console errors:', errs.length)
errs.slice(0,8).forEach(e=>console.log('  -',e))
await b.close()

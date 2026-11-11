import http from 'node:http';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
initializeApp({credential:applicationDefault()});

const PORT = Number(process.env.PORT || 8787);
const API_URL = process.env.COACH_PROVIDER_URL;
const API_KEY = process.env.COACH_PROVIDER_API_KEY;
const MODEL = process.env.COACH_MODEL || 'gpt-4.1-mini';
const ORIGIN = process.env.ALLOWED_ORIGIN || '';
const WINDOW_MS = 60_000, MAX_REQUESTS = 20;
const buckets = new Map();

function send(res, status, data) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve,reject)=>{let body='',tooLarge=false;req.on('data',chunk=>{if(tooLarge)return;body+=chunk;if(body.length>30_000){tooLarge=true;reject(Object.assign(new Error('Request too large'),{status:413}));}});req.on('end',()=>{if(tooLarge)return;try{resolve(JSON.parse(body||'{}'));}catch{reject(Object.assign(new Error('Invalid JSON'),{status:400}));}});req.on('error',reject;});
}
const server=http.createServer(async(req,res)=>{
  const requestOrigin=req.headers.origin;if(requestOrigin && (!ORIGIN || requestOrigin!==ORIGIN))return send(res,403,{error:'Origin not allowed'});if(requestOrigin){res.setHeader('access-control-allow-origin',ORIGIN||requestOrigin);res.setHeader('vary','Origin');}
  if(req.method==='OPTIONS') { if(req.headers.origin && (!ORIGIN || req.headers.origin!==ORIGIN)) return send(res,403,{error:'Origin not allowed'});res.writeHead(204,{'access-control-allow-origin':ORIGIN||'null','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type, authorization','vary':'Origin'});return res.end(); }
  if(req.url!=='/api/coach'||req.method!=='POST')return send(res,404,{error:'Not found'});
  if(req.headers.origin && (!ORIGIN || req.headers.origin!==ORIGIN))return send(res,403,{error:'Origin not allowed'});
  const ip=req.socket.remoteAddress||'unknown',now=Date.now(),bucket=buckets.get(ip)||{start:now,count:0};if(now-bucket.start>WINDOW_MS){bucket.start=now;bucket.count=0;}bucket.count++;buckets.set(ip,bucket);if(bucket.count>MAX_REQUESTS)return send(res,429,{error:'Rate limit exceeded'});
  if(!API_URL||!API_KEY)return send(res,503,{error:'Coach provider is not configured on the server'});
  try{
    const authHeader=String(req.headers.authorization||'');if(!authHeader.startsWith('Bearer '))return send(res,401,{error:'Firebase sign-in required'});
    try{await getAuth().verifyIdToken(authHeader.slice(7));}catch{return send(res,401,{error:'Invalid or expired sign-in token'});}
    const input=await readBody(req);const question=String(input.question||'').trim();if(!question||question.length>3000)return send(res,400,{error:'Question must be 1–3000 characters'});
    const context={trainingSessions:Array.isArray(input.trainingSessions)?input.trainingSessions.slice(-10):[],legacyWorkoutLogs:Array.isArray(input.legacyWorkoutLogs)?input.legacyWorkoutLogs.slice(-7):[],nutritionToday:Array.isArray(input.nutritionToday)?input.nutritionToday.slice(0,40):[],recoveryToday:input.recoveryToday&&typeof input.recoveryToday==='object'?input.recoveryToday:null,bodyLatest:input.bodyLatest&&typeof input.bodyLatest==='object'?input.bodyLatest:null};
    const system='You are Iron Log, a cautious fitness information assistant. Use only supplied user data; state when data is missing. Do not diagnose, prescribe treatment, or claim certainty. Give conservative training/nutrition information, flag injury symptoms for professional assessment, and never fabricate measurements or food values. Distinguish observations from suggestions.';
    const upstream=await fetch(API_URL,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${API_KEY}`},body:JSON.stringify({model:MODEL,messages:[{role:'system',content:system},{role:'user',content:`Question: ${question}\n\nFitness context JSON:\n${JSON.stringify(context)}`}],temperature:0.2,max_tokens:700}),signal:AbortSignal.timeout(30_000)});
    if(!upstream.ok){return send(res,502,{error:`Provider error ${upstream.status}`});}
    const result=await upstream.json();const answer=result.choices?.[0]?.message?.content;if(!answer)return send(res,502,{error:'Provider returned no answer'});
    res.setHeader('access-control-allow-origin',ORIGIN||'null');res.setHeader('vary','Origin');return send(res,200,{answer,model:MODEL,generatedAt:new Date().toISOString(),disclaimer:'General fitness information, not medical advice.'});
  }catch(error){return send(res,error.status|| (error.name==='TimeoutError'||error.name==='AbortError'?504:400),{error:error.status?error.message:(error.name==='TimeoutError'||error.name==='AbortError'?'Coach provider timed out':'Request failed')});}
});
server.listen(PORT,()=>console.log(`Iron Log coach API listening on ${PORT}`));

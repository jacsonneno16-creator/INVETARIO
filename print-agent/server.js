'use strict';
const http=require('http'), fs=require('fs'), path=require('path'), os=require('os'), cp=require('child_process'), crypto=require('crypto');
const PORT=Number(process.env.PORT||9101), HOST=process.env.HOST||'0.0.0.0', DATA=path.join(__dirname,'data','docs');
fs.mkdirSync(DATA,{recursive:true});
function cors(res){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Filename');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
function json(res,status,obj){cors(res);res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));}
function body(req,limit){return new Promise((resolve,reject)=>{let bufs=[],n=0;req.on('data',b=>{n+=b.length;if(n>(limit||25*1024*1024)){reject(new Error('arquivo muito grande'));req.destroy();return;}bufs.push(b)});req.on('end',()=>resolve(Buffer.concat(bufs)));req.on('error',reject)});}
function baseUrl(req){return 'http://'+(req.headers.host||('127.0.0.1:'+PORT));}
async function download(url,dest){return new Promise((resolve,reject)=>{const u=new URL(url),mod=u.protocol==='https:'?require('https'):require('http');mod.get(u,r=>{if(r.statusCode>=300&&r.statusCode<400&&r.headers.location)return download(r.headers.location,dest).then(resolve,reject);if(r.statusCode!==200)return reject(new Error('download HTTP '+r.statusCode));const w=fs.createWriteStream(dest);r.pipe(w);w.on('finish',()=>w.close(resolve));w.on('error',reject)}).on('error',reject)});}
function printPdf(file,printerName){
  const custom=process.env.PRINT_COMMAND;
  if(custom){const cmd=custom.replace(/\{file\}/g,'"'+file.replace(/"/g,'')+'"').replace(/\{printer\}/g,'"'+String(printerName||'').replace(/"/g,'')+'"');cp.execSync(cmd,{stdio:'ignore'});return;}
  if(process.platform==='win32'){
    const ps=`$p='${file.replace(/'/g,"''")}'; Start-Process -FilePath $p -Verb Print`;
    cp.execFileSync('powershell.exe',['-NoProfile','-Command',ps],{stdio:'ignore'});return;
  }
  const args=[]; if(printerName)args.push('-d',printerName);args.push(file);cp.execFileSync('lp',args,{stdio:'ignore'});
}
const server=http.createServer(async(req,res)=>{try{
  cors(res); if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,host:os.hostname(),service:'dt-print-agent'});
  if(req.method==='POST'&&req.url==='/documents'){
    const b=await body(req,25*1024*1024); if(!b.length)return json(res,400,{ok:false,error:'PDF vazio'});
    const id=Date.now()+'-'+crypto.randomBytes(5).toString('hex')+'.pdf', file=path.join(DATA,id);fs.writeFileSync(file,b);
    return json(res,200,{ok:true,id,url:baseUrl(req)+'/documents/'+id});
  }
  if(req.method==='GET'&&req.url.startsWith('/documents/')){const id=path.basename(req.url),file=path.join(DATA,id);if(!fs.existsSync(file))return json(res,404,{ok:false});cors(res);res.writeHead(200,{'Content-Type':'application/pdf'});return fs.createReadStream(file).pipe(res);}
  if(req.method==='POST'&&req.url==='/print'){
    const data=JSON.parse((await body(req,1024*1024)).toString('utf8')||'{}');if(!data.documentUrl)return json(res,400,{ok:false,error:'documentUrl obrigatório'});
    const tmp=path.join(DATA,'print-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex')+'.pdf');await download(data.documentUrl,tmp);printPdf(tmp,data.printerName||'');setTimeout(()=>fs.unlink(tmp,()=>{}),30000);return json(res,200,{ok:true});
  }
  return json(res,404,{ok:false,error:'rota não encontrada'});
}catch(e){return json(res,500,{ok:false,error:e.message||String(e)});}});
server.listen(PORT,HOST,()=>console.log(`DT Print Agent em http://${HOST}:${PORT}`));

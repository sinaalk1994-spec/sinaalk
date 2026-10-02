"""One entry point for the STLP website and ERP."""
import sys,os,subprocess,http.client,threading,time,json,hmac,hashlib,secrets
from pathlib import Path
from urllib.parse import urlparse
from http.server import ThreadingHTTPServer
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'website'))
import store_server as store
ERP_PORT=int(os.environ.get('STLP_ERP_PORT','3878'))
CSRF_SECRET=secrets.token_bytes(32)
class UnifiedHandler(store.Handler):
 def session(self):
  cookie=self.headers.get('Cookie','')
  if not cookie:return None
  conn=http.client.HTTPConnection('127.0.0.1',ERP_PORT,timeout=5)
  try:
   conn.request('GET','/api/auth/me',headers={'Cookie':cookie});response=conn.getresponse();data=json.loads(response.read())
   user=data.get('user')
   if response.status!=200 or not user or not(user.get('isAdmin') or user.get('permissions',{}).get('onlineStore') is True):return None
   # ERP rechecks current account state and permission on every request.
   csrf=hmac.new(CSRF_SECRET,cookie.encode(),hashlib.sha256).hexdigest()
   return {'csrf':csrf,'user':user}
  except Exception:return None
  finally:conn.close()

 def erp_path(self):
  path=urlparse(self.path).path
  return path.startswith('/erp/') or path.startswith('/api/auth/') or path.startswith('/api/store/') or path.startswith('/api/counter/') or path.startswith('/api/employees/') or path.startswith('/api/letters/') or path.startswith('/api/activity-log/') or path.startswith('/api/crm/') or path in ('/api/bootstrap','/api/admin/import-backup')
 def proxy(self):
  path=self.path[4:] if self.path.startswith('/erp/') else self.path
  try:
   length=int(self.headers.get('Content-Length','0'))
   if length>4_000_000:self.send_error(413);return
   body=self.rfile.read(length) if length else None
   headers={k:v for k,v in self.headers.items() if k.lower() not in ('host','connection','transfer-encoding')}
   conn=http.client.HTTPConnection('127.0.0.1',ERP_PORT,timeout=20)
   try:
    conn.request(self.command,path,body,headers);response=conn.getresponse();raw=response.read()
    self.send_response(response.status)
    for k,v in response.getheaders():
     if k.lower() not in ('connection','transfer-encoding','content-length','x-frame-options'):self.send_header(k,v)
    self.send_header('X-Frame-Options','SAMEORIGIN');self.send_header('Content-Length',str(len(raw)));self.end_headers()
    if self.command!='HEAD':self.wfile.write(raw)
   finally:conn.close()
  except Exception:self.send_error(502,'ERP is unavailable')
 def do_GET(self):
  if self.path=='/':self.path='/index.html'
  if self.path=='/erp':self.send_response(302);self.send_header('Location','/erp/home.html');self.end_headers();return
  if self.erp_path():self.proxy()
  else:super().do_GET()
 def do_HEAD(self):
  if self.erp_path():self.proxy()
  else:super().do_HEAD()
 def do_POST(self):
  if urlparse(self.path).path=='/api/login':self.reply({'error':'از ورود ERP استفاده کنید'},403);return
  if urlparse(self.path).path=='/api/logout':self.reply({'error':'از خروج ERP استفاده کنید'},403);return
  if self.erp_path():self.proxy()
  else:super().do_POST()
 def do_PUT(self):
  if self.erp_path():self.proxy()
  else:self.send_error(405)
 def do_DELETE(self):
  if self.erp_path():self.proxy()
  else:self.send_error(405)
if __name__=='__main__':
 env=dict(os.environ,PORT=str(ERP_PORT),BIND_HOST='127.0.0.1')
 process=subprocess.Popen(['node',str(ROOT/'erp/server/server.js')],cwd=ROOT/'erp/server',env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 server=None
 try:
  for _ in range(40):
   if process.poll() is not None:raise RuntimeError('ERP failed to start. Check Node.js version and port.')
   try:
    c=http.client.HTTPConnection('127.0.0.1',ERP_PORT,timeout=.5);c.request('GET','/login.html');r=c.getresponse();r.read();c.close();break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('ERP did not start')
  store.backup_store();threading.Thread(target=store.backup_worker,daemon=True).start()
  port=int(os.environ.get('STLP_PORT','8770'));server=ThreadingHTTPServer(('127.0.0.1',port),UnifiedHandler)
  print('Website: http://127.0.0.1:'+str(port)+'/\nERP: http://127.0.0.1:'+str(port)+'/erp/home.html',flush=True)
  server.serve_forever()
 except KeyboardInterrupt:pass
 finally:
  if server:server.server_close()
  process.terminate();process.wait(timeout=10)

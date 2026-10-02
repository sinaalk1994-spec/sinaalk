"""STLP local/shared store server. Python standard library only."""
import os,json,sqlite3,secrets,hashlib,hmac,base64,re,time,threading,datetime,contextlib
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from http.cookies import SimpleCookie
from urllib.parse import urlparse,unquote

ROOT=Path(__file__).resolve().parent
DATA=Path(os.environ.get('STLP_DATA_DIR',str(ROOT/'store-data')));DATA.mkdir(exist_ok=True,parents=True)
DB=DATA/'store.sqlite3'
PASSWORD=os.environ.get('STLP_ADMIN_PASSWORD')
keyfile=DATA/'admin-password.txt'
if not PASSWORD:
 if not keyfile.exists():keyfile.write_text(secrets.token_urlsafe(20),encoding='utf-8')
 PASSWORD=keyfile.read_text(encoding='utf-8').strip()
SALT=hashlib.sha256(str(DB).encode()).digest()
PASSHASH=hashlib.pbkdf2_hmac('sha256',PASSWORD.encode(),SALT,200000)
sessions={};attempts={};lock=threading.Lock()
def raw_connection():
 c=sqlite3.connect(DB,timeout=15);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON');return c
@contextlib.contextmanager
def connection():
 c=raw_connection()
 try:
  yield c;c.commit()
 except:
  c.rollback();raise
 finally:
  c.close()
with connection() as c:
 c.executescript('''CREATE TABLE IF NOT EXISTS products(code TEXT PRIMARY KEY,title TEXT NOT NULL,type TEXT NOT NULL,size TEXT,volume TEXT,brand TEXT,pack INTEGER NOT NULL CHECK(pack>=0),unit INTEGER,stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),min_stock INTEGER DEFAULT 5,image TEXT,active INTEGER DEFAULT 1);
 CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY,mime TEXT NOT NULL,data BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY,code TEXT REFERENCES products(code),delta INTEGER NOT NULL,reason TEXT NOT NULL,reference TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,customer TEXT NOT NULL,items TEXT NOT NULL,total INTEGER NOT NULL,status TEXT DEFAULT 'pending',created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,order_id TEXT REFERENCES orders(id),mime TEXT NOT NULL,data BLOB NOT NULL,uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP);''')
 try:c.execute('ALTER TABLE orders ADD COLUMN invoice_number TEXT')
 except sqlite3.OperationalError:pass
 try:c.execute('ALTER TABLE orders ADD COLUMN receipt_rejection_note TEXT')
 except sqlite3.OperationalError:pass
 try:c.execute('ALTER TABLE orders ADD COLUMN delivery TEXT')
 except sqlite3.OperationalError:pass
 try:c.execute('ALTER TABLE orders ADD COLUMN invoice_date TEXT')
 except sqlite3.OperationalError:pass
 try:c.execute('ALTER TABLE orders ADD COLUMN postal_tracking_code TEXT')
 except sqlite3.OperationalError:pass
 # سیستمِ قدیمِ وضعیت سفارش («pending» -> «confirmed»/«cancelled» با یک
 # کلیک) با این مرحله‌بندیِ جدید جایگزین شد (آپلود فیش -> بررسی ->
 # بارگیری -> تحویل). سفارش‌هایی که هنوز روی «pending» قدیمی مانده‌اند
 # (هر بار سرور بالا می‌آید، بی‌خطر و بدون اثر روی بقیه) به اولین
 # مرحله‌ی جدید منتقل می‌شوند تا در کارتابل گم نشوند.
 c.execute("UPDATE orders SET status='awaiting_receipt' WHERE status='pending'")
 if c.execute('SELECT COUNT(*) FROM products').fetchone()[0]==0:
  for p in json.loads((ROOT/'catalog-seed.json').read_text(encoding='utf-8-sig')):
   color={'CBC':'purple','PT-PTT':'blue','CAT':'red','SST':'yellow','Heparin':'green'}.get(p['type'],'grey')
   c.execute('INSERT INTO products(code,title,type,size,volume,brand,pack,unit,image) VALUES(?,?,?,?,?,?,?,?,?)',(p['code'],p['code']+' — '+p['type'],p['type'],p['size'],p['volume'],p['brand'],p['pack'],p['unit'],'images/products/'+color+'_700.png'))

def integer(value,low=0,high=10**12):
 if isinstance(value,bool) or not isinstance(value,int) or not low<=value<=high:raise ValueError('عدد صحیح معتبر وارد کنید')
 return value
def text(value,maxlen=300):
 if not isinstance(value,str) or len(value)>maxlen:raise ValueError('متن نامعتبر یا بیش از حد طولانی است')
 return value.strip()
def validate_image_data_uri(raw,max_bytes=2_000_000):
 match=re.fullmatch(r'data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)',raw or '')
 if not match:raise ValueError('عکس PNG، JPEG یا WebP انتخاب کنید')
 blob=base64.b64decode(match[2],validate=True)
 if len(blob)>max_bytes:raise ValueError('عکس باید کمتر از ۲ مگابایت باشد')
 valid=(match[1]=='image/png' and blob.startswith(b'\x89PNG\r\n\x1a\n')) or (match[1]=='image/jpeg' and blob.startswith(b'\xff\xd8\xff')) or (match[1]=='image/webp' and blob[:4]==b'RIFF' and blob[8:12]==b'WEBP')
 if not valid:raise ValueError('فایل تصویر معتبر نیست')
 return match[1],blob
def validate_receipt_data_uri(raw,max_bytes=2_000_000):
 match=re.fullmatch(r'data:(image/(?:png|jpeg|webp)|application/pdf);base64,([A-Za-z0-9+/=]+)',raw or '')
 if not match:raise ValueError('فیش باید PNG، JPEG، WebP یا PDF باشد')
 blob=base64.b64decode(match[2],validate=True)
 if len(blob)>max_bytes:raise ValueError('فایل فیش باید کمتر از ۲ مگابایت باشد')
 valid=(match[1]=='image/png' and blob.startswith(b'\x89PNG\r\n\x1a\n')) or (match[1]=='image/jpeg' and blob.startswith(b'\xff\xd8\xff')) or (match[1]=='image/webp' and blob[:4]==b'RIFF' and blob[8:12]==b'WEBP') or (match[1]=='application/pdf' and blob.startswith(b'%PDF-'))
 if not valid:raise ValueError('فایل فیش معتبر نیست')
 return match[1],blob
def parse_order_id(raw):
 oid=text(raw,40).upper()
 if not re.fullmatch(r'WEB-[0-9A-F]{20}',oid):raise ValueError('شناسهٔ سفارش نامعتبر است')
 return oid
# مرحله‌بندیِ سفارش: هر کلیدِ این دیکشنری یک «وضعیتِ مقصد» است که
# اجازه دارد فقط از وضعیت‌های داخلِ from به آن رسید. این جایگزینِ
# چکِ سخت‌کدشده‌ی قدیمی (status not in ['confirmed','cancelled']) شد
# که فقط یک گذارِ یک‌مرحله‌ای را می‌شناخت.
ORDER_TRANSITIONS={
 'awaiting_shipment':{'from':{'under_review'},'require_invoice':True},
 'awaiting_receipt':{'from':{'under_review'},'require_rejection_note':True},
 'delivered':{'from':{'awaiting_shipment'},'require_delivery_present':True},
 'cancelled':{'from':{'awaiting_receipt','under_review','awaiting_shipment'},'restock':True},
}


BACKUP_DIR=DATA/'snapshots'
BACKUP_DIR.mkdir(exist_ok=True)
backup_lock=threading.Lock()
def backup_store():
 with backup_lock:
  target=BACKUP_DIR/('store-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')+'.sqlite3')
  source=raw_connection();dest=sqlite3.connect(target)
  try:source.backup(dest)
  finally:dest.close();source.close()
  return target
def backup_worker():
 while True:
  time.sleep(86400)
  try:backup_store()
  except Exception:print('Automatic store backup failed; check disk space.',flush=True)

class Handler(SimpleHTTPRequestHandler):
 timeout=30
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def log_message(self,fmt,*args):pass
 def end_headers(self):
  self.send_header('X-Content-Type-Options','nosniff');self.send_header('Cache-Control','no-store');super().end_headers()
 def reply(self,value,status=200):
  raw=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def session(self):
  try:
   cookie=SimpleCookie(self.headers.get('Cookie',''));token=cookie['stlp_session'].value
   with lock:s=sessions.get(token)
   return s if s and s['expires']>time.time() else None
  except Exception:return None
 def authenticated(self,write=False):
  s=self.session()
  if not s or (write and not hmac.compare_digest(self.headers.get('X-CSRF-Token',''),s['csrf'])):
   self.reply({'error':'ابتدا وارد داشبورد شوید'},401);return False
  return True
 def safe_static(self):
  path=unquote(urlparse(self.path).path)
  target=(ROOT/path.lstrip('/')).resolve()
  if not target.is_relative_to(ROOT) or any(part in ('store-data','backups') or part.startswith('.') for part in Path(path).parts) or target.suffix in ('.py','.php','.sqlite3','.txt','.json','.zip','.rar'):
   self.send_error(403);return False
  return True
 def do_HEAD(self):
  if self.safe_static():super().do_HEAD()
 def do_GET(self):
  path=urlparse(self.path).path
  if path=='/api/session':self.reply({'authenticated':bool(self.session()),'csrf':(self.session() or {}).get('csrf','')});return
  if path=='/api/products':
   with connection() as c:rows=c.execute('SELECT * FROM products WHERE active=1 ORDER BY code').fetchall()
   self.reply({'products':[dict(row) for row in rows]});return
  if path.startswith('/api/images/'):
   with connection() as c:row=c.execute('SELECT * FROM images WHERE id=?',(path.rsplit('/',1)[-1],)).fetchone()
   if not row:self.send_error(404);return
   self.send_response(200);self.send_header('Content-Type',row['mime']);self.send_header('Content-Length',str(len(row['data'])));self.end_headers();self.wfile.write(row['data']);return
  if path=='/api/backup':
   if not self.authenticated():return
   target=backup_store();raw=target.read_bytes()
   self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Content-Disposition','attachment; filename="'+target.name+'"');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
  if path=='/api/order-alerts':
   if not self.authenticated():return
   # بعد از مرحله‌بندیِ جدید، «under_review» (فیشِ آپلودشده، منتظرِ
   # بررسیِ کارمند) همان مرحله‌ای است که واقعاً نیاز به توجهِ فوری دارد
   with connection() as c:rows=c.execute("SELECT id,created FROM orders WHERE status='under_review' ORDER BY created DESC").fetchall()
   self.reply({'pending':[dict(x) for x in rows]});return
  if path=='/api/admin':
   if not self.authenticated():return
   with connection() as c:
    result={'products':[dict(x) for x in c.execute('SELECT * FROM products ORDER BY code')], 'movements':[dict(x) for x in c.execute('SELECT * FROM movements ORDER BY id DESC LIMIT 200')], 'orders':[dict(x) for x in c.execute('SELECT o.*, (SELECT id FROM receipts WHERE order_id=o.id ORDER BY uploaded_at DESC LIMIT 1) AS receipt_id FROM orders o ORDER BY created DESC LIMIT 200')]}
   self.reply(result);return
  if path.startswith('/api/receipts/'):
   if not self.authenticated():return
   with connection() as c:row=c.execute('SELECT * FROM receipts WHERE id=?',(path.rsplit('/',1)[-1],)).fetchone()
   if not row:self.send_error(404);return
   self.send_response(200);self.send_header('Content-Type',row['mime']);self.send_header('Content-Length',str(len(row['data'])));self.end_headers();self.wfile.write(row['data']);return
  if path.startswith('/api/track/'):
   try:order_id=parse_order_id(path.rsplit('/',1)[-1])
   except ValueError as e:self.reply({'error':str(e)},400);return
   with connection() as c:order=c.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone()
   if not order:self.reply({'error':'سفارش یافت نشد'},404);return
   customer=json.loads(order['customer'])
   self.reply({
    'id':order['id'],'status':order['status'],'created':order['created'],
    'items':json.loads(order['items']),'total':order['total'],
    'invoice_number':order['invoice_number'],
    'invoice_date':order['invoice_date'],
    'receipt_rejection_note':order['receipt_rejection_note'],
    'postal_tracking_code':order['postal_tracking_code'],
    'delivery':json.loads(order['delivery']) if order['delivery'] else None,
    'customer':{
     'name':customer.get('name',''),'lab':customer.get('lab',''),'phone':customer.get('phone',''),'address':customer.get('address',''),
     'customerType':customer.get('customerType',''),'nationalId':customer.get('nationalId',''),
     'companyName':customer.get('companyName',''),'regNo':customer.get('regNo',''),'econCode':customer.get('econCode',''),
     'postalCode':customer.get('postalCode','')
    }
   });return
  if path.startswith('/api/'):self.reply({'error':'مسیر موجود نیست'},404);return
  if self.safe_static():super().do_GET()
 def do_POST(self):
  try:
   origin=self.headers.get('Origin')
   if origin and urlparse(origin).netloc!=self.headers.get('Host'):self.reply({'error':'درخواست نامعتبر'},403);return
   length=int(self.headers.get('Content-Length','0'))
   if length<=0 or length>4_000_000:raise ValueError('حجم درخواست نامعتبر است')
   data=json.loads(self.rfile.read(length));path=urlparse(self.path).path
   if path=='/api/login':
    ip=self.client_address[0];now=time.time()
    with lock:
     recent=[t for t in attempts.get(ip,[]) if now-t<300];attempts[ip]=recent
    if len(recent)>=8:self.reply({'error':'تلاش زیاد؛ پنج دقیقه بعد دوباره امتحان کنید'},429);return
    candidate=hashlib.pbkdf2_hmac('sha256',text(data.get('password',''),200).encode(),SALT,200000)
    if not hmac.compare_digest(candidate,PASSHASH):
     with lock:attempts[ip].append(now)
     self.reply({'error':'رمز اشتباه است'},401);return
    token=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(24)
    with lock:sessions[token]={'csrf':csrf,'expires':now+8*3600}
    self.send_response(200);self.send_header('Set-Cookie','stlp_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+('; Secure' if origin and origin.startswith('https:') else ''));self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'csrf':csrf}).encode());return
   if path=='/api/order':
    customer=data.get('customer',{});customer={k:text(customer.get(k,''),1000 if k=='address' else 200) for k in ['name','lab','phone','email','address','note','customerType','nationalId','companyName','regNo','econCode','postalCode']}
    if customer['customerType'] not in ('individual','company'):raise ValueError('نوع مشتری نامعتبر است')
    if any(not customer[k] for k in ['name','phone','address']):raise ValueError('نام، تلفن و آدرس ضروری است')
    if customer['customerType']=='individual' and not customer['nationalId']:raise ValueError('کد ملی ضروری است')
    if customer['customerType']=='company' and (not customer['regNo'] or not customer['econCode']):raise ValueError('شماره ثبت و کد اقتصادی ضروری است')
    requested=data.get('items',[])
    if not isinstance(requested,list) or not 1<=len(requested)<=100:raise ValueError('سبد خرید نامعتبر است')
    quantities={}
    for item in requested:
     code=text(item['code'],60);quantities[code]=quantities.get(code,0)+integer(item['qty'],1,100000)
    request_key=text(data.get('key',''),80)
    if not re.fullmatch(r'[A-Za-z0-9-]{20,80}',request_key):raise ValueError('شناسهٔ درخواست نامعتبر است')
    order_id='WEB-'+hashlib.sha256(request_key.encode()).hexdigest()[:20].upper();items=[];subtotal=0
    with connection() as c:
     c.execute('BEGIN IMMEDIATE')
     existing=c.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone()
     if existing:
      previous={i['code']:i['qty'] for i in json.loads(existing['items'])}
      if previous!=quantities or json.loads(existing['customer'])!=customer:raise ValueError('شناسهٔ سفارش تکراری با اطلاعات متفاوت است')
      self.reply({'id':order_id,'total':existing['total']});return
     for code,qty in quantities.items():
      p=c.execute('SELECT * FROM products WHERE code=? AND active=1',(code,)).fetchone()
      if not p or p['stock']<qty:raise ValueError('موجودی کافی برای '+code+' وجود ندارد')
      c.execute('UPDATE products SET stock=stock-? WHERE code=?',(qty,code));c.execute('INSERT INTO movements(code,delta,reason,reference) VALUES(?,?,?,?)',(code,-qty,'رزرو سفارش آنلاین',order_id))
      items.append({'code':code,'qty':qty,'price':p['pack'],'title':p['title']});subtotal+=qty*p['pack']
     rates={'STLP-5PER':5,'STLP-10PER':10,'STLP-12PER':12,'STLP-15PER':15};rate=rates.get(text(data.get('coupon',''),50),0)
     discount=round(subtotal*rate/100);tax=0;total=subtotal-discount+tax
     c.execute("INSERT INTO orders(id,customer,items,total,status) VALUES(?,?,?,?,'awaiting_receipt')",(order_id,json.dumps(customer,ensure_ascii=False),json.dumps(items,ensure_ascii=False),total))
    self.reply({'id':order_id,'subtotal':subtotal,'discount':discount,'tax':tax,'total':total});return
   # دو مسیرِ زیر عمداً پیش از چکِ authenticated(True) هستند — درست
   # مثلِ /api/order، این دو باید بدونِ نشستِ ادمین (توسطِ خودِ مشتری،
   # فقط با داشتنِ کدِ پیگیری/شناسه‌ی سفارش) قابل‌استفاده باشند
   if path.startswith('/api/track/') and path.endswith('/receipt'):
    parts=path.split('/')
    if len(parts)!=5:raise ValueError('مسیر نامعتبر است')
    order_id=parse_order_id(parts[3])
    mime,blob=validate_receipt_data_uri(data.get('image',''))
    with connection() as c:
     c.execute('BEGIN IMMEDIATE');order=c.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone()
     if not order:raise ValueError('سفارش یافت نشد')
     if order['status']!='awaiting_receipt':raise ValueError('این سفارش در مرحله‌ی آپلود فیش نیست')
     receipt_id=secrets.token_hex(16)
     c.execute('INSERT INTO receipts(id,order_id,mime,data) VALUES(?,?,?,?)',(receipt_id,order_id,mime,blob))
     c.execute("UPDATE orders SET status='under_review', receipt_rejection_note=NULL WHERE id=?",(order_id,))
    self.reply({'ok':True,'status':'under_review'});return
   if path.startswith('/api/track/') and path.endswith('/delivery'):
    parts=path.split('/')
    if len(parts)!=5:raise ValueError('مسیر نامعتبر است')
    order_id=parse_order_id(parts[3])
    method=data.get('method')
    if method in ('courier','post'):
     delivery={'method':method,'address':text(data.get('address',''),1000),'postalCode':text(data.get('postalCode',''),20)}
     if not delivery['address']:raise ValueError('آدرس ضروری است')
    elif method=='representative':
     delivery={'method':method,'repName':text(data.get('repName',''),200),'repNationalId':text(data.get('repNationalId',''),20),'repPhone':text(data.get('repPhone',''),30)}
     if not delivery['repName'] or not delivery['repPhone']:raise ValueError('نام و تلفن نماینده ضروری است')
    else:raise ValueError('روش تحویل نامعتبر است')
    with connection() as c:
     c.execute('BEGIN IMMEDIATE');order=c.execute('SELECT status,delivery FROM orders WHERE id=?',(order_id,)).fetchone()
     if not order:raise ValueError('سفارش یافت نشد')
     if order['status']!='awaiting_shipment':raise ValueError('این سفارش در مرحله‌ی ثبت اطلاعات ارسال نیست')
     # قبلاً این‌جا هیچ چکی روی وجودِ delivery قبلی نبود -- یعنی همین مسیر
     # (که عمداً بدونِ نشست، فقط با شناسه‌ی سفارش قابل‌استفاده است) با یک
     # POST دوباره، اطلاعاتِ ارسالِ قبلاً ثبت‌شده (که شاید پیک/پستچی طبقِ
     # همان آدرس اقدام کرده) را بی‌سروصدا و بدونِ هیچ ردی جای‌گزین می‌کرد
     if order['delivery']:raise ValueError('اطلاعات ارسال قبلاً ثبت شده و قابل تغییر نیست؛ برای اصلاح با پشتیبانی تماس بگیرید.')
     c.execute('UPDATE orders SET delivery=? WHERE id=?',(json.dumps(delivery,ensure_ascii=False),order_id))
    self.reply({'ok':True});return
   if not self.authenticated(True):return
   if path=='/api/logout':
    cookie=SimpleCookie(self.headers.get('Cookie',''))
    with lock:sessions.pop(cookie['stlp_session'].value,None)
    self.reply({'ok':True});return
   if path=='/api/product':
    code=text(data.get('code',''),60)
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,60}',code):raise ValueError('کد کالا باید انگلیسی، عدد یا خط تیره باشد')
    title=text(data.get('title',''),200);kind=text(data.get('type',''),50)
    if not title or not kind:raise ValueError('نام و نوع محصول ضروری است')
    price=integer(data.get('pack'));minimum=integer(data.get('min_stock',5),0,100000)
    with connection() as c:
     old=c.execute('SELECT * FROM products WHERE code=?',(code,)).fetchone();image=old['image'] if old else 'images/products/grey_700.png'
     raw=data.get('image','')
     if raw:
      mime,blob=validate_image_data_uri(raw)
      image_id=secrets.token_hex(16);c.execute('INSERT INTO images VALUES(?,?,?)',(image_id,mime,blob));image='/api/images/'+image_id
     c.execute('INSERT INTO products(code,title,type,size,volume,brand,pack,unit,min_stock,image,active) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET title=excluded.title,type=excluded.type,size=excluded.size,volume=excluded.volume,brand=excluded.brand,pack=excluded.pack,unit=excluded.unit,min_stock=excluded.min_stock,image=excluded.image,active=excluded.active',(code,title,kind,text(data.get('size',''),40),text(data.get('volume',''),20),text(data.get('brand',''),80),price,round(price/100),minimum,image,1 if data.get('active',True) else 0))
    self.reply({'ok':True});return
   if path=='/api/movement':
    code=text(data.get('code',''),60);qty=integer(data.get('quantity'),1,100000);direction=data.get('direction');reason=text(data.get('reason',''),300);reference=text(data.get('reference',''),100)
    if direction not in ['in','out'] or not reason:raise ValueError('جهت و دلیل گردش ضروری است')
    delta=qty if direction=='in' else -qty
    with connection() as c:
     c.execute('BEGIN IMMEDIATE');p=c.execute('SELECT stock FROM products WHERE code=?',(code,)).fetchone()
     if not p or p['stock']+delta<0:raise ValueError('موجودی کافی نیست')
     c.execute('UPDATE products SET stock=stock+? WHERE code=?',(delta,code));c.execute('INSERT INTO movements(code,delta,reason,reference) VALUES(?,?,?,?)',(code,delta,reason,reference))
    self.reply({'ok':True});return
   if path=='/api/order-status':
    order_id=text(data.get('id',''),40);status=data.get('status')
    rule=ORDER_TRANSITIONS.get(status)
    if not rule:raise ValueError('وضعیت نامعتبر است')
    invoice_number=None;invoice_date=None
    if rule.get('require_invoice'):
     invoice_number=text(data.get('invoice_number',''),40)
     if not re.fullmatch(r'[A-Za-z0-9-]{1,40}',invoice_number):raise ValueError('شماره فاکتور نامعتبر است')
     invoice_date=text(data.get('invoice_date',''),40)
    rejection_note=None
    if rule.get('require_rejection_note'):
     rejection_note=text(data.get('rejection_note',''),500)
     if not rejection_note:raise ValueError('علت رد فیش ضروری است')
    with connection() as c:
     c.execute('BEGIN IMMEDIATE');order=c.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone()
     if not order:raise ValueError('سفارش یافت نشد')
     if order['status'] not in rule['from']:raise ValueError('این سفارش در مرحله‌ی مناسب برای این عملیات نیست')
     if rule.get('require_delivery_present') and not order['delivery']:raise ValueError('اطلاعات تحویل هنوز ثبت نشده است')
     if rule.get('restock'):
      for item in json.loads(order['items']):
       c.execute('UPDATE products SET stock=stock+? WHERE code=?',(item['qty'],item['code']));c.execute('INSERT INTO movements(code,delta,reason,reference) VALUES(?,?,?,?)',(item['code'],item['qty'],'بازگشت رزرو لغوشده',order_id))
     if status=='awaiting_shipment':
      c.execute('UPDATE orders SET status=?, invoice_number=?, invoice_date=? WHERE id=?',(status,invoice_number,invoice_date,order_id))
     elif status=='awaiting_receipt':
      c.execute('UPDATE orders SET status=?, receipt_rejection_note=? WHERE id=?',(status,rejection_note,order_id))
     else:
      c.execute('UPDATE orders SET status=? WHERE id=?',(status,order_id))
    self.reply({'ok':True,'invoice_number':invoice_number});return
   if path=='/api/order-postal-tracking':
    order_id=text(data.get('id',''),40)
    tracking_code=text(data.get('postal_tracking_code',''),60)
    if not re.fullmatch(r'[A-Za-z0-9-]{3,60}',tracking_code):raise ValueError('بارکد پستی نامعتبر است')
    with connection() as c:
     c.execute('BEGIN IMMEDIATE');order=c.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone()
     if not order:raise ValueError('سفارش یافت نشد')
     if order['status'] not in ('awaiting_shipment','delivered'):raise ValueError('این سفارش در مرحله‌ی مناسب برای ثبت بارکد پستی نیست')
     if not order['delivery'] or json.loads(order['delivery']).get('method')!='post':raise ValueError('روش تحویل این سفارش پست نیست')
     c.execute('UPDATE orders SET postal_tracking_code=? WHERE id=?',(tracking_code,order_id))
    self.reply({'ok':True});return
   if path=='/api/admin-codes/generate':
    # قبلاً این کدهای اصالت (که روی برچسب‌های چاپیِ محصولات می‌روند) از
    # صفحه‌ی admin-stlp-codes.html و کاملاً سمتِ مرورگر تولید می‌شدند، پشتِ
    # یک رمزِ ادمینِ هاردکدشده در همان کدِ جاوااسکریپتِ صفحه — یعنی هر کسی
    # که فقط سورسِ صفحه را می‌دید (یا حتی بدونِ دیدنِ رمز، از کنسولِ مرورگر
    # مستقیماً تابعِ generateCsv را صدا می‌زد) می‌توانست بدونِ هیچ محدودیتی
    # کدِ اصالتِ معتبر و قابل‌چاپ تولید کند. حالا خودِ تولید هم این‌جا،
    # پشتِ همان نشستِ ادمینِ داشبورد (رمز/CSRF/نشستِ سرور، نه یک رمزِ ثابتِ
    # قابل‌خواندن در کلاینت) انجام می‌شود.
    year=integer(data.get('year'),1000,9999);start=integer(data.get('start',1),1,10**7);count=integer(data.get('count',10),1,10000)
    codes=[]
    for i in range(count):
     seq=str(start+i).zfill(6)
     digits=re.sub(r'\D','',str(year)+seq)
     checksum=(sum(int(ch) for ch in digits)%11)%10
     codes.append(f'STLP-{year}-{seq}-{checksum}')
    self.reply({'codes':codes});return
   self.reply({'error':'مسیر موجود نیست'},404)
  except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e:self.reply({'error':str(e)},400)
  except Exception:self.reply({'error':'ذخیره انجام نشد؛ دوباره تلاش کنید'},500)

if __name__=='__main__':
 backup_store()
 threading.Thread(target=backup_worker,daemon=True).start()
 host=os.environ.get('STLP_HOST','127.0.0.1');port=int(os.environ.get('STLP_PORT','8766'))
 print('STLP server: http://'+host+':'+str(port),flush=True)
 ThreadingHTTPServer((host,port),Handler).serve_forever()

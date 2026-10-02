/* ============================================
   موتور ساخت PDF فاکتور — کپی دقیق از erp/app.js
   (STLP_PDF_STYLE + stlpBuildInvoiceHTML + stlpGenerateInvoicePDF)
   فقط منبع لوگو از base64 به فایل images/logo-invoice.png تغییر کرده؛
   بقیه دقیقاً همان کد ERP است.
============================================ */

const STLP_ONES = ['', 'یک','دو','سه','چهار','پنج','شش','هفت','هشت','نه'];
const STLP_TENS = ['', 'ده','بیست','سی','چهل','پنجاه','شصت','هفتاد','هشتاد','نود'];
const STLP_TEENS = ['ده','یازده','دوازده','سیزده','چهارده','پانزده','شانزده','هفده','هجده','نوزده'];
const STLP_HUNDREDS = ['', 'صد','دویست','سیصد','چهارصد','پانصد','ششصد','هفتصد','هشتصد','نهصد'];
const STLP_MAGNITUDE = ['', ' هزار', ' میلیون', ' میلیارد', ' تریلیون'];

function stlpThreeDigitWords(n){
  const parts = [];
  const h = Math.floor(n/100);
  const rem = n%100;
  if(h>0) parts.push(STLP_HUNDREDS[h]);
  if(rem>=10 && rem<20){
    parts.push(STLP_TEENS[rem-10]);
  } else {
    const t = Math.floor(rem/10);
    const o = rem%10;
    if(t>0) parts.push(STLP_TENS[t]);
    if(o>0) parts.push(STLP_ONES[o]);
  }
  return parts.join(' و ');
}
function stlpNumberToPersianWords(num){
  num = Math.round(num);
  if(num === 0) return 'صفر ریال';
  if(num < 0) return 'منفی ' + stlpNumberToPersianWords(-num);
  const groups = [];
  let n = num;
  while(n>0){
    groups.push(n % 1000);
    n = Math.floor(n/1000);
  }
  const parts = [];
  for(let i=groups.length-1;i>=0;i--){
    if(groups[i]===0) continue;
    parts.push(stlpThreeDigitWords(groups[i]) + (STLP_MAGNITUDE[i]||''));
  }
  return parts.join(' و ') + ' ریال';
}

/* ---- ساخت ردیف‌های کالا و ردیف‌های جمع/شرایط/امضا ---- */

const STLP_PDF_STYLE = `
<style>
  @font-face{font-family:'Vazirmatn';src:url('fonts/Vazirmatn-Regular.ttf') format('truetype');font-weight:400;font-display:block;}
  @font-face{font-family:'Vazirmatn';src:url('fonts/Vazirmatn-Bold.ttf') format('truetype');font-weight:600 900;font-display:block;}
  #stlpPdfSheet{
    position:absolute; left:-99999px; top:0;
    width:1400px;
    background:#fff;
    color:#000;
    font-family:'Vazirmatn',sans-serif;
    direction:rtl;
    padding:24px;
    box-sizing:border-box;
  }
  #stlpPdfSheet, #stlpPdfSheet *{ color:#000 !important; }
  #stlpPdfSheet *{box-sizing:border-box;}
  .stlp-pdf-header{position:relative; min-height:90px; margin-bottom:10px;}
  .stlp-pdf-title{position:absolute; right:0; left:0; top:20px; text-align:center; font-size:20px; font-weight:700; color:#000;}
  .stlp-pdf-logo{position:absolute; left:0; top:0;}
  .stlp-pdf-logo img{height:80px;}
  .stlp-pdf-meta{position:absolute; right:0; top:0; font-size:13px; line-height:2.1; color:#000;}
  .stlp-pdf-meta b{margin-left:6px; color:#000;}
  .stlp-pdf-section-title{
    box-sizing:border-box;
    text-align:center; font-weight:700; font-size:14px;
    height:34px; line-height:30px;
    margin:0 1px 6px;
    padding:0 6px; color:#000;
    overflow:visible;
  }
  .stlp-pdf-section-title span{
    display:inline-block;
    transform:translateY(2px);
  }
  table.stlp-pdf-info{width:calc(100% - 2px); border-collapse:separate; border-spacing:0; font-size:12.5px; margin-bottom:0; margin-left:1px; margin-right:1px;}
  table.stlp-pdf-info td{border-top:2px solid #000; border-left:2px solid #000; border-right:none; border-bottom:none; padding:8px 6px; color:#000; text-align:center; vertical-align:middle;}
  table.stlp-pdf-info tr td:first-child{border-right:2px solid #000;}
  table.stlp-pdf-info tr:last-child td{border-bottom:2px solid #000;}
  table.stlp-pdf-info td.lbl{background:#f6f6f6; font-weight:600; white-space:nowrap; width:1%; color:#000;}
  table.stlp-pdf-info td.lbl2{background:#f6f6f6; font-weight:600; white-space:nowrap; width:1%; color:#000;}
  table.stlp-pdf-info td.val{font-weight:700; color:#000;}

  table.stlp-pdf-items{width:calc(100% - 2px); border-collapse:separate; border-spacing:0; font-size:12px; margin-top:14px; margin-left:1px; margin-right:1px;}
  table.stlp-pdf-items th, table.stlp-pdf-items td{border-top:2px solid #000; border-left:2px solid #000; border-right:none; border-bottom:none; padding:8px 4px; text-align:center; vertical-align:middle; color:#000;}
  table.stlp-pdf-items tr th:first-child, table.stlp-pdf-items tr td:first-child{border-right:2px solid #000;}
  table.stlp-pdf-items tbody tr:last-child td{border-bottom:2px solid #000;}
  table.stlp-pdf-items thead th{background:#e9e9e9; font-size:11.5px; font-weight:700; color:#000;}
  table.stlp-pdf-items td.desc{text-align:center; font-weight:600; color:#000;}

  table.stlp-pdf-totals{width:calc(100% - 2px); border-collapse:separate; border-spacing:0; font-size:13px; margin-top:0; margin-left:1px; margin-right:1px;}
  table.stlp-pdf-totals td{border-left:2px solid #000; border-bottom:2px solid #000; border-top:none; border-right:none; padding:8px 6px; text-align:center; vertical-align:middle;}
  table.stlp-pdf-totals tr td:first-child{border-right:2px solid #000;}
  table.stlp-pdf-totals td.lbl{background:#f6f6f6; font-weight:700; text-align:center; white-space:nowrap; width:1%;}
  table.stlp-pdf-totals td.big{font-weight:700; font-size:15px; text-align:center;}

  table.stlp-pdf-terms{width:calc(100% - 2px); border-collapse:separate; border-spacing:0; font-size:12.5px; margin-top:0; margin-left:1px; margin-right:1px;}
  table.stlp-pdf-terms td{border-left:2px solid #000; border-bottom:2px solid #000; border-top:none; border-right:none; padding:8px 6px; text-align:center; vertical-align:middle;}
  table.stlp-pdf-terms tr td:first-child{border-right:2px solid #000;}
  table.stlp-pdf-terms td.lbl{background:#f6f6f6; font-weight:700; white-space:nowrap; width:1%;}
  table.stlp-pdf-terms td.box{font-weight:900; font-size:15px; width:26px;}
  table.stlp-pdf-terms td.bank{text-align:center; font-weight:600;}

  table.stlp-pdf-sign{width:calc(100% - 2px); border-collapse:separate; border-spacing:0; font-size:13px; margin-top:0; margin-left:1px; margin-right:1px;}
  table.stlp-pdf-sign td{border-left:2px solid #000; border-bottom:2px solid #000; border-top:none; border-right:none; height:50px; text-align:center; font-weight:700; vertical-align:middle; padding:6px;}
  table.stlp-pdf-sign tr td:first-child{border-right:2px solid #000;}
  .stlp-pdf-sign-seal{width:100%; display:flex;}
  .stlp-pdf-sign-seal > div{width:50%;}
  .stlp-pdf-sign-seal img{display:block; height:115px; margin:4px auto 0;}

  .stlp-pdf-watermark{
    position:absolute; top:0; left:0; right:0; bottom:0;
    display:flex; align-items:center; justify-content:center;
    overflow:visible; pointer-events:none;
  }
  #stlpPdfSheet .stlp-pdf-watermark span{
    display:inline-block; white-space:nowrap;
    font-size:120px; font-weight:900;
    color:rgba(210,160,10,.5) !important;
    transform:rotate(-20deg);
  }
  .stlp-pdf-pagefooter{ margin-top:10px; text-align:center; font-size:11px; color:#000; }
</style>
`;

function stlpPdfEsc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* می‌سازد: یک HTML که دقیقاً همان چیدمان و اطلاعات فاکتور رسمی اکسل (فرمت TTMS) را بازتولید می‌کند */
function stlpBuildInvoiceHTML(opts) {

    // ========================================
    // اقلام فاکتور
    // ========================================

    const items =
        opts.items &&
        opts.items.length
            ? opts.items
            : [];


    // ========================================
    // نوع خرید
    // ========================================

    const purchaseType =
        opts.purchaseType === "credit"
            ? "credit"
            : "cash";


    const cashBox =
        purchaseType === "cash"
            ? "X"
            : "";


    const nonCashBox =
        purchaseType === "credit"
            ? "X"
            : "";


    // ========================================
    // پیش‌فاکتور (پیش‌نویس) یا فاکتور رسمی؟
    // پیش‌فاکتور: واترمارک زرد بزرگ دارد و بدون مهر/امضا است.
    // فاکتور رسمی: مهر و امضا دارد و اگر برخاسته از سفارش
    // آنلاین باشد، کد پیگیری سفارش را هم زیر شماره نشان می‌دهد.
    // ========================================

    const isPreInvoice =
        opts.code === "پیش‌فاکتور";


    // ========================================
    // محاسبه‌ی یک ردیفِ کالا (برای جمعِ کل و برای
    // ساختِ HTML همان ردیف، هر دو از همین استفاده می‌کنند)
    // ========================================

    function computeRow(it) {

        const qty = Number(it.qty || 0);
        const unitPrice = Number(it.unitPrice || 0);
        const amount = qty * unitPrice;
        const disc = Number(it.discPercent || 0);
        const afterD = Math.round(amount - (disc / 100) * amount);
        const tax = 0;
        const total = afterD + tax;

        return { qty, unitPrice, amount, disc, afterD, tax, total };

    }

    function rowHtml(it, displayIndex) {

        const r = computeRow(it);

        return `
                <tr>
                    <td>${displayIndex}</td>
                    <td>${stlpPdfEsc(it.code || "-")}</td>
                    <td class="desc">${stlpPdfEsc(it.desc || "")}</td>
                    <td>${r.qty}</td>
                    <td>${stlpPdfEsc(it.unit || "بسته")}</td>
                    <td>${r.unitPrice.toLocaleString("fa-IR")}</td>
                    <td>${r.amount.toLocaleString("fa-IR")}</td>
                    <td>${r.disc}</td>
                    <td>${r.afterD.toLocaleString("fa-IR")}</td>
                    <td>${r.tax.toLocaleString("fa-IR")}</td>
                    <td>${r.total.toLocaleString("fa-IR")}</td>
                </tr>
            `;

    }


    // ========================================
    // جمع نهایی (روی همه‌ی اقلام، صرف‌نظر از صفحه‌بندی)
    // ========================================

    let afterDisc = 0;

    items.forEach(function (it) {
        afterDisc += computeRow(it).afterD;
    });

    const grandTotal = afterDisc;

    const amountWords =
        stlpNumberToPersianWords(
            grandTotal
        );


    // ========================================
    // صفحه‌بندی: حداکثر ۷ ردیف کالا در هر صفحه؛ سربرگ/فروشنده/
    // خریدار در هر صفحه عیناً تکرار می‌شود (اندازه‌شان ثابت
    // می‌ماند، هیچ‌وقت فشرده نمی‌شوند)؛ جمع/شرایط/امضا فقط در
    // صفحه‌ی آخر می‌آید.
    // ========================================

    const ITEMS_PER_PAGE = 7;

    const totalPages =
        Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));

    const pages = [];

    for (let p = 0; p < totalPages; p++) {

        const pageItems =
            items.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);

        const startIndex = p * ITEMS_PER_PAGE;

        const isLastPage = p === totalPages - 1;

        const rowsHtml =
            pageItems.map(function (it, i) {
                return rowHtml(it, startIndex + i + 1);
            }).join("");

        pages.push(`

    <div id="stlpPdfSheet">

        ${isPreInvoice ? `
        <div class="stlp-pdf-watermark"><span>پیش‌فاکتور</span></div>
        ` : ""}

        <!-- ================================
             سربرگ
        ================================= -->

        <div class="stlp-pdf-header">

            <div class="stlp-pdf-logo">

                <img
                    src="images/logo-invoice.png" crossorigin="anonymous"
                >

            </div>


            <div class="stlp-pdf-title">

                صورتحساب فروش کالا و خدمات

            </div>


            <div class="stlp-pdf-meta">

                <div>
                    شماره:
                    <b>
                        ${stlpPdfEsc(
                            opts.code
                        )}
                    </b>
                </div>

                <div>
                    تاریخ:
                    <b>
                        ${stlpPdfEsc(
                            opts.dateFa
                        )}
                    </b>
                </div>

                ${opts.onlineTrackingCode ? `
                <div>
                    کد پیگیری سفارش آنلاین:
                    <b>
                        ${stlpPdfEsc(
                            opts.onlineTrackingCode
                        )}
                    </b>
                </div>
                ` : ""}

                ${opts.settlementNote ? `
                <div>
                    <b>
                        ${stlpPdfEsc(
                            opts.settlementNote
                        )}
                    </b>
                </div>
                ` : ""}

            </div>

        </div>


        <!-- ================================
             فروشنده
        ================================= -->

        <div class="stlp-pdf-section-title">

            <span>مشخصات فروشنده</span>

        </div>


        <table class="stlp-pdf-info">

            <colgroup>
                <col style="width:14%">
                <col style="width:6%">
                <col style="width:12%">
                <col style="width:7%">
                <col style="width:13%">
                <col style="width:13%">
                <col style="width:13%">
                <col style="width:9%">
                <col style="width:13%">
            </colgroup>

            <tr>

                <td class="lbl">
                    نام شخص حقیقی / حقوقی :
                </td>

                <td
                    class="val"
                    colspan="3"
                >
                    صبا تجهیز لاله پارسه
                </td>

                <td class="lbl">
                    شماره اقتصادی
                </td>

                <td class="val">
                    14014245519
                </td>

                <td class="lbl">
                    شماره ثبت
                </td>

                <td
                    class="val"
                    colspan="2"
                >
                    647208
                </td>

            </tr>


            <tr>

                <td class="lbl">
                    نشانی کامل
                </td>

                <td class="lbl2">
                    استان
                </td>

                <td class="val">
                    تهران
                </td>

                <td class="lbl2">
                    شهرستان
                </td>

                <td class="val">
                    تهران
                </td>

                <td class="lbl">
                    کد پستی ده رقمی
                </td>

                <td class="val">
                    1717764781
                </td>

                <td class="lbl">
                    شناسه ملی
                </td>

                <td class="val">
                    14014245519
                </td>

            </tr>


            <tr>

                <td class="lbl">
                    نشانی
                </td>

                <td
                    class="val"
                    colspan="6"
                >
                    خیابان پیروزی، خیابان شیخ الرییس،
                    کوچه امین آبادی، پلاک 15، واحد 3
                </td>

                <td class="lbl">
                    تلفن-فکس
                </td>

                <td class="val">
                    09128899287
                </td>

            </tr>

        </table>


        <!-- ================================
             خریدار
        ================================= -->

        <div
            class="stlp-pdf-section-title"
            style="margin-top:6px;"
        >

            <span>مشخصات خریدار</span>

        </div>


        <table class="stlp-pdf-info">

            <colgroup>
                <col style="width:14%">
                <col style="width:6%">
                <col style="width:12%">
                <col style="width:7%">
                <col style="width:13%">
                <col style="width:13%">
                <col style="width:13%">
                <col style="width:9%">
                <col style="width:13%">
            </colgroup>

            <tr>

                <td class="lbl">
                    نام شخص حقیقی / حقوقی :
                </td>

                <td
                    class="val"
                    colspan="3"
                >
                    ${stlpPdfEsc(
                        opts.buyerName || ""
                    )}
                </td>

                <td class="lbl">
                    شماره اقتصادی
                </td>

                <td class="val">
                    ${stlpPdfEsc(
                        opts.buyerEconCode || ""
                    )}
                </td>

                <td class="lbl">
                    شماره ثبت
                </td>

                <td
                    class="val"
                    colspan="2"
                >
                    ${stlpPdfEsc(
                        opts.buyerRegNo || ""
                    )}
                </td>

            </tr>


            <tr>

                <td class="lbl">
                    نشانی کامل
                </td>

                <td class="lbl2">
                    استان
                </td>

                <td class="val">
                    ${stlpPdfEsc(
                        opts.buyerProvince || ""
                    )}
                </td>

                <td class="lbl2">
                    شهرستان
                </td>

                <td class="val">
                    ${stlpPdfEsc(
                        opts.buyerCity || ""
                    )}
                </td>

                <td class="lbl">
                    کد پستی ده رقمی
                </td>

                <td class="val">
                    ${stlpPdfEsc(
                        opts.buyerPostalCode || ""
                    )}
                </td>

                <td class="lbl">
                    شناسه ملی
                </td>

                <td class="val">
                    ${stlpPdfEsc(
                        opts.buyerNationalId || ""
                    )}
                </td>

            </tr>


            <tr>

                <td class="lbl">
                    نشانی
                </td>

                <td
                    class="val"
                    colspan="6"
                >
                    ${stlpPdfEsc(
                        opts.buyerAddress || ""
                    )}
                </td>

                <td class="lbl">
                    تلفن-فکس
                </td>

                <td class="val">
                    ${stlpPdfEsc(
                        opts.buyerPhone || ""
                    )}
                </td>

            </tr>

        </table>


        <!-- ================================
             کالاها
        ================================= -->

        <div
            class="stlp-pdf-section-title"
            style="margin-top:6px;"
        >

            <span>مشخصات کالا یا خدمات</span>

        </div>


        <table class="stlp-pdf-items">

            <colgroup>

                <col style="width:3%">
                <col style="width:5%">
                <col style="width:29%">
                <col style="width:5%">
                <col style="width:3%">
                <col style="width:10%">
                <col style="width:10%">
                <col style="width:6%">
                <col style="width:10%">
                <col style="width:9%">
                <col style="width:10%">

            </colgroup>


            <thead>

                <tr>

                    <th>ردیف</th>

                    <th>کد کالا</th>

                    <th>شرح کالا یا خدمات</th>

                    <th>تعداد</th>

                    <th>واحد</th>

                    <th>مبلغ واحد - ریال</th>

                    <th>مبلغ کل - ریال</th>

                    <th>درصد تخفیف</th>

                    <th>
                        مبلغ کل پس از تخفیف - ریال
                    </th>

                    <th>
                        جمع مالیات و عوارض - ریال
                    </th>

                    <th>
                        جمع مبلغ کل - ریال
                    </th>

                </tr>

            </thead>


            <tbody>

                ${rowsHtml}

            </tbody>

        </table>

        ${isLastPage ? `

        <!-- ================================
             جمع
        ================================= -->

        <table class="stlp-pdf-totals">

            <tr>

                <td
                    class="lbl"
                    style="width:8%;"
                >
                    جمع کل
                </td>

                <td
                    class="big"
                    style="width:20%;"
                >
                    ${grandTotal.toLocaleString(
                        "fa-IR"
                    )}
                </td>

                <td
                    class="lbl"
                    style="width:6%;"
                >
                    ریال
                </td>

                <td
                    class="lbl"
                    style="width:12%;"
                >
                    جمع به حروف
                </td>

                <td
                    style="width:54%;"
                >
                    ${stlpPdfEsc(
                        amountWords
                    )}
                </td>

            </tr>

        </table>


        <!-- ================================
             شرایط فروش
        ================================= -->

        <table class="stlp-pdf-terms">

            <tr>

                <td
                    class="lbl"
                    style="width:14%;"
                >
                    شرایط و نحوه فروش
                </td>


                <td style="width:6%;">
                    نقدی
                </td>


                <td
                    class="box"
                    style="width:4%;"
                >
                    ${cashBox}
                </td>


                <td style="width:8%;">
                    غیر نقدی
                </td>


                <td
                    class="box"
                    style="width:4%;"
                >
                    ${nonCashBox}
                </td>


                <td
                    class="bank"
                    colspan="5"
                >
                    IR 200160000000001113622621
                </td>

            </tr>

        </table>


        <!-- ================================
             امضا
        ================================= -->

        <table class="stlp-pdf-sign">

            <tr>

                <td style="width:50%;">
                    مهر و امضا خریدار
                </td>

                <td style="width:50%;">
                    مهر و امضا فروشنده
                </td>

            </tr>

        </table>

        ${!isPreInvoice ? `
        <div class="stlp-pdf-sign-seal">
            <div></div>
            <div><img src="images/seal-signature.png" crossorigin="anonymous"></div>
        </div>
        ` : ""}

        ` : ""}

        <div class="stlp-pdf-pagefooter">صفحه ${p + 1} از ${totalPages}</div>

    </div>

    `);

    }

    return pages;

}

/* ساخت و دانلود PDF - از همان html2canvas + jsPDF (فقط داخل پنل ادمین لود می‌شود) */
async function stlpGenerateInvoicePDF(opts) {

    // ========================================
    // بررسی کتابخانه‌های PDF
    // ========================================

    if (
        typeof html2canvas === "undefined" ||
        typeof window.jspdf === "undefined"
    ) {

        alert(
            "کتابخانه‌های ساخت PDF هنوز لود نشده‌اند؛ " +
            "چند لحظه صبر کنید و دوباره امتحان کنید."
        );

        return null;
    }


    // ========================================
    // اطمینان از نوع خرید
    // ========================================

    const purchaseType =
        opts?.purchaseType === "credit"
            ? "credit"
            : "cash";


    opts = {

        ...opts,

        purchaseType:
            purchaseType,

        isCash:
            purchaseType === "cash"

    };


    // ========================================
    // ساخت صفحات فاکتور (آرایه‌ای از HTML، یکی به ازای هر صفحه)
    // ========================================

    const pagesHtml =
        stlpBuildInvoiceHTML(opts);


    // اطمینان از لود کامل فونت Vazirmatn قبل از رندر؛ وگرنه
    // html2canvas ممکن است زودتر از آماده‌شدن فونت اجرا شود و
    // با فونت جایگزین (fallback) رندر کند. یک‌بار برای کل سند کافی است.
    if (document.fonts && document.fonts.ready) {
        try { await document.fonts.load("400 16px Vazirmatn"); } catch (error) {}
        try { await document.fonts.load("700 16px Vazirmatn"); } catch (error) {}
        await document.fonts.ready;
    }


    // ========================================
    // ساخت PDF
    // ========================================

    const { jsPDF } =
        window.jspdf;

    const doc =
        new jsPDF(
            "l",
            "pt",
            "a4"
        );


    const pageW =
        doc.internal.pageSize.getWidth();

    const pageH =
        doc.internal.pageSize.getHeight();


    const margin = 18;

    const availW =
        pageW -
        margin * 2;


    for (let p = 0; p < pagesHtml.length; p++) {

        // ========================================
        // ساخت صفحه فاکتور
        // ========================================

        const wrap =
            document.createElement("div");

        wrap.innerHTML =
            STLP_PDF_STYLE +
            pagesHtml[p];

        document.body.appendChild(wrap);


        // ========================================
        // انتظار برای لوگو
        // ========================================

        const sheet =
            document.getElementById("stlpPdfSheet");

        if (!sheet) {

            document.body.removeChild(wrap);

            alert(
                "صفحه فاکتور PDF ساخته نشد."
            );

            return null;
        }


        const img =
            sheet.querySelector("img");

        if (img) {

            await new Promise(function(resolve) {

                if (img.complete) {

                    resolve();

                    return;
                }

                img.onload = resolve;

                img.onerror = resolve;

            });

        }


        // ========================================
        // تبدیل فاکتور به تصویر
        // ========================================

        const canvas =
            await html2canvas(
                sheet,
                {
                    scale: 2,

                    backgroundColor:
                        "#ffffff",

                    useCORS: true
                }
            );


        // حذف صفحه موقت
        document.body.removeChild(wrap);


        const ratio =
            canvas.height /
            canvas.width;


        let drawW =
            availW;

        let drawH =
            drawW *
            ratio;


        if (
            drawH >
            pageH -
            margin * 2
        ) {

            drawH =
                pageH -
                margin * 2;

            drawW =
                drawH /
                ratio;

        }


        const x =
            (pageW - drawW) /
            2;

        const y =
            margin;


        // ========================================
        // قرار دادن فاکتور داخل PDF
        // ========================================

        if (p > 0) {
            doc.addPage();
        }

        doc.addImage(

            canvas.toDataURL(
                "image/jpeg",
                0.92
            ),

            "JPEG",

            x,
            y,
            drawW,
            drawH

        );

    }


    // ========================================
    // ذخیره فایل
    // ========================================

    doc.save(
        "STLP_TTMS_Invoice_" +
        (opts.code || "invoice") +
        ".pdf"
    );


    return doc;
}

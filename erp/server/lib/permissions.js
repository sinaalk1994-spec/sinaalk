// =====================================================
// نگاشت «کلید داده» به «دسترسی لازم برای نوشتن»
// این همان لایه‌ای است که قبلاً اصلاً روی سرور وجود نداشت —
// هر کسی با کنسول مرورگر می‌توانست هر داده‌ای را دستکاری کند.
// حالا سرور مستقل تصمیم می‌گیرد، نه فقط جاوااسکریپت صفحه.
//
// منطق: اگر ادمین باشد → همیشه اجازه.
// در غیر این‌صورت، طبق قوانین زیر بررسی می‌شود.
// چیزی که در این لیست نیست → هر کاربرِ واردشده اجازه دارد
// (دقیقاً همان رفتار قبلی برنامه که فقط با ورود محافظت می‌شد).
// =====================================================

"use strict";

// کلیدهایی که فقط ادمین حق خواندن‌شان را دارد
// (حاوی هش رمز عبور تمام کاربران / لاگ فعالیتِ همه‌ی کاربران)
const ADMIN_ONLY_READ_KEYS = new Set([
    "stlp_users",
    "stlp_activity_log"
]);

// کلیدهایی که فقط ادمین حق نوشتن دارد (داده‌ی حساس ساختاری)
// توجه: «stlp_employees» و «stlp_leave_requests» عمداً این‌جا
// نیستند — چون در برنامه‌ی واقعی، کارمندِ حقوق‌و‌دستمزد (نه فقط
// ادمین) باید بتواند کارمندان را مدیریت کند (payroll.html)، و هر
// کاربرِ واردشده باید بتواند برای خودش درخواست مرخصی ثبت کند
// (letters.html). قوانین دقیق‌ترشان پایین‌تر در EXACT_WRITE_RULES
// آمده. نسخه‌ی اول این فایل این دو را اشتباهاً فقط-ادمین گذاشته
// بود که باعث می‌شد مدیریت کارمندان در صفحه‌ی حقوق‌ودستمزد و ثبت
// درخواست مرخصی برای هر کاربر غیرادمین با خطای ۴۰۳ متوقف شود.
const ADMIN_ONLY_WRITE_KEYS = new Set([
    "stlp_users",
    "stlp_departments",
    // مدیریت تیم‌های CRM (نه خودِ رکوردهای سرنخ‌ها) یک اقدام
    // ساختاریِ سطح مدیریتی است، مثل stlp_departments.
    "stlp_crm_settings",
    // شمارنده‌های اتمیکِ شماره‌گذاری (فاکتور/پیش‌فاکتور/سند/حواله/
    // نامه). این کلیدها هیچ پیشوند/قانونِ شناخته‌شده‌ای نداشتند، یعنی
    // هر کاربرِ واردشده (حتی بدون هیچ دسترسیِ ماژولی) می‌توانست با یک
    // PUT مستقیم مقدارِ شمارنده را به هر عددی تغییر دهد و باعثِ
    // تکرارِ شماره‌ی فاکتور/حواله/نامه شود — درحالی‌که اندپوینت‌های
    // «شماره‌ی بعدی را بده» خودشان درست دسترسیِ ماژولِ مربوطه را چک
    // می‌کنند (handleNextInvoiceNumber و بقیه در store.js). این‌جا
    // فقط جلوی نوشتنِ مستقیم/دستکاری‌شده‌ی خودِ شمارنده گرفته می‌شود.
    "stlpQuoteCounter",
    "stlp_journal_counter",
    "stlp_delivery_counter",
    "stlp_letter_counter",
    "stlp_official_letter_counter"
]);

// نسخه‌ی پیشوندی‌ِ همان محدودیت، مخصوصِ stlpInvoiceCounter_<year>
// (چون بخشِ سال در نامِ کلید متغیر است و نمی‌تواند در Set بالا با
// تطبیقِ دقیق قرار بگیرد)
const ADMIN_ONLY_WRITE_PREFIXES = [
    "stlpInvoiceCounter_"
];

// قوانین نوشتن بر اساس پیشوند کلید + دسترسی‌های لازم در permissions کاربر
// (هر پیشوند می‌تواند چند دسترسیِ جایگزین داشته باشد — کافی است
// کاربر یکی از آن‌ها را داشته باشد)
const PREFIX_WRITE_RULES = [
    { prefix: "stlp_payroll", permissions: ["payroll"] },
    // دسترسی «onlineStore» علاوه بر «treasury» می‌تواند این کلیدها را
    // بنویسد، چون تأییدِ سفارش آنلاین (store-admin.js) باید بتواند
    // تراکنش خزانه و سند حسابداریِ همان فروش را خودش ثبت کند، بدون
    // نیاز به دسترسی کاملِ ماژول خزانه.
    { prefix: "stlp_treasury", permissions: ["treasury", "onlineStore"] },
    { prefix: "stlp_chart_of_accounts", permissions: ["treasury", "onlineStore"] },
    { prefix: "stlp_journal", permissions: ["treasury", "onlineStore"] },
    { prefix: "stlp_crm", permissions: ["crm"] },
    { prefix: "stlp_inventory", permissions: ["inventory"] },
    { prefix: "stlp_quotations", permissions: ["sales"] },
    { prefix: "stlp_letter_templates", permissions: ["letters"] }
];

const EXACT_WRITE_RULES = {
    "customers": ["customers", "sales", "onlineStore"],
    // دسترسی «onlineStore» فقط برای ثبتِ فاکتورِ سفارش‌های آنلاینِ
    // تأییدشده لازم است (store-admin.js) — نه برای ویرایش/حذف
    // فاکتورهای دیگرِ بخش فروش.
    "invoices": ["sales", "onlineStore"],
    // «purchases» هم اضافه شد: بدون آن، کاربری که فقط دسترسیِ
    // «خرید» دارد (نه «تحویل»/«فروش») اصلاً نمی‌توانست حواله‌ی
    // خریدی که خودش ثبت کرده را ذخیره کند — چون همین کلید،
    // حواله‌های فروش و خرید هر دو را نگه می‌دارد.
    "salesDeliveries": ["delivery", "sales", "purchases"],
    "inventoryMovements": ["inventory"],
    "stlp_suppliers": ["purchases"],
    "stlp_inventory": ["inventory"],
    // مدیریت کامل کارمندان (حقوق، شماره‌حساب، کدملی و ...) فقط با
    // دسترسی "payroll" مجاز است. قبلاً "letters" هم این‌جا بود چون
    // تأیید نهاییِ درخواست مرخصی در letters.html مانده‌ی کارمند را
    // به‌روز می‌کند — ولی این یعنی هر کاربرِ دارایِ دسترسیِ «نامه‌ها»
    // (که فقط برای ثبتِ درخواستِ مرخصیِ خودش لازم است) می‌توانست با
    // یک فراخوانیِ مستقیمِ API، کل آرایه‌ی کارمندان را با هر مقداریِ
    // دلخواه جای‌گزین کند. حالا آن به‌روزرسانی از طریقِ اندپوینتِ
    // محدودِ POST /api/employees/apply-leave-effect انجام می‌شود
    // (فقط چند فیلدِ مشخصِ مرخصی، فقط برای یک کارمند) و نیازی به
    // نوشتنِ کاملِ این کلید از ماژولِ «نامه‌ها» نیست.
    "stlp_employees": ["payroll"],
    // ثبت/لغو/تأیید درخواست مرخصی، هم‌چنین درخواست نامه‌ی رسمی و
    // خودِ نامه‌ها، همه در letters.html هستند که با دسترسی "letters"
    // محافظت می‌شود.
    "stlp_leave_requests": ["letters"],
    "stlp_letters": ["letters"],
    "stlp_official_letter_requests": ["letters"],
    // این دو کلید هیچ پیشوند شناخته‌شده‌ای (stlp_treasury/...) ندارند
    // و قبلاً در هیچ قانونی نبودند — یعنی هر کاربرِ واردشده (حتی بدون
    // دسترسی خزانه) می‌توانست اسناد حسابداری را بنویسد/حذف کند، یا
    // تنظیم کند سفارش‌های آنلاین به کدام حساب خزانه واریز حساب شوند.
    "stlp_accounting_entries": ["treasury", "onlineStore"],
    "stlp_online_store_settings": ["treasury", "onlineStore"]
};

// کلیدهایی که خواندن‌شان هم محدود است (نه فقط نوشتن): حقوق/دستمزد و
// خزانه/حسابداری، چون حاوی حقوق پایه‌ی تک‌تک کارمندها و دفاتر مالی
// شرکت‌اند. صفحه‌ی «گزارش‌گیری» استثنائاً با دسترسی «reports» هم
// اجازه‌ی خواندن همین چند کلید را دارد (برای گزارش تجمیعی، بدون
// این‌که دسترسی نوشتن/ماژول اصلی را داشته باشد).
const SENSITIVE_READ_EXACT = {
    "stlp_employees": ["payroll", "letters"],
    "invoices": ["sales", "reports", "onlineStore"],
    "salesDeliveries": ["delivery", "sales", "reports"],
    "stlp_accounting_entries": ["treasury", "onlineStore", "reports"]
};

const SENSITIVE_READ_PREFIXES = [
    { prefix: "stlp_payroll", permissions: ["payroll", "reports"] },
    { prefix: "stlp_treasury", permissions: ["treasury", "onlineStore"] },
    { prefix: "stlp_chart_of_accounts", permissions: ["treasury", "onlineStore"] },
    { prefix: "stlp_journal", permissions: ["treasury", "onlineStore"] },
    // سرنخ‌های CRM (نام، تلفن، آدرس مشتریان بالقوه) — قبلاً این‌جا
    // جا افتاده بود، یعنی هر کاربرِ واردشده (حتی بدون دسترسی CRM)
    // می‌توانست کل این داده را از طریق bootstrap بخواند.
    { prefix: "stlp_crm", permissions: ["crm"] }
];

function canReadKey(user, key) {

    if (user.isAdmin) return true;

    if (ADMIN_ONLY_READ_KEYS.has(key)) return false;

    const perms = user.permissions || {};

    if (SENSITIVE_READ_EXACT[key]) {
        return SENSITIVE_READ_EXACT[key].some(function(p) {
            return perms[p] === true;
        });
    }

    for (const rule of SENSITIVE_READ_PREFIXES) {

        if (key.indexOf(rule.prefix) === 0) {

            return rule.permissions.some(function(p) {
                return perms[p] === true;
            });

        }

    }

    return true;

}

// این کلیدها علاوه بر دسترسیِ ماژولِ عمومی (که در EXACT_WRITE_RULES
// چک می‌شود)، به یک فلگِ کاربریِ ریزتر هم نیاز دارند — چون هر کاربرِ
// دارایِ دسترسیِ «نامه‌ها» فقط برای ثبتِ نامه/درخواستِ مرخصیِ خودش
// به آن دسترسی داده شده، نه لزوماً برای مدیریتِ قالب‌های رسمی که
// روی نامه‌های همه‌ی کارمندان اثر می‌گذارد. قبلاً این فقط در UI
// (letters.html) چک می‌شد و از طریقِ فراخوانیِ مستقیمِ API قابل‌دور
// زدن بود.
const EXTRA_WRITE_FLAG_KEYS = {
    "stlp_letter_templates": "canManageLetterTemplates"
};

function canWriteKey(user, key) {

    if (user.isAdmin) return true;

    if (ADMIN_ONLY_WRITE_KEYS.has(key)) return false;

    if (ADMIN_ONLY_WRITE_PREFIXES.some(function(prefix) { return key.indexOf(prefix) === 0; })) {
        return false;
    }

    if (EXTRA_WRITE_FLAG_KEYS[key] && !user[EXTRA_WRITE_FLAG_KEYS[key]]) {
        return false;
    }

    if (EXACT_WRITE_RULES[key]) {

        const perms = user.permissions || {};

        return EXACT_WRITE_RULES[key].some(function(p) {
            return perms[p] === true;
        });

    }

    for (const rule of PREFIX_WRITE_RULES) {

        if (key.indexOf(rule.prefix) === 0) {

            const perms = user.permissions || {};

            // اگر هیچ‌کدام از این دسترسی‌ها روی کاربر تعریف نشده،
            // اجازه‌ی نوشتن فقط با ادمین است (که بالاتر چک شد)
            return rule.permissions.some(function(p) {
                return perms[p] === true;
            });

        }

    }

    // هر چیز دیگری: هر کاربرِ واردشده اجازه دارد
    // (همان رفتار برنامه‌ی قبلی که فقط با صفحه‌ی ورود محافظت می‌شد)
    return true;

}

// دفترِ واقعیِ تراکنش‌های مالی/اسنادِ حسابداری (نه تنظیماتِ حساب‌ها یا
// سرفصل‌ها — آن‌ها همچنان طبق canWriteKey معمولی کار می‌کنند). طبقِ
// PREFIX_WRITE_RULES بالا، دسترسیِ «onlineStore» هم روی این کلیدها
// نوشتن دارد — ولی فقط برای افزودنِ اتمیکِ تراکنشِ خودش، از طریقِ
// POST /api/store/:key (handleAppendKey)، که همچنان از همان
// canWriteKey معمولی استفاده می‌کند. اینجا فقط PUT (جای‌گزینیِ کاملِ
// آرایه) و DELETE (حذفِ کاملِ کلید) را سخت‌گیرتر می‌کنیم: قبلاً نقشِ
// محدودِ «تأییدِ سفارش آنلاین» (که فقط باید بتواند تراکنشِ فروشِ
// خودش را اضافه کند) می‌توانست با یک PUT/DELETE مستقیم، کل تاریخچه‌ی
// مالیِ شرکت را جای‌گزین یا پاک کند.
const FULL_WRITE_TREASURY_LEDGER_KEYS = new Set([
    "stlp_treasury",
    "stlp_journal_entries",
    "stlp_accounting_entries"
]);

// لاگِ فعالیت: نه PUT (جای‌گزینی) نه DELETE — حتی برای ادمین. یک
// لاگِ حسابرسیِ واقعی باید append-only باشد؛ اگر خودِ ادمین هم
// بتواند از راهِ اپ آن را پاک/جای‌گزین کند، دیگر قابل‌اعتماد نیست.
// تنها راهِ نوشتن روی این کلید، اندپوینتِ handleAppendActivityLog
// است (که خودش هرگز رکوردِ موجود را حذف/جای‌گزین نمی‌کند، فقط
// اضافه می‌کند).
const IMMUTABLE_APPEND_ONLY_KEYS = new Set([
    "stlp_activity_log"
]);

function canFullyWriteOrDeleteKey(user, key) {

    if (IMMUTABLE_APPEND_ONLY_KEYS.has(key)) return false;

    if (user.isAdmin) return true;

    if (FULL_WRITE_TREASURY_LEDGER_KEYS.has(key)) {
        return (user.permissions || {}).treasury === true;
    }

    return canWriteKey(user, key);

}

module.exports = { canReadKey, canWriteKey, canFullyWriteOrDeleteKey, ADMIN_ONLY_READ_KEYS, IMMUTABLE_APPEND_ONLY_KEYS };

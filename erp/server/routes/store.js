"use strict";

const db = require("../lib/db");
const { sendJson } = require("../lib/http");
const { canReadKey, canWriteKey, canFullyWriteOrDeleteKey, IMMUTABLE_APPEND_ONLY_KEYS } = require("../lib/permissions");
const { hashPassword } = require("../lib/passwords");

function handleBootstrap(req, res, user) {

    const all = db.getAllEntries();
    const allowed = {};

    for (const key of Object.keys(all)) {
        if (canReadKey(user, key)) {
            allowed[key] = all[key];
        }
    }

    sendJson(res, 200, { user, data: allowed });

}

function handleGetKey(req, res, user, key) {

    if (!canReadKey(user, key)) {
        return sendJson(res, 403, { error: "شما به این بخش دسترسی ندارید." });
    }

    sendJson(res, 200, { key, value: db.getValue(key) });

}

// این سه کلید («نامه‌ها»، «درخواست‌های مرخصی»، «درخواست‌های نامه‌ی
// رسمی») فقط با دسترسیِ عمومیِ «letters» هم قابل‌نوشتن‌اند، چون هر
// کارمندی برای ثبتِ درخواست/نامه‌ی خودش به همین دسترسی نیاز دارد —
// ولی یعنی از طریقِ یک PUT مستقیم (نه UI)، هر کاربرِ دارایِ این
// دسترسیِ عمومی می‌توانست آیتمِ کاربرِ دیگری را ویرایش/حذف کند، یا
// حتی یک درخواست/نامه‌ی از قبل تصمیم‌گیری‌شده (که طبقِ طراحیِ
// /api/letters/decide باید فقط با چکِ نقش/مرحله تغییر کند) را
// مستقیماً جای‌گزین کرده و کاملاً چکِ آن اندپوینتِ محدود را دور بزند.
const LETTERS_FAMILY_OWNER_FIELD = {
    "stlp_letters": "createdByUserId",
    "stlp_leave_requests": "requestedByUserId",
    "stlp_official_letter_requests": "requestedByUserId"
};

// این فیلدها فقط باید از طریقِ /api/letters/decide (که نقش/مرحله را
// چک می‌کند) تغییر کنند. بدونِ این لیست، صرفِ «مالکِ یک درخواستِ هنوز
// pending بودن» کافی بود تا خودِ کاربر با یک PUT مستقیم، status را
// مستقیماً به «approved» تغییر دهد و کلِ زنجیره‌ی تأییدِ مدیر/مالی/
// هیات‌مدیره را دور بزند — یعنی درخواستِ مرخصیِ خودش را خودش تأیید
// کند.
const LETTERS_FAMILY_DECISION_FIELDS = [
    "status",
    "managerDecidedAt", "managerDecidedByUserId",
    "decidedAt", "decidedByUserId",
    "managerSignedAt", "managerSignedByUserId",
    "boardSignedAt", "boardSignedByUserId",
    "letterNo", "signerName", "signerUserId", "signedAt", "qrPayload"
];

// وضعیتِ مجاز برای یک رکوردِ تازه‌ساز (نه ویرایش‌شده). درخواستِ
// مرخصی همیشه با «در انتظار» شروع می‌شود، ولی نامه‌ی رسمی طبقِ
// قاعده‌ی کسب‌وکار («نامه‌های رسمی سطحِ مدیر ندارند» — letters.html
// خودش این را در کامنت‌های stlpSubmitOfficialLetterRequest و
// stlpSubmitBulkIssueLetters توضیح داده) از ابتدا manager_approved
// ساخته می‌شود — هم مسیرِ تکی هم مسیرِ گروهیِ صدورِ آن. «approved»/
// «rejected» هیچ‌وقت برای یک رکوردِ تازه مجاز نیست، چون آن‌ها فقط
// باید نتیجه‌ی /api/letters/decide (با چکِ نقش) باشند.
const LETTERS_FAMILY_NEW_ITEM_ALLOWED_STATUS = {
    "stlp_leave_requests": ["pending"],
    "stlp_official_letter_requests": ["pending", "manager_approved"]
};

// یک آیتمِ تازه (چه از طریقِ PUT کاملِ آرایه، چه از طریقِ POST
// اتمیکِ handleAppendKey) را برای یک کاربرِ غیرادمین بررسی می‌کند:
// باید متعلقِ خودِ کاربر باشد، وضعیتِ شروعش طبقِ قاعده‌ی بالا مجاز
// باشد، و هیچ‌کدام از فیلدهای تصمیم‌گیریِ دیگر (شماره‌نامه، امضا،
// تاریخِ تأیید و ...) از قبل پر نشده باشد.
function validateNewLettersFamilyItem(user, key, item) {

    const ownerField = LETTERS_FAMILY_OWNER_FIELD[key];

    if (item[ownerField] !== user.id) {
        return { ok: false, error: "امکانِ افزودنِ رکورد برای کاربرِ دیگر وجود ندارد." };
    }

    if (key !== "stlp_letters") {

        const allowed = LETTERS_FAMILY_NEW_ITEM_ALLOWED_STATUS[key] || ["pending"];
        const status = item.status || "pending";

        if (allowed.indexOf(status) === -1) {
            return { ok: false, error: "درخواست/نامه‌ی جدید نمی‌تواند با این وضعیت ثبت شود." };
        }

    }

    for (const field of LETTERS_FAMILY_DECISION_FIELDS) {

        if (field === "status") continue;

        if (item[field] !== undefined && item[field] !== null && item[field] !== "") {
            return { ok: false, error: "امکانِ ثبتِ رکوردِ از قبل تصمیم‌گیری‌شده وجود ندارد." };
        }

    }

    return { ok: true };

}

function isLettersFamilyItemLocked(key, item) {

    if (!item) return false;

    if (key === "stlp_letters") {
        return !!item.signedAt;
    }

    // stlp_leave_requests / stlp_official_letter_requests: هر وضعیتی
    // غیر از «در انتظار» یعنی حداقل یک سطح تصمیم‌گیری روی آن رفته —
    // از این به بعد فقط handleLettersDecide (با چکِ نقش/مرحله) حق
    // تغییرش را دارد
    return !!item.status && item.status !== "pending";

}

// پیش از پذیرفتنِ یک PUT روی این سه کلید از یک کاربرِ غیرادمین،
// آرایه‌ی قدیم و جدید را مقایسه می‌کند و فقط تغییراتی را قبول
// می‌کند که واقعاً متعلقِ خودِ کاربر و هنوز «تصمیم‌گیری‌نشده» باشند —
// آیتمِ جدید فقط برای خودِ کاربر، ویرایش/حذفِ آیتمِ موجود فقط اگر هم
// مالِ خودش باشد هم قفل نشده باشد.
function validateLettersFamilyPut(user, key, oldRaw, newRaw) {

    if (user.isAdmin) return { ok: true };

    const ownerField = LETTERS_FAMILY_OWNER_FIELD[key];
    if (!ownerField) return { ok: true };

    let oldArr, newArr;

    try {
        oldArr = JSON.parse(oldRaw || "[]");
    } catch (error) {
        oldArr = [];
    }

    try {
        newArr = JSON.parse(newRaw);
    } catch (error) {
        return { ok: false, error: "داده‌ی نامعتبر است." };
    }

    if (!Array.isArray(oldArr)) oldArr = [];

    if (!Array.isArray(newArr)) {
        return { ok: false, error: "داده‌ی نامعتبر است." };
    }

    const oldById = {};

    oldArr.forEach(function(item) {
        if (item && item.id) oldById[item.id] = item;
    });

    const newIds = new Set();

    for (const item of newArr) {

        if (!item || !item.id) {
            return { ok: false, error: "داده‌ی نامعتبر است." };
        }

        newIds.add(item.id);

        const oldItem = oldById[item.id];

        if (!oldItem) {

            const newItemCheck = validateNewLettersFamilyItem(user, key, item);

            if (!newItemCheck.ok) {
                return newItemCheck;
            }

            continue;

        }

        if (JSON.stringify(oldItem) === JSON.stringify(item)) continue;

        if (isLettersFamilyItemLocked(key, oldItem)) {
            return { ok: false, error: "این مورد قبلاً تصمیم‌گیری/امضا شده و دیگر قابلِ ویرایش نیست." };
        }

        if (oldItem[ownerField] !== user.id) {
            return { ok: false, error: "امکانِ ویرایشِ رکوردِ کاربرِ دیگر وجود ندارد." };
        }

        // مالکِ یک آیتمِ هنوز «در انتظار» می‌تواند محتوای خودش (مثلاً
        // تاریخ/دلیلِ درخواست) را ویرایش کند، ولی نمی‌تواند خودش
        // فیلدهای تصمیم‌گیری (status و بقیه) را تغییر دهد — وگرنه
        // می‌توانست با یک PUT مستقیم، درخواستِ خودش را خودش تأیید کند
        for (const field of LETTERS_FAMILY_DECISION_FIELDS) {
            if (JSON.stringify(oldItem[field]) !== JSON.stringify(item[field])) {
                return { ok: false, error: "این تغییر فقط از طریقِ فرآیندِ تصمیم‌گیریِ رسمی مجاز است." };
            }
        }

    }

    for (const id in oldById) {

        if (newIds.has(id)) continue;

        const oldItem = oldById[id];

        if (isLettersFamilyItemLocked(key, oldItem)) {
            return { ok: false, error: "این مورد قبلاً تصمیم‌گیری/امضا شده و دیگر قابلِ حذف نیست." };
        }

        if (oldItem[ownerField] !== user.id) {
            return { ok: false, error: "امکانِ حذفِ رکوردِ کاربرِ دیگر وجود ندارد." };
        }

    }

    return { ok: true };

}

// erp/users.html دیگر رمزِ عبور را در مرورگر هش نمی‌کند (طبقِ طراحیِ
// مستندشده در lib/passwords.js) و آن را متن‌ساده در آرایه‌ی users
// می‌گذارد. چون کلِ آرایه با یک PUT جایگزین می‌شود، نمی‌شود صرفاً بر
// اساسِ «آیا این مقدار فرمتِ scrypt$ دارد یا نه» تصمیم به هش‌کردن
// گرفت — کاربرهایی که هنوز به فرمتِ قدیمی (SHA-256 ساده) ارتقا
// نیافته‌اند هم در همین PUT، بدونِ تغییر، دوباره فرستاده می‌شوند و
// نباید اشتباهاً به‌جای رمزِ واقعی، هشِ خودِ آن رشته‌ی قدیمی گرفته
// شود. راه‌حل: فقط وقتی که مقدارِ password نسبت به نسخه‌ی فعلاً
// ذخیره‌شده‌ی همان کاربر واقعاً عوض شده (یا کاربر کاملاً تازه است)،
// همان مقدار به‌عنوانِ رمزِ متن‌سازِ تازه در نظر گرفته و با scrypt
// هش می‌شود؛ در غیرِ این صورت دست‌نخورده می‌ماند.
async function stlpRehashChangedUserPasswords(oldRaw, newRaw) {

    let oldArr, newArr;

    try {
        oldArr = JSON.parse(oldRaw || "[]");
    } catch (error) {
        oldArr = [];
    }

    try {
        newArr = JSON.parse(newRaw);
    } catch (error) {
        return newRaw;
    }

    if (!Array.isArray(oldArr)) oldArr = [];
    if (!Array.isArray(newArr)) return newRaw;

    const oldById = {};
    oldArr.forEach(function(u) { if (u && u.id) oldById[u.id] = u; });

    for (const u of newArr) {

        if (!u || typeof u.password !== "string" || !u.password) continue;

        const prev = oldById[u.id];
        const passwordChanged = !prev || prev.password !== u.password;

        // اگر عوض نشده، دست نمی‌زنیم (حتی اگر هنوز فرمتِ قدیمی باشد —
        // ارتقای آن فقط وظیفه‌ی جریانِ ورود است، نه این‌جا).
        if (!passwordChanged) continue;

        u.password = await hashPassword(u.password);

    }

    return JSON.stringify(newArr);

}

// تغییرِ دستیِ حساسِ انبار (حذفِ کالا، ویرایشِ مشخصات/قیمتِ فروشِ یک
// کالای موجود، ویرایش/حذفِ یک ردیفِ گردش) باید از کاربرِ غیرِادمین فقط
// وقتی پذیرفته شود که نشستش به‌تازگی رمزِ یک مدیر را تأیید کرده باشد
// (/api/auth/verify-admin). مسیرهای ردگیری‌شده (تأییدِ حواله‌ی خرید،
// رزروِ فاکتور، انتقال به/از فروشگاه) فقط این‌ها را عوض می‌کنند و بدونِ
// ارتقا مجازند: موجودی، رزرو، قیمتِ خرید و نسبتِ تبدیل، و افزودنِ کالای
// جدید. یک فیلدِ خالی/صفرِ قبلی هم تغییر حساب نمی‌شود (نرمال‌سازیِ
// خودکارِ کالاهای قدیمی در لودِ صفحه).
const INVENTORY_TRACKED_FIELDS = new Set([
    "stock", "reserved", "purchasePrice", "packagesPerCarton", "piecesPerPackage",
    // «واحد» هم خودکار عوض می‌شود: نرمال‌سازیِ یک‌بارهٔ کالاهای قدیمی در لودِ صفحه
    "unit"
]);

function inventoryValueIsEmpty(value) {
    return value === undefined || value === null || value === "" || value === 0;
}

function validateInventoryManualWrite(user, key, oldRaw, newRaw) {

    if (user.isAdmin || user.adminElevated) return { ok: true };

    const denyMessage = "این تغییر دستی است و رمزِ مدیر سیستم لازم دارد — از همان پنجره‌ی تأییدِ رمزِ برنامه استفاده کنید.";

    let oldArr, newArr;

    try {
        oldArr = JSON.parse(oldRaw || "[]");
        newArr = JSON.parse(newRaw);
    } catch (error) {
        return { ok: true };
    }

    if (!Array.isArray(oldArr) || !Array.isArray(newArr)) return { ok: true };

    if (key === "stlp_inventory") {

        const newByCode = {};
        newArr.forEach(function(item) { if (item && item.code !== undefined) newByCode[String(item.code)] = item; });

        for (const oldItem of oldArr) {

            if (!oldItem) continue;

            const newItem = newByCode[String(oldItem.code)];

            // حذفِ کالا — به‌جز کالایی که خودِ یک حواله‌ی خرید ساخته بود و
            // حالا همان خرید لغو می‌شود (مسیرِ ردگیری‌شده‌ی
            // stlpReversePurchaseFromInventory)
            if (!newItem) {

                if (oldItem.notes === "ایجادشده خودکار از ثبت خرید") continue;

                return { ok: false, error: denyMessage };

            }

            for (const field of Object.keys(newItem)) {

                if (INVENTORY_TRACKED_FIELDS.has(field)) continue;
                if (inventoryValueIsEmpty(oldItem[field])) continue;
                if (String(oldItem[field]) === String(newItem[field])) continue;

                return { ok: false, error: denyMessage };

            }

        }

        return { ok: true };

    }

    if (key === "inventoryMovements") {

        // گردشِ انبار فقط افزایشی است: هیچ ردیفِ قبلی نباید حذف یا عوض شود
        const newById = {};
        newArr.forEach(function(m) { if (m && m.id !== undefined) newById[String(m.id)] = m; });

        for (const oldMovement of oldArr) {

            if (!oldMovement || oldMovement.id === undefined) continue;

            const newMovement = newById[String(oldMovement.id)];

            if (!newMovement || JSON.stringify(newMovement) !== JSON.stringify(oldMovement)) {
                return { ok: false, error: denyMessage };
            }

        }

        return { ok: true };

    }

    return { ok: true };

}

async function handlePutKey(req, res, user, key, body) {

    if (!canFullyWriteOrDeleteKey(user, key)) {
        return sendJson(res, 403, { error: "شما اجازه‌ی ویرایش این بخش را ندارید. برای دسترسی با مدیر سیستم هماهنگ کنید." });
    }

    let value = body && typeof body.value === "string"
        ? body.value
        : JSON.stringify(body ? body.value : null);

    if (key === "stlp_inventory" || key === "inventoryMovements") {

        const guard = validateInventoryManualWrite(user, key, db.getValue(key), value);

        if (!guard.ok) {
            return sendJson(res, 403, { error: guard.error });
        }

    }

    if (key === "stlp_users") {
        value = await stlpRehashChangedUserPasswords(db.getValue(key), value);
    }

    if (LETTERS_FAMILY_OWNER_FIELD[key]) {

        const check = validateLettersFamilyPut(user, key, db.getValue(key), value);

        if (!check.ok) {
            return sendJson(res, 403, { error: check.error });
        }

    }

    db.setValue(key, value, user.username);

    sendJson(res, 200, { ok: true });

}

function handleDeleteKey(req, res, user, key) {

    if (!canFullyWriteOrDeleteKey(user, key)) {
        return sendJson(res, 403, { error: "شما اجازه‌ی حذف این بخش را ندارید." });
    }

    // حذفِ کاملِ این کلیدها (نه یک آیتم، بلکه کلِ آرایه) یعنی پاک‌شدنِ
    // همه‌ی نامه‌ها/درخواست‌های همه‌ی کارمندان یک‌جا — کاری که هیچ
    // کاربرِ غیرادمینی، هرچند دسترسیِ عمومیِ «letters» داشته باشد،
    // نباید بتواند انجام دهد (همان استدلالِ validateLettersFamilyPut)
    if (LETTERS_FAMILY_OWNER_FIELD[key] && !user.isAdmin) {
        return sendJson(res, 403, { error: "این عملیات فقط برای مدیر سیستم مجاز است." });
    }

    // پاک‌کردنِ کاملِ موجودی/گردشِ انبار هم همین‌طور — فقط مدیر یا نشستِ
    // ارتقا‌یافته با رمزِ مدیر
    if ((key === "stlp_inventory" || key === "inventoryMovements" || key === "stlp_inventory_lots" || key === "stlp_inventory_transactions") &&
        !user.isAdmin && !user.adminElevated) {
        return sendJson(res, 403, { error: "پاک‌کردنِ کاملِ داده‌های انبار فقط با رمزِ مدیر سیستم ممکن است." });
    }

    db.deleteValue(key);
    sendJson(res, 200, { ok: true });

}

// افزودنِ اتمیکِ یک آیتم به آرایه‌ای که در یک کلید ذخیره شده —
// برخلاف PUT (که کل مقدار را جایگزین می‌کند)، اینجا خواندنِ مقدار
// فعلی، بررسیِ تکراری‌نبودن، و نوشتنِ مقدار جدید، همه در یک
// درخواستِ سرور و بدون هیچ awaitـی بین آن‌ها اتفاق می‌افتد — یعنی
// دو درخواستِ هم‌زمان (مثلاً تأیید هم‌زمانِ دو سفارش آنلاینِ مختلف)
// نمی‌توانند وسط هم بپرند و افزودنِ یکدیگر را گم کنند. قبلاً این
// کار با یک GET و بعد یک PUT جداگانه از مرورگر انجام می‌شد
// (postOnlineSaleToErp در store-admin.js)، که بین آن دو درخواست،
// یک تأیید سفارش دیگر می‌توانست دقیقاً همان‌جا فاصله بیندازد و
// نتیجه‌ی خودش را جایگزینِ آرایه‌ی به‌روزشده کند — یعنی فاکتور یا
// تراکنش خزانه‌ی سفارشِ اول، بی‌سروصدا از دست می‌رفت.
// لاگِ فعالیت فقط از طریقِ handleAppendActivityLog (پایین‌تر) نوشته
// می‌شود، نه این اندپوینتِ عمومی — چون آن یکی هویت/زمان را از روی
// نشستِ سرور می‌سازد (غیرِقابلِ جعل)، در حالی که اینجا هر چیزی که
// کلاینت در body.item بفرستد عیناً ذخیره می‌شود.
function handleAppendKey(req, res, user, key, body) {

    if (key === "stlp_activity_log") {
        return sendJson(res, 403, { error: "برای ثبت لاگ باید از اندپوینتِ اختصاصیِ آن استفاده شود." });
    }

    if (!canWriteKey(user, key)) {
        return sendJson(res, 403, { error: "شما اجازه‌ی نوشتن این بخش را ندارید." });
    }

    if (!body || typeof body !== "object" || body.item === undefined || body.item === null) {
        return sendJson(res, 400, { error: "آیتم نامعتبر است." });
    }

    // همان چکِ مالکیت/وضعیتِ مجازِ validateLettersFamilyPut، این‌بار
    // برای مسیرِ افزودنِ اتمیک — بدونِ این، یک POST دستکاری‌شده
    // می‌توانست مستقیماً یک درخواست/نامه با requestedByUserId کاربرِ
    // دیگر یا وضعیتِ از پیش تصمیم‌گیری‌شده اضافه کند، دقیقاً همان
    // چیزی که برای PUT بسته شده بود.
    if (LETTERS_FAMILY_OWNER_FIELD[key] && !user.isAdmin) {

        const newItemCheck = validateNewLettersFamilyItem(user, key, body.item);

        if (!newItemCheck.ok) {
            return sendJson(res, 403, { error: newItemCheck.error });
        }

    }

    // سندِ حسابداری باید بدهکار=بستانکار باشد وگرنه تراز آزمایشی/
    // ترازنامه دیگر برابر نمی‌شوند. این چکِ سمتِ مرورگر (stlpPostJournalEntry
    // در app.js) از قبل وجود داشت، ولی چون این اندپوینتِ عمومیِ افزودن
    // هیچ اعتبارسنجیِ ساختاری‌ای روی body.item نداشت، همان دسترسیِ
    // معمولیِ «treasury»/«onlineStore» (لازم برای ثبتِ فروش آنلاین)
    // برای فرستادنِ یک سندِ نامتوازنِ دستکاری‌شده هم کافی بود.
    if (key === "stlp_journal_entries") {

        const lines = body.item && Array.isArray(body.item.lines) ? body.item.lines : null;

        if (!lines || lines.length === 0) {
            return sendJson(res, 400, { error: "سند حسابداری باید حداقل یک ردیف داشته باشد." });
        }

        let totalDebit = 0;
        let totalCredit = 0;

        for (const line of lines) {

            if (!line || !line.accountId) {
                return sendJson(res, 400, { error: "ردیف سند حسابداری نامعتبر است." });
            }

            totalDebit += Number(line.debit || 0);
            totalCredit += Number(line.credit || 0);

        }

        if (Math.round(totalDebit) !== Math.round(totalCredit)) {
            return sendJson(res, 400, { error: "سند حسابداری نامتوازن است (جمع بدهکار با جمع بستانکار برابر نیست)." });
        }

    }

    let arr;

    try {
        const parsed = JSON.parse(db.getValue(key) || "[]");
        arr = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        arr = [];
    }

    let added = true;

    if (body.dedupeField) {

        const exists = arr.some(function(existing) {
            return existing && String(existing[body.dedupeField]) === String(body.dedupeValue);
        });

        if (exists) added = false;

    }

    if (added) {
        arr.push(body.item);
        db.setValue(key, JSON.stringify(arr), user.username);
    }

    sendJson(res, 200, { ok: true, added: added, length: arr.length });

}

// ثبتِ لاگِ فعالیت — تنها راهِ نوشتن روی stlp_activity_log (رجوع شود
// به permissions.js: PUT/DELETE این کلید حتی برای ادمین هم مسدود
// است، و POST عمومیِ handleAppendKey هم صریحاً این کلید را رد
// می‌کند). قبلاً کل رکورد (از جمله نامِ کاربر و زمان) در مرورگر
// ساخته و با یک PUT کاملِ آرایه ذخیره می‌شد — یعنی هر کاربرِ
// واردشده‌ای می‌توانست با یک فراخوانیِ مستقیم، لاگِ جعلی با نامِ
// کاربرِ دیگری ثبت کند یا کلِ لاگ را با یک PUT/DELETE مستقیم پاک یا
// جای‌گزین کند — دقیقاً برعکسِ هدفِ یک لاگِ حسابرسی. حالا فقط
// module/action/details از کلاینت گرفته می‌شود؛ کاربر و زمان همیشه
// از روی نشستِ واقعیِ سرور ساخته می‌شوند، و نوشتن همیشه فقط
// «افزودن» است، هرگز جای‌گزینی/حذف.
function handleAppendActivityLog(req, res, user, body) {

    const clip = function(value, max) {
        return typeof value === "string" ? value.slice(0, max) : "";
    };

    const entry = {
        id: "log_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 9),
        ts: Date.now(),
        date: new Date().toLocaleString("fa-IR"),
        user: user.fullName || user.username || "ناشناس",
        module: clip(body && body.module, 200) || "سیستم",
        action: clip(body && body.action, 200),
        details: clip(body && body.details, 2000)
    };

    let log;

    try {
        const parsed = JSON.parse(db.getValue("stlp_activity_log") || "[]");
        log = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        log = [];
    }

    log.push(entry);

    db.setValue("stlp_activity_log", JSON.stringify(log), user.username);

    sendJson(res, 200, { ok: true, entry: entry });

}

// شماره‌ی بعدیِ فاکتور را اتمیک روی سرور تولید می‌کند تا دو
// کاربر هم‌زمان همان شماره را نگیرند (قبلاً این محاسبه در
// مرورگر انجام می‌شد که زیر بار هم‌زمان، شماره‌ی تکراری می‌داد).
function handleNextInvoiceNumber(req, res, user) {

    const perms = user.permissions || {};

    if (!user.isAdmin && perms.sales !== true && perms.onlineStore !== true) {
        return sendJson(res, 403, { error: "شما اجازه‌ی صدور فاکتور را ندارید." });
    }

    const year = new Date().getFullYear();
    const key = "stlpInvoiceCounter_" + year;
    const counter = db.incrementCounter(key, 100000);

    sendJson(res, 200, { number: "STLP-" + year + "-" + counter });

}

// شماره‌ی بعدیِ پیش‌فاکتور را هم اتمیک تولید می‌کند — قبلاً این
// عدد در مرورگر با «بزرگ‌ترین quoteNo موجود + ۱» محاسبه می‌شد که
// زیر بار هم‌زمان (دو نفر هم‌زمان پیش‌فاکتور بزنند) می‌توانست
// عدد تکراری بدهد. اولین بار که این شمارنده صدا زده می‌شود، از
// بزرگ‌ترین شماره‌ی موجود در stlp_quotations شروع می‌شود تا با
// پیش‌فاکتورهای قدیمی برخورد نکند.
function handleNextQuoteNumber(req, res, user) {

    const perms = user.permissions || {};

    if (!user.isAdmin && perms.sales !== true) {
        return sendJson(res, 403, { error: "شما اجازه‌ی صدور پیش‌فاکتور را ندارید." });
    }

    let maxExisting = 0;

    try {

        const quotes = JSON.parse(db.getValue("stlp_quotations") || "[]");

        if (Array.isArray(quotes)) {
            maxExisting = quotes.reduce(function(max, q) {
                return Math.max(max, Number(q.quoteNo || 0));
            }, 0);
        }

    } catch (error) {
        maxExisting = 0;
    }

    const counter = db.incrementCounter("stlpQuoteCounter", maxExisting);

    sendJson(res, 200, { number: counter });

}

// شماره‌ی بعدیِ سند حسابداری را هم اتمیک تولید می‌کند. قبلاً این
// شمارنده («stlp_journal_counter») هم در حافظه‌ی مرورگر (متغیر
// stlpJournalCounter در app.js) و هم جداگانه در store-admin.js
// (برای فروش‌های آنلاین) با یک GET+افزایش+PUT ساده محاسبه می‌شد —
// یعنی دو تب/کاربر هم‌زمان، یا یک تأیید سفارش آنلاین هم‌زمان با یک
// ثبت تراکنش خزانه، می‌توانستند یک شماره‌ی سند تکراری بگیرند.
function handleNextJournalNumber(req, res, user) {

    const perms = user.permissions || {};

    if (!user.isAdmin && perms.treasury !== true && perms.onlineStore !== true) {
        return sendJson(res, 403, { error: "شما اجازه‌ی ثبت سند حسابداری را ندارید." });
    }

    let maxExisting = 0;

    try {

        const entries = JSON.parse(db.getValue("stlp_journal_entries") || "[]");

        if (Array.isArray(entries)) {
            maxExisting = entries.reduce(function(max, e) {
                return Math.max(max, Number(e.number || 0));
            }, 0);
        }

    } catch (error) {
        maxExisting = 0;
    }

    const counter = db.incrementCounter("stlp_journal_counter", maxExisting);

    sendJson(res, 200, { number: counter });

}

// شماره‌ی بعدیِ حواله را هم اتمیک تولید می‌کند. قبلاً هم index.html
// (فاکتور فروش) و هم purchases.html (خرید) با یک max(deliveryNo
// موجود)+۱ محاسبه‌شده در مرورگر شماره می‌گرفتند — یعنی یک فروشنده و
// یک کارپردازِ خرید که هم‌زمان ثبت می‌کردند می‌توانستند شماره‌ی
// حواله‌ی یکسان بگیرند.
function handleNextDeliveryNumber(req, res, user) {

    const perms = user.permissions || {};

    if (!user.isAdmin && perms.sales !== true && perms.purchases !== true && perms.delivery !== true) {
        return sendJson(res, 403, { error: "شما اجازه‌ی صدور حواله را ندارید." });
    }

    let maxExisting = 0;

    try {

        const deliveries = JSON.parse(db.getValue("salesDeliveries") || "[]");

        if (Array.isArray(deliveries)) {
            maxExisting = deliveries.reduce(function(max, d) {
                return Math.max(max, Number(d.deliveryNo || 0));
            }, 0);
        }

    } catch (error) {
        maxExisting = 0;
    }

    const counter = db.incrementCounter("stlp_delivery_counter", maxExisting);

    sendJson(res, 200, { number: counter });

}

// شماره‌ی بعدیِ نامه را هم اتمیک تولید می‌کند (به همون دلیل
// شمارنده‌های بالا — قبلاً در مرورگر با max(موجود)+۱ محاسبه
// می‌شد که زیر بار هم‌زمان می‌توانست شماره‌ی تکراری بدهد).
function handleNextLetterNumber(req, res, user) {

    const perms = user.permissions || {};

    if (!user.isAdmin && perms.letters !== true) {
        return sendJson(res, 403, { error: "شما اجازه‌ی صدور نامه را ندارید." });
    }

    let maxExisting = 0;

    try {

        const letters = JSON.parse(db.getValue("stlp_letters") || "[]");

        if (Array.isArray(letters)) {
            maxExisting = letters.reduce(function(max, l) {
                return Math.max(max, Number(l.letterNo || 0));
            }, 0);
        }

    } catch (error) {
        maxExisting = 0;
    }

    const counter = db.incrementCounter("stlp_letter_counter", maxExisting);

    sendJson(res, 200, { number: counter });

}

function handleNextOfficialLetterNumber(req, res, user) {

    const perms = user.permissions || {};

    if (!user.isAdmin && perms.letters !== true) {
        return sendJson(res, 403, { error: "شما اجازه‌ی صدور نامه را ندارید." });
    }

    let maxExisting = 0;

    try {

        const requests = JSON.parse(db.getValue("stlp_official_letter_requests") || "[]");

        if (Array.isArray(requests)) {
            maxExisting = requests.reduce(function(max, r) {
                return Math.max(max, Number(r.letterNo || 0));
            }, 0);
        }

    } catch (error) {
        maxExisting = 0;
    }

    const counter = db.incrementCounter("stlp_official_letter_counter", maxExisting);

    sendJson(res, 200, { number: counter });

}

// فقط مانده‌ی مرخصی/سوابقِ مرتبط با مرخصیِ یک کارمند را (طبق فهرستِ
// سفیدِ فیلدهای مجاز زیر) اتمیک تغییر می‌دهد. این جایگزینِ روشِ قبلی
// شد که در آن letters.html برای تأییدِ نهاییِ یک درخواستِ مرخصی، کل
// آرایه‌ی stlp_employees را می‌خواند و با PUT کامل می‌نوشت — یعنی هر
// کاربری که فقط دسترسیِ ماژولِ «نامه‌ها» را داشت (که برای ثبتِ
// درخواستِ مرخصیِ خودش لازم است) می‌توانست با یک فراخوانیِ مستقیمِ
// API، کل آرایه‌ی کارمندان (حقوق، شماره‌حساب، کدملی و ...) را با
// هر مقداریِ دلخواه جای‌گزین کند. اینجا فقط همین چند فیلدِ مشخص،
// فقط برای همون یک کارمند، مجاز است.
const EMPLOYEE_LEAVE_EFFECT_FIELDS = {
    leaveBalance: "number",
    sickLeavePaidUsedThisYear: "number",
    sickLeaveUnpaidUsedThisYear: "number",
    maternityLeaveActive: "boolean",
    maternityLeaveStartDate: "string"
};

function handleApplyEmployeeLeaveEffect(req, res, user, body) {

    const perms = user.permissions || {};

    // این دسترسیِ گسترده («letters») فقط برای همین یک فراخوانِ خاصِ
    // stlpFinanceDecide لازم است، نه اینکه هر دارنده‌ی آن بتواند مانده‌ی
    // هر کارمندی را به هر مقداری تغییر دهد — همین‌جا پایین‌تر با
    // requestId/employeeId/status/canApproveLeaveFinance این را واقعاً
    // به همان یک مورد محدود می‌کنیم.
    if (!user.isAdmin && perms.payroll !== true && perms.letters !== true) {
        return sendJson(res, 403, { error: "شما اجازه‌ی این عملیات را ندارید." });
    }

    const employeeId = body && body.employeeId;
    const effect = body && body.effect;
    const requestId = body && body.requestId;

    if (!employeeId || typeof employeeId !== "string") {
        return sendJson(res, 400, { error: "شناسه‌ی کارمند نامعتبر است." });
    }

    if (!effect || typeof effect !== "object" || Array.isArray(effect)) {
        return sendJson(res, 400, { error: "اطلاعاتِ تغییر نامعتبر است." });
    }

    for (const field of Object.keys(effect)) {

        const expectedType = EMPLOYEE_LEAVE_EFFECT_FIELDS[field];

        if (!expectedType) {
            return sendJson(res, 400, { error: "فیلدِ «" + field + "» مجاز نیست." });
        }

        if (typeof effect[field] !== expectedType) {
            return sendJson(res, 400, { error: "نوعِ مقدارِ «" + field + "» نامعتبر است." });
        }

    }

    // این اندپوینت قبلاً فقط دسترسیِ عمومیِ «letters»/«payroll» را چک
    // می‌کرد و employeeId/effect را کاملاً به کلاینت اعتماد می‌کرد — یعنی
    // هر کاربرِ دارایِ دسترسیِ «letters» (که هر کارمندی فقط برای ثبتِ
    // درخواستِ خودش دارد) می‌توانست با یک POST مستقیم، مانده‌ی مرخصیِ هر
    // کارمندِ دیگری را به هر مقداریِ دلخواه تغییر دهد. تنها مصرف‌کننده‌ی
    // واقعیِ این اندپوینت (letters.html، stlpFinanceDecide) همیشه دقیقاً
    // همین لحظه — بلافاصله قبل از handleLettersDecide('leave-finance')
    // — روی یک درخواستِ واقعی که تازه به مرحله‌ی «manager_approved»
    // رسیده صدا زده می‌شود؛ همین‌جا دقیقاً همان را تأیید می‌کنیم.
    if (!user.isAdmin) {

        if (!requestId || typeof requestId !== "string") {
            return sendJson(res, 400, { error: "این عملیات بدونِ شناسه‌ی درخواستِ مرخصی مجاز نیست." });
        }

        if (perms.payroll !== true && user.canApproveLeaveFinance !== true) {
            return sendJson(res, 403, { error: "شما اجازه‌ی این تصمیم‌گیری را ندارید." });
        }

        let leaveRequests;

        try {
            const parsedRequests = JSON.parse(db.getValue("stlp_leave_requests") || "[]");
            leaveRequests = Array.isArray(parsedRequests) ? parsedRequests : [];
        } catch (error) {
            leaveRequests = [];
        }

        const linkedRequest = leaveRequests.find(function(r) { return r && r.id === requestId; });

        if (!linkedRequest || linkedRequest.employeeId !== employeeId) {
            return sendJson(res, 404, { error: "درخواستِ مرخصیِ مرتبط پیدا نشد." });
        }

        if (linkedRequest.status !== "manager_approved") {
            return sendJson(res, 409, { error: "این درخواست هنوز به مرحله‌ی تأییدِ مالی نرسیده یا قبلاً نهایی شده است." });
        }

    }

    let employees;

    try {
        const parsed = JSON.parse(db.getValue("stlp_employees") || "[]");
        employees = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        employees = [];
    }

    const index = employees.findIndex(function(e) { return e && e.id === employeeId; });

    if (index < 0) {
        return sendJson(res, 404, { error: "کارمند پیدا نشد." });
    }

    Object.assign(employees[index], effect);

    db.setValue("stlp_employees", JSON.stringify(employees), user.username);

    sendJson(res, 200, { ok: true });

}

// تصمیم‌گیریِ سطوحِ مختلفِ تأییدِ درخواستِ مرخصی/نامه‌ی رسمی (مدیرِ
// بخش، مالی، هیات مدیره). قبلاً این چهار عملیات فقط توابعِ سمتِ
// مرورگر بودند که با یک PUT کاملِ کلید (فقط با دسترسیِ عمومیِ ماژولِ
// «نامه‌ها») ذخیره می‌شدند — یعنی هیچ کنترلی نبود که آیا کاربرِ
// واردشده واقعاً مدیر/معاونِ همان بخش، مسئولِ مالیِ مجاز، یا عضوِ
// هیات مدیره است یا نه؛ کافی بود کاربر دسترسیِ «نامه‌ها» را داشته
// باشد (که هر کارمندی برای ثبتِ درخواستِ خودش لازم دارد) تا با یک
// فراخوانیِ مستقیمِ API هر تصمیمی در هر سطحی (حتی امضای نهاییِ هیات
// مدیره روی یک نامه‌ی رسمی، با signerName جعلی) بگیرد.
const LETTERS_DECIDE_ACTIONS = {
    "leave-manager": "stlp_leave_requests",
    "leave-finance": "stlp_leave_requests",
    "official-manager": "stlp_official_letter_requests",
    "official-board": "stlp_official_letter_requests",
    // نامه‌ی خارج‌سازمانیِ معمولی (نه فرمِ رسمی/گواهی) — طبق تصمیمِ
    // کسب‌وکار، هر کسی که بنویسدش، فقط عضوِ هیات مدیره می‌تواند امضایش
    // کند؛ سطحِ مدیرِ بخش برای این نوع نامه اصلاً وجود ندارد
    "external-board": "stlp_letters"
};

// مرحله‌ای که یک درخواست باید در آن باشد تا این تصمیمِ خاص روی آن
// مجاز باشد — بدونِ این، مسئولِ مالی می‌توانست یک درخواستِ مرخصیِ
// هنوز تأییدنشده (یا حتی ردشده‌ی) مدیرِ بخش را مستقیماً «تأیید نهایی»
// کند (و اثر واقعیِ آن روی مانده‌ی مرخصی اعمال شود)، یا هیات مدیره
// یک نامه‌ی رسمی را بدونِ عبور از تأییدِ مدیرِ بخش امضا کند — چون
// پیش از این، این تابع فقط نقش/دسترسیِ کاربر را چک می‌کرد، نه اینکه
// درخواست اصلاً به آن مرحله رسیده باشد یا نه.
const LETTERS_DECIDE_REQUIRED_STATUS = {
    "leave-manager": "pending",
    "leave-finance": "manager_approved",
    "official-manager": "pending",
    "official-board": "manager_approved"
};

function handleLettersDecide(req, res, user, body) {

    const perms = user.permissions || {};

    if (!user.isAdmin && perms.letters !== true) {
        return sendJson(res, 403, { error: "شما اجازه‌ی این عملیات را ندارید." });
    }

    const action = body && body.action;
    const requestId = body && body.requestId;
    const approve = !!(body && body.approve);

    if (!LETTERS_DECIDE_ACTIONS[action]) {
        return sendJson(res, 400, { error: "عملیات نامعتبر است." });
    }

    if (!requestId || typeof requestId !== "string") {
        return sendJson(res, 400, { error: "شناسه‌ی درخواست نامعتبر است." });
    }

    const key = LETTERS_DECIDE_ACTIONS[action];

    let requests;

    try {
        const parsed = JSON.parse(db.getValue(key) || "[]");
        requests = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        requests = [];
    }

    const index = requests.findIndex(function(r) { return r && r.id === requestId; });

    if (index < 0) {
        return sendJson(res, 404, { error: "درخواست پیدا نشد." });
    }

    const request = requests[index];

    let employees = [];

    try {
        const parsedEmp = JSON.parse(db.getValue("stlp_employees") || "[]");
        employees = Array.isArray(parsedEmp) ? parsedEmp : [];
    } catch (error) {
        employees = [];
    }

    const employee =
        user.employeeId
            ? employees.find(function(e) { return e && e.id === user.employeeId; }) || null
            : null;

    let authorized = !!user.isAdmin;

    if (!authorized) {

        if (action === "leave-manager" || action === "official-manager") {

            authorized = !!(
                employee &&
                (employee.orgRole === "manager" || employee.orgRole === "deputy") &&
                employee.departmentId &&
                employee.departmentId === request.departmentId
            );

        } else if (action === "leave-finance") {

            authorized = user.canApproveLeaveFinance === true;

        } else if (action === "official-board" || action === "external-board") {

            authorized = !!(employee && employee.orgRole === "board");

        }

    }

    if (!authorized) {
        return sendJson(res, 403, { error: "شما اجازه‌ی این تصمیم‌گیری را ندارید." });
    }

    const requiredStatus = LETTERS_DECIDE_REQUIRED_STATUS[action];

    if (requiredStatus && request.status !== requiredStatus) {
        return sendJson(res, 409, { error: "این درخواست هنوز به این مرحله نرسیده یا قبلاً تصمیم‌گیری شده است." });
    }

    if (action === "external-board" && request.signedAt) {
        return sendJson(res, 409, { error: "این نامه قبلاً امضا شده است." });
    }

    const nowIso = new Date().toISOString();

    if (action === "leave-manager") {

        request.status = approve ? "manager_approved" : "rejected";
        request.managerDecidedAt = nowIso;
        request.managerDecidedByUserId = user.id;

    } else if (action === "leave-finance") {

        request.status = approve ? "approved" : "rejected";
        request.decidedAt = nowIso;
        request.decidedByUserId = user.id;

    } else if (action === "official-manager") {

        request.status = approve ? "manager_approved" : "rejected";
        request.managerSignedAt = nowIso;
        request.managerSignedByUserId = user.id;

    } else if (action === "official-board") {

        request.status = approve ? "approved" : "rejected";
        request.boardSignedAt = nowIso;
        request.boardSignedByUserId = user.id;

        // شماره/امضاکننده/QR فقط این‌جا (سمت سرور، از روی کاربرِ واقعاً
        // واردشده) ساخته می‌شود تا کسی نتواند با یک فراخوانیِ دستکاری‌شده
        // signerName جعلی برای این نامه‌ی رسمی ثبت کند
        if (approve) {

            if (!request.letterNo) {
                request.letterNo = db.incrementCounter("stlp_official_letter_counter", 0);
            }

            // تاریخِ شمسیِ امروز را (فقط برای نمایش روی سربرگِ چاپی،
            // بدون تأثیر در اختیار/امنیت) از مرورگر می‌گیریم چون تبدیلِ
            // تقویمِ شمسی این‌جا (سمتِ سرور) وجود ندارد
            if (!request.date && body && typeof body.date === "string") {
                request.date = body.date.slice(0, 40);
            }

            request.signerName = user.fullName || user.username || "";

            request.qrPayload =
                "STLP-LETTER|" + request.letterNo + "|" + (request.date || "") + "|" + request.signerName;

        }

    } else if (action === "external-board" && approve) {

        // نامه‌های خارج‌سازمانیِ معمولی status جداگانه ندارند (فقط
        // signedAt/عدمِ signedAt)، پس فقط همین فیلدها ست می‌شوند —
        // امضاکننده/تاریخ/QR هم از روی کاربرِ واقعیِ واردشده، نه چیزی
        // که کلاینت بفرستد (به‌جز تاریخِ شمسی که صرفاً نمایشی است)
        if (!request.date && body && typeof body.date === "string") {
            request.date = body.date.slice(0, 40);
        }

        request.signerUserId = user.id;
        request.signerName = user.fullName || user.username || "";
        request.signedAt = nowIso;

        request.qrPayload =
            "STLP-LETTER|" + (request.letterNo || "") + "|" + (request.date || "") + "|" + request.signerName;

    }

    requests[index] = request;

    db.setValue(key, JSON.stringify(requests), user.username);

    sendJson(res, 200, { ok: true, request: request });

}

// POST /api/crm/reset — پاک‌کردنِ کاملِ سرنخ‌های CRM. این عملیات
// در crm_engine.js (crmResetDB) فقط با یک چکِ سمتِ مرورگر
// (crmIsAdmin) محدود بود، ولی خودِ نوشتنش از همان PUT عمومیِ
// /api/store/stlp_crm_records رد می‌شد که هر کاربرِ دارایِ دسترسیِ
// معمولیِ «crm» (لازم برای کارِ روزمره‌ی CRM) هم اجازه‌ی نوشتن رویش
// دارد — چون افزودن/ویرایش/حذفِ تک‌تکِ سرنخ‌ها هم از همان مسیر
// (جای‌گزینیِ کاملِ آرایه) انجام می‌شود و سرور نمی‌تواند از روی
// شکلِ درخواست، «ویرایشِ یک سرنخ» را از «پاک‌کردنِ همه» تشخیص دهد.
// برای همین، فقط برای این عملیاتِ مخربِ خاص، یک اندپوینتِ جداگانه و
// واقعاً ادمین-فقط ساخته شده — دقیقاً همان الگویی که برای
// /api/letters/decide استفاده شد.
function handleCrmReset(req, res, user) {

    if (!user.isAdmin) {
        return sendJson(res, 403, { error: "این بخش فقط برای مدیر سیستم قابل دسترسی است." });
    }

    db.setValue("stlp_crm_records", "[]", user.username);

    sendJson(res, 200, { ok: true });

}

function handleImportBackup(req, res, user, body) {

    if (!user.isAdmin) {
        return sendJson(res, 403, { error: "فقط مدیر سیستم می‌تواند اطلاعات قدیمی را وارد کند." });
    }

    if (!body || typeof body !== "object" || !body.data || typeof body.data !== "object") {
        return sendJson(res, 400, { error: "ساختار فایل پشتیبان معتبر نیست." });
    }

    // لاگِ فعالیت هرگز از طریقِ import جای‌گزین نمی‌شود، حتی برای
    // ادمین — دقیقاً همان قانونِ IMMUTABLE_APPEND_ONLY_KEYS که PUT/
    // DELETEِ مستقیمِ آن را هم قبلاً می‌بندد. بدونِ این، وارد کردنِ
    // یک پشتیبانِ قدیمی (که معمولاً خودش شاملِ همین کلید است) کاملاً
    // بی‌سروصدا کل تاریخچه‌ی لاگِ فعالیت از آن لحظه به بعد را پاک/
    // جای‌گزین می‌کرد.
    const keysToImport = Object.keys(body.data).filter(function(key) {
        return typeof body.data[key] === "string" &&
            (key !== "stlp_users" || body.includeUsers) &&
            !IMMUTABLE_APPEND_ONLY_KEYS.has(key);
    });

    // اعتبارسنجی: قبل از نوشتنِ حتی یک کلید، همه‌ی مقادیر باید JSON
    // معتبر باشند (تمامِ کلیدهای این سیستم همیشه JSON ذخیره می‌شوند).
    // قبلاً یک فایلِ خراب/دست‌کاری‌شده می‌توانست یکی از کلیدها را با
    // یک رشته‌ی نامعتبر جای‌گزین کند و بقیه‌ی کلیدها را هم نوشته بودیم؛
    // یعنی import نیمه‌کاره و ناهماهنگ (مثلاً فاکتورهای جدید کنار
    // خزانه‌ی قدیمی) روی سیستم می‌ماند. حالا کل import یا با موفقیت
    // کامل انجام می‌شود یا اصلاً هیچ کلیدی نوشته نمی‌شود.
    const invalidKeys = [];

    for (const key of keysToImport) {

        try {
            JSON.parse(body.data[key]);
        } catch (error) {
            invalidKeys.push(key);
        }

    }

    if (invalidKeys.length > 0) {
        return sendJson(res, 400, {
            error: "فایل پشتیبان معتبر نیست — این کلیدها JSON سالم ندارند: " + invalidKeys.join("، ")
        });
    }

    // اسنپ‌شاتِ مقادیرِ فعلیِ همین کلیدها، برای بازگردانی اگر وسطِ کار
    // (مثلاً خطای غیرمنتظره‌ی دیسک) یکی از نوشتن‌ها شکست بخورد
    const snapshot = {};

    for (const key of keysToImport) {
        snapshot[key] = db.getValue(key);
    }

    let importedCount = 0;

    try {

        for (const key of keysToImport) {
            db.setValue(key, body.data[key], user.username);
            importedCount++;
        }

    } catch (error) {

        console.error("❌ خطا هنگام وارد کردنِ پشتیبان — بازگردانی به حالت قبل:", error);

        for (const key of Object.keys(snapshot)) {

            if (snapshot[key] === null) continue; // کلیدی که قبلاً وجود نداشت را دوباره خالی نمی‌گذاریم؛ همان‌طور می‌ماند
            db.setValue(key, snapshot[key], user.username);

        }

        return sendJson(res, 500, { error: "درون‌ریزیِ پشتیبان با خطا مواجه شد؛ اطلاعاتِ قبلی بازگردانده شد." });

    }

    sendJson(res, 200, { ok: true, importedCount });

}

module.exports = {
    handleBootstrap,
    handleGetKey,
    handlePutKey,
    handleDeleteKey,
    handleAppendKey,
    handleNextInvoiceNumber,
    handleNextQuoteNumber,
    handleNextJournalNumber,
    handleNextDeliveryNumber,
    handleNextLetterNumber,
    handleNextOfficialLetterNumber,
    handleApplyEmployeeLeaveEffect,
    handleLettersDecide,
    handleCrmReset,
    handleAppendActivityLog,
    handleImportBackup
};

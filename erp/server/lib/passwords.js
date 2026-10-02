// =====================================================
// هش کردن امن رمز عبور (نمک‌دار / salted) با scrypt
// =====================================================
//
// نسخه‌ی اول این پروژه رمز عبور را فقط با SHA-256 ساده (بدون نمک)
// هش می‌کرد — همان روشی که کد قدیمیِ سمت مرورگر (stlpSha256Hex)
// هم استفاده می‌کرد. SHA-256 ساده برای رمز عبور مناسب نیست: چون
// خیلی سریع محاسبه می‌شود، اگر یک روز فایل دیتابیس لو برود، شکستن
// همه‌ی رمزها با جدول‌های آماده (rainbow table) یا brute-force
// ظرف چند ثانیه ممکن است. راه‌حل درست، هش‌کردن با نمکِ تصادفیِ
// مخصوص هر کاربر و یک الگوریتم کندِ مخصوص رمز عبور است.
//
// این‌جا از scrypt استفاده شده که مستقیماً داخل خودِ Node.js است
// (ماژول crypto) و نیازی به نصب هیچ پکیج بیرونی ندارد — دقیقاً
// هم‌سو با هدف اصلیِ این سرور (بدون وابستگی به npm).
//
// این فایل هیچ تغییری در فرانت‌اند (app.js و غیره) نمی‌دهد؛ چون
// رمز عبور همیشه به‌صورت متن‌ساده (روی HTTPS) به سرور فرستاده
// می‌شود و فقط خودِ سرور تصمیم می‌گیرد چطور هشش کند و ذخیره‌اش
// کند. کاربرهای قدیمی که هنوز هش SHA-256 ساده دارند، در همان اولین
// ورود موفقشان به‌طور خودکار و بی‌سروصدا به فرمت جدید ارتقا پیدا
// می‌کنند (نیازی به تغییر رمز عبور نیست).
//
// نکته‌ی مهم درباره‌ی sync در برابر async:
// نسخه‌ی اول این فایل از crypto.scryptSync استفاده می‌کرد. مشکل
// scryptSync این است که «همزمان» (synchronous) است، یعنی تا
// تمام‌نشدنش، کل رشته‌ی اصلیِ Node (event loop) قفل می‌شود — و چون
// این سرور تک‌رشته‌ای است، دقیقاً یعنی «کل سرور برای همه‌ی
// کاربرهای دیگر» هم در همان لحظه منتظر می‌ماند. با یک تستِ بارِ
// واقعی (۵۰۰ ورودِ همزمان) این مشکل به‌وضوح دیده شد: نفرِ آخر باید
// ~۱۸ ثانیه صبر می‌کرد، و در تمام آن ۱۸ ثانیه، هیچ درخواستِ دیگری
// (حتی یک صفحه‌ی ساده‌ی HTML برای کاربری که کاری به لاگین نداشت)
// جواب داده نمی‌شد. راه‌حل: از crypto.scrypt نسخه‌ی async (callback/
// Promise) استفاده می‌کنیم که محاسبه‌ی سنگین را به thread pool
// داخلیِ خودِ Node می‌سپارد، نه به همان رشته‌ی اصلی که به همه‌ی
// درخواست‌های دیگر هم سرویس می‌دهد.

"use strict";

const crypto = require("crypto");

const SCRYPT_PREFIX = "scrypt$";
const SCRYPT_KEYLEN = 64;

function sha256hex(text) {
    return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function scryptAsync(password, salt, keylen) {
    return new Promise(function(resolve, reject) {
        crypto.scrypt(password, salt, keylen, function(error, derivedKey) {
            if (error) return reject(error);
            resolve(derivedKey);
        });
    });
}

// رمز عبور را با یک نمکِ تصادفیِ جدید هش می‌کند و رشته‌ی قابل‌ذخیره
// برمی‌گرداند: scrypt$<نمک به‌صورت hex>$<هش به‌صورت hex>
async function hashPassword(plainPassword) {

    const salt = crypto.randomBytes(16);
    const derived = await scryptAsync(String(plainPassword || ""), salt, SCRYPT_KEYLEN);

    return SCRYPT_PREFIX + salt.toString("hex") + "$" + derived.toString("hex");

}

// یک رمز عبورِ ورودی را با مقدار ذخیره‌شده مقایسه می‌کند.
// از هر دو فرمت پشتیبانی می‌کند:
//   ۱. فرمت جدید (scrypt$نمک$هش)
//   ۲. فرمت قدیمی (SHA-256 ساده‌ی ۶۴ کاراکتری، بدون نمک) —
//      برای سازگاری با کاربرهایی که هنوز آپگرید نشده‌اند
async function verifyPassword(plainPassword, stored) {

    if (!stored) return false;

    if (stored.indexOf(SCRYPT_PREFIX) === 0) {

        const parts = stored.slice(SCRYPT_PREFIX.length).split("$");
        if (parts.length !== 2) return false;

        const [saltHex, hashHex] = parts;

        try {

            const salt = Buffer.from(saltHex, "hex");
            const expected = Buffer.from(hashHex, "hex");
            const actual = await scryptAsync(String(plainPassword || ""), salt, SCRYPT_KEYLEN);

            if (actual.length !== expected.length) return false;

            return crypto.timingSafeEqual(actual, expected);

        } catch (error) {
            return false;
        }

    }

    // فرمت قدیمی: SHA-256 ساده (یا حتی متن‌ساده، برای داده‌ی خیلی قدیمی)
    return stored === sha256hex(plainPassword) || stored === plainPassword;

}

// آیا این مقدارِ ذخیره‌شده هنوز فرمت قدیمی (ضعیف) است و باید
// در اولین فرصت (ورود موفق) به‌روزرسانی شود؟
function needsUpgrade(stored) {
    return !stored || stored.indexOf(SCRYPT_PREFIX) !== 0;
}

module.exports = { hashPassword, verifyPassword, needsUpgrade, sha256hex };

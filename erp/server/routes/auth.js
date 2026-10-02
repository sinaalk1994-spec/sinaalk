"use strict";

const db = require("../lib/db");
const { sendJson } = require("../lib/http");
const { hashPassword, verifyPassword, needsUpgrade } = require("../lib/passwords");
const {
    SESSION_COOKIE,
    createSession,
    destroySession,
    elevateSession,
    toSessionUser,
    resolveUser
} = require("../lib/auth");

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 5;

// یک هشِ ساختگیِ همیشه-نامعتبر، برای وقتی که اصلاً چنین کاربری
// وجود ندارد. بدونِ این، چون verifyPassword برای کاربرِ ناموجود
// اصلاً صدا زده نمی‌شد، پاسخ برای «نام‌کاربری غلط» تقریباً آنی
// بود ولی برای «رمزِ غلطِ یک کاربرِ واقعی» چند میلی‌ثانیه طول
// می‌کشید (چون scrypt واقعاً اجرا می‌شد) — همین اختلافِ زمانی
// به مهاجم اجازه می‌داد فقط با اندازه‌گیریِ زمانِ پاسخ، نام‌های
// کاربریِ معتبر را حدس بزند. حالا برای هر دو حالت، دقیقاً یک
// عملیاتِ scrypt کامل اجرا می‌شود.
const DUMMY_HASH = "scrypt$" + "00".repeat(16) + "$" + "00".repeat(64);

function loadUsers() {
    try {
        return JSON.parse(db.getValue("stlp_users") || "[]");
    } catch (error) {
        return [];
    }
}

// POST /api/auth/login
async function handleLogin(req, res, body, cookieOptionsBase) {

    const username = String((body && body.username) || "").trim();
    const password = String((body && body.password) || "");

    if (!username || !password) {
        return sendJson(res, 400, { error: "لطفاً نام کاربری و رمز عبور را وارد کنید." });
    }

    const attempt = db.getLoginAttempts(username);

    if (attempt && attempt.locked_until && new Date(attempt.locked_until) > new Date()) {

        const remainMin = Math.ceil((new Date(attempt.locked_until) - new Date()) / 60000);

        return sendJson(res, 423, {
            error: "⛔ به دلیل چند بار ورود رمز اشتباه، این حساب موقتاً قفل شده است. لطفاً " + remainMin + " دقیقه‌ی دیگر دوباره تلاش کنید.",
            locked: true
        });

    }

    // شمارنده‌ی تلاش‌های ناموفق را همین‌جا، قبل از هر عملیاتِ کندی
    // (verifyPassword که واقعاً منتظرِ scrypt می‌ماند) افزایش
    // می‌دهیم. چون این خواندن+نوشتن هیچ awaitـی وسطش ندارد، دو
    // درخواستِ هم‌زمان نمی‌توانند هر دو یک مقدارِ قدیمی را ببینند
    // و قفلِ ۵-بار-تلاش را دور بزنند (قبلاً چون شمارش بعد از
    // verifyPassword انجام می‌شد، چند درخواستِ موازی همه با شمارشِ
    // یکسان شروع می‌کردند).
    const attemptCountSoFar = (attempt ? attempt.count : 0) + 1;
    const willLock = attemptCountSoFar >= MAX_ATTEMPTS;
    const lockedUntilNow = willLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString() : null;

    db.upsertLoginAttempts(username, attemptCountSoFar, lockedUntilNow);

    const users = loadUsers();

    const user = users.find(function(u) {
        return u.username === username && u.active !== false;
    });

    const matches = await verifyPassword(password, user ? user.password : DUMMY_HASH);

    if (!user || !matches) {

        if (willLock) {
            return sendJson(res, 423, {
                error: "⛔ رمز چند بار اشتباه وارد شد. این حساب به مدت " + LOCKOUT_MINUTES + " دقیقه قفل شد.",
                locked: true
            });
        }

        const remaining = MAX_ATTEMPTS - attemptCountSoFar;

        return sendJson(res, 401, {
            error: "نام کاربری یا رمز اشتباه است. " + remaining + " تلاش دیگر باقی مانده است."
        });

    }

    // ارتقای بی‌سروصدای فرمت ذخیره‌سازی رمز عبور: اگر رمز این کاربر
    // هنوز به فرمت قدیمی (SHA-256 ساده یا حتی متن‌ساده) ذخیره شده،
    // حالا که رمز درست وارد شده، آن را با یک نمکِ تصادفیِ جدید
    // دوباره هش می‌کنیم و جایگزین می‌کنیم — کاربر هیچ تغییری حس
    // نمی‌کند، ولی از این به بعد رمزش در دیتابیس با scrypt نمک‌دار
    // ذخیره می‌شود.
    if (needsUpgrade(user.password)) {

        const upgradedPassword = await hashPassword(password);

        // hashPassword (scrypt) چند ده میلی‌ثانیه رشته‌ی اجرا را آزاد
        // می‌کند؛ اگر در همین فاصله یک درخواستِ دیگر (مثلاً یک PUT
        // معمولی روی stlp_users از صفحه‌ی کاربران) کلید را نوشته باشد،
        // نوشتنِ اینجا اگر از روی همان آرایه‌ی users (که قبل از await
        // خوانده شده) ساخته شود، آن تغییرِ هم‌زمان را بی‌سروصدا پاک
        // می‌کند. برای همین، درست قبل از نوشتن، دوباره از دیتابیس
        // می‌خوانیم و فقط رمزِ همین کاربر را روی نسخه‌ی تازه اعمال
        // می‌کنیم.
        const freshUsers = loadUsers();

        const freshIndex = freshUsers.findIndex(function(u) { return u.id === user.id; });

        if (freshIndex >= 0) {

            freshUsers[freshIndex].password = upgradedPassword;
            db.setValue("stlp_users", JSON.stringify(freshUsers), "system");

        }

        user.password = upgradedPassword;

    }

    db.clearLoginAttempts(username);

    const sessionUser = toSessionUser(user);
    const token = createSession(sessionUser);

    sendJson(res, 200, { user: sessionUser }, {
        "Set-Cookie": cookieOptionsBase(SESSION_COOKIE, token, {
            httpOnly: true,
            sameSite: "Lax",
            maxAge: 12 * 60 * 60 * 1000
        })
    });

}

// POST /api/auth/verify-admin
// برای عملیاتِ حساس (مثل حذفِ رکوردهای حسابداری) که حتی کاربرِ
// غیرمدیرِ دارای دسترسیِ آن صفحه هم نباید بدونِ تأییدِ یک مدیرِ
// واقعی انجامش بدهد. برخلافِ ورود، هیچ نشستی نمی‌سازد یا عوض
// نمی‌کند — فقط true/false برمی‌گرداند که آیا این نام‌کاربری/رمز
// واقعاً متعلق به یک مدیرِ فعال است. عمداً از همان شمارشگرِ قفلِ
// ۵-بار-تلاشِ ورود استفاده می‌کند تا کسی نتواند با استفاده از این
// مسیر به‌جای ورود، محدودیتِ تلاش را دور بزند. این تابع خودش هم از
// مسیرهای نیازمندِ ورود است (در server.js بعد از چکِ نشست فراخوانی
// می‌شود) تا کاربرِ واردنشده اصلاً نتواند این مسیر را صدا بزند.
async function handleVerifyAdmin(req, res, body, cookies) {

    const username = String((body && body.username) || "").trim();
    const password = String((body && body.password) || "");

    if (!username || !password) {
        return sendJson(res, 400, { error: "نام‌کاربری و رمز عبور مدیر را وارد کنید." });
    }

    const attempt = db.getLoginAttempts(username);

    if (attempt && attempt.locked_until && new Date(attempt.locked_until) > new Date()) {

        const remainMin = Math.ceil((new Date(attempt.locked_until) - new Date()) / 60000);

        return sendJson(res, 423, {
            error: "⛔ به دلیل چند بار رمز اشتباه، این حساب موقتاً قفل شده است. لطفاً " + remainMin + " دقیقه‌ی دیگر دوباره تلاش کنید.",
            locked: true
        });

    }

    const attemptCountSoFar = (attempt ? attempt.count : 0) + 1;
    const willLock = attemptCountSoFar >= MAX_ATTEMPTS;
    const lockedUntilNow = willLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString() : null;

    db.upsertLoginAttempts(username, attemptCountSoFar, lockedUntilNow);

    const users = loadUsers();

    const user = users.find(function(u) {
        return u.username === username && u.active !== false;
    });

    const matches = await verifyPassword(password, user ? user.password : DUMMY_HASH);

    if (!user || !matches || !user.isAdmin) {

        if (willLock) {
            return sendJson(res, 423, {
                error: "⛔ رمز چند بار اشتباه وارد شد. این حساب به مدت " + LOCKOUT_MINUTES + " دقیقه قفل شد.",
                locked: true
            });
        }

        return sendJson(res, 401, { error: "نام‌کاربری/رمز مدیر اشتباه است یا این حساب مدیر نیست." });

    }

    db.clearLoginAttempts(username);

    // رمزِ مدیر واقعاً تأیید شد → این نشست چند دقیقه «ارتقا‌یافته» است
    // و سرور تغییراتِ دستیِ حساسِ انبار را از آن می‌پذیرد
    if (cookies) elevateSession(cookies[SESSION_COOKIE]);

    return sendJson(res, 200, { ok: true });

}

function handleLogout(req, res, cookies, cookieOptionsBase) {

    const token = cookies[SESSION_COOKIE];
    destroySession(token);

    sendJson(res, 200, { ok: true }, {
        "Set-Cookie": cookieOptionsBase(SESSION_COOKIE, "", { httpOnly: true, sameSite: "Lax", maxAge: 0 })
    });

}

function handleMe(req, res, cookies) {

    const token = cookies[SESSION_COOKIE];
    const user = resolveUser(token);

    if (!user) return sendJson(res, 401, { user: null });

    sendJson(res, 200, { user });

}

module.exports = { handleLogin, handleLogout, handleMe, handleVerifyAdmin };

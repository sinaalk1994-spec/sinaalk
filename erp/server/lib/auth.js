// =====================================================
// نشست‌های ورود (session) — به‌جای «stlp_current_user»ی که
// قبلاً هرکسی می‌توانست از کنسول مرورگر جعل کند.
// نشست‌ها در حافظه‌ی سرور نگه داشته می‌شوند (با ری‌استارت
// سرور، همه باید دوباره وارد شوند — مشکلی نیست).
// =====================================================

"use strict";

const crypto = require("crypto");
const db = require("./db");

const SESSION_COOKIE = "stlp_erp_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // ۱۲ ساعت

const sessions = new Map(); // token -> { user, expiresAt }

// شکل استانداردِ کاربر برای فرستادن به فرانت‌اند / نگه‌داشتن در نشست
// (رمز عبور و فیلدهای داخلی دیگر عمداً این‌جا نیستند)
function toSessionUser(user) {

    return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        isAdmin: !!user.isAdmin,
        permissions: user.permissions || {},
        employeeId: user.employeeId || null,
        isBoardMember: !!user.isBoardMember,
        canSignLetters: !!user.canSignLetters,
        canApproveLeaveManager: !!user.canApproveLeaveManager,
        canApproveLeaveFinance: !!user.canApproveLeaveFinance,
        canManageLetterTemplates: !!user.canManageLetterTemplates
    };

}

function createSession(user) {

    const token = crypto.randomBytes(32).toString("hex");

    sessions.set(token, {
        user,
        expiresAt: Date.now() + SESSION_TTL_MS
    });

    return token;

}

function getSession(token) {

    if (!token) return null;

    const session = sessions.get(token);

    if (!session) return null;

    if (session.expiresAt < Date.now()) {
        sessions.delete(token);
        return null;
    }

    return session;

}

function destroySession(token) {
    if (token) sessions.delete(token);
}

// «ارتقای موقتِ ادمین»: وقتی /api/auth/verify-admin با نام‌کاربری/رمزِ
// یک مدیرِ واقعی موفق شد، همین نشست برای چند دقیقه اجازه‌ی تغییراتِ
// دستیِ حساسِ انبار (حذفِ کالا، ویرایشِ مشخصات/قیمتِ فروش، بازنویسیِ
// گردش) را پیدا می‌کند. این‌طوری رمزِ ادمین فقط یک پرسشِ ظاهری در
// مرورگر نیست — سرور هم همان را می‌خواهد.
const ADMIN_ELEVATION_MS = 2 * 60 * 1000;

function elevateSession(token) {

    const session = getSession(token);

    if (session) session.adminElevatedUntil = Date.now() + ADMIN_ELEVATION_MS;

}

// نشستِ منقضی‌شده فقط وقتی از Map پاک می‌شود که خودِ همان توکن دوباره
// استفاده شود (getSession) — یعنی اگر کسی فقط مرورگرش را ببندد (خیلی
// رایج‌تر از زدنِ دکمه‌ی «خروج»)، آن رکورد برای همیشه در حافظه‌ی سرور
// می‌ماند. روی یک سرور که مدت طولانی بدون ری‌استارت بالاست، این یعنی
// حافظه‌ی مصرفی متناسب با کلِ تعداد ورودهای تاریخِ عمرِ سرور رشد
// می‌کند، نه تعداد نشست‌های واقعاً فعال. هر ساعت یک‌بار، هرچه واقعاً
// منقضی شده را پاک می‌کند.
function sweepExpiredSessions() {

    const now = Date.now();

    for (const [token, session] of sessions) {
        if (session.expiresAt < now) {
            sessions.delete(token);
        }
    }

}

function startSessionSweeper() {
    setInterval(sweepExpiredSessions, 60 * 60 * 1000);
}

// کاربرِ واقعی و به‌روزِ این نشست را برمی‌گرداند — نه نسخه‌ی
// «عکسِ لحظه‌ی ورود» که توی حافظه کش شده. چرا مهم است: اگر مدیر
// دسترسی‌های یک کاربر را عوض کند یا حسابش را غیرفعال/حذف کند،
// باید همان درخواست بعدیِ آن کاربر این تغییر را ببیند — نه اینکه
// تا ۱۲ ساعت (طول عمر نشست) یا خروج/ورود دوباره، دسترسیِ قدیمی
// (و شاید دیگر مجاز نبودن) همچنان کار کند. این تابع هر بار مستقیم
// از دیتابیس (stlp_users) می‌خواند، پس همیشه آخرین وضعیت است.
function resolveUser(token) {

    const session = getSession(token);
    if (!session) return null;

    let users;

    try {
        users = JSON.parse(db.getValue("stlp_users") || "[]");
    } catch (error) {
        users = [];
    }

    const liveUser = users.find(function(u) { return u.id === session.user.id; });

    if (!liveUser || liveUser.active === false) {
        destroySession(token);
        return null;
    }

    const fresh = toSessionUser(liveUser);
    session.user = fresh;

    // فقط برای تصمیم‌گیریِ سمتِ سرور (store.js) — از کلاینت خوانده نمی‌شود
    fresh.adminElevated = !!session.adminElevatedUntil && session.adminElevatedUntil > Date.now();

    return fresh;

}

module.exports = {
    SESSION_COOKIE,
    createSession,
    getSession,
    destroySession,
    elevateSession,
    toSessionUser,
    resolveUser,
    startSessionSweeper
};

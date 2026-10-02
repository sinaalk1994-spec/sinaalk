// =====================================================
// لایه‌ی دیتابیس — جایگزین localStorage مرورگر
// از ماژول داخلی node:sqlite استفاده می‌کند (نیاز به هیچ
// پکیج کامپایل‌شده‌ای ندارد و همراه خود Node می‌آید)
// =====================================================

"use strict";

const path = require("path");
const fs = require("fs");
const { DatabaseSync, backup } = require("node:sqlite");
const { hashPassword } = require("./passwords");

const DB_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DB_DIR, "stlp.db");
const BACKUP_DIR = path.join(DB_DIR, "snapshots");

let db = null;

async function initDb() {

    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }

    db = new DatabaseSync(DB_PATH);

    // حالت WAL (Write-Ahead Logging): باعث می‌شود خواندن و نوشتن
    // همزمان روی دیتابیس، همدیگر را کمتر بلاک کنند — یعنی وقتی
    // یک کاربر دارد چیزی ذخیره می‌کند، بقیه‌ی کاربرها هنوز می‌توانند
    // بدون معطلی بخوانند. این یک تنظیمِ استاندارد و کاملاً امنِ
    // SQLite است (توصیه‌ی رسمیِ خودِ SQLite برای دقیقاً همین نوع
    // بار: چند خواننده + نویسنده‌های گاه‌به‌گاه).
    db.exec("PRAGMA journal_mode = WAL;");

    db.exec(`
        CREATE TABLE IF NOT EXISTS data_store (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            updated_by  TEXT
        );

        CREATE TABLE IF NOT EXISTS login_attempts (
            username     TEXT PRIMARY KEY,
            count        INTEGER NOT NULL DEFAULT 0,
            locked_until TEXT
        );
    `);

    await seedDefaultAdminIfEmpty();
}

async function seedDefaultAdminIfEmpty() {

    const existing = getValue("stlp_users");

    if (existing !== null) return;

    const defaultPassword = "admin123";
    const hash = await hashPassword(defaultPassword);

    const users = [
        {
            id: "u_admin",
            username: "admin",
            password: hash,
            fullName: "مدیر سیستم",
            isAdmin: true,
            permissions: {},
            active: true,
            createdAt: new Date().toISOString()
        }
    ];

    setValue("stlp_users", JSON.stringify(users), "system");

    console.log("");
    console.log("=========================================================");
    console.log(" یک کاربر مدیر پیش‌فرض ساخته شد (چون هیچ کاربری وجود نداشت):");
    console.log("   نام کاربری: admin");
    console.log("   رمز عبور:   admin123");
    console.log(" لطفاً بلافاصله بعد از اولین ورود، از صفحه‌ی «کاربران» رمز را عوض کنید.");
    console.log("=========================================================");
    console.log("");

}

function getValue(key) {

    const row = db
        .prepare("SELECT value FROM data_store WHERE key = ?")
        .get(key);

    return row ? row.value : null;

}

function setValue(key, value, updatedBy) {

    db.prepare(`
        INSERT INTO data_store (key, value, updated_at, updated_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
    `).run(key, value, new Date().toISOString(), updatedBy || null);

}

function deleteValue(key) {
    db.prepare("DELETE FROM data_store WHERE key = ?").run(key);
}

// پشتیبان خودکار از کل دیتابیس ERP — قبلاً فقط دیتابیس فروشگاه
// (website/store-data) به‌صورت خودکار پشتیبان‌گیری می‌شد؛ دیتابیس
// ERP (فاکتورها، حقوق، خزانه، رمزهای کاربران) هیچ پشتیبان خودکاری
// نداشت و فقط به دکمه‌ی دستیِ «دانلود پشتیبان» در backup.html
// متکی بود.
async function backupDb() {

    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(BACKUP_DIR, "stlp-" + stamp + ".db");

    await backup(db, target);

    return target;

}

function startBackupWorker() {

    backupDb().catch(function(error) {
        console.error("⚠️ پشتیبان‌گیری خودکار اولیه‌ی دیتابیس ERP ناموفق بود:", error);
    });

    setInterval(function() {

        backupDb().catch(function(error) {
            console.error("⚠️ پشتیبان‌گیری خودکار روزانه‌ی دیتابیس ERP ناموفق بود؛ فضای دیسک را بررسی کنید.", error);
        });

    }, 24 * 60 * 60 * 1000);

}

// افزایشِ اتمیکِ یک شمارنده (مثلاً شماره‌ی بعدیِ فاکتور). چون
// node:sqlite همزمان (sync) است و کل این تابع بدون هیچ awaitـی
// اجرا می‌شود، دو درخواست هم‌زمان نمی‌توانند وسط خواندن/نوشتنِ
// همدیگر بپرند — برخلاف مدلِ قبلی که شمارنده در مرورگرِ هر کاربر
// جداگانه محاسبه و بعداً به سرور فرستاده می‌شد (و می‌توانست باعث
// شماره‌ی تکراری شود).
function incrementCounter(key, start) {

    const row = db.prepare("SELECT value FROM data_store WHERE key = ?").get(key);
    const parsed = row ? parseInt(row.value, 10) : NaN;
    const current = Number.isFinite(parsed) ? parsed : (start || 0);
    const next = current + 1;

    setValue(key, String(next));

    return next;

}

function getAllEntries() {

    const rows = db.prepare("SELECT key, value FROM data_store").all();

    const out = {};

    for (const row of rows) {
        out[row.key] = row.value;
    }

    return out;

}

function getLoginAttempts(username) {

    return db
        .prepare("SELECT * FROM login_attempts WHERE username = ?")
        .get(username);

}

function upsertLoginAttempts(username, count, lockedUntil) {

    db.prepare(`
        INSERT INTO login_attempts (username, count, locked_until)
        VALUES (?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
            count = excluded.count,
            locked_until = excluded.locked_until
    `).run(username, count, lockedUntil);

}

function clearLoginAttempts(username) {
    db.prepare("DELETE FROM login_attempts WHERE username = ?").run(username);
}

module.exports = {
    initDb,
    getValue,
    setValue,
    deleteValue,
    getAllEntries,
    incrementCounter,
    backupDb,
    startBackupWorker,
    getLoginAttempts,
    upsertLoginAttempts,
    clearLoginAttempts
};

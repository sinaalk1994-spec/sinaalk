// =====================================================
// سرور اصلی STLP
// بدون Express و بدون هیچ پکیج بیرونی — فقط با ابزارهای
// داخلیِ خودِ Node اجرا می‌شود (node server.js) تا نصب
// آن روی هر کامپیوتری ساده و بی‌دردسر باشد.
//
// این سرور هم API بک‌اند را جواب می‌دهد و هم همان فایل‌های
// قبلیِ سایت (HTML/CSS/JS/تصاویر) را از همان پوشه‌ی اصلی
// پروژه سرو می‌کند.
// =====================================================

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const db = require("./lib/db");
const { resolveUser, startSessionSweeper } = require("./lib/auth");
const { parseCookies, serializeCookie, readJsonBody, sendJson } = require("./lib/http");
const authRoutes = require("./routes/auth");
const storeRoutes = require("./routes/store");

// شبکه‌ی محافظ نهایی: اگر با وجودِ همه‌ی چک‌ها، یک خطای پیش‌بینی‌نشده
// در پردازش یک درخواست رخ دهد، به‌جای اینکه کل سرور (و سرویس‌دهی
// به همه‌ی کاربرهای دیگر) از کار بیفتد، فقط خطا را لاگ می‌کنیم و
// سرور به کارش ادامه می‌دهد. این جایگزینِ چک‌کردنِ دقیق نیست (که
// همچنان در کد انجام می‌شود)، بلکه یک لایه‌ی آخرِ اطمینان است.
process.on("uncaughtException", function(error) {
    console.error("⚠️ خطای پیش‌بینی‌نشده (سرور همچنان روشن می‌ماند):", error);
});

process.on("unhandledRejection", function(reason) {
    console.error("⚠️ خطای Promise مدیریت‌نشده (سرور همچنان روشن می‌ماند):", reason);
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3787;

// وقتی این سرور پشت یک HTTPS واقعی (مثلاً Caddy/Nginx روی یک
// دامنه‌ی اینترنتی) قرار می‌گیرد، این را روی 1 بگذارید تا کوکیِ
// نشست با پرچم Secure ست شود (روی شبکه‌ی داخلیِ بدون HTTPS باید
// خاموش بماند، وگرنه مرورگر کوکی را قبول نمی‌کند)
const SECURE_COOKIES = process.env.SECURE_COOKIES === "1";

// روی 0.0.0.0 یعنی از هر آی‌پی‌ای قابل‌دسترسی است (حالت شبکه‌ی
// داخلی دفتر). وقتی پشت یک reverse proxy مثل Caddy روی همان
// سرور اجرا می‌شود، بهتر است این را روی 127.0.0.1 بگذارید تا
// این پورت مستقیماً از اینترنت در دسترس نباشد.
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";

// پوشه‌ی اصلی پروژه (یک پله بالاتر از پوشه‌ی server)
const FRONTEND_DIR = path.join(__dirname, "..");

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".pdf": "application/pdf"
};

db.initDb();
db.startBackupWorker();
startSessionSweeper();

function cookieOptionsBase(name, value, options) {
    return serializeCookie(name, value, Object.assign({}, options, { secure: SECURE_COOKIES }));
}

function getUserFromReq(req) {

    const cookies = parseCookies(req.headers.cookie);

    // همیشه کاربر را زنده از دیتابیس می‌خوانیم (نه از کشِ نشست)
    // تا تغییر دسترسی یا غیرفعال‌شدنِ حساب، همان لحظه اعمال شود.
    return resolveUser(cookies[require("./lib/auth").SESSION_COOKIE]);

}

async function handleApi(req, res, pathname) {

    const cookies = parseCookies(req.headers.cookie);
    const method = req.method;

    // ---- مسیرهای عمومی (بدون نیاز به ورود) ----

    if (pathname === "/api/auth/login" && method === "POST") {

        let body;

        try {
            body = await readJsonBody(req);
        } catch (error) {
            return sendJson(res, 400, { error: "درخواست نامعتبر است." });
        }

        return authRoutes.handleLogin(req, res, body, cookieOptionsBase);

    }

    if (pathname === "/api/auth/logout" && method === "POST") {
        return authRoutes.handleLogout(req, res, cookies, cookieOptionsBase);
    }

    if (pathname === "/api/auth/me" && method === "GET") {
        return authRoutes.handleMe(req, res, cookies);
    }

    // ---- از این‌جا به بعد، ورود لازم است ----

    const user = getUserFromReq(req);

    if (!user) {
        return sendJson(res, 401, { error: "وارد نشده‌اید یا نشست شما منقضی شده است." });
    }

    if (pathname === "/api/auth/verify-admin" && method === "POST") {

        let verifyBody;

        try {
            verifyBody = await readJsonBody(req);
        } catch (error) {
            return sendJson(res, 400, { error: "درخواست نامعتبر است." });
        }

        return authRoutes.handleVerifyAdmin(req, res, verifyBody, cookies);

    }

    if (pathname === "/api/bootstrap" && method === "GET") {
        return storeRoutes.handleBootstrap(req, res, user);
    }

    if (pathname === "/api/counter/next-invoice-number" && method === "POST") {
        return storeRoutes.handleNextInvoiceNumber(req, res, user);
    }

    if (pathname === "/api/counter/next-quote-number" && method === "POST") {
        return storeRoutes.handleNextQuoteNumber(req, res, user);
    }

    if (pathname === "/api/counter/next-journal-number" && method === "POST") {
        return storeRoutes.handleNextJournalNumber(req, res, user);
    }

    if (pathname === "/api/counter/next-delivery-number" && method === "POST") {
        return storeRoutes.handleNextDeliveryNumber(req, res, user);
    }

    if (pathname === "/api/counter/next-letter-number" && method === "POST") {
        return storeRoutes.handleNextLetterNumber(req, res, user);
    }

    if (pathname === "/api/counter/next-official-letter-number" && method === "POST") {
        return storeRoutes.handleNextOfficialLetterNumber(req, res, user);
    }

    if (pathname === "/api/employees/apply-leave-effect" && method === "POST") {

        let body;

        try {
            body = await readJsonBody(req);
        } catch (error) {
            return sendJson(res, 400, { error: "درخواست نامعتبر است." });
        }

        return storeRoutes.handleApplyEmployeeLeaveEffect(req, res, user, body);

    }

    if (pathname === "/api/letters/decide" && method === "POST") {

        let body;

        try {
            body = await readJsonBody(req);
        } catch (error) {
            return sendJson(res, 400, { error: "درخواست نامعتبر است." });
        }

        return storeRoutes.handleLettersDecide(req, res, user, body);

    }

    if (pathname === "/api/crm/reset" && method === "POST") {
        return storeRoutes.handleCrmReset(req, res, user);
    }

    if (pathname === "/api/activity-log/append" && method === "POST") {

        let body;

        try {
            body = await readJsonBody(req);
        } catch (error) {
            return sendJson(res, 400, { error: "درخواست نامعتبر است." });
        }

        return storeRoutes.handleAppendActivityLog(req, res, user, body);

    }

    if (pathname === "/api/admin/import-backup" && method === "POST") {

        let body;

        try {
            body = await readJsonBody(req);
        } catch (error) {
            return sendJson(res, 400, { error: "درخواست نامعتبر است." });
        }

        return storeRoutes.handleImportBackup(req, res, user, body);

    }

    const storeMatch = pathname.match(/^\/api\/store\/(.+)$/);

    if (storeMatch) {

        const key = decodeURIComponent(storeMatch[1]);

        if (method === "GET") {
            return storeRoutes.handleGetKey(req, res, user, key);
        }

        if (method === "PUT") {

            let body;

            try {
                body = await readJsonBody(req);
            } catch (error) {
                return sendJson(res, 400, { error: "درخواست نامعتبر است." });
            }

            return storeRoutes.handlePutKey(req, res, user, key, body);

        }

        if (method === "DELETE") {
            return storeRoutes.handleDeleteKey(req, res, user, key);
        }

        if (method === "POST") {

            let body;

            try {
                body = await readJsonBody(req);
            } catch (error) {
                return sendJson(res, 400, { error: "درخواست نامعتبر است." });
            }

            return storeRoutes.handleAppendKey(req, res, user, key, body);

        }

    }

    sendJson(res, 404, { error: "مسیر پیدا نشد." });

}

function safeStaticPath(pathname) {

    // جلوگیری از دسترسی به بیرون از پوشه‌ی پروژه (../..) و
    // مخفی‌کردن کامل پوشه‌ی server از دسترسی وب

    let decoded;

    try {
        // یک آدرسِ درصدی‌ناقص/نامعتبر (مثلاً "/%zz") باعث می‌شود
        // decodeURIComponent خطا پرتاب کند. قبلاً این خطا گرفته
        // نمی‌شد و کل پردازه‌ی Node (یعنی کل سرور، برای همه‌ی
        // کاربران) با یک درخواست ساده و بدون نیاز به ورود کرش
        // می‌کرد — یک آسیب‌پذیریِ از‌کار‌انداختنِ سرویس (DoS) با
        // کمترین تلاش. الان به‌جای کرش، فقط همان یک درخواست ۴۰۴
        // می‌خورد.
        decoded = decodeURIComponent(pathname);
    } catch (error) {
        return null;
    }

    const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");

    let relative = normalized === "/" ? "/home.html" : normalized;

    // مقایسه بدون‌حساسیت به بزرگ/کوچک حروف، چون روی ویندوز
    // (هم کامپیوتر دفتر و هم سرور آنلاین) سیستم فایل به بزرگی/
    // کوچکی حروف حساس نیست — یعنی "/Server/..." یا "/SERVER/..."
    // هم دقیقاً همان پوشه‌ی server را باز می‌کند و باید مسدود شود.
    // نسخه‌ی قبلی این کد فقط دقیقاً "server" کوچک را چک می‌کرد و
    // با تغییر بزرگی حروف در آدرس، کل پوشه‌ی server (شامل
    // stlp.db که هش رمز عبور همه‌ی کاربران و کل اطلاعات تجاری
    // داخلش است) بدون نیاز به ورود، از طریق وب قابل دانلود بود.
    const segmentsLower = relative.split(/[\\/]/).map(function(s) { return s.toLowerCase(); });

    if (segmentsLower.indexOf("server") !== -1) {
        return null;
    }

    const fullPath = path.join(FRONTEND_DIR, relative);

    if (!fullPath.startsWith(FRONTEND_DIR)) return null;

    return fullPath;

}

function serveStatic(req, res, pathname) {

    let fullPath = safeStaticPath(pathname);

    if (!fullPath) {
        res.writeHead(404);
        return res.end("Not found");
    }

    fs.stat(fullPath, function(err, stat) {

        if (err || !stat) {

            // اگر پسوند نداشت، امتحان با html+
            if (!path.extname(fullPath)) {

                const withHtml = fullPath + ".html";

                return fs.stat(withHtml, function(err2, stat2) {

                    if (err2 || !stat2 || !stat2.isFile()) {
                        res.writeHead(404);
                        return res.end("Not found");
                    }

                    streamFile(res, withHtml);

                });

            }

            res.writeHead(404);
            return res.end("Not found");

        }

        if (stat.isDirectory()) {

            const indexPath = path.join(fullPath, "index.html");

            return fs.stat(indexPath, function(err2, stat2) {

                if (err2 || !stat2) {
                    res.writeHead(404);
                    return res.end("Not found");
                }

                streamFile(res, indexPath);

            });

        }

        streamFile(res, fullPath);

    });

}

function streamFile(res, fullPath) {

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });

    const stream = fs.createReadStream(fullPath);

    stream.pipe(res);

    stream.on("error", function() {
        res.end();
    });

}

// چند هدر امنیتیِ پایه — دفاع در عمق (defense in depth). این‌ها
// یک حفره‌ی خاص را نمی‌بندند، اما اگر یک حفره‌ی دیگر (مثلاً در
// خودِ کد قدیمیِ صفحات) روزی پیدا شود، اثرش را محدودتر می‌کنند.
function setSecurityHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
}

const server = http.createServer(function(req, res) {

    setSecurityHeaders(res);

    const parsed = url.parse(req.url);
    const pathname = parsed.pathname;

    if (pathname.indexOf("/api/") === 0) {

        handleApi(req, res, pathname).catch(function(error) {
            console.error("خطای غیرمنتظره:", error);
            sendJson(res, 500, { error: "خطای داخلی سرور." });
        });

        return;

    }

    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        return res.end("Method not allowed");
    }

    serveStatic(req, res, pathname);

});

server.listen(PORT, BIND_HOST, function() {

    console.log("");
    console.log("=========================================================");
    console.log(" سرور STLP روشن شد ✅");
    console.log(" آدرس داخلی:  http://localhost:" + PORT + "/login.html");
    console.log(" حالت کوکی امن (Secure):  " + (SECURE_COOKIES ? "روشن (برای HTTPS)" : "خاموش (برای شبکه‌ی داخلی بدون HTTPS)"));
    console.log(" آدرس شبکه:  " + BIND_HOST);
    console.log("=========================================================");
    console.log("");

});

/* =====================================================
 * پل اتصال به سرور — جایگزین localStorage مرورگر
 * =====================================================
 * این فایل باید همیشه اولین اسکریپت هر صفحه باشد (قبل از
 * app.js و قبل از هر اسکریپت دیگری). کارش این است که قبل از
 * اجرای بقیه‌ی برنامه، اطلاعات را یک‌بار از سرور می‌گیرد و
 * localStorage مرورگر را با یک نسخه‌ی متصل به سرور جایگزین
 * می‌کند — بدون این‌که حتی یک خط از بقیه‌ی کدهای برنامه
 * (app.js، crm_engine.js، treasury.js و...) نیاز به تغییر
 * داشته باشند، چون همان localStorage.getItem/setItem قبلی
 * را صدا می‌زنند، فقط این‌بار واقعاً روی سرور ذخیره می‌شود.
 *
 * توجه امنیتی: هویت واقعی کاربر از روی کوکی نشستِ سرور
 * (httpOnly) تعیین می‌شود، نه از روی این کش سمت مرورگر.
 * یعنی حتی اگر کسی از کنسول مرورگر این کش را دستکاری کند،
 * فقط ظاهر همان صفحه در همان مرورگر عوض می‌شود؛ سرور برای هر
 * ذخیره/تغییری دوباره و مستقل بررسی می‌کند که واقعاً اجازه‌ی
 * آن کار را دارد یا نه.
 * ===================================================== */

(function() {

    "use strict";

    var cache = Object.create(null);
    var sessionUser = null;

    // ---------------------------------------------------
    // مرحله‌ی ۱: گرفتن همه‌ی داده‌های مجاز از سرور —
    // با XHR همزمان (sync) تا تضمین شود قبل از اجرای
    // app.js و بقیه‌ی اسکریپت‌ها، داده آماده است.
    // (این صفحات فقط داخل شبکه‌ی داخلی شرکت باز می‌شوند،
    // پس چند میلی‌ثانیه تأخیر مشکلی ایجاد نمی‌کند.)
    // ---------------------------------------------------

    function fetchBootstrapSync() {

        try {

            var xhr = new XMLHttpRequest();

            xhr.open("GET", "/api/bootstrap", false); // false = همزمان
            xhr.setRequestHeader("Accept", "application/json");
            xhr.send(null);

            if (xhr.status >= 200 && xhr.status < 300) {

                var payload = JSON.parse(xhr.responseText);

                cache = Object.create(null);

                for (var key in payload.data) {
                    if (Object.prototype.hasOwnProperty.call(payload.data, key)) {
                        cache[key] = payload.data[key];
                    }
                }

                sessionUser = payload.user || null;

            } else {

                // ۴۰۱ یعنی وارد نشده — طبیعی است، مثلاً در login.html
                sessionUser = null;

            }

        } catch (error) {

            console.error("⚠️ ارتباط با سرور برقرار نشد. آیا سرور STLP روشن است؟", error);
            sessionUser = null;
            serverUnreachable = true;

        }

    }

    var serverUnreachable = false;

    fetchBootstrapSync();

    function showOfflineBanner() {

        if (document.getElementById("stlpOfflineBanner")) return;

        var showIt = function() {

            var banner = document.createElement("div");
            banner.id = "stlpOfflineBanner";
            banner.className = "stlp-offline-banner";
            banner.textContent = "⚠️ ارتباط با سرور STLP برقرار نیست — اطلاعات ذخیره نمی‌شود. مطمئن شوید سرور روشن است.";
            document.body.appendChild(banner);

        };

        if (document.body) showIt();
        else document.addEventListener("DOMContentLoaded", showIt);

    }

    if (serverUnreachable) showOfflineBanner();

    // برخلاف قطعیِ اتصال (که نوار همیشگی بالای صفحه دارد)، رد شدنِ
    // یک ذخیره‌ی خاص توسط سرور (مثلاً به‌خاطر نداشتن دسترسی) قبلاً
    // فقط در کنسول مرورگر لاگ می‌شد و کاربر هیچ چیزی نمی‌دید — یعنی
    // مثلاً روی صفحه «✅ ذخیره شد» می‌دید در حالی که اصلاً ذخیره
    // نشده بود. این یک نوار موقت (چند ثانیه‌ای) برای همین حالت است.
    function showSaveErrorBanner(message) {

        var existing = document.getElementById("stlpSaveErrorBanner");
        if (existing) existing.remove();

        var showIt = function() {

            var banner = document.createElement("div");
            banner.id = "stlpSaveErrorBanner";
            banner.className = "stlp-offline-banner";
            banner.textContent = "⚠️ " + message;
            document.body.appendChild(banner);

            setTimeout(function() {
                if (banner.parentNode) banner.parentNode.removeChild(banner);
            }, 8000);

        };

        if (document.body) showIt();
        else document.addEventListener("DOMContentLoaded", showIt);

    }

    function applySessionToCache() {

        if (sessionUser) {

            cache["stlp_current_user"] = JSON.stringify(sessionUser);
            cache["role"] = sessionUser.isAdmin ? "admin" : "user";

        } else {

            delete cache["stlp_current_user"];
            delete cache["role"];

        }

    }

    applySessionToCache();

    // ---------------------------------------------------
    // مرحله‌ی ۱.۵: اگر وارد نشده‌ایم، همین الان (قبل از اینکه
    // مرورگر فرصت کند محتوای بدنه‌ی صفحه را رسم/رندر کند) به
    // صفحه‌ی ورود می‌رویم. این اسکریپت همیشه اولین چیزِ داخل
    // <head> هر صفحه است، پس این چک از هر چک دیگری (که قبلاً
    // ته صفحه، بعد از رندر کامل بدنه انجام می‌شد) زودتر اجرا
    // می‌شود — یعنی دیگر یک لحظه‌ی کوتاه محتوای محافظت‌شده دیده
    // نمی‌شود و بعد به صفحه‌ی ورود پرتاب شویم.
    // ---------------------------------------------------

    if (!sessionUser) {

        var currentFile = location.pathname.split("/").pop();

        if (currentFile !== "login.html") {
            location.replace("login.html");
        }

    }

    // ---------------------------------------------------
    // مرحله‌ی ۲: ارسال تغییرات به سرور در پس‌زمینه
    // ---------------------------------------------------

    var SESSION_ONLY_KEYS = { "stlp_current_user": true, "role": true };

    function persistToServer(key, value) {

        fetch("/api/store/" + encodeURIComponent(key), {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: value })
        }).then(function(res) {

            if (!res.ok) {

                res.json().catch(function() { return {}; }).then(function(body) {
                    console.error("❌ ذخیره روی سرور ناموفق بود (" + key + "):", body.error || res.status);
                    showSaveErrorBanner(body.error || "ذخیره‌سازی روی سرور رد شد؛ تغییرات اخیر ذخیره نشد.");
                });

            }

        }).catch(function(error) {
            console.error("❌ ارتباط با سرور برای ذخیره‌سازی برقرار نشد:", error);
            showOfflineBanner();
        });

    }

    function persistDelete(key) {

        fetch("/api/store/" + encodeURIComponent(key), {
            method: "DELETE",
            credentials: "same-origin"
        }).then(function(res) {

            if (!res.ok) {

                res.json().catch(function() { return {}; }).then(function(body) {
                    console.error("❌ حذف روی سرور ناموفق بود (" + key + "):", body.error || res.status);
                    showSaveErrorBanner(body.error || "حذف روی سرور رد شد؛ تغییرات اخیر ذخیره نشد.");
                });

            }

        }).catch(function(error) {
            console.error("❌ حذف روی سرور ناموفق بود:", error);
            showOfflineBanner();
        });

    }

    // ---------------------------------------------------
    // مرحله‌ی ۳: جایگزینیِ خودِ آبجکت localStorage
    // ---------------------------------------------------

    var serverBackedStorage = {

        getItem: function(key) {
            return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
        },

        setItem: function(key, value) {

            var strValue = String(value);
            cache[key] = strValue;

            if (SESSION_ONLY_KEYS[key]) {
                // این دو کلید فقط از طریق ورود/خروج واقعی از سرور
                // تعیین می‌شوند، نه با نوشتن مستقیم — پس چیزی به
                // سرور فرستاده نمی‌شود (فقط کش همین تب عوض می‌شود)
                return;
            }

            persistToServer(key, strValue);

        },

        removeItem: function(key) {

            delete cache[key];

            if (key === "stlp_current_user") {

                sessionUser = null;
                delete cache["role"];

                fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "same-origin"
                }).catch(function() {});

                return;

            }

            if (SESSION_ONLY_KEYS[key]) return;

            persistDelete(key);

        },

        clear: function() {
            cache = Object.create(null);
        },

        key: function(index) {
            var keys = Object.keys(cache);
            return keys[index] || null;
        },

        get length() {
            return Object.keys(cache).length;
        }

    };

    try {

        Object.defineProperty(window, "localStorage", {
            configurable: true,
            enumerable: true,
            value: serverBackedStorage
        });

    } catch (error) {

        console.error(
            "⚠️ مرورگر شما اجازه‌ی جایگزینی localStorage را نداد. " +
            "برنامه ممکن است داده‌ها را روی سرور ذخیره نکند.",
            error
        );

    }

    // در دسترس گذاشتن برای عیب‌یابی دستی در صورت نیاز، و برای
    // به‌روزرسانیِ کشِ محلی بعد از فراخوانی‌های اتمیکِ سمت سرور که از
    // مسیر معمولیِ setItem رد نمی‌شوند (مثلاً POST /api/store/:key —
    // rk افزودنِ اتمیک، یا endpoint های اختصاصیِ دیگر). بدونِ این،
    // بعد از یک افزودنِ موفقِ اتمیک، localStorage.getItem همین تب تا
    // بارگذاریِ بعدیِ صفحه هنوز نسخه‌ی قدیمی (بدون آیتمِ تازه) را
    // برمی‌گرداند — چون cache فقط یک‌بار در بارگذاریِ صفحه پر می‌شود.
    // refreshKey فقط کشِ همین تب را عوض می‌کند و هیچ درخواستی به
    // سرور نمی‌فرستد (خودِ نوشتن قبلاً روی سرور انجام شده است).
    window.__stlpServerStorage = {
        isLoggedIn: function() { return !!sessionUser; },
        currentSessionUser: function() { return sessionUser; },
        refreshKey: function(key, value) { cache[key] = value; }
    };

})();

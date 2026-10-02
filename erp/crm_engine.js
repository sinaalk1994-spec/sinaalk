// =====================================================
// موتور صفحه‌ی CRM (پیگیری مشتریان بالقوه / آزمایشگاه‌ها)
// این فایل به app.js وابسته است (باید قبل از این فایل لود شود)
// چون از customers, saveCustomers, escapeHtml, stlpRequirePermission
// و stlpCurrentUser استفاده می‌کند تا با بقیه‌ی سیستم یکپارچه بماند.
// =====================================================

stlpRequirePermission("crm");


// =====================================================
// وضعیت و ذخیره‌سازی
// =====================================================

let crmRecords = [];

try {
    crmRecords = JSON.parse(
        localStorage.getItem("stlp_crm_records") || "[]"
    );
} catch (error) {
    crmRecords = [];
}


let crmSettings = null;

try {
    crmSettings = JSON.parse(
        localStorage.getItem("stlp_crm_settings") || "null"
    );
} catch (error) {
    crmSettings = null;
}

if (!crmSettings || !Array.isArray(crmSettings.teams) || crmSettings.teams.length === 0) {

    crmSettings = {
        teams: ["Team A", "Team B", "Team C", "Team D", "Team Alfa", "Team Bravo"]
    };

}


let crmEditingId = null;
let crmSelected = new Set();


// =====================================================
// لاگ فعالیت — از این به بعد به لاگ سراسری سیستم (app.js)
// نوشته می‌شود، نه فقط لاگ مخصوص CRM؛ یعنی از هر صفحه‌ی دیگر
// هم قابل دیدن است (صفحه‌ی activity-log.html)
// =====================================================

function crmLog(action, details) {

    if (typeof stlpLogActivity === "function") {
        stlpLogActivity("CRM", action, details);
    }

}


function crmSave() {

    localStorage.setItem(
        "stlp_crm_records",
        JSON.stringify(crmRecords)
    );

}


function crmSaveSettings() {

    localStorage.setItem(
        "stlp_crm_settings",
        JSON.stringify(crmSettings)
    );

}


function crmGenId() {

    return (
        "crm_" +
        Date.now().toString(36) +
        Math.random().toString(36).substring(2, 8)
    );

}


// =====================================================
// پر کردن select های تیم (فیلتر، فرم افزودن دستی، دیالوگ جزئیات)
// =====================================================

function crmPopulateTeamSelects() {

    const teamOptionsHtml = crmSettings.teams
        .map(function(t) {
            return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + "</option>";
        })
        .join("");

    const mTeam = document.getElementById("mTeam");
    if (mTeam) {
        mTeam.innerHTML = '<option value="">— بدون تیم —</option>' + teamOptionsHtml;
    }

    const eTeam = document.getElementById("eTeam");
    if (eTeam) {
        eTeam.innerHTML = '<option value="">— بدون تیم —</option>' + teamOptionsHtml;
    }

    const filterTeam = document.getElementById("filterTeam");
    if (filterTeam) {
        const current = filterTeam.value;
        filterTeam.innerHTML = '<option value="">همه تیم‌ها</option>' + teamOptionsHtml;
        filterTeam.value = current;
    }

}


// =====================================================
// پر کردن select های منطقه/محله بر اساس داده‌ی موجود
// =====================================================

function crmPopulateRegionNeighFilters() {

    const regionSel = document.getElementById("filterRegion");
    const neighSel = document.getElementById("filterNeigh");

    if (regionSel) {

        const current = regionSel.value;

        const regions = Array.from(
            new Set(
                crmRecords
                    .map(function(r) { return (r.region || "").trim(); })
                    .filter(Boolean)
            )
        ).sort();

        regionSel.innerHTML =
            '<option value="">همه مناطق</option>' +
            regions.map(function(r) {
                return '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + "</option>";
            }).join("");

        regionSel.value = current;

    }

    if (neighSel) {

        const current = neighSel.value;

        const neighs = Array.from(
            new Set(
                crmRecords
                    .map(function(r) { return (r.neighborhood || "").trim(); })
                    .filter(Boolean)
            )
        ).sort();

        neighSel.innerHTML =
            '<option value="">همه محله‌ها</option>' +
            neighs.map(function(n) {
                return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + "</option>";
            }).join("");

        neighSel.value = current;

    }

}


// =====================================================
// رندر لیست با اعمال فیلترها
// =====================================================

function crmGetFilteredRecords() {

    const q = (document.getElementById("q")?.value || "").trim().toLowerCase();
    const region = document.getElementById("filterRegion")?.value || "";
    const neigh = document.getElementById("filterNeigh")?.value || "";
    const team = document.getElementById("filterTeam")?.value || "";
    const visitStatus = document.getElementById("filterStatus")?.value || "";
    const orderStatus = document.getElementById("filterOrderStatus")?.value || "";

    return crmRecords.filter(function(r) {

        if (region && r.region !== region) return false;
        if (neigh && r.neighborhood !== neigh) return false;
        if (team && r.team !== team) return false;
        if (visitStatus && r.visitStatus !== visitStatus) return false;
        if (orderStatus && r.orderStatus !== orderStatus) return false;

        if (q) {

            const text = [
                r.region, r.neighborhood, r.name, r.type, r.address,
                r.phone, r.team, r.visitStatus, r.orderStatus, r.notes
            ]
                .join(" ")
                .toLowerCase();

            if (!text.includes(q)) return false;

        }

        return true;

    });

}


function crmVisitBadgeClass(status) {

    if (status === "Visited") return "crm-badge crm-badge-good";
    if (status === "Follow-up needed") return "crm-badge crm-badge-warn";
    if (status === "Not reachable") return "crm-badge crm-badge-bad";
    return "crm-badge crm-badge-neutral";

}


function crmOrderBadgeClass(status) {

    if (status === "Ordered" || status === "Delivered") return "crm-badge crm-badge-good";
    if (status === "Interested" || status === "Quoted") return "crm-badge crm-badge-warn";
    if (status === "Cancelled") return "crm-badge crm-badge-bad";
    return "crm-badge crm-badge-neutral";

}


function crmIsOverdue(record) {

    if (!record.nextFollow) return false;
    if (record.convertedCustomer) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const next = new Date(record.nextFollow);

    return next < today;

}


// =====================================================
// داشبورد — کارت‌های آماری حرفه‌ای پایپ‌لاین
// =====================================================

function crmRenderDashboard() {

    const box = document.getElementById("crmStatsCards");
    if (!box) return;

    const total = crmRecords.length;
    const followUpNeeded = crmRecords.filter(function(r) { return r.visitStatus === "Follow-up needed"; }).length;
    const visited = crmRecords.filter(function(r) { return r.visitStatus === "Visited"; }).length;
    const inPipeline = crmRecords.filter(function(r) {
        return r.orderStatus === "Interested" || r.orderStatus === "Quoted";
    }).length;
    const won = crmRecords.filter(function(r) {
        return r.orderStatus === "Ordered" || r.orderStatus === "Delivered";
    }).length;
    const converted = crmRecords.filter(function(r) { return r.convertedCustomer; }).length;
    const overdue = crmRecords.filter(crmIsOverdue).length;

    box.innerHTML = `

        <div class="treasury-stat">
            <div class="treasury-stat-title">تعداد کل لیدها</div>
            <div class="treasury-stat-value">${total.toLocaleString("fa-IR")}</div>
        </div>

        <div class="treasury-stat">
            <div class="treasury-stat-title">نیازمند پیگیری</div>
            <div class="treasury-stat-value money-out">${followUpNeeded.toLocaleString("fa-IR")}</div>
        </div>

        <div class="treasury-stat">
            <div class="treasury-stat-title">ویزیت‌شده</div>
            <div class="treasury-stat-value">${visited.toLocaleString("fa-IR")}</div>
        </div>

        <div class="treasury-stat">
            <div class="treasury-stat-title">در حال مذاکره</div>
            <div class="treasury-stat-value">${inPipeline.toLocaleString("fa-IR")}</div>
        </div>

        <div class="treasury-stat">
            <div class="treasury-stat-title">سفارش گرفته‌شده</div>
            <div class="treasury-stat-value money-in">${won.toLocaleString("fa-IR")}</div>
        </div>

        <div class="treasury-stat">
            <div class="treasury-stat-title">تبدیل به مشتری</div>
            <div class="treasury-stat-value money-balance">${converted.toLocaleString("fa-IR")}</div>
        </div>

        <div class="treasury-stat">
            <div class="treasury-stat-title">⚠️ پیگیری‌های عقب‌افتاده</div>
            <div class="treasury-stat-value money-out">${overdue.toLocaleString("fa-IR")}</div>
        </div>

    `;

}


function crmRenderList() {

    const filtered = crmGetFilteredRecords();

    const tbody = document.getElementById("list");

    if (tbody) {

        tbody.innerHTML = filtered.map(function(r) {

            return `
                <tr>
                    <td>
                        <input type="checkbox" ${crmSelected.has(r.id) ? "checked" : ""}
                            onchange="crmToggleSelect('${r.id}', this.checked)">
                    </td>
                    <td>${escapeHtml(r.region || "")}</td>
                    <td>${escapeHtml(r.neighborhood || "")}</td>
                    <td>${escapeHtml(r.name || "")}</td>
                    <td>${escapeHtml(r.type || "")}</td>
                    <td>${escapeHtml(r.address || "")}</td>
                    <td>${escapeHtml(r.phone || "")}</td>
                    <td>${escapeHtml(r.team || "—")}</td>
                    <td><span class="${crmVisitBadgeClass(r.visitStatus)}">${escapeHtml(r.visitStatus || "Not visited")}</span></td>
                    <td><span class="${crmOrderBadgeClass(r.orderStatus)}">${escapeHtml(r.orderStatus || "No order")}</span></td>
                    <td>${crmIsOverdue(r) ? '<span class="crm-badge crm-badge-bad">⚠️ ' + escapeHtml(r.nextFollow) + '</span>' : escapeHtml(r.nextFollow || "")}</td>
                    <td>
                        <button type="button" onclick="crmOpenDetail('${r.id}')">📄 جزئیات</button>
                        ${
                            r.convertedCustomer
                                ? '<span class="crm-badge crm-badge-good">✅ مشتری شد</span>'
                                : '<button type="button" onclick="crmConvertToCustomer(\'' + r.id + '\')">🤝 مشتری</button>'
                        }
                        <button type="button" onclick="crmDeleteRecord('${r.id}')">🗑</button>
                    </td>
                </tr>
            `;

        }).join("");

    }

    const statsBox = document.getElementById("stats");

    if (statsBox) {

        const convertedCount = crmRecords.filter(function(r) { return r.convertedCustomer; }).length;

        statsBox.textContent =
            "نمایش " + filtered.length + " از " + crmRecords.length + " رکورد — " +
            convertedCount + " مورد تبدیل به مشتری شده";

    }

    const selectAll = document.getElementById("selectAllRows");
    if (selectAll) {
        selectAll.checked =
            filtered.length > 0 &&
            filtered.every(function(r) { return crmSelected.has(r.id); });
    }

    crmRenderDashboard();

}


// =====================================================
// انتخاب ردیف‌ها (برای خروجی اکسل انتخاب‌شده‌ها)
// =====================================================

function crmToggleSelect(id, checked) {

    if (checked) crmSelected.add(id);
    else crmSelected.delete(id);

}


function crmToggleSelectAll(checkbox) {

    const filtered = crmGetFilteredRecords();

    filtered.forEach(function(r) {

        if (checkbox.checked) crmSelected.add(r.id);
        else crmSelected.delete(r.id);

    });

    crmRenderList();

}


// =====================================================
// افزودن دستی (تب دیتاست)
// =====================================================

function crmAddManual() {

    const name = (document.getElementById("mName")?.value || "").trim();

    if (!name) {
        alert("لطفاً نام مرکز/آزمایشگاه را وارد کنید.");
        document.getElementById("mName")?.focus();
        return;
    }

    const record = {

        id: crmGenId(),
        region: (document.getElementById("mRegion")?.value || "").trim(),
        neighborhood: (document.getElementById("mNeigh")?.value || "").trim(),
        name: name,
        phone: (document.getElementById("mPhone")?.value || "").trim(),
        address: (document.getElementById("mAddr")?.value || "").trim(),
        type: (document.getElementById("mType")?.value || "").trim(),
        team: document.getElementById("mTeam")?.value || "",
        visitStatus: "Not visited",
        orderStatus: "No order",
        lastVisit: "",
        nextFollow: "",
        notes: "",
        convertedCustomer: false,
        createdAt: new Date().toISOString(),
        createdBy: (stlpCurrentUser() && stlpCurrentUser().name) || ""

    };

    crmRecords.push(record);
    crmSave();
    crmLog("افزودن لید", "«" + name + "» به‌صورت دستی ثبت شد.");

    crmPopulateRegionNeighFilters();
    crmRenderList();

    ["mRegion", "mNeigh", "mName", "mPhone", "mAddr", "mType"].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });

    const mTeamEl = document.getElementById("mTeam");
    if (mTeamEl) mTeamEl.value = "";

    const msg = document.getElementById("manualMsg");
    if (msg) {
        msg.textContent = "✅ با موفقیت ثبت شد.";
        setTimeout(function() { msg.textContent = ""; }, 3000);
    }

}


// =====================================================
// دیالوگ جزئیات — باز کردن
// =====================================================

function crmOpenDetail(id) {

    const record = crmRecords.find(function(r) { return r.id === id; });
    if (!record) return;

    crmEditingId = id;

    document.getElementById("dlgTitle").textContent =
        (record.name || "جزئیات") + (record.convertedCustomer ? " — ✅ مشتری شده" : "");

    document.getElementById("eRegion").value = record.region || "";
    document.getElementById("eNeigh").value = record.neighborhood || "";
    document.getElementById("eName").value = record.name || "";
    document.getElementById("eType").value = record.type || "";
    document.getElementById("eAddr").value = record.address || "";
    document.getElementById("ePhone").value = record.phone || "";
    document.getElementById("eTeam").value = record.team || "";
    document.getElementById("eVisit").value = record.visitStatus || "Not visited";
    document.getElementById("eOrder").value = record.orderStatus || "No order";
    document.getElementById("eLastVisit").value = record.lastVisit || "";
    document.getElementById("eNext").value = record.nextFollow || "";
    document.getElementById("eNotes").value = record.notes || "";

    const callLink = document.getElementById("callLink");
    if (callLink) callLink.href = record.phone ? ("tel:" + record.phone) : "#";

    const dlgMsg = document.getElementById("dlgMsg");
    if (dlgMsg) dlgMsg.textContent = "";

    document.getElementById("dlg").showModal();

}


// =====================================================
// دیالوگ جزئیات — اعتبارسنجی قبل از بسته‌شدن
// (روی submit فرم؛ چون فرم method="dialog" است، هر دکمه‌ی
//  submit بلافاصله دیالوگ را می‌بندد مگر اینکه preventDefault شود)
// =====================================================

document.addEventListener("DOMContentLoaded", function() {

    const dlgForm = document.querySelector("#dlg form");

    if (dlgForm) {

        dlgForm.addEventListener("submit", function(e) {

            const action = e.submitter ? e.submitter.value : "";

            if (action === "save" || action === "convert") {

                const name = (document.getElementById("eName")?.value || "").trim();

                if (!name) {
                    e.preventDefault();
                    alert("لطفاً نام را وارد کنید.");
                    return;
                }

            }

            if (action === "delete") {

                if (!confirm("آیا از حذف این رکورد مطمئن هستید؟")) {
                    e.preventDefault();
                    return;
                }

            }

            if (action === "convert") {

                const record = crmRecords.find(function(r) { return r.id === crmEditingId; });

                if (record && record.convertedCustomer) {

                    if (!confirm("این رکورد قبلاً به مشتری تبدیل شده. دوباره یک مشتری جدید ساخته شود؟")) {
                        e.preventDefault();
                        return;
                    }

                }

            }

        });

    }


    // بعد از بسته‌شدن دیالوگ، بر اساس دکمه‌ای که زده شده عمل کن
    const dlg = document.getElementById("dlg");

    if (dlg) {

        dlg.addEventListener("close", function() {

            const action = dlg.returnValue;

            if (!crmEditingId || action === "cancel" || !action) {
                crmEditingId = null;
                return;
            }

            if (action === "save") {
                crmSaveDetail();
            } else if (action === "delete") {
                crmDeleteRecord(crmEditingId);
            } else if (action === "convert") {
                crmSaveDetail();
                crmConvertToCustomer(crmEditingId);
            }

            crmEditingId = null;

        });

    }


    crmInit();

});


// =====================================================
// دیالوگ جزئیات — ذخیره
// =====================================================

function crmSaveDetail() {

    const record = crmRecords.find(function(r) { return r.id === crmEditingId; });
    if (!record) return;

    record.region = document.getElementById("eRegion").value.trim();
    record.neighborhood = document.getElementById("eNeigh").value.trim();
    record.name = document.getElementById("eName").value.trim();
    record.type = document.getElementById("eType").value.trim();
    record.address = document.getElementById("eAddr").value.trim();
    record.phone = document.getElementById("ePhone").value.trim();
    record.team = document.getElementById("eTeam").value;
    record.visitStatus = document.getElementById("eVisit").value;
    record.orderStatus = document.getElementById("eOrder").value;
    record.lastVisit = document.getElementById("eLastVisit").value;
    record.nextFollow = document.getElementById("eNext").value;
    record.notes = document.getElementById("eNotes").value.trim();
    record.updatedAt = new Date().toISOString();
    record.updatedBy = (stlpCurrentUser() && stlpCurrentUser().name) || "";

    crmSave();
    crmLog("ویرایش لید", "«" + record.name + "» ویرایش شد (وضعیت ویزیت: " + record.visitStatus + ").");
    crmPopulateRegionNeighFilters();
    crmRenderList();

}


// =====================================================
// حذف رکورد
// =====================================================

function crmDeleteRecord(id) {

    const record = crmRecords.find(function(r) { return r.id === id; });

    // اگر از داخل جدول صدا زده شده (نه از دیالوگ)، خودش تایید بگیرد
    if (id !== crmEditingId) {
        if (!confirm("آیا از حذف این رکورد مطمئن هستید؟")) return;
    }

    crmRecords = crmRecords.filter(function(r) { return r.id !== id; });
    crmSelected.delete(id);

    crmSave();
    crmLog("حذف لید", record ? ("«" + record.name + "» حذف شد.") : "");
    crmPopulateRegionNeighFilters();
    crmRenderList();

}


// =====================================================
// تبدیل به مشتری — رکورد CRM را به لیست مشتریان سیستم اضافه می‌کند
// =====================================================

function crmConvertToCustomer(id) {

    const record = crmRecords.find(function(r) { return r.id === id; });

    if (!record) return;

    if (!record.name) {
        alert("این رکورد نام ندارد — قابل تبدیل به مشتری نیست.");
        return;
    }

    if (typeof customers === "undefined" || typeof saveCustomers !== "function") {
        alert("❌ خطا: ماژول مشتریان (app.js) به‌درستی لود نشده است.");
        return;
    }

    const customer = {

        name: record.name,
        nationalId: "",
        econCode: "",
        regNo: "",
        province: record.region || "",
        city: record.neighborhood || "",
        address: record.address || "",
        phone: record.phone || "",
        postalCode: ""

    };

    customers.push(customer);
    saveCustomers();

    record.convertedCustomer = true;
    record.customerName = customer.name;
    record.orderStatus = record.orderStatus === "No order" ? "Interested" : record.orderStatus;

    crmSave();
    crmLog("تبدیل به مشتری", "«" + customer.name + "» از CRM به لیست مشتریان اضافه شد.");
    crmRenderList();

    alert("✅ «" + customer.name + "» به لیست مشتریان اضافه شد.");

}


// =====================================================
// خروجی CSV (همه‌ی رکوردها)
// =====================================================

function crmExportCSV() {

    if (!crmIsAdmin()) {
        alert("⛔ این بخش فقط برای مدیر سیستم قابل دسترسی است.");
        return;
    }

    const header = ["region", "neighborhood", "name", "address", "phone", "type", "team", "visitStatus", "orderStatus", "lastVisit", "nextFollow", "notes"];

    const rows = crmRecords.map(function(r) {

        return header.map(function(key) {

            const value = String(r[key] || "").replace(/"/g, '""');
            return '"' + value + '"';

        }).join(",");

    });

    const csv = header.join(",") + "\n" + rows.join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "crm-export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);

}


// =====================================================
// دانلود نمونه فرمت CSV (برای اینکه کاربر دقیقاً بداند
// چه ستون‌هایی با چه نامی لازم است)
// =====================================================

function crmDownloadTemplate() {

    if (!crmIsAdmin()) {
        alert("⛔ این بخش فقط برای مدیر سیستم قابل دسترسی است.");
        return;
    }

    const header = ["region", "neighborhood", "name", "address", "phone", "type", "team"];
    const sample = ["7", "سهروردی", "آزمایشگاه نمونه", "خیابان مثال، پلاک 1", "02112345678", "تشخیص طبی", "Team A"];

    const csv =
        header.join(",") + "\n" +
        sample.map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(",");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "crm-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);

}


// =====================================================
// پارسر واقعی CSV — کوتیشن، ویرگول داخل مقدار، \r\n و
// جداکننده‌ی ; (رایج در اکسل فارسی/اروپایی) را هم پشتیبانی می‌کند
// =====================================================

function crmParseCSV(text) {

    // حذف BOM احتمالی ابتدای فایل
    text = text.replace(/^\uFEFF/, "");

    // تشخیص جداکننده از روی خط اول: اگر ; بیشتر از , بود، جداکننده ; است
    const firstLine = text.split(/\r?\n/)[0] || "";
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const delimiter = semiCount > commaCount ? ";" : ",";

    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {

        const ch = text[i];
        const next = text[i + 1];

        if (inQuotes) {

            if (ch === '"' && next === '"') { field += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { field += ch; }

        } else {

            if (ch === '"') { inQuotes = true; }
            else if (ch === delimiter) { row.push(field); field = ""; }
            else if (ch === "\r") { /* skip */ }
            else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
            else { field += ch; }

        }

    }

    // آخرین سطر (اگر با \n تمام نشده باشد)
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows
        .map(function(r) { return r.map(function(c) { return c.trim(); }); })
        .filter(function(r) { return r.some(function(c) { return c !== ""; }); });

}


// نگاشت نام‌های مختلف (فارسی/انگلیسی) ستون‌ها به کلید استاندارد داخلی
const CRM_HEADER_ALIASES = {

    region: ["region", "منطقه", "region name"],
    neighborhood: ["neighborhood", "neigh", "محله"],
    name: ["name", "نام", "نام مرکز", "نام آزمایشگاه", "نام مشتری"],
    address: ["address", "آدرس"],
    phone: ["phone", "تلفن", "شماره تماس", "موبایل", "شماره تلفن"],
    type: ["type", "نوع"],
    team: ["team", "تیم"]

};


function crmMatchHeader(rawHeader) {

    const normalized = String(rawHeader || "").trim().toLowerCase();

    for (const key in CRM_HEADER_ALIASES) {
        if (CRM_HEADER_ALIASES[key].some(function(alias) { return alias.toLowerCase() === normalized; })) {
            return key;
        }
    }

    return null;

}


// =====================================================
// ایمپورت — از CSV یا Excel (xlsx/xls)، با تشخیص خودکار
// نام ستون‌ها (فارسی یا انگلیسی)
// =====================================================

let crmImportPending = null; // { headerRow: [...], dataRows: [[...], ...], fileName }


const CRM_TARGET_FIELDS = [
    { key: "name", label: "نام مرکز (الزامی)", required: true },
    { key: "region", label: "منطقه", required: false },
    { key: "neighborhood", label: "محله", required: false },
    { key: "address", label: "آدرس", required: false },
    { key: "phone", label: "تلفن", required: false },
    { key: "type", label: "نوع", required: false },
    { key: "team", label: "تیم", required: false }
];


// =====================================================
// مرحله‌ی ۱ — فایل را می‌خواند و پیش‌نمایش/فرم نگاشت ستون نشان می‌دهد
// (هیچ داده‌ای هنوز ذخیره نمی‌شود)
// =====================================================

function crmAnalyzeImportFile() {

    if (!crmIsAdmin()) {
        alert("⛔ این بخش فقط برای مدیر سیستم قابل دسترسی است.");
        return;
    }

    const fileInput = document.getElementById("csvFile");
    const file = fileInput?.files?.[0];
    const msg = document.getElementById("csvMsg");
    const noHeader = document.getElementById("csvNoHeader")?.checked;

    if (!file) {
        alert("لطفاً یک فایل CSV یا Excel انتخاب کنید.");
        return;
    }

    if (msg) msg.textContent = "";

    const isExcel = /\.xlsx?$/i.test(file.name);

    function finish(rawHeaderRow, rawDataRows) {

        let headerRow = rawHeaderRow;
        let dataRows = rawDataRows;

        // اگر فایل ردیف عنوان ندارد، همان ردیف اول هم جزو داده است
        // و به‌جایش نام‌های عمومی «ستون ۱، ستون ۲، ...» می‌سازیم
        if (noHeader) {
            dataRows = [rawHeaderRow].concat(rawDataRows);
            headerRow = rawHeaderRow.map(function(_, idx) { return "ستون " + (idx + 1); });
        }

        if (!headerRow || headerRow.length === 0 || dataRows.length === 0) {
            if (msg) msg.textContent = "❌ فایل خالی است.";
            return;
        }

        crmImportPending = { headerRow: headerRow, dataRows: dataRows, fileName: file.name };

        crmRenderImportMapping();

        if (msg) {
            msg.textContent =
                "✅ فایل خوانده شد — " + dataRows.length + " ردیف پیدا شد. حالا پایین را ببینید و مشخص کنید کدام ستون فایل شما معادل کدام فیلد سیستم است.";
        }

    }

    if (isExcel) {

        if (typeof XLSX === "undefined") {
            alert("❌ کتابخانه‌ی خواندن اکسل (SheetJS) لود نشده — به اینترنت وصل باشید یا از فرمت CSV استفاده کنید.");
            return;
        }

        const reader = new FileReader();

        reader.onload = function(e) {

            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: "array" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];

            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });

            if (!rows || rows.length === 0) {
                if (msg) msg.textContent = "❌ فایل اکسل خالی است.";
                return;
            }

            finish(rows[0], rows.slice(1));

        };

        reader.readAsArrayBuffer(file);

    } else {

        const reader = new FileReader();

        reader.onload = function(e) {

            const rows = crmParseCSV(String(e.target.result || ""));

            if (rows.length === 0) {
                if (msg) msg.textContent = "❌ فایل CSV خالی است.";
                return;
            }

            finish(rows[0], rows.slice(1));

        };

        reader.readAsText(file, "UTF-8");

    }

}


// =====================================================
// مرحله‌ی ۲ — فرم نگاشت ستون + پیش‌نمایش
// =====================================================

function crmRenderImportMapping() {

    const box = document.getElementById("importMappingBox");
    if (!box || !crmImportPending) return;

    const headerRow = crmImportPending.headerRow;

    const columnOptionsHtml = function(guessKey) {

        return '<option value="">— هیچ‌کدام —</option>' +
            headerRow.map(function(h, idx) {
                const guessed = guessKey !== null && crmMatchHeader(h) === guessKey;
                return '<option value="' + idx + '"' + (guessed ? " selected" : "") + '>' + escapeHtml(h) + '</option>';
            }).join("");

    };

    const previewRows = crmImportPending.dataRows.slice(0, 3);

    box.innerHTML = `

        <div class="crm-inner-card" style="margin-top:16px; border-color:#0fa37f88;">

            <p class="crm-section-title">نگاشت ستون‌ها</p>
            <p class="crm-section-sub">فایل: «${escapeHtml(crmImportPending.fileName)}» — ${crmImportPending.dataRows.length} ردیف. برای هر فیلد سیستم، ستون معادلش در فایل خودت را انتخاب کن.</p>

            <div class="treasury-add-account-form">
                ${
                    CRM_TARGET_FIELDS.map(function(f) {
                        return `
                            <div class="form-group">
                                <label>${f.label}</label>
                                <select id="map_${f.key}">${columnOptionsHtml(f.key)}</select>
                            </div>
                        `;
                    }).join("")
                }
            </div>

            <p class="crm-section-title" style="margin-top:18px;">پیش‌نمایش فایل (۳ ردیف اول)</p>

            <div class="table-container" style="margin-bottom:16px;">
                <table>
                    <thead>
                        <tr>${headerRow.map(function(h) { return "<th>" + escapeHtml(h) + "</th>"; }).join("")}</tr>
                    </thead>
                    <tbody>
                        ${
                            previewRows.map(function(row) {
                                return "<tr>" + headerRow.map(function(_, idx) {
                                    return "<td>" + escapeHtml(row[idx] !== undefined ? String(row[idx]) : "") + "</td>";
                                }).join("") + "</tr>";
                            }).join("")
                        }
                    </tbody>
                </table>
            </div>

            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button type="button" id="btnConfirmImport">✅ تایید و ایمپورت با این نگاشت</button>
                <button type="button" id="btnCancelImport">✕ انصراف</button>
            </div>

        </div>

    `;

    document.getElementById("btnConfirmImport")?.addEventListener("click", crmConfirmImport);
    document.getElementById("btnCancelImport")?.addEventListener("click", crmCancelImport);

}


function crmCancelImport() {

    crmImportPending = null;

    const box = document.getElementById("importMappingBox");
    if (box) box.innerHTML = "";

    const fileInput = document.getElementById("csvFile");
    if (fileInput) fileInput.value = "";

    const msg = document.getElementById("csvMsg");
    if (msg) msg.textContent = "";

}


// =====================================================
// مرحله‌ی ۳ — با نگاشتی که کاربر انتخاب کرده، واقعاً ایمپورت می‌کند
// =====================================================

function crmConfirmImport() {

    if (!crmIsAdmin()) {
        alert("⛔ این بخش فقط برای مدیر سیستم قابل دسترسی است.");
        return;
    }

    if (!crmImportPending) return;

    const mapping = {};

    CRM_TARGET_FIELDS.forEach(function(f) {
        const select = document.getElementById("map_" + f.key);
        const value = select ? select.value : "";
        mapping[f.key] = value === "" ? -1 : Number(value);
    });

    if (mapping.name === -1) {
        alert("⛔ حتماً باید مشخص کنی کدام ستون «نام مرکز» است.");
        return;
    }

    let imported = 0;
    let skipped = 0;

    crmImportPending.dataRows.forEach(function(cols) {

        const name = mapping.name >= 0 ? String(cols[mapping.name] || "").trim() : "";

        if (!name) {
            skipped++;
            return;
        }

        function pick(key) {
            const idx = mapping[key];
            return idx >= 0 ? String(cols[idx] || "").trim() : "";
        }

        crmRecords.push({
            id: crmGenId(),
            region: pick("region"),
            neighborhood: pick("neighborhood"),
            name: name,
            address: pick("address"),
            phone: pick("phone"),
            type: pick("type"),
            team: pick("team"),
            visitStatus: "Not visited",
            orderStatus: "No order",
            lastVisit: "",
            nextFollow: "",
            notes: "",
            convertedCustomer: false,
            createdAt: new Date().toISOString()
        });

        imported++;

    });

    crmSave();
    crmLog("ایمپورت دیتاست", imported + " رکورد از فایل «" + crmImportPending.fileName + "» با نگاشت دستی ایمپورت شد" + (skipped ? "، " + skipped + " ردیف بدون نام رد شد." : "."));

    crmPopulateRegionNeighFilters();
    crmRenderList();

    const msg = document.getElementById("csvMsg");
    if (msg) {
        msg.textContent =
            "✅ " + imported + " رکورد ایمپورت شد" +
            (skipped ? " — " + skipped + " ردیف به‌دلیل نداشتن نام رد شد." : ".");
    }

    crmImportPending = null;

    const box = document.getElementById("importMappingBox");
    if (box) box.innerHTML = "";

    const fileInput = document.getElementById("csvFile");
    if (fileInput) fileInput.value = "";

}


// =====================================================
// خروجی اکسل ردیف‌های انتخاب‌شده
// =====================================================

function crmExportSelectedExcel() {

    if (crmSelected.size === 0) {
        alert("هیچ ردیفی انتخاب نشده است. از چک‌باکس کنار هر ردیف استفاده کنید.");
        return;
    }

    if (typeof XLSX === "undefined") {
        alert("❌ کتابخانه‌ی خروجی اکسل (SheetJS) لود نشده — به اینترنت وصل باشید.");
        return;
    }

    const selectedRecords = crmRecords.filter(function(r) { return crmSelected.has(r.id); });

    const data = selectedRecords.map(function(r) {

        return {
            "منطقه": r.region || "",
            "محله": r.neighborhood || "",
            "نام مرکز": r.name || "",
            "نوع": r.type || "",
            "آدرس": r.address || "",
            "تلفن": r.phone || "",
            "تیم": r.team || "",
            "وضعیت ویزیت": r.visitStatus || "",
            "وضعیت سفارش": r.orderStatus || "",
            "آخرین ویزیت": r.lastVisit || "",
            "پیگیری بعدی": r.nextFollow || "",
            "یادداشت": r.notes || ""
        };

    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CRM");
    XLSX.writeFile(wb, "crm-selected.xlsx");

}


// =====================================================
// ریست کامل دیتابیس CRM
// =====================================================

async function crmResetDB() {

    if (!crmIsAdmin()) {
        alert("⛔ این بخش فقط برای مدیر سیستم قابل دسترسی است.");
        return;
    }

    if (!confirm("⚠️ همه‌ی رکوردهای CRM برای همیشه پاک می‌شوند. مطمئن هستید؟")) return;
    if (!confirm("این عملیات برگشت‌ناپذیر است. تایید نهایی؟")) return;

    const countBefore = crmRecords.length;

    // این پاک‌سازی از یک مسیرِ جداگانه و واقعاً ادمین-فقط سمتِ سرور
    // رد می‌شود (نه crmSave()/PUT معمولی) چون آن مسیرِ عمومی با
    // دسترسیِ معمولیِ «crm» (لازم برای کارِ روزمره) هم قابل‌نوشتن است
    try {

        const response = await fetch("/api/crm/reset", { method: "POST", credentials: "same-origin" });

        if (!response.ok) {
            const result = await response.json().catch(function() { return {}; });
            alert("❌ " + (result.error || "پاک‌سازی دیتابیس ناموفق بود."));
            return;
        }

    } catch (error) {
        alert("⛔ ارتباط با سرور برقرار نشد.");
        return;
    }

    crmRecords = [];
    crmSelected.clear();
    localStorage.setItem("stlp_crm_records", "[]");

    crmLog("ریست دیتابیس", countBefore + " رکورد به‌طور کامل پاک شد.");
    crmPopulateRegionNeighFilters();
    crmRenderList();

}


// =====================================================
// مدیریت تیم‌ها — فقط مدیر سیستم
// =====================================================

function crmIsAdmin() {

    const user = stlpCurrentUser();
    return !!(user && user.isAdmin);

}


function crmRenderTeamsAdmin() {

    const box = document.getElementById("teamsAdminBox");
    if (!box) return;

    if (!crmIsAdmin()) {
        box.innerHTML = "";
        return;
    }

    box.innerHTML = `
        <div class="treasury-add-account-form">
            <div class="form-group">
                <label>نام تیم جدید</label>
                <input id="newTeamName" placeholder="مثلاً Team E">
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button type="button" id="btnAddTeam">➕ افزودن تیم</button>
            </div>
        </div>
    `;

    document.getElementById("btnAddTeam")?.addEventListener("click", crmAddTeam);

}


function crmRenderTeamsList() {

    const box = document.getElementById("teamsListBox");
    if (!box) return;

    const isAdmin = crmIsAdmin();

    box.innerHTML = crmSettings.teams.map(function(team, index) {

        return `
            <div class="crm-team-row">
                <span class="crm-team-name">${escapeHtml(team)}</span>
                ${
                    isAdmin
                        ? `<div class="crm-team-actions">
                                <button type="button" onclick="crmEditTeam(${index})">✏️ ویرایش</button>
                                <button type="button" onclick="crmDeleteTeam(${index})">🗑 حذف</button>
                           </div>`
                        : ""
                }
            </div>
        `;

    }).join("");

}


function crmAddTeam() {

    if (!crmIsAdmin()) {
        alert("⛔ فقط مدیر سیستم می‌تواند تیم اضافه کند.");
        return;
    }

    const input = document.getElementById("newTeamName");
    const name = (input?.value || "").trim();

    if (!name) {
        alert("لطفاً نام تیم را وارد کنید.");
        return;
    }

    if (crmSettings.teams.some(function(t) { return t === name; })) {
        alert("این تیم قبلاً وجود دارد.");
        return;
    }

    crmSettings.teams.push(name);
    crmSaveSettings();
    crmLog("افزودن تیم", "تیم «" + name + "» اضافه شد.");

    if (input) input.value = "";

    crmRenderTeamsList();
    crmPopulateTeamSelects();

    const msg = document.getElementById("settingsMsg");
    if (msg) {
        msg.textContent = "✅ تیم «" + name + "» اضافه شد.";
        setTimeout(function() { msg.textContent = ""; }, 3000);
    }

}


function crmEditTeam(index) {

    if (!crmIsAdmin()) {
        alert("⛔ فقط مدیر سیستم می‌تواند تیم را ویرایش کند.");
        return;
    }

    const oldName = crmSettings.teams[index];
    if (oldName === undefined) return;

    const newName = prompt("نام جدید تیم:", oldName);
    if (newName === null) return;

    const trimmed = newName.trim();

    if (!trimmed) {
        alert("نام تیم نمی‌تواند خالی باشد.");
        return;
    }

    if (crmSettings.teams.some(function(t, i) { return t === trimmed && i !== index; })) {
        alert("تیمی با این نام از قبل وجود دارد.");
        return;
    }

    crmSettings.teams[index] = trimmed;
    crmSaveSettings();
    crmLog("ویرایش تیم", "تیم «" + oldName + "» به «" + trimmed + "» تغییر یافت.");

    // هماهنگ‌سازی رکوردهای CRM که به نام قدیمی تیم اشاره می‌کردند
    let recordsChanged = false;

    crmRecords.forEach(function(r) {
        if (r.team === oldName) {
            r.team = trimmed;
            recordsChanged = true;
        }
    });

    if (recordsChanged) crmSave();

    crmRenderTeamsList();
    crmPopulateTeamSelects();
    crmRenderList();

    const msg = document.getElementById("settingsMsg");
    if (msg) {
        msg.textContent = "✅ تیم به «" + trimmed + "» تغییر یافت.";
        setTimeout(function() { msg.textContent = ""; }, 3000);
    }

}


function crmDeleteTeam(index) {

    if (!crmIsAdmin()) {
        alert("⛔ فقط مدیر سیستم می‌تواند تیم را حذف کند.");
        return;
    }

    const name = crmSettings.teams[index];
    if (name === undefined) return;

    const inUse = crmRecords.some(function(r) { return r.team === name; });

    const confirmMsg = inUse
        ? "⚠️ این تیم روی چند رکورد CRM ثبت شده — با حذف تیم، آن رکوردها بدون تیم می‌مانند (خودشان حذف نمی‌شوند). ادامه می‌دهید؟"
        : "آیا از حذف تیم «" + name + "» مطمئن هستید؟";

    if (!confirm(confirmMsg)) return;

    if (crmSettings.teams.length <= 1) {
        alert("❌ حداقل باید یک تیم در سیستم باقی بماند.");
        return;
    }

    crmSettings.teams.splice(index, 1);
    crmSaveSettings();
    crmLog("حذف تیم", "تیم «" + name + "» حذف شد.");

    crmRenderTeamsList();
    crmPopulateTeamSelects();

    const msg = document.getElementById("settingsMsg");
    if (msg) {
        msg.textContent = "✅ تیم «" + name + "» حذف شد.";
        setTimeout(function() { msg.textContent = ""; }, 3000);
    }

}


// =====================================================
// راه‌اندازی اولیه
// =====================================================

function crmInit() {

    crmPopulateTeamSelects();
    crmPopulateRegionNeighFilters();
    crmRenderList();

    crmRenderTeamsAdmin();
    crmRenderTeamsList();

    // تب تنظیمات و مدیریت داده فقط برای مدیر سیستم قابل مشاهده‌اند
    const settingsTabBtn = document.getElementById("crmTabBtn-settings");
    const dataAdminTabBtn = document.getElementById("crmTabBtn-dataAdmin");

    if (!crmIsAdmin()) {
        if (settingsTabBtn) settingsTabBtn.style.display = "none";
        if (dataAdminTabBtn) dataAdminTabBtn.style.display = "none";
    }


    ["q", "filterRegion", "filterNeigh", "filterTeam", "filterStatus", "filterOrderStatus"]
        .forEach(function(id) {

            const el = document.getElementById(id);
            if (!el) return;

            el.addEventListener("input", crmRenderList);
            el.addEventListener("change", crmRenderList);

        });


    document.getElementById("btnAddManual")?.addEventListener("click", crmAddManual);
    document.getElementById("btnAnalyzeImport")?.addEventListener("click", crmAnalyzeImportFile);
    document.getElementById("btnExportCSV")?.addEventListener("click", crmExportCSV);
    document.getElementById("btnDownloadTemplate")?.addEventListener("click", crmDownloadTemplate);
    document.getElementById("btnExportSelected")?.addEventListener("click", crmExportSelectedExcel);
    document.getElementById("btnResetDB")?.addEventListener("click", crmResetDB);

}

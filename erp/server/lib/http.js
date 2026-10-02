// =====================================================
// چند ابزار کوچک برای کار با http خامِ Node
// (به‌جای Express — تا این برنامه هیچ وابستگی بیرونی‌ای
// نداشته باشد و فقط با «node server.js» اجرا شود)
// =====================================================

"use strict";

function parseCookies(header) {

    const out = {};

    if (!header) return out;

    header.split(";").forEach(function(part) {

        const idx = part.indexOf("=");
        if (idx === -1) return;

        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();

        if (key) out[key] = decodeURIComponent(value);

    });

    return out;

}

function serializeCookie(name, value, options) {

    options = options || {};

    let str = name + "=" + encodeURIComponent(value);

    if (options.maxAge != null) str += "; Max-Age=" + Math.floor(options.maxAge / 1000);
    if (options.path) str += "; Path=" + options.path;
    else str += "; Path=/";
    if (options.httpOnly) str += "; HttpOnly";
    if (options.sameSite) str += "; SameSite=" + options.sameSite;
    if (options.secure) str += "; Secure";
    if (options.expires) str += "; Expires=" + options.expires.toUTCString();

    return str;

}

function readJsonBody(req) {

    return new Promise(function(resolve, reject) {

        const chunks = [];
        let size = 0;
        const MAX = 25 * 1024 * 1024;

        req.on("data", function(chunk) {

            size += chunk.length;

            if (size > MAX) {
                reject(new Error("درخواست خیلی بزرگ است."));
                req.destroy();
                return;
            }

            chunks.push(chunk);

        });

        req.on("end", function() {

            if (chunks.length === 0) return resolve({});

            try {
                const text = Buffer.concat(chunks).toString("utf8");
                resolve(text ? JSON.parse(text) : {});
            } catch (error) {
                reject(error);
            }

        });

        req.on("error", reject);

    });

}

function sendJson(res, status, body, extraHeaders) {

    const text = JSON.stringify(body);

    const headers = Object.assign(
        {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(text)
        },
        extraHeaders || {}
    );

    res.writeHead(status, headers);
    res.end(text);

}

module.exports = { parseCookies, serializeCookie, readJsonBody, sendJson };

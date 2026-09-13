// The full dump of all references (GET /bibrefs without a refs parameter)
// is by far the most expensive response the server produces: ~27MB of
// JSON. Serializing it on every request blocks the event loop for about a
// second and, worse, allocates the whole string plus a Buffer copy plus
// gzip state per request, which is enough to push the process past the
// memory of a small instance and get it killed.
//
// So the dump is serialized and gzipped exactly once, when the FullDump is
// created, and those bytes are served directly. The references never
// change while the process runs (updates are deployed), so the cache
// can't go stale.

var zlib = require("zlib"),
    crypto = require("crypto");

function FullDump(refs) {
    var json = JSON.stringify(refs)
        // Same escaping as res.jsonp, so the body is safe to embed in JS.
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
    this.raw = Buffer.from(json, "utf8");
    json = null; // let the 27MB string be collected
    this.gzip = zlib.gzipSync(this.raw, { level: 9 });
    this.etag = '"' + crypto.createHash("sha1").update(this.raw).digest("base64").substring(0, 27) + '"';
}

// Sends the dump, picking the response format from the request.
FullDump.prototype.send = send;
function send(req, res) {
    var callback = getCallbackName(req);
    res.setHeader("Vary", "Accept-Encoding");
    if (callback) {
        this.sendJSONP(res, callback);
    } else if (isFresh(req, res, this.etag)) {
        this.sendNotModified(res);
    } else if (req.acceptsEncodings("gzip")) {
        this.sendGzipped(res);
    } else {
        this.sendRaw(res);
    }
}

// JSON-P. Rare; the wrapper is written around the cached body in three
// chunks so that no 27MB string gets built, and the compression middleware
// takes care of encoding.
FullDump.prototype.sendJSONP = sendJSONP;
function sendJSONP(res, callback) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.write("/**/ typeof " + callback + " === 'function' && " + callback + "(");
    res.write(this.raw);
    res.end(");");
}

// The client already has this exact dump.
FullDump.prototype.sendNotModified = sendNotModified;
function sendNotModified(res) {
    res.status(304).end();
}

// Pre-compressed. The compression middleware sees the Content-Encoding
// header and leaves the body alone.
FullDump.prototype.sendGzipped = sendGzipped;
function sendGzipped(res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Content-Length", this.gzip.length);
    res.end(this.gzip);
}

// Plain JSON, for clients that don't accept gzip.
FullDump.prototype.sendRaw = sendRaw;
function sendRaw(res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", this.raw.length);
    res.end(this.raw);
}

// The JSON-P callback name, sanitized the same way res.jsonp does it,
// or null when the request isn't a JSON-P one.
function getCallbackName(req) {
    var callback = req.query["callback"];
    if (Array.isArray(callback)) callback = callback[0];
    if (typeof callback !== "string" || callback.length === 0) return null;
    return callback.replace(/[^\[\]\w$.]/g, "");
}

// Whether the request's If-None-Match matches the dump's ETag. Sets the
// ETag header as a side effect, since it belongs on 200 and 304 alike.
function isFresh(req, res, etag) {
    res.setHeader("ETag", etag);
    return req.fresh;
}

module.exports = function(refs) {
    return new FullDump(refs);
};
module.exports.FullDump = FullDump;

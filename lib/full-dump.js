// The full dump of all references (GET /bibrefs without a refs parameter)
// is by far the most expensive response the server produces: ~27MB of
// JSON. Serializing it on every request blocks the event loop for about a
// second and, worse, allocates the whole string plus a Buffer copy plus
// gzip state per request, which is enough to push the process past the
// memory of a small instance and get it killed.
//
// So the dump is built exactly once, when the FullDump is created, and the
// bytes are served directly. The references never change while the process
// runs (updates are deployed), so the cache can't go stale.
//
// Memory is tight enough on the production instance that even building
// the dump has to be careful: the JSON is never materialized as a whole.
// It is serialized one reference at a time straight into a gzip stream,
// and only the compressed form (~3MB) is kept. Clients that accept gzip
// (browsers, fetch, most HTTP libraries) get those bytes as-is; the rare
// ones that don't get them decompressed on the fly, which streams in small
// chunks and never holds the whole dump in memory either.

var zlib = require("zlib"),
    crypto = require("crypto");

function FullDump(refs) {
    // Resolves with this FullDump once it is ready to be sent.
    this.ready = build(refs, this);
}

// Serializes `refs` reference by reference into a gzip stream, keeping
// only the compressed output, the uncompressed length and a hash of the
// uncompressed bytes (for the ETag).
function build(refs, dump) {
    return new Promise(function(resolve, reject) {
        var gzip = zlib.createGzip({ level: 9 }),
            hash = crypto.createHash("sha1"),
            chunks = [],
            rawLength = 0,
            keys = Object.keys(refs),
            i = 0;
        gzip.on("data", function(chunk) { chunks.push(chunk); });
        gzip.on("error", reject);
        gzip.on("end", function() {
            dump.gzip = Buffer.concat(chunks);
            dump.rawLength = rawLength;
            dump.etag = '"' + hash.digest("base64").substring(0, 27) + '"';
            resolve(dump);
        });
        // The JSON is produced in pieces: "{", then one "key":value per
        // reference (comma-separated), then "}". `pos` is the next piece.
        var pos = 0, last = keys.length + 1;
        function nextChunk() {
            var p = pos++;
            if (p === 0) return "{";
            if (p === last) return "}";
            var key = keys[p - 1];
            return (p === 1 ? "" : ",") + stringify(key) + ":" + stringify(refs[key]);
        }
        (function writeMore() {
            var ok = true;
            while (ok && pos <= last) {
                var buf = Buffer.from(nextChunk(), "utf8");
                rawLength += buf.length;
                hash.update(buf);
                ok = gzip.write(buf);
            }
            if (pos > last) {
                gzip.end();
            } else {
                // Wait for the stream to drain before pushing more.
                gzip.once("drain", writeMore);
            }
        })();
    });
}

// JSON.stringify, with the same escaping as res.jsonp so that the body is
// safe to embed in JS.
function stringify(value) {
    return JSON.stringify(value)
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

// Sends the dump, picking the response format from the request. Waits for
// the dump to be built if needed, so it's safe to route to before that.
FullDump.prototype.send = send;
function send(req, res, next) {
    var self = this;
    this.ready.then(function() {
        var callback = getCallbackName(req);
        res.setHeader("Vary", "Accept-Encoding");
        if (callback) {
            self.sendJSONP(req, res, callback);
        } else if (isFresh(req, res, self.etag)) {
            self.sendNotModified(res);
        } else if (req.acceptsEncodings("gzip")) {
            self.sendGzipped(req, res);
        } else {
            self.sendRaw(req, res);
        }
    }).catch(next);
}

// JSON-P. Rare; the wrapper is written around the streamed body so that no
// 27MB string gets built, and the compression middleware takes care of
// encoding.
FullDump.prototype.sendJSONP = sendJSONP;
function sendJSONP(req, res, callback) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    if (req.method === "HEAD") return res.end();
    res.write("/**/ typeof " + callback + " === 'function' && " + callback + "(");
    this.streamRaw(res, function() {
        res.end(");");
    });
}

// The client already has this exact dump.
FullDump.prototype.sendNotModified = sendNotModified;
function sendNotModified(res) {
    res.status(304).end();
}

// Pre-compressed. The compression middleware sees the Content-Encoding
// header and leaves the body alone.
FullDump.prototype.sendGzipped = sendGzipped;
function sendGzipped(req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Content-Length", this.gzip.length);
    if (req.method === "HEAD") return res.end();
    res.end(this.gzip);
}

// Plain JSON, for clients that don't accept gzip, decompressed on the fly.
FullDump.prototype.sendRaw = sendRaw;
function sendRaw(req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", this.rawLength);
    if (req.method === "HEAD") return res.end();
    this.streamRaw(res, function() {
        res.end();
    });
}

// Streams the uncompressed dump into `res` without ending it, then calls
// `done`. Decompression happens in small chunks off the main thread.
FullDump.prototype.streamRaw = streamRaw;
function streamRaw(res, done) {
    var gunzip = zlib.createGunzip();
    gunzip.on("error", function(err) { res.destroy(err); });
    gunzip.on("end", done);
    gunzip.pipe(res, { end: false });
    gunzip.end(this.gzip);
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

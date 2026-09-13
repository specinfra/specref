var assert = require('assert');
var http = require('http');
var zlib = require('zlib');
var express = require('express');
var fullDump = require('../lib/full-dump');

suite('Full dump', function() {
    var refs = {
        FOO: { title: "FOO title", id: "FOO" },
        foo: { aliasOf: "FOO", id: "foo" },
        BAR: { title: "Line\u2028separator", id: "BAR" }
    };
    var dump = fullDump(refs);
    var server, port;

    suiteSetup(function(done) {
        // Same middleware stack as the server, so that the interplay with
        // compression is covered.
        var app = express();
        app.use(require("compression")());
        app.get('/bibrefs', function(req, res, next) { dump.send(req, res, next); });
        server = app.listen(0, function() {
            port = server.address().port;
            done();
        });
    });

    suiteTeardown(function(done) {
        server.close(done);
    });

    function request(path, headers, cb) {
        http.request({ method: "GET", port: port, path: path, headers: headers }, function(res) {
            var chunks = [];
            res.on("data", function(chunk) { chunks.push(chunk); });
            res.on("end", function() { cb(res, Buffer.concat(chunks)); });
        }).end();
    }

    function raw() {
        return zlib.gunzipSync(dump.gzip).toString("utf8");
    }

    test("the cached JSON is what JSON.stringify would produce, with U+2028/9 escaped", function() {
        return dump.ready.then(function() {
            var expected = JSON.stringify(refs).replace(/\u2028/g, "\\u2028");
            assert.strictEqual(raw(), expected);
            assert.deepStrictEqual(JSON.parse(raw()), refs);
            assert.strictEqual(dump.rawLength, Buffer.byteLength(expected, "utf8"));
            assert.ok(/^"[A-Za-z0-9+\/]{27}"$/.test(dump.etag), "strong ETag: " + dump.etag);
        });
    });

    test("an empty set of references is a valid dump too", function() {
        return fullDump({}).ready.then(function(d) {
            assert.strictEqual(zlib.gunzipSync(d.gzip).toString("utf8"), "{}");
            assert.strictEqual(d.rawLength, 2);
        });
    });

    test("a large set of references survives stream backpressure while building", function() {
        var many = {};
        for (var i = 0; i < 20000; i++) many["REF-" + i] = { title: "Reference number " + i, href: "https://example.com/" + i };
        return fullDump(many).ready.then(function(d) {
            var got = JSON.parse(zlib.gunzipSync(d.gzip).toString("utf8"));
            assert.deepStrictEqual(got, many);
            assert.strictEqual(d.rawLength, Buffer.byteLength(JSON.stringify(many), "utf8"));
        });
    });

    test("plain JSON for clients that don't accept gzip", function(done) {
        request("/bibrefs", {}, function(res, body) {
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers["content-type"], "application/json; charset=utf-8");
            assert.strictEqual(res.headers["content-encoding"], undefined);
            assert.strictEqual(res.headers["content-length"], String(dump.rawLength));
            assert.strictEqual(res.headers["etag"], dump.etag);
            assert.strictEqual(res.headers["vary"], "Accept-Encoding");
            assert.deepStrictEqual(JSON.parse(body.toString("utf8")), refs);
            done();
        });
    });

    test("pre-gzipped JSON for clients that accept gzip", function(done) {
        request("/bibrefs", { "Accept-Encoding": "gzip" }, function(res, body) {
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers["content-type"], "application/json; charset=utf-8");
            assert.strictEqual(res.headers["content-encoding"], "gzip");
            assert.strictEqual(res.headers["content-length"], String(dump.gzip.length));
            assert.strictEqual(res.headers["etag"], dump.etag);
            assert.ok(body.equals(dump.gzip), "body is the cached gzip buffer");
            assert.deepStrictEqual(JSON.parse(zlib.gunzipSync(body).toString("utf8")), refs);
            done();
        });
    });

    test("304 when If-None-Match matches", function(done) {
        request("/bibrefs", { "Accept-Encoding": "gzip", "If-None-Match": dump.etag }, function(res, body) {
            assert.strictEqual(res.statusCode, 304);
            assert.strictEqual(res.headers["etag"], dump.etag);
            assert.strictEqual(body.length, 0);
            done();
        });
    });

    test("200 when If-None-Match doesn't match", function(done) {
        request("/bibrefs", { "If-None-Match": '"nope"' }, function(res, body) {
            assert.strictEqual(res.statusCode, 200);
            assert.deepStrictEqual(JSON.parse(body.toString("utf8")), refs);
            done();
        });
    });

    test("JSON-P when a callback is given, with the callback name sanitized", function(done) {
        request("/bibrefs?callback=foo.bar()<>", {}, function(res, body) {
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers["content-type"], "text/javascript; charset=utf-8");
            assert.strictEqual(res.headers["x-content-type-options"], "nosniff");
            var js = body.toString("utf8");
            assert.strictEqual(js, "/**/ typeof foo.bar === 'function' && foo.bar(" + raw() + ");");
            // U+2028 was escaped, so this is a valid JS program.
            var got;
            var foo = { bar: function(o) { got = o; } };
            new Function("foo", js)(foo);
            assert.deepStrictEqual(got, refs);
            done();
        });
    });

    test("HEAD sends the headers but no body", function(done) {
        http.request({ method: "HEAD", port: port, path: "/bibrefs" }, function(res) {
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers["content-length"], String(dump.rawLength));
            var chunks = [];
            res.on("data", function(c) { chunks.push(c); });
            res.on("end", function() { assert.strictEqual(Buffer.concat(chunks).length, 0); done(); });
        }).end();
    });

    test("JSON-P responses are compressed by the middleware when accepted", function(done) {
        request("/bibrefs?callback=cb", { "Accept-Encoding": "gzip" }, function(res, body) {
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers["content-encoding"], "gzip");
            var js = zlib.gunzipSync(body).toString("utf8");
            assert.ok(js.startsWith("/**/ typeof cb === 'function' && cb("), js.slice(0, 40));
            done();
        });
    });
});

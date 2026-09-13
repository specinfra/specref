var assert = require('assert');
var http = require('http');
var app = require('../index');

suite('Crawlers', function() {
    var server, port;

    suiteSetup(function(done) {
        server = app.listen(0, function() {
            port = server.address().port;
            done();
        });
    });

    suiteTeardown(function(done) {
        server.close(done);
    });

    function get(path, cb) {
        http.get({ port: port, path: path }, function(res) {
            var body = "";
            res.setEncoding("utf8");
            res.on("data", function(chunk) { body += chunk; });
            res.on("end", function() { cb(res, body); });
        });
    }

    test("robots.txt allows /bibrefs and nothing else", function(done) {
        get("/robots.txt", function(res, body) {
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers["content-type"], "text/plain; charset=utf-8");
            assert.strictEqual(res.headers["cache-control"], "public, max-age=86400");
            assert.strictEqual(body, "User-agent: *\nAllow: /bibrefs\nDisallow: /\n");
            done();
        });
    });

    ["/robots.txt", "/health", "/bibrefs?refs=dahut", "/bibrefs", "/metadata", "/nope"].forEach(function(path) {
        test("every response carries X-Robots-Tag: noindex (" + path + ")", function(done) {
            get(path, function(res) {
                assert.strictEqual(res.headers["x-robots-tag"], "noindex");
                done();
            });
        });
    });
});

var assert = require('assert');
var http = require('http');
var app = require('../index');

suite('Health check', function() {
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

    function request(method, path, cb) {
        http.request({ method: method, port: port, path: path }, function(res) {
            var body = "";
            res.setEncoding("utf8");
            res.on("data", function(chunk) { body += chunk; });
            res.on("end", function() { cb(res, body); });
        }).end();
    }

    test("GET /health responds with 200 and an ok status.", function(done) {
        request("GET", "/health", function(res, body) {
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers["cache-control"], "no-store");
            assert.deepStrictEqual(JSON.parse(body), { status: "ok" });
            done();
        });
    });

    test("HEAD /health responds with 200.", function(done) {
        request("HEAD", "/health", function(res) {
            assert.strictEqual(res.statusCode, 200);
            done();
        });
    });
});

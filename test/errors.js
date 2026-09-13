var assert = require('assert');
var http = require('http');
var app = require('../index');

suite('Error handling', function() {
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

    test("an error while handling a request gets a JSON 500 without the stack trace", function(done) {
        // refs parsed as an array makes the handler throw.
        get("/bibrefs?refs[]=a&refs[]=b", function(res, body) {
            assert.strictEqual(res.statusCode, 500);
            assert.ok(/^application\/json/.test(res.headers["content-type"]), res.headers["content-type"]);
            var json = JSON.parse(body);
            assert.deepStrictEqual(Object.keys(json), ["message"]);
            assert.strictEqual(json.message, "Internal Server Error");
            done();
        });
    });

    test("unknown paths still get Express' 404", function(done) {
        get("/nope", function(res) {
            assert.strictEqual(res.statusCode, 404);
            done();
        });
    });
});

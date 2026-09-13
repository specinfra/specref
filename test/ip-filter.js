var assert = require('assert');
var http = require('http');
var express = require('express');
var ipFilter = require('../lib/ip-filter');

suite('IP filter', function() {
    suite('parseBannedIPs', function() {
        test("returns the defaults when the variable is unset.", function() {
            assert.deepStrictEqual(ipFilter.parseBannedIPs(undefined, ["1.2.3.4"]), ["1.2.3.4"]);
            assert.deepStrictEqual(ipFilter.parseBannedIPs(undefined), []);
        });

        test("splits on commas, trims whitespace and drops empty entries.", function() {
            assert.deepStrictEqual(
                ipFilter.parseBannedIPs(" 1.2.3.4, 10.0.0.0/8 ,,\n", ["9.9.9.9"]),
                ["1.2.3.4", "10.0.0.0/8"]
            );
        });

        test("an empty variable bans nothing rather than falling back to the defaults.", function() {
            assert.deepStrictEqual(ipFilter.parseBannedIPs("", ["9.9.9.9"]), []);
        });
    });

    suite('middleware', function() {
        var server, port;

        suiteSetup(function(done) {
            var app = express();
            app.set("trust proxy", true);
            app.use(ipFilter.createIpFilter(["34.96.130.0/24", "203.0.113.7"]));
            app.get('/', function(req, res) { res.status(200).send("ok"); });
            // Keep express's default error handler from printing every
            // expected denial to the console.
            app.use(function(err, req, res, next) { res.status(err.status || 500).end(); });
            server = app.listen(0, function() {
                port = server.address().port;
                done();
            });
        });

        suiteTeardown(function(done) {
            server.close(done);
        });

        function get(headers, cb) {
            http.request({ method: "GET", port: port, path: "/", headers: headers }, function(res) {
                res.resume();
                res.on("end", function() { cb(res); });
            }).end();
        }

        test("blocks a banned range forwarded by the load balancer.", function(done) {
            get({ "X-Forwarded-For": "34.96.130.7" }, function(res) {
                assert.strictEqual(res.statusCode, 403);
                done();
            });
        });

        test("blocks a banned address forwarded by the load balancer.", function(done) {
            get({ "X-Forwarded-For": "203.0.113.7" }, function(res) {
                assert.strictEqual(res.statusCode, 403);
                done();
            });
        });

        test("uses the client address, not the proxies listed after it.", function(done) {
            get({ "X-Forwarded-For": "34.96.130.7, 10.0.0.1" }, function(res) {
                assert.strictEqual(res.statusCode, 403);
                done();
            });
        });

        test("lets other forwarded addresses through.", function(done) {
            get({ "X-Forwarded-For": "198.51.100.1" }, function(res) {
                assert.strictEqual(res.statusCode, 200);
                done();
            });
        });

        test("lets direct connections through.", function(done) {
            get({}, function(res) {
                assert.strictEqual(res.statusCode, 200);
                done();
            });
        });
    });
});

var t0 = Date.now();

var log = require('./lib/logger');

var bibref = require('./lib/bibref');
delete bibref.raw;
log.info({ refs: Object.keys(bibref.all).length, memory: log.memory(), ms: Date.now() - t0 }, "references loaded");

var app = module.exports = require("express")();

var isDev = process.env.NODE_ENV == "dev" || process.env.NODE_ENV == "development";
app.enable("etag");

// Health check. Registered before the IP filter, compression and body
// parsing middleware so that it stays cheap and can never be blocked or
// slowed down by them. Clever Cloud polls this path (see
// CC_HEALTH_CHECK_PATH in DEPLOYMENT.md) both during deployment and while
// the app is running, and restarts the instance if it fails to respond
// with a 2xx status code.
app.get('/health', function (req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ status: "ok" });
});

var bannedIPs = [
	// Palo Alto Networks bot
	"34.96.130.0/24", "34.77.162.0/24", "34.86.35.0/24"
];
// Request logging. One line per completed request (see lib/logger.js for
// the level), plus, at debug level, one when the request comes in with
// the process' memory usage, so that a request that takes the process
// down can be told apart from one that merely failed.
app.use(require("pino-http")({
    logger: log,
    autoLogging: { ignore: function(req) { return req.url === "/health"; } },
    customLogLevel: function(req, res, err) {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
    },
    customSuccessMessage: function(req, res) { return "request completed"; },
    customErrorMessage: function(req, res, err) { return "request failed"; },
    serializers: {
        req: function(req) {
            return {
                id: req.id,
                method: req.method,
                url: req.url,
                remoteAddress: req.remoteAddress,
                userAgent: req.headers["user-agent"],
                referer: req.headers["referer"]
            };
        },
        res: function(res) {
            return {
                statusCode: res.statusCode,
                contentLength: res.headers["content-length"] === undefined ? undefined : Number(res.headers["content-length"]),
                contentEncoding: res.headers["content-encoding"]
            };
        }
    }
}));
app.use(function(req, res, next) {
    if (req.url !== "/health" && req.log.isLevelEnabled("debug")) {
        req.log.debug({ memory: log.memory() }, "request received");
    }
    next();
});

app.use(require('express-ipfilter').IpFilter(bannedIPs, {
    logLevel: "deny",
    logF: function(message) { log.warn(message); }
}));
app.use(require("compression")());
app.use(require("cors")());
app.use(require("body-parser").urlencoded({ extended: true }));

// Serialized and gzipped once, see lib/full-dump.js.
var fullDump = require('./lib/full-dump')(bibref.all);

// bibrefs
app.get('/bibrefs', function (req, res, next) {
    var refs = req.query["refs"];
    res.setHeader("Expires", new Date(Date.now() + 86400000).toUTCString());
    res.setHeader("Cache-Control", "public, max-age=86400");
    if (refs) {
        refs = bibref.getRefs(refs.split(","));
        res.status(200).jsonp(refs);
    } else {
        fullDump.send(req, res);
    }
});

// search
app.get('/search-refs', function (req, res, next) {
    var q = (req.query["q"] || "").toLowerCase();
    if (q) {
		var obj = {};
		var current, shortname;
		var FALSE_POSITIVES = /https?:\/\/|\.html|\.shtml|\.xhtml|\/html/g;
		function match(str) {
			str = str.toLowerCase() || "";
			str = str.replace(FALSE_POSITIVES, "");
			return str.indexOf(q) > -1;
		}
		
		function add() {
			obj[shortname] = current;
		}
		
		var all = bibref.all;
		for (shortname in all) {
			current = all[shortname];
			if (match(shortname)) {
				add();
				if (current.aliasOf) {
					var r = bibref.get(current.aliasOf);
					var k = current.aliasOf;
					while (k) {
						obj[k] = r[k];
						k = obj[k].aliasOf;
					}
				}
			} else if (typeof current == "string") { // legacy
				if (match(current)) { add(); }
			} else if (!("aliasOf" in current)) {
				for (var key in current) {
					var value = current[key];
					if (typeof value == "string") {
						if (match(value)) { add(); }
					} else if (Array.isArray(value)) {
						value.forEach(function(item) {
							if (typeof item == "string") {
								if (match(item)) { add(); }
							} else {
								for (var prop in item) {
									if (match(item[prop])) { add(); }
								}
							}
						});
					}
				}
			}
		}
        res.status(200).jsonp(obj);
    } else {
        res.status(400).jsonp({ message: "Missing q parameter" });
    }
});

// search by url
app.get('/reverse-lookup', function (req, res, next) {
    var refs,
        urls = req.query["urls"];
    if (urls) {
        refs = bibref.reverseLookup(urls.split(","));
        res.status(200).jsonp(refs);
    } else {
        res.status(400).jsonp({ message: "Missing urls parameter" });
    }
});

var metadata = (function(pkg) {
    var all = bibref.all;
    var ids = Object.keys(all);
    var refCount = 0;
    ids.forEach(function(id) {
        var ref = all[id];
        if (!("aliasOf" in ref)) refCount++;
    });
    return {
        name: pkg.name,
        version: pkg.version,
        refCount: refCount,
        aliasCount: ids.length - refCount,
        startupTime: new Date()
    };
})(require("./package.json"));

app.get('/metadata', function (req, res, next) {
    metadata.runningFor = new Date() - metadata.startupTime;
    res.status(200).jsonp(metadata);
});

// xrefs
app.get('/xrefs', function (req, res, next) {
    res.status(410).jsonp({ message: "xrefs are no longer supported." });
});

// Error handler. Logs the error with its stack (through pino-http, which
// picks up res.err) and answers with JSON. The stack is only sent back to
// the client in development.
app.use(function (err, req, res, next) {
    var status = err.status || err.statusCode || 500;
    res.err = err;
    if (res.headersSent) return next(err);
    var body = { message: status >= 500 && !isDev ? "Internal Server Error" : err.message };
    if (isDev) body.stack = err.stack;
    res.status(status).json(body);
});

if (require.main === module) {
    var port = process.env.PORT || 5000;
    var server = app.listen(port, function () {
        log.info({ port: Number(port), env: app.settings.env, memory: log.memory(), ms: Date.now() - t0 }, "server listening");
    });
    server.on("error", function(err) {
        log.fatal({ err: err }, "server error");
        process.exit(1);
    });
    log.installProcessHandlers(function(done) {
        server.close(done);
    });
    // A periodic memory snapshot, cheap and invaluable when hunting down
    // an instance that runs out of memory.
    setInterval(function() {
        log.info({ memory: log.memory() }, "memory usage");
    }, 60000).unref();
}

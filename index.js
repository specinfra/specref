var t0 = Date.now();

var bibref = require('./lib/bibref');
delete bibref.raw;

var app = module.exports = require("express")();

var errorhandlerOptions = { log: true };
if (process.env.NODE_ENV == "dev" || process.env.NODE_ENV == "development") {
    errorhandlerOptions.dumpExceptions = true;
    errorhandlerOptions.showStack = true;
}
app.enable("etag");

// Health check. Registered before the IP filter, compression and body
// parsing middleware so that it stays cheap and can never be blocked or
// slowed down by them. Clever Cloud polls this path (see
// CC_HEALTH_CHECK_PATH in the README) both during deployment and while
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
app.use(require('express-ipfilter').IpFilter(bannedIPs, { logLevel: "deny" }));
app.use(require("compression")());
app.use(require("cors")());
app.use(require("body-parser").urlencoded({ extended: true }));
app.use(require("errorhandler")(errorhandlerOptions));

// bibrefs
app.get('/bibrefs', function (req, res, next) {
    var refs = req.query["refs"];
    res.setHeader("Expires", new Date(Date.now() + 86400000).toUTCString());
    res.setHeader("Cache-Control", "public, max-age=86400");
    if (refs) {
        refs = bibref.getRefs(refs.split(","));
        res.status(200).jsonp(refs);
    } else {
        res.status(200).jsonp(bibref.all);
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

if (require.main === module) {
    var port = process.env.PORT || 5000;
    app.listen(port, function () {
        console.log("Express server listening on port %d in %s mode", port, app.settings.env);
        console.log("App started in", (Date.now() - t0) + "ms.");
    });
}

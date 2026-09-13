// Structured logging for the server, built on pino. Every line is one JSON
// object, which is what log aggregators (and Clever Cloud's log viewer)
// handle best, and errors are logged with their full stack trace under
// the `err` key.
//
// The verbosity is set with the LOG_LEVEL environment variable: one of
// fatal, error, warn, info (the default), debug, trace or silent.

var pino = require("pino");

var DEFAULT_LEVEL = "info";

function getLevel() {
    var level = process.env.LOG_LEVEL || DEFAULT_LEVEL;
    if (level in pino.levels.values || level === "silent") return level;
    return null;
}

var level = getLevel();
// Synchronous writes to stdout, so that the last lines before the process
// exits (the fatal ones, and the exit line itself) always make it out.
var logger = pino({ level: level || DEFAULT_LEVEL }, pino.destination({ fd: 1, sync: true }));
if (!level) {
    logger.warn({ LOG_LEVEL: process.env.LOG_LEVEL }, "unknown LOG_LEVEL, using " + DEFAULT_LEVEL);
}

// Snapshot of the process' memory usage, in MB, for log lines.
logger.memory = memory;
function memory() {
    var m = process.memoryUsage();
    return {
        rss: mb(m.rss),
        heapUsed: mb(m.heapUsed),
        heapTotal: mb(m.heapTotal),
        external: mb(m.external),
        arrayBuffers: mb(m.arrayBuffers)
    };
}

function mb(bytes) {
    return Math.round(bytes / 1048576);
}

// Makes sure that whatever takes the process down leaves a trace in the
// logs, with a stack when there is one, instead of a silent restart.
// Only meant to be called by the process that actually runs the server.
logger.installProcessHandlers = installProcessHandlers;
function installProcessHandlers(shutdown) {
    process.on("uncaughtException", function(err, origin) {
        logger.fatal({ err: err, origin: origin, memory: memory() }, "uncaught exception, exiting");
        process.exit(1);
    });
    process.on("unhandledRejection", function(reason) {
        var err = reason instanceof Error ? reason : new Error("Unhandled rejection: " + String(reason));
        logger.fatal({ err: err, memory: memory() }, "unhandled promise rejection, exiting");
        process.exit(1);
    });
    process.on("warning", function(warning) {
        logger.warn({ err: warning }, "process warning");
    });
    ["SIGTERM", "SIGINT", "SIGHUP"].forEach(function(signal) {
        process.on(signal, function() {
            logger.info({ signal: signal, memory: memory() }, "received " + signal + ", shutting down");
            shutdown(function() { process.exit(0); });
            // Don't hang forever if a connection never closes.
            setTimeout(function() {
                logger.warn("shutdown timed out, exiting");
                process.exit(0);
            }, 5000).unref();
        });
    });
    process.on("exit", function(code) {
        logger.info({ code: code }, "process exiting");
    });
}

module.exports = logger;

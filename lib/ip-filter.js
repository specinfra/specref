var IpFilter = require('express-ipfilter').IpFilter;

// Parses the comma-separated list of IP addresses and CIDR ranges found in
// the BANNED_IPS environment variable. Whitespace around entries is ignored,
// as are empty entries, so "1.2.3.4, 10.0.0.0/8,\n" is accepted. When the
// variable is unset, the given defaults are used instead.
function parseBannedIPs(value, defaults) {
    if (typeof value != "string") return defaults || [];
    return value.split(",").map(function(ip) {
        return ip.trim();
    }).filter(Boolean);
}

// Middleware that responds with a 403 to requests coming from any of the
// given IP addresses or CIDR ranges.
//
// The application runs behind Clever Cloud's load balancers, which forward
// requests over plain HTTP and put the client's address in the
// X-Forwarded-For header. Without trustProxy, express-ipfilter would only
// ever see the load balancer's own address and the list would never match.
function createIpFilter(bannedIPs) {
    return IpFilter(bannedIPs, { logLevel: "deny", trustProxy: true });
}

module.exports = {
    parseBannedIPs: parseBannedIPs,
    createIpFilter: createIpFilter
};

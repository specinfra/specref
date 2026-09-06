#!/usr/bin/env node
'use strict';
const async = require('async');
const { JSDOM } = require('jsdom');
const request = require('request');
const userAgent = require("./user-agent");
const helper = require('./helper');

const FILENAME = "unicode.json";
const current = helper.readBiblio(FILENAME);

const MAX_REPORT = 100;
const skip = new Set([
    // Stabilized
    6, 16, 22, 26,

    // Old versions of Unicode
    4, 8, 27, 28,

    // Other superseded
    1, 2, 3, 5, 7, 13, 19, 21,

    // Withdrawn or suspended
    12, 20, 30, 32, 40, 47, 49, 52,

    // Nonexistent
    43, 48,

    // Not in HTML
    25, 54,
]);
const MAX_CONCURRENCY = 5;
const REFETCH_OLD_VERSIONS = false;

async.eachLimit(range(1, MAX_REPORT), MAX_CONCURRENCY, (num, cb) => {
    if (skip.has(num)) {
        console.log('Skipping report #' + num);
        cb();
        return;
    }

    recurseStandard(num, `https://www.unicode.org/reports/tr${num}/`, null, cb);
}, (err) => {
    if (err) {
        console.log('there was an error');
        console.error(err);
        return;
    }
    const output = {};
    for (const key of Object.keys(current).sort()) {
        output[key] = current[key];
    }
    helper.writeBiblio(FILENAME, output);
});

function recurseStandard(num, url, latestId, cb) {
    console.log('Fetching', url, '...');
    request({
        url,
        headers: {
            'User-Agent': userAgent()
        }
    }, (err, response, body) => {
        if (err || response.statusCode !== 200) {
            console.log("Can't fetch", url);
            cb();
            return;
        }
        console.log('Parsing', url, '...');
        const dom = new JSDOM(body, { url });
        const { document } = dom.window;

        const statusEl = document.querySelector('.body > h2');
        if (!statusEl) {
            console.log('Unable to find status');
            cb();
            return;
        }
        const status = trimText(statusEl.textContent);

        let type = document.title.match(/\b(UTS|UTR|UAX)/);
        if (type !== 'UTS' && type !== 'UTR' && type !== 'UAX') {
            // Fallback for https://www.unicode.org/reports/tr35/
            const lowerStatus = status.toLowerCase();
            if (lowerStatus.indexOf('technical standard') != -1) {
                type = 'UTS';
            } else if (lowerStatus.indexOf('standard annex') != -1) {
                type = 'UAX';
            } else if (lowerStatus.indexOf('technical report') != -1) {
                type = 'UTR';
            } else {
                console.log('Unable to parse document type');
                cb();
                return;
            }
        }
        const thisId = type + num;

        const titleEl = statusEl.nextElementSibling;
        if (!titleEl || titleEl.tagName !== 'H1') {
            console.log('Unable to find title');
            cb();
            return;
        }
        let title = trimText(titleEl.textContent);
        if (!/[a-z]/.test(title))
            title = titleCase(title);

        const infoTableEl = document.querySelector('.body > table');
        const infoTable = infoTableEl && parseTable(infoTableEl);
        if (!infoTable) {
            console.log('Unable to find information table');
            cb();
            return;
        }

        if (latestId == null) {
            // This is first scanned document, so the latest version.
            latestId = thisId;

            const authors = infoTable.Editor && parseEditor(infoTable.Editor);
            if (!authors) {
                console.log('Unable to find/parse editors in table');
                cb();
                return;
            }

            current[thisId] = {
                href: url,
                authors,
                etAl: authors.etAl,
                title,
                status,
                publisher: 'Unicode Consortium',
                versions: current[latestId]?.versions ?? {}
            };
        } else if (thisId != latestId) {
            // The document was renamed at some point - create link
            current[thisId] = { aliasOf: latestId };
        }

        const date = trimText(infoTable.Date);
        if (!date || !/\d{4}-\d{2}-\d{2}/.test(date)) {
            console.log('Unable to find date in table');
            cb();
            return;
        }

        const href = processURL(infoTable['This Version']);
        if (!href) {
            console.log('Failed to extract version URL');
            cb();
            return;
        }

        const revision = parseRevision(href);
        if (!revision) {
            console.log('Failed to extract revision');
            cb();
            return;
        }

        const version = parseVersion(infoTable.Version);

        if (version)
            title = `${title} version ${version}`;
        else
            title = `${title} revision ${revision}`;

        const wasAlreadyDefined = revision in current[latestId].versions;
        current[latestId].versions[revision] = {
            href,
            rawDate: date,
            title,
            status: current[latestId].status != status ? status : undefined,
        };

        /*
         * If this revision was already defined, then don't waste time and bandwidth fetching
         * previous revisions which should have no changes.
         *
         * We're running this check after updating the information for this version in case this
         * is the latest and is a WIP, as we have already downloaded it anyway.
         */
        if (!wasAlreadyDefined || REFETCH_OLD_VERSIONS) {
            const previousUrl = processURL(infoTable['Previous Version']);
            if (previousUrl) {
                recurseStandard(num, previousUrl, latestId, cb);
                return;
            }
        }
        cb();
    });
}

function* range(from, until) {
    for (let i = from; i <= until; i++)
        yield i;
}

function trimText(str) {
    if (!str)
        return str;
    str = str.replace(/®/g, '').trim();

    /*
     * Replace consecutive newlines (with any surrounding spaces) with a single newline.
     * Technically the first [\s--\n]* could be simply \s* but writing it this way avoids
     * heavy backtracking for long stretches of spaces.
     */
    str = str.replace(/[\s--\n]*\n\s*/gv, '\n');

    // Now replace all other spans of spaces, excluding new lines, with a single space
    str = str.replace(/[\s--\n]+/gv, ' ');

    return str;
}

function titleCase(str) {
    return str.replace(/(\w)(\S*)/g, (_, first, rest) => first.toUpperCase() + rest.toLowerCase());
}

function gatherText(element) {
    let str = '';
    for (const node of element.childNodes) {
        if (node.nodeType === node.ELEMENT_NODE && node.tagName === 'BR')
            str += '\n';
        else
            str += node.textContent;
    }
    return trimText(str);
}

function parseTable(tableEl) {
    const obj = {};
    for (const rowEl of tableEl.querySelectorAll('tr')) {
        if (rowEl.cells.length !== 2)
            return null;
        let key = trimText(rowEl.cells[0].textContent);
        if (key === 'Editors' || key === 'Author' || key === 'Authors')
            key = 'Editor';
        obj[key] = gatherText(rowEl.cells[1]);
    }
    return obj;
}

function processURL(str) {
    if (!str)
        return null;
    str = trimText(str);
    /*
     * Check for "Previous Version" in https://www.unicode.org/reports/tr38/tr38-5.html and
     * others, where it is "n/a".
     */
    if (str.substring(0, 4) != 'http')
        return null;
    return str.replace(/^http:/, 'https:');
}

function parseEditor(str) {
    const arr = str.split(/\n|,|\band\b/g).map(ed => trimText(ed.replace(/\(.*/, ''))).filter(Boolean);
    if (/\bother\b/.test(arr[arr.length - 1])) {
        arr.pop();
        arr.etAl = true;
    }
    return arr;
}

function parseRevision(url) {
    if (!url)
        return null;
    /*
     * Find a in the URL the pattern "/tr<num>/tr<num>-<revision>". This works for the two cases:
     *   - /tr<num>/tr<num>-<rev>/tr<num>.html (only UTS #35?)
     *   - /tr<num>/tr<num>-<rev>.html (all others)
     */
    const match = url.match(/\/(tr\d+)\/\1-(?<rev>\d+)/, url);
    return match ? match.groups.rev : null;
}

function parseVersion(str) {
    if (!str)
        return null;
    // Some have "Unicode 11.0.0" instead of the version alone. Strip it.
    return trimText(str).replace(/^Unicode\s*/, '');
}

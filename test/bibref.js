var assert = require('assert'),
    bibref = require('../lib/bibref');

suite('Test bibref api', function() {
    var obj = {
        FOO: {
            title: "FOO title",
            versions: {
                BAR: { title: "BAR title" },
                BAZ: {}
            }
        },
        foo: { aliasOf: "FOO" },
        bar: { aliasOf: "fOO" },
        hello: { title: "HELLO" },
        series: { aliasOf: "FOO", isSeriesAlias: true }
    };

    test('bibref constructor handles a single reference obj', function() {
        var obj = { foo: { title: "foo"} };
        assert.equal("foo", bibref.create(obj).get("foo").foo.title);
    });
    
    test('bibref constructor handles multiple reference objects', function() {
        var obj1 = { foo: { title: "foo"} };
        var obj2 = { bar: { title: "bar"} };
        var b = bibref.create(obj1, obj2);
        assert.equal("foo", b.get("foo").foo.title);
        assert.equal("bar", b.get("bar").bar.title);
    });
    
    test('bibref constructor throws when different reference objects share same identifiers', function() {
        var obj1 = { foo: { title: "foo"} };
        var obj2 = { foo: { title: "foo"} };
        assert.throws(function() {
            bibref.create(obj1, obj2);
        });
    });

    test('bibref.raw holds a similar object as the one passed to the constructor', function() {
        var obj = {foo: { title: "bar"}};
        assert.deepEqual(obj, bibref.create(obj).raw);
    });

    test('bibref.all points to a clone of the object passed to the constructor', function() {
        var obj = {FOO: { title: "foo" }};
        assert.ok(typeof bibref.create(obj).all == "object");
        assert.notStrictEqual(obj, bibref.create(obj).all);
        assert.notStrictEqual(obj.FOO, bibref.create(obj).all.FOO);
        assert.equal(obj.FOO.title, bibref.create(obj).all.FOO.title);
    });

    test('bibref.expandRefs expands references correctly', function() {
        var expanded = bibref.expandRefs(obj);
        assert.equal("FOO title", expanded.FOO.title);
        assert.equal("BAR title", expanded["FOO-BAR"].title);
        assert.equal("FOO title", expanded["FOO-BAZ"].title);
    });

    test('bibref.expandRefs does not create versions for series aliases', function() {
        var b = bibref.create(obj);
        assert.ok(!('FOO' in b.get("series-BAR")), "Cannot access a spec version from a series alias.");
    });

    test('bibref.cleanupRefs modifies the refs correctly', function() {
        var cleaned = bibref.cleanupRefs({
            foo: {
                versions: {},
                rawDate: "2012-1-1",
                deliveredBy: [ "http://www.w3.org/html/wg/" ],
                bar: 123
            }
        });
        var foo = cleaned.foo;
        assert.ok(typeof foo.versions == "object", "The versions property is an array of identifiers.");
        assert.ok(!('rawDate' in foo));
        assert.ok('date' in foo);
        assert.ok(!('bar' in foo));
        assert.ok(typeof foo.deliveredBy[0] == "object", "The deliveredBy property of ref is an array objects.");
        assert.ok('shortname' in foo.deliveredBy[0], "The deliveredBy property of ref has a shortname property.");
        assert.equal(foo.deliveredBy[0].shortname, 'html', "The url http://www.w3.org/html/wg/ gets properly turned into the html shortname.");
    });

    test('bibref.flattenVersions handles date versions properly', function() {
        var cleaned = bibref.flattenVersions({
            foo: {
                versions: {
                    '2024-04-05': {
                        href: 'http://example.com/2',
                        rawDate: '2024-04-05'
                    },
                    '2025-10-05': {
                        href: 'http://example.com/3',
                        rawDate: '2025-10-05'
                    },
                    '2004-12-11': {
                        href: 'http://example.com/1',
                        rawDate: '2004-12-11'
                    },
                    '2030-01-05': {
                        href: 'http://example.com/4',
                        rawDate: '2030-01-05'
                    }
                }
            }
        });
        var foo = cleaned.foo;
        assert.equal(typeof foo, 'object', '"foo" is an object');
        assert.equal(foo.rawDate, '2030-01-05', 'Raw date is that of the last version');
        assert.equal(foo.versions.length, 4, 'Versions array has 4 entries');
        assert.equal(foo.versions[0], "foo-2030-01-05", 'First element is the newest version');
        assert.equal(foo.versions[1], "foo-2025-10-05", 'Second element is the previous version');
        assert.equal(foo.versions[2], "foo-2024-04-05", 'Third element is the second previous version');
        assert.equal(foo.versions[3], "foo-2004-12-11", 'Last element is the oldest version');
    });

    test('bibref.flattenVersions handles semantic versions properly', function() {
        var cleaned = bibref.flattenVersions({
            foo: {
                versions: {
                    '2.1': {
                        href: 'http://example.com/2',
                        rawDate: '2004-04-05'
                    },
                    '11.3b': {
                        href: 'http://example.com/5',
                        rawDate: '2030-01-06'
                    },
                    '2': {
                        href: 'http://example.com/1',
                        rawDate: '2004-12-11'
                    },
                    '11.3': {
                        href: 'http://example.com/3',
                        rawDate: '2030-01-04'
                    },
                    '11.3a': {
                        href: 'http://example.com/4',
                        rawDate: '2030-01-05'
                    }
                }
            }
        });
        var foo = cleaned.foo;
        assert.equal(typeof foo, 'object', '"foo" is an object');
        assert.equal(foo.rawDate, '2030-01-06', 'Raw date is that of the last version');
        assert.equal(foo.versions.length, 5, 'Versions array has 5 entries');
        assert.equal(foo.versions[0], "foo-11.3b", 'First element is the newest version');
        assert.equal(foo.versions[1], "foo-11.3a", 'Second element is the previous version');
        assert.equal(foo.versions[2], "foo-11.3", 'Third element is the second previous version');
        assert.equal(foo.versions[3], "foo-2.1", 'Fourth element is an old version');
        assert.equal(foo.versions[4], "foo-2", 'Last element is an ancient version');
    });

    test('bibref.get returns the proper ref', function() {
        var b = bibref.create(obj);
        assert.equal("object", typeof b.get("FOO"), "Returns an object.");
        assert.ok('FOO' in b.get("FOO"), "Returns an object that contains a FOO prop.");
        assert.equal("object", typeof b.get("FOO").FOO, "Returns an object that has FOO prop which points to an object.");
        assert.equal("FOO title", b.get("FOO").FOO.title, "Returns an object that has FOO prop which points to an object that has the right title.");
    });

    test('bibref.get returns an empty object when it can\'t find the ref', function() {
        var b = bibref.create(obj);
        assert.equal("object", typeof b.get("DOES-NOT-EXIST"), "Returns an object.");
    });

    test('if passed an object bibref.get populates and returns it', function() {
        var b = bibref.create(obj);
        var output = {};
        assert.strictEqual(output, b.get("FOO", output), "Returns the object it gets passed as second arg.");
        var output = {};
        b.get("FOO", output)
        assert.equal("FOO title", output.FOO.title);
    });

    test('bibref.get treats aliases correctly', function() {
        var b = bibref.create(obj);
        assert.ok('FOO' in b.get("foo"), "Returns the aliased ref.");
        assert.ok('foo' in b.get("foo"), "Returns the ref itself.");
        assert.equal('FOO', b.get("foo").foo.aliasOf, "The ref has an aliasOf property which points to the alias.");
    });

    test('bibref.get exposes an id attribute', function() {
        var b = bibref.create(obj);
        assert.equal('foo', b.get("foo").foo.id);
    });

    test('bibref.get is case-insensitive', function() {
        var b = bibref.create(obj);
        assert.ok('hello' in b.get('hello'), 'Returns the ref itself.');

        assert.ok('HELLO' in b.get('HELLO'), 'Returns an alias if uppercase is used.');
        assert.ok('hello' in b.get('HeLLo'), 'Returns the ref itself if uppercase is used.');
        assert.equal('hello', b.get('HELLO').HELLO.aliasOf, 'The alias points to the ref itself if uppercase is used.');

        assert.ok('HeLLo' in b.get('HeLLo'), 'Returns an alias if different casing is used.');
        assert.ok('HELLO' in b.get('HeLLo'), 'Returns the uppercased alias if different casing is used.');
        assert.ok('hello' in b.get('HeLLo'), 'Returns the ref itself if different casing is used.');

        assert.equal('HELLO', b.get('HeLLo').HeLLo.aliasOf, 'The differently cased alias points to the uppercased alias.');
        assert.equal('hello', b.get('HeLLo').HELLO.aliasOf, 'The uppercased  alias points to ref itself.');
    });

    test('bibref.get handles aliases case-insensitively', function() {
        var b = bibref.create(obj);
        var r = b.get('bar');
        assert.ok('bar' in r, 'Returns the requested alias.');
        assert.ok('fOO' in r, 'Returns an alias created on the fly.');
        assert.ok('FOO' in r, 'Returns the ref itself.');
    });

    test('bibref.get also includes canonical reference of versioned specs', function() {
        var b = bibref.create({
            foo: {
                versions: {
                    "20000101": {}
                }
            }
        });
        var output = b.getRefs(["foo-20000101"]);
        assert('foo-20000101' in output, "Returns the requested ref.");
        assert('foo' in output, "Returns the canonical ref.");
        assert.equal('foo', output["foo-20000101"].versionOf, "Has a versionOf attribute.");
    });

    test('bibref.getRefs returns all required references', function() {
        var b = bibref.create(obj);
        var output = b.getRefs(["foo", "hello"]);
        assert.ok('FOO' in output, "Returns the aliased ref.");
        assert.ok('foo' in output, "Returns the ref itself.");
        assert.ok('hello' in output, "Returns another ref.");
    });
});

suite('Test bibref reverseLookup API', function() {
    test('properly handles http protocols', function() {
        var b = bibref.create({
            foo: { href: "http://example.com/foo" },
        });
        var url = "http://example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('properly handles https protocols', function() {
        var b = bibref.create({
            foo: { href: "https://example.com/foo" },
        });
        var url = "https://example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('still finds http specs when looking them up with an https protocol', function() {
        var b = bibref.create({
            foo: { href: "http://example.com/foo" },
        });
        var url = "https://example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('still finds https specs when looking them up with an http protocol', function() {
        var b = bibref.create({
            foo: { href: "https://example.com/foo" },
        });
        var url = "http://example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('correctly handles urls with a trailing slash', function() {
        var b = bibref.create({
            foo: { href: "http://example.com/foo/" },
        });
        var url = "http://example.com/foo/";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('adds a missing trailing slash when one is required', function() {
        var b = bibref.create({
            foo: { href: "http://example.com/foo/" },
        });
        var url = "http://example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('correctly handles urls without trailing slashes', function() {
        var b = bibref.create({
            foo: { href: "http://example.com/foo" },
        });
        var url = "http://example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('removes trailing slashes when required', function() {
        var b = bibref.create({
            foo: { href: "http://example.com/foo" },
        });
        var url = "http://example.com/foo/";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('finds specs with any kind of subdomain', function() {
        var b = bibref.create({
            foo: { href: "http://foo.specs.example.com" },
        });
        var url = "http://foo.specs.example.com";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('finds specs with a www subdomain', function() {
        var b = bibref.create({
            foo: { href: "http://www.example.com/foo" },
        });
        var url = "http://www.example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('finds specs without a www subdomain', function() {
        var b = bibref.create({
            foo: { href: "http://example.com/foo" },
        });
        var url = "http://example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('finds specs registered with a www subdomain without it', function() {
        var b = bibref.create({
            foo: { href: "http://www.example.com/foo" },
        });
        var url = "http://example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('finds specs registered without a www subdomain with it', function() {
        var b = bibref.create({
            foo: { href: "http://example.com/foo" },
        });
        var url = "http://www.example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('correctly handles missing protocols', function() {
        var b = bibref.create({
            foo: { href: "http://example.com/foo" },
        });
        var url = "example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('handles mixed-case references', function() {
        var b = bibref.create({
            foo: { href: "http://EXAMPLE.COM/FOO" },
        });
        var url = "http://example.com/foo";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('is case insensitive', function() {
        var b = bibref.create({
            foo: { href: "http://example.com/foo" },
        });
        var url = "http://ExamplE.coM/FOO";
        assert(url in  b.reverseLookup([url]));
    });
    
    test('handles multiple urls', function() {
        var b = bibref.create({
            foo: { href: "http://example.com/foo" },
            bar: { href: "http://example.com/bar" },
        });
        var foo = "example.com/foo";
        var bar = "example.com/bar";
        var output = b.reverseLookup([foo, bar]);
        assert.equal("foo", output[foo].id);
        assert.equal("bar", output[bar].id);
    });
    
    test('handles edDrafts', function() {
        var edDraft = "http://example.com/foo";
        var href = "http://example.com/bar";
        var b = bibref.create({
            foo: { edDraft: edDraft, href: href }
        });
        assert(href in b.reverseLookup([href]));
        assert(edDraft in b.reverseLookup([edDraft]));
    });
    
    test('handles versionOf', function() {
        var edDraft = "http://example.com/foo";
        var b = bibref.create({
            foo: { edDraft: edDraft, versionOf: "bar" },
            bar: { title: "Bar" }
        });
        var output = b.reverseLookup([edDraft]);
        assert(edDraft in output);
        assert.equal("Bar", output[edDraft].title);
    });

    test('returns the right ref even when url also exists as edDraft', function() {
        var foo = "http://example.com/foof";
        var bar = "http://example.com/barf";
        var b = bibref.create({
            foo: { title: "Foo", href: foo },
            fooEd: { title: "Foo ED", edDraft: foo },
            barEd: { title: "Bar ED", edDraft: bar },
            bar: { title: "Bar", href: bar }
        });
        var output = b.reverseLookup([foo, bar]);
        assert(foo in output);
        assert.equal("Foo", output[foo].title);
        assert(bar in output);
        assert.equal("Bar", output[bar].title);
    });
});

suite('Test bibref normalizeUrl API', function() {
    test('removes protocol', function() {
        assert.equal("example.com", bibref.normalizeUrl("http://example.com"));
        assert.equal("example.com", bibref.normalizeUrl("https://example.com"));
    });
    
    test('removes www. subdomains', function() {
        assert.equal("example.com", bibref.normalizeUrl("http://www.example.com"));
    });
    
    test('keeps hashes around', function() {
        assert.equal("example.com#foo", bibref.normalizeUrl("http://www.example.com#foo"));
    });
    
    test('removes trailing slashes', function() {
        assert.equal("example.com", bibref.normalizeUrl("http://www.example.com/"));
        assert.equal("example.com/foo", bibref.normalizeUrl("http://www.example.com/foo/"));
        assert.equal("example.com/foo/index.html", bibref.normalizeUrl("http://www.example.com/foo/index.html"));
    });
});

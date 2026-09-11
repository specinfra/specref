Specref API
===========

[Specref](http://www.specref.org/) is an open-source, community-maintained database of Web standards & related references.

## Table of Contents ##

* [API](#api)
  * [Get references](#get-a-set-of-bibliographic-references)
  * [Search references](#search-bibliographic-references)
  * [Reverse lookup](#reverse-lookup)
  * [Aliases](#aliases)
  * [Obsoleted references](#obsoleted-references)
  * [CORS](#cors)
  * [Examples](#examples)
* [Deployment](#deployment)
* [Contributing](#contributing)
* [Licenses](#licenses)

## API

The API to the service is very simple. It supports three operations which are: 

###  Get a set of bibliographic references
    
[`GET https://api.specref.org/bibrefs?refs=FileAPI,rfc2119`](https://api.specref.org/bibrefs?refs=FileAPI,rfc2119)

parameters:

    refs=comma-separated,list,of,reference,IDs
    callback=nameOfCallbackFunction

returns: a JSON object indexed by IDs

```json
{
    "FileAPI": {
        "authors": [
            "Arun Ranganathan",
            "Jonas Sicking"
        ],
        "date": "12 September 2013",
        "deliveredBy": [
            {
                "shortname": "webapps",
                "url": "http://www.w3.org/2008/webapps/"
            }
        ],
        "edDraft": "http://dev.w3.org/2006/webapi/FileAPI/",
        "href": "http://www.w3.org/TR/FileAPI/",
        "id": "FileAPI",
        "publisher": "W3C",
        "status": "LCWD",
        "title": "File API"
    },
    "rfc2119": {
        "authors": [
            "S. Bradner"
        ],
        "date": "March 1997",
        "href": "http://www.ietf.org/rfc/rfc2119.txt",
        "id": "rfc2119",
        "publisher": "IETF",
        "status": "Best Current Practice",
        "title": "Key words for use in RFCs to Indicate Requirement Levels"
    }
}
```
    
### Search bibliographic references

[`GET https://api.specref.org/search-refs?q=coffee`](https://api.specref.org/search-refs?q=coffee)
    
parameters:

    q=search%20term
    callback=nameOfCallbackFunction

returns: a JSON object indexed by IDs

```json
{
    "rfc2324": {
        "authors": [
            "L. Masinter"
        ],
        "date": "1 April 1998",
        "href": "http://www.ietf.org/rfc/rfc2324.txt",
        "id": "rfc2324",
        "publisher": "IETF",
        "status": "Informational",
        "title": "Hyper Text Coffee Pot Control Protocol (HTCPCP/1.0)"
    },
    "rfc7168": {
        "authors": [
            "I. Nazar"
        ],
        "date": "1 April 2014",
        "href": "http://www.ietf.org/rfc/rfc7168.txt",
        "id": "rfc7168",
        "publisher": "IETF",
        "status": "Informational",
        "title": "The Hyper Text Coffee Pot Control Protocol for Tea Efflux Appliances (HTCPCP-TEA)"
    }
}
```

Used to get a set of bibliographic references that include the search term in any of their attributes. This is useful to find specs related to a given area of study, specs by a given editor, etc.
    
### Reverse lookup

[`GET https://api.specref.org/reverse-lookup?urls=http://www.w3.org/TR/2012/WD-FileAPI-20121025/`](https://api.specref.org/reverse-lookup?urls=http://www.w3.org/TR/2012/WD-FileAPI-20121025/)

parameters:

    urls=comma-separated,list,of,reference,URLs.
    callback=nameOfCallbackFunction

returns: a JSON object indexed by URLs

```json
{
    "http://www.w3.org/TR/2012/WD-FileAPI-20121025/": {
        "authors": [
            "Arun Ranganathan",
            "Jonas Sicking"
        ],
        "date": "12 September 2013",
        "deliveredBy": [
            {
                "shortname": "webapps",
                "url": "http://www.w3.org/2008/webapps/"
            }
        ],
        "edDraft": "http://dev.w3.org/2006/webapi/FileAPI/",
        "href": "http://www.w3.org/TR/FileAPI/",
        "id": "FileAPI",
        "publisher": "W3C",
        "status": "LCWD",
        "title": "File API"
    }
}
```

Notice this finds you the canonical version of a spec and not the precise version the URL points to.
This is by design.

### Aliases

Because of legacy references, case sensitivity issues and taste, many entries have multiple identifiers. Thus an aliasing system was put in place. It isn't _that_ complicated really: an identifier either points directly to the reference object or to another identifier (through the `aliasOf` property), recursively. All aliases are resolved (there are tests for that) and when you query the API for a reference you always get all the objects necessary to resolve it in the same response. So for example, https://api.specref.org/bibrefs?refs=rfc7230 responds with:

```json
{
    "rfc7230": {
        "authors": [
            "R. Fielding, Ed.",
            "J. Reschke, Ed."
        ],
        "date": "June 2014",
        "href": "https://tools.ietf.org/html/rfc7230",
        "id": "rfc7230",
        "publisher": "IETF",
        "status": "Proposed Standard",
        "title": "Hypertext Transfer Protocol (HTTP/1.1): Message Syntax and Routing"
    }
}
```

while https://api.specref.org/bibrefs?refs=HTTP11 gives you:

```json
{
    "HTTP11": {
        "aliasOf": "RFC7230",
        "id": "HTTP11"
    },
    "RFC7230": {
        "aliasOf": "rfc7230",
        "id": "RFC7230"
    },
    "rfc7230": {
        "authors": [
            "R. Fielding, Ed.",
            "J. Reschke, Ed."
        ],
        "date": "June 2014",
        "href": "https://tools.ietf.org/html/rfc7230",
        "id": "rfc7230",
        "publisher": "IETF",
        "status": "Proposed Standard",
        "title": "Hypertext Transfer Protocol (HTTP/1.1): Message Syntax and Routing"
    }
}
```

Which let's you get to the data by using a simple `while` loop over the response. The contract guaranteed by the API is to always let you resolve aliases.

Now whether you decide to display the result as `[HTTP1]`, `[rfc7230]`, `[RFC7230]`, or even `[1]` is up to you. Of course, it's silly to reference both `[HTTP1]` and `[rfc7230]` in the same specification, but that's something for the editors and/or their tools to avoid.

### Obsoleted references

Some entries have an `obsoletedBy` property which contains an array of identifiers.
These identifiers reference specifications that replace this one and can be queried separately from the database.

Like aliases, these identifiers are resolved (there are tests for that), but, unlike aliases, they are not returned with the response to the initial query.

Note that these identifiers can themselves point to aliases or have their own `obsoletedBy` property, recursively.

### CORS

**CORS is enabled for all origins.** By default the service returns JSON data, which is great but not convenient for browsers that do not support CORS yet. For those, simply adding the `callback` parameter with the name of the callback function you want will switch the response to JSON-P.

### Examples

Some examples should help: 

    // get references for SVG, REX, and DAHUT
    GET https://api.specref.org/bibrefs?refs=SVG,REX,DAHUT
    
    // the same as JSON-P
    GET https://api.specref.org/bibrefs?refs=SVG,REX,DAHUT&callback=yourFunctionName

If you need to find a reference ID (for either bibliographic or cross-references) you need to look for it on [specref.org](http://specref.org).

## Deployment

The website (www.specref.org) is hosted on GitHub Pages and the API (api.specref.org) on Clever Cloud. See [DEPLOYMENT.md](./DEPLOYMENT.md) for how both are deployed and how the `specref.org` DNS is set up.

## Contributing

Specref is community-maintained and welcomes contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed information on how to contribute to the reference database.

## Licenses

* Specref Reference Database (all files in [refs/](./refs/)): <span xmlns:cc="http://creativecommons.org/ns#" xmlns:dct="http://purl.org/dc/terms/" about="http://www.specref.org/"><a rel="license" href="http://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0 Universal</a></span>
* Code (all other files): [Apache License Version 2.0](./LICENSE)

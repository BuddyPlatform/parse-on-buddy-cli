# Parse on Buddy Cloud Code/Web Hosting Command Line Tool

[![Build Status](https://api.travis-ci.org/BuddyPlatform/parse-on-buddy-cli.svg)](https://travis-ci.org/BuddyPlatform/parse-on-buddy-cli) [![NPM](https://img.shields.io/npm/v/parse-on-buddy.svg)](https://www.npmjs.com/package/parse-on-buddy)

This tool allows you to upload your Parse cloud code and static files for hosting to the Parse on Buddy service. It also allows you to manage different versions of cloud code/static files.

## Prerequisites

This tool depends on NPM, the Node Package Manager distributed with [Node.js](https://nodejs.org). Node.js/NPM installation instructions are [here](https://docs.npmjs.com/getting-started/installing-node).

The tool depends on the following environment variables. Please set them appropriately in your environment before using the tool:

- `BUDDY_PARSE_APP_ID`
- `BUDDY_PARSE_MASTER_KEY`

## Installation

Open a command shell, and type `npm install -g parse-on-buddy`.

## Overview

### Directory Structure

Cloud code needs to live in a single .js file named `main.js`, and it needs to be in a directory named `cloud`. Static files need to be in a sibling directory named `public`. Here is the required directory structure:

```
.
+-- cloud
|   +-- main.js
+-- public
|   +-- sample.txt
|   +-- etc.
```

The `public` directory is required even if you have no static files to upload; it can remain empty.

You invoke the tool from the root of the directory structure, that is the parent directory of `cloud` and `public`.

### Versions

A combined set of cloud code and static files is called a version. Using the tool you upload each version to Parse on Buddy. The latest version becomes active. You can also activate older versions using the tool.

### JavaScript Dependencies

As with the old Parse.com service, you can only upload a single .js file, named `main.js`. Any dependencies need to be manually copy/pasted into that .js file. We are working to lift that limitation.

### Web Hosting

All the files in the `public` directory are publicly available at the URLs that are of the following format: `https://parse.buddy.com/public/{app ID}/{directory structure}/{file}`. Using the above directory structure example, and a sample app ID of 98d29ee6-0b40-4296-9665-10d36b9ae0ad, the resulting URL would be `https://parse.buddy.com/public/98d29ee6-0b40-4296-9665-10d36b9ae0ad/sample.txt`.


### Caveats

There are some incompatibilities with the old Parse.com cloud code service. They are detailed [here](https://github.com/ParsePlatform/Parse-Server/wiki/Compatibility-with-Hosted-Parse#Cloud-Code).

## Use

For help, run without arguments:

```
$ parse-on-buddy

Options

  -h, --help
  -g, --generate
  -V, --version
  -l, --listVersions
  -c, --createVersion number
  -a, --activateVersion number
  -v, --currentVersion
```

Here is an example walkthrough:

```
$ mkdir ExampleParseApp

$ cd ExampleParseApp

$ parse-on-buddy --generate
Generating template public and cloud directories...

$ ls -l cloud public
cloud:
total 8
-rw-r--r--  1 parse  staff  89 10 Nov 15:49 main.js

public:
total 8
-rw-r--r--  1 parse  staff  12 10 Nov 15:49 hello.txt

$ cat cloud/main.js
Parse.Cloud.define("hello", function(request, response) { response.success("world"); });

# In a new app, there is only v1, a starter version with example content.
$ parse-on-buddy -l
Listing application versions...
1

$ curl -X POST --header x-parse-application-id:<app-id> https://parse.buddy.com/parse/functions/hello
{ "result": "world" }

$ curl https://parse.buddy.com/public/<app-id>/hello.txt
hello world
```

Let's change `main.js` to do something different.

```
$ cat > cloud/main.js
Parse.Cloud.define("something", function(request, response) { response.success("different"); });

$ parse-on-buddy -c 2
Listing application versions...
Walking local public directory subtree...
Listing existing hash blobs...
1 public assets already synchronized!
Uploading cloud code...
Uploading name → hash mapping...
Setting active version...
All done!

$ parse-on-buddy -l
Listing application versions...
1 2

$ parse-on-buddy -v
Fetching current version...
2

$ curl -X POST --header x-parse-application-id:<app-id> https://parse.buddy.com/parse/functions/something
{ "result": "different" }
```

Finally, let's revert to the initial version.

```
$ parse-on-buddy -a 1
Listing application versions...
Setting active version...

$ curl -X POST --header x-parse-application-id:<app-id> https://parse.buddy.com/parse/functions/hello
{ "result": "world" }
```

## FAQ

Q. Why do I need a public directory, even if I'm not using web hosting?

A. Due to legacy reasons, an empty `public` directory is necessary.

Q. On MacOS I am getting errors after uploading my cloud code.

A. MacOS creates invisible files named `.DS_Store` when folders are opened in the Finder. These files must be deleted from the directory structure.

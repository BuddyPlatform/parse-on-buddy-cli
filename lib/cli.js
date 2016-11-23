'use strict' // eslint-disable-line

const fs = require('fs');
const crypto = require('crypto');
const url = require('url');
const util = require('util');
const walk = require('walk');
const zip = require('archiver');
const concat = require('concat-stream');
const async = require('async');
const mime = require('mime-types');
const readChunk = require('read-chunk');
const fileType = require('file-type');
const validator = require('validator');
const _ = require('lodash');
const azure = require('azure-storage');
const request = require('request');

const aux = process.env.BUDDY_PARSE_AUX_URL || 'https://parse.buddy.com/';

function parseHeaders(appID, secret) {
  return {
    'x-parse-application-id': appID,
    'x-parse-master-key': secret,
  };
}

function generateTemplate() {
  if (fs.existsSync('cloud') || fs.existsSync('public')) {
    console.log('For safety reasons, I won\'t generate templates in existing cloud & public directories.');
    return;
  }

  console.log('Generating template public and cloud directories...');

  fs.mkdirSync('public');
  fs.writeFileSync('public/hello.txt', 'hello world\n');

  fs.mkdirSync('cloud');
  fs.writeFileSync('cloud/main.js', 'Parse.Cloud.define("hello", function(request, response) { response.success("world"); });\n');
}

function listBlobs(service, container, listing, continuationToken, callback) {
  service.listBlobsSegmented(container, continuationToken, null, (error, result) => {
    if (error) {
      callback(error);
    } else {
      _.forEach(result.entries, (item) => {
        listing.push(item.name);
      });

      if (result.continuationToken !== null) {
        listBlobs(service, container, listing, result.continuationToken, callback);
      } else {
        callback(null, listing);
      }
    }
  });
}

function list(appID, secret, callback) {
  console.log('Listing existing hash blobs...');

  const listing = [];

  request.get(`${aux}hosting`, {
    json: true,
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
  }, (error, response, body) => {
    if (error !== null) {
      callback(error);
    } else {
      const service = azure.createBlobServiceWithSas(`https://${url.parse(body.uri).host}`, body.token);

      listBlobs(service, `${appID}-public`, listing, null, callback);
    }
  });
}

function getCurrentVersion(appID, secret, callback) {
  console.log('Fetching current version...');

  request.get(`${aux}app/current`, {
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
  }, callback);
}

function uploadFile(appID, secret, hash, filename, callback) {
  request.post(`${aux}hosting/${hash}`, {
    json: true,
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
  }, (error, response, body) => {
    if (error !== null) {
      callback(error);
    } else {
      let options = {};
      const mimeLookup = mime.lookup(filename);
      if (mimeLookup !== false) {
        options = {
          contentSettings: {
            contentType: mimeLookup,
          },
        };
      } else {
        const buffer = readChunk.sync(filename, 0, 1024);
        const type = fileType(buffer);

        if (type !== null) {
          options = {
            contentSettings: {
              contentType: type.mime,
            },
          };
        } else if (validator.isAscii(buffer.toString())) {
          options = {
            contentSettings: {
              contentType: 'text/plain',
            },
          };
        }
      }

      const service = azure.createBlobServiceWithSas(`https://${url.parse(body.uri).host}`, body.token);

      service.createBlockBlobFromLocalFile(`${appID}-public`, hash, filename, options, callback);
    }
  });
}

function uploadMapping(appID, secret, version, mapping, callback) {
  console.log('Uploading name → hash mapping...');

  const stripPrefix = new RegExp('^public/');

  const adjustedMapping = _.mapKeys(mapping, (value, key) => key.replace(stripPrefix, ''));

  request.post(`${aux}app/map/${version}`, {
    json: true,
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
    body: adjustedMapping,
  }, callback);
}

function setVersion(appID, secret, version, callback) {
  console.log('Setting active version...');

  request.post(`${aux}app/current`, {
    json: true,
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
    body: {
      version,
    },
  }, callback);
}

function uploadCloudCode(appID, secret, version, callback) {
  console.log('Uploading cloud code...');

  const zipFile = zip.create('zip', {});

  zipFile.on('error', (error) => {
    callback(error);
  });

  zipFile.pipe(request.post(`${aux}app/cloudcode/${version}.zip`, {
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
  }, callback));

  zipFile.directory('cloud', '/');
  zipFile.finalize();
}

function hashWalk(directory, callback) {
  console.log('Walking local public directory subtree...');

  const hashes = {};

  const walker = walk.walk(directory);

  walker.on('file', (root, stats, next) => {
    const fullName = `${root}/${stats.name}`;

    const hash = crypto.createHash('sha256');
    hash.setEncoding('hex');

    const input = fs.createReadStream(fullName);
    const output = concat((data) => {
      hashes[fullName] = data;
    });

    input.pipe(hash).pipe(output);

    next();
  });

  walker.on('end', () => {
    callback(null, hashes);
  });
}

function uploadMissing(appID, secret, local, remote, callback) {
  const invertedHashes = _.invert(local);
  const missing = _.difference(_.keys(invertedHashes), remote);

  const localCount = _.keys(local).length;

  if (missing.length > 0) {
    console.log(util.format('Uploading %d (of %d) public asset(s)...', missing.length, localCount));
  } else {
    console.log(util.format('%d public assets already synchronized!', localCount));
    callback();
    return;
  }

  const filenames = [];
  _.forEach(missing, (hash) => {
    filenames.push(invertedHashes[hash]);
  });

  async.eachLimit(filenames, 16, (filename) => {
    uploadFile(appID, secret, local[filename], filename, callback);
  }, callback);
}

function bail(error) {
  if (error !== null) {
    console.error(error);
  }
  process.exitCode = 1;
}

function createVersionExecute(appID, secret, version, local, remote) {
  async.parallel({
    sync(callback) {
      uploadMissing(appID, secret, local, remote, callback);
    },
    cloudCode(callback) {
      uploadCloudCode(appID, secret, version, callback);
    },
    mapping(callback) {
      uploadMapping(appID, secret, version, local, callback);
    },
  }, (error) => {
    if (error !== null) {
      bail(error);
    } else {
      setVersion(appID, secret, version, (versionError) => {
        if (versionError !== null) {
          bail(versionError);
        } else {
          console.log('All done!');
        }
      });
    }
  });
}

function createVersion(appID, secret, version) {
  async.parallel({
    local(callback) {
      hashWalk('public', callback);
    },
    remote(callback) {
      list(appID, secret, callback);
    },
  }, (error, results) => {
    if (error !== null) {
      bail(error);
    } else {
      createVersionExecute(appID, secret, version, results.local, results.remote);
    }
  });
}

function listVersions(appID, secret, callback) {
  console.log('Listing application versions...');

  request.get(`${aux}app/versions`, {
    json: true,
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
  }, callback);
}

function printStatus(selection) {
  return (error, response) => {
    if (error !== null) {
      console.log(error);
    } else if ((response.statusCode >= 200) && (response.statusCode < 300)) {
      if (selection) {
        console.log(selection(response));
      }
    } else {
      console.log('HTTP error:', response.statusCode, response.statusMessage);
    }
  };
}

module.exports = {
  generateTemplate,
  listVersions,
  printStatus,
  getCurrentVersion,
  setVersion,
  createVersion,
};

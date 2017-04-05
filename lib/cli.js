'use strict' // eslint-disable-line

const Promise = require('bluebird');

const fs = require('fs');
const crypto = require('crypto');
const url = require('url');
const util = require('util');
const walk = require('walk');
const zip = require('archiver');
const concat = require('concat-stream');
const mime = require('mime-types');
const readChunk = require('read-chunk');
const fileType = require('file-type');
const validator = require('validator');
const _ = require('lodash');
const azure = require('azure-storage');
const request = require('request');

// Promisify libraries
Promise.promisifyAll(azure);

const aux = process.env.BUDDY_PARSE_AUX_URL || 'https://parse.buddy.com/';

let userAgent;

function setUserAgent(text) {
  userAgent = text;
}

function parseHeaders(appID, secret) {
  return {
    'user-agent': userAgent,
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

function listBlobs(service, container, listing, continuationToken) {
  return service.listBlobsSegmentedAsync(container, continuationToken, null).then((result) => {
    _.forEach(result.entries, (item) => {
      listing.push(item.name);
    });

    if (result.continuationToken !== null) {
      return listBlobs(service, container, listing, result.continuationToken);
    }

    return listing;
  });
}

function list(appID, secret) {
  console.log('Listing existing hash blobs...');

  const listing = [];

  return request.getAsync(`${aux}hosting`, {
    json: true,
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
  }).spread((response, body) => {
    const service = azure.createBlobServiceWithSas(`https://${url.parse(body.uri).host}`, body.token);

    return listBlobs(service, `${appID}-public`, listing, null);
  });
}

function getCurrentVersion(appID, secret) {
  console.log('Fetching current version...');

  return request.getAsync(`${aux}app/current`, {
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
  });
}

function uploadFile(appID, secret, hash, filename) {
  return request.postAsync(`${aux}hosting/${hash}`, {
    json: true,
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
  }).spread((response, body) => {
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

    return service.createBlockBlobFromLocalFileAsync(`${appID}-public`, hash, filename, options);
  });
}

function uploadMapping(appID, secret, version, mapping) {
  console.log('Uploading name → hash mapping...');

  const stripPrefix = new RegExp('^public/');

  const adjustedMapping = _.mapKeys(mapping, (value, key) => key.replace(stripPrefix, ''));

  return request.postAsync(`${aux}app/map/${version}`, {
    json: true,
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
    body: adjustedMapping,
  });
}

function setVersion(appID, secret, version) {
  console.log('Setting active version...');

  return request.postAsync(`${aux}app/current`, {
    json: true,
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
    body: {
      version,
    },
  });
}

function uploadCloudCode(appID, secret, version) {
  return new Promise((resolve, reject) => {
    console.log('Uploading cloud code...');

    const zipFile = zip.create('zip', {});

    zipFile.on('error', (error) => {
      reject(error);
    });

    zipFile.pipe(request.post(`${aux}app/cloudcode/${version}.zip`, {
      headers: parseHeaders(appID, secret),
      auth: {
        user: appID,
        password: secret,
      },
    }, (error, response, body) => {
      // This isn't Promisey, but request.postAsync doesn't work with pipes.
      // I think this is the best solution, but suggestions for improvement
      // are requested!
      if (error != null) {
        reject(error);
      } else if (response.statusCode === 400) {
        reject(body.trim());
      } else if (response.statusCode !== 204) {
        reject(`Cloudcode upload failure: HTTP ${response.statusCode}`);
      } else {
        resolve();
      }
    }));

    zipFile.directory('cloud', '/');
    zipFile.finalize();
  });
}

function hashWalk(directory) {
  return new Promise((resolve, reject) => {
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

    // eslint-disable-next-line no-unused-vars
    walker.on('errors', (root, stats, next) => {
      reject(stats.error);
    });

    walker.on('end', () => {
      resolve(hashes);
    });
  });
}

function uploadMissing(appID, secret, local, remote) {
  const invertedHashes = _.invert(local);
  const missing = _.difference(_.keys(invertedHashes), remote);

  const localCount = _.keys(local).length;

  if (missing.length > 0) {
    console.log(util.format('Uploading %d (of %d) public asset(s)...', missing.length, localCount));
  } else {
    console.log(util.format('%d public assets already synchronized!', localCount));
    return Promise.resolve();
  }

  const filenames = [];
  _.forEach(missing, (hash) => {
    filenames.push(invertedHashes[hash]);
  });

  return Promise.map(
    filenames,
    filename => uploadFile(appID, secret, local[filename], filename),
    { concurrency: 4 });
}

function createVersionExecute(appID, secret, version, local, remote) {
  return Promise.join(
    uploadMissing(appID, secret, local, remote),
    uploadCloudCode(appID, secret, version),
    uploadMapping(appID, secret, version, local),
    () => setVersion(appID, secret, version))
  .then(() => console.log('All done!'));
}

function createVersion(appID, secret, version) {
  return Promise.join(
    hashWalk('public'),
    list(appID, secret),
    (local, remote) => createVersionExecute(appID, secret, version, local, remote));
}

function listVersions(appID, secret) {
  console.log('Listing application versions...');

  return request.getAsync(`${aux}app/versions`, {
    json: true,
    headers: parseHeaders(appID, secret),
    auth: {
      user: appID,
      password: secret,
    },
  });
}

module.exports = {
  setUserAgent,
  generateTemplate,
  listVersions,
  getCurrentVersion,
  setVersion,
  createVersion,
};

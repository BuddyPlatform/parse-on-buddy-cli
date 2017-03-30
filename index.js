#!/usr/bin/env node

require('pkginfo')(module); // for module.*

const fs = require('fs');
const commandLineArgs = require('command-line-args');
const _ = require('lodash');
const Promise = require('bluebird');
const latestVersion = require('latest-version');
const request = require('request');
const semver = require('semver');

const cli = require('./lib/cli');

// Promisify libraries
Promise.promisifyAll(request, { multiArgs: true });

function minimumVersionCheck() {
  return request.getAsync('https://parseonbuddy.blob.core.windows.net/cli/minimum.txt').spread((response, body) => {
    if (response.statusCode != 200) {
      return Promise.reject(`Error: unable to fetch minimum CLI version (HTTP ${response.statusCode}). Contact Buddy Support.`);
    }

    const minVersion = semver.parse(body.trim());
    if (!minVersion) {
      return Promise.reject(`Error: cannot parse minimum version "${body.trim()}". Contact Buddy Support.`);
    }

    const newEnough = semver.gte(module.exports.version, minVersion);
    if (!newEnough) {
      return Promise.reject(`Error: CLI version ${module.exports.version} is too old. Please upgrade: https://www.npmjs.com/package/parse-on-buddy`);
    }

    return Promise.resolve();
  });
}

function updateCheck() {
  return latestVersion('parse-on-buddy').then((version) => {
    if (semver.gt(version, module.exports.version)) {
      console.warn(`Update: a newer parse-on-buddy version is available (${version} > ${module.exports.version}): https://www.npmjs.com/package/parse-on-buddy`);
    }

    return Promise.resolve();
  }).catch(() => {
    console.warn('Warning: unable to check the latest parse-on-buddy version.');

    return Promise.resolve(); // It's not the end of the world.
  });
}

function main() {
  const commandLine = commandLineArgs([{
    name: 'help',
    alias: 'h',
    type: Boolean,
  }, {
    name: 'generate',
    alias: 'g',
    type: Boolean,
  }, {
    name: 'version',
    alias: 'V',
    type: Boolean,
  }, {
    name: 'listVersions',
    alias: 'l',
    type: Boolean,
  }, {
    name: 'createVersion',
    alias: 'c',
    type: Number,
    multiple: false,
  }, {
    name: 'activateVersion',
    alias: 'a',
    type: Number,
    multiple: false,
  }, {
    name: 'currentVersion',
    alias: 'v',
    type: Boolean,
  }]);

  const options = commandLine.parse();

  if ('help' in options) {
    console.log(commandLine.getUsage());
    return Promise.resolve();
  }

  if (_.keys(options).length === 0) {
    return Promise.reject(commandLine.getUsage());
  }

  if ('generate' in options) {
    cli.generateTemplate();
    return Promise.resolve();
  }

  if (!('version' in options) && (!(('BUDDY_PARSE_APP_ID' in process.env) && ('BUDDY_PARSE_MASTER_KEY' in process.env)))) {
    return Promise.reject('Required environment variables: BUDDY_PARSE_APP_ID, BUDDY_PARSE_MASTER_KEY');
  }

  const requirements = [
    fs.existsSync('cloud') && fs.statSync('cloud').isDirectory(),
    fs.existsSync('public') && fs.statSync('public').isDirectory(),
    fs.existsSync('cloud/main.js') && fs.statSync('cloud/main.js').isFile(),
  ];

  if (_.includes(requirements, false) && ('createVersion' in options)) {
    return Promise.reject('Required directories: cloud, public\nThe cloud directory must contain a main.js cloud code file.');
  }

  const config = {
    appID: process.env.BUDDY_PARSE_APP_ID,
    secret: process.env.BUDDY_PARSE_MASTER_KEY,
  };

  if ('version' in options) {
    console.log(`${module.exports.description} ${module.exports.version}`);
    return Promise.resolve();
  } else if ('listVersions' in options) {
    return cli.listVersions(config.appID, config.secret).spread((response, body) => {
      if (response.statusCode !== 200) {
        return Promise.reject(`Error: cannot list versions (HTTP ${response.statusCode}).`);
      }

      console.log(body.versions.sort((a, b) => a - b).join(' '));

      return Promise.resolve();
    });
  } else if ('createVersion' in options) {
    if (options.createVersion === null) {
      return Promise.reject('Error: version required.');
    }

    return cli.listVersions(config.appID, config.secret).spread((response) => {
      if (_.includes(response.body.versions, options.createVersion)) {
        return Promise.reject('Error: version already exists.');
      }

      return cli.createVersion(config.appID, config.secret, options.createVersion);
    });
  } else if ('currentVersion' in options) {
    return cli.getCurrentVersion(config.appID, config.secret).spread((response, body) => {
      if (response.statusCode !== 200) {
        return Promise.reject(`Error: cannot get current version (HTTP ${response.statusCode}).`);
      }

      console.log(body);

      return Promise.resolve();
    });
  } else if ('activateVersion' in options) {
    if (options.activateVersion === null) {
      return Promise.reject('Error: version required.');
    }

    return cli.listVersions(config.appID, config.secret).spread((response) => {
      if (!_.includes(response.body.versions, options.activateVersion)) {
        return Promise.reject('Error: version does not exist.');
      }

      return cli.setVersion(config.appID, config.secret, options.activateVersion).spread((response, body) => {
        if (response.statusCode !== 204) {
          return Promise.reject(`Error: cannot set current version (HTTP ${response.statusCode}).`);
        }

        console.log('Done.');

        return Promise.resolve();
      });
    });
  } else {
    return Promise.reject('No valid instruction given; exiting.');
  }

  return Promise.reject('Developer error: option statement fall-through. ' +
                        'A promise should be returned from main() before ' +
                        'this point.');
}

minimumVersionCheck().then(() => updateCheck()).then(() => main()).catch((error) => {
  if (error !== null) {
    console.error(error);
  }
  process.exitCode = 1;
});

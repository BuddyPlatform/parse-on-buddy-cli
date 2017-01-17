#!/usr/bin/env node

require('pkginfo')(module); // for module.*

const fs = require('fs');
const commandLineArgs = require('command-line-args');
const _ = require('lodash');
const Promise = require('bluebird');

const cli = require('./lib/cli');

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
    return Promise.accept();
  }

  if (_.keys(options).length === 0) {
    return Promise.reject(commandLine.getUsage());
  }

  if ('generate' in options) {
    cli.generateTemplate();
    return Promise.accept();
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
  } else if ('listVersions' in options) {
    return cli.listVersions(config.appID, config.secret).spread(cli.printStatus(r => r.body.versions.sort((a, b) => a - b).join(' ')));
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
    return cli.getCurrentVersion(config.appID, config.secret).spread(cli.printStatus(r => r.body));
  } else if ('activateVersion' in options) {
    if (options.activateVersion === null) {
      return Promise.reject('Error: version required.');
    }

    cli.listVersions(config.appID, config.secret).spread((response) => {

      if (!_.includes(response.body.versions, options.activateVersion)) {
        return Promise.reject('Error: version does not exist.');
      }

      // eslint-disable-next-line no-unused-vars
      return cli.setVersion(config.appID, config.secret, options.activateVersion).then(cli.printStatus());
    });
  } else {
    return Promise.reject('No valid instruction given; exiting.');
  }
}

main().catch((error) => {
  if (error !== null) {
    console.error(error);
  }
  process.exitCode = 1;
});

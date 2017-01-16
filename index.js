#!/usr/bin/env node

require('pkginfo')(module); // for module.*

const fs = require('fs');
const commandLineArgs = require('command-line-args');
const _ = require('lodash');

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
    return;
  }

  if (_.keys(options).length === 0) {
    console.log(commandLine.getUsage());
    process.exitCode = 1;
    return;
  }

  if ('generate' in options) {
    cli.generateTemplate();
    return;
  }

  if (!('version' in options) && (!(('BUDDY_PARSE_APP_ID' in process.env) && ('BUDDY_PARSE_MASTER_KEY' in process.env)))) {
    console.log('Required environment variables: BUDDY_PARSE_APP_ID, BUDDY_PARSE_MASTER_KEY');
    process.exitCode = 1;
    return;
  }

  const requirements = [
    fs.existsSync('cloud') && fs.statSync('cloud').isDirectory(),
    fs.existsSync('public') && fs.statSync('public').isDirectory(),
    fs.existsSync('cloud/main.js') && fs.statSync('cloud/main.js').isFile(),
  ];

  if (_.includes(requirements, false) && ('createVersion' in options)) {
    console.log('Required directories: cloud, public');
    console.log('The cloud directory must contain a main.js cloud code file.');
    process.exitCode = 1;
    return;
  }

  const config = {
    appID: process.env.BUDDY_PARSE_APP_ID,
    secret: process.env.BUDDY_PARSE_MASTER_KEY,
  };

  if ('version' in options) {
    console.log(`${module.exports.description} ${module.exports.version}`);
  } else if ('listVersions' in options) {
    cli.listVersions(config.appID, config.secret, cli.printStatus(r => r.body.versions.sort((a, b) => a - b).join(' ')));
  } else if ('createVersion' in options) {
    if (options.createVersion === null) {
      console.log('Error: version required.');
      process.exitCode = 1;
      return;
    }

    cli.listVersions(config.appID, config.secret, (error, response) => {
      if (error) {
        cli.bail(error);
        return;
      }

      if (_.includes(response.body.versions, options.createVersion)) {
        console.log('Error: version already exists.');
        return;
      }

      cli.createVersion(config.appID, config.secret, options.createVersion, (error) => {
        if (error) {
          cli.bail(error);
        }
      });
    });
  } else if ('currentVersion' in options) {
    cli.getCurrentVersion(config.appID, config.secret, cli.printStatus(r => r.body));
  } else if ('activateVersion' in options) {
    if (options.activateVersion === null) {
      console.log('Error: version required.');
      process.exitCode = 1;
      return;
    }

    cli.listVersions(config.appID, config.secret, (error, response) => {
      if (error) {
        cli.bail(error);
        return;
      }

      if (!_.includes(response.body.versions, options.activateVersion)) {
        console.log('Error: version does not exist.');
        return;
      }

      // eslint-disable-next-line no-unused-vars
      cli.setVersion(config.appID, config.secret, options.activateVersion, cli.printStatus());
    });
  } else {
    console.log('No valid instruction given; exiting.');
  }
}

main();

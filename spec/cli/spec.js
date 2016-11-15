const fs = require('fs');

const cli = require('../../lib/cli.js');

describe('CLI', () => {
  it('should generate a template', () => {
    cli.generateTemplate();

    expect(fs.readFileSync('cloud/main.js')).toContain('hello');
    expect(fs.readFileSync('public/hello.txt')).toContain('hello');
  });
});

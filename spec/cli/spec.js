const fs = require('fs');

const cli = require('../../lib/cli.js');

describe('CLI', () => {
  it('should generate a template', () => {
    cli.generateTemplate();

    expect(fs.readFileSync('cloud/main.js')).toContain('hello');
    expect(fs.readFileSync('public/hello.txt')).toContain('hello');
  });

  // We're not checking for UUIDs because not all application IDs are UUIDs.
  it('should accept hex application IDs', () => {
    expect(cli.isNotValidAppID('58e7a716-308e-4b7b-90a0-a2321a3f95d7')).toBe(false);
    expect(cli.isNotValidAppID('3edb5a348ffd79b18a439e137d5ecbaf')).toBe(false);
  });

  it('should accept alphanumeric master keys', () => {
    expect(cli.isNotValidMasterKey('fps2JQIkfEouzBKL8v6Qm688aHlL7k4G')).toBe(false);
  });

  it('should reject clearly invalid application IDs', () => {
    expect(cli.isNotValidAppID('this!is!not!valid')).toBe(true);
    expect(cli.isNotValidAppID('{15a38054-271a-4e65-a74a-84b8efcebc61}')).toBe(true);
    expect(cli.isNotValidAppID('"79cd6471-4150-46f9-af92-9ed60d196b59"')).toBe(true);
  });

  it('should reject clearly invalid master keys', () => {
    expect(cli.isNotValidMasterKey('this!is!not!valid')).toBe(true);
    expect(cli.isNotValidMasterKey('a49c6ad3-7b18-4f6c-95c4-be705f95da93')).toBe(true);
  });
});

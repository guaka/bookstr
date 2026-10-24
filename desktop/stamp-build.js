'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// One timestamp per packaging invocation, shared by its platform/arch targets.
const builtAt = new Date().toISOString();

module.exports = async function stampBuild() {
  await fs.writeFile(path.join(__dirname, 'build-info.json'), JSON.stringify({ builtAt }) + '\n');
};

const fs = require('fs');
const crypto = require('crypto');

// All writes in this process are chained so a refresh and a save cannot interleave.
let writeQueue = Promise.resolve();

function writeJsonFile(filePath, payload) {
  const run = async () => {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      await fs.promises.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`);
      await fs.promises.rename(temporaryPath, filePath);
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true });
      throw error;
    }
  };
  const result = writeQueue.then(run);
  writeQueue = result.catch(() => {});
  return result;
}

module.exports = { writeJsonFile };

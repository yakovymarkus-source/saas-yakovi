const fs = require("fs/promises");
const path = require("path");

const dataDir = path.join(__dirname, "../../data");
const writeQueues = new Map();

async function ensureDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function ensureFile(filePath, defaultValue) {
  await ensureDir();
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2));
  }
}

async function readJson(filename, defaultValue) {
  const filePath = path.join(dataDir, filename);
  await ensureFile(filePath, defaultValue);
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content || JSON.stringify(defaultValue));
}

async function writeJson(filename, value) {
  const filePath = path.join(dataDir, filename);
  await ensureDir();

  const previous = writeQueues.get(filePath) || Promise.resolve();
  const nextWrite = previous.then(async () => {
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2));
    await fs.rename(tempPath, filePath);
  });

  writeQueues.set(filePath, nextWrite.catch(() => {}));
  await nextWrite;
}

module.exports = { readJson, writeJson };

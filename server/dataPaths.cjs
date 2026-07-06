const path = require('path');

const DATA_DIR = process.env.WORKBENCH_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.WORKBENCH_DB_PATH || path.join(DATA_DIR, 'ai-workbench.sqlite');
const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || path.join(__dirname, '..', 'outputs');

module.exports = {
  DATA_DIR,
  DB_PATH,
  OUTPUT_DIR,
};

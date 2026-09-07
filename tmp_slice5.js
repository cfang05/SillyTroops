const fs = require('fs');
const l = fs.readFileSync('src/utils/llm/client.js', 'utf8').split(/\r?\n/);
console.log(l.slice(239, 320).join('\n'));
const fs = require('fs');
const l = fs.readFileSync('src/utils/llm/client.js', 'utf8').split(/\r?\n/);
console.log(l.slice(200, 262).join('\n'));
const fs = require('fs');
const l = fs.readFileSync('src/pages/chat/chat.vue', 'utf8').split(/\r?\n/);
console.log(l.slice(499, 650).join('\n'));
const fs = require("fs");
const path = require("path");

function walk(dir) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "node_modules" || name.name === ".next") continue;
      walk(p);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name.name)) {
      const buf = fs.readFileSync(p);
      if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
        const text = buf.subarray(2).toString("utf16le");
        fs.writeFileSync(p, text, "utf8");
        console.log("fixed BOM utf16le:", p);
        continue;
      }
      let utf16ish = true;
      const sample = Math.min(buf.length, 8000);
      for (let i = 0; i < sample; i += 2) {
        if (i + 1 >= buf.length) break;
        const hi = buf[i + 1];
        const lo = buf[i];
        if (hi !== 0 && lo !== 0) {
          utf16ish = false;
          break;
        }
      }
      if (utf16ish && buf.length > 4 && buf[1] === 0) {
        const text = buf.toString("utf16le");
        if (/import\s/.test(text) || /export\s/.test(text) || /"use client"/.test(text)) {
          fs.writeFileSync(p, text, "utf8");
          console.log("fixed utf16le:", p);
        }
      }
    }
  }
}

walk(path.join(__dirname, "..", "src"));
walk(path.join(__dirname, ".."));
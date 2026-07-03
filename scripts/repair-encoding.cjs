const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");
const files = process.argv.slice(2);
const root = path.join(__dirname, "..");
function repairFile(absPath) {
  const b = fs.readFileSync(absPath);
  let text;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    text = b.subarray(2).toString("utf16le");
  } else {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(b);
      text = b.toString("utf8");
    } catch {
      text = b.toString("utf16le");
    }
  }
  fs.writeFileSync(absPath, text, "utf8");
  console.log("repaired:", absPath);
}
for (const rel of files) {
  repairFile(path.isAbsolute(rel) ? rel : path.join(root, rel));
}
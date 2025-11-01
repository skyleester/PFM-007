import { readFileSync } from "fs";
import { resolve } from "path";
import { parseBankSaladWorkbook } from "../lib/importers/banksalad";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: ts-node scripts/run-banksalad.ts <path-to-xlsx>");
  process.exit(1);
}

const absPath = resolve(process.cwd(), filePath);
const buffer = readFileSync(absPath);

const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

const { items, issues, summary } = parseBankSaladWorkbook(arrayBuffer, 1, {
  existingAccounts: [
    "급여 하나 통장",
    "저축예금30007",
    "저축예금84607",
  ],
});

console.log(JSON.stringify({ items, issues, summary }, null, 2));

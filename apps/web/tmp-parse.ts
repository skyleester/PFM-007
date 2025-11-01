import fs from "fs/promises";
import path from "path";
import { parseBankSaladWorkbook } from "./lib/importers/banksalad";

async function main() {
  const [, , fileArg, mode] = process.argv;
  const filePath = fileArg ? path.resolve(fileArg) : path.resolve("../../banksalad 84607.xlsx");
  const buffer = await fs.readFile(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const result = parseBankSaladWorkbook(arrayBuffer, 1, { existingAccounts: ["저축예금 84607"] });
  if (mode === "--json") {
    console.log(JSON.stringify(result.items, null, 2));
    return;
  }
  console.log(JSON.stringify(result.summary, null, 2));
  console.log(result.items.slice(0, 5));
  const uniqueGroups = Array.from(new Set(result.items.map((item) => `${item.type}:${item.category_group_name ?? ""}`))).slice(0, 20);
  console.log("Sample groups:", uniqueGroups);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

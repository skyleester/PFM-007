import { parseBankSaladWorkbook } from '../lib/importers/banksalad';
import * as fs from 'fs';
import * as path from 'path';

function testSample(filepath: string, userId: number = 1) {
  console.log('\n' + '='.repeat(80));
  console.log('Testing:', path.basename(filepath));
  console.log('='.repeat(80));
  
  const buffer = fs.readFileSync(filepath);
  const result = parseBankSaladWorkbook(buffer.buffer as ArrayBuffer, userId, {
    existingAccounts: ["급여 하나 통장(지수)", "입출금통장 4305", "급여 하나 통장 (호천)"],
    rawSingleAccountMode: false,
  });
  
  console.log('\n📊 Summary:');
  console.log('- Total items:', result.items.length);
  console.log('- Suspected pairs:', result.suspectedPairs.length);
  console.log('- Issues:', result.issues.length);
  console.log('- By type:', result.summary.byType);
  
  console.log('\n📝 All Items:');
  result.items.forEach((item, i) => {
    console.log(`\n[${i + 1}] ${item.type} | ${item.occurred_at} ${item.occurred_time} | ${item.amount} ${item.currency}`);
    console.log(`    Account: ${item.account_name} ${item.counter_account_name ? `→ ${item.counter_account_name}` : ''}`);
    console.log(`    Category: ${item.category_group_name} / ${item.category_name}`);
    console.log(`    Memo: ${item.memo || 'N/A'}`);
    console.log(`    External ID: ${item.external_id}`);
    if (item.transfer_flow) console.log(`    Flow: ${item.transfer_flow}`);
  });
  
  console.log('\n📊 Transaction Type Breakdown:');
  const typeCount = { TRANSFER: 0, INCOME: 0, EXPENSE: 0 };
  result.items.forEach(item => {
    typeCount[item.type as keyof typeof typeCount]++;
  });
  console.log(`  TRANSFER: ${typeCount.TRANSFER}`);
  console.log(`  INCOME: ${typeCount.INCOME}`);
  console.log(`  EXPENSE: ${typeCount.EXPENSE}`);
  
  if (result.suspectedPairs.length > 0) {
    console.log('\n🔍 Suspected Pairs:');
    result.suspectedPairs.forEach((pair, i) => {
      console.log(`\n[Pair ${i + 1}] ${pair.id}`);
      console.log(`  Confidence: ${pair.confidence.level} (${pair.confidence.score} pts)`);
      console.log(`  Reasons: ${pair.confidence.reasons.join(', ')}`);
      console.log(`  OUT: ${pair.outgoing.occurred_at} ${pair.outgoing.occurred_time} | ${pair.outgoing.amount} | ${pair.outgoing.account_name}`);
      console.log(`  IN:  ${pair.incoming.occurred_at} ${pair.incoming.occurred_time} | ${pair.incoming.amount} | ${pair.incoming.account_name}`);
    });
  } else {
    console.log('\n⚠️  No suspected pairs found!');
  }
  
  if (result.issues.length > 0) {
    console.log('\n⚠️  Issues:');
    result.issues.forEach(issue => console.log('  -', issue));
  }
  
  return result;
}

const rootDir = path.join(__dirname, '..', '..', '..');
console.log('Root dir:', rootDir);

// Test which files?
const testFiles = process.argv.slice(2);
if (testFiles.length === 0) {
  testFiles.push('sample/sample1.xlsx', 'sample/sample2.xlsx');
}

const results = testFiles.map(file => ({
  file,
  result: testSample(path.join(rootDir, file))
}));

console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
results.forEach(({ file, result }) => {
  console.log(`${path.basename(file)}: items = ${result.items.length}, suspected pairs = ${result.suspectedPairs.length}`);
});

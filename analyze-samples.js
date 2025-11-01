const XLSX = require('xlsx');
const fs = require('fs');

function analyzeFile(filepath) {
  console.log('\n' + '='.repeat(60));
  console.log('File:', filepath);
  console.log('='.repeat(60));
  
  const buffer = fs.readFileSync(filepath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  console.log('Sheet names:', workbook.SheetNames);
  
  // 가계부 내역 시트 찾기
  let sheetName = '가계부 내역';
  if (!workbook.Sheets[sheetName]) {
    sheetName = workbook.SheetNames[1] || workbook.SheetNames[0];
  }
  
  console.log('\nAnalyzing sheet:', sheetName);
  
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  
  console.log('\nAll rows:');
  rows.forEach((row, i) => {
    if (row.some(cell => cell != null && String(cell).trim())) {
      console.log(`Row ${i + 1}:`, JSON.stringify(row));
    }
  });
}

analyzeFile('./sample/sample1.xlsx');
analyzeFile('./sample/sample2.xlsx');

/**
 * Chương trình: nếu 1 + 1 = 2 thì in ra "huu manh bi ngu".
 *
 * Chạy: npx tsx scripts/if-1-plus-1.ts
 */

/** Kiểm tra tổng của hai số có bằng giá trị kỳ vọng không. */
function tongBang(a: number, b: number, kyVong: number): boolean {
  return a + b === kyVong;
}

const tong = 1 + 1;

if (tongBang(1, 1, 2)) {
  console.log('huu manh bi ngu');
} else {
  // Nhánh này chỉ để chứng minh điều kiện thật sự chi phối kết quả in ra.
  console.log(`1 + 1 = ${tong}, khong bang 2 — the gioi co van de`);
}

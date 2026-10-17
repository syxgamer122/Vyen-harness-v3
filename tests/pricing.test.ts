import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { estimateCallCostUsd, findModelPrice } from '@/lib/pricing';

describe('findModelPrice — match fragment dài nhất', () => {
  it('"gpt-4o-mini" phải khớp mini trước gpt-4o (giá rẻ hơn nhiều)', () => {
    const p = findModelPrice('gpt-4o-mini');
    expect(p).toEqual({ in: 0.15, out: 0.6 });
  });

  it('prefix vendor không cản trở match ("openai/gpt-4o", "gw/claude-sonnet-4")', () => {
    expect(findModelPrice('openai/gpt-4o')?.in).toBe(2.5);
    expect(findModelPrice('gw/claude-sonnet-4')?.out).toBe(15.0);
  });

  it('model local/free không nhận diện → null (không bịa tiền)', () => {
    expect(findModelPrice('llama3.2-local')).toBeNull();
    /* Mẫu phải là id KHÔNG có fragment nào khớp. Bản cũ dùng
       'ollama/qwen3.8-max-preview': khi bảng có thêm fragment 'qwen3.8-max'
       (để khớp contract), id đó khớp luôn nên test hết còn kiểm "không nhận
       diện" nữa. Đổi sang gemma — họ này không có giá ở đây. */
    expect(findModelPrice('ollama/gemma-3-12b')).toBeNull();
    expect(findModelPrice('')).toBeNull();
  });
});

describe('estimateCallCostUsd', () => {
  it('tính đúng công thức USD trên 1M token', () => {
    // deepseek-chat: in 0.14, out 0.28
    const usd = estimateCallCostUsd('deepseek-chat', 1_000_000, 500_000);
    expect(usd).toBeCloseTo(0.14 + 0.28 * 0.5, 6);
  });

  it('model không có giá → null thay vì 0$', () => {
    expect(estimateCallCostUsd('mystery-model', 1000, 2000)).toBeNull();
  });
});

describe('thêm fragment không được nuốt id cũ (match dài nhất)', () => {
  /*
   * Mỗi lần thêm một fragment để bịt lệch giá là một lần đổi bảng: fragment
   * ngắn hơn có thể bị fragment mới che mất, hoặc fragment mới (ngắn) có thể
   * nuốt id cũ. Khoá lại đúng các cặp đã suýt va nhau khi vá.
   */
  it("'o1' không được nuốt 'o1-mini' (3/12 chứ không phải 15/60)", () => {
    expect(findModelPrice('o1')).toEqual({ in: 15.0, out: 60.0 });
    expect(findModelPrice('o1-mini')).toEqual({ in: 3.0, out: 12.0 });
    expect(findModelPrice('openai/o1-mini')).toEqual({ in: 3.0, out: 12.0 });
  });

  it("'deepseek-v4-pro' và 'deepseek-v4' không rơi về 'deepseek' chung", () => {
    expect(findModelPrice('deepseek-v4-pro')?.out).toBe(0.87);
    expect(findModelPrice('deepseek-v4')?.out).toBe(0.87);
    expect(findModelPrice('deepseek-chat')?.in).toBe(0.14);
  });

  it("'kimi-k3' thắng 'kimi' chung (1.0/3.0 chứ không 0.6/2.5)", () => {
    expect(findModelPrice('kimi-k3')).toEqual({ in: 1.0, out: 3.0 });
    expect(findModelPrice('kimi')).toEqual({ in: 0.6, out: 2.5 });
  });

  it("'gemini-3-flash' không bị 'gemini-flash'/'gemini-pro' hớt", () => {
    expect(findModelPrice('gemini-3-flash')).toEqual({ in: 0.15, out: 0.6 });
    expect(findModelPrice('gemini-3-1-pro')).toEqual({ in: 1.25, out: 5.0 });
    expect(findModelPrice('gemini-2.0-flash')).toEqual({ in: 0.1, out: 0.4 });
  });

  it("'qwen-plus' không hớt 'qwen3-coder-plus'", () => {
    expect(findModelPrice('qwen3-coder-plus')).toEqual({ in: 0.8, out: 3.2 });
    expect(findModelPrice('qwen-plus')).toEqual({ in: 0.4, out: 1.2 });
  });

  it("'claude-opus-5' không phá giá họ 4", () => {
    expect(findModelPrice('claude-opus-5')?.in).toBe(15.0);
    expect(findModelPrice('claude-opus-4')?.in).toBe(15.0);
    expect(findModelPrice('claude-sonnet-4')?.out).toBe(15.0);
  });
});

/*
 * ĐỒNG BỘ hai bảng giá.
 *
 * lib/pricing.ts (fragment, nuôi dòng chi phí dưới tin nhắn + tab Data) và
 * lib/model-contracts.ts (model id, nuôi làn giá của HUD qua calculateModelCost)
 * là HAI bảng độc lập cho cùng một lượt gọi. Khi chúng lệch nhau, người dùng
 * thấy HUD hiện một số còn dòng dưới tin nhắn hiện "—" hoặc một số khác — và
 * không có chỗ nào trong UI đối chiếu được. Đã xảy ra thật: 'gemini-3-1-pro'
 * có giá trong contract nhưng thiếu fragment nên cost biến mất ở dòng tin nhắn;
 * 'kimi-k3' khớp fragment 'kimi' chung nên ra 0.6/2.5 lệch với contract 1.0/3.0.
 *
 * Không gộp hai bảng làm một (contract chỉ phủ ~19 model có trích dẫn, còn bảng
 * này phủ ~40 fragment dùng chung) — chỉ khoá chúng lại bằng test này. Test ĐỌC
 * TEXT hai file (không import lib/model-contracts để không phụ thuộc việc nó có
 * build được hay không) và bắt mọi dòng lệch thành test đỏ, thay vì hoá đơn bí ẩn.
 *
 * Đổi một số ở bảng này hoặc ở bảng kia mà không đổi bảng còn lại → đỏ ở đây.
 */

/** Đọc source đã quy về LF — file trên đĩa là CRLF, regex hard-code `\n` sẽ
 *  xanh ở máy và đỏ ở CI. */
const readSource = (rel: string): string =>
  fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

interface FragmentPrice {
  fragment: string;
  in: number;
  out: number;
}

interface ContractPrice {
  id: string;
  in: number;
  out: number;
}

/** Cắt thân khối `const TABLE = [...]` của lib/pricing.ts. */
function readPricingTable(src: string): FragmentPrice[] {
  const start = src.indexOf('const TABLE');
  const end = src.indexOf('].sort', start);
  if (start < 0 || end < 0) {
    throw new Error('không cắt được TABLE trong lib/pricing.ts — cấu trúc file đã đổi?');
  }
  const body = src.slice(start, end);
  const rows = [...body.matchAll(/\{ fragment: '([^']+)', in: ([\d.]+), out: ([\d.]+) \}/g)].map(
    (m) => ({ fragment: m[1]!, in: Number(m[2]!), out: Number(m[3]!) }),
  );
  if (rows.length === 0) {
    throw new Error('không parse được fragment nào từ TABLE — regex đã lệch với file?');
  }
  return rows;
}

/**
 * Cắt thân khối `MODEL_CONTRACTS = {...}` và lấy MỌI entry có `price`.
 * Cố tình chỉ regex phần có giá: contract thiếu `price` thì `calculateModelCost`
 * trả 'unknown' ở HUD, không phải việc của bảng này — và contract đó chưa chắc
 * đã có con số để đối chiếu.
 */
function readContractPrices(src: string): ContractPrice[] {
  const start = src.indexOf('MODEL_CONTRACTS');
  const end = src.indexOf('function stripProviderPrefix', start);
  if (start < 0 || end < 0) {
    throw new Error('không cắt được MODEL_CONTRACTS trong lib/model-contracts.ts — cấu trúc đổi?');
  }
  const body = src.slice(start, end);
  const out: ContractPrice[] = [];
  for (const entry of body.matchAll(/'([a-z0-9_.-]+)': \{([\s\S]*?)\n  \},/g)) {
    const price = entry[2]!.match(/price: \{ inPerMTok: ([\d.]+), outPerMTok: ([\d.]+)/);
    if (price) out.push({ id: entry[1]!, in: Number(price[1]!), out: Number(price[2]!) });
  }
  if (out.length === 0) {
    throw new Error('không đọc được contract nào có giá — MODEL_CONTRACTS đổi shape?');
  }
  return out;
}

describe('hai bảng giá phải khớp nhau (lib/pricing ↔ lib/model-contracts)', () => {
  const table = readPricingTable(readSource('lib/pricing.ts'));
  const contracts = readContractPrices(readSource('lib/model-contracts.ts'));

  /*
   * Ngoại lệ CÓ TÊN — không phải bỏ qua im lặng. Mỗi dòng ở đây là một điểm
   * lệch ĐÃ BIẾT và có lý do viết trong lib/pricing.ts. Test vẫn xanh vì lệch
   * là chủ ý; test cuối trong khối này canh cho danh sách không bị mục ruỗng:
   * khi bên nào chốt được số đúng và đồng bộ, mục miễn trừ sẽ tự đỏ và phải xoá.
   */
  const UNRESOLVED = new Set<string>([
    // pricing.ts theo giá đại lý 0.435/0.87; contract ghi 0.8/3.2. Chưa chốt bên nào.
    'deepseek-v4-pro',
  ]);

  it('bộ đọc bắt được bảng thật — parse rỗng là lỗi, không phải "không có gì để kiểm"', () => {
    expect(table.length, 'số fragment đọc được từ lib/pricing.ts').toBeGreaterThan(30);
    const matched = contracts.filter((c) => findModelPrice(c.id) !== null);
    expect(matched.length, 'số contract có giá khớp được fragment').toBeGreaterThan(15);
  });

  it('model nào khớp fragment ở pricing.ts thì hai bảng phải ra CÙNG số', () => {
    const mismatches: string[] = [];
    for (const c of contracts) {
      if (UNRESOLVED.has(c.id)) continue;
      const p = findModelPrice(c.id);
      if (!p) continue; // không có fragment tương ứng: đã bị test dưới bắt riêng
      if (p.in !== c.in || p.out !== c.out) {
        mismatches.push(`${c.id}: pricing ${p.in}/${p.out} ≠ contract ${c.in}/${c.out}`);
      }
    }
    expect(mismatches, `hai bảng giá lệch nhau:\n${mismatches.join('\n')}`).toEqual([]);
  });

  it('contract có giá thì pricing.ts PHẢI tra được — không để cost biến mất thành "—"', () => {
    const missing = contracts.filter((c) => findModelPrice(c.id) === null).map((c) => c.id);
    expect(
      missing,
      `contract có giá nhưng lib/pricing.ts không có fragment khớp — thêm fragment cho:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('mục miễn trừ phải là lệch THẬT, không phải di tích đã sửa xong', () => {
    for (const id of UNRESOLVED) {
      const c = contracts.find((x) => x.id === id);
      expect(c, `miễn trừ ${id} nhưng contract không còn id này — xoá khỏi UNRESOLVED`).toBeDefined();
      const p = findModelPrice(id);
      expect(p, `miễn trừ ${id} nhưng pricing.ts không khớp nữa — xoá khỏi UNRESOLVED`).not.toBeNull();
      const stillDiffers = p!.in !== c!.in || p!.out !== c!.out;
      expect(stillDiffers, `${id} đã khớp — xoá khỏi UNRESOLVED để test canh nó`).toBe(true);
    }
  });
});

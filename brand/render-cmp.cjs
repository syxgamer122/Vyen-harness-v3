/*
 * Đối chiếu mắt: ảnh nguồn BÊN TRÁI, icon do `scripts/build-icons.cjs` sinh BÊN
 * PHẢI. Chạy sau mỗi lần đổi `mark.json` — không có ảnh này thì mọi tuyên bố
 * "logo khớp" trong `brand/README.md` chỉ là lời nói.
 *
 * Công cụ này CHỈ ĐỌC và xuất `cmp-big.png`. Nó không gọi lại
 * `scripts/build-icons.cjs`: nếu có, đang muốn so sánh lại người ta vô tình
 * GHI ĐÈ file icon đã commit, và `cmp-big.png` sẽ tự khớp với chính nó — tức
 * mất đúng thứ nó sinh ra để bắt lỗi.
 *
 * Chạy:  npm run icons:build   (trước)   rồi   node brand/render-cmp.cjs
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const B = path.join(ROOT, 'brand');
const SRC = path.join(B, 'logo-source.png');

(async () => {

  const meta = await sharp(SRC).metadata();
  // Khung logo đo được: x 271–1786, y 394–1724
  const src = await sharp(SRC)
    .extract({ left: 271, top: 394, width: 1516, height: 1331 })
    .resize(380, 380, { fit: 'contain', background: '#ffffff' })
    .png().toBuffer();
  const built = await sharp(path.join(ROOT, 'public/icons/icon-512.png'))
    .resize(380, 380, { fit: 'contain', background: '#ffffff' })
    .png().toBuffer();

  const pad = 30;
  await sharp({
    create: { width: 380 * 2 + pad * 3, height: 380 + pad * 2, channels: 3, background: '#ffffff' },
  })
    .composite([
      { input: src, left: pad, top: pad },
      { input: built, left: pad * 2 + 380, top: pad },
    ])
    .png().toFile(path.join(B, 'cmp-big.png'));

  console.log(`cmp-big.png — nguồn ${meta.width}x${meta.height} | icon dựng lại 512px`);
})().catch((e) => { console.error(e); process.exit(1); });